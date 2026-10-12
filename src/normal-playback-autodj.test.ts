// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startAppServer } from "./app-server.js";
import { createConfigStore } from "./config.js";
import { PlayerController } from "./player-controller.js";

const root = path.resolve(import.meta.dirname, "..");
const queuedTrack = {
  id: "preserved-request", provider: "suno", origin: "queue",
  key: "suno:preserved-request", title: "Preserved request",
  url: "https://suno.com/song/preserved-request",
  audioUrl: "https://cdn1.suno.ai/preserved-request.mp3"
};

async function fixture(t, { queue = [], available = true, autoDjEnabled = true } = {}) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcc-normal-playback-"));
  const previousCwd = process.cwd();
  const previousObs = process.env.OBS_YOUTUBE_FALLBACK_ENABLED;
  process.env.OBS_YOUTUBE_FALLBACK_ENABLED = "false";
  process.chdir(runtimeDir);
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await fs.writeFile(path.join(runtimeDir, "settings.json"), JSON.stringify({
    port, autoDjEnabled, autoDjServiceUrl: "http://127.0.0.1:3100",
    autoDjServiceToken: "isolated-pairing-secret", radioModeEnabled: false,
    obsYoutubeFallbackEnabled: false
  }));
  await fs.writeFile(path.join(runtimeDir, "playlist.csv"), "Link,Title\nhttps://youtu.be/fixture,Normal fallback\n");
  await fs.writeFile(path.join(runtimeDir, "queue-state.json"), JSON.stringify({ queue }));
  const activationCalls = [];
  let onActivation = null;
  let effective = true;
  let appServer;
  const remoteStateListeners = new Set();
  const client = {
    getStatus: () => ({
      configured: true, connected: available, serviceUnavailable: !available,
      liveness: available ? "responding" : "unavailable", takeoverActive: false, engineEpoch: "fixture-engine",
      activation: { effective },
      state: { activation: { effective }, autoDj: { playbackStatus: effective ? "playing" : "paused" } }
    }),
    async probe() { return this.getStatus(); },
    async setActivation(enabled) {
      activationCalls.push(enabled);
      await onActivation?.(enabled);
      effective = enabled;
    },
    async startTrackMonitor() {}, async close() {},
    onRemoteTrackStart: () => () => {},
    onRemoteState(listener) { remoteStateListeners.add(listener); return () => remoteStateListeners.delete(listener); },
    async queueOwnedRequest() { return { matched: false, unavailable: true }; },
    getRemoteCurrentTrack: () => null,
    getBrowserOutputUrl: () => "http://127.0.0.1:18463/output"
  };
  const bot = {
    getStatus: () => ({ state: "disconnected" }), getAuthStatus: () => ({}),
    async applySettings() {}, async disconnect() {}, async announceNowPlaying() {}
  };
  t.after(async () => {
    await appServer?.close();
    process.chdir(previousCwd);
    if (previousObs === undefined) delete process.env.OBS_YOUTUBE_FALLBACK_ENABLED;
    else process.env.OBS_YOUTUBE_FALLBACK_ENABLED = previousObs;
    await fs.rm(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  appServer = await startAppServer({
    noBrowser: true,
    configStore: createConfigStore({ rootDir: root, runtimeDir, publicDir: path.join(root, "public") }),
    autoDjServiceClientFactory: () => client, twitchBotServiceFactory: () => bot
  });
  async function state() { return (await fetch(new URL("/api/state", appServer.urls.dashboardUrl))).json(); }
  async function command(route, body) {
    return fetch(new URL(route, appServer.urls.dashboardUrl), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = (await state()).autoDjController;
    if (status.activation.synchronized || (!available && status.connection.state === "unavailable")) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (available) assert.equal((await state()).autoDjController.activation.synchronized, true);
  return {
    state, command, appServer, activationCalls, runtimeDir,
    setActivationHook(hook) { onActivation = hook; },
    setAvailable(value) {
      available = value;
      if (available) for (const listener of remoteStateListeners) listener(client.getStatus());
    }
  };
}

test("normal Play waits for AutoDJ to pause, retains pairing, and keeps regular pause/resume in normal mode", async t => {
  const f = await fixture(t);
  let acknowledge;
  let pauseRequested;
  const requested = new Promise(resolve => { pauseRequested = resolve; });
  f.setActivationHook(async enabled => {
    if (!enabled) {
      pauseRequested();
      await new Promise(resolve => { acknowledge = resolve; });
    }
  });
  const playing = f.command("/api/playback/play-pause");
  await requested;
  assert.equal((await f.state()).currentTrack, null, "normal audio must wait for native pause acknowledgement");
  acknowledge();
  const response = await playing;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.state.currentTrack.title, "Normal fallback");
  assert.equal(result.state.playbackStatus, "playing");
  assert.equal(result.state.autoDjController.activation.desired, false);
  assert.equal(result.state.autoDjController.activation.effective, false);
  const settings = JSON.parse(await fs.readFile(path.join(f.runtimeDir, "settings.json"), "utf8"));
  assert.equal(settings.autoDjServiceUrl, "http://127.0.0.1:3100");
  assert.equal(settings.autoDjServiceToken, "isolated-pairing-secret");
  assert.equal(settings.autoDjEnabled, false);
  const paused = await (await f.command("/api/playback/play-pause")).json();
  assert.equal(paused.state.playbackStatus, "paused");
  const resumed = await (await f.command("/api/playback/play-pause")).json();
  assert.equal(resumed.state.playbackStatus, "playing");
  assert.deepEqual(f.activationCalls, [true, false]);
});

test("a failed AutoDJ pause starts no normal audio and preserves the queued request for retry", async t => {
  const f = await fixture(t, { queue: [queuedTrack] });
  f.setActivationHook(enabled => { if (!enabled) throw new Error("Pause was not acknowledged"); });
  const response = await f.command("/api/playback/play-pause");
  assert.equal(response.status, 503);
  const held = await f.state();
  assert.equal(held.currentTrack, null);
  assert.equal(held.queue[0].id, queuedTrack.id);
  f.setActivationHook(null);
  const retried = await (await f.command("/api/playback/play-pause")).json();
  assert.equal(retried.state.currentTrack.id, queuedTrack.id);
  assert.equal(retried.state.queue.length, 0);
  assert.equal(retried.state.autoDjController.activation.effective, false);
});

test("normal Play works with AutoDJ closed and applies the saved normal selection on its first connection", async t => {
  const f = await fixture(t, { available: false, queue: [queuedTrack] });
  const response = await f.command("/api/playback/play-pause");
  assert.equal(response.status, 200);
  const normal = await response.json();
  assert.equal(normal.state.currentTrack.id, queuedTrack.id);
  assert.equal(normal.state.autoDjController.activation.desired, false);
  assert.deepEqual(f.activationCalls, [], "a closed app must not receive activation commands or block playback");
  f.setAvailable(true);
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await f.state()).autoDjController.activation.synchronized) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const reconnected = await f.state();
  assert.equal(reconnected.autoDjController.activation.effective, false);
  assert.equal(reconnected.autoDjController.activation.synchronized, true);
  assert.equal(reconnected.currentTrack.id, queuedTrack.id);
  assert.deepEqual(f.activationCalls, [false]);
});

test("normal playback starts after restart with its saved pairing while AutoDJ remains closed", async t => {
  const f = await fixture(t, { available: false, autoDjEnabled: false, queue: [queuedTrack] });
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await f.state()).currentTrack) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const state = await f.state();
  assert.equal(state.currentTrack.id, queuedTrack.id);
  assert.equal(state.autoDjController.configured, true);
  assert.equal(state.autoDjController.activation.desired, false);
  assert.deepEqual(f.activationCalls, []);
  const response = await f.command("/api/autodj-service/activation", { enabled: true });
  assert.equal(response.status, 503);
  assert.equal((await f.state()).currentTrack.id, queuedTrack.id, "a failed Resume AutoDJ must keep normal playback running");
  assert.equal((await f.state()).autoDjController.activation.desired, false);
});

test("returning to AutoDJ stops normal output first and preserves its track and queue for the next normal Play", async t => {
  const f = await fixture(t);
  const started = await (await f.command("/api/playback/play-pause")).json();
  const trackId = started.state.currentTrack.id;
  const queuedResponse = await f.command("/api/queue/generated", {
    provider: "suno", sunoId: "later-request", title: "Later request", audioUrl: "https://cdn1.suno.ai/later.mp3"
  });
  assert.equal(queuedResponse.ok, true);
  const queueBefore = (await f.state()).queue;
  f.setActivationHook(async enabled => {
    if (enabled) {
      const state = await f.state();
      assert.equal(state.currentTrack, null, "normal output must stop before AutoDJ is resumed");
      assert.equal(state.stoppedTrack.id, trackId);
    }
  });
  assert.equal((await f.command("/api/autodj-service/activation", { enabled: true })).status, 200);
  const autoDj = await f.state();
  assert.equal(autoDj.currentTrack, null);
  assert.deepEqual(autoDj.queue, queueBefore);
  const normal = await (await f.command("/api/playback/play-pause")).json();
  assert.equal(normal.state.currentTrack.id, trackId);
  assert.deepEqual(normal.state.queue, queueBefore);
  assert.equal(normal.state.autoDjController.activation.effective, false);
});

test("simultaneous normal Play and Resume AutoDJ serialize the pause, normal start, and output stop", async t => {
  const f = await fixture(t);
  let acknowledge;
  let pauseRequested;
  const requested = new Promise(resolve => { pauseRequested = resolve; });
  f.setActivationHook(async enabled => {
    if (!enabled) {
      pauseRequested();
      await new Promise(resolve => { acknowledge = resolve; });
    } else {
      assert.equal((await f.state()).currentTrack, null);
    }
  });
  const normalPlay = f.command("/api/playback/play-pause");
  await requested;
  const resumeAutoDj = f.command("/api/autodj-service/activation", { enabled: true });
  acknowledge();
  assert.equal((await normalPlay).status, 200);
  assert.equal((await resumeAutoDj).status, 200);
  const final = await f.state();
  assert.equal(final.currentTrack, null);
  assert.equal(final.stoppedTrack.title, "Normal fallback");
  assert.equal(final.autoDjController.activation.effective, true);
  assert.deepEqual(f.activationCalls, [true, false, true]);
});

test("an in-flight normal start held for an authority switch does not consume or load a queued track", async () => {
  let admit;
  let checking;
  const startedChecking = new Promise(resolve => { checking = resolve; });
  const events = [];
  const controller = new PlayerController({
    io: { emit: (name, payload) => events.push({ name, payload }) },
    playlistRepository: { getRandomTrack: async () => null },
    runtimeStateStore: { save: async () => {} },
    beforeTrackStart: async () => { checking(); return new Promise(resolve => { admit = resolve; }); }
  });
  controller.queue.push({ ...queuedTrack });
  const starting = controller.ensurePlayback();
  await startedChecking;
  const held = controller.holdPlaybackStarts();
  admit({ ready: true });
  await starting;
  await held;
  assert.equal(controller.currentTrack, null);
  assert.equal(controller.queue[0].id, queuedTrack.id);
  assert.equal(events.some(event => event.name === "player:load"), false);
  controller.releasePlaybackStarts();
});
