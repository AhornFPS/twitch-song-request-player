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

test("playback suppression stops the active queued track and requeues it", async () => {
  const { controller, emittedEvents } = createController();

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/requeue",
    title: "Queued Track",
    key: "youtube:requeue",
    artworkUrl: "",
    requestedBy: {
      username: "viewer",
      displayName: "Viewer"
    }
  });

  assert.equal(controller.getCurrentTrack()?.title, "Queued Track");

  await controller.setPlaybackSuppressed(true, {
    category: "Just Chatting"
  });

  assert.equal(controller.getCurrentTrack(), null);
  assert.equal(controller.getPublicState().queue.length, 1);
  assert.equal(controller.getPublicState().queue[0].title, "Queued Track");
  assert.equal(
    emittedEvents.some(({ event, payload }) => event === "player:stop" && payload?.reason === "category_suppressed"),
    true
  );
});
