'use strict';
// Sobe a versao (package.json + package-lock.json + src/changelog.json) de acordo com o tipo de mudanca.
// A conta parte SEMPRE da versao do ultimo commit (HEAD), nao da que esta no disco. Por isso rodar de novo
// nao sobe duas vezes: o resultado e o mesmo, e uma versao subida errada e corrigida.
//
//   npm run bump                 decide sozinho: minor se ha texto de interface novo ou arquivo novo em src/,
//                                senao patch (correcao, ajuste, texto)
//   npm run bump -- minor        forca o tipo (patch | minor | major); major so quando voce pedir
//   npm run bump -- --dry-run    mostra a versao e o motivo, sem gravar nada
//
// Convencao: patch = correcao ou ajuste sem recurso novo; minor = recurso novo para o usuario;
// major = quebra de compatibilidade (ex.: settings.json antigo deixa de funcionar).
// Depois de subir, escreva as novidades em build/release-notes.md e build/release-notes.en.md.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicit = args.find((a) => ['patch', 'minor', 'major'].includes(a));

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
const git = (...a) => run('git', a);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const unknown = args.filter((a) => a !== '--dry-run' && a !== explicit);
if (unknown.length) fail(`Argumento desconhecido: ${unknown.join(' ')}\nUso: npm run bump [-- patch|minor|major] [--dry-run]`);

const headPackage = git('show', 'HEAD:package.json');
if (headPackage.status !== 0) fail('Nao consegui ler o package.json do ultimo commit (git show HEAD:package.json).');
const base = JSON.parse(headPackage.stdout).version;
const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

// Chaves de texto da interface que existem agora e nao existiam no ultimo commit
function newLocaleKeys() {
  const old = git('show', 'HEAD:src/locales/pt-BR.json');
  if (old.status !== 0) return [];
  const before = new Set(flatten(JSON.parse(old.stdout)));
  const now = flatten(JSON.parse(fs.readFileSync(path.join(root, 'src', 'locales', 'pt-BR.json'), 'utf8')));
  return now.filter((k) => !before.has(k));
}

// Arquivos de codigo novos (nao rastreados ou adicionados) em src/, fora de assets e do changelog gerado
function newSourceFiles() {
  const status = git('status', '--porcelain', '--untracked-files=all', '--', 'src');
  return status.stdout
    .split(/\r?\n/)
    .filter((l) => /^(\?\?|A)/.test(l))
    .map((l) => l.slice(3).trim().replace(/\\/g, '/'))
    .filter((f) => !f.startsWith('src/assets/') && f !== 'src/changelog.json');
}

let level;
let reason;
if (explicit) {
  level = explicit;
  reason = 'tipo informado na linha de comando';
} else {
  const keys = newLocaleKeys();
  const files = newSourceFiles();
  if (keys.length || files.length) {
    level = 'minor';
    reason = [keys.length && `${keys.length} texto(s) novo(s) de interface (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''})`, files.length && `arquivo(s) novo(s): ${files.join(', ')}`]
      .filter(Boolean)
      .join('; ');
  } else {
    level = 'patch';
    reason = 'nenhum texto de interface nem arquivo novo em src/ desde o ultimo commit: correcao ou ajuste';
  }
}

const [major, minor, patch] = base.split('.').map(Number);
const next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[level];

console.log(`Ultimo commit: ${base} | no disco: ${current}`);
console.log(`Tipo: ${level} (${reason})`);
console.log(`Nova versao: ${next}${current === next ? ' (ja esta assim)' : ''}`);
if (!explicit && level === 'patch') console.log('Se isso trouxe um recurso novo para o usuario, rode: npm run bump -- minor');

if (dryRun) process.exit(0);

if (current !== next) {
  const result = run('npm', ['version', next, '--no-git-tag-version', '--allow-same-version']);
  if (result.status !== 0) fail(`npm version falhou:\n${result.stderr || result.stdout}`);
}
const log = run('node', [path.join('scripts', 'changelog.js')]);
if (log.status !== 0) fail(`changelog.js falhou:\n${log.stderr || log.stdout}`);
console.log(log.stdout.trim());

const notesChanged = git('diff', '--quiet', 'HEAD', '--', 'build/release-notes.md', 'build/release-notes.en.md').status !== 0;
if (!notesChanged) console.log('ATENCAO: build/release-notes.md e .en.md ainda sao os da versao anterior. Escreva as novidades de agora.');
