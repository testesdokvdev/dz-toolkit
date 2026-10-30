'use strict';
// Gera src/changelog.json (as novidades que o app mostra depois de atualizar) a partir das notas da versao:
//   build/release-notes.md     português (tambem e o texto da Release no GitHub)
//   build/release-notes.en.md  inglês
// Cada linha que comeca com "- " vira um item. Roda sozinho no "npm run release" e no "npm run dist".
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SOURCES = { 'pt-BR': 'release-notes.md', en: 'release-notes.en.md' };

function readItems(file) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'build', file), 'utf8');
  } catch {
    throw new Error(`Falta build/${file} com as novidades da versao.`);
  }
  const items = text.split(/\r?\n/).filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim());
  if (!items.length) throw new Error(`build/${file} nao tem nenhum item (linhas que comecam com "- ").`);
  return items;
}

function build() {
  const { version } = require(path.join(root, 'package.json'));
  const notes = Object.fromEntries(Object.entries(SOURCES).map(([language, file]) => [language, readItems(file)]));
  fs.writeFileSync(path.join(root, 'src', 'changelog.json'), `${JSON.stringify({ version, notes }, null, 2)}\n`);
  return { version, notes };
}

module.exports = { build };

if (require.main === module) {
  try {
    const { version, notes } = build();
    console.log(`src/changelog.json gerado para a v${version} (${notes['pt-BR'].length} itens em pt-BR, ${notes.en.length} em en).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
