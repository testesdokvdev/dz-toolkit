'use strict';
// Gera o instalador e publica como Release no GitHub. Os apps instalados leem o latest.yml dessa Release
// (electron-updater) e oferecem a atualizacao automatica.
// Antes: rode "npm run bump" e escreva as novidades em build/release-notes.md e build/release-notes.en.md.
//
// VIRUSTOTAL: depois de publicar, todo release passa por um scan OBRIGATORIO (consulta o hash; so envia se for novo),
// imprime o resultado e grava dist/virustotal.json para atualizar o selo do site. Com falha, expiracao ou deteccao o script
// sai com erro e o selo do site NAO pode ser atualizado com "Limpo". Exige VT_API_KEY (conferida antes de publicar).
//
// Fluxo: confere o login -> confere que a versao ainda nao foi publicada -> gera o instalador -> confere o
// latest.yml (versao, nome, tamanho e hash batem com o instalador) -> calcula o SHA256 -> pede confirmacao ->
// cria a Release com UMA chamada do gh: instalador + .blockmap + latest.yml (+ alias + SHA256SUMS.txt).
// Com arquivos anexados o gh cria a Release como rascunho, envia tudo e so entao publica; por isso o app nunca
// ve o latest.yml sem o instalador ao lado. O repositorio e o MESMO de build.publish (package.json), que o app
// usa para procurar atualizacoes, qualquer que seja o "origin" do git.
//
// ALIAS: alem do instalador versionado, a Release leva DZ-Toolkit-Setup.exe, copia byte a byte (mesmo SHA256) com nome
// FIXO. E o que o site (/download -> 302 -> /releases/latest/download/DZ-Toolkit-Setup.exe) entrega a quem baixa pela
// primeira vez. Ele e criado DEPOIS da conferencia do latest.yml e nunca aparece nele: o atualizador so le o asset
// versionado. Depois de publicar, o script confere que o link "latest" responde e tem o tamanho do instalador.
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
const { makeBridgeCopy } = require('./bridge');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const dryRun = process.argv.includes('--dry-run');
const pkg = require(path.join(root, 'package.json'));
const { version } = pkg;
const tag = `v${version}`;
const installer = `DZ-Toolkit-Setup-${version}.exe`;
const aliasName = 'DZ-Toolkit-Setup.exe'; // nome fixo: o link /releases/latest/download/<nome> so funciona com ele
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
const bar = '='.repeat(78);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Copia o instalador para o nome fixo e confere que ficou identica (mesmo SHA256). Devolve o caminho do alias. */
function makeAlias(installerFile) {
  const target = path.join(dist, aliasName);
  fs.copyFileSync(installerFile, target);
  if (sha256(installerFile) !== sha256(target)) fail('O alias nao ficou igual ao instalador (SHA256 diferente).');
  return target;
}

/** Depois de publicar: o link "latest" do site tem de entregar o instalador desta versao. Pede so o 1o byte (GET com Range;
 *  o link assinado do GitHub nao aceita HEAD) e segue os redirecionamentos. Nao muda o resultado do release: ja foi publicado. */
async function checkLatestLink(expectedSize) {
  const url = `https://github.com/${repo}/releases/latest/download/${aliasName}`;
  console.log(`
Conferindo o link do site: ${url}`);
  let problem = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
      await res.body?.cancel();
      const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? res.headers.get('content-length'));
      if (res.status !== 200 && res.status !== 206) problem = `respondeu HTTP ${res.status}`;
      else if (total !== expectedSize) problem = `tamanho ${total} difere do instalador (${expectedSize}); o "latest" ainda nao e esta versao?`;
      else {
        console.log(`Link conferido: HTTP ${res.status}, ${total} bytes, igual ao ${installer}.`);
        return true;
      }
    } catch (error) {
      problem = error.message;
    }
    if (attempt < 4) await sleep(5000); // o GitHub leva alguns segundos para refletir a Release nova
  }
  console.log(`ATENCAO: o link do site nao confere (${problem}). A Release ja foi publicada; abra o link no navegador e confira.`);
  return false;
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

/** Grava dist/virustotal.json com status "failed" para o handoff nao ficar com um resultado de outra versao */
function writeVtFailure(sha, message) {
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(
    path.join(dist, 'virustotal.json'),
    JSON.stringify({ status: 'failed', version, sha256: sha, error: message, generatedAt: new Date().toISOString() }, null, 2),
  );
}

/** Passo OBRIGATORIO depois de publicar: o instalador (mesmo hash do alias) tem de estar no VirusTotal, com o resultado
 *  impresso e gravado em dist/virustotal.json para atualizar o selo do site. So envia se o hash ainda nao existir. Sai com
 *  erro se o scan falhar, expirar ou houver deteccao: nesse caso o selo do site NAO pode dizer "Limpo". */
async function virusTotalStep(installerFile, hash) {
  console.log('\nVirusTotal: consultando o hash e, se ele ainda nao existir, enviando o instalador (fica visivel para a comunidade deles)...');
  let result;
  try {
    result = await require('./virustotal').analyze(installerFile, process.env.VT_API_KEY);
  } catch (error) {
    writeVtFailure(hash, error.message);
    console.error(`
${bar}
VIRUSTOTAL FALHOU: ${error.message}
A Release ${tag} JA FOI PUBLICADA, mas NAO ha scan do VirusTotal desta versao.
NAO atualize o selo do site com "Limpo": sem scan real, o selo deve ser REMOVIDO.
Rode "npm run virustotal" (reaproveita o arquivo ja enviado) e so atualize o site se o resultado sair limpo.
${bar}`);
    process.exit(3);
  }
  const { labelOf } = require('./virustotal');
  const label = labelOf(result);
  console.log(`
${bar}
VIRUSTOTAL: RESULTADO DO SCAN`);
  console.log(`Versao:    ${version}
SHA256:    ${result.sha256}
Link:      ${result.link}`);
  console.log(`Resultado: ${label}
Data scan: ${result.scanDate ?? 'desconhecida'}
JSON:      dist/virustotal.json (handoff para o site)`);
  if (result.flagged > 0) {
    console.error(`
ATENCAO: ${result.flagged} detecao(oes) (malicious+suspicious). NAO atualize o selo do site com "Limpo".
Investigue o relatorio acima antes de qualquer divulgacao; o JSON esta com status "flagged".
${bar}`);
    process.exit(2);
  }
  console.log(`
>>> PROXIMO PASSO OBRIGATORIO: atualizar o selo do site (Criador de Sites) com estes numeros reais: ${label} (versao ${version}).
${bar}`);
}

async function main() {
  if (!dryRun) {
    if (run('gh', ['auth', 'status']).status !== 0) fail('Sem login valido no GitHub CLI (gh auth login).');
    // O scan do VirusTotal e obrigatorio depois de publicar: sem a chave o release nem comeca
    if (!process.env.VT_API_KEY) fail('Falta a chave do VirusTotal: defina VT_API_KEY (virustotal.com > perfil > API key). O scan e obrigatorio em todo release.');
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

  // Alias de nome fixo para o site. Criado so agora, depois da conferencia do latest.yml, que nao o conhece.
  const aliasFile = makeAlias(files[0]);
  const hash = sha256(files[0]);
  const sums = path.join(dist, 'SHA256SUMS.txt');
  fs.writeFileSync(sums, `${hash}  ${installerName}\n${hash}  ${aliasName}\n`);
  console.log(`\nSHA256: ${hash}`);
  console.log(`Alias para o site: ${aliasName} (mesmo SHA256 do ${installerName}; fora do latest.yml).`);

  // Copia ponte (nome antigo) das versoes <= 2.5.0: DESATIVADA desde 03/11/2026 (BRIDGE_ENABLED = false em scripts/bridge.js),
  // porque o endereco antigo do site saiu do ar. Se for religada, fica FORA da lista de assets da Release.
  try {
    const bridge = makeBridgeCopy(version);
    console.log(bridge
      ? `Copia ponte: ${path.basename(bridge.file)} (mesmo SHA256; NAO vai para a Release do GitHub).`
      : 'Copia ponte desativada (BRIDGE_ENABLED = false em scripts/bridge.js): nada gerado para o Drive.');
  } catch (error) {
    fail(error.message);
  }

  const notesFile = path.join(root, 'build', 'release-notes.md');
  if (!fs.existsSync(notesFile)) fail('Falta build/release-notes.md com as novidades da versao.');
  const assets = [...files, aliasFile, sums];
  const createArgs = ['release', 'create', tag, ...assets, '--repo', repo, '--title', tag, '--notes-file', notesFile];
  if (dryRun) {
    console.log(`\n--dry-run: nada foi publicado. Seria uma chamada so: gh release create ${tag} (${assets.map((f) => path.basename(f)).join(', ')}) em ${repo}.
Depois de publicar o script conferiria o link https://github.com/${repo}/releases/latest/download/${aliasName} (tamanho = ${fs.statSync(files[0]).size} bytes).
Em seguida faria o passo OBRIGATORIO do VirusTotal (SEM executar nada agora: nenhuma chamada ao VirusTotal, nem de leitura, e nenhum upload):
  - consultar o hash ${hash} e so enviar o instalador se ele ainda nao existir;
  - esperar a analise (ate 15 min) e imprimir versao, SHA256, link, "Limpo: X de Y", data do scan e o aviso de atualizar o selo do site (Criador de Sites);
  - gravar dist/virustotal.json; sair com erro se o scan falhar/expirar ou houver deteccao.
VT_API_KEY: ${process.env.VT_API_KEY ? 'presente no ambiente' : 'AUSENTE (o release de verdade nao comecaria)'}.`);
    return;
  }
  const warnings = gitWarnings();
  if (warnings.length) console.log(`\nATENCAO: ${warnings.join('; ')}.`);
  if ((await ask(`\nPublicar ${tag} em ${repo}? (s/N) `)) !== 's') fail('Cancelado, nada foi publicado.');

  const publish = run('gh', createArgs, { stdio: 'inherit' });
  if (publish.status !== 0) process.exit(publish.status ?? 1);
  await checkLatestLink(fs.statSync(files[0]).size);
  await virusTotalStep(files[0], hash);
}

main();
