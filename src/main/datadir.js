'use strict';
// Pasta de dados do app (settings.json, perfis dos mapas com as marcacoes, cache do Chromium).
// O Electron a deriva do productName do package.json. Ao renomear o app (DayZ Toolkit -> DZ Toolkit) ela mudaria e
// quem ja usa perderia as preferencias e as marcacoes dos mapas. Por isso quem ja tem a pasta antiga continua nela;
// instalacoes novas usam o nome novo.

const fs = require('fs');
const path = require('path');

const LEGACY_DIR = 'DayZ Toolkit';
const CURRENT_DIR = 'DZ Toolkit';

/** Pasta de dados a usar dentro de appData; `exists` existe so para testar sem tocar no disco */
function resolveUserDataDir(appData, exists = fs.existsSync) {
  const legacy = path.join(appData, LEGACY_DIR);
  return exists(legacy) ? legacy : path.join(appData, CURRENT_DIR);
}

/** Tem de rodar antes de qualquer uso da pasta (trava de instancia unica, Settings) e antes do evento ready */
function pinUserDataDir(app) {
  // --user-data-dir (usado em testes) manda mais que a regra acima
  if (app.commandLine.hasSwitch('user-data-dir')) return;
  app.setPath('userData', resolveUserDataDir(app.getPath('appData')));
}

module.exports = { resolveUserDataDir, pinUserDataDir, LEGACY_DIR, CURRENT_DIR };
