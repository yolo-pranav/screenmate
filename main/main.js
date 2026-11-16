const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { allowYouTubeEmbeds } = require("./youtubeEmbeds");

// 1. Robust Import for electron-serve
// This handles both CommonJS and ESM module exports
const _serve = require("electron-serve");
const serve = typeof _serve === "function" ? _serve : _serve.default;

// 2. Initialize serve at the TOP LEVEL
// This prevents the "should be called before app is ready" error
const appServe = app.isPackaged ? serve({
    directory: path.join(__dirname, "../out")
}) : null;

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// The macOS build is not signed, so Squirrel.Mac refuses to install updates.
// There the app only announces a new version and sends the user to the
// release page to download it ("download"); elsewhere updates download in the
// background and install on restart ("restart").
const IS_MAC = process.platform === "darwin";
const UPDATE_ACTION = IS_MAC ? "download" : "restart";

let win;
// Version of an update that is ready to act on (downloaded on Windows/Linux,
// available on macOS), kept here so a page that subscribes late (or reloads)
// still learns about it through updates:status.
let readyVersion = null;

// The preload bridge must only be reachable from the app's own pages: the
// packaged app:// origin or the Next.js dev server.
const APP_ORIGINS = ["app://-", "http://localhost:3000"];

function isAppUrl(url) {
    if (typeof url !== "string") return false;
    // Match the origin exactly so e.g. http://localhost:30001 or
    // http://localhost:3000.evil.example are not treated as the app.
    return APP_ORIGINS.some((origin) =>
        url === origin ||
        (url.startsWith(origin) && ["/", "?", "#"].includes(url.charAt(origin.length)))
    );
}

function isFromApp(event) {
    return Boolean(event && event.senderFrame && isAppUrl(event.senderFrame.url));
}

function createWindow() {
    const window = new BrowserWindow({
        width: 1080,
        height: 720,
        autoHideMenuBar: true,
        icon: path.join(__dirname, '../resources/icon.png'),
        show: false, // Don't show until content is loaded (prevents white flash)
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js")
        }
    });
    win = window;

    if (app.isPackaged && appServe) {
        // Use the custom app://- protocol provided by electron-serve
        appServe(window).then(() => {
            if (!window.isDestroyed()) window.loadURL("app://-");
        });
    } else {
        // Development mode
        window.loadURL("http://localhost:3000");
        // window.webContents.openDevTools(); // Optional: open dev tools in dev mode
    }

    // 3. Only show the window once the Next.js page is ready
    window.webContents.on("did-finish-load", () => {
        if (!window.isDestroyed()) window.show();
    });

    window.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });

    window.webContents.on("will-navigate", (event, url) => {
        if (!isAppUrl(url)) event.preventDefault();
    });

    window.on("closed", () => {
        if (win === window) win = null;
    });
}

// GitHub owner/repo names: letters, digits, "-", "_" and "." only, and not
// made of dots alone (which would turn into a path segment like "..").
const SAFE_GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

// Builds the "latest release" page URL from the parsed app-update.yml that
// electron-builder packs with the app (provider: github, owner, repo).
// Returns null for anything unexpected so nothing untrusted reaches the shell.
function releasePageUrlFrom(config) {
    if (!config || typeof config !== "object") return null;
    if (config.provider !== undefined && config.provider !== "github") return null;
    const { owner, repo } = config;
    const isSafe = (name) =>
        typeof name === "string" && SAFE_GITHUB_NAME.test(name) && !/^\.+$/.test(name);
    if (!isSafe(owner) || !isSafe(repo)) return null;
    return `https://github.com/${owner}/${repo}/releases/latest`;
}

function readReleasePageUrl() {
    try {
        // js-yaml ships with electron-updater, which is a runtime dependency.
        const yaml = require("js-yaml");
        const file = path.join(process.resourcesPath, "app-update.yml");
        return releasePageUrlFrom(yaml.load(fs.readFileSync(file, "utf8")));
    } catch (err) {
        console.error("[updates] could not read app-update.yml:", err);
        return null;
    }
}

// Auto updates (GitHub Releases via electron-updater). Only packaged builds
// have an app-update.yml to read, so dev runs skip this entirely.
function checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
        console.error("[updates] check failed:", err);
    });
}

function announceUpdate(info) {
    const version = info && info.version ? String(info.version) : null;
    if (!version) return;
    readyVersion = version;
    if (win && !win.isDestroyed()) {
        win.webContents.send("updates:ready", { version, action: UPDATE_ACTION });
    }
}

function setUpAutoUpdates() {
    if (!app.isPackaged) return;

    autoUpdater.on("error", (err) => {
        console.error("[updates] error:", err);
    });

    if (IS_MAC) {
        // Unsigned: only learn about new versions (from latest-mac.yml), the
        // user downloads the new .dmg from the release page.
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.on("update-available", announceUpdate);
    } else {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("update-downloaded", announceUpdate);
    }

    checkForUpdates();
    setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
}

ipcMain.handle("updates:status", (event) => {
    if (!isFromApp(event)) return null;
    return {
        currentVersion: app.getVersion(),
        readyVersion,
        action: UPDATE_ACTION,
    };
});

ipcMain.on("updates:install", (event) => {
    if (!isFromApp(event) || !readyVersion) return;

    if (IS_MAC) {
        const url = readReleasePageUrl();
        if (!url) return;
        shell.openExternal(url).catch((err) => {
            console.error("[updates] could not open the release page:", err);
        });
        return;
    }

    try {
        // Silent install (no installer wizard), then relaunch the app.
        autoUpdater.quitAndInstall(true, true);
    } catch (err) {
        console.error("[updates] install failed:", err);
    }
});

// 4. Lifecycle management
app.on("ready", () => {
    // Trailers are YouTube embeds, which need a Referer the app:// page can't send
    allowYouTubeEmbeds(session.defaultSession);
    createWindow();
    setUpAutoUpdates();
});

// macOS keeps the app running with no windows; clicking the Dock icon then
// opens a new one.
app.on("activate", () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
