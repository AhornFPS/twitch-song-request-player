// @ts-nocheck
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

async function availablePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test("external-only server keeps an unavailable AutoDJ request queued and exposes no engine routes", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-external-autodj-"));
  const originalCwd = process.cwd();
  let appServer = null;
  let activationEffective = true;
  const client = {
    getStatus() {
      return {
        configured: true,
        connected: true,
        liveness: "responding",
        lastSeenAt: "2026-08-18T10:00:00.000Z",
        takeoverActive: false,
        state: {
          activation: { effective: activationEffective },
          application: { lastAppliedSequence: 4, lastApplyOutcome: "applied" },
          autoDj: { currentTrack: { id: "remote", title: "Remote Track" }, queue: [] }
        },
        lastError: ""
      };
    },
    async probe() { return this.getStatus(); },
    async setActivation(enabled) { activationEffective = enabled; return { sequence: 4 }; },
    async queueOwnedRequest() { return { matched: false, queued: false, track: null }; },
    async acquire() { throw new Error("AutoDJ application timeout"); },
    async release() {},
    async startTrackMonitor() {},
    async close() {},
    getRemoteCurrentTrack() { return this.getStatus().state.autoDj.currentTrack; },
    getBrowserOutputUrl() { return "http://127.0.0.1:18463/output"; }
  };

  t.after(async () => {
    await appServer?.close().catch(() => {});
    process.chdir(originalCwd);
    await fs.rm(runtimeDir, { recursive: true, force: true });
  });

  process.chdir(runtimeDir);
  const port = await availablePort();
  await fs.writeFile(path.join(runtimeDir, "settings.json"), `${JSON.stringify({
    port,
    autoDjEnabled: true,
    autoDjServiceUrl: "http://127.0.0.1:3100",
    autoDjServiceToken: "must-not-leak"
  }, null, 2)}\n`);
  await fs.writeFile(path.join(runtimeDir, "playlist.csv"), "Link,Title\n");

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    }),
    autoDjServiceClientFactory: () => client
  });

  const activationResponse = await fetch(new URL("/api/autodj-service/activation", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true })
  });
  assert.equal(activationResponse.ok, true);

  const queueResponse = await fetch(new URL("/api/queue/generated", appServer.urls.dashboardUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "suno",
      sunoId: "held-request",
      title: "Held Request",
      audioUrl: "https://cdn1.suno.ai/held-request.mp3"
    })
  });
  assert.equal(queueResponse.ok, true);
  const queuePayload = await queueResponse.json();
  assert.equal(queuePayload.state.currentTrack, null);
  assert.equal(queuePayload.state.queue.length, 1);

  const status = await (await fetch(new URL("/api/autodj-service/status", appServer.urls.dashboardUrl))).json();
  assert.equal(status.role, "controller-request-player");
  assert.equal(status.currentTrack.title, "Remote Track");

  const settingsText = await (await fetch(new URL("/api/settings", appServer.urls.dashboardUrl))).text();
  assert.equal(settingsText.includes("must-not-leak"), false);
  assert.equal(JSON.parse(settingsText).settings.hasAutoDjServiceToken, true);

  for (const removedRoute of ["/api/local-music/status", "/api/v1/autodj/health", "/autodj-overlay"]) {
    const response = await fetch(new URL(removedRoute, appServer.urls.dashboardUrl));
    assert.equal(response.status, 404, removedRoute);
  }
});
