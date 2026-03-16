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
  "THEME"
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

test("partial settings save updates only the theme", async (t) => {
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
  assert.equal(payload.settings.port, port);
  assert.equal(payload.settings.youtubeApiKey, initialSettings.youtubeApiKey);

  const persistedSettings = JSON.parse(
    await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8")
  );
  assert.equal(persistedSettings.theme, "winamp");
  assert.equal(persistedSettings.port, port);
  assert.equal(persistedSettings.youtubeApiKey, initialSettings.youtubeApiKey);
});
