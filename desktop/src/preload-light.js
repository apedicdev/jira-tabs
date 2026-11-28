// Gives the light issue view (light/) what it may ask the app: an issue's data, its status
// changes and comments, and opening links. The view itself never talks to Jira.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lightApi', {
  platform: process.platform,
  onShow: (fn) => ipcRenderer.on('show', (_e, arg) => fn(arg)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, name, arg) => fn(name, arg)),
  issue: (key, fresh) => ipcRenderer.invoke('light', 'issue', { key, fresh: !!fresh }),
  transitions: (key) => ipcRenderer.invoke('light', 'transitions', { key }),
  transition: (key, id) => ipcRenderer.invoke('light', 'transition', { key, id }),
  comment: (key, text) => ipcRenderer.invoke('light', 'comment', { key, text }),
  open: (url, background) => ipcRenderer.send('light-open', String(url), !!background),
  openFull: () => ipcRenderer.send('light-full'),
  // Pointing at a link to an issue (or at "Open full Jira / GitLab", with no address) loads it ahead.
  hover: (url) => ipcRenderer.send('light-hover', url ? String(url) : null),
  copy: (text) => ipcRenderer.send('light-copy', String(text)),
});
