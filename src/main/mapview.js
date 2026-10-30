'use strict';
// Mapa do DayZ dentro do app: uma pagina web presa a janela principal, posicionada em cima da area reservada
// pela interface. Ha dois mapas para escolher, o iZurvive e o Nasdara Map. Sao sites de terceiros: so o do mapa
// escolhido carrega aqui (e so quando a aba abre), qualquer outro link abre no navegador. As marcacoes feitas
// em cada mapa ficam no armazenamento do proprio site, numa sessao propria e persistente (partition) que
// sobrevive ao fechar o app.

const { WebContentsView, shell, session } = require('electron');

// Zoom ao ir para um ponto: o suficiente para ver o bunker e as ruas em volta
const POINT_ZOOM = 7;

const PROVIDERS = {
  izurvive: {
    name: 'iZurvive',
    site: 'izurvive.com',
    home: 'https://www.izurvive.com/',
    partition: 'persist:izurvive',
    // Mapa da Nasdara (Badlands) centrado em x (leste) e z (norte), em metros do jogo
    point: (x, z) => `https://www.izurvive.com/nasdara/#location=${x};${z};${POINT_ZOOM}`,
  },
  nasdara: {
    name: 'Nasdara Map',
    site: 'nasdaramap.com',
    // Direto no mapa: a pagina inicial do site e uma vitrine que oferece o APK para baixar
    home: 'https://nasdaramap.com/map',
    partition: 'persist:nasdaramap',
    // Mesmo formato que o proprio site grava no endereco: #mapa/leste/norte/zoom. Sem o marcador (/nome): com ele a pagina do site trava
    point: (x, z) => `https://nasdaramap.com/map#nasdara/${Math.round(x)}/${Math.round(z)}/${POINT_ZOOM}`,
  },
};
const DEFAULT_PROVIDER = 'izurvive';

function isOwn(provider, url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === provider.site || hostname.endsWith(`.${provider.site}`));
  } catch {
    return false;
  }
}

class MapView {
  constructor(win, settings) {
    this.win = win;
    this.settings = settings;
    this.views = {}; // id do mapa -> view; so nasce quando aquele mapa e mostrado pela primeira vez
    this.pending = {}; // id do mapa -> endereco pedido antes de a view existir
    this.rect = null; // ultima posicao pedida pela interface
    this.visible = false;
    win.on('closed', () => this.destroy());
  }

  get id() {
    const saved = this.settings.data.app.mapProvider;
    return PROVIDERS[saved] ? saved : DEFAULT_PROVIDER;
  }

  /** Mapa escolhido e a lista de mapas, para a interface desenhar o seletor */
  info() {
    return {
      provider: this.id,
      providers: Object.entries(PROVIDERS).map(([id, { name, site }]) => ({ id, name, site })),
    };
  }

  setProvider(id) {
    if (PROVIDERS[id]) {
      this.settings.data.app.mapProvider = id;
      this.settings.save();
      this._layout();
    }
    return this.info();
  }

  /** So carrega o site na primeira vez que o mapa dele e mostrado (nada de rede antes disso) */
  _ensure(id) {
    if (this.views[id]) return this.views[id];
    const provider = PROVIDERS[id];
    const ses = session.fromPartition(provider.partition);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    // Arquivos gerados pelo proprio mapa (blob:/data:, como exportar marcacoes) baixam normalmente; arquivos do servidor, como o APK da vitrine, nao
    ses.on('will-download', (e, item) => {
      if (/^https?:/i.test(item.getURL())) e.preventDefault();
    });

    const view = new WebContentsView({
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const wc = view.webContents;
    // Alguns sites estranham o "Electron" no identificador do navegador
    wc.setUserAgent(wc.getUserAgent().replace(/\s(?:Electron|dayz-toolkit)\/\S+/gi, ''));

    const external = (url) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    };
    wc.setWindowOpenHandler(({ url }) => {
      if (isOwn(provider, url)) wc.loadURL(url);
      else external(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (isOwn(provider, url)) return;
      e.preventDefault();
      external(url);
    });

    view.setVisible(false);
    this.win.contentView.addChildView(view);
    // Se alguem pediu um ponto antes de o mapa abrir, ele ja nasce nele
    wc.loadURL(this.pending[id] || provider.home);
    delete this.pending[id];
    this.views[id] = view;
    return view;
  }

  /** Mostra so a view do mapa escolhido, na posicao pedida, e esconde as outras */
  _layout() {
    const active = this.id;
    for (const [id, view] of Object.entries(this.views)) {
      if (id !== active || !this.visible) view.setVisible(false);
    }
    if (!this.visible || !this.rect) return;
    const view = this._ensure(active);
    view.setBounds(this.rect);
    view.setVisible(true);
  }

  /** Posicao (em pixels da area da janela) e visibilidade; some quando outra tela ou um aviso esta por cima */
  setBounds({ x, y, width, height, visible }) {
    this.visible = !!visible;
    if (visible) {
      this.rect = { x: Math.round(x), y: Math.round(y), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
    }
    this._layout();
  }

  /** Abre o mapa escolhido centrado em x (leste) e z (norte), em metros do jogo */
  goTo(x, z) {
    const id = this.id;
    const url = PROVIDERS[id].point(x, z);
    const view = this.views[id];
    if (!view) {
      // Ainda nao abriu: a view e criada ja com o tamanho certo quando a pagina do mapa aparecer, e carrega neste ponto
      this.pending[id] = url;
      return;
    }
    // Os sites so leem a localizacao ao carregar: com ele ja aberto, mudar so o final do endereco nao move o mapa
    const wc = view.webContents;
    wc.loadURL(url).catch(() => {}).finally(() => {
      if (!wc.isDestroyed()) wc.reload();
    });
  }

  reload() {
    this.views[this.id]?.webContents.reloadIgnoringCache();
  }

  home() {
    this.views[this.id]?.webContents.loadURL(PROVIDERS[this.id].home);
  }

  openExternal() {
    shell.openExternal(PROVIDERS[this.id].home);
  }

  destroy() {
    for (const view of Object.values(this.views)) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.views = {};
  }
}

module.exports = { MapView };
