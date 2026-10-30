'use strict';
// Interface: recebe snapshots do processo principal e redesenha.
// Toda a logica (teclas, mouse, rede) fica no processo principal.

const $ = (id) => document.getElementById(id);
const call = (method, ...args) => window.toolkit.call(method, ...args);

let state = null;
let updateState = null;
let updateShownFor = null; // estado ('available' ou 'error') pelo qual a janela de atualizacao ja abriu sozinha
let whatsNewData = null; // { version, notes, auto } ou null se esta versao nao tem novidades escritas

// ---------------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------------

// --- Mapa: pagina web presa a janela, por cima do espaco #map-host ---
function syncMap() {
  const rect = $('map-host').getBoundingClientRect();
  const modalOpen = !!document.querySelector('.modal-backdrop:not(.hidden)'); // a pagina do mapa cobriria o aviso
  window.mapView.setBounds({
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    visible: $('page-map').classList.contains('active') && !modalOpen && rect.width > 0 && rect.height > 0,
  });
}

function showPage(page) {
  for (const item of document.querySelectorAll('.nav-item')) {
    item.classList.toggle('active', item.dataset.page === page);
  }
  for (const section of document.querySelectorAll('.page')) {
    section.classList.toggle('active', section.id === `page-${page}`);
  }
  localStorage.setItem('page', page);
  window.overlayPage.set(page);
  syncMap();
  setTimeout(syncMap, 220); // a pagina aparece com uma animacao curta; confere a posicao quando ela termina
}

$('nav').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (item) showPage(item.dataset.page);
});

// ---------------------------------------------------------------------
// Som de aviso (um bipe)
// ---------------------------------------------------------------------

let audioCtx = null;
function beep(volume) {
  if (!volume) return;
  audioCtx = audioCtx || new AudioContext();
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const level = (volume / 100) * 0.6;
  osc.type = 'sine';
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + 0.01);
  gain.gain.setValueAtTime(level, t + 0.29);
  gain.gain.linearRampToValueAtTime(0, t + 0.3);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}

// ---------------------------------------------------------------------
// Helpers de renderizacao
// ---------------------------------------------------------------------

function setHero(id, tone, status, hint) {
  const hero = $(`hero-${id}`);
  hero.classList.remove('is-on', 'is-ready', 'is-warn', 'is-bad');
  if (tone) hero.classList.add(`is-${tone}`);
  hero.querySelector('.hero-icon').classList.toggle('pulse', tone === 'on' || tone === 'warn');
  $(`${id}-status`).textContent = status;
  $(`${id}-hint`).textContent = hint;
}

function setNav(id, sub, dot) {
  $(`nav-sub-${id}`).textContent = sub;
  const el = $(`nav-dot-${id}`);
  el.className = 'nav-dot' + (dot ? ` ${dot}` : '');
}

function setButton(btn, { text, icon: iconName, kind = 'primary', disabled = false }) {
  btn.className = `btn ${kind} big`;
  btn.disabled = disabled;
  btn.innerHTML = `${iconName ? icon(iconName) : ''}<span></span>`;
  btn.querySelector('span').textContent = text;
}

/** So atualiza o campo se o usuario nao estiver digitando nele */
function setInput(input, value) {
  if (document.activeElement !== input) input.value = value ?? '';
}

const keyName = (feature) => state.hotkeys[feature]?.name;

// ---------------------------------------------------------------------
// Renderizacao
// ---------------------------------------------------------------------

function renderTarget() {
  const dot = $('target-dot');
  if (!state.target) {
    dot.className = 'status-dot warn searching';
    $('target-name').textContent = t('target.searching');
    $('target-name').title = '';
    $('target-state').textContent = t('target.waiting');
    return;
  }
  $('target-name').textContent = state.target.title;
  $('target-name').title = `${state.target.process} — ${state.target.title}`;
  dot.className = 'status-dot ' + (state.targetFocused ? 'ok' : 'idle');
  $('target-state').textContent = t(state.targetFocused ? 'target.focused' : 'target.background');
}

function renderHotkeys() {
  for (const box of document.querySelectorAll('.hotkey')) {
    const feature = box.dataset.feature;
    const key = state.hotkeys[feature];
    const recording = state.recording === feature;
    let cap;
    let actions;
    if (recording) {
      cap = '<div class="keycap recording"></div>';
      actions = '<button class="btn ghost" data-action="cancel"></button>';
    } else {
      cap = '<div class="keycap"></div>';
      actions = `<button class="btn" data-action="record">${icon('keyboard')}<span></span></button>`;
    }
    const warn = key?.risky && !recording
      ? '<div class="hotkey-warn"></div>'
      : '';
    const html = `${cap}<div class="hotkey-actions">${actions}</div>${warn}`;
    const cacheKey = `${i18n.language}|${html}|${key?.name || ''}`;
    if (box.dataset.html !== cacheKey) {
      box.innerHTML = html;
      if (recording) {
        box.querySelector('.keycap').textContent = t('hotkey.recording');
        box.querySelector('[data-action="cancel"]').textContent = t('hotkey.cancel');
      } else {
        const keycap = box.querySelector('.keycap');
        keycap.textContent = key ? key.name : t('hotkey.none');
        keycap.classList.toggle('empty', !key);
        box.querySelector('[data-action="record"] span').textContent = t(key ? 'hotkey.change' : 'hotkey.record');
      }
      if (warn) box.querySelector('.hotkey-warn').textContent = t('hotkey.warn', { key: key.name });
      box.dataset.html = cacheKey;
    }
  }
}

function renderToggleTool(id) {
  const tool = state[id];
  const key = keyName(id);
  $(`${id}-armed`).checked = tool.armed;

  if (!tool.armed) {
    setHero(id, null, t('state.off'), t('tool.off.hint'));
    setNav(id, t('state.off'));
  } else if (!key) {
    setHero(id, 'warn', t('tool.noKey'), t('tool.noKey.hint'));
    setNav(id, t('tool.noKey'), 'warn');
  } else if (!tool.active) {
    setHero(id, 'ready', t('tool.ready'), t(`${id}.ready`, { key }));
    setNav(id, t('tool.ready.nav', { key }), 'on');
  } else if (state.targetFocused) {
    setHero(id, 'on', t(`${id}.doing`), t(`${id}.active`, { key }));
    setNav(id, t(`${id}.doing`), 'on');
  } else {
    setHero(id, 'warn', t('tool.paused'), t('tool.paused.hint'));
    setNav(id, t('tool.paused'), 'warn');
  }
}

function renderServer() {
  const sv = state.server;
  const confirm = $('server-confirm');
  confirm.classList.toggle('hidden', sv.phase !== 'confirming');

  switch (sv.phase) {
    case 'checking':
      setHero('server', 'warn', t('server.checking'), t('server.checking.hint', { host: sv.host, port: sv.port }));
      setNav('server', t('server.checking.nav'), 'warn');
      break;
    case 'offline':
      setHero('server', 'bad', t('server.offline'), t('server.offline.hint', { attempt: sv.attempt }));
      setNav('server', t('server.offline.nav', { attempt: sv.attempt }), 'warn');
      break;
    case 'confirming':
      setHero('server', 'warn', t('server.confirming'), t('server.confirming.hint', { done: sv.okStreak, needed: sv.okNeeded }));
      confirm.innerHTML = `<span style="width: ${(sv.okStreak / sv.okNeeded) * 100}%"></span>`;
      setNav('server', t('server.confirming.nav'), 'warn');
      break;
    case 'waiting':
      setHero('server', 'ready', t('server.waiting'), t('server.waiting.hint'));
      setNav('server', t('server.waiting.nav'), 'on');
      break;
    case 'locked':
      setHero('server', 'warn', t('server.locked'), t('server.locked.hint'));
      setNav('server', t('server.locked'), 'warn');
      break;
    case 'starting':
      setHero('server', 'warn', t('server.starting'), t('server.starting.hint'));
      setNav('server', t('server.starting'), 'warn');
      break;
    case 'online':
      setHero('server', 'on', t('server.online'), t('server.online.hint'));
      setNav('server', t('server.online.nav'), 'on');
      break;
    default:
      setHero('server', null, t('state.stopped'), t('server.idle.hint'));
      if (state.status.tracking) setNav('server', t('live.nav'), state.status.phase === 'offline' ? 'warn' : 'on');
      else setNav('server', t('state.stopped'));
  }

  setButton($('server-toggle'), sv.monitoring
    ? { text: t('server.stop'), icon: 'stop', kind: 'danger' }
    : { text: t('server.monitor'), icon: 'play' });

  // Com o aviso de restart ou o Status ao vivo ligados os campos ficam travados: o aviso diz o que desligar
  const locked = sv.monitoring || state.status.tracking;
  for (const id of ['server-host', 'server-port', 'server-qport']) $(id).disabled = locked;
  $('server-locked').classList.toggle('hidden', !locked);
  if (locked) {
    const what = [sv.monitoring && t('server.locked.monitor'), state.status.tracking && t('server.locked.live')]
      .filter(Boolean).join(t('server.locked.and'));
    $('server-locked-text').textContent = t('server.locked.note', { what });
    $('server-locked-dep').textContent = state.status.tracking && state.overlay.enabled
      ? t('server.locked.dep') : '';
  }
  setInput($('server-host'), sv.host);
  setInput($('server-port'), sv.port);
  setInput($('server-qport'), sv.queryPort);

  $('server-error').textContent = sv.error ? t(sv.error.key, sv.error.params) : '';
  $('server-error').classList.toggle('hidden', !sv.error);

  setInput($('vol-range'), sv.volume);
  $('vol-value').textContent = `${sv.volume}%`;

  const info = sv.info;
  const showInfo = info && ['waiting', 'locked', 'starting', 'confirming', 'online'].includes(sv.phase);
  $('server-info').classList.toggle('hidden', !showInfo);
  if (showInfo) {
    $('info-name').textContent = info.name;
    $('info-players').textContent = `${info.players}/${info.maxPlayers}`;
    $('info-bar').style.width = `${info.maxPlayers ? (info.players / info.maxPlayers) * 100 : 0}%`;
    $('info-map').textContent = info.map;
    $('info-qport').textContent = sv.foundPort;
  }
}

function renderLive() {
  const st = state.status;
  const sv = state.server;
  $('live-armed').checked = st.tracking;
  const at = st.updatedAt
    ? new Date(st.updatedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
    : '';

  switch (st.phase) {
    case 'checking':
      setHero('live', 'warn', t('server.checking'), t('server.checking.hint', { host: sv.host, port: sv.port }));
      break;
    case 'online':
      setHero('live', 'on', t('live.online'), t('live.online.hint', { time: at }));
      break;
    case 'offline':
      setHero('live', 'bad', t('live.offline'), t('live.offline.hint', { time: at }));
      break;
    default:
      setHero('live', null, t('state.off'), t('live.off.hint'));
  }

  const info = st.phase === 'online' ? st.info : null;
  $('live-data').classList.toggle('hidden', !info);
  if (!info) return;

  const dash = '—';
  $('live-name').textContent = info.name;
  $('live-time').textContent = info.time || dash;
  // sol ou lua conforme a hora atual do servidor (so isso; nada e calculado para frente)
  const night = info.time ? DayCycle.isNight(info.time) : null;
  $('live-sky-icon').innerHTML = night === null ? '' : icon(night ? 'moon' : 'sun');
  $('live-sky-icon').className = `sky-icon ${night ? 'night' : 'day'}`;
  $('live-queue').textContent = info.queue == null ? dash : info.queue === 0 ? t('live.queue.none') : String(info.queue);
  $('live-players').textContent = `${info.players}/${info.maxPlayers}`;
  $('live-bar').style.width = `${info.maxPlayers ? (info.players / info.maxPlayers) * 100 : 0}%`;
  $('live-ping').textContent = st.ping == null ? dash : t('live.ms', { ms: st.ping });
  $('live-version').textContent = info.version || dash;
  const client = st.client;
  const relationKey = { same: 'live.version.same', 'client-old': 'live.version.client', 'server-old': 'live.version.server' }[client?.relation];
  $('live-version-note').textContent = relationKey ? t(relationKey, { version: client.version }) : '';
  $('live-version-note').className = client?.relation === 'same' ? 'ok' : 'warn';
  $('live-map').textContent = info.map;
  $('live-updated').textContent = t('live.updated', { time: at });
}

function renderOverlay() {
  const o = state.overlay;
  $('overlay-armed').checked = o.enabled;

  if (!o.enabled) {
    setHero('overlay', null, t('state.off'), t('overlay.off.hint'));
    setNav('overlay', t('state.off'));
  } else if (!state.status.tracking) {
    setHero('overlay', 'warn', t('overlay.noserver'), t('overlay.noserver.hint'));
    setNav('overlay', t('overlay.noserver'), 'warn');
  } else if (state.status.phase !== 'online') {
    setHero('overlay', 'warn', t('overlay.waiting'), t('overlay.waiting.hint'));
    setNav('overlay', t('overlay.waiting'), 'warn');
  } else {
    setHero('overlay', 'on', t('overlay.on'), t('overlay.on.hint'));
    setNav('overlay', t('overlay.on'), 'on');
  }

  for (const btn of $('overlay-corners').children) {
    const active = btn.dataset.corner === o.corner;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  }
  setInput($('overlay-x'), o.x);
  setInput($('overlay-y'), o.y);

  // Escolha de monitor so aparece com mais de um
  const select = $('overlay-display');
  $('overlay-display-field').classList.toggle('hidden', o.displays.length < 2);
  const ids = o.displays.map((d) => d.id).join();
  if (select.dataset.ids !== ids || select.dataset.lang !== i18n.language) {
    select.innerHTML = '';
    o.displays.forEach((d, i) => {
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = t(d.primary ? 'overlay.display.primary' : 'overlay.display.item', { n: i + 1, w: d.width, h: d.height });
      select.appendChild(option);
    });
    select.dataset.ids = ids;
    select.dataset.lang = i18n.language;
  }
  select.value = (o.displays.find((d) => d.id === o.display) || o.displays.find((d) => d.primary) || {}).id ?? '';
}

function render() {
  if (!state) return;
  renderTarget();
  renderHotkeys();
  renderToggleTool('autorun');
  renderToggleTool('clicker');
  radioFollowGame(false); // a escuta do rádio acompanha o DayZ que o app achou
  renderServer();
  renderLive();
  renderOverlay();
}

// ---------------------------------------------------------------------
// Acoes
// ---------------------------------------------------------------------

$('autorun-armed').addEventListener('change', (e) => call('setAutorunArmed', e.target.checked));
$('clicker-armed').addEventListener('change', (e) => call('setClickerArmed', e.target.checked));

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.hotkey [data-action]');
  if (!btn) return;
  const feature = btn.closest('.hotkey').dataset.feature;
  if (btn.dataset.action === 'record') call('recordHotkey', feature);
  else if (btn.dataset.action === 'cancel') call('cancelRecording');
});

// --- Mapa (iZurvive ou Nasdara Map; a escolha fica salva no processo principal) ---
let mapInfo = null; // { provider, providers: [{ id, name, site }] }

/** Seletor, credito, link e subtitulo do menu seguem o mapa escolhido */
function renderMap() {
  if (!mapInfo) return;
  const current = mapInfo.providers.find((p) => p.id === mapInfo.provider);
  const group = $('map-switch');
  if (group.children.length !== mapInfo.providers.length) {
    group.replaceChildren(...mapInfo.providers.map(({ id, name }) => {
      const btn = document.createElement('button');
      btn.dataset.map = id;
      btn.setAttribute('role', 'radio');
      btn.textContent = name;
      return btn;
    }));
  }
  for (const btn of group.children) {
    const active = btn.dataset.map === mapInfo.provider;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  }
  $('map-credit-text').textContent = t('map.credit', { name: current.name });
  $('map-credit-link').textContent = current.site;
  $('map-nav').textContent = current.name;
}

$('map-switch').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-map]');
  if (!btn || btn.dataset.map === mapInfo?.provider) return;
  mapInfo = await window.mapView.set(btn.dataset.map);
  renderMap();
});
new ResizeObserver(syncMap).observe($('map-host'));
$('map-home').addEventListener('click', () => window.mapView.home());
$('map-reload').addEventListener('click', () => window.mapView.reload());
$('map-external').addEventListener('click', () => window.mapView.openExternal());
$('map-credit-link').addEventListener('click', () => window.mapView.openExternal());

// --- Monitor de servidor ---
const parsePort = (text) => (text.trim() === '' ? null : Number.parseInt(text, 10));
$('server-host').addEventListener('input', (e) => call('setServerConfig', { host: e.target.value }));
$('server-port').addEventListener('input', (e) => call('setServerConfig', { port: parsePort(e.target.value) }));
$('server-qport').addEventListener('input', (e) => call('setServerConfig', { queryPort: parsePort(e.target.value) }));
$('live-armed').addEventListener('change', (e) =>
  call(e.target.checked ? 'startStatusTracker' : 'stopStatusTracker'));
$('server-locked-stop').addEventListener('click', () => {
  call('stopServerMonitor');
  call('stopStatusTracker');
});
$('server-toggle').addEventListener('click', () =>
  call(state.server.monitoring ? 'stopServerMonitor' : 'startServerMonitor'));
for (const id of ['server-host', 'server-port', 'server-qport']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !state.server.monitoring) call('startServerMonitor');
  });
}

// --- Relogio na tela ---
$('overlay-armed').addEventListener('change', (e) => call('setOverlayConfig', { enabled: e.target.checked }));
$('overlay-corners').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-corner]');
  if (btn) call('setOverlayConfig', { corner: btn.dataset.corner });
});
for (const axis of ['x', 'y']) {
  $(`overlay-${axis}`).addEventListener('input', (e) => {
    const value = Number.parseInt(e.target.value, 10);
    if (Number.isFinite(value)) call('setOverlayConfig', { [axis]: value });
  });
}
$('overlay-display').addEventListener('change', (e) => call('setOverlayConfig', { display: Number(e.target.value) }));
$('overlay-reset').addEventListener('click', () => call('setOverlayConfig', { corner: 'tr', x: 20, y: 20 }));

const setVolume = (v) => {
  const volume = Math.min(100, Math.max(0, v));
  call('setServerConfig', { volume });
  beep(volume);
};
$('vol-down').addEventListener('click', () => setVolume(state.server.volume - 10));
$('vol-up').addEventListener('click', () => setVolume(state.server.volume + 10));
$('vol-range').addEventListener('input', (e) => {
  $('vol-value').textContent = `${e.target.value}%`;
  call('setServerConfig', { volume: Number(e.target.value) });
});
$('vol-range').addEventListener('change', (e) => beep(Number(e.target.value)));
$('vol-test').addEventListener('click', () => beep(state.server.volume));

window.toolkit.onServerOnline(() => {
  beep(state.server.volume);
  showPage('server');
});

// ---------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------

function openModal(id) {
  $(id).classList.remove('hidden');
  syncMap();
}
function closeModal(id) {
  $(id).classList.add('hidden');
  syncMap();
}

for (const backdrop of document.querySelectorAll('.modal-backdrop')) {
  backdrop.addEventListener('click', (e) => {
    // O aviso so fecha no botao "Entendi", nunca clicando fora
    const outside = e.target === backdrop && backdrop.id !== 'notice-modal';
    if (outside || e.target.closest('[data-close]')) closeModal(backdrop.id);
  });
}
// --- Gravar tecla de atalho: a tecla vem do proprio app, nada e escutado fora dele ---
const NAMED_KEYS = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult', NumpadDecimal: 'numdec',
};

/** Converte o evento de teclado em { accelerator, name } do Electron; null se a tecla nao serve */
function captureHotkey(e) {
  let key = NAMED_KEYS[e.code];
  if (!key) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
    else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
    else if (/^Numpad[0-9]$/.test(e.code)) key = `num${e.code.slice(6)}`;
  }
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  const label = key.replace(/^num(\d)$/, 'Num $1');
  return {
    accelerator: [...mods, key].join('+'),
    name: [...mods.map((m) => (m === 'Control' ? 'Ctrl' : m)), label].join('+'),
  };
}

document.addEventListener('keydown', (e) => {
  if (!state?.recording) return;
  e.preventDefault();
  if (e.repeat) return;
  if (e.key === 'Escape') {
    call('cancelRecording');
    return;
  }
  const hotkey = captureHotkey(e);
  if (hotkey) call('setHotkey', hotkey.accelerator, hotkey.name);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeModal('window-modal');
  closeModal('update-modal');
  closeModal('whatsnew-modal');
  closeModal('settings-modal');
});

// --- Seletor de janela ---
async function loadWindows() {
  const list = $('window-list');
  const windows = await call('listWindows');
  const isGameWindow = (w) => /^dayz_x64\.exe$/i.test(w.process);
  windows.sort((a, b) => isGameWindow(b) - isGameWindow(a));
  if (!windows.length) {
    list.innerHTML = '<div class="window-empty"></div>';
    list.firstChild.textContent = t('window.empty');
    return;
  }
  list.innerHTML = '';
  for (const w of windows) {
    const item = document.createElement('button');
    const isGame = isGameWindow(w);
    item.className = 'window-item' + (isGame ? ' game' : '') + (state.target?.hwnd === w.hwnd ? ' selected' : '');
    item.innerHTML = `<span class="wi-icon">${icon(isGame ? 'crosshair' : 'monitor')}</span>
      <span class="wi-text"><strong></strong><small></small></span>`;
    item.querySelector('strong').textContent = w.title;
    item.querySelector('small').textContent = w.process;
    item.addEventListener('click', async () => {
      await call('setTarget', w.hwnd);
      closeModal('window-modal');
    });
    list.appendChild(item);
  }
}

$('target-change').addEventListener('click', () => {
  openModal('window-modal');
  loadWindows();
});
$('window-refresh').addEventListener('click', loadWindows);

// --- Atualizacao ---
// Tamanho (sem casas) e velocidade (1 casa) no idioma da interface
const formatMB = (bytes, digits) => (bytes / 1048576).toLocaleString(i18n.language, { maximumFractionDigits: digits });

function renderUpdate() {
  const u = updateState;
  if (!u) return;
  const visible = ['available', 'downloading', 'installing', 'error'].includes(u.status);
  $('update-pill').classList.toggle('hidden', !visible);
  if (!visible) {
    updateShownFor = null;
    return;
  }

  const busy = u.status === 'downloading' || u.status === 'installing';
  const failed = u.status === 'error';
  const percent = Math.floor(u.percent || 0);
  if (busy) updateShownFor = null; // uma falha nova depois de "Tentar de novo" volta a abrir a janela
  const pill = { available: 'update.pill', downloading: 'update.pill.downloading', installing: 'update.pill.installing', error: 'update.pill.error' };
  $('update-pill-text').textContent = t(pill[u.status], { version: u.version, percent });
  $('update-title').textContent = t('update.title', { version: u.version });

  const text = { available: 'update.howto', downloading: 'update.downloading', installing: 'update.installing' };
  $('update-text').textContent = t(failed ? `update.error.${u.error}` : text[u.status]);
  // A falha vem acompanhada do aviso de que o app atual segue funcionando
  $('update-notice').classList.toggle('is-error', failed);
  $('update-note')?.remove();
  if (failed) {
    const note = document.createElement('p');
    note.id = 'update-note';
    note.textContent = t('update.error.note');
    $('update-notice').appendChild(note);
  }

  $('update-progress').classList.toggle('hidden', !busy);
  $('update-bar').style.width = `${u.status === 'installing' ? 100 : percent}%`;
  $('update-stats').textContent = u.total
    ? t('update.stats', { percent, done: formatMB(u.transferred, 0), total: formatMB(u.total, 0), speed: formatMB(u.bytesPerSecond, 1) })
    : t('update.stats.start');

  $('update-later').classList.toggle('hidden', busy);
  $('update-manual').classList.toggle('hidden', !failed);
  $('update-now').classList.toggle('hidden', busy);
  $('update-now').innerHTML = `${icon('download')}<span></span>`;
  $('update-now').querySelector('span').textContent = t(failed ? 'update.retry' : 'update.now');

  // Abre sozinho uma vez quando a atualizacao aparece e quando uma falha acontece (o usuario pode ter fechado a janela durante o download)
  if ((u.status === 'available' || failed) && updateShownFor !== u.status) {
    updateShownFor = u.status;
    openModal('update-modal');
  }
}

$('update-pill').addEventListener('click', () => openModal('update-modal'));

// --- Novidades da versao ---
function renderWhatsNew() {
  $('version').disabled = !whatsNewData;
  if (!whatsNewData) return;
  $('whatsnew-title').textContent = t('whatsnew.title', { version: whatsNewData.version });
  const list = $('whatsnew-list');
  list.innerHTML = '';
  for (const note of whatsNewData.notes) {
    const item = document.createElement('li');
    item.textContent = note;
    list.appendChild(item);
  }
}

$('version').addEventListener('click', () => {
  if (whatsNewData) openModal('whatsnew-modal');
});
$('update-now').addEventListener('click', () => window.updater.download());
$('update-manual').addEventListener('click', () => window.updater.openReleases());

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------

// --- Idioma ---
let appVersion = '';

function renderLanguageMenu() {
  const select = $('lang-select');
  if (select.options.length !== i18n.languages.length) {
    select.innerHTML = '';
    for (const { code, name } of i18n.languages) {
      const option = document.createElement('option');
      option.value = code;
      option.lang = code; // cada nome na fonte certa da propria lingua
      option.textContent = name;
      select.appendChild(option);
    }
  }
  select.value = i18n.language;
}

/** Redesenha tudo que depende do idioma */
function applyLanguage() {
  applyTranslations();
  renderLanguageMenu();
  $('version').textContent = t('version', { version: appVersion });
  $('update-sub').textContent = t('update.sub', { version: appVersion });
  render();
  renderMap();
  renderRadio();
  renderUpdate();
  renderWhatsNew();
}

// --- Configuracoes (composicao de video por GPU: so vale depois de reiniciar) ---
function renderGpu(gpu) {
  $('gpu-compositing').checked = gpu.enabled;
  $('gpu-restart').classList.toggle('hidden', !gpu.needsRestart);
  $('gpu-restart-now').classList.toggle('hidden', !gpu.needsRestart);
}

$('settings-open').addEventListener('click', async () => {
  renderGpu(await window.appSettings.getGpu());
  openModal('settings-modal');
});
$('gpu-compositing').addEventListener('change', async (e) => renderGpu(await window.appSettings.setGpu(e.target.checked)));
$('gpu-restart-now').addEventListener('click', () => window.appSettings.relaunch());

$('lang-select').addEventListener('change', async (e) => {
  setI18nPayload(await window.appLanguage.set(e.target.value));
  whatsNewData = await window.whatsNew.get(); // o texto muda com o idioma
  applyLanguage();
});

(async function init() {
  applyIcons();
  initRadio();
  setI18nPayload(await window.appLanguage.get());
  const saved = localStorage.getItem('page');
  showPage(saved && $(`page-${saved}`) ? saved : 'autorun');

  ({ version: appVersion } = await window.appInfo());

  window.toolkit.onState((s) => {
    state = s;
    render();
  });
  window.updater.onState((u) => {
    updateState = u;
    renderUpdate();
  });
  state = await call('snapshot');
  updateState = await window.updater.state();
  whatsNewData = await window.whatsNew.get();
  mapInfo = await window.mapView.get();
  applyLanguage();
  document.body.classList.add('i18n-ready'); // so mostra a tela depois de traduzida
  call('autoSelectTarget');

  // Primeira abertura depois de atualizar: mostra as novidades uma unica vez
  if (whatsNewData?.auto) {
    openModal('whatsnew-modal');
    window.whatsNew.markSeen();
  }
})();
