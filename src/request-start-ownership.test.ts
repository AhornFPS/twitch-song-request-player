// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PlayerController } from "./player-controller.js";

function actualServerBeforeStart(context) {
  const source = ts.createSourceFile("app-server.ts", fs.readFileSync(new URL("./app-server.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "beforeTrackStart") matches.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1);
  return vm.runInNewContext(`(${matches[0].getText(source)})`, context);
}

function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ route, before }) {
  const events = [];
  const timers = [];
  const controller = new PlayerController({
    io: { emit: (event) => events.push(event) },
    playlistRepository: { getRandomTrack: async () => null, hasTrack: () => false },
    routeOwnedRequest: route,
    beforeTrackStart: before,
    setTimeoutFn: (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeoutFn() {}
  });
  const track = { id: "late-request-generation-1", provider: "youtube", origin: "queue", title: "Late indexed request", key: "youtube:late" };
  controller.queue.push(track);
  return { controller, track, events, timers };
}

test("a late local match during a successful takeover releases the lease and never starts external playback", async () => {
  const acquired = gate();
  const entered = gate();
  let indexed = false;
  let releases = 0;
  const { controller, track, events } = fixture({
    route: async () => ({ matched: indexed }),
    before: async () => {
      entered.resolve();
      await acquired.promise;
      return { ready: true, cancel: async () => { releases++; } };
    }
  });
  const advancing = controller.ensurePlayback();
  await entered.promise;
  indexed = true;
  await controller.recheckOwnedQueuedRequest(track.id);
  acquired.resolve();
  await advancing;
  assert.equal(releases, 1);
  assert.equal(controller.currentTrack, null);
  assert.equal(controller.queue.length, 0);
  assert.equal(events.includes("player:load"), false);
});

test("an import during acquire is checked again even when its retry timer has not fired", async () => {
  let indexed = false;
  let releases = 0;
  const { controller, events } = fixture({
    route: async () => ({ matched: indexed }),
    before: async () => {
      indexed = true;
      return { ready: true, cancel: async () => { releases++; } };
    }
  });
  await controller.ensurePlayback();
  assert.equal(releases, 1);
  assert.equal(controller.currentTrack, null);
  assert.equal(controller.queue.length, 0);
  assert.equal(events.includes("player:load"), false);
});

test("an ownership check already in flight is shared with final admission", async () => {
  const checked = gate();
  let checks = 0;
  let acquisitions = 0;
  const { controller, track, events } = fixture({
    route: async () => { checks++; return checked.promise; },
    before: async () => { acquisitions++; return { ready: true }; }
  });
  const recheck = controller.recheckOwnedQueuedRequest(track.id);
  const advancing = controller.ensurePlayback();
  checked.resolve({ matched: true });
  await Promise.all([recheck, advancing]);
  assert.equal(checks, 1);
  assert.equal(acquisitions, 0);
  assert.equal(events.includes("player:load"), false);
});

test("uncertain final ownership releases the provisional lease and keeps the request pending", async () => {
  let checks = 0;
  let releases = 0;
  const { controller, events } = fixture({
    route: async () => ++checks === 1 ? { matched: false } : { unavailable: true },
    before: async () => ({ ready: true, cancel: async () => { releases++; } })
  });
  await controller.ensurePlayback();
  assert.equal(releases, 1);
  assert.equal(controller.queue.length, 1);
  assert.equal(controller.currentTrack, null);
  assert.equal(events.includes("player:load"), false);
});

test("a confirmed absent request commits external playback exactly once", async () => {
  let releases = 0;
  const { controller, events, track } = fixture({
    route: async () => ({ matched: false }),
    before: async () => ({ ready: true, cancel: async () => { releases++; } })
  });
  await controller.ensurePlayback();
  assert.equal(releases, 0);
  assert.equal(controller.currentTrack.id, track.id);
  assert.equal(events.filter((event) => event === "player:load").length, 1);
});

test("a removed request cannot start while its takeover acknowledgement is pending", async () => {
  let releases = 0;
  let controller;
  const result = fixture({
    route: async () => ({ matched: false }),
    before: async () => {
      controller.queue.length = 0;
      return { ready: true, cancel: async () => { releases++; } };
    }
  });
  controller = result.controller;
  await controller.ensurePlayback();
  assert.equal(releases, 1);
  assert.equal(controller.currentTrack, null);
  assert.equal(result.events.includes("player:load"), false);
});

test("a failed provisional release fences future starts without an automatic retry loop", async () => {
  let indexed = false;
  let releaseFailed = true;
  let releases = 0;
  let acquisitions = 0;
  const { controller, events, timers } = fixture({
    route: async () => ({ matched: indexed }),
    before: async () => {
      acquisitions++;
      indexed = true;
      return { ready: true, cancel: async () => {
        releases++;
        if (releaseFailed) throw new Error("release not acknowledged");
      } };
    }
  });
  await controller.ensurePlayback();
  assert.equal(releases, 1);
  assert.equal(controller.queue.length, 1);
  assert.equal(events.includes("player:load"), false);
  assert.equal(timers.length, 0);
  await assert.rejects(controller.ensurePlayback(), /release not acknowledged/);
  assert.equal(acquisitions, 1);
  releaseFailed = false;
  await controller.ensurePlayback();
  assert.equal(controller.queue.length, 0);
  assert.equal(acquisitions, 1);
  assert.equal(events.includes("player:load"), false);
});

test("the actual server callback releases only the exact acquired request lease after a late import", async () => {
  let indexed = false;
  const reasons = [];
  const client = {
    leaseId: "lease-original", activeTrack: null,
    getStatus() { return { takeoverActive: Boolean(this.activeTrack), activeTrack: this.activeTrack }; },
    async getRequestHandoffReadiness() { return { ready: true }; },
    async acquire(track) { this.activeTrack = track; indexed = true; }
  };
  const before = actualServerBeforeStart({
    currentSettings: { autoDjEnabled: true }, autoDjAuthoritySynchronized: true,
    autoDjServiceClient: client,
    releaseAutoDjTakeover: async (reason) => { reasons.push(reason); client.activeTrack = null; }
  });
  const { controller, events } = fixture({ route: async () => ({ matched: indexed }), before });
  await controller.ensurePlayback();
  assert.deepEqual(reasons, ["request_owned_before_external_start"]);
  assert.equal(client.activeTrack, null);
  assert.equal(controller.queue.length, 0);
  assert.equal(events.includes("player:load"), false);
});

test("the actual cancellation refuses a newer lease or a different request owner", async () => {
  for (const change of ["lease", "track"]) {
    let releases = 0;
    const client = {
      leaseId: "lease-original", activeTrack: null,
      getStatus() { return { takeoverActive: Boolean(this.activeTrack), activeTrack: this.activeTrack }; },
      async getRequestHandoffReadiness() { return { ready: true }; },
      async acquire(track) { this.activeTrack = track; }
    };
    const before = actualServerBeforeStart({
      currentSettings: { autoDjEnabled: true }, autoDjAuthoritySynchronized: true,
      autoDjServiceClient: client,
      releaseAutoDjTakeover: async () => { releases++; }
    });
    const readiness = await before({ id: "original-request", origin: "queue" });
    if (change === "lease") client.leaseId = "new-lease";
    else client.activeTrack = { id: "new-request" };
    await assert.rejects(readiness.cancel(), /ownership changed/);
    assert.equal(releases, 0);
  }
});
