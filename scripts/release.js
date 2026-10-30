'use strict';
// Gera o instalador e publica como Release no GitHub. Os apps instalados leem o latest.yml dessa Release
// (electron-updater) e oferecem a atualizacao automatica.
// Antes: rode "npm run bump" e escreva as novidades em build/release-notes.md e build/release-notes.en.md.
//
// Fluxo: confere o login -> confere que a versao ainda nao foi publicada -> gera o instalador -> confere o
// latest.yml (versao, nome, tamanho e hash batem com o instalador) -> calcula o SHA256 -> pede confirmacao ->
// cria a Release com UMA chamada do gh: instalador + .blockmap + latest.yml (+ SHA256SUMS.txt).
// Com arquivos anexados o gh cria a Release como rascunho, envia tudo e so entao publica; por isso o app nunca
// ve o latest.yml sem o instalador ao lado. O repositorio e o MESMO de build.publish (package.json), que o app
// usa para procurar atualizacoes, qualquer que seja o "origin" do git.
//
//   npm run release              build + confirmacao + publicacao
//   npm run release -- --dry-run build + conferencias + SHA256, sem publicar
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
const pkg = require(path.join(root, 'package.json'));
const { version } = pkg;
const tag = `v${version}`;
const installer = `DayZ-Toolkit-Setup-${version}.exe`;
const feed = pkg.build.publish.find((p) => p.provider === 'github');
const repo = `${feed.owner}/${feed.repo}`;
// O app abre "repository"/releases/latest como plano B do download manual (a chave "build" nao vai no app empacotado)
if (String(pkg.repository).replace(/\.git$/, '') !== `https://github.com/${repo}`) {
  console.error(`"repository" do package.json (${pkg.repository}) difere de build.publish (${repo}). Deixe os dois iguais.`);
  process.exit(1);
}

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
const sha512Base64 = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');

/** O latest.yml e o que o app le primeiro: se nao bater com o instalador, a atualizacao falha para todo mundo. Devolve o nome do instalador. */
function checkLatestYml(latestFile) {
  const text = fs.readFileSync(latestFile, 'utf8');
  const field = (key) => new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1].replace(/^['"]|['"]$/g, '');
  const size = /^\s+size:\s*(\d+)/m.exec(text)?.[1];
  const [ymlVersion, ymlPath, ymlHash] = [field('version'), field('path'), field('sha512')];
  if (ymlVersion !== version) fail(`latest.yml diz versao ${ymlVersion}, mas o package.json diz ${version}.`);
  if (!ymlPath || /\s/.test(ymlPath)) fail(`Nome do instalador no latest.yml invalido (${ymlPath}); nao pode ter espacos.`);
  const installerFile = path.join(dist, ymlPath);
  if (!fs.existsSync(installerFile)) fail(`O latest.yml aponta para ${ymlPath}, que nao esta em dist/.`);
  if (!fs.existsSync(`${installerFile}.blockmap`)) fail(`Falta ${ymlPath}.blockmap em dist/ (o app o procura ao lado do instalador).`);
  if (size && Number(size) !== fs.statSync(installerFile).size) fail('O tamanho do instalador nao bate com o latest.yml.');
  if (ymlHash !== sha512Base64(installerFile)) fail('O sha512 do instalador nao bate com o latest.yml.');
  return ymlPath;
}

/** Avisos (nao bloqueiam): a tag da Release nasce do que ja esta no GitHub, nao do que so esta no seu computador */
function gitWarnings() {
  const warnings = [];
  if (run('git', ['status', '--porcelain']).stdout.trim()) warnings.push('ha mudancas nao commitadas');
  const ahead = run('git', ['rev-list', '--count', '@{u}..HEAD']);
  if (ahead.status !== 0) warnings.push('a branch atual nao tem upstream no GitHub (ainda nao deu push?)');
  else if (Number(ahead.stdout) > 0) warnings.push(`${ahead.stdout.trim()} commit(s) ainda nao enviado(s) ao GitHub (git push)`);
  return warnings;
}

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
    if (run('gh', ['release', 'view', tag, '--repo', repo]).status === 0) {
      fail(`A versao ${tag} ja foi publicada em ${repo}. Suba "version" (npm run bump).`);
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

  // Os nomes dos arquivos vem do latest.yml: sao eles que o app vai pedir ao GitHub
  const installerName = checkLatestYml(path.join(dist, 'latest.yml'));
  if (installerName !== installer) fail(`O build gerou ${installerName}, esperava ${installer}.`);
  const files = [installerName, `${installerName}.blockmap`, 'latest.yml'].map((f) => path.join(dist, f));
  console.log(`latest.yml conferido: ${installerName} (versao, tamanho e sha512 batem).`);

  const hash = sha256(files[0]);
  const sums = path.join(dist, 'SHA256SUMS.txt');
  fs.writeFileSync(sums, `${hash}  ${installerName}\n`);
  console.log(`\nSHA256: ${hash}`);

  await maybeVirusTotal(files[0]);

  const notesFile = path.join(root, 'build', 'release-notes.md');
  if (!fs.existsSync(notesFile)) fail('Falta build/release-notes.md com as novidades da versao.');
  const createArgs = ['release', 'create', tag, ...files, sums, '--repo', repo, '--title', tag, '--notes-file', notesFile];
  if (dryRun) {
    console.log(`\n--dry-run: nada foi publicado. Seria uma chamada so: gh release create ${tag} (${[...files, sums].map((f) => path.basename(f)).join(', ')}) em ${repo}.`);
    return;
  }
  const warnings = gitWarnings();
  if (warnings.length) console.log(`\nATENCAO: ${warnings.join('; ')}.`);
  if ((await ask(`\nPublicar ${tag} em ${repo}? (s/N) `)) !== 's') fail('Cancelado, nada foi publicado.');

  const publish = run('gh', createArgs, { stdio: 'inherit' });
  process.exit(publish.status ?? 1);
}

main();
