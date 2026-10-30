'use strict';
// Ponte segura entre a interface e o processo principal.

const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  const listener = (_e, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('toolkit', {
  call: (method, ...args) => ipcRenderer.invoke('toolkit:call', method, ...args),
  onState: subscribe('toolkit:state'),
  onServerOnline: subscribe('toolkit:server-online'),
});

contextBridge.exposeInMainWorld('updater', {
  state: () => ipcRenderer.invoke('updater:state'),
  download: () => ipcRenderer.invoke('updater:download'),
  openReleases: () => ipcRenderer.invoke('updater:releases'),
  onState: subscribe('updater:state'),
});

contextBridge.exposeInMainWorld('appLanguage', {
  get: () => ipcRenderer.invoke('i18n:get'),
  set: (code) => ipcRenderer.invoke('i18n:set', code),
});

// Configuracoes do app que so valem depois de reiniciar (composicao de video por GPU)
contextBridge.exposeInMainWorld('appSettings', {
  getGpu: () => ipcRenderer.invoke('gpu:get'),
  setGpu: (enabled) => ipcRenderer.invoke('gpu:set', enabled),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
});

contextBridge.exposeInMainWorld('whatsNew', {
  get: () => ipcRenderer.invoke('whatsnew:get'),
  markSeen: () => ipcRenderer.invoke('whatsnew:seen'),
});

// Mapa (iZurvive ou Nasdara Map): a interface so informa onde ele deve ficar, qual mapa mostrar e pede recarregar/voltar/abrir no navegador
contextBridge.exposeInMainWorld('mapView', {
  get: () => ipcRenderer.invoke('map:get'),
  set: (id) => ipcRenderer.invoke('map:set', id),
  setBounds: (bounds) => ipcRenderer.send('map:bounds', bounds),
  reload: () => ipcRenderer.send('map:reload'),
  home: () => ipcRenderer.send('map:home'),
  goTo: (x, z) => ipcRenderer.send('map:goto', { x, z }),
  openExternal: () => ipcRenderer.send('map:external'),
});

// Radio dos bunkers: audio do DayZ vindo do processo principal, em blocos
contextBridge.exposeInMainWorld('radioAudio', {
  start: () => ipcRenderer.invoke('radio:start'),
  stop: () => ipcRenderer.invoke('radio:stop'),
  onChunk: subscribe('radio:audio'),
  toast: (message, detail) => ipcRenderer.send('radio:toast', { message, detail }),
});

// Aba aberta na interface: o relogio na tela so aparece fora do jogo (pre-visualizacao) na aba do relogio
contextBridge.exposeInMainWorld('overlayPage', { set: (page) => ipcRenderer.send('overlay:page', page) });

contextBridge.exposeInMainWorld('appInfo', () => ipcRenderer.invoke('app:info'));
