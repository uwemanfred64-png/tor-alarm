// Fenster-Manager für die Popups: eine von vier Bildschirmecken, Stapeln mit unterschiedlich hohen
// Fenstern (jedes Design meldet seine Größe per 'popup:ready'), Größenstufe (Zoom), Warteschlange
// und eine Notbremse, damit nie ein Fenster hängen bleibt.

const { BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('path');

// Startgröße, bis das Design seine echte Größe meldet
const DEFAULT_SIZE = { tafel: [420, 158], videotext: [420, 176], ticker: [400, 140] };
const MARGIN = 8;
const GAP = 2;
const MAX_VISIBLE = 4;
const QUEUE_MAX_AGE = 2 * 60_000;
const READY_FALLBACK = 2_500; // meldet sich ein Design nicht, wird das Fenster trotzdem gezeigt

let defaults = { position: 'unten-rechts', size: 100 };
const visible = []; // unterstes (bzw. oberstes bei "oben") zuerst
const queue = [];

function configure({ position, size }) {
  defaults = { position: position || defaults.position, size: size || defaults.size };
  restack();
}

const zoomOf = (h) => (h.size || defaults.size) / 100;
const positionOf = (h) => h.position || defaults.position;

function restack() {
  const { workArea } = screen.getPrimaryDisplay();
  // Pro Ecke getrennt stapeln (Vorschau kann an einer anderen Ecke stehen als echte Meldungen)
  const offsets = {};
  for (const h of visible) {
    if (!h.win || h.win.isDestroyed()) continue;
    const pos = positionOf(h);
    const [w, ht] = h.winSize;
    const used = offsets[pos] || 0;
    const right = pos.endsWith('rechts');
    const bottom = pos.startsWith('unten');
    const x = right ? workArea.x + workArea.width - w - MARGIN : workArea.x + MARGIN;
    const y = bottom ? workArea.y + workArea.height - MARGIN - used - ht : workArea.y + MARGIN + used;
    h.win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: ht }, false);
    offsets[pos] = used + ht + GAP;
  }
}

// opts: { position, size } überschreibt die Standardwerte nur für dieses Popup (Vorschau)
function showPopup(card, opts = {}) {
  const handle = {
    card: { ...card, key: card.key || `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    win: null,
    closed: false,
    loaded: false,
    shown: false,
    queuedAt: Date.now(),
    position: opts.position,
    size: opts.size,
  };
  if (visible.length < MAX_VISIBLE) open(handle);
  else queue.push(handle);
  return handle;
}

// Teil-Update an ein Popup – oder, solange es noch wartet, direkt in seine Kartendaten.
function updatePopup(handle, upd) {
  if (!handle || handle.closed) return;
  Object.assign(handle.card, upd);
  if (handle.win && !handle.win.isDestroyed() && handle.loaded) handle.win.webContents.send('popup:update', upd);
}

function reveal(handle) {
  if (handle.shown || !handle.win || handle.win.isDestroyed()) return;
  handle.shown = true;
  restack();
  handle.win.showInactive();
}

function open(handle) {
  const zoom = zoomOf(handle);
  const [w0, h0] = DEFAULT_SIZE[handle.card.design] || DEFAULT_SIZE.tafel;
  handle.winSize = [Math.round(w0 * zoom), Math.round(h0 * zoom)];

  const win = new BrowserWindow({
    width: handle.winSize[0],
    height: handle.winSize[1],
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'popup', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      zoomFactor: zoom,
      // Electron merkt sich den Zoom pro Herkunft (alle file://-Seiten teilen ihn). Eigene, nicht
      // gespeicherte Partition je Größenstufe – sonst würde 150 % auch das Einstellungsfenster vergrößern.
      partition: `popup-zoom-${Math.round(zoom * 100)}`,
    },
  });
  handle.win = win;
  visible.push(handle);
  win.setAlwaysOnTop(true, 'screen-saver');

  // Notbremse: Anzeigedauer + maximale Wartezeit auf den Torschützen + Reserve
  const cap = (handle.card.duration || 14_000) + 30_000 + 30_000;
  const kill = setTimeout(() => !win.isDestroyed() && win.destroy(), cap);
  const bail = () => !win.isDestroyed() && win.destroy();
  win.webContents.on('render-process-gone', bail);
  win.webContents.on('did-fail-load', bail);

  win.loadFile(path.join(__dirname, 'popup', 'popup.html'));
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    // Zoom zur Sicherheit nochmal fest setzen (Chromium könnte sonst einen gemerkten Wert nehmen)
    win.webContents.setZoomFactor(zoom);
    handle.loaded = true;
    win.webContents.send('popup:show', handle.card);
    setTimeout(() => reveal(handle), READY_FALLBACK);
  });
  win.on('closed', () => {
    clearTimeout(kill);
    handle.closed = true;
    const i = visible.indexOf(handle);
    if (i >= 0) visible.splice(i, 1);
    while (visible.length < MAX_VISIBLE && queue.length) {
      const next = queue.shift();
      if (Date.now() - next.queuedAt > QUEUE_MAX_AGE) {
        next.closed = true; // zu alt, nicht mehr zeigen
        continue;
      }
      open(next);
    }
    restack();
  });
}

function handleFor(sender) {
  return visible.find((h) => h.win && !h.win.isDestroyed() && h.win.webContents === sender);
}

ipcMain.on('popup:ready', (e, size) => {
  const h = handleFor(e.sender);
  if (!h) return;
  const zoom = zoomOf(h);
  const w = Number(size && size.width);
  const ht = Number(size && size.height);
  if (w > 0 && ht > 0) {
    const { workArea } = screen.getPrimaryDisplay();
    h.winSize = [
      Math.min(Math.round(w * zoom), workArea.width - 2 * MARGIN),
      Math.min(Math.round(ht * zoom), workArea.height - 2 * MARGIN),
    ];
  }
  if (h.shown) restack();
  else reveal(h);
});

ipcMain.on('popup:close', (e) => {
  const h = handleFor(e.sender);
  if (h) h.win.close();
});

ipcMain.on('popup:open', (e, url) => {
  const h = handleFor(e.sender);
  if (!h) return;
  if (typeof url === 'string' && url.startsWith('https://www.fotmob.com/')) shell.openExternal(url);
  h.win.close();
});

function closeAll() {
  queue.splice(0).forEach((h) => (h.closed = true));
  visible.slice().forEach((h) => h.win && !h.win.isDestroyed() && h.win.destroy());
}

module.exports = { configure, showPopup, updatePopup, closeAll };
