import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConfigStore } from "../src/config.js";
import { startAppServer } from "../src/app-server.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRootDir = path.resolve(moduleDir, "..");

export async function bootstrapDesktopApp(electron) {
  const { app, BrowserWindow, dialog, shell } = electron;

  let mainWindow = null;
  let appServer = null;
  let isShuttingDown = false;

  function getRuntimeDir() {
    const isPackagedApp =
      app.isPackaged ||
      app.getAppPath().includes("app.asar");

    if (isPackagedApp) {
      const candidateDirs = [
        process.env.PORTABLE_EXECUTABLE_DIR,
        process.env.PORTABLE_EXECUTABLE_FILE
          ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE)
          : "",
        process.argv[0] ? path.dirname(process.argv[0]) : "",
        process.cwd(),
        path.dirname(app.getPath("exe"))
      ].filter(Boolean);

      for (const candidateDir of candidateDirs) {
        const settingsFile = path.join(candidateDir, "settings.json");
        if (fs.existsSync(settingsFile)) {
          return candidateDir;
        }
      }

      for (const candidateDir of candidateDirs) {
        const playlistFile = path.join(candidateDir, "playlist.csv");
        if (fs.existsSync(playlistFile)) {
          return candidateDir;
        }
      }

      return candidateDirs[0] || path.dirname(app.getPath("exe"));
    }

    return appRootDir;
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

    appServer = await startAppServer({
      noBrowser: true,
      configStore
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

  async function shutdownAndExit(exitCode = 0) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

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
  await bootstrap();
}
