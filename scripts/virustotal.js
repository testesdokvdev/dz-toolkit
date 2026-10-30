'use strict';
// Envia o instalador ao VirusTotal, espera o resultado e gera o selo para colocar no site.
// Precisa de uma chave de API gratuita (virustotal.com > perfil > API key) na variavel VT_API_KEY.
// Tambem e chamado pelo scripts/release.js, que pergunta se voce quer rodar apos gerar o build.
//
//   $env:VT_API_KEY = "sua_chave"       (PowerShell)
//   npm run virustotal                 usa dist/DayZ-Toolkit-Setup-<versao>.exe
//   npm run virustotal -- caminho.exe  usa outro arquivo
//
// Gera em dist/: virustotal.json (dados), virustotal.html (selo para colar na pagina) e virustotal.md.
// ATENCAO: o arquivo enviado fica visivel para a comunidade do VirusTotal.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const { version } = require(path.join(root, 'package.json'));

const API = 'https://www.virustotal.com/api/v3';
const SMALL_LIMIT = 32 * 1024 * 1024; // acima disso o upload usa uma URL especial
const POLL_MS = 20 * 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(key, pathname, options = {}) {
  const res = await fetch(pathname.startsWith('http') ? pathname : API + pathname, {
    ...options,
    headers: { 'x-apikey': key, accept: 'application/json', ...options.headers },
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('Limite da API gratuita atingido (4 por minuto, 500 por dia). Tente mais tarde.');
  if (!res.ok) throw new Error(`VirusTotal respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function upload(key, name, buffer) {
  let url = `${API}/files`;
  if (buffer.length > SMALL_LIMIT) url = (await api(key, '/files/upload_url')).data;
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  const sent = await api(key, url, { method: 'POST', body: form });
  return sent.data.id;
}

async function waitAnalysis(key, id) {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const analysis = await api(key, `/analyses/${id}`);
    if (analysis?.data.attributes.status === 'completed') return;
    process.stdout.write('.');
    await sleep(POLL_MS);
  }
  throw new Error('O VirusTotal demorou demais. Rode de novo: o arquivo ja enviado sera reaproveitado.');
}

function summarize(sha256, stats) {
  const total = stats.malicious + stats.suspicious + stats.undetected + stats.harmless;
  const flagged = stats.malicious + stats.suspicious;
  return { sha256, flagged, total, link: `https://www.virustotal.com/gui/file/${sha256}`, stats };
}

function badgeHtml({ flagged, total, link }) {
  const clean = flagged === 0;
  const color = clean ? '#1a7f37' : '#b35900';
  const text = clean ? `Limpo: 0 de ${total} antivírus detectaram` : `${flagged} de ${total} antivírus detectaram`;
  return (
    `<a href="${link}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-block;padding:8px 14px;border:1px solid ${color};border-radius:8px;` +
    `color:${color};font:600 14px/1.3 system-ui,sans-serif;text-decoration:none">` +
    `${text}<br><span style="font-weight:400;font-size:12px">Ver relatório no VirusTotal (versão ${version})</span></a>\n`
  );
}

/** Analisa o arquivo, grava os arquivos em dist/ e devolve { sha256, flagged, total, link, stats } */
async function analyze(file, key) {
  if (!key) throw new Error('Defina a chave: $env:VT_API_KEY = "sua_chave" (cmd: set VT_API_KEY=sua_chave).');
  if (!fs.existsSync(file)) throw new Error(`Arquivo nao encontrado: ${file}`);

  const buffer = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  console.log(`Arquivo: ${path.basename(file)}\nSHA256:  ${sha256}`);

  let report = await api(key, `/files/${sha256}`);
  if (report?.data.attributes.last_analysis_stats?.undetected !== undefined) {
    console.log('O VirusTotal ja conhece este arquivo, nada foi enviado.');
  } else {
    console.log('Enviando (pode levar alguns minutos)...');
    await waitAnalysis(key, await upload(key, path.basename(file), buffer));
    report = await api(key, `/files/${sha256}`);
    console.log('');
  }

  const result = summarize(sha256, report.data.attributes.last_analysis_stats);
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'virustotal.json'), JSON.stringify({ version, file: path.basename(file), ...result }, null, 2));
  fs.writeFileSync(path.join(dist, 'virustotal.html'), badgeHtml(result));
  fs.writeFileSync(
    path.join(dist, 'virustotal.md'),
    `[VirusTotal: ${result.flagged}/${result.total} detecções (v${version})](${result.link})\n`,
  );

  console.log(`Resultado: ${result.flagged} de ${result.total} detectaram.\nRelatório: ${result.link}`);
  console.log('Gerado em dist/: virustotal.html (cole no site), virustotal.md, virustotal.json');
  return result;
}

module.exports = { analyze };

if (require.main === module) {
  const file = path.resolve(process.argv[2] || path.join(dist, `DayZ-Toolkit-Setup-${version}.exe`));
  analyze(file, process.env.VT_API_KEY).catch((error) => {
    console.error(`Falhou: ${error.message}`);
    process.exit(1);
  });
}
