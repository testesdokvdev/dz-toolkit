'use strict';
// Mapa do DZ dentro do app: uma pagina web presa a janela principal, posicionada em cima da area reservada
// pela interface. Ha dois mapas para escolher, o iZurvive e o Nasdara Map. Sao sites de terceiros: so o do mapa
// escolhido carrega aqui (e so quando a aba abre), qualquer outro link abre no navegador. As marcacoes feitas
// em cada mapa ficam no armazenamento do proprio site, numa sessao propria e persistente (partition) que
// sobrevive ao fechar o app.

const { WebContentsView, shell, session } = require('electron');

// Zoom ao ir para um ponto do Radio: o suficiente para ver o bunker e as ruas em volta
const POINT_ZOOM = 7;

const PROVIDERS = {
  izurvive: {
    name: 'iZurvive',
    site: 'izurvive.com',
    home: 'https://www.izurvive.com/',
    partition: 'persist:izurvive',
  },
  nasdara: {
    name: 'Nasdara Map',
    site: 'nasdaramap.com',
    // Direto no mapa: a pagina inicial do site e uma vitrine que oferece o APK para baixar
    home: 'https://nasdaramap.com/map',
    partition: 'persist:nasdaramap',
  },
};
const DEFAULT_PROVIDER = 'izurvive';

// "Ver no mapa" do Radio: as coordenadas dos bunkers sao do iZurvive, entao vai sempre para ele (Nasdara, centrado em
// x = leste e z = norte, em metros do jogo), qualquer que seja o mapa escolhido no seletor
const POINT_PROVIDER = 'izurvive';
const pointUrl = (x, z) => `https://www.izurvive.com/nasdara/#location=${x};${z};${POINT_ZOOM}`;

function isOwn(provider, url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === provider.site || hostname.endsWith(`.${provider.site}`));
  } catch {
    return false;
  }
}

class MapView {
  /** onChange(info): avisa a interface quando o mapa mostrado muda sem o usuario mexer no seletor (Ver no mapa) */
  constructor(win, settings, onChange = () => {}) {
    this.win = win;
    this.settings = settings;
    this.onChange = onChange;
    this.override = null; // mapa mostrado so por ora (Ver no mapa); a escolha salva do seletor nao muda
    this.views = {}; // id do mapa -> view; so nasce quando aquele mapa e mostrado pela primeira vez
    this.pending = {}; // id do mapa -> endereco pedido antes de a view existir
    this.rect = null; // ultima posicao pedida pela interface
    this.visible = false;
    win.on('closed', () => this.destroy());
  }

  get id() {
    if (this.override) return this.override;
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
      this.override = null;
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
    // Alguns sites estranham o "Electron" (e o nome do app, ex.: DZToolkit/2.5.0) no identificador do navegador
    wc.setUserAgent(wc.getUserAgent().replace(/\s(?:Electron|\S*toolkit)\/\S+/gi, ''));

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

  /** Abre o iZurvive centrado em x (leste) e z (norte), em metros do jogo */
  goTo(x, z) {
    const id = POINT_PROVIDER;
    if (this.id !== id) {
      // O seletor guarda a escolha do usuario; aqui o iZurvive so entra no lugar enquanto nao houver nova escolha
      this.override = id;
      this._layout();
      this.onChange(this.info());
    }
    const url = pointUrl(x, z);
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
