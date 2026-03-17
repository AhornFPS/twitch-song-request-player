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

test("playlist API supports listing, delete, import, and export", async (t) => {
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

  const listResponse = await fetch(new URL("/api/playlist/tracks?q=rick", appServer.urls.dashboardUrl));
  const listPayload = await listResponse.json();
  assert.equal(listPayload.total, 1);

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

  const deleteResponse = await fetch(
    new URL(`/api/playlist/tracks/${encodeURIComponent("soundcloud:https://soundcloud.com/artist/track")}`, appServer.urls.dashboardUrl),
    {
      method: "DELETE"
    }
  );
  assert.equal(deleteResponse.status, 204);

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
