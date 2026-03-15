import assert from "node:assert/strict";
import test from "node:test";
import { TwitchBot } from "./twitch-bot.js";

function createBotHarness({ currentTrack, suppressChatMessages = false }) {
  let playbackListener = null;
  const sentMessages = [];
  const playerController = {
    onTrackPlayback(listener) {
      playbackListener = listener;
      return () => {
        playbackListener = null;
      };
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
    channelInfo
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
      message: "Current song: Playlist Track (https://youtu.be/example) [saved]"
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
    "Current song: Queued Track (https://soundcloud.com/example/track), requested by ViewerOne [not saved]"
  );
});
