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
