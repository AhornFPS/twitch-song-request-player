// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { AutoDjServiceClient } from "./autodj-service-client.js";
import {
  AUTODJ_API_VERSION,
  normalizeAutoDjLeaseSeconds,
  normalizeAutoDjServiceUrl
} from "./autodj-service-contract.js";

function command(overrides = {}) {
  return {
    apiVersion: AUTODJ_API_VERSION,
    commandId: "command-1",
    clientInstanceId: "request-player-a",
    leaseId: "lease-a",
    leaseSeconds: 90,
    track: { id: "track-1", title: "Viewer track", provider: "youtube" },
    ...overrides
  };
}

test("AutoDJ service settings normalize URLs and recovery leases", () => {
  assert.equal(normalizeAutoDjServiceUrl("http://127.0.0.1:3100/"), "http://127.0.0.1:3100");
  assert.equal(normalizeAutoDjServiceUrl("file:///tmp/autodj"), "");
  assert.equal(normalizeAutoDjLeaseSeconds(2), 15);
  assert.equal(normalizeAutoDjLeaseSeconds(1000), 300);
});

test("request-player client authenticates, tracks takeover state, and releases", async (t) => {
  const calls = [];
  let activeLeaseId = "";
  let sequence = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith("/state")) {
      return new Response(JSON.stringify({
        engineEpoch: "epoch-1",
        revision: calls.length,
        application: { lastAppliedSequence: sequence, lastApplyOutcome: "applied" },
        takeover: activeLeaseId ? { leaseId: activeLeaseId } : null
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    sequence += 1;
    activeLeaseId = String(url).endsWith("request-starting") ? calls.at(-1).body.leaseId : "";
    return new Response(JSON.stringify({
      apiVersion: AUTODJ_API_VERSION,
      accepted: true,
      sequence,
      engineEpoch: "epoch-1",
      revision: calls.length,
      state: { engineEpoch: "epoch-1", revision: calls.length }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new AutoDjServiceClient({
    serviceUrl: "http://127.0.0.1:3100/",
    token: "shared-secret",
    fetchImpl,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {}
  });
  t.after(() => client.close());

  await client.acquire({ id: "viewer-1", title: "Request", provider: "youtube" });
  assert.equal(client.getStatus().takeoverActive, true);
  assert.equal(calls[0].options.headers.authorization, "Bearer shared-secret");
  assert.match(calls[0].url, /request-starting$/);
  assert.equal(calls[0].body.fadeSeconds, 2);

  await client.acquire({ id: "viewer-2", title: "Consecutive request", provider: "soundcloud" });
  const acquireCalls = calls.filter((call) => /request-starting$/.test(call.url));
  assert.equal(acquireCalls.length, 2);
  assert.equal(acquireCalls[1].body.leaseId, acquireCalls[0].body.leaseId);

  await client.release("request_ended");
  assert.equal(client.getStatus().takeoverActive, false);
  assert.match(calls.find((call) => /request-finished$/.test(call.url)).url, /request-finished$/);
  assert.equal(client.getStatus().engineEpoch, "epoch-1");
});

test("request-player diagnostics surface authenticated probe failures", async (t) => {
  const client = new AutoDjServiceClient({
    serviceUrl: "http://127.0.0.1:3100",
    token: "wrong",
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid token", code: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })
  });
  t.after(() => client.close());
  const status = await client.probe();
  assert.equal(status.connected, false);
  assert.equal(status.lastError, "invalid token");
});

test("request-player client sends resolved metadata to the owned-request endpoint", async (t) => {
  const calls = [];
  const client = new AutoDjServiceClient({
    serviceUrl: "http://127.0.0.1:3100",
    token: "shared-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        apiVersion: AUTODJ_API_VERSION,
        accepted: true,
        matched: true,
        queued: true,
        queuePosition: 1,
        engineEpoch: "epoch-owned",
        revision: 2,
        track: {
          provider: "local",
          title: "Artist — Owned Track",
          key: "local:owned",
          queuedForAutoDj: true
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  t.after(() => client.close());

  const result = await client.queueOwnedRequest({
    provider: "youtube",
    url: "https://youtu.be/owned",
    title: "Artist - Owned Track",
    key: "youtube:owned",
    requestedBy: { username: "viewer", displayName: "Viewer" }
  });

  assert.equal(result.matched, true);
  assert.match(calls[0].url, /requests\/owned$/);
  assert.equal(calls[0].options.headers.authorization, "Bearer shared-secret");
  assert.equal(calls[0].body.track.key, "youtube:owned");
  assert.equal(calls[0].body.track.requestedBy.username, "viewer");
});

test("request-player client monitors remote AutoDJ tracks and forwards mix-next", async (t) => {
  const announced = [];
  const remoteStates = [];
  let stateCall = 0;
  const client = new AutoDjServiceClient({
    serviceUrl: "http://127.0.0.1:3100",
    token: "shared-secret",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/control/mix-next")) {
        return new Response(JSON.stringify({
          accepted: true,
          ok: true,
          track: { id: "local-b", provider: "local", title: "Track B", url: "", origin: "local" },
          transition: { transitionId: "transition-b" }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      stateCall += 1;
      const id = stateCall < 3 ? "local-a" : "local-b";
      return new Response(JSON.stringify({
        apiVersion: AUTODJ_API_VERSION,
        autoDj: {
          currentTrack: { id, provider: "local", title: id === "local-a" ? "Track A" : "Track B", url: "", origin: "local" }
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  t.after(() => client.close());
  client.onRemoteTrackStart((track) => announced.push(track));
  client.onRemoteState((status) => remoteStates.push(status.state?.autoDj?.currentTrack?.id ?? ""));

  await client.pollRemoteTrack();
  await client.pollRemoteTrack();
  await client.pollRemoteTrack();
  const mixed = await client.mixNext({ triggeredBy: "vipone", leadSeconds: 5 });

  assert.equal(announced.length, 1);
  assert.deepEqual(remoteStates, ["local-a", "local-a", "local-b"]);
  assert.equal(announced[0].id, "local-b");
  assert.equal(client.getRemoteCurrentTrack().id, "local-b");
  assert.equal(mixed.autoDjMixQueued, true);
  assert.equal(mixed.transition.transitionId, "transition-b");
});

test("request-player client applies Center authority and learns the standalone browser output", async (t) => {
  const calls = [];
  const client = new AutoDjServiceClient({
    serviceUrl: "http://192.168.1.40:3100",
    token: "paired-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      return new Response(JSON.stringify({
        accepted: true,
        sequence: 7,
        revision: 7,
        state: {
          revision: 7,
          application: { lastAppliedSequence: 7, lastApplyOutcome: "applied" },
          activation: {
            enabled: true,
            effective: true,
            authority: "music-control-center",
            updatedAt: "2026-08-16T20:00:00.000Z"
          },
          browserOutput: {
            available: true,
            port: 18_463,
            path: "/output",
            styles: ["mini", "extended", "broadcast"]
          }
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  t.after(() => client.close());

  await client.setActivation(true, { fadeSeconds: 2, reason: "dashboard" });

  assert.match(calls[0].url, /\/control\/activation$/);
  assert.equal(calls[0].body.enabled, true);
  assert.equal(calls[0].body.reason, "dashboard");
  assert.equal(calls[0].body.fadeSeconds, 2);
  assert.equal(client.getStatus().activation.authority, "music-control-center");
  assert.equal(client.getBrowserOutputUrl(), "http://192.168.1.40:18463/output");
});

test("transport retries reuse one command ID while later unmatched checks use new IDs", async (t) => {
  const commandIds = [];
  let attempt = 0;
  const client = new AutoDjServiceClient({
    serviceUrl: "http://127.0.0.1:3100",
    token: "secret",
    setTimeoutFn(callback) {
      callback();
      return { unref() {} };
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      commandIds.push(body.commandId);
      attempt += 1;
      if (attempt === 1) {
        return new Response(JSON.stringify({ error: "temporary" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ matched: false, queued: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  t.after(() => client.close());

  await client.queueOwnedRequest({ provider: "youtube", title: "Retry", key: "youtube:retry" });
  await client.queueOwnedRequest({ provider: "youtube", title: "Retry", key: "youtube:retry" });

  assert.equal(commandIds[0], commandIds[1]);
  assert.notEqual(commandIds[1], commandIds[2]);
});

test("stale state revisions cannot replace newer state in the same engine epoch", () => {
  const client = new AutoDjServiceClient({ serviceUrl: "http://127.0.0.1:3100" });
  client.markSuccess({ engineEpoch: "epoch", revision: 9, autoDj: { currentTrack: { id: "new" } } });
  client.markSuccess({ engineEpoch: "epoch", revision: 8, autoDj: { currentTrack: { id: "stale" } } });
  assert.equal(client.getStatus().revision, 9);
  assert.equal(client.getStatus().state.autoDj.currentTrack.id, "new");
});

test("takeover fails closed when AutoDJ never applies the acknowledged command", async (t) => {
  let now = 0;
  const client = new AutoDjServiceClient({
    serviceUrl: "http://127.0.0.1:3100",
    applicationTimeoutMs: 1000,
    now: () => now,
    setTimeoutFn(callback, delay) {
      now += delay;
      callback();
      return { unref() {} };
    },
    fetchImpl: async (url) => new Response(JSON.stringify(
      String(url).endsWith("request-starting")
        ? { sequence: 4, accepted: true }
        : { application: { lastAppliedSequence: 3, lastApplyOutcome: "applied" }, takeover: null }
    ), { status: 200, headers: { "content-type": "application/json" } })
  });
  t.after(() => client.close());

  await assert.rejects(
    client.acquire({ id: "held", provider: "youtube", title: "Held" }),
    /safety deadline/
  );
  assert.equal(client.getStatus().takeoverActive, false);
});
