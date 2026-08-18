// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./player-controller.js";

function createController({
  runtimeStateStore = null,
  requestAuditStore = null,
  requestPolicy = {},
  radioModeEnabled = true,
  radioTrackCount = 3,
  playlistRepositoryOverrides = {},
  getRadioTracks = null,
  externalPlayback = null,
  routeOwnedRequest = null,
  beforeTrackStart = null,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const emittedEvents = [];
  const io = {
    emit(event, payload) {
      emittedEvents.push({ event, payload });
    }
  };
  const basePlaylistRepository = {
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
    },
    async recordTrackPlaybackFailure() {
    },
    async recordTrackPlaybackSuccess() {
    }
  };
  const playlistRepository = {
    ...basePlaylistRepository,
    ...playlistRepositoryOverrides
  };

  return {
    controller: new PlayerController({
      io,
      playlistRepository,
      runtimeStateStore,
      requestAuditStore,
      requestPolicy,
      radioModeEnabled,
      radioTrackCount,
      getRadioTracks,
      externalPlayback,
      routeOwnedRequest,
      beforeTrackStart,
      setTimeoutFn,
      clearTimeoutFn
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

test("playback events update saved-track health hooks", async () => {
  const healthEvents = [];
  const finishEvents = [];
  const { controller } = createController({
    playlistRepositoryOverrides: {
      hasTrack() {
        return true;
      },
      async recordTrackPlaybackSuccess(track) {
        healthEvents.push({
          type: "success",
          key: track.key
        });
      },
      async recordTrackPlaybackFailure(track, details) {
        healthEvents.push({
          type: "failure",
          key: track.key,
          reason: details.reason
        });
      }
    }
  });
  controller.onTrackFinish((event) => {
    finishEvents.push(event);
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/health-check",
    title: "Health Check",
    key: "youtube:health-check",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const currentTrackId = controller.getCurrentTrack()?.id;
  await controller.handlePlayerEvent({
    trackId: currentTrackId,
    status: "playing"
  });
  await controller.handlePlayerEvent({
    trackId: currentTrackId,
    status: "error",
    reason: "youtube_startup_timeout"
  });

  assert.deepEqual(healthEvents, [
    {
      type: "success",
      key: "youtube:health-check"
    },
    {
      type: "failure",
      key: "youtube:health-check",
      reason: "youtube_startup_timeout"
    }
  ]);
  assert.equal(finishEvents.length, 1);
  assert.equal(finishEvents[0].status, "error");
  assert.equal(finishEvents[0].reason, "youtube_startup_timeout");
  assert.equal(finishEvents[0].track.title, "Health Check");
});

test("non-embeddable YouTube requests are rejected before queueing", async () => {
  const { controller } = createController();

  await assert.rejects(
    controller.addRequest({
      provider: "youtube",
      url: "https://youtu.be/no-embed",
      title: "No Embed",
      key: "youtube:no-embed",
      artworkUrl: "",
      isEmbeddable: false,
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      }
    }, {
      requestSource: "twitch_chat",
      requestInput: "!sr no embed"
    }),
    /cannot be played in the embedded player/
  );

  assert.equal(controller.getCurrentTrack(), null);
  assert.equal(controller.getPublicState().queue.length, 0);
});

test("non-embeddable YouTube requests can start through external fallback playback", async () => {
  const fallbackStarts = [];
  const fallbackStops = [];
  const playbackAnnouncements = [];
  const { controller, emittedEvents } = createController({
    externalPlayback: {
      canPlayBlockedYouTube(track) {
        return track?.provider === "youtube";
      },
      shouldHandleTrack(track) {
        return track?.provider === "youtube" && track.isEmbeddable === false;
      },
      async startTrack(track, details) {
        fallbackStarts.push({ track, details });
        return true;
      },
      async stopTrack(track, details) {
        fallbackStops.push({ track, details });
      }
    }
  });
  controller.onTrackPlayback((track) => {
    playbackAnnouncements.push(track.title);
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/no-embed",
    title: "No Embed",
    key: "youtube:no-embed",
    artworkUrl: "",
    durationSeconds: 120,
    isEmbeddable: false,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  assert.equal(controller.getCurrentTrack()?.title, "No Embed");
  assert.equal(controller.getCurrentTrack()?.playbackMode, "external");
  assert.equal(controller.getCurrentTrack()?.playbackProvider, "obs_youtube_fallback");
  assert.equal(fallbackStarts.length, 1);
  assert.equal(fallbackStarts[0].details.reason, "metadata_embed_blocked");
  assert.deepEqual(playbackAnnouncements, ["No Embed"]);
  assert.equal(emittedEvents.some(({ event }) => event === "player:load"), false);
  assert.equal(
    emittedEvents.some(({ event, payload }) =>
      event === "state" &&
      payload.currentTrack?.id === controller.getCurrentTrack()?.id &&
      payload.currentTrack?.playbackMode === "external"
    ),
    true
  );

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended",
    reason: "obs_youtube_fallback_timer"
  });

  assert.equal(fallbackStops.length, 1);
  assert.equal(controller.getCurrentTrack(), null);
});

test("queued external fallback tracks advance when the OBS fallback finish event is missed", async () => {
  let activeFallbackTrackId = "";
  const fallbackStops = [];
  const { controller } = createController({
    externalPlayback: {
      canPlayBlockedYouTube(track) {
        return track?.provider === "youtube";
      },
      shouldHandleTrack(track) {
        return track?.provider === "youtube" && track.isEmbeddable === false;
      },
      async startTrack(track) {
        activeFallbackTrackId = track.id;
        return true;
      },
      isPlayingTrack(track) {
        return Boolean(activeFallbackTrackId && track?.id === activeFallbackTrackId);
      },
      async stopTrack(track, details) {
        fallbackStops.push({ track, details });
        if (track?.id === activeFallbackTrackId) {
          activeFallbackTrackId = "";
        }
      }
    }
  });
  controller.fallbackPlaylistFinishBufferSeconds = 0;

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/external-fallback",
    title: "External Fallback",
    key: "youtube:external-fallback",
    artworkUrl: "",
    durationSeconds: 1,
    isEmbeddable: false,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });
  await controller.addRequest({
    provider: "soundcloud",
    url: "https://soundcloud.com/artist/next-after-fallback",
    title: "Next After Fallback",
    key: "soundcloud:https://soundcloud.com/artist/next-after-fallback",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  const firstTrackId = controller.getCurrentTrack()?.id;
  controller.currentTrackStartedAt = Date.now() - 1500;
  controller.scheduleFallbackPlaylistFinishTimer();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(controller.getCurrentTrack()?.title, "Next After Fallback");
  assert.notEqual(controller.getCurrentTrack()?.id, firstTrackId);
  assert.equal(fallbackStops.length, 1);
  assert.equal(fallbackStops[0].track.title, "External Fallback");
  assert.equal(fallbackStops[0].details.reason, "external_fallback_timer");
  assert.equal(controller.getPublicState().history[0]?.track.title, "External Fallback");
  assert.equal(controller.getPublicState().history[0]?.status, "ended");
});

test("external fallback playback can hydrate missing track duration", async () => {
  const { controller } = createController({
    externalPlayback: {
      canPlayBlockedYouTube(track) {
        return track?.provider === "youtube";
      },
      shouldHandleTrack(track) {
        return track?.provider === "youtube" && track.isEmbeddable === false;
      },
      async startTrack() {
        return {
          durationSeconds: 185
        };
      },
      isPlayingTrack(track) {
        return track?.provider === "youtube";
      },
      async stopTrack() {
      }
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/f0I09y6JDUQ",
    title: "Influence",
    key: "youtube:f0I09y6JDUQ",
    artworkUrl: "",
    isEmbeddable: false,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  assert.equal(controller.getCurrentTrack()?.durationSeconds, 185);
  assert.equal(controller.getPublicState().currentTrack?.durationSeconds, 185);
  assert.equal(controller.getPublicState().currentTrack?.playbackMode, "external");
});

test("unavailable external fallback tracks advance automatically", async () => {
  const fallbackTracks = [
    {
      provider: "youtube",
      url: "https://youtu.be/unavailable123",
      title: "https://youtu.be/unavailable123",
      key: "youtube:unavailable123",
      origin: "playlist",
      artworkUrl: ""
    },
    {
      provider: "youtube",
      url: "https://youtu.be/next-playable",
      title: "Next Playable Track",
      key: "youtube:next-playable",
      origin: "playlist",
      artworkUrl: ""
    }
  ];
  const playbackFailures = [];
  const playbackAnnouncements = [];
  const { controller } = createController({
    playlistRepositoryOverrides: {
      async getRandomTrack() {
        return fallbackTracks.shift() ?? null;
      },
      async recordTrackPlaybackFailure(track, details) {
        playbackFailures.push({ track, details });
      }
    },
    externalPlayback: {
      shouldHandleTrack() {
        return false;
      },
      shouldHandlePlayerError(track, payload) {
        return track?.provider === "youtube" && payload?.reason === "youtube_150";
      },
      async startTrack() {
        return {
          unavailable: true,
          reason: "youtube_video_unavailable",
          message: "No YouTube video metadata found for unavailable123.",
          durationSeconds: null
        };
      },
      async stopTrack() {
      },
      async clearSource() {
      }
    }
  });
  controller.onTrackPlayback((track) => {
    playbackAnnouncements.push(track.title);
  });

  await controller.ensurePlayback();
  const unavailableTrackId = controller.getCurrentTrack()?.id;
  await controller.handlePlayerEvent({
    trackId: unavailableTrackId,
    status: "error",
    reason: "youtube_150"
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(controller.getCurrentTrack()?.title, "Next Playable Track");
  assert.equal(controller.getPublicState().history[0]?.track.title, "https://youtu.be/unavailable123");
  assert.equal(controller.getPublicState().history[0]?.status, "error");
  assert.equal(playbackFailures.length, 1);
  assert.equal(playbackFailures[0].details.reason, "youtube_video_unavailable");
  assert.deepEqual(playbackAnnouncements, []);
});

test("blocked embedded YouTube errors switch to external fallback playback instead of finishing", async () => {
  const fallbackStarts = [];
  const { controller } = createController({
    externalPlayback: {
      canPlayBlockedYouTube() {
        return false;
      },
      shouldHandleTrack() {
        return false;
      },
      shouldHandlePlayerError(track, payload) {
        return track?.provider === "youtube" && payload?.reason === "youtube_150";
      },
      async startTrack(track, details) {
        fallbackStarts.push({ track, details });
        return true;
      },
      isPlayingTrack(track) {
        return fallbackStarts.some((entry) => entry.track.id === track?.id);
      },
      async stopTrack() {
      }
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/runtime-blocked",
    title: "Runtime Blocked",
    key: "youtube:runtime-blocked",
    artworkUrl: "",
    durationSeconds: 90,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const trackId = controller.getCurrentTrack()?.id;
  await controller.handlePlayerEvent({
    trackId,
    status: "error",
    reason: "youtube_150"
  });

  assert.equal(controller.getCurrentTrack()?.id, trackId);
  assert.equal(controller.getCurrentTrack()?.playbackMode, "external");
  assert.equal(controller.getPublicState().history.length, 0);
  assert.equal(fallbackStarts.length, 1);
  assert.equal(fallbackStarts[0].details.reason, "youtube_150");

  const socketEvents = [];
  controller.handleSocketConnection({
    id: "socket-1",
    emit(event, payload) {
      socketEvents.push({
        event,
        payload
      });
    },
    on() {
    }
  });

  assert.equal(socketEvents.some(({ event }) => event === "state"), true);
  assert.equal(
    socketEvents.some(({ event, payload }) =>
      event === "state" &&
      payload.currentTrack?.id === trackId &&
      payload.currentTrack?.playbackMode === "external"
    ),
    true
  );
  assert.equal(socketEvents.some(({ event }) => event === "player:load"), false);
});

test("OBS browser-source startup clears stale fallback audio before loading embedded playback", async () => {
  const lifecycle = [];
  let sourceClearNeeded = false;
  const { controller } = createController({
    externalPlayback: {
      shouldHandleTrack() {
        return false;
      },
      needsSourceClear() {
        return sourceClearNeeded;
      },
      async clearSource() {
        lifecycle.push("fallback:clear:start");
        await Promise.resolve();
        sourceClearNeeded = false;
        lifecycle.push("fallback:clear:end");
      }
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/normal-after-obs-start",
    title: "Normal After OBS Start",
    key: "youtube:normal-after-obs-start",
    artworkUrl: "",
    durationSeconds: 180,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  sourceClearNeeded = true;
  lifecycle.length = 0;

  await controller.handleSocketConnection({
    id: "obs-socket",
    handshake: {
      auth: {
        playbackClientRole: "obs"
      }
    },
    emit(event) {
      lifecycle.push(`socket:${event}`);
    },
    on() {
    }
  });

  assert.deepEqual(lifecycle.slice(0, 3), [
    "fallback:clear:start",
    "fallback:clear:end",
    "socket:state"
  ]);
  assert.equal(lifecycle.includes("socket:player:load"), true);
});

test("OBS browser-source startup defers embedded playback while stale fallback cleanup fails", async () => {
  const socketEvents = [];
  const { controller } = createController({
    externalPlayback: {
      shouldHandleTrack() {
        return false;
      },
      needsSourceClear() {
        return true;
      },
      async clearSource() {
        return false;
      }
    }
  });

  controller.currentTrack = {
    id: "current-youtube",
    provider: "youtube",
    url: "https://youtu.be/current-youtube",
    title: "Current YouTube",
    key: "youtube:current-youtube",
    origin: "playlist",
    playbackConfirmed: true
  };

  await controller.handleSocketConnection({
    id: "obs-socket",
    handshake: {
      auth: {
        playbackClientRole: "obs"
      }
    },
    emit(event) {
      socketEvents.push(event);
    },
    on() {
    }
  });

  assert.deepEqual(socketEvents, []);
});

test("embedded playback clears stale external fallback source before loading the player", async () => {
  const clearCalls = [];
  const { controller, emittedEvents } = createController({
    externalPlayback: {
      canPlayBlockedYouTube() {
        return false;
      },
      shouldHandleTrack() {
        return false;
      },
      async clearSource(details) {
        clearCalls.push(details);
      }
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/normal-track",
    title: "Normal Track",
    key: "youtube:normal-track",
    artworkUrl: "",
    durationSeconds: 180,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  assert.equal(clearCalls.length, 1);
  assert.equal(clearCalls[0].reason, "embedded_playback_start");
  assert.equal(clearCalls[0].track.title, "Normal Track");
  assert.equal(
    emittedEvents.some(({ event, payload }) =>
      event === "player:load" &&
      payload.track?.title === "Normal Track"
    ),
    true
  );
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

test("current track elapsed time advances while playing and freezes while paused", async () => {
  const realDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const { controller } = createController();

    await controller.addRequest({
      provider: "youtube",
      url: "https://youtu.be/progress-track",
      title: "Progress Track",
      key: "youtube:progress-track",
      artworkUrl: "",
      durationSeconds: 240,
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      }
    });

    const trackId = controller.getCurrentTrack()?.id;

    await controller.handlePlayerEvent({
      trackId,
      status: "playing"
    });

    now += 45_000;
    let elapsedSeconds = controller.getPublicState().currentTrack?.elapsedSeconds ?? 0;
    assert.equal(Math.round(elapsedSeconds), 45);

    await controller.togglePauseCurrentTrack("dashboard");
    now += 15_000;
    elapsedSeconds = controller.getPublicState().currentTrack?.elapsedSeconds ?? 0;
    assert.equal(Math.round(elapsedSeconds), 45);

    await controller.togglePauseCurrentTrack("dashboard");
    now += 30_000;
    elapsedSeconds = controller.getPublicState().currentTrack?.elapsedSeconds ?? 0;
    assert.equal(Math.round(elapsedSeconds), 75);
  } finally {
    Date.now = realDateNow;
  }
});

test("playing events can refresh the current track duration after playback confirmation", async () => {
  const { controller } = createController();

  await controller.addRequest({
    provider: "soundcloud",
    url: "https://soundcloud.com/example/refreshed-duration",
    title: "Refreshed Duration",
    key: "soundcloud:refreshed-duration",
    artworkUrl: "",
    durationSeconds: 35,
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  const trackId = controller.getCurrentTrack()?.id;

  await controller.handlePlayerEvent({
    trackId,
    status: "playing"
  });

  await controller.handlePlayerEvent({
    trackId,
    status: "playing",
    durationSeconds: 233.8
  });

  assert.equal(controller.getPublicState().currentTrack?.durationSeconds, 233);
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

test("duplicate requests can be blocked by recent playback history", async () => {
  const { controller } = createController({
    requestPolicy: {
      duplicateHistoryCount: 2
    }
  });

  controller.history = [
    {
      track: {
        id: "history-1",
        provider: "youtube",
        url: "https://youtu.be/recent-duplicate",
        title: "Recent Duplicate",
        key: "youtube:recent-duplicate",
        origin: "queue",
        artworkUrl: "",
        requestedBy: {
          username: "viewerone",
          displayName: "ViewerOne"
        }
      },
      status: "ended",
      completedAt: new Date().toISOString()
    }
  ];

  const duplicateResult = await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/recent-duplicate",
    title: "Recent Duplicate",
    key: "youtube:recent-duplicate",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  assert.equal(duplicateResult.alreadyQueued, false);
  assert.equal(duplicateResult.duplicateType, "history");
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

test("fallback playlist tracks advance when the player misses the ended event", async () => {
  const fallbackTracks = [
    {
      provider: "youtube",
      url: "https://youtu.be/fallback-one",
      title: "Fallback One",
      key: "youtube:fallback-one",
      origin: "playlist",
      artworkUrl: ""
    },
    {
      provider: "youtube",
      url: "https://youtu.be/fallback-two",
      title: "Fallback Two",
      key: "youtube:fallback-two",
      origin: "playlist",
      artworkUrl: ""
    }
  ];
  const { controller } = createController({
    playlistRepositoryOverrides: {
      async getRandomTrack() {
        return fallbackTracks.shift() ?? null;
      }
    }
  });
  controller.fallbackPlaylistFinishBufferSeconds = 0;

  await controller.ensurePlayback();
  const firstTrackId = controller.getCurrentTrack()?.id;
  await controller.handlePlayerEvent({
    trackId: firstTrackId,
    status: "playing",
    durationSeconds: 1
  });

  controller.currentTrackStartedAt = Date.now() - 1500;
  controller.scheduleFallbackPlaylistFinishTimer();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(controller.getCurrentTrack()?.title, "Fallback Two");
  assert.notEqual(controller.getCurrentTrack()?.id, firstTrackId);
  assert.equal(controller.getPublicState().history[0]?.track.title, "Fallback One");
  assert.equal(controller.getPublicState().history[0]?.status, "ended");
});

test("radio queues three related tracks after the final queued request finishes", async () => {
  const radioCalls = [];
  const { controller } = createController({
    getRadioTracks: async ({ seedTrack, excludeTrackKeys, count }) => {
      radioCalls.push({
        seedTrack,
        excludeTrackKeys,
        count
      });

      return [
        {
          provider: "youtube",
          url: "https://youtu.be/radio-one",
          title: "Radio One",
          key: "youtube:radio-one",
          artworkUrl: "",
          sourceName: "Radio Artist"
        },
        {
          provider: "youtube",
          url: "https://youtu.be/radio-two",
          title: "Radio Two",
          key: "youtube:radio-two",
          artworkUrl: "",
          sourceName: "Radio Artist"
        },
        {
          provider: "youtube",
          url: "https://youtu.be/radio-three",
          title: "Radio Three",
          key: "youtube:radio-three",
          artworkUrl: "",
          sourceName: "Radio Artist"
        }
      ];
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/final-request",
    title: "Viewer Artist - Final Request",
    key: "youtube:final-request",
    artworkUrl: "",
    sourceName: "Viewer Artist",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  }, {
    requestInput: "rock song"
  });

  const currentTrackId = controller.getCurrentTrack()?.id;
  await controller.handlePlayerEvent({
    trackId: currentTrackId,
    status: "ended"
  });

  assert.equal(radioCalls.length, 1);
  assert.equal(radioCalls[0].count, 3);
  assert.equal(radioCalls[0].seedTrack.title, "Viewer Artist - Final Request");
  assert.equal(radioCalls[0].seedTrack.radioSeedInput, "rock song");
  assert.equal(radioCalls[0].excludeTrackKeys.includes("youtube:final-request"), true);
  assert.equal(controller.getCurrentTrack()?.origin, "radio");
  assert.equal(controller.getCurrentTrack()?.title, "Radio One");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Radio Two", "Radio Three"]
  );
});

test("radio disabled does not fetch or queue automatic radio tracks", async () => {
  let radioCallCount = 0;
  const { controller } = createController({
    radioModeEnabled: false,
    getRadioTracks: async () => {
      radioCallCount += 1;
      return [
        {
          provider: "youtube",
          url: "https://youtu.be/radio-one",
          title: "Radio One",
          key: "youtube:radio-one",
          artworkUrl: ""
        }
      ];
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/final-request",
    title: "Final Request",
    key: "youtube:final-request",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(radioCallCount, 0);
  assert.equal(controller.getPublicState().radioQueue.length, 0);
});

test("disabling radio clears existing radio queue", async () => {
  let savedState = null;
  const { controller } = createController({
    runtimeStateStore: {
      async save(state) {
        savedState = JSON.parse(JSON.stringify(state));
      }
    }
  });
  controller.radioQueue = [
    {
      id: "radio-one",
      provider: "youtube",
      url: "https://youtu.be/radio-one",
      title: "Radio One",
      key: "youtube:radio-one",
      origin: "radio",
      artworkUrl: ""
    }
  ];

  await controller.setRadioSettings({
    enabled: false,
    trackCount: 3
  });

  assert.equal(controller.getPublicState().radioQueue.length, 0);
  assert.equal(savedState.radioQueue.length, 0);
});

test("radio track count controls how many automatic picks are queued", async () => {
  const radioCalls = [];
  const { controller } = createController({
    radioTrackCount: 5,
    getRadioTracks: async ({ count }) => {
      radioCalls.push({ count });
      return Array.from({ length: 6 }, (_, index) => ({
        provider: "youtube",
        url: `https://youtu.be/radio-${index + 1}`,
        title: `Radio ${index + 1}`,
        key: `youtube:radio-${index + 1}`,
        artworkUrl: "",
        sourceName: "Radio Artist"
      }));
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/final-request",
    title: "Final Request",
    key: "youtube:final-request",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(radioCalls[0].count, 5);
  assert.equal(controller.getCurrentTrack()?.title, "Radio 1");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Radio 2", "Radio 3", "Radio 4", "Radio 5"]
  );
});

test("lowering radio track count trims existing queued radio tracks", async () => {
  let savedState = null;
  const { controller } = createController({
    radioTrackCount: 5,
    runtimeStateStore: {
      async save(state) {
        savedState = JSON.parse(JSON.stringify(state));
      }
    }
  });
  controller.radioQueue = Array.from({ length: 5 }, (_, index) => ({
    id: `radio-${index + 1}`,
    provider: "youtube",
    url: `https://youtu.be/radio-${index + 1}`,
    title: `Radio ${index + 1}`,
    key: `youtube:radio-${index + 1}`,
    origin: "radio",
    artworkUrl: ""
  }));

  await controller.setRadioSettings({
    enabled: true,
    trackCount: 2
  });

  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Radio 1", "Radio 2"]
  );
  assert.equal(savedState.radioQueue.length, 2);
});

test("radio skips alternate uploads of the seed song before queueing the next picks", async () => {
  const { controller } = createController({
    getRadioTracks: async () => [
      {
        provider: "youtube",
        url: "https://youtu.be/another-time-live",
        title: "Cat Clyde - Another Time (Live Video)",
        key: "youtube:another-time-live",
        artworkUrl: "",
        sourceName: "Cat Clyde"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/goodnight-lovers",
        title: "Cat Clyde - Goodnight Lovers",
        key: "youtube:goodnight-lovers",
        artworkUrl: "",
        sourceName: "Cat Clyde"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/another-time-session",
        title: "Cat Clyde - 'Another Time' live session #newsong #indiefolk",
        key: "youtube:another-time-session",
        artworkUrl: "",
        sourceName: "Cat Clyde"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/find-you-out",
        title: "Cat Clyde - Find You Out",
        key: "youtube:find-you-out",
        artworkUrl: "",
        sourceName: "Cat Clyde"
      }
    ]
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/another-time-seed",
    title: "Cat Clyde - Another Time (Official Audio)",
    key: "youtube:another-time-seed",
    artworkUrl: "",
    sourceName: "Cat Clyde",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Cat Clyde - Goodnight Lovers");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Cat Clyde - Find You Out"]
  );
});

test("radio skips repeated song titles even when they come from different artists or channels", async () => {
  const { controller } = createController({
    getRadioTracks: async () => [
      {
        provider: "youtube",
        url: "https://youtu.be/gentle-remastered",
        title: "Glen Campbell - Topic - Gentle On My Mind (Remastered 2001)",
        key: "youtube:gentle-remastered",
        artworkUrl: "",
        sourceName: "Glen Campbell - Topic"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/rhinestone",
        title: "Glen Campbell - Topic - Rhinestone Cowboy",
        key: "youtube:rhinestone",
        artworkUrl: "",
        sourceName: "Glen Campbell - Topic"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/gentle-live",
        title: "BringBackMyYesterday - Glen Campbell Sings \"Gentle On My Mind\" (Original Live)",
        key: "youtube:gentle-live",
        artworkUrl: "",
        sourceName: "BringBackMyYesterday"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/wichita",
        title: "Glen Campbell - Topic - Wichita Lineman",
        key: "youtube:wichita",
        artworkUrl: "",
        sourceName: "Glen Campbell - Topic"
      }
    ]
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/gentle-seed",
    title: "Bobbie Gentry - Topic - Gentle On My Mind",
    key: "youtube:gentle-seed",
    artworkUrl: "",
    sourceName: "Bobbie Gentry - Topic",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Glen Campbell - Topic - Rhinestone Cowboy");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Glen Campbell - Topic - Wichita Lineman"]
  );
});

test("radio skips renamed uploads of the same song when only version text changes", async () => {
  const { controller } = createController({
    getRadioTracks: async () => [
      {
        provider: "youtube",
        url: "https://youtu.be/hotel-live",
        title: "Eagles - Hotel California (Live on MTV, 1994)",
        key: "youtube:hotel-live",
        artworkUrl: "",
        sourceName: "Eagles"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/new-kid",
        title: "Eagles - New Kid In Town",
        key: "youtube:new-kid",
        artworkUrl: "",
        sourceName: "Eagles"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/hotel-rhino",
        title: "RHINO - Hotel California [Official Music Video]",
        key: "youtube:hotel-rhino",
        artworkUrl: "",
        sourceName: "RHINO"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/one-of-these-nights",
        title: "Eagles - One of These Nights",
        key: "youtube:one-of-these-nights",
        artworkUrl: "",
        sourceName: "Eagles"
      }
    ]
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/hotel-seed",
    title: "Eagles - Hotel California",
    key: "youtube:hotel-seed",
    artworkUrl: "",
    sourceName: "Eagles",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Eagles - New Kid In Town");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Eagles - One of These Nights"]
  );
});

test("radio skips fuzzy title duplicates when descriptor words differ without brackets", async () => {
  const { controller } = createController({
    getRadioTracks: async () => [
      {
        provider: "youtube",
        url: "https://youtu.be/comfortably-remastered",
        title: "Pink Floyd - Comfortably Numb Remastered 2011",
        key: "youtube:comfortably-remastered",
        artworkUrl: "",
        sourceName: "Pink Floyd"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/wish-you",
        title: "Pink Floyd - Wish You Were Here",
        key: "youtube:wish-you",
        artworkUrl: "",
        sourceName: "Pink Floyd"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/comfortably-live",
        title: "Pink Floyd - Comfortably Numb Live Pulse Concert",
        key: "youtube:comfortably-live",
        artworkUrl: "",
        sourceName: "Pink Floyd"
      },
      {
        provider: "youtube",
        url: "https://youtu.be/another-brick",
        title: "Pink Floyd - Another Brick In The Wall",
        key: "youtube:another-brick",
        artworkUrl: "",
        sourceName: "Pink Floyd"
      }
    ]
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/comfortably-seed",
    title: "Pink Floyd - Comfortably Numb",
    key: "youtube:comfortably-seed",
    artworkUrl: "",
    sourceName: "Pink Floyd",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Pink Floyd - Wish You Were Here");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Pink Floyd - Another Brick In The Wall"]
  );
});

test("radio skips tracks longer than ten minutes before queueing picks", async () => {
  const { controller } = createController({
    getRadioTracks: async () => [
      {
        provider: "youtube",
        url: "https://youtu.be/long-mix",
        title: "Artist - Long Mix",
        key: "youtube:long-mix",
        artworkUrl: "",
        sourceName: "Artist",
        durationSeconds: 721
      },
      {
        provider: "youtube",
        url: "https://youtu.be/radio-one",
        title: "Artist - Radio One",
        key: "youtube:radio-one",
        artworkUrl: "",
        sourceName: "Artist",
        durationSeconds: 240
      },
      {
        provider: "youtube",
        url: "https://youtu.be/radio-two",
        title: "Artist - Radio Two",
        key: "youtube:radio-two",
        artworkUrl: "",
        sourceName: "Artist",
        durationSeconds: 300
      }
    ]
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/seed-track",
    title: "Artist - Seed Track",
    key: "youtube:seed-track",
    artworkUrl: "",
    sourceName: "Artist",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Artist - Radio One");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Artist - Radio Two"]
  );
});

test("new queued requests take priority over leftover radio tracks and refresh the radio seed", async () => {
  const { controller } = createController({
    getRadioTracks: async ({ seedTrack }) => {
      if (seedTrack.title === "First Seed") {
        return [
          {
            provider: "youtube",
            url: "https://youtu.be/first-radio-one",
            title: "First Radio One",
            key: "youtube:first-radio-one",
            artworkUrl: ""
          },
          {
            provider: "youtube",
            url: "https://youtu.be/first-radio-two",
            title: "First Radio Two",
            key: "youtube:first-radio-two",
            artworkUrl: ""
          },
          {
            provider: "youtube",
            url: "https://youtu.be/first-radio-three",
            title: "First Radio Three",
            key: "youtube:first-radio-three",
            artworkUrl: ""
          }
        ];
      }

      return [
        {
          provider: "youtube",
          url: "https://youtu.be/second-radio-one",
          title: "Second Radio One",
          key: "youtube:second-radio-one",
          artworkUrl: ""
        },
        {
          provider: "youtube",
          url: "https://youtu.be/second-radio-two",
          title: "Second Radio Two",
          key: "youtube:second-radio-two",
          artworkUrl: ""
        },
        {
          provider: "youtube",
          url: "https://youtu.be/second-radio-three",
          title: "Second Radio Three",
          key: "youtube:second-radio-three",
          artworkUrl: ""
        }
      ];
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/first-seed",
    title: "First Seed",
    key: "youtube:first-seed",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "First Radio One");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["First Radio Two", "First Radio Three"]
  );

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/second-seed",
    title: "Second Seed",
    key: "youtube:second-seed",
    artworkUrl: "",
    requestedBy: {
      username: "viewertwo",
      displayName: "ViewerTwo"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Second Seed");

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.origin, "radio");
  assert.equal(controller.getCurrentTrack()?.title, "Second Radio One");
  assert.deepEqual(
    controller.getPublicState().radioQueue.map((track) => track.title),
    ["Second Radio Two", "Second Radio Three"]
  );
});

test("radio tracks are auto-saved only when they finish naturally", async () => {
  const savedTracks = [];
  const { controller } = createController({
    playlistRepositoryOverrides: {
      async appendTrack(track) {
        savedTracks.push(track.title);
        return true;
      }
    },
    getRadioTracks: async () => [
      {
        provider: "youtube",
        url: "https://youtu.be/radio-finish",
        title: "Radio Finish",
        key: "youtube:radio-finish",
        artworkUrl: ""
      },
      {
        provider: "youtube",
        url: "https://youtu.be/radio-skip",
        title: "Radio Skip",
        key: "youtube:radio-skip",
        artworkUrl: ""
      },
      {
        provider: "youtube",
        url: "https://youtu.be/radio-three",
        title: "Radio Three",
        key: "youtube:radio-three",
        artworkUrl: ""
      }
    ]
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/seed-track",
    title: "Seed Track",
    key: "youtube:seed-track",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.equal(controller.getCurrentTrack()?.title, "Radio Finish");

  await controller.handlePlayerEvent({
    trackId: controller.getCurrentTrack()?.id,
    status: "ended"
  });

  assert.deepEqual(savedTracks, ["Seed Track", "Radio Finish"]);
  assert.equal(controller.getCurrentTrack()?.title, "Radio Skip");

  await controller.skipToNextTrack("dashboard");

  assert.deepEqual(savedTracks, ["Seed Track", "Radio Finish"]);
});

test("controller persists queue, stopped track, and history to the runtime state store", async () => {
  let savedState = null;
  const runtimeStateStore = {
    async load() {
      return {
        queue: [],
        radioQueue: [],
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
  controller.radioQueue = [
    {
      id: "radio-track-1",
      provider: "youtube",
      url: "https://youtu.be/radio-track-1",
      title: "Radio Track 1",
      key: "youtube:radio-track-1",
      origin: "radio",
      artworkUrl: ""
    }
  ];
  await controller.stopPlayback("dashboard");

  assert.equal(savedState.queue.length, 1);
  assert.equal(savedState.radioQueue.length, 1);
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
        radioQueue: [
          {
            id: "radio-one",
            provider: "youtube",
            url: "https://youtu.be/radio-one",
            title: "Radio One",
            key: "youtube:radio-one",
            origin: "radio",
            artworkUrl: ""
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
        ],
        adminEvents: [
          {
            action: "queue_clear",
            triggeredBy: "dashboard",
            track: null,
            details: {
              clearedCount: 2
            },
            createdAt: "2026-03-17T12:05:00.000Z"
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
  assert.equal(state.radioQueue.length, 1);
  assert.equal(state.radioQueue[0].title, "Radio One");
  assert.equal(state.stoppedTrack?.title, "Stopped One");
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].track?.title, "History One");
  assert.equal(state.history[0].status, "skipped");
  assert.equal(state.adminEvents.length, 1);
  assert.equal(state.adminEvents[0].action, "queue_clear");
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

test("admin activity events are recorded and persisted with runtime state", async () => {
  let savedState = null;
  const runtimeStateStore = {
    async load() {
      return {
        queue: [],
        stoppedTrack: null,
        history: [],
        adminEvents: []
      };
    },
    async save(state) {
      savedState = JSON.parse(JSON.stringify(state));
    }
  };

  const { controller } = createController({ runtimeStateStore });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/admin-track",
    title: "Admin Track",
    key: "youtube:admin-track",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  });

  await controller.stopPlayback("dashboard");
  await controller.clearQueue("dashboard");

  assert.equal(controller.getPublicState().adminEvents.length >= 2, true);
  assert.equal(controller.getPublicState().adminEvents[0].action, "queue_clear");
  assert.equal(savedState.adminEvents[0].action, "queue_clear");
  assert.equal(savedState.adminEvents[1].action, "stop_playback");
});

test("request audit logs accepted, duplicate, and rejected requests with requester totals", async () => {
  let savedAuditState = null;
  const requestAuditStore = {
    async load() {
      return {
        events: [],
        requesterStats: {}
      };
    },
    async save(state) {
      savedAuditState = JSON.parse(JSON.stringify(state));
    }
  };

  const { controller } = createController({
    requestAuditStore,
    requestPolicy: {
      requestsEnabled: true,
      maxRequestsPerUser: 1
    }
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/audit-one",
    title: "Audit One",
    key: "youtube:audit-one",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  }, {
    requestSource: "twitch_chat",
    requestInput: "!sr audit one"
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/audit-one",
    title: "Audit One",
    key: "youtube:audit-one",
    artworkUrl: "",
    requestedBy: {
      username: "viewerone",
      displayName: "ViewerOne"
    }
  }, {
    requestSource: "twitch_chat",
    requestInput: "!sr audit one"
  });

  await assert.rejects(
    controller.addRequest({
      provider: "youtube",
      url: "https://youtu.be/audit-two",
      title: "Audit Two",
      key: "youtube:audit-two",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      }
    }, {
      requestSource: "twitch_chat",
      requestInput: "!sr audit two"
    }),
    /too many active song requests/i
  );

  const requestAudit = controller.getRequestAuditState();
  assert.equal(requestAudit.events.length, 3);
  assert.equal(requestAudit.events[0].outcome, "rejected");
  assert.equal(requestAudit.events[0].reason, "too_many_active_requests");
  assert.equal(requestAudit.events[1].outcome, "duplicate");
  assert.equal(requestAudit.events[1].reason, "duplicate_playing");
  assert.equal(requestAudit.events[2].outcome, "accepted");
  assert.equal(requestAudit.events[2].track?.title, "Audit One");
  assert.equal(requestAudit.requesterStats.length, 1);
  assert.equal(requestAudit.requesterStats[0].requester.username, "viewerone");
  assert.equal(requestAudit.requesterStats[0].totalRequests, 3);
  assert.equal(requestAudit.requesterStats[0].acceptedRequests, 1);
  assert.equal(requestAudit.requesterStats[0].duplicateRequests, 1);
  assert.equal(requestAudit.requesterStats[0].rejectedRequests, 1);
  assert.equal(savedAuditState.events.length, 3);
  assert.equal(savedAuditState.requesterStats.viewerone.totalRequests, 3);
});

test("request audit restores persisted request events and requester totals", async () => {
  const requestAuditStore = {
    async load() {
      return {
        events: [
          {
            id: "audit-1",
            createdAt: "2026-03-19T10:00:00.000Z",
            source: "twitch_chat",
            outcome: "accepted",
            reason: "queued",
            message: "",
            input: "!sr restored",
            bypassRequestLimits: false,
            requester: {
              username: "viewerone",
              displayName: "ViewerOne"
            },
            track: {
              id: "track-1",
              provider: "youtube",
              url: "https://youtu.be/restored",
              title: "Restored Track",
              key: "youtube:restored",
              origin: "queue",
              artworkUrl: ""
            },
            queueState: {
              playbackStatus: "playing",
              queueLength: 0,
              currentTrackId: "track-1",
              stoppedTrackId: ""
            },
            requesterStats: {
              requester: {
                username: "viewerone",
                displayName: "ViewerOne"
              },
              totalRequests: 1,
              acceptedRequests: 1,
              duplicateRequests: 0,
              rejectedRequests: 0,
              youtubeRequests: 1,
              soundcloudRequests: 0,
              lastRequestedAt: "2026-03-19T10:00:00.000Z",
              lastAcceptedAt: "2026-03-19T10:00:00.000Z",
              lastOutcome: "accepted",
              lastSource: "twitch_chat",
              lastInput: "!sr restored",
              lastTrackKey: "youtube:restored",
              lastTrackTitle: "Restored Track"
            },
            details: {
              channel: "testchannel"
            }
          }
        ],
        requesterStats: {
          viewerone: {
            requester: {
              username: "viewerone",
              displayName: "ViewerOne"
            },
            totalRequests: 1,
            acceptedRequests: 1,
            duplicateRequests: 0,
            rejectedRequests: 0,
            youtubeRequests: 1,
            soundcloudRequests: 0,
            lastRequestedAt: "2026-03-19T10:00:00.000Z",
            lastAcceptedAt: "2026-03-19T10:00:00.000Z",
            lastOutcome: "accepted",
            lastSource: "twitch_chat",
            lastInput: "!sr restored",
            lastTrackKey: "youtube:restored",
            lastTrackTitle: "Restored Track"
          }
        }
      };
    },
    async save() {
    }
  };

  const { controller } = createController({ requestAuditStore });
  await controller.restoreRuntimeState();

  const requestAudit = controller.getRequestAuditState();
  assert.equal(requestAudit.events.length, 1);
  assert.equal(requestAudit.events[0].track?.title, "Restored Track");
  assert.equal(requestAudit.requesterStats.length, 1);
  assert.equal(requestAudit.requesterStats[0].requester.displayName, "ViewerOne");
  assert.equal(requestAudit.requesterStats[0].acceptedRequests, 1);
});

test("online player load is held when the AutoDJ takeover is not acknowledged", async () => {
  const timers = [];
  const { controller, emittedEvents } = createController({
    routeOwnedRequest: async () => ({ matched: false }),
    beforeTrackStart: async () => ({ ready: false, error: "AutoDJ unavailable" }),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  await controller.addRequest({
    provider: "youtube",
    url: "https://youtu.be/held",
    title: "Held Request",
    key: "youtube:held",
    requestedBy: { username: "viewer", displayName: "Viewer" }
  });

  assert.equal(emittedEvents.some(({ event }) => event === "player:load"), false);
  assert.equal(controller.getPublicState().queue.length, 1);
  assert.equal(controller.getPublicState().currentTrack, null);
  assert.equal(timers[0].delay, 5_000);
});

test("a final owned-request check can move a newly indexed track to AutoDJ before playback", async () => {
  let checks = 0;
  let takeoverCalls = 0;
  const { controller, emittedEvents } = createController({
    routeOwnedRequest: async () => ({
      matched: ++checks === 2,
      queued: checks === 2,
      track: checks === 2 ? { provider: "local", title: "Owned" } : null
    }),
    beforeTrackStart: async () => {
      takeoverCalls += 1;
      return { ready: true };
    },
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn() {}
  });

  const result = await controller.addRequest({
    provider: "suno",
    url: "https://suno.com/song/owned-late",
    audioUrl: "https://cdn1.suno.ai/owned-late.mp3",
    title: "Owned Late",
    key: "suno:owned-late",
    requestedBy: { username: "viewer", displayName: "Viewer" }
  });

  assert.equal(result.alreadyQueued, false);
  assert.equal(checks, 2);
  assert.equal(takeoverCalls, 0);
  assert.equal(controller.getPublicState().queue.length, 0);
  assert.equal(emittedEvents.some(({ event }) => event === "player:load"), false);
});

test("queued ownership rechecks apply a late match only while the request remains queued", async () => {
  const timers = [];
  let checks = 0;
  const { controller } = createController({
    routeOwnedRequest: async () => ({
      matched: ++checks > 1,
      queued: checks > 1,
      track: checks > 1 ? { provider: "local", title: "Indexed Later" } : null
    }),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });
  controller.currentTrack = {
    id: "playing",
    provider: "youtube",
    url: "https://youtu.be/playing",
    title: "Playing",
    key: "youtube:playing",
    origin: "queue"
  };

  await controller.addRequest({
    provider: "soundcloud",
    url: "https://soundcloud.com/example/indexed-later",
    title: "Indexed Later",
    key: "soundcloud:indexed-later",
    requestedBy: { username: "viewer", displayName: "Viewer" }
  });
  assert.equal(controller.getPublicState().queue.length, 1);
  assert.equal(timers[0].delay, 5_000);

  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.getPublicState().queue.length, 0);
  assert.equal(checks, 2);
});
