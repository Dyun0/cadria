const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cadria', {
  pickMediaFiles: () => ipcRenderer.invoke('dialog:openMedia')
});
