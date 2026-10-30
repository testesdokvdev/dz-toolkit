'use strict';
// Gera src/assets/icon.png (512x512) a partir do SVG abaixo. Uso: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f2634"/><stop offset="1" stop-color="#0b0d12"/>
    </linearGradient>
    <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#f2542d"/>
    </linearGradient>
    <linearGradient id="core" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff0b3"/><stop offset="1" stop-color="#ffc247"/>
    </linearGradient>
    <linearGradient id="log" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a98259"/><stop offset="1" stop-color="#6b4f33"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.62" r="0.5">
      <stop offset="0" stop-color="#f2542d" stop-opacity="0.35"/><stop offset="1" stop-color="#f2542d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)" stroke="#2f3646" stroke-width="6"/>
  <clipPath id="clip"><rect x="16" y="16" width="480" height="480" rx="112"/></clipPath>
  <circle cx="256" cy="300" r="230" fill="url(#glow)" clip-path="url(#clip)"/>
  <!-- Fogueira: chama sobre dois troncos cruzados -->
  <path fill="url(#flame)" d="M256 70C268 134 346 164 346 262C346 326 308 366 256 366C204 366 166 326 166 262C166 212 196 186 212 140C224 170 234 178 244 178C252 146 246 108 256 70Z"/>
  <path fill="url(#core)" d="M256 196C266 232 304 250 304 296C304 330 284 350 256 350C228 350 208 330 208 296C208 266 230 252 238 226C246 240 252 236 256 196Z"/>
  <g fill="url(#log)" stroke="#3d2c1c" stroke-width="5">
    <rect x="116" y="366" width="280" height="44" rx="22" transform="rotate(-14 256 388)"/>
    <rect x="116" y="366" width="280" height="44" rx="22" transform="rotate(14 256 388)"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'src', 'assets', 'icon.png');
  fs.writeFileSync(out, image.resize({ width: 512, height: 512 }).toPNG());
  console.log('icone gerado:', out, image.getSize());
  app.quit();
});
