import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startAppServer } from "./app-server.js";
import { createConfigStore } from "./config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRootDir = path.resolve(moduleDir, "..");
const isolatedEnvKeys = [
  "TWITCH_CHANNEL",
  "TWITCH_USERNAME",
  "TWITCH_OAUTH_TOKEN",
  "TWITCH_REFRESH_TOKEN",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "CHAT_SUPPRESSED_CATEGORIES",
  "PLAYBACK_SUPPRESSED_CATEGORIES",
  "YOUTUBE_API_KEY",
  "PORT",
  "THEME",
  "DASHBOARD_LAYOUT"
];

function snapshotEnv(keys) {
  return Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
}

function restoreEnv(snapshot) {
  Object.entries(snapshot).forEach(([key, value]) => {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  });
}

function clearEnv(keys) {
  keys.forEach((key) => {
    delete process.env[key];
  });
}

async function getAvailablePort() {
  const probe = net.createServer();

  return await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;

      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function createJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

test("app server closes even when a client keeps a connection open", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;
  let closeStarted = false;
  let lingeringSocket = null;

  t.after(async () => {
    lingeringSocket?.destroy();

    if (appServer && !closeStarted) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);
  const port = await getAvailablePort();
  process.env.PORT = String(port);
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,Test Track\n",
    "utf8"
  );

  const configStore = createConfigStore({
    rootDir: appRootDir,
    runtimeDir,
    publicDir: path.join(appRootDir, "public")
  });

  appServer = await startAppServer({
    noBrowser: true,
    configStore
  });

  lingeringSocket = net.createConnection({
    host: "127.0.0.1",
    port
  });
  lingeringSocket.on("error", () => {});

  await new Promise((resolve, reject) => {
    lingeringSocket.once("connect", resolve);
    lingeringSocket.once("error", reject);
  });
  lingeringSocket.write("GET /api/state HTTP/1.1\r\nHost: localhost\r\n");

  closeStarted = true;
  const socketClosed = new Promise((resolve) => {
    lingeringSocket.once("close", resolve);
  });
  await Promise.race([
    appServer.close(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Timed out waiting for app server shutdown."));
      }, 1500);
    })
  ]);

  await Promise.race([
    socketClosed,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Timed out waiting for lingering client socket to close."));
      }, 1500);
    })
  ]);

  assert.equal(lingeringSocket.destroyed, true);
});

test("partial settings save updates only the theme without touching other fields", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;

  t.after(async () => {
    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  const initialSettings = {
    twitchChannel: "demo-channel",
    twitchUsername: "demo-bot",
    youtubeApiKey: "youtube-key",
    port,
    guiPlayerEnabled: false,
    guiPlayerVolume: 42,
    theme: "aurora"
  };

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify(initialSettings, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,Test Track\n",
    "utf8"
  );

  const configStore = createConfigStore({
    rootDir: appRootDir,
    runtimeDir,
    publicDir: path.join(appRootDir, "public")
  });

  appServer = await startAppServer({
    noBrowser: true,
    configStore
  });

  const response = await fetch(new URL("/api/settings", appServer.urls.dashboardUrl), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      theme: "winamp"
    })
  });

  assert.equal(response.ok, true);

  const payload = await response.json();
  assert.equal(payload.settings.theme, "winamp");
  assert.equal(payload.settings.dashboardLayout, "atlas");
  assert.equal(payload.settings.port, port);
  assert.equal(payload.settings.guiPlayerEnabled, false);
  assert.equal(payload.settings.guiPlayerVolume, 42);
  assert.equal(payload.settings.youtubeApiKey, initialSettings.youtubeApiKey);
  assert.equal(Array.isArray(payload.dashboardLayoutOptions), true);
  assert.deepEqual(payload.dashboardLayoutOptions.map((layout) => layout.id), ["atlas"]);

  const persistedSettings = JSON.parse(
    await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8")
  );
  assert.equal(persistedSettings.theme, "winamp");
  assert.equal(persistedSettings.dashboardLayout, "atlas");
  assert.equal(persistedSettings.port, port);
  assert.equal(persistedSettings.guiPlayerEnabled, false);
  assert.equal(persistedSettings.guiPlayerVolume, 42);
  assert.equal(persistedSettings.youtubeApiKey, initialSettings.youtubeApiKey);
});

test("partial settings save updates the GUI player state without touching other fields", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;

  t.after(async () => {
    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port, guiPlayerEnabled: false, guiPlayerVolume: 42, theme: "aurora" }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,Test Track\n",
    "utf8"
  );

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  const response = await fetch(new URL("/api/settings", appServer.urls.dashboardUrl), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      guiPlayerEnabled: true
    })
  });

  assert.equal(response.ok, true);

  const payload = await response.json();
  assert.equal(payload.settings.guiPlayerEnabled, true);
  assert.equal(payload.settings.guiPlayerVolume, 42);
  assert.equal(payload.settings.theme, "aurora");
  assert.equal(payload.settings.port, port);

  const persistedSettings = JSON.parse(
    await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8")
  );
  assert.equal(persistedSettings.guiPlayerEnabled, true);
  assert.equal(persistedSettings.guiPlayerVolume, 42);
  assert.equal(persistedSettings.theme, "aurora");
  assert.equal(persistedSettings.port, port);
});

test("partial settings save updates the GUI player volume without touching other fields", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;

  t.after(async () => {
    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port, guiPlayerEnabled: true, guiPlayerVolume: 15, theme: "aurora" }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,Test Track\n",
    "utf8"
  );

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  const response = await fetch(new URL("/api/settings", appServer.urls.dashboardUrl), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      guiPlayerVolume: 67
    })
  });

  assert.equal(response.ok, true);

  const payload = await response.json();
  assert.equal(payload.settings.guiPlayerEnabled, true);
  assert.equal(payload.settings.guiPlayerVolume, 67);
  assert.equal(payload.settings.theme, "aurora");
  assert.equal(payload.settings.port, port);

  const persistedSettings = JSON.parse(
    await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8")
  );
  assert.equal(persistedSettings.guiPlayerEnabled, true);
  assert.equal(persistedSettings.guiPlayerVolume, 67);
  assert.equal(persistedSettings.theme, "aurora");
  assert.equal(persistedSettings.port, port);
});

test("playlist API supports listing, sorting, bulk queue/delete, import, and export", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;

  t.after(async () => {
    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,Rick Roll\n",
    "utf8"
  );

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  const listResponse = await fetch(new URL("/api/playlist/tracks?q=rick&sortBy=title", appServer.urls.dashboardUrl));
  const listPayload = await listResponse.json();
  assert.equal(listPayload.total, 1);
  assert.equal(listPayload.sortBy, "title");

  const importResponse = await fetch(new URL("/api/playlist/import", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mode: "append",
      csvText: "Link,Title\nhttps://soundcloud.com/artist/track,Club Mix\n"
    })
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.importedCount, 1);

  const bulkQueueResponse = await fetch(new URL("/api/playlist/bulk-queue", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      trackKeys: ["soundcloud:https://soundcloud.com/artist/track"]
    })
  });
  assert.equal(bulkQueueResponse.ok, true);
  const bulkQueuePayload = await bulkQueueResponse.json();
  assert.equal(bulkQueuePayload.result.queuedCount, 1);
  assert.equal(bulkQueuePayload.state.queue[0].title, "Club Mix");

  const bulkDeleteResponse = await fetch(new URL("/api/playlist/bulk-delete", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      trackKeys: ["soundcloud:https://soundcloud.com/artist/track"]
    })
  });
  assert.equal(bulkDeleteResponse.ok, true);
  const bulkDeletePayload = await bulkDeleteResponse.json();
  assert.equal(bulkDeletePayload.result.removedCount, 1);

  const exportResponse = await fetch(new URL("/api/playlist/export", appServer.urls.dashboardUrl));
  const exportText = await exportResponse.text();
  assert.doesNotMatch(exportText, /Club Mix/);
});

test("dashboard queue and playback APIs add tracks and expose transport controls", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  const originalFetch = global.fetch;
  let appServer = null;

  t.after(async () => {
    global.fetch = originalFetch;

    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\n",
    "utf8"
  );

  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://www.youtube.com/oembed")) {
      const parsed = new URL(url);
      const requestedUrl = parsed.searchParams.get("url") || "";

      if (requestedUrl.includes("dashboard-one")) {
        return createJsonResponse({
          title: "Dashboard One",
          thumbnail_url: ""
        });
      }

      if (requestedUrl.includes("dashboard-two")) {
        return createJsonResponse({
          title: "Dashboard Two",
          thumbnail_url: ""
        });
      }
    }

    return originalFetch(input, init);
  };

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  const firstQueueResponse = await fetch(new URL("/api/queue", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: "https://youtu.be/dashboard-one"
    })
  });
  assert.equal(firstQueueResponse.ok, true);

  const firstQueuePayload = await firstQueueResponse.json();
  assert.equal(firstQueuePayload.track.title, "Dashboard One");
  assert.equal(firstQueuePayload.track.requestedBy.displayName, "Dashboard");
  assert.equal(firstQueuePayload.state.playbackStatus, "playing");
  assert.equal(firstQueuePayload.state.currentTrack.title, "Dashboard One");

  const secondQueueResponse = await fetch(new URL("/api/queue", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: "https://youtu.be/dashboard-two"
    })
  });
  assert.equal(secondQueueResponse.ok, true);

  const secondQueuePayload = await secondQueueResponse.json();
  assert.equal(secondQueuePayload.state.queue.length, 1);
  assert.equal(secondQueuePayload.state.queue[0].title, "Dashboard Two");

  const stopResponse = await fetch(new URL("/api/playback/stop", appServer.urls.dashboardUrl), {
    method: "POST"
  });
  assert.equal(stopResponse.ok, true);
  const stopPayload = await stopResponse.json();
  assert.equal(stopPayload.state.playbackStatus, "stopped");
  assert.equal(stopPayload.state.stoppedTrack.title, "Dashboard One");
  assert.equal(stopPayload.state.currentTrack, null);

  const playResponse = await fetch(new URL("/api/playback/play-pause", appServer.urls.dashboardUrl), {
    method: "POST"
  });
  assert.equal(playResponse.ok, true);
  const playPayload = await playResponse.json();
  assert.equal(playPayload.state.playbackStatus, "playing");
  assert.equal(playPayload.state.currentTrack.title, "Dashboard One");

  const nextResponse = await fetch(new URL("/api/playback/next", appServer.urls.dashboardUrl), {
    method: "POST"
  });
  assert.equal(nextResponse.ok, true);
  const nextPayload = await nextResponse.json();
  assert.equal(nextPayload.state.playbackStatus, "playing");
  assert.equal(nextPayload.state.currentTrack.title, "Dashboard Two");
});

test("settings API persists request policy and configurable chat commands", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;

  t.after(async () => {
    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\n",
    "utf8"
  );

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  const response = await fetch(new URL("/api/settings", appServer.urls.dashboardUrl), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requestPolicy: {
        requestsEnabled: false,
        accessLevel: "subscriber",
        maxQueueLength: 7,
        maxRequestsPerUser: 2,
        cooldownSeconds: 90,
        allowSearchRequests: false,
        youtubeSafeSearch: "strict",
        allowedProviders: ["youtube"],
        blockedUsers: ["viewerone"],
        blockedPhrases: ["blocked phrase"]
      },
      chatCommands: {
        song_request: {
          trigger: "!song",
          aliases: ["!req"],
          permission: "everyone",
          enabled: true
        },
        current_song: {
          trigger: "!np",
          aliases: [],
          permission: "everyone",
          enabled: true
        },
        queue_status: {
          trigger: "!queue",
          aliases: [],
          permission: "everyone",
          enabled: true
        },
        queue_position: {
          trigger: "!position",
          aliases: [],
          permission: "everyone",
          enabled: true
        },
        remove_own_request: {
          trigger: "!unrequest",
          aliases: [],
          permission: "everyone",
          enabled: true
        },
        skip_current: {
          trigger: "!skip",
          aliases: [],
          permission: "vip",
          enabled: true
        },
        delete_current: {
          trigger: "!delete",
          aliases: [],
          permission: "vip",
          enabled: true
        },
        save_current: {
          trigger: "!save",
          aliases: [],
          permission: "vip",
          enabled: true
        },
        open_requests: {
          trigger: "!openrequests",
          aliases: [],
          permission: "moderator",
          enabled: true
        },
        close_requests: {
          trigger: "!closerequests",
          aliases: [],
          permission: "moderator",
          enabled: true
        },
        clear_queue: {
          trigger: "!clearqueue",
          aliases: [],
          permission: "moderator",
          enabled: true
        }
      }
    })
  });

  assert.equal(response.ok, true);
  const payload = await response.json();
  assert.equal(payload.settings.requestPolicy.requestsEnabled, false);
  assert.equal(payload.settings.requestPolicy.accessLevel, "subscriber");
  assert.equal(payload.settings.requestPolicy.maxQueueLength, 7);
  assert.equal(payload.settings.requestPolicy.maxRequestsPerUser, 2);
  assert.equal(payload.settings.requestPolicy.cooldownSeconds, 90);
  assert.equal(payload.settings.requestPolicy.allowSearchRequests, false);
  assert.equal(payload.settings.requestPolicy.youtubeSafeSearch, "strict");
  assert.deepEqual(payload.settings.requestPolicy.allowedProviders, ["youtube"]);
  assert.deepEqual(payload.settings.requestPolicy.blockedUsers, ["viewerone"]);
  assert.deepEqual(payload.settings.requestPolicy.blockedPhrases, ["blocked phrase"]);
  assert.equal(payload.settings.chatCommands.song_request.trigger, "!song");
  assert.deepEqual(payload.settings.chatCommands.song_request.aliases, ["!req"]);
  assert.equal(payload.settings.chatCommands.queue_status.trigger, "!queue");
  assert.equal(payload.settings.chatCommands.clear_queue.trigger, "!clearqueue");

  const persistedSettings = JSON.parse(
    await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8")
  );
  assert.equal(persistedSettings.requestPolicy.requestsEnabled, false);
  assert.equal(persistedSettings.requestPolicy.accessLevel, "subscriber");
  assert.equal(persistedSettings.requestPolicy.maxQueueLength, 7);
  assert.equal(persistedSettings.requestPolicy.maxRequestsPerUser, 2);
  assert.equal(persistedSettings.requestPolicy.cooldownSeconds, 90);
  assert.equal(persistedSettings.requestPolicy.allowSearchRequests, false);
  assert.equal(persistedSettings.requestPolicy.youtubeSafeSearch, "strict");
  assert.deepEqual(persistedSettings.requestPolicy.allowedProviders, ["youtube"]);
  assert.deepEqual(persistedSettings.requestPolicy.blockedUsers, ["viewerone"]);
  assert.deepEqual(persistedSettings.requestPolicy.blockedPhrases, ["blocked phrase"]);
  assert.equal(persistedSettings.chatCommands.current_song.trigger, "!np");
  assert.equal(persistedSettings.chatCommands.remove_own_request.trigger, "!unrequest");
});

test("queue API supports listing, moving, promoting, removing, and clearing queued tracks", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  const originalFetch = global.fetch;
  let appServer = null;

  t.after(async () => {
    global.fetch = originalFetch;

    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\n",
    "utf8"
  );

  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://www.youtube.com/oembed")) {
      const parsed = new URL(url);
      const requestedUrl = parsed.searchParams.get("url") || "";
      return createJsonResponse({
        title: requestedUrl.includes("queue-one")
          ? "Queue One"
          : requestedUrl.includes("queue-two")
            ? "Queue Two"
            : "Queue Three",
        thumbnail_url: ""
      });
    }

    return originalFetch(input, init);
  };

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  await fetch(new URL("/api/queue", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: "https://youtu.be/queue-one" })
  });
  await fetch(new URL("/api/queue", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: "https://youtu.be/queue-two" })
  });
  await fetch(new URL("/api/queue", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: "https://youtu.be/queue-three" })
  });

  const listResponse = await fetch(new URL("/api/queue", appServer.urls.dashboardUrl));
  const listPayload = await listResponse.json();
  assert.equal(listPayload.items.length, 2);

  const secondTrackId = listPayload.items[0].id;
  const thirdTrackId = listPayload.items[1].id;
  const moveResponse = await fetch(new URL(`/api/queue/${encodeURIComponent(secondTrackId)}/move`, appServer.urls.dashboardUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      direction: "down"
    })
  });
  assert.equal(moveResponse.ok, true);
  const movePayload = await moveResponse.json();
  assert.equal(movePayload.state.queue[0].title, "Queue Three");
  assert.equal(movePayload.state.queue[1].title, "Queue Two");

  const promoteResponse = await fetch(new URL(`/api/queue/${encodeURIComponent(thirdTrackId)}/promote`, appServer.urls.dashboardUrl), {
    method: "POST"
  });
  assert.equal(promoteResponse.ok, true);
  const promotePayload = await promoteResponse.json();
  assert.equal(promotePayload.state.queue[0].title, "Queue Three");

  const removeTrackId = promotePayload.state.queue[1].id;
  const removeResponse = await fetch(new URL(`/api/queue/${encodeURIComponent(removeTrackId)}`, appServer.urls.dashboardUrl), {
    method: "DELETE"
  });
  assert.equal(removeResponse.ok, true);
  const removePayload = await removeResponse.json();
  assert.equal(removePayload.track.title, "Queue Two");
  assert.equal(removePayload.state.queue.length, 1);

  const clearResponse = await fetch(new URL("/api/queue/clear", appServer.urls.dashboardUrl), {
    method: "POST"
  });
  assert.equal(clearResponse.ok, true);
  const clearPayload = await clearResponse.json();
  assert.equal(clearPayload.result.clearedCount, 1);
  assert.equal(clearPayload.state.queue.length, 0);
});

test("history API returns recent playback events and runtime state restores on startup", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalEnv = snapshotEnv(isolatedEnvKeys);
  const originalCwd = process.cwd();
  let appServer = null;

  t.after(async () => {
    if (appServer) {
      await appServer.close().catch(() => {});
    }

    process.chdir(originalCwd);
    restoreEnv(originalEnv);

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.chdir(runtimeDir);
  clearEnv(isolatedEnvKeys);

  const port = await getAvailablePort();
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ youtubeApiKey: "youtube-key", port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "queue-state.json"),
    `${JSON.stringify({
      queue: [
        {
          id: "queued-restore",
          provider: "youtube",
          url: "https://youtu.be/queued-restore",
          title: "Queued Restore",
          key: "youtube:queued-restore",
          origin: "queue",
          artworkUrl: "",
          requestedBy: {
            username: "viewerone",
            displayName: "ViewerOne"
          }
        }
      ],
      stoppedTrack: {
        id: "stopped-restore",
        provider: "youtube",
        url: "https://youtu.be/stopped-restore",
        title: "Stopped Restore",
        key: "youtube:stopped-restore",
        origin: "queue",
        artworkUrl: "",
        requestedBy: {
          username: "viewerone",
          displayName: "ViewerOne"
        }
      },
      history: [
        {
          track: {
            id: "history-restore",
            provider: "youtube",
            url: "https://youtu.be/history-restore",
            title: "History Restore",
            key: "youtube:history-restore",
            origin: "queue",
            artworkUrl: "",
            requestedBy: {
              username: "viewerone",
              displayName: "ViewerOne"
            }
          },
          status: "stopped",
          completedAt: "2026-03-17T12:00:00.000Z"
        }
      ]
    }, null, 2)}\n`,
    "utf8"
  );

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    })
  });

  const stateResponse = await fetch(new URL("/api/state", appServer.urls.dashboardUrl));
  const statePayload = await stateResponse.json();
  assert.equal(statePayload.stoppedTrack.title, "Stopped Restore");
  assert.equal(statePayload.queue.length, 1);
  assert.equal(statePayload.history.length, 1);
  assert.equal(statePayload.currentTrack, null);

  const historyResponse = await fetch(new URL("/api/history", appServer.urls.dashboardUrl));
  const historyPayload = await historyResponse.json();
  assert.equal(historyPayload.items.length, 1);
  assert.equal(historyPayload.items[0].track.title, "History Restore");
});
