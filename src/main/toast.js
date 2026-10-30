'use strict';
// Aviso flutuante no canto superior direito, sem roubar o foco do DayZ.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const WIDTH = 320;
const HEIGHT = 76;
let current = null;

function showToast({ message, kind = 'info', detail = '', duration = 2200 }) {
  if (current && !current.isDestroyed()) current.destroy();

  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: workArea.x + workArea.width - WIDTH - 20,
    y: workArea.y + 20,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  current = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'toast.html'), {
    query: { message, kind, detail },
  });
  win.once('ready-to-show', () => win.showInactive());
  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, duration);
}

module.exports = { showToast };
