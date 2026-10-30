'use strict';
// Verifica se ha versao nova consultando a pagina de download. Ela redireciona para o Google Drive,
// e o nome do instalador (DayZ-Toolkit-Setup-X.Y.Z.exe) traz a versao publicada.
// So avisa; o usuario baixa e executa o novo instalador por conta propria.

const { EventEmitter } = require('events');
const { app, shell } = require('electron');

const DOWNLOAD_URL = 'https://dayz-toolkit.netlify.app/baixar';
const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;
const TIMEOUT_MS = 20 * 1000;
const NAME_RE = /DayZ-Toolkit-Setup-(\d+(?:\.\d+){1,3})\.exe/i;

/** Extrai a versao do nome do instalador; null se nao encontrar */
function parseVersion(text) {
  const match = NAME_RE.exec(String(text || ''));
  return match ? match[1] : null;
}

/** "diferente" de verdade: 2.1 e 2.1.0 sao a mesma versao */
function sameVersion(a, b) {
  const parts = (v) => String(v).split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return false;
  }
  return true;
}

/** Le a versao publicada: pela pagina de aviso do Drive ou, se o arquivo vier direto, pelo cabecalho */
async function fetchPublishedVersion() {
  const res = await fetch(DOWNLOAD_URL, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;

  const fromHeader = parseVersion(res.headers.get('content-disposition'));
  const type = res.headers.get('content-type') || '';
  if (fromHeader || !type.includes('text/html')) {
    // Arquivo de ~100 MB: so o cabecalho interessa, o corpo nao deve ser baixado
    await res.body?.cancel().catch(() => {});
    return fromHeader;
  }
  return parseVersion(await res.text());
}

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle', version: null };
    this.checking = false;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  init() {
    // Rodando pelo codigo fonte nao ha o que atualizar
    if (!app.isPackaged) {
      this.set({ status: 'dev' });
      return;
    }
    this.check();
    setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  async check() {
    if (this.checking) return;
    this.checking = true;
    try {
      const published = await fetchPublishedVersion();
      // Sem internet ou pagina fora do padrao: nao incomoda o usuario
      if (!published) return;
      if (sameVersion(published, app.getVersion())) this.set({ status: 'none', version: null });
      else this.set({ status: 'available', version: published });
    } catch {
      // idem: a proxima verificacao tenta de novo
    } finally {
      this.checking = false;
    }
  }

  /** Abre o download no navegador (o Drive pede confirmacao ali) */
  download() {
    if (this.state.status === 'available') shell.openExternal(DOWNLOAD_URL);
  }
}

module.exports = { Updater, parseVersion, sameVersion };
