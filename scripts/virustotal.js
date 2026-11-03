'use strict';
// Envia o instalador ao VirusTotal, espera o resultado e gera o selo para colocar no site.
// Precisa de uma chave de API gratuita (virustotal.com > perfil > API key) na variavel VT_API_KEY.
// E chamado pelo scripts/release.js DEPOIS de publicar a Release (passo obrigatorio de todo release).
//
//   $env:VT_API_KEY = "sua_chave"       (PowerShell)
//   npm run virustotal                 usa dist/DZ-Toolkit-Setup-<versao>.exe
//   npm run virustotal -- caminho.exe  usa outro arquivo
//   npm run virustotal -- --lookup <sha256>   SO LEITURA: consulta um hash ja conhecido, sem enviar nada nem gravar arquivos
//
// Gera em dist/: virustotal.json (dados para o site), virustotal.html (selo) e virustotal.md.
// So consulta antes: o arquivo so e enviado se o hash ainda nao existir no VirusTotal.
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

// Criterio unico (selo do site e release.js): total = malicious+suspicious+undetected+harmless; detectaram = malicious+suspicious
function summarize(sha256, stats) {
  const total = stats.malicious + stats.suspicious + stats.undetected + stats.harmless;
  const flagged = stats.malicious + stats.suspicious;
  return { sha256, flagged, total, link: `https://www.virustotal.com/gui/file/${sha256}`, stats };
}

/** Texto do selo: "Limpo: 0 de 66 antivírus detectaram" ou "2 de 66 antivírus detectaram" */
function labelOf({ flagged, total }) {
  return flagged === 0 ? `Limpo: 0 de ${total} antivírus detectaram` : `${flagged} de ${total} antivírus detectaram`;
}

/** Consulta so leitura: devolve o relatorio se o VirusTotal ja analisou o hash, ou null (404 ou ainda sem estatisticas) */
async function lookup(key, sha256) {
  if (!key) throw new Error('Defina a chave: $env:VT_API_KEY = "sua_chave" (cmd: set VT_API_KEY=sua_chave).');
  const report = await api(key, `/files/${sha256}`);
  return report?.data.attributes.last_analysis_stats?.undetected !== undefined ? report : null;
}

/** Resultado completo de um relatorio: contas + data da ultima analise (ISO) */
function fromReport(sha256, report) {
  const attrs = report.data.attributes;
  const epoch = attrs.last_analysis_date;
  return { ...summarize(sha256, attrs.last_analysis_stats), scanDate: epoch ? new Date(epoch * 1000).toISOString() : null };
}

function badgeHtml({ flagged, total, link }) {
  const color = flagged === 0 ? '#1a7f37' : '#b35900';
  const text = labelOf({ flagged, total });
  return (
    `<a href="${link}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-block;padding:8px 14px;border:1px solid ${color};border-radius:8px;` +
    `color:${color};font:600 14px/1.3 system-ui,sans-serif;text-decoration:none">` +
    `${text}<br><span style="font-weight:400;font-size:12px">Ver relatório no VirusTotal (versão ${version})</span></a>\n`
  );
}

/** Analisa o arquivo, grava os arquivos em dist/ e devolve { sha256, flagged, total, link, stats, scanDate, uploaded } */
async function analyze(file, key) {
  if (!key) throw new Error('Defina a chave: $env:VT_API_KEY = "sua_chave" (cmd: set VT_API_KEY=sua_chave).');
  if (!fs.existsSync(file)) throw new Error(`Arquivo nao encontrado: ${file}`);

  const buffer = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  console.log(`Arquivo: ${path.basename(file)}
SHA256:  ${sha256}`);

  let report = await lookup(key, sha256);
  const uploaded = !report;
  if (report) {
    console.log('O VirusTotal ja conhece este arquivo, nada foi enviado.');
  } else {
    console.log('Hash ainda desconhecido: enviando (pode levar alguns minutos)...');
    await waitAnalysis(key, await upload(key, path.basename(file), buffer));
    report = await lookup(key, sha256);
    if (!report) throw new Error('O VirusTotal terminou a analise mas ainda nao devolveu o relatorio. Rode de novo: o arquivo ja enviado sera reaproveitado.');
    console.log('');
  }

  const result = { ...fromReport(sha256, report), uploaded };
  const data = {
    status: result.flagged === 0 ? 'clean' : 'flagged',
    version,
    file: path.basename(file),
    sha256,
    link: result.link,
    flagged: result.flagged,
    total: result.total,
    label: labelOf(result),
    scanDate: result.scanDate,
    uploaded,
    stats: result.stats,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'virustotal.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(dist, 'virustotal.html'), badgeHtml(result));
  fs.writeFileSync(
    path.join(dist, 'virustotal.md'),
    `[VirusTotal: ${result.flagged}/${result.total} detecções (v${version})](${result.link})
`,
  );

  console.log(`Resultado: ${result.flagged} de ${result.total} detectaram.
Relatório: ${result.link}`);
  console.log('Gerado em dist/: virustotal.json (dados para o site), virustotal.html (selo), virustotal.md');
  return result;
}

module.exports = { analyze, lookup, fromReport, labelOf, summarize };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--lookup') {
    // So leitura: nada e enviado nem gravado
    const sha256 = String(process.argv[3] ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      console.error('Uso: npm run virustotal -- --lookup <sha256 com 64 caracteres hex>');
      process.exit(1);
    }
    lookup(process.env.VT_API_KEY, sha256)
      .then((report) => {
        if (!report) return console.log(`O VirusTotal nao conhece ${sha256}.`);
        const r = fromReport(sha256, report);
        console.log(JSON.stringify({ sha256, flagged: r.flagged, total: r.total, label: labelOf(r), scanDate: r.scanDate, link: r.link, stats: r.stats }, null, 2));
      })
      .catch((error) => {
        console.error(`Falhou: ${error.message}`);
        process.exit(1);
      });
  } else {
    const file = path.resolve(arg || path.join(dist, `DZ-Toolkit-Setup-${version}.exe`));
    analyze(file, process.env.VT_API_KEY).catch((error) => {
      console.error(`Falhou: ${error.message}`);
      process.exit(1);
    });
  }
}
