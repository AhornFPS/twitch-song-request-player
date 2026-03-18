import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import electronUpdater from "electron-updater";
import { createConfigStore } from "../src/config.js";
import { startAppServer } from "../src/app-server.js";

const { autoUpdater } = electronUpdater;

class UpdateService extends EventEmitter {
  constructor(appVersion) {
    super();
    this.appVersion = appVersion;
    this.status = {
      state: "idle", // idle, checking, available, downloading, downloaded, error
      version: null,
      releaseNotes: null,
      progress: 0,
      error: null
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      this.updateStatus({ state: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
      this.updateStatus({
        state: "available",
        version: info.version,
        releaseNotes: info.releaseNotes || ""
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.updateStatus({ state: "idle" });
    });

    autoUpdater.on("error", (error) => {
      this.updateStatus({
        state: "error",
        error: error?.message || String(error)
      });
    });

    autoUpdater.on("download-progress", (progressObj) => {
      this.updateStatus({
        state: "downloading",
        progress: progressObj.percent
      });
    });

    autoUpdater.on("update-downloaded", () => {
      this.updateStatus({ state: "downloaded" });
    });
  }

  updateStatus(partialStatus) {
    this.status = { ...this.status, ...partialStatus };
    this.emit("status-changed", this.status);
  }

  getStatus() {
    return { ...this.status, appVersion: this.appVersion };
  }

  checkForUpdates() {
    this.updateStatus({ error: null });
    autoUpdater.checkForUpdates().catch((err) => {
      this.updateStatus({
        state: "error",
        error: err?.message || String(err)
      });
    });
  }

  downloadUpdate() {
    if (this.status.state !== "available") return;
    this.updateStatus({ state: "downloading", progress: 0 });
    autoUpdater.downloadUpdate().catch((err) => {
      this.updateStatus({
        state: "error",
        error: err?.message || String(err)
      });
    });
  }

  installUpdate() {
    if (this.status.state === "downloaded") {
      autoUpdater.quitAndInstall(true, true);
    }
  }
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRootDir = path.resolve(moduleDir, "..");

export async function bootstrapDesktopApp(electron) {
  const { app, BrowserWindow, dialog, shell, globalShortcut } = electron;

  let mainWindow = null;
  let appServer = null;
  let isShuttingDown = false;

  function getRuntimeDir() {
    const isPackagedApp =
      app.isPackaged ||
      app.getAppPath().includes("app.asar");

    if (isPackagedApp) {
      // If running the electron-builder portable target, keep data next to the executable
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return process.env.PORTABLE_EXECUTABLE_DIR;
      }
      
      // In a packaged (installed) application, store configs and playlist in the user data directory
      return app.getPath("userData");
    }

    // In development, store in the project root
    return appRootDir;
  }

  function isStartWithWindowsSupported() {
    return process.platform === "win32" && app.isPackaged;
  }

  function getStartWithWindowsState() {
    if (!isStartWithWindowsSupported()) {
      return {
        supported: false,
        enabled: false,
        reason: process.platform !== "win32"
          ? "This option is only available on Windows."
          : "This option is only available in packaged desktop builds."
      };
    }

    const loginItemSettings = app.getLoginItemSettings();
    return {
      supported: true,
      enabled: loginItemSettings.openAtLogin === true,
      reason: ""
    };
  }

  function setStartWithWindowsEnabled(enabled) {
    if (!isStartWithWindowsSupported()) {
      return getStartWithWindowsState();
    }

    app.setLoginItemSettings({
      openAtLogin: enabled === true,
      openAsHidden: false,
      path: process.execPath
    });

    return getStartWithWindowsState();
  }

  async function ensureServer() {
    if (appServer) {
      return appServer;
    }

    const configStore = createConfigStore({
      rootDir: appRootDir,
      runtimeDir: getRuntimeDir(),
      publicDir: path.join(appRootDir, "public"),
      runtimeDebug: {
        appIsPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        execPath: process.execPath,
        cwd: process.cwd(),
        resourcesPath: process.resourcesPath,
        argv: [...process.argv],
        portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR || "",
        portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE || ""
      }
    });

    const updateService = app.isPackaged ? new UpdateService(app.getVersion()) : null;

    appServer = await startAppServer({
      noBrowser: true,
      configStore,
      updateService,
      desktopIntegration: {
        async getState() {
          return getStartWithWindowsState();
        },
        async setEnabled(enabled) {
          return setStartWithWindowsEnabled(enabled);
        }
      }
    });

    return appServer;
  }

  async function createMainWindow() {
    const server = await ensureServer();

    mainWindow = new BrowserWindow({
      width: 1480,
      height: 980,
      minWidth: 1100,
      minHeight: 760,
      autoHideMenuBar: true,
      backgroundColor: "#08111b",
      title: "Twitch Song Request Player",
      webPreferences: {
        contextIsolation: true,
        sandbox: true
      }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return {
        action: "deny"
      };
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    await mainWindow.loadURL(server.urls.dashboardUrl);
  }

  async function closeServer() {
    if (!appServer) {
      return;
    }

    const serverToClose = appServer;
    appServer = null;
    await serverToClose.close();
  }

  function registerMediaShortcuts() {
    const registrations = [
      {
        accelerator: "MediaPlayPause",
        handler: async () => {
          if (!appServer) {
            return;
          }

          await appServer.togglePauseCurrentTrack("desktop_media_play_pause");
        }
      },
      {
        accelerator: "MediaNextTrack",
        handler: async () => {
          if (!appServer) {
            return;
          }

          await appServer.skipCurrentTrack("desktop_media_next_track");
        }
      }
    ];

    for (const registration of registrations) {
      try {
        globalShortcut.register(registration.accelerator, () => {
          void registration.handler().catch(() => {});
        });
      } catch {
      }
    }
  }

  async function shutdownAndExit(exitCode = 0) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    globalShortcut.unregisterAll();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners("closed");
      mainWindow.destroy();
      mainWindow = null;
    }

    await closeServer().catch(() => {});
    app.exit(exitCode);
  }

  async function bootstrap() {
    try {
      await createMainWindow();
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "Startup failed",
        message: "The desktop app could not start.",
        detail: error?.stack ?? error?.message ?? String(error)
      });
      await shutdownAndExit(1);
    }
  }

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      void shutdownAndExit(0);
    }
  });

  app.on("activate", () => {
    if (!mainWindow) {
      void bootstrap();
    }
  });

  app.on("before-quit", async (event) => {
    if (isShuttingDown) {
      return;
    }

    event.preventDefault();
    void shutdownAndExit(0);
  });

  await app.whenReady();
  try {
    const configStore = createConfigStore({
      rootDir: appRootDir,
      runtimeDir: getRuntimeDir(),
      publicDir: path.join(appRootDir, "public")
    });
    const effectiveSettings = await configStore.loadEffectiveSettings();
    setStartWithWindowsEnabled(effectiveSettings.startWithWindows === true);
  } catch {
  }
  registerMediaShortcuts();
  await bootstrap();

  if (app.isPackaged && !!appServer?.updates) {
    appServer.updates.checkForUpdates();
  }
}
