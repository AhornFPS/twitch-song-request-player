// @ts-nocheck
import { hasRequiredSettings } from "./config.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { TWITCH_BOT_SCOPES, TwitchAuthManager } from "./twitch-auth.js";
import { TwitchBot } from "./twitch-bot.js";

function buildConfigSignature(settings) {
  return JSON.stringify({
    twitchChannel: settings.twitchChannel,
    twitchUsername: settings.twitchUsername,
    twitchOauthToken: settings.twitchOauthToken,
    twitchRefreshToken: settings.twitchRefreshToken,
    twitchClientId: settings.twitchClientId,
    twitchClientSecret: settings.twitchClientSecret,
    twitchSharedChatForSourceOnly: settings.twitchSharedChatForSourceOnly
  });
}

function toBotConfig(settings) {
  return {
    twitch: {
      channel: settings.twitchChannel,
      username: settings.twitchUsername,
      oauthToken: settings.twitchOauthToken,
      refreshToken: settings.twitchRefreshToken,
      clientId: settings.twitchClientId,
      clientSecret: settings.twitchClientSecret,
      sharedChatForSourceOnly: settings.twitchSharedChatForSourceOnly,
      chatSuppressedCategories: settings.chatSuppressedCategories,
      playbackSuppressedCategories: settings.playbackSuppressedCategories
    },
    youtubeApiKey: settings.youtubeApiKey,
    requestPolicy: settings.requestPolicy,
    chatCommands: settings.chatCommands
  };
}

export class TwitchBotService {
  constructor({
    playerController,
    autoDjController = null,
    persistSettings = async (partialSettings) => partialSettings,
    authManager = new TwitchAuthManager(),
    botFactory = ({ config, playerController: nextPlayerController, autoDjController: nextAutoDjController, updateSettings }) =>
      new TwitchBot({
        config,
        playerController: nextPlayerController,
        autoDjController: nextAutoDjController,
        updateSettings
      })
  }) {
    this.playerController = playerController;
    this.autoDjController = autoDjController;
    this.persistSettings = persistSettings;
    this.authManager = authManager;
    this.botFactory = botFactory;
    this.bot = null;
    this.configSignature = "";
    this.currentSettings = null;
    this.tokenValidationTimer = null;
    this.revalidatePromise = null;
    this.deviceAuthRunId = 0;
    this.applySettingsGeneration = 0;
    this.playbackSuppressionCommitSequence = 0;
    this.latestPlaybackSuppressionCommit = null;
    this.lastSettledPlaybackSuppressionState = {
      suppressMusicPlayback: false,
      categoryName: ""
    };
    this.categoryPolicyTimer = null;
    this.tokenHydrationError = "";
    this.status = {
      state: "needs_configuration",
      message: "Set Twitch channel, bot username, and OAuth token to connect chat."
    };
    this.authStatus = {
      state: "idle",
      message: "Enter a Twitch Client ID to connect the bot account in-app."
    };
  }

  getStatus() {
    return {
      ...this.status,
      categoryLookup:
        this.bot?.channelInfo?.getStatus?.() ?? {
          state: "inactive",
          message: "Category lookup is inactive.",
          categoryName: "",
          lastResolvedAt: null
        }
    };
  }

  getAuthStatus() {
    return { ...this.authStatus };
  }

  async announceNowPlaying(track) {
    if (!this.bot || !track) {
      return false;
    }
    await this.bot.announceNowPlaying(track);
    return true;
  }

  async applySettings(settings) {
    const applySettingsGeneration = ++this.applySettingsGeneration;
    this.latestPlaybackSuppressionCommit = this.createPlaybackSuppressionCommit(
      this.lastSettledPlaybackSuppressionState,
      applySettingsGeneration
    );
    const isCurrentApply = () => (
      applySettingsGeneration === this.applySettingsGeneration
    );
    this.tokenHydrationError = "";
    this.currentSettings = {
      ...settings
    };

    const hydratedSettings = await this.hydrateSettingsFromToken(settings, {
      applySettingsGeneration
    });
    if (!isCurrentApply()) {
      return this.getStatus();
    }
    this.currentSettings = {
      ...hydratedSettings
    };

    if (this.tokenHydrationError) {
      await this.disconnectForApplySettings(applySettingsGeneration, {
        nextStatus: {
          state: "error",
          message: this.tokenHydrationError
        }
      });
      return this.getStatus();
    }

    if (!hasRequiredSettings(hydratedSettings)) {
      await this.disconnectForApplySettings(applySettingsGeneration, {
        nextStatus: {
          state: "needs_configuration",
          message: "Set Twitch channel, bot username, and OAuth token to connect chat."
        }
      });
      return this.getStatus();
    }

    const nextSignature = buildConfigSignature(hydratedSettings);
    if (this.bot && this.configSignature === nextSignature) {
      const bot = this.bot;
      bot.updateConfig?.(toBotConfig(hydratedSettings));
      const categoryPolicyApplied = await this.refreshCategoryPolicy({
        expectedBot: bot,
        applySettingsGeneration
      });
      if (!isCurrentApply() || !categoryPolicyApplied) {
        return this.getStatus();
      }
      this.startCategoryPolicyLoop();
      this.startTokenValidationLoop();
      return this.getStatus();
    }

    const disconnected = await this.disconnectForApplySettings(applySettingsGeneration);
    if (!disconnected || !isCurrentApply()) {
      return this.getStatus();
    }
    this.status = {
      state: "connecting",
      message: `Connecting to Twitch chat for #${hydratedSettings.twitchChannel}...`
    };

    let bot = null;
    bot = this.botFactory({
      config: toBotConfig(hydratedSettings),
      playerController: this.playerController,
      autoDjController: this.autoDjController,
      updateSettings: async (partialSettings) => {
        const nextSettings = await this.persistSettings(partialSettings);
        if (!isCurrentApply()) {
          return nextSettings;
        }
        this.currentSettings = {
          ...nextSettings
        };
        if (!this.bot || this.bot === bot) {
          bot?.updateConfig?.(toBotConfig(nextSettings));
        }
        return nextSettings;
      }
    });

    try {
      await bot.connect();
      if (!isCurrentApply()) {
        await bot.disconnect().catch(() => {});
        return this.getStatus();
      }
      this.bot = bot;
      this.configSignature = nextSignature;
      this.status = {
        state: "connected",
        message: `Connected to Twitch chat for #${hydratedSettings.twitchChannel}.`,
        channel: hydratedSettings.twitchChannel
      };
      logInfo("Twitch bot connected", {
        channel: hydratedSettings.twitchChannel,
        username: hydratedSettings.twitchUsername
      });
      const categoryPolicyApplied = await this.refreshCategoryPolicy({
        expectedBot: bot,
        applySettingsGeneration
      });
      if (!isCurrentApply() || !categoryPolicyApplied) {
        return this.getStatus();
      }
      this.startCategoryPolicyLoop();
      this.startTokenValidationLoop();
    } catch (error) {
      if (this.bot === bot) {
        this.bot = null;
        this.configSignature = "";
      }
      await bot.disconnect().catch(() => {});
      if (!isCurrentApply()) {
        return this.getStatus();
      }
      this.stopTokenValidationLoop();
      this.status = {
        state: "error",
        message: error?.message ?? String(error)
      };
      logError("Twitch bot failed to connect", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
    }

    return this.getStatus();
  }

  async disconnectForApplySettings(applySettingsGeneration, { nextStatus = null } = {}) {
    if (applySettingsGeneration !== this.applySettingsGeneration) {
      return false;
    }

    this.stopCategoryPolicyLoop();
    this.stopTokenValidationLoop();
    const bot = this.bot;
    this.bot = null;
    this.configSignature = "";

    if (bot) {
      try {
        await bot.disconnect();
      } catch (error) {
        logWarn("Failed to disconnect Twitch bot cleanly", {
          message: error?.message ?? String(error)
        });
      }
      if (applySettingsGeneration !== this.applySettingsGeneration) {
        return false;
      }
    }

    try {
      await this.applyPlaybackSuppressionState({
        suppressMusicPlayback: false,
        categoryName: ""
      }, { applySettingsGeneration });
    } catch (error) {
      logWarn("Failed to clear playback suppression after Twitch bot disconnect", {
        message: error?.message ?? String(error)
      });
    }
    if (applySettingsGeneration !== this.applySettingsGeneration) {
      return false;
    }

    if (nextStatus) {
      this.status = nextStatus;
    }
    return true;
  }

  async disconnect({ nextStatus = null } = {}) {
    const disconnectGeneration = ++this.applySettingsGeneration;
    this.latestPlaybackSuppressionCommit = this.createPlaybackSuppressionCommit({
      suppressMusicPlayback: false,
      categoryName: ""
    }, disconnectGeneration);
    this.stopCategoryPolicyLoop();
    this.stopTokenValidationLoop();
    const bot = this.bot;
    this.bot = null;
    this.configSignature = "";

    if (bot) {
      try {
        await bot.disconnect();
      } catch (error) {
        logWarn("Failed to disconnect Twitch bot cleanly", {
          message: error?.message ?? String(error)
        });
      }
      if (disconnectGeneration !== this.applySettingsGeneration) {
        return;
      }
    }

    try {
      await this.applyPlaybackSuppressionState({
        suppressMusicPlayback: false,
        categoryName: ""
      }, { applySettingsGeneration: disconnectGeneration });
    } catch (error) {
      logWarn("Failed to clear playback suppression after Twitch bot disconnect", {
        message: error?.message ?? String(error)
      });
    }
    if (disconnectGeneration !== this.applySettingsGeneration) {
      return;
    }

    if (nextStatus) {
      this.status = nextStatus;
    }
  }

  async startDeviceAuth(settings) {
    this.currentSettings = {
      ...settings
    };

    if (!settings.twitchClientId) {
      this.authStatus = {
        state: "error",
        message: "Enter Twitch Client ID before starting in-app bot login."
      };
      return this.getAuthStatus();
    }

    const runId = ++this.deviceAuthRunId;
    const deviceFlow = await this.authManager.requestDeviceCode({
      clientId: settings.twitchClientId,
      scopes: TWITCH_BOT_SCOPES
    });

    this.authStatus = {
      state: "pending",
      message: "Approve the bot account on Twitch, then return here.",
      userCode: deviceFlow.userCode,
      verificationUri: deviceFlow.verificationUri,
      verificationUriComplete: deviceFlow.verificationUriComplete,
      expiresAt: new Date(Date.now() + deviceFlow.expiresIn * 1000).toISOString()
    };

    void this.completeDeviceAuth(runId, settings, deviceFlow);

    return this.getAuthStatus();
  }

  cancelDeviceAuth() {
    this.deviceAuthRunId += 1;

    if (this.authStatus.state === "pending") {
      this.authStatus = {
        state: "idle",
        message: "In-app bot login cancelled."
      };
    }

    return this.getAuthStatus();
  }

  async hydrateSettingsFromToken(settings, { applySettingsGeneration = null } = {}) {
    const isCurrentApply = () => (
      applySettingsGeneration === null ||
      applySettingsGeneration === this.applySettingsGeneration
    );
    if (!settings.twitchOauthToken) {
      return settings;
    }

    try {
      const ensuredToken = await this.authManager.ensureValidUserToken({
        clientId: settings.twitchClientId,
        clientSecret: settings.twitchClientSecret,
        oauthToken: settings.twitchOauthToken,
        refreshToken: settings.twitchRefreshToken
      });
      if (!isCurrentApply()) {
        return settings;
      }

      if (!ensuredToken) {
        this.markStoredLoginExpired();
        return settings;
      }

      const nextSettings = {
        ...settings,
        twitchOauthToken: ensuredToken.oauthToken,
        twitchRefreshToken: ensuredToken.refreshToken || settings.twitchRefreshToken,
        twitchUsername: ensuredToken.login || settings.twitchUsername
      };

      const shouldPersist =
        nextSettings.twitchOauthToken !== settings.twitchOauthToken ||
        nextSettings.twitchRefreshToken !== settings.twitchRefreshToken ||
        nextSettings.twitchUsername !== settings.twitchUsername;

      this.authStatus = {
        state: "success",
        message: `Connected bot account ${nextSettings.twitchUsername}.`,
        botUsername: nextSettings.twitchUsername
      };

      if (!shouldPersist) {
        return nextSettings;
      }

      const persistedSettings = await this.persistSettings({
        twitchOauthToken: nextSettings.twitchOauthToken,
        twitchRefreshToken: nextSettings.twitchRefreshToken,
        twitchUsername: nextSettings.twitchUsername
      });
      return isCurrentApply() ? persistedSettings : settings;
    } catch (error) {
      if (!isCurrentApply()) {
        return settings;
      }
      logWarn("Could not validate Twitch bot token before connect", {
        message: error?.message ?? String(error)
      });
      if (error?.status === 400 || error?.status === 401) {
        this.markStoredLoginExpired();
      }
      return settings;
    }
  }

  markStoredLoginExpired() {
    const message = "Twitch bot login expired or was revoked. Reconnect HornBots from Settings.";
    this.tokenHydrationError = message;
    this.authStatus = {
      state: "error",
      message
    };
  }

  startTokenValidationLoop() {
    this.stopTokenValidationLoop();

    if (!this.currentSettings?.twitchOauthToken) {
      return;
    }

    this.tokenValidationTimer = setInterval(() => {
      void this.revalidateCurrentToken();
    }, 60 * 60 * 1000);
  }

  stopTokenValidationLoop() {
    if (!this.tokenValidationTimer) {
      return;
    }

    clearInterval(this.tokenValidationTimer);
    this.tokenValidationTimer = null;
  }

  startCategoryPolicyLoop() {
    this.stopCategoryPolicyLoop();

    if (!this.bot?.channelInfo) {
      return;
    }

    const expectedBot = this.bot;
    const applySettingsGeneration = this.applySettingsGeneration;
    this.categoryPolicyTimer = setInterval(() => {
      void this.refreshCategoryPolicy({
        expectedBot,
        applySettingsGeneration
      });
    }, 30_000);
  }

  stopCategoryPolicyLoop() {
    if (!this.categoryPolicyTimer) {
      return;
    }

    clearInterval(this.categoryPolicyTimer);
    this.categoryPolicyTimer = null;
  }

  createPlaybackSuppressionCommit(suppressionState, applySettingsGeneration) {
    return {
      sequence: ++this.playbackSuppressionCommitSequence,
      applySettingsGeneration,
      suppressMusicPlayback: Boolean(suppressionState?.suppressMusicPlayback),
      categoryName: suppressionState?.categoryName || ""
    };
  }

  async publishPlaybackSuppressionCommit(commit) {
    await this.playerController.setPlaybackSuppressed(
      commit.suppressMusicPlayback,
      { category: commit.categoryName }
    );
  }

  async reassertLatestPlaybackSuppressionState() {
    while (true) {
      const latestCommit = this.latestPlaybackSuppressionCommit;
      if (
        !latestCommit ||
        latestCommit.applySettingsGeneration !== this.applySettingsGeneration
      ) {
        return false;
      }

      await this.publishPlaybackSuppressionCommit(latestCommit);
      if (
        this.latestPlaybackSuppressionCommit === latestCommit &&
        latestCommit.applySettingsGeneration === this.applySettingsGeneration
      ) {
        this.lastSettledPlaybackSuppressionState = {
          suppressMusicPlayback: latestCommit.suppressMusicPlayback,
          categoryName: latestCommit.categoryName
        };
        return true;
      }
    }
  }

  async applyPlaybackSuppressionState(suppressionState, {
    applySettingsGeneration = this.applySettingsGeneration
  } = {}) {
    const ownedGeneration = applySettingsGeneration ?? this.applySettingsGeneration;
    if (ownedGeneration !== this.applySettingsGeneration) {
      return false;
    }

    const commit = this.createPlaybackSuppressionCommit(
      suppressionState,
      ownedGeneration
    );
    this.latestPlaybackSuppressionCommit = commit;
    await this.publishPlaybackSuppressionCommit(commit);
    if (
      this.latestPlaybackSuppressionCommit === commit &&
      ownedGeneration === this.applySettingsGeneration
    ) {
      this.lastSettledPlaybackSuppressionState = {
        suppressMusicPlayback: commit.suppressMusicPlayback,
        categoryName: commit.categoryName
      };
      return true;
    }

    await this.reassertLatestPlaybackSuppressionState();
    return false;
  }

  async refreshCategoryPolicy({
    expectedBot = this.bot,
    applySettingsGeneration = null
  } = {}) {
    const ownsPolicy = () => (
      (applySettingsGeneration === null ||
        applySettingsGeneration === this.applySettingsGeneration) &&
      this.bot === expectedBot
    );
    if (!ownsPolicy()) {
      return false;
    }
    if (!expectedBot?.channelInfo) {
      return this.applyPlaybackSuppressionState({
        suppressMusicPlayback: false,
        categoryName: ""
      }, { applySettingsGeneration });
    }

    const suppressionState = await expectedBot.channelInfo.getCategorySuppressionState();
    if (!ownsPolicy()) {
      return false;
    }
    return this.applyPlaybackSuppressionState(suppressionState, {
      applySettingsGeneration
    });
  }

  async revalidateCurrentToken() {
    if (this.revalidatePromise) {
      return this.revalidatePromise;
    }

    this.revalidatePromise = this.revalidateCurrentTokenInternal().finally(() => {
      this.revalidatePromise = null;
    });

    return this.revalidatePromise;
  }

  async revalidateCurrentTokenInternal() {
    const settings = this.currentSettings;

    if (!settings?.twitchOauthToken) {
      return;
    }

    try {
      const ensuredToken = await this.authManager.ensureValidUserToken({
        clientId: settings.twitchClientId,
        clientSecret: settings.twitchClientSecret,
        oauthToken: settings.twitchOauthToken,
        refreshToken: settings.twitchRefreshToken
      });

      if (!ensuredToken) {
        await this.disconnect({
          nextStatus: {
            state: "error",
            message: "Twitch bot token is invalid or expired. Reconnect the bot account from the dashboard."
          }
        });
        return;
      }

      const tokenChanged =
        ensuredToken.oauthToken !== settings.twitchOauthToken ||
        (ensuredToken.refreshToken || "") !== (settings.twitchRefreshToken || "") ||
        (ensuredToken.login || settings.twitchUsername) !== settings.twitchUsername;

      if (!tokenChanged) {
        return;
      }

      const nextSettings = await this.persistSettings({
        twitchOauthToken: ensuredToken.oauthToken,
        twitchRefreshToken: ensuredToken.refreshToken || settings.twitchRefreshToken,
        twitchUsername: ensuredToken.login || settings.twitchUsername
      });

      this.currentSettings = {
        ...nextSettings
      };
      await this.applySettings(nextSettings);
    } catch (error) {
      logWarn("Failed validating Twitch bot token", {
        message: error?.message ?? String(error)
      });
    }
  }

  async completeDeviceAuth(runId, settings, deviceFlow) {
    let pollDelayMs = Math.max(1000, deviceFlow.intervalSeconds * 1000);
    const expiresAt = Date.now() + deviceFlow.expiresIn * 1000;

    while (runId === this.deviceAuthRunId && Date.now() < expiresAt) {
      await new Promise((resolve) => {
        setTimeout(resolve, pollDelayMs);
      });

      if (runId !== this.deviceAuthRunId) {
        return;
      }

      try {
        const tokenResult = await this.authManager.exchangeDeviceCode({
          clientId: settings.twitchClientId,
          deviceCode: deviceFlow.deviceCode,
          scopes: TWITCH_BOT_SCOPES
        });
        const ensuredToken = await this.authManager.ensureValidUserToken({
          clientId: settings.twitchClientId,
          clientSecret: settings.twitchClientSecret,
          oauthToken: tokenResult.oauthToken,
          refreshToken: tokenResult.refreshToken
        });

        if (!ensuredToken?.login) {
          throw new Error("Twitch token validation did not return a bot username.");
        }

        const nextSettings = await this.persistSettings({
          twitchOauthToken: ensuredToken.oauthToken,
          twitchRefreshToken: ensuredToken.refreshToken || tokenResult.refreshToken,
          twitchUsername: ensuredToken.login
        });

        this.currentSettings = {
          ...nextSettings
        };
        this.authStatus = {
          state: "success",
          message: `Connected bot account ${ensuredToken.login}.`,
          botUsername: ensuredToken.login
        };

        await this.applySettings(nextSettings);
        return;
      } catch (error) {
        if (error?.code === "authorization_pending") {
          continue;
        }

        if (error?.code === "slow_down") {
          pollDelayMs += 5000;
          continue;
        }

        if (error?.code === "access_denied") {
          this.authStatus = {
            state: "error",
            message: "Twitch login was denied for the bot account."
          };
          return;
        }

        if (error?.code === "expired_token") {
          this.authStatus = {
            state: "error",
            message: "The Twitch activation code expired. Start the login again."
          };
          return;
        }

        this.authStatus = {
          state: "error",
          message: error?.message ?? "Failed to complete Twitch bot login."
        };
        logWarn("Twitch device login failed", {
          message: error?.message ?? String(error),
          code: error?.code ?? null
        });
        return;
      }
    }

    if (runId === this.deviceAuthRunId) {
      this.authStatus = {
        state: "error",
        message: "The Twitch activation code expired. Start the login again."
      };
    }
  }
}
