const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toralarm', {
  onShow: (cb) => ipcRenderer.on('popup:show', (_e, card) => cb(card)),
  onUpdate: (cb) => ipcRenderer.on('popup:update', (_e, data) => cb(data)),
  // Gewünschte Fenstergröße in CSS-Pixeln inkl. 8 px Rand – Main zeigt das Fenster erst danach.
  ready: (size) =>
    ipcRenderer.send('popup:ready', {
      width: Math.ceil(Number(size && size.width)) || 0,
      height: Math.ceil(Number(size && size.height)) || 0,
    }),
  close: () => ipcRenderer.send('popup:close'),
  open: (url) => ipcRenderer.send('popup:open', String(url || '')),
});
