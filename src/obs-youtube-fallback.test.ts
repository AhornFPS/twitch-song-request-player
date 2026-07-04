// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { ObsYoutubeFallback } from "./obs-youtube-fallback.js";

function createFakeObsClient(calls) {
  return {
    async connect(url, password) {
      calls.push({
        type: "connect",
        url,
        password
      });
    },
    async call(requestType, requestPayload) {
      calls.push({
        type: "call",
        requestType,
        requestPayload
      });
    },
    async disconnect() {
      calls.push({
        type: "disconnect"
      });
    }
  };
}

test("OBS YouTube fallback opens login page and starts blocked tracks on the configured source", async () => {
  const calls = [];
  const endedEvents = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls),
    playbackBufferSeconds: 0,
    onTrackEnded: async (event) => {
      endedEvents.push(event);
    }
  });

  assert.equal(fallback.isConfigured(), true);
  assert.equal(fallback.canPlayBlockedYouTube({ provider: "youtube" }), true);
  assert.equal(
    fallback.shouldHandlePlayerError(
      { provider: "youtube" },
      { reason: "youtube_150" }
    ),
    true
  );

  await fallback.openLoginPage();
  assert.deepEqual(calls.slice(0, 3), [
    {
      type: "connect",
      url: "ws://127.0.0.1:4455",
      password: "secret"
    },
    {
      type: "call",
      requestType: "SetInputSettings",
      requestPayload: {
        inputName: "YouTube Fallback",
        inputSettings: {
          url: "https://www.youtube.com/"
        },
        overlay: true
      }
    },
    {
      type: "disconnect"
    }
  ]);

  await fallback.startTrack({
    id: "track-1",
    provider: "youtube",
    url: "https://music.youtube.com/watch?v=blocked",
    title: "Blocked Track",
    key: "youtube:blocked",
    durationSeconds: 1
  }, {
    reason: "youtube_150"
  });

  const playbackCall = calls.findLast((call) => call.type === "call");
  assert.equal(playbackCall.requestPayload.inputSettings.url, "https://www.youtube.com/watch?v=blocked&autoplay=1");
  assert.equal(fallback.isPlayingTrack({ id: "track-1" }), true);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(endedEvents, [
    {
      trackId: "track-1",
      reason: "obs_youtube_fallback_timer"
    }
  ]);
});

test("OBS YouTube fallback keeps the default finish buffer short", () => {
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({})
  });

  assert.equal(fallback.playbackBufferSeconds, 1);
});

test("OBS YouTube fallback refreshes a missing duration before playback", async () => {
  const calls = [];
  const endedEvents = [];
  const refreshedTracks = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls),
    resolveTrackMetadata: async (track) => {
      refreshedTracks.push(track);
      return {
        durationSeconds: 1
      };
    },
    playbackBufferSeconds: 0,
    onTrackEnded: async (event) => {
      endedEvents.push(event);
    }
  });
  const track = {
    id: "track-without-duration",
    provider: "youtube",
    url: "https://youtu.be/f0I09y6JDUQ",
    title: "Influence",
    key: "youtube:f0I09y6JDUQ"
  };

  const startResult = await fallback.startTrack(track, {
    reason: "youtube_150"
  });

  assert.equal(refreshedTracks.length, 1);
  assert.equal(refreshedTracks[0], track);
  assert.equal(track.durationSeconds, 1);
  assert.deepEqual(startResult, {
    durationSeconds: 1
  });

  const playbackCall = calls.findLast((call) => call.type === "call");
  assert.equal(playbackCall.requestPayload.inputSettings.url, "https://www.youtube.com/watch?v=f0I09y6JDUQ&autoplay=1");

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(endedEvents, [
    {
      trackId: "track-without-duration",
      reason: "obs_youtube_fallback_timer"
    }
  ]);
});

test("OBS YouTube fallback can clear a stale source without an active in-memory track", async () => {
  const calls = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls)
  });

  assert.equal(fallback.isPlayingTrack({ id: "missing-after-restart" }), false);
  const cleared = await fallback.clearSource({
    reason: "embedded_playback_start"
  });

  assert.equal(cleared, true);
  const clearCall = calls.find((call) => call.type === "call");
  assert.equal(clearCall.requestPayload.inputName, "YouTube Fallback");
  assert.equal(clearCall.requestPayload.inputSettings.url, "about:blank");
});
