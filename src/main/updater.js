'use strict';
// Atualizacao pelo GitHub Releases (electron-updater). A cada 2 horas le o latest.yml da ultima Release; se ha versao
// nova, so AVISA. Nada e baixado nem instalado ate o usuario clicar em Atualizar: ai o app baixa (com progresso),
// fecha, instala em silencio e abre de novo ja atualizado. De onde vem a Release esta em package.json (build.publish),
// que o electron-builder grava em resources/app-update.yml.

const { EventEmitter } = require('events');
const { app, shell } = require('electron');
const { autoUpdater, CancellationToken } = require('electron-updater');
const { repository } = require('../../package.json');

const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;
const RETRY_AFTER_OFFLINE_MS = 10 * 60 * 1000;
const STALL_MS = 60 * 1000; // sem nenhum dado por este tempo = conexao travada
const PROGRESS_EVERY_MS = 250; // a barra nao precisa de mais que ~4 atualizacoes por segundo
const RESTART_DELAY_MS = 1200; // deixa a tela mostrar "Instalando" antes de fechar

// O electron-builder tira a chave "build" do package.json empacotado, mas deixa "repository". O scripts/release.js
// confere que ele e o repositorio de build.publish (de onde o electron-updater le as Releases) sao o mesmo.
const RELEASES_URL = `${String(repository).replace(/\.git$/, '')}/releases/latest`;

// ERR_CONTENT_LENGTH_MISMATCH e o que o Chromium diz quando a conexao cai no meio do download (visto nos testes)
const OFFLINE_RE = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY|ERR_SOCKET|ERR_NETWORK_ACCESS_DENIED|ERR_CONTENT_LENGTH_MISMATCH|ERR_EMPTY_RESPONSE|ERR_INCOMPLETE_CHUNKED_ENCODING|ENOTFOUND|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|timed? ?out/i;

/** Tipo do erro, para a tela explicar em portugues claro: offline | server | disk | corrupt | unknown */
function classifyError(err) {
  const text = `${err?.code ?? ''} ${err?.message ?? err ?? ''}`;
  if (/ENOSPC|EDQUOT|no space left/i.test(text)) return 'disk';
  if (/sha512|checksum/i.test(text)) return 'corrupt';
  const status = Number(err?.statusCode);
  if (status === 403 || status === 404 || status === 429 || status >= 500) return 'server'; // GitHub fora, limite de acessos ou arquivo ausente
  if (OFFLINE_RE.test(text)) return 'offline';
  return 'unknown';
}

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle', version: null, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: null };
    this.phase = null; // check | download | install: o mesmo evento 'error' serve aos tres
    this.lastProgressAt = 0;
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
    // Nada de baixar ou instalar por conta propria: so depois do clique em Atualizar
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true; // o instalador e o NSIS completo, nao o "web installer"
    // Sem ouvinte, um 'error' derruba o processo principal. Checagem e download tratam o erro nas proprias promessas;
    // aqui entram so as falhas ao abrir o instalador
    autoUpdater.on('error', (err) => {
      console.warn('[updater]', err?.message ?? err);
      if (this.phase === 'install') this._fail(err);
    });
    autoUpdater.on('download-progress', (p) => this._progress(p));
    this.check();
    setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  /** Sem internet, GitHub fora ou Release ainda inexistente: nao incomoda o usuario, a proxima checagem tenta de novo */
  async check() {
    if (this.phase) return;
    this.phase = 'check';
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return;
      if (result.isUpdateAvailable) this.set({ status: 'available', version: result.updateInfo.version, error: null });
      else this.set({ status: 'none', version: null, error: null });
    } catch (err) {
      console.warn('[updater] checagem falhou:', err?.message ?? err);
      // Quem abre o app antes de a rede subir nao espera 2 h: tenta de novo em alguns minutos (so uma vez pendente)
      if (classifyError(err) === 'offline' && !this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.check();
        }, RETRY_AFTER_OFFLINE_MS);
      }
    } finally {
      this.phase = null;
    }
  }

  /** Clique em Atualizar (ou em Tentar de novo): baixa, e ao terminar fecha, instala em silencio e reabre */
  async download() {
    if (this.phase || !['available', 'error'].includes(this.state.status)) return;
    this.phase = 'download';
    this.lastProgressAt = 0;
    this.stalled = false;
    this.set({ status: 'downloading', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: null });
    this.cancelToken = new CancellationToken();
    this._armWatchdog();
    try {
      await autoUpdater.downloadUpdate(this.cancelToken);
    } catch (err) {
      this._fail(err);
      return;
    } finally {
      clearTimeout(this.watchdog);
    }
    this.phase = 'install';
    this.set({ status: 'installing', percent: 100 });
    // quitAndInstall fecha o app (o will-quit do main solta teclas presas e grava as preferencias), roda o instalador
    // sem janelas (silent) e o instalador abre o app de novo (forceRunAfter)
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(true, true);
      } catch (err) {
        this._fail(err);
      }
    }, RESTART_DELAY_MS);
  }

  /** Com o socket aberto e nenhum byte chegando o download nunca falha sozinho (visto nos testes): este vigia cancela */
  _armWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.stalled = true;
      this.cancelToken?.cancel();
    }, STALL_MS);
  }

  _progress({ percent, transferred, total, bytesPerSecond }) {
    if (this.phase === 'download') this._armWatchdog();
    const now = Date.now();
    if (now - this.lastProgressAt < PROGRESS_EVERY_MS && transferred < total) return;
    this.lastProgressAt = now;
    this.set({ percent, transferred, total, bytesPerSecond });
  }

  _fail(err) {
    this.phase = null;
    console.warn('[updater] falhou:', err?.message ?? err);
    this.set({ status: 'error', error: this.stalled ? 'offline' : classifyError(err) });
    this.stalled = false;
  }

  /** Plano B para quando o download automatico nao funciona: a pagina da ultima Release */
  openReleases() {
    shell.openExternal(RELEASES_URL);
  }
}

module.exports = { Updater, classifyError };
