// The only bridge between the page and the shell: the page reports its resolved
// theme so the window frame and native controls match it. No file system, no
// Node, no remote code.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("liquidDesktop", {
  setTheme: (theme) => ipcRenderer.send("theme", theme),
});
