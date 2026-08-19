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
          autoDj: {
            currentTrack: { id: "remote", title: "Remote Track" },
            queue: [],
            playbackStatus: "playing",
            currentTimeSeconds: 42,
            durationSeconds: 180,
            playbackRate: 1,
            transitioning: false
          }
        },
        lastError: ""
      };
    },
    async probe() { return this.getStatus(); },
    async setActivation(enabled) { activationEffective = enabled; return { sequence: 4 }; },
    async queueOwnedRequest() { return { matched: false, queued: false, track: null }; },
    async getRequestHandoffReadiness() {
      return { ready: false, retryAfterMs: 3_000, error: "AutoDJ application timeout" };
    },
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
    await fs.rm(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

  const settingsAtStartup = await (
    await fetch(new URL("/api/settings", appServer.urls.dashboardUrl))
  ).json();
  const loaderHtml = await fs.readFile(settingsAtStartup.runtime.overlayLoaderFilePath, "utf8");
  assert.match(loaderHtml, /http:\/\/127\.0\.0\.1:18463\/output/);
  assert.match(loaderHtml, /unifiedOverlay=1/);

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
  assert.deepEqual(status.playback, {
    status: "playing",
    currentTimeSeconds: 42,
    durationSeconds: 180,
    playbackRate: 1,
    transitioning: false,
    naturalHandoffInSeconds: null,
    transitionLive: false
  });

  const overlayState = await (await fetch(new URL("/api/state", appServer.urls.dashboardUrl))).json();
  assert.equal(overlayState.currentTrack, null);
  assert.equal(overlayState.autoDjController.currentTrack.title, "Remote Track");
  assert.equal(overlayState.autoDjController.playback.currentTimeSeconds, 42);

  const settingsText = await (await fetch(new URL("/api/settings", appServer.urls.dashboardUrl))).text();
  assert.equal(settingsText.includes("must-not-leak"), false);
  assert.equal(JSON.parse(settingsText).settings.hasAutoDjServiceToken, true);

  const outputResponse = await fetch(new URL(
    "/autodj-output?style=extended&unifiedOverlay=1&unifiedRole=autodj",
    appServer.urls.dashboardUrl
  ), { redirect: "manual" });
  assert.equal(outputResponse.status, 302);
  const outputLocation = new URL(outputResponse.headers.get("location"));
  assert.equal(outputLocation.origin, "http://127.0.0.1:18463");
  assert.equal(outputLocation.pathname, "/output");
  assert.equal(outputLocation.searchParams.get("style"), "extended");
  assert.equal(outputLocation.searchParams.get("unifiedOverlay"), "1");
  assert.equal(outputLocation.searchParams.get("unifiedRole"), "autodj");

  for (const removedRoute of ["/api/local-music/status", "/api/v1/autodj/health", "/autodj-overlay"]) {
    const response = await fetch(new URL(removedRoute, appServer.urls.dashboardUrl));
    assert.equal(response.status, 404, removedRoute);
  }
});

test("confirmed standalone AutoDJ track changes are announced in Twitch chat only while AutoDJ owns playback", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-autodj-chat-"));
  const originalCwd = process.cwd();
  let appServer = null;
  let activationEffective = true;
  let takeoverActive = false;
  let activationAppliedResolve;
  const activationApplied = new Promise((resolve) => {
    activationAppliedResolve = resolve;
  });
  const remoteTrackListeners = new Set();
  const announcedTracks = [];
  const client = {
    getStatus() {
      return {
        configured: true,
        connected: true,
        liveness: "responding",
        lastSeenAt: "2026-08-19T10:00:00.000Z",
        takeoverActive,
        state: {
          activation: { effective: activationEffective },
          application: { lastAppliedSequence: 1, lastApplyOutcome: "applied" },
          takeover: takeoverActive ? { leaseId: "viewer-request" } : null,
          autoDj: { currentTrack: null, queue: [] }
        },
        lastError: ""
      };
    },
    async probe() { return this.getStatus(); },
    async setActivation(enabled) {
      activationEffective = enabled;
      activationAppliedResolve();
      return { sequence: 1 };
    },
    onRemoteTrackStart(listener) {
      remoteTrackListeners.add(listener);
      return () => remoteTrackListeners.delete(listener);
    },
    async emitRemoteTrack(track) {
      await Promise.all(Array.from(remoteTrackListeners, (listener) => listener(track)));
    },
    async startTrackMonitor() {},
    async close() {},
    getRemoteCurrentTrack() { return null; },
    getBrowserOutputUrl() { return "http://127.0.0.1:18463/output"; }
  };
  const twitchBotService = {
    getStatus() { return { state: "connected" }; },
    getAuthStatus() { return { state: "idle" }; },
    async applySettings() { return this.getStatus(); },
    async announceNowPlaying(track) {
      announcedTracks.push(track);
      return true;
    },
    async disconnect() {},
    async startDeviceAuth() { return this.getAuthStatus(); },
    cancelDeviceAuth() { return this.getAuthStatus(); }
  };

  t.after(async () => {
    await appServer?.close().catch(() => {});
    process.chdir(originalCwd);
    await fs.rm(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  process.chdir(runtimeDir);
  const port = await availablePort();
  await fs.writeFile(path.join(runtimeDir, "settings.json"), `${JSON.stringify({
    port,
    autoDjEnabled: true,
    autoDjServiceUrl: "http://127.0.0.1:3100",
    autoDjServiceToken: "paired-secret",
    radioModeEnabled: false
  }, null, 2)}\n`);
  await fs.writeFile(path.join(runtimeDir, "playlist.csv"), "Link,Title\n");

  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({
      rootDir: appRootDir,
      runtimeDir,
      publicDir: path.join(appRootDir, "public")
    }),
    autoDjServiceClientFactory: () => client,
    twitchBotServiceFactory: () => twitchBotService
  });
  await activationApplied;

  await client.emitRemoteTrack({
    id: "local-1",
    title: "First Track",
    artist: "Local Artist",
    provider: "local",
    origin: "local",
    url: "C:\\Music\\First Track.mp3"
  });
  assert.equal(announcedTracks.length, 1);
  assert.equal(announcedTracks[0].title, "First Track");
  assert.equal(announcedTracks[0].artist, "Local Artist");
  assert.equal(announcedTracks[0].url, "");

  takeoverActive = true;
  await client.emitRemoteTrack({ id: "local-2", title: "Request Takeover Track" });
  assert.equal(announcedTracks.length, 1);

  takeoverActive = false;
  activationEffective = false;
  await client.emitRemoteTrack({ id: "local-3", title: "Inactive Track" });
  assert.equal(announcedTracks.length, 1);

  await appServer.close();
  appServer = null;
  assert.equal(remoteTrackListeners.size, 0);
});
