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
    `${JSON.stringify({ guiPlayerEnabled: true, guiPlayerVolume: 42 }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.guiPlayerEnabled, true);
  assert.equal(settings.guiPlayerVolume, 42);
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
