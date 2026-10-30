'use strict';
// Estado e logica de todas as ferramentas. A interface so recebe snapshots do
// estado (evento 'state') e chama os metodos publicos via IPC.

const { EventEmitter } = require('events');
const dns = require('dns').promises;
const { globalShortcut, screen } = require('electron');
const win32 = require('./win32');
const a2s = require('./a2s');
const gameVersion = require('./gameversion');
const { RestartWatcher } = require('./restart');

// Atalho no formato do Electron: modificadores opcionais + uma tecla (ex.: "F7", "Control+Shift+F6")
const ACCELERATOR_RE =
  /^(?:(?:Control|Alt|Shift)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|num[0-9]|numadd|numsub|nummult|numdec|Up|Down|Left|Right|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/;
// Teclas simples (letras, numeros, setas, Espaco, Tab) costumam ter funcao no DayZ. F5-F12, o teclado
// numerico e combinacoes com Ctrl ou Alt em geral ficam livres.
const isRiskyKey = (accelerator) => {
  const parts = accelerator.split('+');
  const key = parts.pop();
  if (parts.includes('Control') || parts.includes('Alt')) return false;
  return /^[A-Z0-9]$/.test(key) || ['Space', 'Tab', 'Backspace', 'Up', 'Down', 'Left', 'Right'].includes(key);
};
// Com o Auto Run o Shift fica preso; para o app "Z" e "Shift+Z" sao a mesma tecla
const keyId = (accelerator) => accelerator.split('+').filter((p) => p !== 'Shift').sort().join('+');
const SHORTCUT_REPEAT_MS = 250; // segurar a tecla repete o atalho; ignora o que vier em seguida
const SERVER_OK_NEEDED = 15; // respostas normais seguidas (1 por segundo) p/ considerar o servidor online de vez
const SERVER_DOWN_NEEDED = 3; // consultas sem resposta seguidas p/ considerar que o servidor saiu do ar
const SERVER_STARTING_MAX_MS = 60 * 1000; // quanto tempo esperar a hora do jogo aparecer nas tags
const OVERLAY_CORNERS = ['tl', 'tr', 'bl', 'br'];
const OVERLAY_OFFSET_LIMIT = 4000; // px; cobre ate monitores 4K
const STATUS_EVERY_MS = 60 * 1000; // intervalo do acompanhamento de status do servidor
const STATUS_FAST_MS = 10 * 1000; // com o relogio na tela ligado, a hora precisa estar fresca
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Toolkit extends EventEmitter {
  constructor(settings, i18n) {
    super();
    this.settings = settings;
    this.i18n = i18n;
    const s = settings.data;

    this.target = null; // { hwnd, title, process }
    this.recording = null; // ferramenta esperando a proxima tecla
    this._registered = []; // atalhos globais ativos agora
    this._lastShortcutAt = 0;

    this.autorun = { armed: false, active: false, keysHeld: false };
    this.clicker = { armed: false, active: false, holding: false };
    this.server = {
      monitoring: false,
      phase: 'idle', // idle | checking | offline | confirming | online
      attempt: 0,
      okStreak: 0,
      queryPort: null,
      info: null,
      run: 0,
    };
    // Acompanhamento de status: consulta o servidor a cada minuto, sem avisar nada
    this.status = {
      tracking: false,
      phase: 'idle', // idle | checking | online | offline
      info: null,
      ping: null,
      queryPort: null,
      updatedAt: null,
      client: null, // { version, relation } do DayZ instalado no PC; relation: same | client-old | server-old
      run: 0,
    };

    this.hotkeys = s.hotkeys;
    // Atalhos de versoes antigas (codigo de tecla, ferramentas removidas) voltam ao padrao ou somem
    for (const feature of Object.keys(this.hotkeys)) {
      const key = this.hotkeys[feature];
      if (!(feature in settings.defaults.hotkeys)) delete this.hotkeys[feature];
      else if (key && !ACCELERATOR_RE.test(key.accelerator || '')) this.hotkeys[feature] = settings.defaults.hotkeys[feature];
    }
    // Duas ferramentas na mesma tecla: so a primeira valeria, a outra ficaria muda
    const kept = [];
    for (const feature of Object.keys(this.hotkeys)) {
      let key = this.hotkeys[feature];
      const taken = (k) => kept.some((id) => id === keyId(k.accelerator));
      if (key && taken(key)) {
        const fallback = settings.defaults.hotkeys[feature];
        key = fallback && !taken(fallback) ? fallback : null;
        this.hotkeys[feature] = key;
      }
      if (key) kept.push(keyId(key.accelerator));
    }

    this._autorunTimer = setInterval(() => this._autorunTick(), 50);
    this._watchTimer = setInterval(() => this._watchTarget(), 200);
    this._lastFocused = false;
    this._nextSearch = 0;
    this._clickerLoop();
  }

  /**
   * Acompanha a janela do jogo: quando ela fecha, solta o alvo; enquanto nao ha
   * alvo, procura o DayZ a cada 2 s (pega sozinho quando o jogo abre ou reabre).
   * Tambem atualiza a interface quando o DayZ ganha/perde o foco.
   */
  _watchTarget() {
    if (this.target && !win32.isWindow(this.target.hwnd)) {
      this.target = null;
      this._nextSearch = 0;
      this.changed();
    }
    if (!this.target && Date.now() >= this._nextSearch) {
      this._nextSearch = Date.now() + 2000;
      this.autoSelectTarget();
    }
    const focused = this.targetFocused();
    if (focused !== this._lastFocused) {
      this._lastFocused = focused;
      this._syncShortcuts();
      this.changed();
    }
  }

  // ------------------------------------------------------------------
  // Estado para a interface
  // ------------------------------------------------------------------

  snapshot() {
    const s = this.settings.data;
    return {
      target: this.target,
      targetFocused: this.target ? win32.isForeground(this.target.hwnd) : false,
      recording: this.recording,
      hotkeys: Object.fromEntries(Object.entries(this.hotkeys)
        .map(([f, k]) => [f, k && { ...k, risky: isRiskyKey(k.accelerator) }])),
      autorun: { armed: this.autorun.armed, active: this.autorun.active },
      clicker: { armed: this.clicker.armed, active: this.clicker.active },
      server: {
        monitoring: this.server.monitoring,
        phase: this.server.phase,
        attempt: this.server.attempt,
        okStreak: this.server.okStreak,
        okNeeded: SERVER_OK_NEEDED,
        foundPort: this.server.queryPort,
        info: this.server.info,
        // { key, params } do texto de erro; a interface traduz no idioma atual
        error: this.server.error || null,
        ...s.server,
      },
      status: {
        tracking: this.status.tracking,
        phase: this.status.phase,
        info: this.status.info,
        ping: this.status.ping,
        foundPort: this.status.queryPort,
        updatedAt: this.status.updatedAt,
        client: this.status.client,
      },
      overlay: {
        ...s.overlay,
        displays: screen.getAllDisplays().map((d) => ({
          id: d.id, width: d.bounds.width, height: d.bounds.height,
          primary: d.id === screen.getPrimaryDisplay().id,
        })),
      },
    };
  }

  changed() {
    this.emit('state', this.snapshot());
  }

  /** extra: { detail, duration } do aviso flutuante */
  notify(message, kind = 'info', extra = {}) {
    this.emit('notify', { message, kind, ...extra });
  }

  // ------------------------------------------------------------------
  // Janela alvo
  // ------------------------------------------------------------------

  /** Janelas que podem ser alvo (as do proprio Toolkit ficam de fora) */
  listWindows() {
    return win32.listWindows().filter((w) => w.pid !== process.pid);
  }

  /**
   * Seleciona a janela do DayZ sozinho se ainda nao houver alvo valido.
   * Procura o executavel do jogo (nao o launcher, que tambem comeca com "DayZ").
   */
  autoSelectTarget() {
    if (this.target && win32.isWindow(this.target.hwnd)) return this.target;
    const windows = this.listWindows();
    const game =
      windows.find((w) => /^dayz_x64\.exe$/i.test(w.process)) ||
      windows.find((w) => /^dayz$/i.test(w.title));
    if (game || this.target) {
      this.target = game || null;
      this.changed();
    }
    return this.target;
  }

  setTarget(hwnd) {
    const found = this.listWindows().find((w) => w.hwnd === hwnd);
    this.target = found || null;
    this.changed();
  }

  targetFocused() {
    return !!this.target && win32.isForeground(this.target.hwnd);
  }

  // ------------------------------------------------------------------
  // Teclas de atalho
  //
  // Sao atalhos globais do Windows (RegisterHotKey), a forma indicada para isso:
  // o app nao escuta o teclado, so e avisado das teclas escolhidas. Ficam
  // registrados apenas com o DayZ em foco e a chave da ferramenta ligada; nesse
  // periodo a tecla escolhida NAO chega ao jogo. Com a ferramenta desligada, ela
  // e toda do jogo. Por isso o usuario deve escolher teclas que o DayZ nao usa.
  // ------------------------------------------------------------------

  _syncShortcuts() {
    for (const accelerator of this._registered) globalShortcut.unregister(accelerator);
    this._registered = [];
    if (this.disposed || this.recording || !this.targetFocused()) return;

    const register = (accelerator, feature) => {
      if (this._registered.includes(accelerator)) return true;
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => this._onShortcut(feature));
      } catch {
        // atalho invalido: tratado como indisponivel
      }
      if (ok) this._registered.push(accelerator);
      return ok;
    };

    const armed = Object.entries(this.hotkeys).filter(([feature, key]) => key && this[feature]?.armed);
    for (const [feature, key] of armed) {
      if (!register(key.accelerator, feature) && !this._warned?.has(key.accelerator)) {
        (this._warned ??= new Set()).add(key.accelerator);
        this.notify(this.i18n.t('toast.keyInUse', { key: key.name }), 'danger');
      }
    }

    // O Auto Run segura o Shift. Com ele preso, apertar F7 chega ao Windows como
    // Shift+F7 e o atalho "F7" nao dispara (nao daria para desligar). Enquanto o
    // Shift esta preso, cada atalho tambem vale com Shift.
    if (this.autorun.keysHeld) {
      for (const [feature, key] of armed) {
        if (!key.accelerator.split('+').includes('Shift')) register(`Shift+${key.accelerator}`, feature);
      }
    }
  }

  _onShortcut(feature) {
    // Segurar a tecla repete o atalho: so vale o primeiro disparo
    const now = Date.now();
    const repeated = now - this._lastShortcutAt < SHORTCUT_REPEAT_MS;
    this._lastShortcutAt = now;
    if (!repeated) this._hotkeyPressed(feature);
  }

  recordHotkey(feature) {
    this.recording = feature;
    this._syncShortcuts();
    this.changed();
  }

  cancelRecording() {
    this.recording = null;
    this._syncShortcuts();
    this.changed();
  }

  /** Outra ferramenta que ja usa essa tecla (com ou sem Shift), ou null */
  _hotkeyOwner(accelerator, except) {
    return Object.keys(this.hotkeys).find((f) => f !== except && this.hotkeys[f]
      && keyId(this.hotkeys[f].accelerator) === keyId(accelerator)) || null;
  }

  /** Recebe o atalho capturado pela interface durante a gravacao */
  setHotkey(accelerator, name) {
    const feature = this.recording;
    if (!feature || !ACCELERATOR_RE.test(accelerator)) return;
    const owner = this._hotkeyOwner(accelerator, feature);
    if (owner) {
      // Continua gravando para a pessoa escolher outra tecla
      this.notify(this.i18n.t('toast.keyTaken', { key: name, feature: this.i18n.t(`nav.${owner}`) }), 'danger');
      return;
    }
    this.recording = null;
    this.hotkeys[feature] = { accelerator, name: String(name).slice(0, 40) };
    this._warned?.delete(accelerator);
    this.settings.save();
    this._syncShortcuts();
    this.changed();
    if (isRiskyKey(accelerator)) {
      this.notify(this.i18n.t('toast.keyRisky', { key: name }), 'info');
    }
  }

  _hotkeyPressed(feature) {
    // Atalhos so valem com o DayZ em foco (evita disparar digitando em outro lugar)
    if (!this.targetFocused()) return;
    if (feature === 'autorun' && this.autorun.armed) this.setAutorunActive(!this.autorun.active);
    else if (feature === 'clicker' && this.clicker.armed) this.setClickerActive(!this.clicker.active);
  }

  // ------------------------------------------------------------------
  // Auto Run: segura Shift+W enquanto ativo e o DayZ em foco
  // ------------------------------------------------------------------

  setAutorunArmed(armed) {
    this.autorun.armed = armed;
    if (!armed) this.autorun.active = false;
    this._syncShortcuts();
    this.changed();
  }

  setAutorunActive(active) {
    this.autorun.active = active;
    this.notify(this.i18n.t(active ? 'toast.autorun.on' : 'toast.autorun.off'), active ? 'success' : 'danger');
    this.changed();
  }

  _autorunTick() {
    try {
      const shouldHold = this.autorun.active && this.targetFocused();
      if (shouldHold && !this.autorun.keysHeld) {
        win32.keyDown('shift');
        win32.keyDown('w');
        this.autorun.keysHeld = true;
        this._syncShortcuts();
      } else if (!shouldHold && this.autorun.keysHeld) {
        win32.keyUp('w');
        win32.keyUp('shift');
        this.autorun.keysHeld = false;
        this._syncShortcuts();
      }
    } catch {
      // segue tentando no proximo tick
    }
  }

  // ------------------------------------------------------------------
  // Cliques Automaticos: segura o botao direito e clica o esquerdo repetidamente
  // ------------------------------------------------------------------

  setClickerArmed(armed) {
    this.clicker.armed = armed;
    if (!armed) this.clicker.active = false;
    this._syncShortcuts();
    this.changed();
  }

  setClickerActive(active) {
    this.clicker.active = active;
    this.notify(this.i18n.t(active ? 'toast.clicker.on' : 'toast.clicker.off'), active ? 'success' : 'danger');
    this.changed();
  }

  async _clickerLoop() {
    while (!this.disposed) {
      try {
        if (this.clicker.active && this.targetFocused()) {
          if (!this.clicker.holding) {
            win32.mouse('rightDown');
            this.clicker.holding = true;
          }
          win32.mouse('leftDown');
          await sleep(50);
          win32.mouse('leftUp');
          await sleep(150);
          continue;
        }
        if (this.clicker.holding) {
          win32.mouse('rightUp');
          this.clicker.holding = false;
        }
      } catch {
        // segue tentando
      }
      await sleep(50);
    }
  }

  // ------------------------------------------------------------------
  // Monitor de servidor
  // ------------------------------------------------------------------

  setServerConfig(cfg) {
    const s = this.settings.data.server;
    this.server.error = null; // o erro era do endereco anterior; so volta se a proxima tentativa falhar
    if (typeof cfg.host === 'string') s.host = cfg.host.trim();
    if ('port' in cfg) s.port = cfg.port;
    if ('queryPort' in cfg) s.queryPort = cfg.queryPort;
    if (Number.isFinite(cfg.volume)) s.volume = Math.min(100, Math.max(0, Math.round(cfg.volume)));
    this.settings.save();
    this.changed();
  }

  /** Relogio na tela: so aceita valores validos. Ao ligar, comeca a acompanhar o servidor (e de la que vem a hora). */
  setOverlayConfig(cfg) {
    const o = this.settings.data.overlay;
    const offset = (n) => Number.isFinite(n) && Math.abs(n) <= OVERLAY_OFFSET_LIMIT;
    if (typeof cfg.enabled === 'boolean') o.enabled = cfg.enabled;
    if (OVERLAY_CORNERS.includes(cfg.corner)) o.corner = cfg.corner;
    if (offset(cfg.x)) o.x = Math.round(cfg.x);
    if (offset(cfg.y)) o.y = Math.round(cfg.y);
    if ('display' in cfg) o.display = Number.isInteger(cfg.display) ? cfg.display : null;
    this.settings.save();
    this.changed();
    if (o.enabled) this.startStatusTracker();
  }

  /** { host, port, queryPort } validos, ou null (e o erro fica em server.error) */
  _serverConfig() {
    const { host, port, queryPort } = this.settings.data.server;
    const valid = (p) => Number.isInteger(p) && p > 0 && p < 65536;
    this.server.error = null;
    if (!host || !valid(port) || (queryPort != null && !valid(queryPort))) {
      this.server.error = { key: 'err.server.invalid' };
      this.changed();
      return null;
    }
    return { host, port, queryPort };
  }

  /** IPv4 do endereco, ou null (e o erro fica em server.error) */
  async _resolveServer(host) {
    try {
      return (await dns.lookup(host, { family: 4 })).address;
    } catch {
      this.server.error = { key: 'err.server.dns', params: { host } };
      return null;
    }
  }

  /** Guarda o que este servidor ja mostrou funcionando (aberto, com hora do jogo) e devolve o registro */
  _learn({ host, port }, info) {
    const all = this.settings.data.server.learned;
    const entry = (all[`${host}:${port}`] ??= { open: false, time: false });
    const before = JSON.stringify(entry);
    if (!info.locked) entry.open = true;
    if (info.time) entry.time = true;
    if (JSON.stringify(entry) !== before) this.settings.save();
    return entry;
  }

  async startServerMonitor() {
    if (this.server.monitoring) return;
    const cfg = this._serverConfig();
    if (!cfg) return;
    const { host, port, queryPort } = cfg;

    const run = ++this.server.run;
    Object.assign(this.server, {
      monitoring: true, phase: 'checking', attempt: 0, okStreak: 0, queryPort: null, info: null,
    });
    this.changed();

    const ip = await this._resolveServer(host);
    if (this.server.run !== run) return;
    if (!ip) {
      this.server.monitoring = false;
      this.server.phase = 'idle';
      this.changed();
      return;
    }

    const ports = a2s.candidatePorts(port, queryPort);
    const watcher = new RestartWatcher({
      confirmNeeded: SERVER_OK_NEEDED, downNeeded: SERVER_DOWN_NEEDED, startingMaxMs: SERVER_STARTING_MAX_MS,
    });
    let known = null;
    while (this.server.run === run && !this.disposed) {
      const started = Date.now();
      this.server.attempt++;
      // Porta de consulta informada a mao: confia nela sem conferir a porta do jogo
      const result = await a2s.queryServer(ip, known ? [known] : ports, { gamePort: queryPort ? null : port });
      if (this.server.run !== run) return;

      let info = null;
      if (result) {
        known = result.port;
        info = result.info;
        this.server.queryPort = result.port;
        this.server.info = info;
      } else {
        known = null; // se o servidor voltar, procura a porta de novo
      }
      const done = watcher.feed(info, info ? this._learn(cfg, info) : null);
      this.server.phase = watcher.phase;
      this.server.okStreak = watcher.okStreak;
      if (done) {
        this.server.monitoring = false;
        this.changed();
        this.emit('server-online', this.server.info);
        return;
      }
      this.changed();
      await sleep(Math.max(0, 1000 - (Date.now() - started)));
    }
  }

  stopServerMonitor() {
    this.server.run++;
    this.server.monitoring = false;
    this.server.phase = 'idle';
    this.changed();
  }

  // ------------------------------------------------------------------
  // Status do servidor: consulta a cada minuto (hora do jogo, fila, jogadores, versao, ping)
  // ------------------------------------------------------------------

  async startStatusTracker() {
    if (this.status.tracking) return;
    const cfg = this._serverConfig();
    if (!cfg) return;

    const run = ++this.status.run;
    Object.assign(this.status, {
      tracking: true, phase: 'checking', info: null, ping: null, queryPort: null, updatedAt: null, client: null,
    });
    gameVersion.forget();
    this.changed();

    const ip = await this._resolveServer(cfg.host);
    if (this.status.run !== run) return;
    if (!ip) {
      Object.assign(this.status, { tracking: false, phase: 'idle' });
      this.changed();
      return;
    }

    const ports = a2s.candidatePorts(cfg.port, cfg.queryPort);
    let known = null;
    while (this.status.run === run && !this.disposed) {
      const started = Date.now();
      const result = await a2s.queryServer(ip, known ? [known] : ports, {
        gamePort: cfg.queryPort ? null : cfg.port,
        timeoutMs: 3000,
      });
      if (this.status.run !== run) return;

      if (result) {
        known = result.port;
        this._learn(cfg, result.info);
        const version = await gameVersion.clientVersion();
        if (this.status.run !== run) return;
        Object.assign(this.status, {
          phase: 'online', info: result.info, ping: result.ping, queryPort: result.port, updatedAt: Date.now(),
          client: version && { version, relation: gameVersion.compareVersions(version, result.info.version) },
        });
      } else {
        known = null; // se o servidor voltar, procura a porta de novo
        Object.assign(this.status, { phase: 'offline', info: null, ping: null, updatedAt: Date.now() });
      }
      this.changed();
      // Espera o intervalo atual; confere de meio em meio segundo porque ele muda quando se liga o relogio
      while (this.status.run === run && !this.disposed && Date.now() - started < this._statusEvery()) await sleep(500);
    }
  }

  /** De quanto em quanto tempo consultar: mais rapido quando o relogio na tela depende da hora */
  _statusEvery() {
    const s = this.settings.data;
    return s.overlay.enabled ? STATUS_FAST_MS : STATUS_EVERY_MS;
  }

  stopStatusTracker() {
    this.status.run++;
    Object.assign(this.status, { tracking: false, phase: 'idle', info: null, ping: null, updatedAt: null, client: null });
    this.changed();
  }

  // ------------------------------------------------------------------
  // Encerramento: nunca deixar tecla ou botao do mouse preso
  // ------------------------------------------------------------------

  dispose() {
    this.disposed = true;
    this.autorun.active = false;
    this.clicker.active = false;
    this.server.run++;
    this.status.run++;
    clearInterval(this._autorunTimer);
    clearInterval(this._watchTimer);
    try {
      if (this.autorun.keysHeld) {
        win32.keyUp('w');
        win32.keyUp('shift');
      }
      if (this.clicker.holding) win32.mouse('rightUp');
    } catch {
      // melhor esforco
    }
    this._syncShortcuts();
    this.settings.flush();
  }
}

module.exports = { Toolkit };
