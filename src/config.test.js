import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfigStore } from "./config.js";

function captureEnv(keys) {
  const snapshot = new Map();

  for (const key of keys) {
    snapshot.set(key, process.env[key]);
  }

  return () => {
    for (const [key, value] of snapshot.entries()) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  };
}

test("saved theme, dashboard layout, and port stay active when no env override is provided", async (t) => {
  const restoreEnv = captureEnv(["PORT", "THEME", "DASHBOARD_LAYOUT"]);
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    restoreEnv();
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.env.PORT = "";
  process.env.THEME = "";
  process.env.DASHBOARD_LAYOUT = "";

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ port: 4311, theme: "sunset", dashboardLayout: "atlas" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.port, 4311);
  assert.equal(settings.theme, "sunset");
  assert.equal(settings.dashboardLayout, "atlas");
});

test("saved GUI player state is preserved across reloads", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ startWithWindows: true, guiPlayerEnabled: true, guiPlayerVolume: 42, playerStartupTimeoutSeconds: 9 }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.startWithWindows, true);
  assert.equal(settings.guiPlayerEnabled, true);
  assert.equal(settings.guiPlayerVolume, 42);
  assert.equal(settings.playerStartupTimeoutSeconds, 9);
});

test("explicit env theme, dashboard layout, and port still override saved settings", async (t) => {
  const restoreEnv = captureEnv(["PORT", "THEME", "DASHBOARD_LAYOUT"]);
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    restoreEnv();
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  process.env.PORT = "4322";
  process.env.THEME = "aurora";
  process.env.DASHBOARD_LAYOUT = "atlas";

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ port: 4311, theme: "sunset", dashboardLayout: "atlas" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.port, 4322);
  assert.equal(settings.theme, "aurora");
  assert.equal(settings.dashboardLayout, "atlas");
});

test("bundled client id is used when no stored or env override exists", async (t) => {
  const restoreEnv = captureEnv(["TWITCH_CLIENT_ID"]);
  const originalCwd = process.cwd();
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-root-"));

  t.after(async () => {
    process.chdir(originalCwd);
    restoreEnv();
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  });

  delete process.env.TWITCH_CLIENT_ID;
  process.chdir(rootDir);

  await fs.mkdir(path.join(rootDir, "build"), {
    recursive: true
  });
  await fs.writeFile(
    path.join(rootDir, "build", "bundled-config.json"),
    `${JSON.stringify({ twitchClientId: "bundled-client-id" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({
    rootDir,
    runtimeDir
  });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.twitchClientId, "bundled-client-id");
});

test("stored category suppression lists are normalized and preserved", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({
      chatSuppressedCategories: ["Music", "DJs", "Music", "  "],
      playbackSuppressedCategories: ["Just Chatting", "Music"]
    }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.deepEqual(settings.chatSuppressedCategories, ["Music", "DJs"]);
  assert.deepEqual(settings.playbackSuppressedCategories, ["Just Chatting", "Music"]);
});

test("new overlay themes are exposed and accepted as valid saved settings", async (t) => {
  const restoreEnv = captureEnv(["THEME"]);
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    restoreEnv();
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  delete process.env.THEME;

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ theme: "arcade" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();
  const themeIds = configStore.getThemeOptions().map((theme) => theme.id);

  assert.equal(settings.theme, "arcade");
  assert.deepEqual(themeIds, [
    "aurora",
    "sunset",
    "winamp",
    "compact",
    "terminal",
    "synthwave",
    "broadcast",
    "mixtape",
    "noir",
    "arcade"
  ]);
});

test("dashboard layout is fixed to atlas", async (t) => {
  const restoreEnv = captureEnv(["DASHBOARD_LAYOUT"]);
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    restoreEnv();
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  delete process.env.DASHBOARD_LAYOUT;

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ dashboardLayout: "neon" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();
  const layoutIds = configStore.getDashboardLayoutOptions().map((layout) => layout.id);

  assert.equal(settings.dashboardLayout, "atlas");
  assert.deepEqual(layoutIds, [
    "atlas"
  ]);
});

test("request policy and chat commands are normalized with defaults", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-config-"));

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({
      requestPolicy: {
        requestsEnabled: false,
        accessLevel: "subscriber",
        maxQueueLength: 12,
        maxRequestsPerUser: 3,
        duplicateHistoryCount: 4,
        cooldownSeconds: 45,
        maxTrackDurationSeconds: 600,
        rejectLiveStreams: true,
        allowSearchRequests: false,
        youtubeSafeSearch: "strict",
        allowedProviders: ["youtube"],
        blockedYouTubeChannelIds: ["UCBlockedOne"],
        blockedSoundCloudUsers: ["BannedArtist"],
        blockedUsers: ["ViewerOne", "ViewerTwo"],
        blockedDomains: ["YouTube.com", "YOUTU.BE"],
        blockedPhrases: ["banned phrase", "another one"]
      },
      chatCommands: {
        song_request: {
          trigger: "requestsong",
          aliases: ["playsong"],
          permission: "everyone",
          enabled: true
        },
        skip_current: {
          trigger: "!next",
          aliases: [],
          permission: "moderator",
          enabled: true
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.requestPolicy.requestsEnabled, false);
  assert.equal(settings.requestPolicy.accessLevel, "subscriber");
  assert.equal(settings.requestPolicy.maxQueueLength, 12);
  assert.equal(settings.requestPolicy.maxRequestsPerUser, 3);
  assert.equal(settings.requestPolicy.duplicateHistoryCount, 4);
  assert.equal(settings.requestPolicy.cooldownSeconds, 45);
  assert.equal(settings.requestPolicy.maxTrackDurationSeconds, 600);
  assert.equal(settings.requestPolicy.rejectLiveStreams, true);
  assert.equal(settings.requestPolicy.allowSearchRequests, false);
  assert.equal(settings.requestPolicy.youtubeSafeSearch, "strict");
  assert.deepEqual(settings.requestPolicy.allowedProviders, ["youtube"]);
  assert.deepEqual(settings.requestPolicy.blockedYouTubeChannelIds, ["ucblockedone"]);
  assert.deepEqual(settings.requestPolicy.blockedSoundCloudUsers, ["bannedartist"]);
  assert.deepEqual(settings.requestPolicy.blockedUsers, ["viewerone", "viewertwo"]);
  assert.deepEqual(settings.requestPolicy.blockedDomains, ["youtube.com", "youtu.be"]);
  assert.deepEqual(settings.requestPolicy.blockedPhrases, ["banned phrase", "another one"]);
  assert.equal(settings.chatCommands.song_request.trigger, "!requestsong");
  assert.deepEqual(settings.chatCommands.song_request.aliases, ["!playsong"]);
  assert.equal(settings.chatCommands.skip_current.trigger, "!next");
  assert.equal(settings.chatCommands.current_song.trigger, "!currentsong");
  assert.equal(settings.chatCommands.queue_status.trigger, "!queue");
});
