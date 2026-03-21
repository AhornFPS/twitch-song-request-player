// @ts-nocheck
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import { Server as SocketServer } from "socket.io";
import { validateChatCommands } from "./chat-commands.js";
import { createConfigStore, hasRequiredSettings } from "./config.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { PlaylistRepository } from "./playlist-repository.js";
import { PlayerController } from "./player-controller.js";
import { resolveSongRequest } from "./providers.js";
import { RequestAuditStore } from "./request-audit-store.js";
import { RuntimeStateStore } from "./runtime-state-store.js";
import { TwitchBotService } from "./twitch-bot-service.js";

function loadAppVersion() {
  const moduleDir = path.resolve(
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url))
  );
  const candidatePaths = [
    path.join(process.cwd(), "package.json"),
    path.resolve(moduleDir, "../package.json"),
    path.resolve(moduleDir, "../../package.json")
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const packageJson = JSON.parse(readFileSync(candidatePath, "utf8"));
      if (typeof packageJson?.version === "string" && packageJson.version.trim()) {
        return packageJson.version.trim();
      }
    } catch {
    }
  }

  return process.env.npm_package_version?.trim() || "0.0.0";
}

const appVersion = loadAppVersion();

function buildRuntimeUrls(activePort) {
  return {
    dashboardUrl: `http://localhost:${activePort}/`,
    overlayUrl: `http://localhost:${activePort}/overlay`
  };
}

function buildObsOverlayLoaderPath(runtimeDir) {
  return path.join(runtimeDir, "obs-overlay-loader.html");
}

function buildObsOverlayLoaderHtml({ overlayUrl, appVersion }) {
  const overlayBaseUrl = `${overlayUrl}${overlayUrl.includes("?") ? "&" : "?"}obsLoader=1`;
  const serializedOverlayBaseUrl = JSON.stringify(overlayBaseUrl);
  const serializedAppVersion = JSON.stringify(appVersion);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Twitch Song Request Player OBS Loader</title>
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
      }

      body {
        color: transparent;
        font: 12px/1.4 Arial, sans-serif;
      }

      #overlay-frame {
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
      }

      #loader-status {
        position: fixed;
        left: -9999px;
        top: -9999px;
      }
    </style>
  </head>
  <body>
    <div id="loader-status" aria-live="polite">Waiting for the local player service.</div>
    <iframe id="overlay-frame" title="Twitch Song Request Player OBS Overlay" allow="autoplay"></iframe>
    <script>
      const overlayBaseUrl = ${serializedOverlayBaseUrl};
      const appVersion = ${serializedAppVersion};
      const retryIntervalMs = 2000;
      const overlayFrame = document.getElementById("overlay-frame");
      const loaderStatus = document.getElementById("loader-status");
      let retryTimer = null;
      let overlayReady = false;

      function buildOverlayUrl() {
        const separator = overlayBaseUrl.includes("?") ? "&" : "?";
        return overlayBaseUrl + separator + "loaderAttempt=" + Date.now().toString(36);
      }

      function setLoaderStatus(message) {
        if (loaderStatus) {
          loaderStatus.textContent = message;
        }
      }

      function loadOverlay() {
        if (!overlayFrame || overlayReady) {
          return;
        }

        overlayFrame.src = buildOverlayUrl();
        setLoaderStatus("Retrying the local player service.");
      }

      function scheduleRetry() {
        if (retryTimer || overlayReady) {
          return;
        }

        retryTimer = window.setInterval(loadOverlay, retryIntervalMs);
      }

      function stopRetry() {
        if (!retryTimer) {
          return;
        }

        window.clearInterval(retryTimer);
        retryTimer = null;
      }

      window.addEventListener("message", (event) => {
        if (event.data?.type !== "tsrp:overlay-ready") {
          return;
        }

        overlayReady = true;
        stopRetry();
        setLoaderStatus("Local player service connected.");
      });

      window.addEventListener("beforeunload", stopRetry);

      setLoaderStatus("Waiting for the local player service.");
      loadOverlay();
      scheduleRetry();
      console.info("Twitch Song Request Player OBS loader ready", {
        appVersion,
        overlayBaseUrl
      });
    </script>
  </body>
</html>
`;
}

async function writeObsOverlayLoaderFile({ runtimeDir, overlayUrl, appVersion }) {
  const overlayLoaderFilePath = buildObsOverlayLoaderPath(runtimeDir);
  const overlayLoaderHtml = buildObsOverlayLoaderHtml({
    overlayUrl,
    appVersion
  });
  await fs.writeFile(overlayLoaderFilePath, overlayLoaderHtml, "utf8");
  return overlayLoaderFilePath;
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
  runtimeDir,
  overlayLoaderFilePath,
  themeOptions,
  dashboardLayoutOptions,
  twitchStatus,
  twitchAuthStatus,
  desktopIntegration
}) {
  const urls = buildRuntimeUrls(activePort);

  return {
    settings: toClientSettings(settings),
    themeOptions,
    dashboardLayoutOptions,
    twitchStatus,
    twitchAuthStatus,
    desktopIntegration,
    runtime: {
      activePort,
      configuredPort: settings.port,
      usingFallbackPort,
      pendingRestart: settings.port !== activePort,
      configured: hasRequiredSettings(settings),
      overlayLoaderFilePath: overlayLoaderFilePath || buildObsOverlayLoaderPath(runtimeDir),
      ...urls
    }
  };
}

function buildRuntimeStatusPayload({
  settings,
  activePort,
  usingFallbackPort,
  runtimeDir,
  overlayLoaderFilePath,
  twitchStatus,
  twitchAuthStatus,
  desktopIntegration
}) {
  const urls = buildRuntimeUrls(activePort);

  return {
    twitchStatus,
    twitchAuthStatus,
    desktopIntegration,
    runtime: {
      activePort,
      configuredPort: settings.port,
      usingFallbackPort,
      pendingRestart: settings.port !== activePort,
      configured: hasRequiredSettings(settings),
      overlayLoaderFilePath: overlayLoaderFilePath || buildObsOverlayLoaderPath(runtimeDir),
      ...urls
    }
  };
}

function buildDiagnosticsExportPayload({
  settings,
  activePort,
  usingFallbackPort,
  runtimeDir,
  overlayLoaderFilePath,
  twitchStatus,
  twitchAuthStatus,
  playerState,
  requestAudit,
  desktopIntegration
}) {
  return {
    exportedAt: new Date().toISOString(),
    appVersion,
    settings: toClientSettings(settings),
    runtime: buildRuntimeStatusPayload({
      settings,
      activePort,
      usingFallbackPort,
      runtimeDir,
      overlayLoaderFilePath,
      twitchStatus,
      twitchAuthStatus,
      desktopIntegration
    }),
    state: playerState,
    requestAudit
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
  updateService = null,
  desktopIntegration = null
} = {}) {
  const runtimeConfig = await configStore.loadRuntimeConfig();
  const overlayBuildToken = `${appVersion}-${Date.now().toString(36)}`;
  let currentSettings = runtimeConfig.settings;
  let activePort = currentSettings.port;
  let usingFallbackPort = false;
  let overlayLoaderFilePath = buildObsOverlayLoaderPath(runtimeConfig.runtimeDir);

  async function getDesktopIntegrationState() {
    if (!desktopIntegration?.getState) {
      return {
        supported: false,
        enabled: false,
        reason: "This option is only available in the packaged Windows desktop app."
      };
    }

    return await desktopIntegration.getState();
  }

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: {
      origin: "*"
    }
  });
  const activeConnections = new Set();

  const playlistRepository = new PlaylistRepository(runtimeConfig.playlistPath, {
    healthPath: runtimeConfig.playlistHealthPath,
    youtubeApiKey: currentSettings.youtubeApiKey
  });
  await playlistRepository.init();
  const runtimeStateStore = new RuntimeStateStore(runtimeConfig.runtimeStatePath);
  const requestAuditStore = new RequestAuditStore(runtimeConfig.requestAuditPath);

  const playerController = new PlayerController({
    io,
    playlistRepository,
    runtimeStateStore,
    requestAuditStore,
    requestPolicy: currentSettings.requestPolicy
  });
  await playerController.restoreRuntimeState();
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
      return response.json({ state: "idle", version: null, releaseNotes: null, progress: 0, error: null, appVersion });
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
      overlayBuildToken,
      playerStartupTimeoutSeconds: currentSettings.playerStartupTimeoutSeconds
    });
  });

  app.get("/api/settings", (_request, response) => {
    void getDesktopIntegrationState().then((desktopIntegrationState) => {
      response.json(
      buildSettingsPayload({
        settings: currentSettings,
        activePort,
        usingFallbackPort,
        runtimeDir: runtimeConfig.runtimeDir,
        overlayLoaderFilePath,
        themeOptions: configStore.getThemeOptions(),
        dashboardLayoutOptions: configStore.getDashboardLayoutOptions(),
        twitchStatus: twitchBotService.getStatus(),
        twitchAuthStatus: twitchBotService.getAuthStatus(),
        desktopIntegration: desktopIntegrationState
      })
      );
    }).catch((error) => {
      logError("Failed to read desktop integration state", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: "Failed to read desktop integration state."
      });
    });
  });

  app.get("/api/runtime-status", (_request, response) => {
    void getDesktopIntegrationState().then((desktopIntegrationState) => {
      response.json(
      buildRuntimeStatusPayload({
        settings: currentSettings,
        activePort,
        usingFallbackPort,
        runtimeDir: runtimeConfig.runtimeDir,
        overlayLoaderFilePath,
        twitchStatus: twitchBotService.getStatus(),
        twitchAuthStatus: twitchBotService.getAuthStatus(),
        desktopIntegration: desktopIntegrationState
      })
      );
    }).catch((error) => {
      logError("Failed to read desktop integration state", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: "Failed to read desktop integration state."
      });
    });
  });

  app.get("/api/diagnostics/export", (_request, response) => {
    void getDesktopIntegrationState().then((desktopIntegrationState) => {
      const payload = buildDiagnosticsExportPayload({
        settings: currentSettings,
        activePort,
        usingFallbackPort,
        runtimeDir: runtimeConfig.runtimeDir,
        overlayLoaderFilePath,
        twitchStatus: twitchBotService.getStatus(),
        twitchAuthStatus: twitchBotService.getAuthStatus(),
        playerState: playerController.getPublicState(),
        requestAudit: playerController.getRequestAuditState(),
        desktopIntegration: desktopIntegrationState
      });

      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Content-Disposition", 'attachment; filename="diagnostics-export.json"');
      response.send(`${JSON.stringify(payload, null, 2)}\n`);
    }).catch((error) => {
      logError("Failed to read desktop integration state", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: "Failed to build diagnostics export."
      });
    });
  });

  app.get("/api/playlist/tracks", (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const page = typeof request.query.page === "string" ? request.query.page : "1";
    const pageSize = typeof request.query.pageSize === "string" ? request.query.pageSize : "100";
    const sortBy = typeof request.query.sortBy === "string" ? request.query.sortBy : "recent";

    response.json(playlistRepository.listTracks({
      query,
      page,
      pageSize,
      sortBy
    }));
  });

  app.get("/api/playlist/review", (request, response) => {
    const limit = typeof request.query.limit === "string" ? request.query.limit : "25";
    response.json(playlistRepository.listReviewTracks({ limit }));
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

      const track = await resolveSongRequest(input, currentSettings.youtubeApiKey, {
        allowSearchRequests: true,
        youtubeSafeSearch: currentSettings.requestPolicy?.youtubeSafeSearch
      });
      const queuedTrack = await playerController.addRequest({
        ...track,
        requestedBy: {
          username: "dashboard",
          displayName: "Dashboard"
        }
      }, {
        bypassRequestLimits: true,
        requestSource: "dashboard_queue",
        requestInput: input,
        requestContext: {
          endpoint: "/api/queue",
          triggeredBy: "dashboard"
        }
      });

      response.json({
        track: queuedTrack,
        state: playerController.getPublicState()
      });
    } catch (error) {
      await playerController.recordRequestOutcome({
        source: "dashboard_queue",
        outcome: "rejected",
        reason: error?.code ?? "dashboard_queue_error",
        message: error?.message ?? "Failed to add track to queue.",
        input: typeof request.body?.input === "string" ? request.body.input.trim() : "",
        requestedBy: {
          username: "dashboard",
          displayName: "Dashboard"
        },
        bypassRequestLimits: true,
        details: {
          endpoint: "/api/queue",
          triggeredBy: "dashboard"
        }
      });
      logError("Failed to add queued track from dashboard", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(400).json({
        error: error?.message ?? "Failed to add track to queue."
      });
    }
  });

  app.get("/api/queue", (_request, response) => {
    response.json({
      items: playerController.getPublicState().queue
    });
  });

  app.get("/api/history", (_request, response) => {
    response.json({
      items: playerController.getPublicState().history
    });
  });

  app.get("/api/request-log", (_request, response) => {
    response.json(playerController.getRequestAuditState());
  });

  app.delete("/api/queue/:trackId", async (request, response) => {
    try {
      const removedTrack = await playerController.removeQueuedTrack(request.params.trackId || "", "dashboard");

      if (!removedTrack) {
        response.status(404).json({
          error: "Queued track not found."
        });
        return;
      }

      response.json({
        track: removedTrack,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to remove queued track", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to remove queued track."
      });
    }
  });

  app.post("/api/queue/:trackId/promote", async (request, response) => {
    try {
      const promotedTrack = await playerController.promoteQueuedTrack(request.params.trackId || "", "dashboard");

      if (!promotedTrack) {
        response.status(404).json({
          error: "Queued track not found."
        });
        return;
      }

      response.json({
        track: promotedTrack,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to promote queued track", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to promote queued track."
      });
    }
  });

  app.post("/api/queue/:trackId/move", async (request, response) => {
    try {
      const direction = request.body?.direction === "down" ? "down" : "up";
      const movedTrack = await playerController.moveQueuedTrack(
        request.params.trackId || "",
        direction === "down" ? 1 : -1,
        "dashboard"
      );

      if (!movedTrack) {
        response.status(404).json({
          error: "Queued track not found."
        });
        return;
      }

      response.json({
        track: movedTrack,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to move queued track", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to move queued track."
      });
    }
  });

  app.post("/api/queue/clear", async (_request, response) => {
    try {
      const result = await playerController.clearQueue("dashboard");
      response.json({
        result,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to clear queue", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to clear queue."
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

      const track = await resolveSongRequest(input, currentSettings.youtubeApiKey, {
        allowSearchRequests: true,
        youtubeSafeSearch: currentSettings.requestPolicy?.youtubeSafeSearch
      });
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

  app.patch("/api/playlist/tracks/:trackKey", async (request, response) => {
    try {
      const trackKey = decodeURIComponent(request.params.trackKey || "");
      const updatedTrack = await playlistRepository.updateTrackTitleByKey(trackKey, request.body?.title);

      if (!updatedTrack) {
        response.status(404).json({
          error: "Track not found in playlist."
        });
        return;
      }

      response.json({
        track: updatedTrack
      });
    } catch (error) {
      logError("Failed to update playlist track title", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(400).json({
        error: error?.message ?? "Failed to update the playlist track title."
      });
    }
  });

  app.post("/api/playlist/tracks/:trackKey/refresh-metadata", async (request, response) => {
    try {
      const trackKey = decodeURIComponent(request.params.trackKey || "");
      const refreshedTrack = await playlistRepository.refreshTrackMetadataByKey(trackKey);

      if (!refreshedTrack) {
        response.status(404).json({
          error: "Track not found in playlist."
        });
        return;
      }

      response.json({
        track: refreshedTrack
      });
    } catch (error) {
      logError("Failed to refresh playlist track metadata", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(400).json({
        error: error?.message ?? "Failed to refresh playlist metadata."
      });
    }
  });

  app.post("/api/playlist/bulk-delete", async (request, response) => {
    try {
      const trackKeys = Array.isArray(request.body?.trackKeys) ? request.body.trackKeys : [];
      const result = await playlistRepository.removeTracksByKeys(trackKeys);

      response.json({
        result,
        playlist: playlistRepository.listTracks()
      });
    } catch (error) {
      logError("Failed to bulk delete playlist tracks", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to delete the selected playlist tracks."
      });
    }
  });

  app.post("/api/playlist/bulk-queue", async (request, response) => {
    try {
      const trackKeys = Array.isArray(request.body?.trackKeys) ? request.body.trackKeys : [];
      const uniqueTrackKeys = Array.from(
        new Set(
          trackKeys
            .map((trackKey) => typeof trackKey === "string" ? trackKey.trim() : "")
            .filter(Boolean)
        )
      );
      const queuedTracks = [];
      let duplicateCount = 0;

      for (const trackKey of uniqueTrackKeys) {
        const track = playlistRepository.getTrackForKey(trackKey);
        if (!track) {
          continue;
        }

        const queuedTrack = await playerController.addRequest({
          ...track,
          requestedBy: {
            username: "dashboard",
            displayName: "Dashboard"
          }
        }, {
          bypassRequestLimits: true,
          requestSource: "dashboard_bulk_queue",
          requestInput: track.url || track.key || "",
          requestContext: {
            endpoint: "/api/playlist/bulk-queue",
            triggeredBy: "dashboard",
            trackKey
          }
        });

        if (queuedTrack.alreadyQueued || queuedTrack.duplicateType) {
          duplicateCount += 1;
          continue;
        }

        queuedTracks.push(queuedTrack);
      }

      response.json({
        result: {
          requestedCount: uniqueTrackKeys.length,
          queuedCount: queuedTracks.length,
          duplicateCount
        },
        tracks: queuedTracks,
        state: playerController.getPublicState()
      });
    } catch (error) {
      logError("Failed to bulk queue playlist tracks", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
      response.status(500).json({
        error: error?.message ?? "Failed to queue the selected playlist tracks."
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

  app.post("/api/playlist/export-selected", (request, response) => {
    const trackKeys = Array.isArray(request.body?.trackKeys) ? request.body.trackKeys : [];
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="playlist-selected-export.csv"');
    response.send(playlistRepository.exportSelectedCsv(trackKeys));
  });

  app.put("/api/settings", async (request, response) => {
    try {
      if (request.body?.chatCommands) {
        const issues = validateChatCommands(request.body.chatCommands);
        if (issues.length > 0) {
          response.status(400).json({
            error: issues[0]
          });
          return;
        }
      }

      const previousSettings = currentSettings;
      const previousTwitchStatus = twitchBotService.getStatus();
      const nextSettings = await configStore.saveSettings({
        ...currentSettings,
        ...(request.body ?? {})
      });

      currentSettings = nextSettings;
      playlistRepository.setYoutubeApiKey(nextSettings.youtubeApiKey);
      playerController.setRequestPolicy(nextSettings.requestPolicy);

      if (
        Object.prototype.hasOwnProperty.call(request.body ?? {}, "startWithWindows") &&
        desktopIntegration?.setEnabled
      ) {
        const desktopIntegrationState = await desktopIntegration.setEnabled(nextSettings.startWithWindows);
        if (desktopIntegrationState.supported && desktopIntegrationState.enabled !== nextSettings.startWithWindows) {
          currentSettings = await configStore.saveSettings({
            ...nextSettings,
            startWithWindows: desktopIntegrationState.enabled
          });
        }
      }

      const botSettingsChanged = settingsChanged(previousSettings, nextSettings, [
        "twitchChannel",
        "twitchUsername",
        "twitchOauthToken",
        "twitchRefreshToken",
        "twitchClientId",
        "twitchClientSecret",
        "chatSuppressedCategories",
        "playbackSuppressedCategories",
        "youtubeApiKey",
        "requestPolicy",
        "chatCommands"
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

      if (previousSettings.playerStartupTimeoutSeconds !== nextSettings.playerStartupTimeoutSeconds) {
        io.emit("app:settings", {
          theme: currentSettings.theme,
          playerStartupTimeoutSeconds: currentSettings.playerStartupTimeoutSeconds
        });
      }

      response.json({
        ...buildSettingsPayload({
          settings: currentSettings,
          activePort,
          usingFallbackPort,
          runtimeDir: runtimeConfig.runtimeDir,
          overlayLoaderFilePath,
          themeOptions: configStore.getThemeOptions(),
          dashboardLayoutOptions: configStore.getDashboardLayoutOptions(),
          twitchStatus,
          twitchAuthStatus: twitchBotService.getAuthStatus(),
          desktopIntegration: await getDesktopIntegrationState()
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
          runtimeDir: runtimeConfig.runtimeDir,
          overlayLoaderFilePath,
          themeOptions: configStore.getThemeOptions(),
          dashboardLayoutOptions: configStore.getDashboardLayoutOptions(),
          twitchStatus: twitchBotService.getStatus(),
          twitchAuthStatus: twitchBotService.getAuthStatus(),
          desktopIntegration: await getDesktopIntegrationState()
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
  try {
    overlayLoaderFilePath = await writeObsOverlayLoaderFile({
      runtimeDir: runtimeConfig.runtimeDir,
      overlayUrl: urls.overlayUrl,
      appVersion
    });
  } catch (error) {
    logWarn("Failed to write OBS overlay loader file", {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      runtimeDir: runtimeConfig.runtimeDir
    });
  }
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
