const { contextBridge, ipcRenderer } = require("electron");

// How a ready update is applied: "restart" installs a downloaded update
// (Windows/Linux), "download" opens the release page (unsigned macOS build).
const UPDATE_ACTIONS = ["restart", "download"];

// Only the update channels are exposed; the page cannot reach any other IPC.
contextBridge.exposeInMainWorld("screenmate", {
    platform: "electron",
    updates: {
        // Resolves { currentVersion, readyVersion: string|null, action }.
        getStatus: () => ipcRenderer.invoke("updates:status"),
        onReady: (callback) => {
            const listener = (_event, info) => {
                if (
                    info &&
                    typeof info.version === "string" &&
                    info.version &&
                    UPDATE_ACTIONS.includes(info.action)
                ) {
                    callback({ version: info.version, action: info.action });
                }
            };
            ipcRenderer.on("updates:ready", listener);
            return () => {
                ipcRenderer.removeListener("updates:ready", listener);
            };
        },
        install: () => {
            ipcRenderer.send("updates:install");
        },
    },
});
