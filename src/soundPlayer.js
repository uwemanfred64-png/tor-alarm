// Spielt Sounds über ein verstecktes Fenster ab (WebAudio gibt es nur im Renderer).
// Das Fenster wird beim ersten Sound erzeugt und bleibt dann geladen.

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let win = null;
let loaded = false;
const waiting = [];
let onError = () => {};

function ensure() {
  if (win && !win.isDestroyed()) return;
  loaded = false;
  win = new BrowserWindow({
    show: false,
    width: 200,
    height: 100,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'sound', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadFile(path.join(__dirname, 'sound', 'sound.html'));
  win.webContents.once('did-finish-load', () => {
    loaded = true;
    for (const spec of waiting.splice(0)) win.webContents.send('sound:play', spec);
  });
  const reset = () => {
    win = null;
    loaded = false;
  };
  win.on('closed', reset);
  win.webContents.on('render-process-gone', () => {
    if (win && !win.isDestroyed()) win.destroy();
    reset();
  });
}

// spec: { name, file, volume }
function play(spec) {
  if (!spec || !spec.name) return;
  ensure();
  if (loaded) win.webContents.send('sound:play', spec);
  else waiting.push(spec);
}

ipcMain.on('sound:error', (e, info) => {
  if (!win || e.sender !== win.webContents) return;
  onError(info && info.message ? info.message : String(info));
});

function setErrorHandler(fn) {
  onError = typeof fn === 'function' ? fn : () => {};
}

function dispose() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { play, setErrorHandler, dispose };
