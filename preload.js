// Pont securise entre l'interface et le processus principal de VideoGrab.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vg", {
  call: (route, body) => ipcRenderer.invoke("api", route, body),
  pathForFile: file => webUtils.getPathForFile(file),
  platform: process.platform,
});
