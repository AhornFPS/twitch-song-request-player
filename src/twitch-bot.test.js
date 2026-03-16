import assert from "node:assert/strict";
import test from "node:test";
import { TwitchBot } from "./twitch-bot.js";

function createBotHarness({
  currentTrack,
  suppressChatMessages = false,
  addRequestResult = null,
  resolvedTrack = null
}) {
  let playbackListener = null;
  const sentMessages = [];
  const playerController = {
    onTrackPlayback(listener) {
      playbackListener = listener;
      return () => {
        playbackListener = null;
      };
    },
    async addRequest() {
      return addRequestResult;
    },
    getCurrentTrack() {
      return currentTrack;
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
      }
    },
    playerController,
    client,
    channelInfo,
    songRequestResolver: async () => resolvedTrack
  });

  return {
    bot,
    sentMessages,
    async emitPlayback() {
      await playbackListener?.(currentTrack);
    }
  };
}

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
