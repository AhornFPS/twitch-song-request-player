import { spawn } from "node:child_process";
import path from "node:path";
import express from "express";
import http from "node:http";
import { Server as SocketServer } from "socket.io";
import { createConfigStore, hasRequiredSettings } from "./config.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { PlaylistRepository } from "./playlist-repository.js";
import { PlayerController } from "./player-controller.js";
import { TwitchBotService } from "./twitch-bot-service.js";

function buildRuntimeUrls(activePort) {
  return {
    dashboardUrl: `http://localhost:${activePort}/`,
    overlayUrl: `http://localhost:${activePort}/overlay`
  };
}

function settingsChanged(previousSettings, nextSettings, keys) {
  return keys.some((key) => previousSettings[key] !== nextSettings[key]);
}

function buildSettingsPayload({ settings, activePort, themeOptions, twitchStatus }) {
  const urls = buildRuntimeUrls(activePort);

  return {
    settings,
    themeOptions,
    twitchStatus,
    runtime: {
      activePort,
      pendingRestart: settings.port !== activePort,
      configured: hasRequiredSettings(settings),
      ...urls
    }
  };
}

function buildRuntimeStatusPayload({ settings, activePort, twitchStatus }) {
  const urls = buildRuntimeUrls(activePort);

  return {
    twitchStatus,
    runtime: {
      activePort,
      pendingRestart: settings.port !== activePort,
      configured: hasRequiredSettings(settings),
      ...urls
    }
  };
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      return;
    }

    const command = process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch (error) {
    logWarn("Failed to open dashboard in browser", {
      message: error?.message ?? String(error),
      url
    });
  }
}

export async function startAppServer({
  forceSetup = false,
  noBrowser = false,
  configStore = createConfigStore()
} = {}) {
  const runtimeConfig = await configStore.loadRuntimeConfig();
  let currentSettings = runtimeConfig.settings;

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: {
      origin: "*"
    }
  });
  const activeConnections = new Set();

  const playlistRepository = new PlaylistRepository(runtimeConfig.playlistPath);
  await playlistRepository.init();

  const playerController = new PlayerController({
    io,
    playlistRepository
  });
  const twitchBotService = new TwitchBotService({
    playerController
  });

  app.use(express.json());

  app.get("/api/state", (_request, response) => {
    response.json({
      ...playerController.getPublicState(),
      theme: currentSettings.theme
    });
  });

  app.get("/api/settings", (_request, response) => {
    response.json(
      buildSettingsPayload({
        settings: currentSettings,
        activePort: runtimeConfig.port,
        themeOptions: configStore.getThemeOptions(),
        twitchStatus: twitchBotService.getStatus()
      })
    );
  });

  app.get("/api/runtime-status", (_request, response) => {
    response.json(
      buildRuntimeStatusPayload({
        settings: currentSettings,
        activePort: runtimeConfig.port,
        twitchStatus: twitchBotService.getStatus()
      })
    );
  });

  app.put("/api/settings", async (request, response) => {
    try {
      const previousSettings = currentSettings;
      const previousTwitchStatus = twitchBotService.getStatus();
      const nextSettings = await configStore.saveSettings({
        ...currentSettings,
        ...(request.body ?? {})
      });

      currentSettings = nextSettings;

      const botSettingsChanged = settingsChanged(previousSettings, nextSettings, [
        "twitchChannel",
        "twitchUsername",
        "twitchOauthToken",
        "twitchClientId",
        "twitchClientSecret",
        "youtubeApiKey"
      ]);

      const shouldReconnectBot =
        botSettingsChanged ||
        (hasRequiredSettings(currentSettings) && previousTwitchStatus.state !== "connected");
      const themeChanged = previousSettings.theme !== nextSettings.theme;
      const portChanged = previousSettings.port !== nextSettings.port;
      const twitchStatus = shouldReconnectBot
        ? await twitchBotService.applySettings(currentSettings)
        : previousTwitchStatus;

      if (themeChanged) {
        io.emit("app:settings", {
          theme: currentSettings.theme
        });
      }

      response.json({
        ...buildSettingsPayload({
          settings: currentSettings,
          activePort: runtimeConfig.port,
          themeOptions: configStore.getThemeOptions(),
          twitchStatus
        }),
        saveSummary: {
          themeChanged,
          botReconnected: shouldReconnectBot && twitchStatus.state === "connected",
          restartRequired: portChanged
        }
      });
    } catch (error) {
      logError("Failed to save settings", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to save settings."
      });
    }
  });

  app.post("/api/player-event", async (request, response) => {
    try {
      logInfo("HTTP player event received", request.body);
      await playerController.handlePlayerEvent(request.body);
      response.status(204).end();
    } catch (error) {
      logError("Failed to process player event", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).end();
    }
  });

  app.post("/api/client-log", (request, response) => {
    const level = typeof request.body?.level === "string" ? request.body.level : "info";
    const message = typeof request.body?.message === "string" ? request.body.message : "Client log";
    const details = request.body?.details;

    if (level === "warn") {
      logWarn(`Browser source: ${message}`, details);
    } else if (level === "error") {
      logError(`Browser source: ${message}`, details);
    } else {
      logInfo(`Browser source: ${message}`, details);
    }

    response.status(204).end();
  });

  app.get("/", (_request, response) => {
    response.sendFile(path.join(runtimeConfig.publicDir, "index.html"));
  });

  app.get("/overlay", (_request, response) => {
    response.sendFile(path.join(runtimeConfig.publicDir, "overlay.html"));
  });

  app.use(express.static(runtimeConfig.publicDir));

  server.on("connection", (socket) => {
    activeConnections.add(socket);

    socket.on("close", () => {
      activeConnections.delete(socket);
    });
  });

  io.on("connection", (socket) => {
    playerController.handleSocketConnection(socket);
  });

  await new Promise((resolve) => {
    server.listen(runtimeConfig.port, resolve);
  });

  const urls = buildRuntimeUrls(runtimeConfig.port);
  logInfo("Server listening", urls);

  if ((forceSetup || !hasRequiredSettings(currentSettings)) && !noBrowser) {
    openBrowser(urls.dashboardUrl);
  }

  void (async () => {
    try {
      await twitchBotService.applySettings(currentSettings);
      await playerController.ensurePlayback();
    } catch (error) {
      logError("Deferred startup tasks failed", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
    }
  })();

  return {
    app,
    io,
    server,
    urls,
    runtimeConfig,
    getCurrentSettings() {
      return { ...currentSettings };
    },
    async close() {
      await twitchBotService.disconnect();
      io.disconnectSockets(true);
      io.close();

      const closeServerPromise = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }

      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }

      for (const socket of activeConnections) {
        socket.destroy();
      }

      await closeServerPromise;
    }
  };
}
