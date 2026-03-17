import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./player-controller.js";

function createController() {
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
      playlistRepository
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

test("queue items can be promoted and removed from the dashboard queue", async () => {
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
