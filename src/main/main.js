'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session, shell } = require('electron');
const path = require('path');
const { Settings } = require('./settings');
const { I18n } = require('./i18n');
const { Toolkit } = require('./toolkit');
const { Updater } = require('./updater');
const { showToast } = require('./toast');
const { WhatsNew } = require('./whatsnew');
const { Overlay } = require('./overlay');
const { MapView } = require('./mapview');
const { AppAudio } = require('./appaudio');

const TOAST_KIND = { success: 'success', danger: 'danger', info: 'info' };

// Metodos do Toolkit que a interface pode chamar
const TOOLKIT_METHODS = new Set([
  'snapshot', 'listWindows', 'autoSelectTarget', 'setTarget',
  'recordHotkey', 'cancelRecording', 'setHotkey',
  'setAutorunArmed', 'setClickerArmed',
  'setServerConfig', 'startServerMonitor', 'stopServerMonitor',
  'startStatusTracker', 'stopStatusTracker', 'setOverlayConfig',
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let toolkit = null;
  let mapView = null;
  const gameAudio = new AppAudio((samples, sampleRate) => send('radio:audio', { samples, sampleRate }));
  const updater = new Updater();

  // Os switches do Chromium so valem se entrarem antes do ready, por isso a config e lida aqui e nao dentro do whenReady.
  // A composicao por GPU trava o <video> com gravacoes pesadas (ex.: 1080p60): quadros pretos e ~6 fps. Por software fica em 60 fps.
  const settings = new Settings(app.getPath('userData'));
  const gpuCompositingAtLaunch = settings.data.app.gpuCompositing === true;
  if (!gpuCompositingAtLaunch) app.commandLine.appendSwitch('disable-gpu-compositing');

  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const createWindow = () => {
    win = new BrowserWindow({
      width: 1040,
      height: 680,
      minWidth: 920,
      minHeight: 620,
      backgroundColor: '#0b0d12',
      title: 'DayZ Toolkit',
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0b0d12', symbolColor: '#8b95a7', height: 38 },
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.once('ready-to-show', () => win.show());
    // Links externos abrem no navegador, nunca dentro do app
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
  };

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('br.com.kevinmorente.dayztoolkit');
    Menu.setApplicationMenu(null);

    const i18n = new I18n(settings, app.getLocale());
    const whatsNew = new WhatsNew(settings, i18n, app.getVersion());
    toolkit = new Toolkit(settings, i18n);
    const overlay = new Overlay();
    toolkit.on('state', (s) => {
      send('toolkit:state', s);
      overlay.update(s);
    });
    toolkit.on('notify', ({ message, kind, detail, duration }) =>
      showToast({ message, kind: TOAST_KIND[kind] || 'info', detail, duration }));
    toolkit.on('server-online', (info) => {
      send('toolkit:server-online', info);
      showToast({
        message: i18n.t('toast.serverOnline'),
        kind: 'success',
        detail: info ? `${info.name} • ${info.players}/${info.maxPlayers}` : '',
        duration: 8000,
      });
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.flashFrame(true);
      }
    });

    updater.on('state', (s) => send('updater:state', s));

    ipcMain.handle('toolkit:call', (_e, method, ...args) => {
      if (!TOOLKIT_METHODS.has(method)) throw new Error(`Metodo nao permitido: ${method}`);
      return toolkit[method](...args);
    });
    ipcMain.handle('updater:state', () => ({ ...updater.state }));
    ipcMain.handle('updater:download', () => updater.download());
    ipcMain.handle('i18n:get', () => i18n.payload());
    ipcMain.handle('i18n:set', (_e, code) => i18n.set(code));
    ipcMain.handle('whatsnew:get', () => whatsNew.get());
    ipcMain.handle('whatsnew:seen', () => whatsNew.markSeen());
    ipcMain.on('overlay:size', (_e, size) => overlay.onSize(size));
    ipcMain.on('overlay:page', (_e, page) => overlay.setPage(String(page)));
    ipcMain.handle('map:get', () => mapView?.info());
    ipcMain.handle('map:set', (_e, id) => mapView?.setProvider(String(id)));
    ipcMain.on('map:bounds', (_e, bounds) => mapView?.setBounds(bounds));
    ipcMain.on('map:reload', () => mapView?.reload());
    ipcMain.on('map:home', () => mapView?.home());
    ipcMain.on('map:goto', (_e, { x, z }) => {
      if (Number.isFinite(x) && Number.isFinite(z)) mapView?.goTo(x, z);
    });
    ipcMain.on('map:external', () => mapView?.openExternal());
    // Radio dos bunkers: o som vem so do DayZ (pelo processo da janela que o app ja acompanha), nao do PC todo
    ipcMain.handle('radio:start', () => {
      const pid = toolkit.target?.pid;
      return pid ? gameAudio.start(pid) : { ok: false, error: 'nogame' };
    });
    ipcMain.handle('radio:stop', () => gameAudio.stop());
    // Bunker confirmado (codigo ouvido 2x igual): a tela decodifica e o aviso sai por cima do jogo
    ipcMain.on('radio:toast', (_e, { message, detail }) =>
      showToast({ message: String(message), kind: 'success', detail: String(detail || ''), duration: 10000 }));
    // Radio dos bunkers: o som do jogo vem da captura de audio do sistema (loopback do Windows). So o som, sem imagem.
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then(
        (sources) => callback({ video: sources[0], audio: 'loopback' }),
        () => callback(),
      );
    });
    ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
    // Composicao por GPU: enabled = o que esta salvo; needsRestart = difere do que o app usou ao abrir
    const gpuState = () => {
      const enabled = settings.data.app.gpuCompositing === true;
      return { enabled, needsRestart: enabled !== gpuCompositingAtLaunch };
    };
    ipcMain.handle('gpu:get', gpuState);
    ipcMain.handle('gpu:set', (_e, enabled) => {
      settings.data.app.gpuCompositing = enabled === true;
      settings.flush(); // o app pode reiniciar logo em seguida
      return gpuState();
    });
    ipcMain.handle('app:relaunch', () => {
      settings.flush();
      gameAudio.stop();
      toolkit.dispose();
      app.relaunch();
      app.exit(0);
    });

    createWindow();
    mapView = new MapView(win, settings);
    win.on('focus', () => {
      win.flashFrame(false);
      overlay.setFocused(true);
    });
    win.on('blur', () => overlay.setFocused(false));
    win.on('closed', () => overlay.destroy());
    updater.init();
    // O relogio na tela depende do Status ao vivo: voltam a acompanhar o servidor ao abrir o app
    if (settings.data.overlay.enabled) toolkit.startStatusTracker();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    gameAudio.stop();
    if (toolkit) toolkit.dispose();
  });
}
