// Gives the tab strip and toolbar (ui/) a small, fixed set of calls into the app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jiraTabs', {
  platform: process.platform,
  onState: (fn) => ipcRenderer.on('state', (_e, state) => fn(state)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, name, arg) => fn(name, arg)),
  action: (name, arg) => ipcRenderer.send('ui', String(name), arg),
});
