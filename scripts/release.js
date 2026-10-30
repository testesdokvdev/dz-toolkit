'use strict';
// Gera o instalador e publica como Release no GitHub (os apps instalados recebem o aviso).
// Antes: suba "version" no package.json e escreva as novidades em build/release-notes.md.
//
// Fluxo: confere o login -> confere que a versao ainda nao foi publicada -> gera o
// instalador -> calcula o SHA256 -> pede confirmacao -> cria a Release com UMA chamada
// do gh (nada de enviar varios arquivos pela API em sequencia).
//
//   npm run release              build + confirmacao + publicacao
//   npm run release -- --dry-run build + SHA256, sem publicar
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { cleanDist } = require('./clean-dist');
const changelog = require('./changelog');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const dryRun = process.argv.includes('--dry-run');
const { version } = require(path.join(root, 'package.json'));
const tag = `v${version}`;
const installer = `DayZ-Toolkit-Setup-${version}.exe`;

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', cwd: root, shell: process.platform === 'win32', ...opts });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Pergunta a cada build se roda o VirusTotal agora. Falha ou chave ausente nao interrompem o release.
async function maybeVirusTotal(installerPath) {
  console.log('\nO envio ao VirusTotal deixa o instalador visivel para a comunidade deles.');
  if ((await ask('Rodar o VirusTotal agora? (s/N) ')) !== 's') {
    console.log('VirusTotal pulado. Depois: npm run virustotal (ou envie em https://www.virustotal.com).');
    return;
  }
  if (!process.env.VT_API_KEY) {
    console.log('Falta a chave: defina VT_API_KEY (virustotal.com > perfil > API key) e rode npm run virustotal.');
    return;
  }
  try {
    const result = await require('./virustotal').analyze(installerPath, process.env.VT_API_KEY);
    if (result.flagged > 0) console.log(`ATENCAO: ${result.flagged} antivirus detectaram. Confira o relatorio antes de publicar.`);
  } catch (error) {
    console.log(`VirusTotal falhou: ${error.message}\nO release continua; rode npm run virustotal depois.`);
  }
}

async function main() {
  if (!dryRun) {
    if (run('gh', ['auth', 'status']).status !== 0) fail('Sem login valido no GitHub CLI (gh auth login).');
    if (run('gh', ['release', 'view', tag]).status === 0) {
      fail(`A versao ${tag} ja foi publicada. Suba "version" no package.json.`);
    }
  }

  // Novidades que o app mostra depois de atualizar (vem de build/release-notes*.md)
  try {
    changelog.build();
  } catch (error) {
    fail(error.message);
  }

  cleanDist();
  console.log(`Gerando ${installer}...`);
  const build = run('npx', ['electron-builder', '--win', '--publish', 'never'], { stdio: 'inherit' });
  if (build.status !== 0) fail('O build falhou.');

  const files = [installer, `${installer}.blockmap`, 'latest.yml'].map((f) => path.join(dist, f));
  for (const f of files) if (!fs.existsSync(f)) fail(`Arquivo esperado nao encontrado: ${f}`);

  const hash = sha256(files[0]);
  const sums = path.join(dist, 'SHA256SUMS.txt');
  fs.writeFileSync(sums, `${hash}  ${installer}\n`);
  console.log(`\nSHA256: ${hash}`);

  await maybeVirusTotal(files[0]);

  if (dryRun) {
    console.log('\n--dry-run: nada foi publicado.');
    return;
  }
  if ((await ask(`\nPublicar ${tag} no GitHub? (s/N) `)) !== 's') fail('Cancelado, nada foi publicado.');

  const notesFile = path.join(root, 'build', 'release-notes.md');
  if (!fs.existsSync(notesFile)) fail('Falta build/release-notes.md com as novidades da versao.');
  const publish = run(
    'gh',
    ['release', 'create', tag, ...files, sums, '--title', tag, '--notes-file', notesFile],
    { stdio: 'inherit' },
  );
  process.exit(publish.status ?? 1);
}

main();
