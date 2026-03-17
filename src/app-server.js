import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import http from "node:http";
import { Server as SocketServer } from "socket.io";
import { createRequire } from "node:module";
import { createConfigStore, hasRequiredSettings } from "./config.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { PlaylistRepository } from "./playlist-repository.js";
import { PlayerController } from "./player-controller.js";
import { resolveSongRequest } from "./providers.js";
import { TwitchBotService } from "./twitch-bot-service.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

function buildRuntimeUrls(activePort) {
  return {
    dashboardUrl: `http://localhost:${activePort}/`,
    overlayUrl: `http://localhost:${activePort}/overlay`
  };
}

function toClientSettings(settings) {
  const {
    twitchRefreshToken,
    ...clientSettings
  } = settings;

  return clientSettings;
}

function settingsChanged(previousSettings, nextSettings, keys) {
  return keys.some((key) => previousSettings[key] !== nextSettings[key]);
}

function buildSettingsPayload({
  settings,
  activePort,
  usingFallbackPort,
  themeOptions,
  dashboardLayoutOptions,
  twitchStatus,
  twitchAuthStatus
}) {
  const urls = buildRuntimeUrls(activePort);

  return {
    settings: toClientSettings(settings),
    themeOptions,
    dashboardLayoutOptions,
    twitchStatus,
    twitchAuthStatus,
    runtime: {
      activePort,
      configuredPort: settings.port,
      usingFallbackPort,
      pendingRestart: settings.port !== activePort,
      configured: hasRequiredSettings(settings),
      ...urls
    }
  };
}

function buildRuntimeStatusPayload({ settings, activePort, usingFallbackPort, twitchStatus, twitchAuthStatus }) {
  const urls = buildRuntimeUrls(activePort);

  return {
    twitchStatus,
    twitchAuthStatus,
    runtime: {
      activePort,
      configuredPort: settings.port,
      usingFallbackPort,
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

function getListeningPort(server, fallbackPort) {
  const address = server.address();
  return typeof address === "object" && address
    ? address.port
    : fallbackPort;
}

async function listenOnPort(server, port) {
  return await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.off("error", handleError);
      resolve(getListeningPort(server, port));
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port);
  });
}

export async function startAppServer({
  forceSetup = false,
  noBrowser = false,
  configStore = createConfigStore(),
  updateService = null
} = {}) {
  const runtimeConfig = await configStore.loadRuntimeConfig();
  const overlayBuildToken = `${packageJson.version}-${Date.now().toString(36)}`;
  let currentSettings = runtimeConfig.settings;
  let activePort = currentSettings.port;
  let usingFallbackPort = false;

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: {
      origin: "*"
    }
  });
  const activeConnections = new Set();

  const playlistRepository = new PlaylistRepository(runtimeConfig.playlistPath, {
    youtubeApiKey: currentSettings.youtubeApiKey
  });
  await playlistRepository.init();

  const playerController = new PlayerController({
    io,
    playlistRepository
  });
  const twitchBotService = new TwitchBotService({
    playerController,
    persistSettings: async (partialSettings) => {
      const nextSettings = await configStore.saveSettings({
        ...currentSettings,
        ...partialSettings
      });
      currentSettings = nextSettings;
      return nextSettings;
    }
  });

  if (updateService) {
    updateService.on("status-changed", (status) => {
      io.emit("app:updater-status", status);
    });
  }

  app.use(express.json());

  app.get("/api/updater", (_request, response) => {
    if (!updateService) {
      return response.json({ state: "idle", version: null, releaseNotes: null, progress: 0, error: null, appVersion: packageJson.version });
    }
    response.json(updateService.getStatus());
  });

  app.post("/api/updater/download", (_request, response) => {
    if (updateService) {
      updateService.downloadUpdate();
    }
    response.status(204).end();
  });

  app.post("/api/updater/install", (_request, response) => {
    if (updateService) {
      updateService.installUpdate();
    }
    response.status(204).end();
  });

  app.get("/api/state", (_request, response) => {
    response.json({
      ...playerController.getPublicState(),
      theme: currentSettings.theme,
      overlayBuildToken
    });
  });

  app.get("/api/settings", (_request, response) => {
    response.json(
      buildSettingsPayload({
        settings: currentSettings,
        activePort,
        usingFallbackPort,
        themeOptions: configStore.getThemeOptions(),
        dashboardLayoutOptions: configStore.getDashboardLayoutOptions(),
        twitchStatus: twitchBotService.getStatus(),
        twitchAuthStatus: twitchBotService.getAuthStatus()
      })
    );
  });

  app.get("/api/runtime-status", (_request, response) => {
    response.json(
      buildRuntimeStatusPayload({
        settings: currentSettings,
        activePort,
        usingFallbackPort,
        twitchStatus: twitchBotService.getStatus(),
        twitchAuthStatus: twitchBotService.getAuthStatus()
      })
    );
  });

  app.get("/api/playlist/tracks", (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const page = typeof request.query.page === "string" ? request.query.page : "1";
    const pageSize = typeof request.query.pageSize === "string" ? request.query.pageSize : "100";

    response.json(playlistRepository.listTracks({
      query,
      page,
      pageSize
    }));
  });

  app.post("/api/queue", async (request, response) => {
    try {
      const input = typeof request.body?.input === "string" ? request.body.input.trim() : "";

      if (!input) {
        response.status(400).json({
          error: "Track input is required."
        });
        return;
      }

      const track = await resolveSongRequest(input, currentSettings.youtubeApiKey);
      const queuedTrack = await playerController.addRequest({
        ...track,
        requestedBy: {
          username: "dashboard",
          displayName: "Dashboard"
        }
      });

      response.json({
        track: queuedTrack,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to add queued track from dashboard", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(400).json({
        error: error?.message ?? "Failed to add track to queue."
      });
    }
  });

  app.post("/api/playlist/tracks", async (request, response) => {
    try {
      const input = typeof request.body?.input === "string" ? request.body.input.trim() : "";

      if (!input) {
        response.status(400).json({
          error: "Track input is required."
        });
        return;
      }

      const track = await resolveSongRequest(input, currentSettings.youtubeApiKey);
      const added = await playlistRepository.appendTrack(track);

      response.json({
        added,
        alreadyExists: !added,
        track: {
          key: track.key,
          url: track.url,
          title: track.title,
          provider: track.provider
        }
      });
    } catch (error) {
      logError("Failed to add playlist track", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(400).json({
        error: error?.message ?? "Failed to add track to playlist."
      });
    }
  });

  app.delete("/api/playlist/tracks/:trackKey", async (request, response) => {
    try {
      const trackKey = decodeURIComponent(request.params.trackKey || "");
      const removed = await playlistRepository.removeTrackByKey(trackKey);

      if (!removed) {
        response.status(404).json({
          error: "Track not found in playlist."
        });
        return;
      }

      response.status(204).end();
    } catch (error) {
      logError("Failed to delete playlist track", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to delete playlist track."
      });
    }
  });

  app.post("/api/playlist/import", async (request, response) => {
    try {
      const csvText = typeof request.body?.csvText === "string" ? request.body.csvText : "";
      const mode = request.body?.mode === "replace" ? "replace" : "append";
      const summary = await playlistRepository.importFromCsv(csvText, { mode });

      response.json(summary);
    } catch (error) {
      logError("Failed to import playlist CSV", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(400).json({
        error: error?.message ?? "Failed to import playlist CSV."
      });
    }
  });

  app.get("/api/playlist/export", (_request, response) => {
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="playlist-export.csv"');
    response.send(playlistRepository.exportCsv());
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
      playlistRepository.setYoutubeApiKey(nextSettings.youtubeApiKey);

      const botSettingsChanged = settingsChanged(previousSettings, nextSettings, [
        "twitchChannel",
        "twitchUsername",
        "twitchOauthToken",
        "twitchRefreshToken",
        "twitchClientId",
        "twitchClientSecret",
        "chatSuppressedCategories",
        "playbackSuppressedCategories",
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
          activePort,
          usingFallbackPort,
          themeOptions: configStore.getThemeOptions(),
          dashboardLayoutOptions: configStore.getDashboardLayoutOptions(),
          twitchStatus,
          twitchAuthStatus: twitchBotService.getAuthStatus()
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

  app.post("/api/twitch-auth/device/start", async (request, response) => {
    try {
      currentSettings = await configStore.saveSettings({
        ...currentSettings,
        twitchChannel: request.body?.twitchChannel ?? currentSettings.twitchChannel,
        twitchClientId: request.body?.twitchClientId ?? currentSettings.twitchClientId,
        twitchClientSecret: request.body?.twitchClientSecret ?? currentSettings.twitchClientSecret
      });

      await twitchBotService.startDeviceAuth(currentSettings);

      response.json(
        buildSettingsPayload({
          settings: currentSettings,
          activePort,
          usingFallbackPort,
          themeOptions: configStore.getThemeOptions(),
          dashboardLayoutOptions: configStore.getDashboardLayoutOptions(),
          twitchStatus: twitchBotService.getStatus(),
          twitchAuthStatus: twitchBotService.getAuthStatus()
        })
      );
    } catch (error) {
      logError("Failed to start Twitch device auth", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to start Twitch login."
      });
    }
  });

  app.post("/api/twitch-auth/device/cancel", (_request, response) => {
    response.json({
      twitchAuthStatus: twitchBotService.cancelDeviceAuth()
    });
  });

  app.post("/api/open-runtime-dir", (_request, response) => {
    try {
      if (process.platform === "win32") {
        spawn("explorer", [runtimeConfig.runtimeDir], { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "darwin") {
        spawn("open", [runtimeConfig.runtimeDir], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("xdg-open", [runtimeConfig.runtimeDir], { detached: true, stdio: "ignore" }).unref();
      }
      response.status(204).end();
    } catch (error) {
      logError("Failed to open runtime directory", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).end();
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

  app.post("/api/playback/play-pause", async (_request, response) => {
    try {
      const result = await playerController.playOrPausePlayback("dashboard");
      response.json({
        result,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to toggle dashboard playback", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to toggle playback."
      });
    }
  });

  app.post("/api/playback/stop", async (_request, response) => {
    try {
      const result = await playerController.stopPlayback("dashboard");
      response.json({
        result,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to stop dashboard playback", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to stop playback."
      });
    }
  });

  app.post("/api/playback/next", async (_request, response) => {
    try {
      const result = await playerController.skipToNextTrack("dashboard");
      response.json({
        result,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to advance dashboard playback", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to play the next track."
      });
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

  app.get("/overlay", async (_request, response) => {
    try {
      const overlayTemplate = await fs.readFile(path.join(runtimeConfig.publicDir, "overlay.html"), "utf8");
      const overlayHtml = overlayTemplate.split("__OVERLAY_BUILD_TOKEN__").join(overlayBuildToken);
      response.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.set("Pragma", "no-cache");
      response.set("Expires", "0");
      response.type("html").send(overlayHtml);
    } catch (error) {
      logError("Failed to serve overlay HTML", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).send("Could not load overlay.");
    }
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

  try {
    activePort = await listenOnPort(server, currentSettings.port);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }

    logWarn("Configured port is already in use, falling back to a free port", {
      configuredPort: currentSettings.port
    });
    usingFallbackPort = true;
    activePort = await listenOnPort(server, 0);
  }

  const urls = buildRuntimeUrls(activePort);
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
    updates: updateService,
    async togglePauseCurrentTrack(triggeredBy = "desktop_media_key") {
      return playerController.playOrPausePlayback(triggeredBy);
    },
    async skipCurrentTrack(triggeredBy = "desktop_media_key") {
      return playerController.skipToNextTrack(triggeredBy);
    },
    async close() {
      await twitchBotService.disconnect();
      io.disconnectSockets(true);
      io.close();
      
      if (updateService) {
        updateService.removeAllListeners();
      }

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
