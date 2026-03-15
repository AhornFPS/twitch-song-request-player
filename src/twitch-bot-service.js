import { hasRequiredSettings } from "./config.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { TwitchBot } from "./twitch-bot.js";

function buildConfigSignature(settings) {
  return JSON.stringify({
    twitchChannel: settings.twitchChannel,
    twitchUsername: settings.twitchUsername,
    twitchOauthToken: settings.twitchOauthToken,
    twitchClientId: settings.twitchClientId,
    twitchClientSecret: settings.twitchClientSecret,
    youtubeApiKey: settings.youtubeApiKey
  });
}

function toBotConfig(settings) {
  return {
    twitch: {
      channel: settings.twitchChannel,
      username: settings.twitchUsername,
      oauthToken: settings.twitchOauthToken,
      clientId: settings.twitchClientId,
      clientSecret: settings.twitchClientSecret
    },
    youtubeApiKey: settings.youtubeApiKey
  };
}

export class TwitchBotService {
  constructor({ playerController }) {
    this.playerController = playerController;
    this.bot = null;
    this.configSignature = "";
    this.status = {
      state: "needs_configuration",
      message: "Set Twitch channel, bot username, and OAuth token to connect chat."
    };
  }

  getStatus() {
    return { ...this.status };
  }

  async applySettings(settings) {
    if (!hasRequiredSettings(settings)) {
      await this.disconnect({
        nextStatus: {
          state: "needs_configuration",
          message: "Set Twitch channel, bot username, and OAuth token to connect chat."
        }
      });
      return this.getStatus();
    }

    const nextSignature = buildConfigSignature(settings);
    if (this.bot && this.configSignature === nextSignature) {
      return this.getStatus();
    }

    await this.disconnect();
    this.status = {
      state: "connecting",
      message: `Connecting to Twitch chat for #${settings.twitchChannel}...`
    };

    const bot = new TwitchBot({
      config: toBotConfig(settings),
      playerController: this.playerController
    });

    try {
      await bot.connect();
      this.bot = bot;
      this.configSignature = nextSignature;
      this.status = {
        state: "connected",
        message: `Connected to Twitch chat for #${settings.twitchChannel}.`,
        channel: settings.twitchChannel
      };
      logInfo("Twitch bot connected", {
        channel: settings.twitchChannel
      });
    } catch (error) {
      await bot.disconnect().catch(() => {});
      this.bot = null;
      this.configSignature = "";
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

  async disconnect({ nextStatus = null } = {}) {
    if (this.bot) {
      try {
        await this.bot.disconnect();
      } catch (error) {
        logWarn("Failed to disconnect Twitch bot cleanly", {
          message: error?.message ?? String(error)
        });
      }
    }

    this.bot = null;
    this.configSignature = "";

    if (nextStatus) {
      this.status = nextStatus;
    }
  }
}
