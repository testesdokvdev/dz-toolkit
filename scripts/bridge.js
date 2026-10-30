'use strict';
// COPIA PONTE para as versoes antigas (2.5.0 e anteriores). Elas so reconhecem versao nova pelo NOME do arquivo no
// Drive (regex /DayZ-Toolkit-Setup-(\d+...).exe/), e o instalador novo se chama DZ-Toolkit-Setup-X.Y.Z.exe. Esta copia
// byte a byte (mesmo SHA256) com o nome antigo vai so para o Drive que o /baixar aponta. NAO sobe na Release do GitHub:
// os assets publicos sao so os DZ-Toolkit-*.
//
// Quando nao houver mais ninguem em versao <= 2.5.0, ponha BRIDGE_ENABLED = false (ou apague este arquivo e as chamadas
// em release.js e no script "dist" do package.json).
//
//   node scripts/bridge.js        (roda sozinho no "npm run dist" e no "npm run release")
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BRIDGE_ENABLED = true;
const dist = path.join(__dirname, '..', 'dist');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Cria dist/DayZ-Toolkit-Setup-<versao>.exe igual ao DZ-Toolkit-Setup-<versao>.exe; devolve { file, sha256 } ou null se desligada */
function makeBridgeCopy(version, dir = dist) {
  if (!BRIDGE_ENABLED) return null;
  const source = path.join(dir, `DZ-Toolkit-Setup-${version}.exe`);
  const target = path.join(dir, `DayZ-Toolkit-Setup-${version}.exe`);
  if (!fs.existsSync(source)) throw new Error(`Nao achei ${source}; gere o instalador antes.`);
  fs.copyFileSync(source, target);
  const [a, b] = [sha256(source), sha256(target)];
  if (a !== b) throw new Error('A copia ponte nao ficou igual ao instalador (SHA256 diferente).');
  return { file: target, sha256: a };
}

module.exports = { makeBridgeCopy };

if (require.main === module) {
  const { version } = require('../package.json');
  try {
    const bridge = makeBridgeCopy(version);
    console.log(bridge
      ? `Copia ponte para o Drive: ${path.relative(path.join(__dirname, '..'), bridge.file)} (SHA256 ${bridge.sha256}, igual ao DZ-Toolkit-Setup-${version}.exe).`
      : 'Copia ponte desligada (BRIDGE_ENABLED = false).');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
