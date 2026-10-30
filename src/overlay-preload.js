'use strict';
// Ponte do relogio na tela: so recebe dados do processo principal.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onData: (callback) => ipcRenderer.on('overlay:data', (_e, payload) => callback(payload)),
  // tamanho do cartao, em pixels da pagina: a janela se ajusta a ele
  resize: (width, height) => ipcRenderer.send('overlay:size', { width, height }),
});
