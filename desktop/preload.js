const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  onUsage: (cb) => ipcRenderer.on("usage", (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on("usage-error", (_e, d) => cb(d)),
  onCelebrate: (cb) => ipcRenderer.on("celebrate", () => cb()),
  onCharacter: (cb) => ipcRenderer.on("character", (_e, c) => cb(c)),
  onPetSize: (cb) => ipcRenderer.on("pet-size", (_e, n) => cb(n)),
  moveBy: (dx) => ipcRenderer.invoke("move-by", dx),
  dragStart: (offX, offY) => ipcRenderer.send("drag-start", offX, offY),
  dragEnd: () => ipcRenderer.send("drag-end"),
  setIgnore: (v) => ipcRenderer.send("set-ignore", v),
  setCharacter: (c) => ipcRenderer.send("set-character", c),
  showMenu: () => ipcRenderer.send("show-menu"),
  refresh: () => ipcRenderer.send("refresh"),
  quit: () => ipcRenderer.send("quit"),
});
