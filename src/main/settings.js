'use strict';
// Preferencias do usuario salvas em JSON na pasta de dados do app.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  hotkeys: {
    autorun: { accelerator: 'F7', name: 'F7' },
    clicker: { accelerator: 'F8', name: 'F8' },
  },
  // learned: o que o app ja viu cada servidor fazer funcionando ("host:porta" -> { open, time }); ver restart.js
  server: { host: '', port: 2302, queryPort: null, volume: 70, learned: {} },
  // overlay: relogio do jogo na tela. corner: tl | tr | bl | br; x e y = distancia da borda do canto (px); display: id do monitor ou null = principal
  overlay: { enabled: false, corner: 'tr', x: 20, y: 20, display: null },
  // language: null = ainda nao escolheu (segue o idioma do Windows). seenVersion: ultima versao cujas novidades foram mostradas
  // gpuCompositing: composicao de video do Chromium pela GPU. Desligada (padrao) o app inicia com --disable-gpu-compositing; vale so apos reiniciar
  // mapProvider: mapa da aba Mapa (izurvive | nasdara); ver mapview.js
  app: { language: null, seenVersion: null, gpuCompositing: false, mapProvider: 'izurvive' },
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.defaults = DEFAULTS;
    this.data = structuredClone(DEFAULTS);
    this.existed = false; // false = primeira execucao (instalacao nova)
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.existed = true;
      for (const key of Object.keys(DEFAULTS)) {
        if (saved[key] && typeof saved[key] === 'object') {
          this.data[key] = { ...DEFAULTS[key], ...saved[key] };
        }
      }
    } catch {
      // primeira execucao ou arquivo invalido: fica com os padroes
    }
    this._timer = null;
  }

  /** Grava com um pequeno atraso para juntar varias mudancas seguidas */
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      // sem permissao de escrita: segue sem salvar
    }
  }
}

module.exports = { Settings };
