'use strict';
// Decodificador do radio dos bunkers da Nasdara: som do jogo entra, grade do bunker + codigo da porta saem.
// Nao depende de Node nem do navegador (a pagina entrega as amostras de audio), por isso da para testar com som sintetico.
//
// O que o jogo transmite (missao "Bunker broadcast" do DZ 1.30, no radio em 80.0 MHz, de noite): para cada bunker
// aberto, a grade do mapa (6 digitos: 3 de leste e 3 contados a partir da borda norte, quadrados de 100 m) e depois o
// codigo da porta (4 digitos), em morse. So existem digitos e cada digito tem exatamente 5 elementos (ponto ou traco);
// cada elemento e um bipe de ~987 Hz, o ponto com ~0,1 s e o traco com ~0,5 s. Um tom longo mais grave (~932 Hz) pode
// vir antes da mensagem e nao e elemento.
//
// Como lemos: (1) um detector de bipes olha so a faixa em volta de 987 Hz e compara com faixas vizinhas;
// (2) a duracao separa pontos de tracos; (3) a grade e procurada na sequencia de elementos entre as dos 23 bunkers que
// existem, o que dispensa contar pausas e tolera um ou dois elementos errados; (4) os 20 elementos seguintes sao o
// codigo; (5) a mensagem se repete, entao cada digito e votado entre as repeticoes.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadioMorse = factory();
}(this, () => {
  const DIGIT_OF = {
    '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
  };
  const PATTERN_OF = Object.fromEntries(Object.entries(DIGIT_OF).map(([pattern, digit]) => [digit, pattern]));

  const GRID_ELEMENTS = 30; // 6 digitos x 5
  const CODE_ELEMENTS = 20; // 4 digitos x 5
  const GRID_MAX_ERRORS = 2; // elementos lidos errado que ainda deixam reconhecer a grade
  const MAX_ELEMENTS = 1500; // historico guardado; o mais antigo sai primeiro
  const QUIET_S = 9; // silencio que encerra uma mensagem (as pausas dentro dela sao menores)

  const DEFAULTS = {
    toneHz: [982, 987, 992], // o bipe, com um pouco de variacao de tom
    sideHz: [900, 1080], // faixas de comparacao: fora do lobo do bipe e abaixo do chiado do radio (1,2 a 3 kHz)
    windowS: 0.06,
    hopS: 0.01,
    minPower: 0.01, // abaixo disso e silencio (amostras entre -1 e 1)
    floorS: 4, // o fundo da faixa e estimado nos ultimos segundos...
    floorPct: 0.2, // ...pelo percentil baixo (bipes ocupam bem menos de 80% de qualquer janela de 4 s)
    ratioOn: 8, // potencia do tom / fundo (ou faixas vizinhas, o que for maior) para dizer "bipe"
    ratioOff: 3, // histerese
    smoothFrames: 3, // mediana dos ultimos quadros: um ponto dura so ~0,1 s
    minBeepS: 0.05, // mais curto que isso e estalo, nao elemento
    mergeGapS: 0.1, // falha menor que isso dentro de um bipe e o mesmo bipe
    dashS: 0.3, // limite padrao entre ponto (~0,1 s) e traco (~0,5 s)
    markerS: 1.6, // tom mais longo que isso e a vinheta, nao um elemento
  };

  function goertzel(buf, n, coeff) {
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const s0 = buf[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  }

  /** Audio -> bipes. push() recebe amostras em qualquer quantidade; onBeep(inicio, fim) sai em segundos de audio. */
  class ToneDetector {
    constructor(sampleRate, options) {
      this.o = { ...DEFAULTS, ...options };
      this.sampleRate = sampleRate;
      this.win = Math.max(64, Math.round(sampleRate * this.o.windowS));
      this.hop = Math.max(16, Math.round(sampleRate * this.o.hopS));
      this.hann = Float32Array.from({ length: this.win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.win - 1)));
      const coeff = (hz) => 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
      this.toneCoeff = this.o.toneHz.map(coeff);
      this.sideCoeff = this.o.sideHz.map(coeff);
      this.hist = new Float32Array(Math.max(10, Math.round(this.o.floorS / this.o.hopS))); // potencias recentes do tom
      this.histN = 0;
      this.floor = 0;
      this.buf = new Float32Array(this.win);
      this.work = new Float32Array(this.win);
      this.fill = 0;
      this.t = 0; // segundos de audio ja recebidos
      this.level = 0; // razao do ultimo quadro, para um medidor
      this.ratios = [];
      this.on = false;
      this.startedAt = 0;
      this.pending = null; // [inicio, fim] de um bipe que uma falha curta ainda pode prolongar
      this.onBeep = null;
    }

    push(samples) {
      const { win, hop } = this;
      const o = this.o;
      for (let k = 0; k < samples.length; k++) {
        this.buf[this.fill++] = samples[k];
        if (this.fill < win) continue;

        for (let i = 0; i < win; i++) this.work[i] = this.buf[i] * this.hann[i];
        let tone = 0;
        for (const c of this.toneCoeff) tone = Math.max(tone, goertzel(this.work, win, c));
        let side = 0;
        for (const c of this.sideCoeff) side += goertzel(this.work, win, c);
        side /= this.sideCoeff.length;

        this._updateFloor(tone);
        this.ratios.push(tone > o.minPower ? tone / (Math.max(side, this.floor) + 1e-12) : 0);
        if (this.ratios.length > o.smoothFrames) this.ratios.shift();
        const ratio = [...this.ratios].sort((a, b) => a - b)[this.ratios.length >> 1];
        this.level = ratio;

        // a borda e datada no meio da janela, descontando o atraso da mediana
        const frameEnd = this.t + (k + 1) / this.sampleRate;
        const edge = frameEnd - win / (2 * this.sampleRate) - ((o.smoothFrames >> 1) * hop) / this.sampleRate;
        if (!this.on && ratio >= o.ratioOn) {
          this.on = true;
          this.startedAt = edge;
        } else if (this.on && ratio < o.ratioOff) {
          this.on = false;
          this._close(this.startedAt, edge);
        }
        if (!this.on && this.pending && edge - this.pending[1] >= o.mergeGapS) this._flush();

        this.buf.copyWithin(0, hop, win);
        this.fill = win - hop;
      }
      this.t += samples.length / this.sampleRate;
    }

    /**
     * Fundo da propria faixa de 987 Hz: so ruido, a potencia de cada quadro varia muito (distribuicao exponencial),
     * entao comparar com a potencia de um unico quadro vizinho dispara por acaso. Pega o percentil baixo dos ultimos
     * segundos e o converte na potencia media do ruido (o percentil p de uma exponencial vale -ln(1-p) x a media).
     */
    _updateFloor(tone) {
      const h = this.hist;
      h[this.histN % h.length] = tone;
      this.histN++;
      if (this.floor && this.histN % 10 !== 0) return;
      const n = Math.min(this.histN, h.length);
      const sorted = Array.from(h.subarray(0, n)).sort((a, b) => a - b);
      this.floor = sorted[Math.floor((n - 1) * this.o.floorPct)] / -Math.log(1 - this.o.floorPct);
    }

    _close(start, end) {
      const p = this.pending;
      if (p && start - p[1] < this.o.mergeGapS) {
        p[1] = end;
        return;
      }
      this._flush();
      this.pending = [start, end];
    }

    _flush() {
      const p = this.pending;
      this.pending = null;
      if (p && p[1] - p[0] >= this.o.minBeepS && this.onBeep) this.onBeep(p[0], p[1]);
    }
  }

  /** Grade de 6 digitos de um ponto do mapa: leste (3) e distancia da borda norte (3), em quadrados de `step` metros */
  function gridOf(x, z, size, step) {
    const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(3, '0');
    return pad(x / step) + pad((size - z) / step);
  }

  /**
   * Bipes -> pontos e tracos -> grade + codigo. `map` = { size, step, bunkers: [{ x, z, ... }] }.
   * Os resultados se acumulam entre as repeticoes da mensagem.
   */
  class Decoder {
    constructor(map, options) {
      this.o = { ...DEFAULTS, ...options };
      this.bunkers = map.bunkers.map((b) => {
        const grid = gridOf(b.x, b.z, map.size, map.step);
        return { ...b, grid, pattern: [...grid].map((d) => PATTERN_OF[d]).join('') };
      });
      this.elements = []; // { d: duracao, start, end, s: '.' | '-' | null }
      this.found = {}; // grade -> { bunker, codes: { codigo: n }, heard, last }
      this.consumed = 0; // elementos ja transformados em resultado
      this.split = 0;
      this.readAt = null;
      this.onUpdate = null;
    }

    beep(start, end) {
      const d = end - start;
      // o tom longo e a vinheta que antecede a mensagem: nao e elemento
      if (d >= this.o.markerS) return;
      this.elements.push({ d, start, end, s: null });
      if (this.elements.length > MAX_ELEMENTS) {
        const drop = this.elements.length - MAX_ELEMENTS;
        this.elements.splice(0, drop);
        this.consumed = Math.max(0, this.consumed - drop);
      }
      this._parse(false);
    }

    /**
     * Onde acabam os pontos e comecam os tracos. Eco (microfone numa sala, reverberacao do jogo) soma a mesma cauda a
     * todos os bipes e transformaria todo ponto em traco: o limite fica no meio dos dois grupos de duracao recentes.
     */
    _splitAt() {
      const recent = this.elements.slice(-200).map((e) => e.d);
      if (recent.length < 12) return this.o.dashS;
      let low = Math.min(...recent);
      let high = Math.max(...recent);
      if (high < 1.8 * low) return this.o.dashS;
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        const a = recent.filter((d) => d < mid);
        const b = recent.filter((d) => d >= mid);
        if (!a.length || !b.length) return this.o.dashS;
        low = a.reduce((s, d) => s + d, 0) / a.length;
        high = b.reduce((s, d) => s + d, 0) / b.length;
      }
      return high >= 1.8 * low ? (low + high) / 2 : this.o.dashS;
    }

    _classify() {
      const split = this._splitAt();
      // um limite que andou muito muda a leitura de tudo o que ja foi ouvido: le de novo desde o comeco
      if (!this.split || Math.abs(split - this.split) > 0.1 * this.split) {
        this.split = split;
        this.found = {};
        this.consumed = 0;
        for (const e of this.elements) e.s = null;
      }
      for (const e of this.elements) if (e.s === null) e.s = e.d >= split ? '-' : '.';
    }

    /** Grade (30 elementos) a partir de `from`: o bunker de padrao mais parecido, se for claramente o melhor */
    _gridAt(from) {
      let best = null;
      let second = Infinity;
      for (const bunker of this.bunkers) {
        let errors = 0;
        for (let i = 0; i < GRID_ELEMENTS && errors <= GRID_MAX_ERRORS; i++) {
          if (this.elements[from + i].s !== bunker.pattern[i]) errors++;
        }
        if (!best || errors < best.errors) {
          if (best) second = Math.min(second, best.errors);
          best = { bunker, errors };
        } else {
          second = Math.min(second, errors);
        }
      }
      // um bunker parecido so vale se nenhum outro for tao parecido quanto ele
      return best && best.errors <= GRID_MAX_ERRORS && second > best.errors ? best : null;
    }

    /** Codigo de ate 4 digitos nos elementos seguintes; '?' no digito que nao fecha */
    _codeAt(from) {
      let code = '';
      for (let d = 0; d < 4; d++) {
        const els = this.elements.slice(from + d * 5, from + d * 5 + 5);
        const digit = els.length === 5 ? DIGIT_OF[els.map((e) => e.s).join('')] : undefined;
        code += digit === undefined ? '?' : digit;
      }
      return code;
    }

    /**
     * Elementos agrupados por digito, pelas pausas: dentro de um digito a pausa e curta (4 de cada 5 pausas), entre
     * digitos e mais longa. Um bipe perdido ou sobrando estraga so o digito dele, e os seguintes continuam alinhados.
     * Devolve null enquanto nao ha pausas suficientes ou se elas nao tem esse padrao (todas iguais): ai vale a contagem.
     */
    _groups() {
      const els = this.elements;
      const gaps = [];
      for (let i = 0; i + 1 < els.length; i++) {
        const g = els[i + 1].start - els[i].end;
        if (g < 4) gaps.push(g);
      }
      if (gaps.length < 20) return null;
      // 4 de cada 5 pausas ficam dentro de um digito: a mediana e a pausa curta, e o limite fica um pouco acima dela
      const median = [...gaps].sort((x, y) => x - y)[gaps.length >> 1];
      const limit = Math.max(1.5 * median, median + 0.15);
      const longShare = gaps.filter((g) => g >= limit).length / gaps.length;
      if (longShare < 0.1 || longShare > 0.35) return null;

      const groups = [];
      let cur = null;
      els.forEach((e, i) => {
        if (!cur || e.start - els[i - 1].end >= limit) {
          cur = { from: i, els: [] };
          groups.push(cur);
        }
        cur.els.push(e);
      });
      for (const g of groups) g.digit = g.els.length === 5 ? DIGIT_OF[g.els.map((e) => e.s).join('')] ?? null : null;
      return groups;
    }

    /** Grade nos 6 grupos a partir de `i`: o bunker com mais digitos iguais e nenhum (ou um) diferente, se for o unico */
    _gridInGroups(groups, i) {
      let best = null;
      let second = -Infinity;
      for (const bunker of this.bunkers) {
        let match = 0;
        let miss = 0;
        for (let k = 0; k < 6; k++) {
          const d = groups[i + k].digit;
          if (d === null) continue;
          if (d === bunker.grid[k]) match++;
          else miss++;
        }
        const score = match - 2 * miss;
        if (match >= 4 && miss <= 1) {
          if (!best || score > best.score) {
            if (best) second = Math.max(second, best.score);
            best = { bunker, score, errors: miss };
          } else {
            second = Math.max(second, score);
          }
        }
      }
      return best && best.score > second ? best : null;
    }

    _record(hit, code, endIndex) {
      const els = this.elements;
      const f = this.found[hit.bunker.grid] || (this.found[hit.bunker.grid] = { bunker: hit.bunker, codes: {}, heard: 0, last: 0 });
      if (code !== '????') f.codes[code] = (f.codes[code] || 0) + 1;
      f.heard++;
      f.last = els[endIndex - 1].end;
      this.consumed = endIndex;
    }

    _readGroups(groups, ending) {
      let changed = false;
      for (let i = 0; i + 6 <= groups.length; i++) {
        if (groups[i].from < this.consumed) continue;
        const hit = this._gridInGroups(groups, i);
        if (!hit) continue;
        // o ultimo digito do codigo so esta completo quando ja comecou o grupo seguinte
        if (i + 11 > groups.length && !ending) break;
        const codeGroups = groups.slice(i + 6, i + 10);
        const code = Array.from({ length: 4 }, (_, k) => codeGroups[k]?.digit ?? '?').join('');
        if (hit.errors > 0 && code === '????') continue;
        const last = codeGroups.length ? codeGroups[codeGroups.length - 1] : groups[i + 5];
        this._record(hit, code, last.from + last.els.length);
        i += 9;
        changed = true;
      }
      return changed;
    }

    /** Sem pausas confiaveis: desliza pela sequencia de elementos procurando 30 que leiam como a grade de um bunker */
    _readCounted(ending) {
      const els = this.elements;
      let changed = false;
      for (let i = this.consumed; i + GRID_ELEMENTS <= els.length; i++) {
        const hit = this._gridAt(i);
        if (!hit) continue;
        const codeFrom = i + GRID_ELEMENTS;
        // espera o codigo inteiro (ou, no fim da escuta, le o que houver)
        if (codeFrom + CODE_ELEMENTS > els.length && !ending) break;

        const code = this._codeAt(codeFrom);
        // uma grade que so bateu "quase" precisa de um codigo legivel para valer: pode ser de outro bunker
        if (hit.errors > 0 && code === '????') continue;

        const end = Math.min(els.length, codeFrom + CODE_ELEMENTS);
        this._record(hit, code, end);
        i = end - 1;
        changed = true;
      }
      return changed;
    }

    _parse(ending) {
      this._classify();
      const groups = this._groups();
      const changed = groups ? this._readGroups(groups, ending) : this._readCounted(ending);
      if (changed && this.onUpdate) this.onUpdate(this.results());
    }

    /** A escuta acabou: le o que sobrou sem esperar o codigo inteiro */
    finish() {
      this._parse(true);
    }

    /**
     * Escuta ao vivo: o ultimo bunker de uma mensagem nao tem nada depois dele ate a proxima, minutos adiante.
     * Depois de QUIET_S sem bipe, le o que sobrou (uma vez por silencio). `now` = segundos de audio ouvidos.
     */
    idle(now) {
      const last = this.elements[this.elements.length - 1]?.end;
      if (last === undefined || now - last < QUIET_S || this.readAt === last) return;
      this.readAt = last;
      this.finish();
    }

    /**
     * Ultimos `count` digitos ouvidos, para mostrar ao vivo: [{ digit, symbols, partial, newMessage }].
     * `digit` = null quando os 5 elementos nao formam um digito; `partial` = o ultimo, ainda chegando;
     * `newMessage` = veio depois de um silencio longo (outra repeticao da mensagem).
     */
    live(count = 30) {
      let groups = this._groups();
      if (!groups) { // sem pausas confiaveis: de 5 em 5 elementos, como na leitura por contagem
        groups = [];
        for (let i = 0; i < this.elements.length; i += 5) groups.push({ els: this.elements.slice(i, i + 5) });
        for (const g of groups) g.digit = g.els.length === 5 ? DIGIT_OF[g.els.map((e) => e.s).join('')] ?? null : null;
      }
      const from = Math.max(0, groups.length - count);
      return groups.slice(from).map((g, i, list) => {
        const prev = groups[from + i - 1];
        return {
          digit: g.digit,
          symbols: g.els.map((e) => e.s).join(''),
          partial: from + i === groups.length - 1 && g.els.length < 5,
          newMessage: !!prev && g.els[0].start - prev.els[prev.els.length - 1].end >= 4,
        };
      });
    }

    /**
     * [{ grid, bunker, code, sure, codes, heard, last }], o mais recente primeiro. `code` e votado digito a digito
     * entre as repeticoes ('?' = ninguem ouviu direito). `sure` = todo digito com pelo menos 2 votos iguais e sem
     * empate.
     */
    results() {
      return Object.entries(this.found).map(([grid, f]) => {
        const codes = Object.entries(f.codes).sort((a, b) => b[1] - a[1]);
        let code = null;
        let sure = false;
        if (codes.length) {
          code = '';
          sure = true;
          for (let p = 0; p < 4; p++) {
            const votes = {};
            for (const [c, n] of codes) if (c[p] !== '?') votes[c[p]] = (votes[c[p]] || 0) + n;
            const ranked = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
            if (!ranked.length || (ranked.length > 1 && votes[ranked[1]] === votes[ranked[0]])) {
              code += '?';
              sure = false;
              continue;
            }
            code += ranked[0];
            if (votes[ranked[0]] < 2) sure = false;
          }
        }
        return { grid, bunker: f.bunker, code, sure, codes, heard: f.heard, last: f.last };
      }).sort((a, b) => b.last - a.last);
    }
  }

  return { ToneDetector, Decoder, gridOf, DIGIT_OF, PATTERN_OF, DEFAULTS };
}));
