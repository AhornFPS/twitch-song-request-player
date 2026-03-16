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

test("saved theme and port stay active when no env override is provided", async (t) => {
  const restoreEnv = captureEnv(["PORT", "THEME"]);
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

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ port: 4311, theme: "sunset" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.port, 4311);
  assert.equal(settings.theme, "sunset");
});

test("explicit env theme and port still override saved settings", async (t) => {
  const restoreEnv = captureEnv(["PORT", "THEME"]);
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

  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ port: 4311, theme: "sunset" }, null, 2)}\n`,
    "utf8"
  );

  const configStore = createConfigStore({ runtimeDir });
  const settings = await configStore.loadEffectiveSettings();

  assert.equal(settings.port, 4322);
  assert.equal(settings.theme, "aurora");
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
