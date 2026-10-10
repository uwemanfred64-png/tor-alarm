const { contextBridge, ipcRenderer } = require('electron');

// Brücke für das Einstellungsfenster – alles läuft über ipcRenderer.invoke und liefert Promises.
contextBridge.exposeInMainWorld('taSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  meta: () => ipcRenderer.invoke('settings:meta'),
  save: (partial) => ipcRenderer.invoke('settings:save', partial),
  preview: (partial) => ipcRenderer.invoke('settings:preview', partial),
  testSound: (spec) => ipcRenderer.invoke('settings:test-sound', spec),
  pickSoundFile: () => ipcRenderer.invoke('settings:pick-file'),
  testForward: (cfg) => ipcRenderer.invoke('settings:test-forward', cfg),
  onChanged: (cb) => {
    ipcRenderer.on('settings:changed', (_e, settings) => cb(settings));
  },
});
