'use strict';
// Rádio dos bunkers da Nasdara: escuta só o som do DZ (captura por processo, feita no processo principal), decodifica o morse do rádio
// e mostra a grade e o código de cada bunker. A decodificação fica em ../shared/morse.js; aqui só tem a ligação
// com o áudio e a tela. Carrega antes de app.js, que chama initRadio(); $, setHero, setNav e setButton vêm de app.js,
// t de i18n.js.

const radio = {
  active: false, // escutando (ou esperando o DZ abrir)
  mode: null, // 'game' = so o som do DZ (processo principal) | 'system' = som do PC todo (so se o Windows nao deixar isolar)
  pid: null, // processo do DZ que esta sendo escutado
  attach: 0, // conta as trocas de processo, para ignorar respostas atrasadas
  ctx: null, stream: null, source: null, proc: null, sink: null, // so no modo 'system'
  detector: null, decoder: null, timer: 0,
  confirmed: new Set(), // "grade:codigo" que ja gerou aviso na tela
  error: null, // { key, params } do texto de erro
};

function radioListening() {
  return radio.active;
}

function radioReset(sampleRate = 48000) {
  radio.detector = new RadioMorse.ToneDetector(sampleRate);
  radio.decoder = new RadioMorse.Decoder(NasdaraBunkers);
  radio.confirmed.clear();
  radio.detector.onBeep = (start, end) => {
    radio.decoder.beep(start, end);
    renderRadioLive();
  };
  radio.decoder.onUpdate = (results) => {
    renderRadioResults(results);
    radioNotifyConfirmed(results);
  };
}

/** Aviso por cima do jogo na primeira vez que um bunker fica confirmado (codigo ouvido duas vezes igual) */
function radioNotifyConfirmed(results) {
  for (const r of results) {
    const key = `${r.grid}:${r.code}`;
    if (!r.sure || radio.confirmed.has(key)) continue;
    radio.confirmed.add(key);
    window.radioAudio.toast(
      t('toast.radio.confirmed'),
      t('toast.radio.confirmed.detail', { grid: `${r.grid.slice(0, 3)} ${r.grid.slice(3)}`, code: r.code }),
    );
  }
}

function radioFeed(samples) {
  radio.detector.push(samples);
  radio.decoder.idle(radio.detector.t); // o ultimo bunker de uma mensagem e lido quando o radio fica em silencio
}

function radioStopSystemAudio() {
  if (radio.proc) {
    radio.proc.disconnect();
    radio.proc.onaudioprocess = null;
  }
  radio.source?.disconnect();
  radio.sink?.disconnect();
  radio.stream?.getTracks().forEach((track) => track.stop());
  radio.ctx?.close();
  radio.ctx = radio.stream = radio.source = radio.proc = radio.sink = null;
}

function radioStop() {
  radio.attach++;
  if (radio.decoder) radio.decoder.finish(); // le o que sobrou (o ultimo bunker de uma mensagem nao tem nada depois)
  clearInterval(radio.timer);
  window.radioAudio.stop();
  radioStopSystemAudio();
  Object.assign(radio, { active: false, mode: null, pid: null });
  renderRadio();
}

/** Som do PC todo, so quando o Windows nao deixa isolar o DZ: o processo principal entrega o loopback do sistema */
async function radioStartSystem(attach) {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((track) => track.stop()); // so o som interessa
    if (radio.attach !== attach) return stream.getTracks().forEach((track) => track.stop());
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      radio.error = { key: 'radio.err.nosound' };
      return radioStop();
    }
    radio.stream = stream;
    radio.ctx = new AudioContext();
    radioReset(radio.ctx.sampleRate);
    radio.source = radio.ctx.createMediaStreamSource(stream);
    radio.proc = radio.ctx.createScriptProcessor(4096, 1, 1);
    radio.sink = radio.ctx.createGain();
    radio.sink.gain.value = 0; // o processador precisa chegar a saida para rodar; mudo, sem eco
    radio.proc.onaudioprocess = (e) => radioFeed(e.inputBuffer.getChannelData(0));
    radio.source.connect(radio.proc);
    radio.proc.connect(radio.sink);
    radio.sink.connect(radio.ctx.destination);
    stream.getAudioTracks()[0].addEventListener('ended', radioStop);
    radio.mode = 'system';
  } catch (err) {
    radio.error = { key: 'radio.err.capture', params: { error: err?.name || 'error' } };
    return radioStop();
  }
  renderRadio();
}

/**
 * Liga a captura ao DZ que o app acompanha (a janela alvo): ao abrir o jogo, fechar e reabrir ela troca de processo
 * sozinha. Sem jogo aberto fica esperando. force = refazer mesmo com o mesmo processo (primeira ligacao).
 */
async function radioFollowGame(force) {
  if (!radio.active || radio.mode === 'system') return;
  const pid = state?.target?.pid ?? null;
  if (!force && pid === radio.pid) return;
  radio.pid = pid;
  const attach = ++radio.attach;
  await window.radioAudio.stop();
  if (!pid) return renderRadio();
  radio.mode = 'game';
  renderRadio();
  const result = await window.radioAudio.start();
  if (radio.attach !== attach || !radio.active) return;
  if (!result.ok) {
    // O Windows (ou o jogo) nao deixou isolar o som: cai no som do PC todo, com aviso na tela
    radio.pid = null;
    await radioStartSystem(attach);
  }
  renderRadio();
}

async function radioStart() {
  radio.error = null;
  radioReset();
  Object.assign(radio, { active: true, mode: 'game', pid: undefined });
  clearInterval(radio.timer);
  radio.timer = setInterval(drawRadioMeter, 100);
  await radioFollowGame(true);
}

function drawRadioMeter() {
  if (!radio.detector) return;
  $('radio-meter-bar').style.width = `${Math.min(100, radio.detector.level * 8)}%`;
  $('radio-live-dot').classList.toggle('on', radio.detector.on);
}

window.addEventListener('resize', () => renderRadioLive());

const LIVE_CELL_W = 54; // largura do quadrado (styles.css .live-digit)
const LIVE_GAP = 6;
const LIVE_MAX_SYMBOLS = 6; // bipes mostrados por quadrado; grupo maior e ruido e vazaria do quadrado

/** Decodificacao ao vivo, numa linha so: cada quadrado e um digito (o lido em cima, os bipes ouvidos embaixo). So cabem os mais novos */
function renderRadioLive() {
  const box = $('radio-live');
  const fit = Math.max(1, Math.floor((box.clientWidth + LIVE_GAP) / (LIVE_CELL_W + LIVE_GAP)));
  const digits = radio.decoder ? radio.decoder.live(fit) : [];
  box.replaceChildren();
  if (!digits.length) {
    const empty = document.createElement('div');
    empty.className = 'radio-live-empty';
    empty.textContent = t('radio.live.empty');
    box.appendChild(empty);
    return;
  }
  for (const g of digits) {
    const cell = document.createElement('div');
    cell.className = `live-digit${g.digit === null ? ' unknown' : ''}${g.partial ? ' partial' : ''}`;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = g.digit ?? '–';
    const s = document.createElement('span');
    s.className = 's';
    for (const c of g.symbols.slice(-LIVE_MAX_SYMBOLS)) {
      const el = document.createElement('i');
      el.className = c === '.' ? 'dot' : 'dash';
      s.appendChild(el);
    }
    cell.append(d, s);
    box.appendChild(cell);
  }
}

/** 'sure' = todo digito ouvido duas vezes igual; 1 = codigo inteiro ouvido uma vez; 0 = nada ou so parte */
function radioLevel(r) {
  if (r.sure) return 2;
  return r.code && !r.code.includes('?') ? 1 : 0;
}

/** "Bustanshahr · 150 m NW" (cidade mais proxima, vinda da lista de bunkers) */
function radioPlace(bunker) {
  const near = bunker.near;
  if (!near) return '';
  if (near.m < 150) return near.name;
  const dist = near.m >= 1000 ? `${(near.m / 1000).toFixed(1)} km` : `${near.m} m`;
  return `${near.name} · ${dist} ${near.dir}`;
}

function renderRadioResults(results) {
  const box = $('radio-results');
  const list = results || (radio.decoder ? radio.decoder.results() : []);
  box.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'radio-empty';
    empty.textContent = t('radio.results.empty');
    box.appendChild(empty);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'radio-list';
  for (const r of list) {
    const level = radioLevel(r);
    const item = document.createElement('div');
    item.className = `radio-item${level === 2 ? ' sure' : ''}`;

    const badge = level === 2 ? t('radio.badge.sure', { n: r.heard })
      : level === 1 ? t('radio.badge.once')
        : r.code ? t('radio.badge.part') : t('radio.badge.none');
    const info = document.createElement('div');
    info.className = 'radio-info';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t('radio.grid');
    const grid = document.createElement('span');
    grid.className = 'radio-grid';
    grid.textContent = `${r.grid.slice(0, 3)} ${r.grid.slice(3)}`;
    const place = document.createElement('span');
    place.className = 'radio-place';
    place.textContent = [radioPlace(r.bunker), t('radio.coords', { x: Math.round(r.bunker.x), z: Math.round(r.bunker.z) })]
      .filter(Boolean).join(' · ');
    const status = document.createElement('span');
    status.className = 'radio-badge';
    status.textContent = badge;
    const onMap = document.createElement('button');
    onMap.className = 'btn ghost radio-onmap';
    onMap.title = t('radio.onmap.hint');
    onMap.innerHTML = icon('map');
    onMap.append(t('radio.onmap'));
    onMap.addEventListener('click', () => {
      window.mapView.goTo(r.bunker.x, r.bunker.z);
      showPage('map');
    });
    info.append(label, grid, place, status, onMap);

    const code = document.createElement('div');
    code.className = 'radio-code';
    code.title = t('radio.code');
    for (const digit of (r.code || '????')) {
      const cell = document.createElement('span');
      cell.textContent = digit === '?' ? '–' : digit;
      if (digit === '?') cell.className = 'unknown';
      code.appendChild(cell);
    }
    item.append(info, code);

    const others = r.codes.slice(1).map(([c, n]) => `${c} (${n}x)`).join(', ');
    if (others) {
      const also = document.createElement('div');
      also.className = 'radio-also';
      also.textContent = t('radio.also', { codes: others });
      item.appendChild(also);
    }
    wrap.appendChild(item);
  }
  box.appendChild(wrap);
}

function renderRadio() {
  const on = radioListening();
  const waitingGame = on && radio.mode === 'game' && !radio.pid;
  $('hero-radio').classList.remove('is-on', 'is-ready', 'is-warn', 'is-bad');
  $('radio-meter').classList.toggle('hidden', !on || waitingGame);

  if (radio.error) {
    setHero('radio', 'warn', t('radio.err.title'), t(radio.error.key, radio.error.params));
    setNav('radio', t('radio.err.title'), 'warn');
  } else if (waitingGame) {
    setHero('radio', 'warn', t('radio.waiting'), t('radio.waiting.hint'));
    setNav('radio', t('radio.waiting'), 'warn');
  } else if (on) {
    const hint = radio.mode === 'system' ? 'radio.listening.hint.system' : 'radio.listening.hint';
    setHero('radio', radio.mode === 'system' ? 'warn' : 'on', t('radio.listening'), t(hint));
    setNav('radio', t('radio.listening'), radio.mode === 'system' ? 'warn' : 'on');
  } else {
    setHero('radio', null, t('radio.stopped'), t('radio.stopped.hint'));
    setNav('radio', t('radio.stopped'));
  }
  setButton($('radio-toggle'), on
    ? { text: t('radio.stop'), icon: 'stop', kind: 'danger' }
    : { text: t('radio.start'), icon: 'play' });
  renderRadioResults();
  renderRadioLive();
}

/** Chamada por app.js ao iniciar (so ai $ ja existe) */
function initRadio() {
  $('radio-toggle').addEventListener('click', () => (radioListening() ? radioStop() : radioStart()));
  window.radioAudio.onChunk(({ samples }) => {
    if (radio.active && radio.mode === 'game') radioFeed(samples);
  });
  radioReset();
}
