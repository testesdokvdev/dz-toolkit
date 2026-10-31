'use strict';
// Relogio do jogo na tela: janela transparente, sempre no topo, que nao pega clique nem foco
// (o DZ continua recebendo o teclado e o mouse). Fica no canto escolhido, em cima do jogo.
//
// Aparece quando o DZ esta em foco. Fora do jogo, so aparece como pre-visualizacao enquanto o Toolkit esta em foco
// na aba "Relogio na tela" (para dar para ajustar a posicao sem abrir o jogo). So funciona com o DZ em janela ou
// janela sem bordas.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const win32 = require('./win32');

// A janela nasce grande (so para o cartao caber e ser medido) e depois encolhe para o tamanho exato do cartao:
// assim nao sobra area transparente, que em alguns casos o Windows desenha como um retangulo preto.
const PROBE = { width: 260, height: 60 };
const DEFAULT_SIZE = { width: 150, height: 34 };
const SIZE_LIMIT = { min: 20, max: 600 };

class Overlay {
  constructor() {
    this.win = null;
    this.snap = null;
    this.focused = false; // a janela do Toolkit esta em foco
    this.page = null; // aba aberta no Toolkit
    this.size = { ...DEFAULT_SIZE }; // tamanho do cartao, medido pela pagina
    this.sized = false; // a janela atual ja informou o tamanho do cartao
    this.loaded = false; // a pagina da janela atual terminou de carregar (so entao ela recebe dados)
    this._boundsKey = '';
    this._payloadKey = '';
    const resync = () => this.sync();
    screen.on('display-added', resync);
    screen.on('display-removed', resync);
    screen.on('display-metrics-changed', resync);
  }

  update(snap) {
    this.snap = snap;
    this.sync();
  }

  /** Pre-visualizacao fora do jogo: so com o Toolkit em foco E na aba do relogio (nas outras abas o relogio so aparece no DZ) */
  get preview() {
    return this.focused && this.page === 'overlay';
  }

  setFocused(on) {
    this.focused = on;
    this.sync();
  }

  setPage(page) {
    this.page = page;
    this.sync();
  }

  /** { time, sample } do que mostrar agora, ou null se nao ha o que mostrar */
  _content() {
    const { status, targetFocused } = this.snap;
    const info = status.phase === 'online' ? status.info : null;
    if (info?.time && (targetFocused || this.preview)) {
      return { time: info.time, sample: false };
    }
    // Sem dados ainda (ou servidor fora do ar), mas o usuario esta ajustando: mostra um exemplo
    if (this.preview) return { time: '16:00', sample: true };
    return null;
  }

  sync() {
    const cfg = this.snap?.overlay;
    const content = cfg?.enabled ? this._content() : null;
    if (!content) {
      // Fecha em vez de esconder: reexibir a mesma janela transparente e um defeito conhecido do Windows/Electron
      this.destroy();
      return;
    }
    const win = this._window();
    this._place(win, cfg);
    this._send(win, { corner: cfg.corner, ...content });
    // So aparece depois que a pagina mediu o cartao e a janela ficou do tamanho dele
    if (this.sized && !win.isVisible()) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.showInactive();
    }
  }

  /** A pagina mediu o cartao: a janela passa a ter exatamente esse tamanho */
  onSize({ width, height } = {}) {
    const ok = (n) => Number.isFinite(n) && n >= SIZE_LIMIT.min && n <= SIZE_LIMIT.max;
    if (!ok(width) || !ok(height)) return;
    if (this.sized && width === this.size.width && height === this.size.height) return;
    this.size = { width: Math.ceil(width), height: Math.ceil(height) };
    this.sized = true;
    this._boundsKey = '';
    if (this.snap) this.sync();
  }

  _window() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      ...PROBE,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'overlay-preload.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.setIgnoreMouseEvents(true);
    win32.makePopup(win.getNativeWindowHandle()); // sem isso o Windows nao deixa a janela ter menos de ~39 px de altura
    win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
    // A pagina so recebe dados depois de carregar: ao terminar, envia o que estava esperando. Nao da para confiar em
    // webContents.isLoading() aqui (ainda pode dizer "carregando" dentro deste evento) nem em outro evento do app para
    // reenviar: com o jogo em foco quase nada muda e o relogio ficaria escondido, esperando.
    win.webContents.on('did-finish-load', () => {
      if (this.win !== win) return;
      this.loaded = true;
      this._payloadKey = '';
      this.sync();
    });
    this.win = win;
    this.loaded = false;
    this.sized = false;
    this._boundsKey = '';
    this._payloadKey = '';
    return win;
  }

  _place(win, { corner, x, y, display }) {
    const screens = screen.getAllDisplays();
    const target = screens.find((d) => d.id === display) || screen.getPrimaryDisplay();
    const b = target.bounds; // a tela inteira: o jogo ocupa tudo, inclusive onde fica a barra de tarefas
    const { width, height } = this.sized ? this.size : PROBE;
    const left = corner.endsWith('l') ? b.x + x : b.x + b.width - width - x;
    const top = corner.startsWith('t') ? b.y + y : b.y + b.height - height - y;
    const key = `${left},${top},${width},${height}`;
    if (key === this._boundsKey) return;
    this._boundsKey = key;
    win.setBounds({ x: Math.round(left), y: Math.round(top), width, height });
  }

  _send(win, payload) {
    const key = JSON.stringify(payload);
    if (key === this._payloadKey || !this.loaded) return;
    this._payloadKey = key;
    win.webContents.send('overlay:data', payload);
  }

  destroy() {
    if (this.win)    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { Overlay };
