import assert from "node:assert/strict";
import test from "node:test";
import { TwitchBotService } from "./twitch-bot-service.js";

test("applySettings uses the validated Twitch login as the bot username", async () => {
  const persistedPatches = [];
  let connectedConfig = null;
  let persistedSettings = {
    twitchChannel: "streamer",
    twitchUsername: "",
    twitchOauthToken: "oauth:token-123",
    twitchRefreshToken: "refresh-123",
    twitchClientId: "client-123",
    twitchClientSecret: "",
    youtubeApiKey: ""
  };

  const service = new TwitchBotService({
    playerController: {
      onTrackPlayback() {
        return () => {};
      },
      getCurrentTrack() {
        return null;
      }
    },
    persistSettings: async (patch) => {
      persistedPatches.push(patch);
      persistedSettings = {
        ...persistedSettings,
        ...patch
      };
      return persistedSettings;
    },
    authManager: {
      async ensureValidUserToken() {
        return {
          oauthToken: "oauth:token-123",
          refreshToken: "refresh-123",
          login: "bot_account"
        };
      }
    },
    botFactory: ({ config }) => ({
      async connect() {
        connectedConfig = config;
      },
      async disconnect() {
      }
    })
  });

  const status = await service.applySettings(persistedSettings);

  assert.equal(status.state, "connected");
  assert.equal(connectedConfig.twitch.username, "bot_account");
  assert.equal(persistedSettings.twitchUsername, "bot_account");
  assert.deepEqual(persistedPatches, [
    {
      twitchOauthToken: "oauth:token-123",
      twitchRefreshToken: "refresh-123",
      twitchUsername: "bot_account"
    }
  ]);

  await service.disconnect();
});
