import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./player-controller.js";

function createController({ runtimeStateStore = null } = {}) {
  const emittedEvents = [];
  const io = {
    emit(event, payload) {
      emittedEvents.push({ event, payload });
    }
  };
  const playlistRepository = {
    hasTrack() {
      return false;
    },
    getRandomTrack() {
      return null;
    },
    async appendTrack() {
      return true;
    },
    async removeTrack() {
    }
  };

  return {
    controller: new PlayerController({
      io,
      playlistRepository,
      runtimeStateStore
    }),
    emittedEvents
  };
}

test("duplicate requests are ignored when the same track is already active", async () => {
  const { controller, emittedEvents } = createController();

  const firstResult = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/duplicate",
    title: "Duplicate Track",
    key: "youtube:duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const duplicateResult = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/duplicate",
    title: "Duplicate Track",
    key: "youtube:duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  assert.equal(firstResult.alreadyQueued, false);
  assert.equal(duplicateResult.alreadyQueued, false);
  assert.equal(duplicateResult.duplicateType, "playing");
  assert.equal(duplicateResult.title, "Duplicate Track");
  assert.equal(controller.getPublicState().queue.length, 0);
  assert.equal(controller.getCurrentTrack()?.key, "youtube:duplicate");
  assert.equal(emittedEvents.filter(({ event }) => event === "player:load").length, 1);
});

test("duplicate requests are ignored when the same track is already queued", async () => {
  const { controller } = createController();

  const firstResult = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/queued-duplicate",
    title: "Queued Duplicate Track",
    key: "youtube:queued-duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  controller.currentTrack = {
    ...controller.currentTrack,
    key: "youtube:other-track"
  };
  controller.queue.push({
    id: "track-queued",
    provider: "youtube",
    url: "https://youtu.be/queued-duplicate",
    title: "Queued Duplicate Track",
    key: "youtube:queued-duplicate",
    artworkUrl: "",
    origin: "queue",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const duplicateResult = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/queued-duplicate",
    title: "Queued Duplicate Track",
    key: "youtube:queued-duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  assert.equal(firstResult.alreadyQueued, false);
  assert.equal(duplicateResult.alreadyQueued, true);
  assert.equal(duplicateResult.duplicateType, "queue");
  assert.equal(controller.getPublicState().queue.length, 1);
});

test("pause toggle updates controller state and emits a player pause event", async () => {
  const { controller, emittedEvents } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/pauseable",
    title: "Pauseable Track",
    key: "youtube:pauseable",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const pauseResult = await controller.togglePauseCurrentTrack("desktop_media_play_pause");
  const resumeResult = await controller.togglePauseCurrentTrack("desktop_media_play_pause");

  assert.equal(pauseResult?.paused, true);
  assert.equal(resumeResult?.paused, false);
  assert.equal(
    emittedEvents.filter(({ event }) => event === "player:toggle-pause").length,
    2
  );
});

test("stop keeps the current track ready to restart without auto-advancing", async () => {
  const { controller, emittedEvents } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/stop-me",
    title: "Stop Me",
    key: "youtube:stop-me",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/play-next-later",
    title: "Play Next Later",
    key: "youtube:play-next-later",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  const stoppedTrack = await controller.stopPlayback("dashboard");

  assert.equal(stoppedTrack?.title, "Stop Me");
  assert.equal(controller.getPublicState().playbackStatus, "stopped");
  assert.equal(controller.getPublicState().currentTrack, null);
  assert.equal(controller.getPublicState().stoppedTrack?.title, "Stop Me");
  assert.equal(controller.getPublicState().queue.length, 1);
  assert.equal(
    emittedEvents.some(({ event, payload }) => event === "player:stop" && payload?.reason === "manual_stop"),
    true
  );

  await controller.ensurePlayback();

  assert.equal(controller.getPublicState().currentTrack, null);
  assert.equal(controller.getPublicState().stoppedTrack?.title, "Stop Me");
  assert.equal(controller.getPublicState().queue.length, 1);
});

test("play resumes a stopped track and next advances past it", async () => {
  const { controller, emittedEvents } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/restart-this",
    title: "Restart This",
    key: "youtube:restart-this",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.addRequest({
    provider: "soundcloud",
    url: "https://soundcloud.com/artist/next-up",
    title: "Next Up",
    key: "soundcloud:https://soundcloud.com/artist/next-up",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  await controller.stopPlayback("dashboard");

  const resumed = await controller.playOrPausePlayback("dashboard");

  assert.equal(resumed?.resumedFromStopped, true);
  assert.equal(controller.getPublicState().playbackStatus, "playing");
  assert.equal(controller.getPublicState().currentTrack?.title, "Restart This");

  await controller.stopPlayback("dashboard");
  await controller.skipToNextTrack("dashboard");

  assert.equal(controller.getPublicState().playbackStatus, "playing");
  assert.equal(controller.getPublicState().currentTrack?.title, "Next Up");
  assert.equal(controller.getPublicState().stoppedTrack, null);
  assert.equal(
    emittedEvents.filter(({ event }) => event === "player:load").length,
    3
  );
});

test("duplicate requests are ignored when the same track is stopped", async () => {
  const { controller } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/stopped-duplicate",
    title: "Stopped Duplicate Track",
    key: "youtube:stopped-duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.stopPlayback("dashboard");

  const duplicateResult = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/stopped-duplicate",
    title: "Stopped Duplicate Track",
    key: "youtube:stopped-duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  assert.equal(duplicateResult.alreadyQueued, false);
  assert.equal(duplicateResult.duplicateType, "stopped");
  assert.equal(controller.getPublicState().playbackStatus, "stopped");
  assert.equal(controller.getPublicState().queue.length, 0);
});

test("queue items can be moved, promoted, and removed from the dashboard queue", async () => {
  const { controller } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/track-one",
    title: "Track One",
    key: "youtube:track-one",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const secondTrack = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/track-two",
    title: "Track Two",
    key: "youtube:track-two",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  const thirdTrack = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/track-three",
    title: "Track Three",
    key: "youtube:track-three",
    artworkUrl: "",
    requestedBy: {
      username: "viewerthree",
      displayName: "ViewerThree"
    }
  });

  const promoted = await controller.promoteQueuedTrack(thirdTrack.id, "dashboard");
  assert.equal(promoted?.title, "Track Three");
  assert.deepEqual(
    controller.getPublicState().queue.map((track) => track.title),
    ["Track Three", "Track Two"]
  );

  const movedDown = await controller.moveQueuedTrack(thirdTrack.id, 1, "dashboard");
  assert.equal(movedDown?.title, "Track Three");
  assert.deepEqual(
    controller.getPublicState().queue.map((track) => track.title),
    ["Track Two", "Track Three"]
  );

  const removed = await controller.removeQueuedTrack(secondTrack.id, "dashboard");
  assert.equal(removed?.title, "Track Two");
  assert.deepEqual(
    controller.getPublicState().queue.map((track) => track.title),
    ["Track Three"]
  );
});

test("queue can be cleared without interrupting the current track", async () => {
  const { controller } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/clear-current",
    title: "Current Track",
    key: "youtube:clear-current",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/clear-next",
    title: "Queued Track",
    key: "youtube:clear-next",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  const result = await controller.clearQueue("dashboard");

  assert.equal(result.clearedCount, 1);
  assert.equal(controller.getPublicState().currentTrack?.title, "Current Track");
  assert.equal(controller.getPublicState().queue.length, 0);
});

test("controller persists queue, stopped track, and history to the runtime state store", async () => {
  let savedState = null;
  const runtimeStateStore = {
    async load() {
      return {
        queue: [],
        stoppedTrack: null,
        history: []
      };
    },
    async save(state) {
      savedState = JSON.parse(JSON.stringify(state));
    }
  };

  const { controller } = createController({ runtimeStateStore });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/persist-me",
    title: "Persist Me",
    key: "youtube:persist-me",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });
  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/persist-next",
    title: "Persist Next",
    key: "youtube:persist-next",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });
  await controller.stopPlayback("dashboard");

  assert.equal(savedState.queue.length, 1);
  assert.equal(savedState.stoppedTrack.title, "Persist Me");
  assert.equal(savedState.history[0].status, "stopped");
});

test("controller restores queue, stopped track, and history from the runtime state store", async () => {
  const runtimeStateStore = {
    async load() {
      return {
        queue: [
          {
            id: "queued-one",
            provider: "youtube",
            url: "https://youtu.be/queued-one",
            title: "Queued One",
            key: "youtube:queued-one",
            origin: "queue",
            artworkUrl: "",
            requestedBy: {
              username: "viewerone",
              displayName: "ViewerOne"
            }
          }
        ],
        stoppedTrack: {
          id: "stopped-one",
          provider: "youtube",
          url: "https://youtu.be/stopped-one",
          title: "Stopped One",
          key: "youtube:stopped-one",
          origin: "queue",
          artworkUrl: "",
          requestedBy: {
            username: "viewerone",
            displayName: "ViewerOne"
          }
        },
        history: [
          {
            track: {
              id: "history-one",
              provider: "youtube",
              url: "https://youtu.be/history-one",
              title: "History One",
              key: "youtube:history-one",
              origin: "queue",
              artworkUrl: "",
              requestedBy: {
                username: "viewerone",
                displayName: "ViewerOne"
              }
            },
            status: "skipped",
            completedAt: "2026-03-17T12:00:00.000Z"
          }
        ]
      };
    },
    async save() {
    }
  };

  const { controller } = createController({ runtimeStateStore });
  await controller.restoreRuntimeState();

  const state = controller.getPublicState();
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].title, "Queued One");
  assert.equal(state.stoppedTrack?.title, "Stopped One");
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].track?.title, "History One");
  assert.equal(state.history[0].status, "skipped");
});

test("request policy enforces a max queue length for normal requests", async () => {
  const { controller } = createController();
  controller.setRequestPolicy({
    requestsEnabled: true,
    maxQueueLength: 1,
    maxRequestsPerUser: 0
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/limit-one",
    title: "Limit One",
    key: "youtube:limit-one",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/limit-two",
    title: "Limit Two",
    key: "youtube:limit-two",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  await assert.rejects(
    controller.addRequest({
      provider: "youtube",
      url: "https://youtu.be/limit-three",
      title: "Limit Three",
      key: "youtube:limit-three",
      artworkUrl: "",
      requestedBy: {
        username: "viewerthree",
        displayName: "ViewerThree"
      }
    }),
    /queue is full/i
  );
});

test("request policy enforces per-user active request limits but allows bypassed requests", async () => {
  const { controller } = createController();
  controller.setRequestPolicy({
    requestsEnabled: true,
    maxQueueLength: 0,
    maxRequestsPerUser: 1
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/user-limit-one",
    title: "User Limit One",
    key: "youtube:user-limit-one",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await assert.rejects(
    controller.addRequest({
      provider: "youtube",
      url: "https://youtu.be/user-limit-two",
      title: "User Limit Two",
      key: "youtube:user-limit-two",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      }
    }),
    /too many active song requests/i
  );

  const bypassedTrack = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/mod-bypass",
    title: "Mod Bypass",
    key: "youtube:mod-bypass",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  }, {
    bypassRequestLimits: true
  });

  assert.equal(bypassedTrack.title, "Mod Bypass");
});

test("request policy enforces per-user cooldowns for normal requests", async (t) => {
  const { controller } = createController();
  const originalNow = Date.now;
  let currentNow = 1_000_000;

  Date.now = () => currentNow;
  t.after(() => {
    Date.now = originalNow;
  });

  controller.setRequestPolicy({
    requestsEnabled: true,
    maxQueueLength: 0,
    maxRequestsPerUser: 0,
    cooldownSeconds: 30
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/cooldown-one",
    title: "Cooldown One",
    key: "youtube:cooldown-one",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  currentNow += 10_000;

  await assert.rejects(
    controller.addRequest({
      provider: "youtube",
      url: "https://youtu.be/cooldown-two",
      title: "Cooldown Two",
      key: "youtube:cooldown-two",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      }
    }),
    /wait 20 more seconds/i
  );

  currentNow += 21_000;

  const acceptedTrack = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/cooldown-three",
    title: "Cooldown Three",
    key: "youtube:cooldown-three",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  assert.equal(acceptedTrack.title, "Cooldown Three");
});
