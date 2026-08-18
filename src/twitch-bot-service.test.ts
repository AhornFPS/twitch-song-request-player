// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { TwitchBotService } from "./twitch-bot-service.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createConnectedSettings(overrides = {}) {
  return {
    twitchChannel: "streamer",
    twitchUsername: "hornbots",
    twitchOauthToken: "oauth:token-123",
    twitchRefreshToken: "refresh-123",
    twitchClientId: "client-123",
    twitchClientSecret: "",
    twitchSharedChatForSourceOnly: false,
    chatSuppressedCategories: [],
    playbackSuppressedCategories: [],
    youtubeApiKey: "",
    requestPolicy: {},
    chatCommands: {},
    ...overrides
  };
}

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
      },
      async setPlaybackSuppressed() {
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

test("disconnect clears playback suppression", async () => {
  const suppressionCalls = [];
  let botDisconnected = false;
  const service = new TwitchBotService({
    playerController: {
      async setPlaybackSuppressed(isSuppressed) {
        suppressionCalls.push(isSuppressed);
      }
    }
  });
  service.bot = {
    async disconnect() {
      botDisconnected = true;
    }
  };

  await service.disconnect({
    nextStatus: {
      state: "error",
      message: "Disconnected for test."
    }
  });

  assert.equal(botDisconnected, true);
  assert.deepEqual(suppressionCalls, [false]);
  assert.equal(service.getStatus().state, "error");
});

test("applySettings reports an expired stored login without attempting chat connection", async () => {
  let botCreated = false;
  const suppressionCalls = [];
  const service = new TwitchBotService({
    playerController: {
      async setPlaybackSuppressed(isSuppressed) {
        suppressionCalls.push(isSuppressed);
      }
    },
    authManager: {
      async ensureValidUserToken() {
        return null;
      }
    },
    botFactory() {
      botCreated = true;
      return {
        async connect() {},
        async disconnect() {}
      };
    }
  });

  const status = await service.applySettings({
    twitchChannel: "streamer",
    twitchUsername: "hornbots",
    twitchOauthToken: "oauth:expired",
    twitchRefreshToken: "revoked-refresh-token",
    twitchClientId: "client-123",
    twitchClientSecret: "",
    youtubeApiKey: ""
  });

  assert.equal(botCreated, false);
  assert.equal(status.state, "error");
  assert.match(status.message, /expired or was revoked/i);
  assert.match(service.getAuthStatus().message, /Reconnect HornBots from Settings/i);
  assert.deepEqual(suppressionCalls, [false]);
});

test("applySettings surfaces an invalid refresh response as an expired login", async () => {
  let botCreated = false;
  const service = new TwitchBotService({
    playerController: {
      async setPlaybackSuppressed() {}
    },
    authManager: {
      async ensureValidUserToken() {
        const error = new Error("Invalid refresh token");
        error.status = 400;
        throw error;
      }
    },
    botFactory() {
      botCreated = true;
      return null;
    }
  });

  const status = await service.applySettings({
    twitchChannel: "streamer",
    twitchUsername: "hornbots",
    twitchOauthToken: "oauth:expired",
    twitchRefreshToken: "revoked-refresh-token",
    twitchClientId: "client-123",
    twitchClientSecret: "",
    youtubeApiKey: ""
  });

  assert.equal(botCreated, false);
  assert.equal(status.state, "error");
  assert.match(service.getAuthStatus().message, /Reconnect HornBots from Settings/i);
});

for (const { oldSuppressed, newSuppressed } of [
  { oldSuppressed: false, newSuppressed: true },
  { oldSuppressed: true, newSuppressed: false }
]) {
  test(`a late old category policy cannot overwrite newer suppress=${newSuppressed}`, async (t) => {
    const oldPolicy = createDeferred();
    const oldPolicyEntered = createDeferred();
    const suppressionCalls = [];
    const appliedConfigs = [];
    let categoryLookupCount = 0;
    const bot = {
      channelInfo: {
        async getCategorySuppressionState() {
          categoryLookupCount += 1;
          if (categoryLookupCount === 1) {
            return { categoryName: "Baseline", suppressMusicPlayback: false };
          }
          if (categoryLookupCount === 2) {
            oldPolicyEntered.resolve();
            return oldPolicy.promise;
          }
          return {
            categoryName: "New Policy",
            suppressMusicPlayback: newSuppressed
          };
        },
        getStatus() {
          return { state: "ok", categoryName: "New Policy" };
        }
      },
      updateConfig(config) {
        appliedConfigs.push(config);
      },
      async connect() {},
      async disconnect() {}
    };
    const service = new TwitchBotService({
      playerController: {
        async setPlaybackSuppressed(isSuppressed, options = {}) {
          suppressionCalls.push({ isSuppressed, category: options.category ?? "" });
        }
      },
      authManager: {
        async ensureValidUserToken(settings) {
          return {
            oauthToken: settings.oauthToken,
            refreshToken: settings.refreshToken,
            login: "hornbots"
          };
        }
      },
      botFactory() {
        return bot;
      }
    });
    t.after(() => service.disconnect());
    const baselineSettings = createConnectedSettings();
    await service.applySettings(baselineSettings);

    const oldSettings = createConnectedSettings({
      playbackSuppressedCategories: oldSuppressed ? ["Old Policy"] : []
    });
    const oldApply = service.applySettings(oldSettings);
    await oldPolicyEntered.promise;
    const newSettings = createConnectedSettings({
      playbackSuppressedCategories: newSuppressed ? ["New Policy"] : []
    });
    await service.applySettings(newSettings);
    oldPolicy.resolve({
      categoryName: "Old Policy",
      suppressMusicPlayback: oldSuppressed
    });
    await oldApply;

    assert.equal(suppressionCalls.at(-1).isSuppressed, newSuppressed);
    assert.deepEqual(
      suppressionCalls.map((call) => call.isSuppressed),
      [false, false, newSuppressed],
      "the superseded policy must not publish after the newer policy"
    );
    assert.deepEqual(service.currentSettings.playbackSuppressedCategories, newSettings.playbackSuppressedCategories);
    assert.deepEqual(
      appliedConfigs.at(-1).twitch.playbackSuppressedCategories,
      newSettings.playbackSuppressedCategories
    );
    assert.equal(service.getStatus().state, "connected");
  });
}

for (const { oldSuppressed, newSuppressed } of [
  { oldSuppressed: false, newSuppressed: true },
  { oldSuppressed: true, newSuppressed: false }
]) {
  test(`a delayed old controller write cannot overwrite newer suppress=${newSuppressed}`, async (t) => {
    const oldControllerEntered = createDeferred();
    const releaseOldController = createDeferred();
    const controllerCalls = [];
    const committedStates = [];
    let committedSuppressed = null;
    let categoryLookupCount = 0;
    const bot = {
      channelInfo: {
        async getCategorySuppressionState() {
          categoryLookupCount += 1;
          if (categoryLookupCount === 1) {
            return { categoryName: "Baseline", suppressMusicPlayback: false };
          }
          if (categoryLookupCount === 2) {
            return {
              categoryName: "Old Controller Commit",
              suppressMusicPlayback: oldSuppressed
            };
          }
          return {
            categoryName: "New Controller Commit",
            suppressMusicPlayback: newSuppressed
          };
        },
        getStatus() {
          return { state: "ok", categoryName: "New Controller Commit" };
        }
      },
      updateConfig() {},
      async connect() {},
      async disconnect() {}
    };
    const service = new TwitchBotService({
      playerController: {
        async setPlaybackSuppressed(isSuppressed, options = {}) {
          const category = options.category ?? "";
          controllerCalls.push({ isSuppressed, category });
          if (category === "Old Controller Commit") {
            oldControllerEntered.resolve();
            await releaseOldController.promise;
          }
          committedSuppressed = isSuppressed;
          committedStates.push({ isSuppressed, category });
        }
      },
      authManager: {
        async ensureValidUserToken(settings) {
          return {
            oauthToken: settings.oauthToken,
            refreshToken: settings.refreshToken,
            login: "hornbots"
          };
        }
      },
      botFactory() {
        return bot;
      }
    });
    t.after(() => service.disconnect());
    await service.applySettings(createConnectedSettings());

    const oldApply = service.applySettings(createConnectedSettings({
      playbackSuppressedCategories: oldSuppressed ? ["Old Controller Commit"] : []
    }));
    await oldControllerEntered.promise;
    await service.applySettings(createConnectedSettings({
      playbackSuppressedCategories: newSuppressed ? ["New Controller Commit"] : []
    }));
    assert.equal(committedSuppressed, newSuppressed);

    releaseOldController.resolve();
    await oldApply;

    assert.equal(committedSuppressed, newSuppressed);
    assert.deepEqual(
      controllerCalls.slice(-3),
      [
        { isSuppressed: oldSuppressed, category: "Old Controller Commit" },
        { isSuppressed: newSuppressed, category: "New Controller Commit" },
        { isSuppressed: newSuppressed, category: "New Controller Commit" }
      ],
      "the stale completion must trigger a corrective replay of the newest policy"
    );
    assert.deepEqual(
      committedStates.slice(-3),
      [
        { isSuppressed: newSuppressed, category: "New Controller Commit" },
        { isSuppressed: oldSuppressed, category: "Old Controller Commit" },
        { isSuppressed: newSuppressed, category: "New Controller Commit" }
      ]
    );
  });
}

test("a locally connected stale bot is disconnected without replacing the newer bot", async (t) => {
  const oldConnect = createDeferred();
  const oldConnectEntered = createDeferred();
  const suppressionCalls = [];
  const bots = [];
  const service = new TwitchBotService({
    playerController: {
      async setPlaybackSuppressed(isSuppressed) {
        suppressionCalls.push(isSuppressed);
      }
    },
    authManager: {
      async ensureValidUserToken(settings) {
        return {
          oauthToken: settings.oauthToken,
          refreshToken: settings.refreshToken,
          login: "hornbots"
        };
      }
    },
    botFactory({ config }) {
      const channel = config.twitch.channel;
      const bot = {
        channel,
        disconnectCalls: 0,
        channelInfo: {
          async getCategorySuppressionState() {
            return {
              categoryName: channel === "new-streamer" ? "New Policy" : "Old Policy",
              suppressMusicPlayback: channel === "new-streamer"
            };
          },
          getStatus() {
            return { state: "ok", categoryName: channel };
          }
        },
        async connect() {
          if (channel === "old-streamer") {
            oldConnectEntered.resolve();
            await oldConnect.promise;
          }
        },
        async disconnect() {
          this.disconnectCalls += 1;
        }
      };
      bots.push(bot);
      return bot;
    }
  });
  t.after(() => service.disconnect());

  const oldApply = service.applySettings(createConnectedSettings({
    twitchChannel: "old-streamer"
  }));
  await oldConnectEntered.promise;
  await service.applySettings(createConnectedSettings({
    twitchChannel: "new-streamer"
  }));
  oldConnect.resolve();
  await oldApply;

  const oldBot = bots.find((bot) => bot.channel === "old-streamer");
  const newBot = bots.find((bot) => bot.channel === "new-streamer");
  assert.equal(oldBot.disconnectCalls, 1);
  assert.equal(newBot.disconnectCalls, 0);
  assert.equal(service.bot, newBot);
  assert.equal(service.currentSettings.twitchChannel, "new-streamer");
  assert.equal(service.getStatus().channel, "new-streamer");
  assert.equal(suppressionCalls.at(-1), true);
});
