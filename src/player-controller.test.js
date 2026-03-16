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
  assert.equal(duplicateResult.alreadyQueued, true);
  assert.equal(duplicateResult.title, "Duplicate Track");
  assert.equal(controller.getPublicState().queue.length, 0);
  assert.equal(controller.getCurrentTrack()?.key, "youtube:duplicate");
  assert.equal(emittedEvents.filter(({ event }) => event === "player:load").length, 1);
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
