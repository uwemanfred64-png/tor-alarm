const { contextBridge, ipcRenderer } = require('electron');

// Verbindung zum Main-Prozess: Töne kommen über 'sound:play', Fehler gehen über 'sound:error' zurück.
contextBridge.exposeInMainWorld('taSound', {
  onPlay: (cb) => ipcRenderer.on('sound:play', (_e, job) => cb(job)),
  error: (message) => ipcRenderer.send('sound:error', { message: String(message) }),
});
