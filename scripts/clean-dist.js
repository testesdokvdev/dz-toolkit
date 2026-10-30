'use strict';
// Apaga a pasta dist/ antes de gerar o instalador, para ficar so a versao mais recente.
// dist/ e saida de build (fica fora do git), entao nao ha nada a perder ali.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');

function cleanDist() {
  try {
    fs.rmSync(dist, { recursive: true, force: true });
  } catch (err) {
    console.error(`Nao consegui limpar dist/ (${err.code}). Feche o DZ Toolkit se ele estiver aberto a partir de dist/ e tente de novo.`);
    process.exit(1);
  }
}

module.exports = { cleanDist };

if (require.main === module) cleanDist();
