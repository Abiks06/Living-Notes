// The page's only way out of its sandbox: what's playing on this PC, a few controls for it, and
// keeping the PC awake while someone's watching.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resonanceDesktop', {
  nowPlaying: {
    start: () => ipcRenderer.send('now-playing:start'),
    stop: () => ipcRenderer.send('now-playing:stop'),
    command: (verb, id, title) => ipcRenderer.send('now-playing:command', verb, id, title),
    onUpdate: (listener) => {
      const forward = (_event, message) => listener(message);
      ipcRenderer.on('now-playing', forward);
      return () => ipcRenderer.removeListener('now-playing', forward);
    },
  },
  keepAwake: (on) => ipcRenderer.send('keep-awake', on),
});
