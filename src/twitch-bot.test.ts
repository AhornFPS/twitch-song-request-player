// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultChatCommands } from "./chat-commands.js";
import { TwitchBot } from "./twitch-bot.js";

function createBotHarness({
  currentTrack,
  suppressChatMessages = false,
  addRequestResult = null,
  addRequestImpl = null,
  resolvedTrack = null,
  resolvedPlaylist = null,
  appendTracksToPlaylistResult = {
    addedCount: 0,
    duplicateCount: 0,
    finalCount: 0,
    tracks: []
  },
  appendTracksToPlaylistImpl = null,
  chatCommands = getDefaultChatCommands(),
  requestPolicy = {
    requestsEnabled: true
  },
  queueSummary = [],
  queuePosition = null,
  removeOwnRequestResult = null,
  clearQueueResult = {
    clearedCount: 0
  },
  updateSettings = async () => ({ requestPolicy })
}) {
  let playbackListener = null;
  const sentMessages = [];
  const requestAuditEvents = [];
  const playerController = {
    onTrackPlayback(listener) {
      playbackListener = listener;
      return () => {
        playbackListener = null;
      };
    },
    async addRequest(track, options) {
      if (typeof addRequestImpl === "function") {
        return addRequestImpl(track, options);
      }

      return addRequestResult;
    },
    async appendTracksToPlaylist(tracks, options) {
      if (typeof appendTracksToPlaylistImpl === "function") {
        return appendTracksToPlaylistImpl(tracks, options);
      }

      return appendTracksToPlaylistResult;
    },
    getCurrentTrack() {
      return currentTrack;
    },
    getQueueSummary() {
      return queueSummary;
    },
    getQueuePositionForRequester() {
      return queuePosition;
    },
    async removeQueuedTrackByRequester() {
      return removeOwnRequestResult;
    },
    async clearQueue() {
      return clearQueueResult;
    },
    async recordRequestOutcome(event) {
      requestAuditEvents.push(event);
    },
    recordAdminEvent() {
    }
  };
  const client = {
    async say(channel, message) {
      sentMessages.push({ channel, message });
    }
  };
  const channelInfo = {
    logConfigurationState() {
    },
    async shouldSuppressChatMessages() {
      return suppressChatMessages;
    }
  };

  const bot = new TwitchBot({
    config: {
      twitch: {
        channel: "testchannel",
        username: "botuser",
        oauthToken: "oauth:test",
        clientId: "",
        clientSecret: ""
      },
      chatCommands,
      requestPolicy
    },
    playerController,
    client,
    channelInfo,
    songRequestResolver: async () => resolvedTrack,
    youtubePlaylistResolver: async () => resolvedPlaylist,
    updateSettings
  });

  return {
    bot,
    sentMessages,
    requestAuditEvents,
    async emitPlayback() {
      await playbackListener?.(currentTrack);
    }
  };
}

test("youtube playlist import command adds the full playlist to the fallback playlist instead of the queue", async () => {
  const appendedTracks = [];
  const harness = createBotHarness({
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for playlist imports");
    },
    resolvedPlaylist: {
      playlistId: "PL123",
      title: "Viewer Favorites",
      trackCount: 2,
      tracks: [
        {
          provider: "youtube",
          url: "https://www.youtube.com/watch?v=track-one",
          title: "Artist One - Track One",
          key: "youtube:track-one"
        },
        {
          provider: "youtube",
          url: "https://www.youtube.com/watch?v=track-two",
          title: "Artist Two - Track Two",
          key: "youtube:track-two"
        }
      ]
    },
    appendTracksToPlaylistImpl: async (tracks) => {
      appendedTracks.push(...tracks);
      return {
        addedCount: tracks.length,
        duplicateCount: 0,
        finalCount: tracks.length,
        tracks
      };
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "modone",
    "display-name": "ModOne",
    mod: true,
    badges: {
      moderator: "1"
    }
  }, "!addplaylist https://www.youtube.com/playlist?list=PL123");

  assert.equal(appendedTracks.length, 2);
  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Imported 2 tracks from Viewer Favorites into the playlist."
    }
  ]);
});

test("automatic playback announcement uses the currentsong format for playlist tracks", async () => {
  const harness = createBotHarness({
    currentTrack: {
      id: "track-1",
      provider: "youtube",
      url: "https://youtu.be/example",
      title: "Playlist Track",
      origin: "playlist",
      isSaved: true
    }
  });

  await harness.emitPlayback();

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Current song: Playlist Track https://youtu.be/example"
    }
  ]);
  assert.equal(
    harness.bot.formatCurrentSongMessage({
      title: "Queued Track",
      url: "https://soundcloud.com/example/track",
      requestedBy: {
        displayName: "ViewerOne",
        username: "viewerone"
      },
      isSaved: false
    }),
    "Current song: Queued Track https://soundcloud.com/example/track, requested by ViewerOne"
  );
});

test("duplicate song requests send the queue warning to Twitch chat", async () => {
  const harness = createBotHarness({
    currentTrack: null,
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/duplicate",
      title: "Duplicate Track",
      key: "youtube:duplicate",
      artworkUrl: ""
    },
    addRequestResult: {
      id: "track-1",
      provider: "youtube",
      url: "https://youtu.be/duplicate",
      title: "Duplicate Track",
      key: "youtube:duplicate",
      origin: "queue",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      },
      isSaved: false,
      alreadyQueued: true,
      duplicateType: "queue"
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!sr duplicate");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Song Duplicate Track already in the queue"
    }
  ]);
});

test("recent-history duplicate song requests send the played recently warning", async () => {
  const harness = createBotHarness({
    currentTrack: null,
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/recent-duplicate",
      title: "Recent Duplicate Track",
      key: "youtube:recent-duplicate",
      artworkUrl: ""
    },
    addRequestResult: {
      id: "track-1",
      provider: "youtube",
      url: "https://youtu.be/recent-duplicate",
      title: "Recent Duplicate Track",
      key: "youtube:recent-duplicate",
      origin: "queue",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      },
      isSaved: false,
      alreadyQueued: false,
      duplicateType: "history"
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!sr recent duplicate");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Song Recent Duplicate Track was played recently"
    }
  ]);
});

test("renamed chat commands are honored", async () => {
  const chatCommands = getDefaultChatCommands();
  chatCommands.song_request.trigger = "!song";
  chatCommands.current_song.trigger = "!np";

  const harness = createBotHarness({
    currentTrack: {
      id: "track-1",
      provider: "youtube",
      url: "https://youtu.be/example",
      title: "Playlist Track",
      origin: "playlist",
      isSaved: true
    },
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/custom",
      title: "Custom Trigger Track",
      key: "youtube:custom",
      artworkUrl: ""
    },
    addRequestResult: {
      id: "track-2",
      provider: "youtube",
      url: "https://youtu.be/custom",
      title: "Custom Trigger Track",
      key: "youtube:custom",
      origin: "queue",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      },
      isSaved: false,
      alreadyQueued: false,
      duplicateType: null
    },
    chatCommands
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!song custom");
  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!np");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Queued: Custom Trigger Track (requested by ViewerOne)"
    },
    {
      channel: "#testchannel",
      message: "Current song: Playlist Track https://youtu.be/example"
    }
  ]);
});

test("closed requests block viewer song requests but moderators can reopen them", async () => {
  const updatedPolicies = [];
  const harness = createBotHarness({
    currentTrack: null,
    requestPolicy: {
      requestsEnabled: false
    },
    updateSettings: async (patch) => {
      updatedPolicies.push(patch);
      return {
        requestPolicy: patch.requestPolicy
      };
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr custom");

  await harness.bot.handleCommand("#testchannel", {
    username: "modone",
    "display-name": "ModOne",
    mod: true,
    badges: {
      moderator: "1"
    }
  }, "!sropen");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Song requests are currently closed."
    },
    {
      channel: "#testchannel",
      message: "Song requests are now open."
    }
  ]);
  assert.equal(updatedPolicies.length, 1);
  assert.equal(updatedPolicies[0].requestPolicy.requestsEnabled, true);
});

test("request access level and blocked users are enforced before a chat request resolves", async () => {
  const subscriberHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      accessLevel: "subscriber",
      blockedUsers: []
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked access");
    }
  });

  await subscriberHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr song", false);

  assert.deepEqual(subscriberHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Song requests are currently limited to subscribers, VIPs, moderators, and the broadcaster."
    }
  ]);
  assert.equal(subscriberHarness.requestAuditEvents.length, 1);
  assert.equal(subscriberHarness.requestAuditEvents[0].reason, "access_level_blocked");

  const blockedUserHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      accessLevel: "everyone",
      blockedUsers: ["viewerone"]
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked users");
    }
  });

  await blockedUserHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {
      subscriber: "1"
    },
    subscriber: true
  }, "!sr song", false);

  assert.deepEqual(blockedUserHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "You are not allowed to send song requests in this channel."
    }
  ]);
  assert.equal(blockedUserHarness.requestAuditEvents.length, 1);
  assert.equal(blockedUserHarness.requestAuditEvents[0].reason, "blocked_user");
});

test("viewer request limits surface a chat error while moderator requests can bypass limits", async () => {
  const addRequestCalls = [];
  const harness = createBotHarness({
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/limit-test",
      title: "Limit Test",
      key: "youtube:limit-test",
      artworkUrl: ""
    },
    addRequestImpl: async (_track, options) => {
      addRequestCalls.push(options);
      if (!options?.bypassRequestLimits) {
        throw new Error("You already have too many active song requests.");
      }

      return {
        id: "track-1",
        provider: "youtube",
        url: "https://youtu.be/limit-test",
        title: "Limit Test",
        key: "youtube:limit-test",
        origin: "queue",
        artworkUrl: "",
        requestedBy: {
          username: "modone",
          displayName: "ModOne"
        },
        isSaved: false,
        alreadyQueued: false,
        duplicateType: null
      };
    }
  });

  await harness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr limit test", false);

  await harness.bot.handleIncomingMessage("#testchannel", {
    username: "modone",
    "display-name": "ModOne",
    mod: true,
    badges: {
      moderator: "1"
    }
  }, "!sr limit test", false);

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Error: You already have too many active song requests."
    },
    {
      channel: "#testchannel",
      message: "Queued: Limit Test (requested by ModOne)"
    }
  ]);
  assert.equal(addRequestCalls[0].bypassRequestLimits, false);
  assert.equal(addRequestCalls[1].bypassRequestLimits, true);
});

test("blocked phrases and provider restrictions reject chat requests with clear errors", async () => {
  const blockedPhraseHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      blockedPhrases: ["banned artist"]
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked phrases");
    }
  });

  await blockedPhraseHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr banned artist song", false);

  assert.deepEqual(blockedPhraseHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "That request matches a blocked phrase and could not be queued."
    }
  ]);

  const providerHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      allowedProviders: ["youtube"]
    },
    resolvedTrack: {
      provider: "soundcloud",
      url: "https://soundcloud.com/example/track",
      title: "SoundCloud Only",
      key: "soundcloud:https://soundcloud.com/example/track",
      artworkUrl: ""
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked providers");
    }
  });

  await providerHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr direct track", false);

  assert.deepEqual(providerHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "soundcloud requests are currently disabled."
    }
  ]);

  const spotifyHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      allowedProviders: ["soundcloud"]
    },
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/spotify-match",
      title: "Spotify Match",
      key: "youtube:spotify-match",
      artworkUrl: "",
      requestedFromProvider: "spotify",
      requestedFromUrl: "https://open.spotify.com/track/spotify123",
      requestedFromTitle: "Spotify Match",
      requestedFromName: "Example Artist"
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked resolved playback providers");
    }
  });

  await spotifyHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr spotify track", false);

  assert.deepEqual(spotifyHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "spotify requests are currently disabled."
    }
  ]);
});

test("duration, live-stream, and blocked-source safety rules reject chat requests before queueing", async () => {
  const durationHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      maxTrackDurationSeconds: 300
    },
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/too-long",
      title: "Too Long",
      key: "youtube:too-long",
      artworkUrl: "",
      durationSeconds: 540
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for tracks over the duration limit");
    }
  });

  await durationHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr too long", false);

  assert.deepEqual(durationHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "That track is too long for requests. The limit is 300 seconds."
    }
  ]);

  const liveHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      rejectLiveStreams: true
    },
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/live-one",
      title: "Live One",
      key: "youtube:live-one",
      artworkUrl: "",
      isLive: true
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked live streams");
    }
  });

  await liveHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr live one", false);

  assert.deepEqual(liveHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Live streams are blocked from song requests right now."
    }
  ]);

  const blockedDomainHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      blockedDomains: ["youtube.com"]
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked direct-link domains");
    }
  });

  await blockedDomainHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr https://www.youtube.com/watch?v=blocked-domain", false);

  assert.deepEqual(blockedDomainHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Direct links from that domain are blocked."
    }
  ]);

  const youtubeSourceHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      blockedYouTubeChannelIds: ["@blockedhandle"]
    },
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/source-blocked",
      title: "Source Blocked",
      key: "youtube:source-blocked",
      artworkUrl: "",
      sourceChannelId: "UCBlocked",
      sourceName: "Blocked Handle",
      sourceUrl: "https://www.youtube.com/@BlockedHandle"
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked YouTube channels");
    }
  });

  await youtubeSourceHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr source blocked", false);

  assert.deepEqual(youtubeSourceHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Requests from that YouTube channel are blocked."
    }
  ]);

  const soundCloudSourceHarness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      blockedSoundCloudUsers: ["artistslug"]
    },
    resolvedTrack: {
      provider: "soundcloud",
      url: "https://soundcloud.com/artistslug/blocked-track",
      title: "Blocked SoundCloud",
      key: "soundcloud:https://soundcloud.com/artistslug/blocked-track",
      artworkUrl: "",
      sourceName: "ArtistSlug",
      sourceUrl: "https://soundcloud.com/artistslug"
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not run for blocked SoundCloud accounts");
    }
  });

  await soundCloudSourceHarness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr blocked soundcloud", false);

  assert.deepEqual(soundCloudSourceHarness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Requests from that SoundCloud account are blocked."
    }
  ]);
});

test("queue commands report summary, position, and remove the viewer request", async () => {
  const harness = createBotHarness({
    currentTrack: {
      id: "track-1",
      provider: "youtube",
      url: "https://youtu.be/now-playing",
      title: "Now Playing",
      origin: "queue",
      isSaved: false
    },
    queueSummary: [
      {
        id: "track-2",
        provider: "youtube",
        url: "https://youtu.be/up-next",
        title: "Up Next",
        key: "youtube:up-next",
        origin: "queue",
        requestedBy: {
          username: "viewerone",
          displayName: "ViewerOne"
        }
      },
      {
        id: "track-3",
        provider: "youtube",
        url: "https://youtu.be/after-that",
        title: "After That",
        key: "youtube:after-that",
        origin: "queue",
        requestedBy: {
          username: "viewertwo",
          displayName: "ViewerTwo"
        }
      }
    ],
    queuePosition: {
      position: 2,
      track: {
        id: "track-3",
        provider: "youtube",
        url: "https://youtu.be/after-that",
        title: "After That",
        key: "youtube:after-that",
        origin: "queue",
        requestedBy: {
          username: "viewerone",
          displayName: "ViewerOne"
        }
      }
    },
    removeOwnRequestResult: {
      id: "track-3",
      provider: "youtube",
      url: "https://youtu.be/after-that",
      title: "After That",
      key: "youtube:after-that",
      origin: "queue",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      }
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!queue");
  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!position");
  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!unrequest");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Now playing: Now Playing. Up next: 1. Up Next | 2. After That"
    },
    {
      channel: "#testchannel",
      message: "After That is #2 in the queue."
    },
    {
      channel: "#testchannel",
      message: "Removed your queued request: After That"
    }
  ]);
});

test("clear queue command clears every queued request for moderators", async () => {
  const harness = createBotHarness({
    clearQueueResult: {
      clearedCount: 4
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "modone",
    "display-name": "ModOne",
    mod: true,
    badges: {
      moderator: "1"
    }
  }, "!clearqueue");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Cleared 4 queued requests."
    }
  ]);
});

test("disabled search requests return a direct-link guidance error", async () => {
  const harness = createBotHarness({
    requestPolicy: {
      requestsEnabled: true,
      allowSearchRequests: false,
      youtubeSafeSearch: "strict"
    },
    addRequestImpl: async () => {
      throw new Error("addRequest should not be called when search is disabled");
    },
    resolvedTrack: null
  });

  harness.bot.songRequestResolver = async () => {
    throw new Error("Search-based song requests are disabled. Request a direct YouTube, SoundCloud, Spotify, or Suno link instead.");
  };

  await harness.bot.handleIncomingMessage("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne",
    badges: {}
  }, "!sr artist song", false);

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Error: Search-based song requests are disabled. Request a direct YouTube, SoundCloud, Spotify, or Suno link instead."
    }
  ]);
});

test("duplicate requests for the current song send the already playing warning", async () => {
  const harness = createBotHarness({
    currentTrack: null,
    resolvedTrack: {
      provider: "youtube",
      url: "https://youtu.be/current-duplicate",
      title: "Current Duplicate Track",
      key: "youtube:current-duplicate",
      artworkUrl: ""
    },
    addRequestResult: {
      id: "track-1",
      provider: "youtube",
      url: "https://youtu.be/current-duplicate",
      title: "Current Duplicate Track",
      key: "youtube:current-duplicate",
      origin: "queue",
      artworkUrl: "",
      requestedBy: {
        username: "viewerone",
        displayName: "ViewerOne"
      },
      isSaved: false,
      alreadyQueued: false,
      duplicateType: "playing"
    }
  });

  await harness.bot.handleCommand("#testchannel", {
    username: "viewerone",
    "display-name": "ViewerOne"
  }, "!sr current duplicate");

  assert.deepEqual(harness.sentMessages, [
    {
      channel: "#testchannel",
      message: "Song Current Duplicate Track is already playing"
    }
  ]);
});
