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
