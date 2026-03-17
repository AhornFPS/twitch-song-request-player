import tmi from "tmi.js";
import { logInfo } from "./logger.js";
import { findChatCommandAction, getDefaultChatCommands } from "./chat-commands.js";
import { resolveSongRequest } from "./providers.js";
import { TwitchChannelInfo } from "./twitch-channel-info.js";

function getViewerRoleState(tags, channelName) {
  const username = tags.username?.toLowerCase() ?? "";
  const badges = tags.badges ?? {};

  return {
    isBroadcaster: username === channelName.toLowerCase() || Boolean(badges.broadcaster),
    isModerator: Boolean(tags.mod || badges.moderator),
    isVip: Boolean(badges.vip)
  };
}

function hasCommandPermission(tags, channelName, permission) {
  const roleState = getViewerRoleState(tags, channelName);

  if (roleState.isBroadcaster) {
    return true;
  }

  if (permission === "everyone") {
    return true;
  }

  if (permission === "broadcaster") {
    return false;
  }

  if (permission === "moderator") {
    return roleState.isModerator;
  }

  if (permission === "vip") {
    return roleState.isModerator || roleState.isVip;
  }

  return false;
}

function permissionLabel(permission) {
  if (permission === "moderator") {
    return "Only the broadcaster or moderators can use that command.";
  }

  if (permission === "broadcaster") {
    return "Only the broadcaster can use that command.";
  }

  if (permission === "vip") {
    return "Only the broadcaster, moderators, or VIPs can use that command.";
  }

  return "You cannot use that command.";
}

export class TwitchBot {
  constructor({
    config,
    playerController,
    client = null,
    channelInfo = null,
    songRequestResolver = resolveSongRequest,
    updateSettings = async () => null
  }) {
    this.config = config;
    this.playerController = playerController;
    this.songRequestResolver = songRequestResolver;
    this.updateSettings = updateSettings;
    this.channelInfo = channelInfo ?? new TwitchChannelInfo({
      channelName: config.twitch.channel,
      clientId: config.twitch.clientId,
      oauthToken: config.twitch.oauthToken,
      chatSuppressedCategories: config.twitch.chatSuppressedCategories,
      playbackSuppressedCategories: config.twitch.playbackSuppressedCategories
    });
    this.client = client ?? new tmi.Client({
      options: {
        debug: false
      },
      identity: {
        username: config.twitch.username,
        password: config.twitch.oauthToken
      },
      channels: [config.twitch.channel]
    });
    this.isConnected = false;
    this.handleIncomingMessage = async (channel, tags, message, self) => {
      if (self || !message.startsWith("!")) {
        return;
      }

      try {
        await this.handleCommand(channel, tags, message);
      } catch (error) {
        console.error(error);
        await this.reply(channel, `Error: ${error.message}`);
      }
    };

    this.removeTrackPlaybackListener = this.playerController.onTrackPlayback(async () => {
      await this.announceNowPlaying(this.playerController.getCurrentTrack());
    });
  }

  updateConfig(nextConfig) {
    this.config = nextConfig;

    if (this.channelInfo) {
      this.channelInfo.channelName = nextConfig.twitch.channel;
      this.channelInfo.clientId = nextConfig.twitch.clientId;
      this.channelInfo.oauthToken = nextConfig.twitch.oauthToken;
      this.channelInfo.chatSuppressedCategories = new Set(
        Array.from(nextConfig.twitch.chatSuppressedCategories ?? [], (value) => value.trim().toLowerCase())
      );
      this.channelInfo.playbackSuppressedCategories = new Set(
        Array.from(nextConfig.twitch.playbackSuppressedCategories ?? [], (value) => value.trim().toLowerCase())
      );
    }
  }

  getChatCommandConfig() {
    return this.config.chatCommands ?? getDefaultChatCommands();
  }

  getCommandPermission(actionId) {
    return this.getChatCommandConfig()?.[actionId]?.permission ?? "everyone";
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    this.client.removeAllListeners?.("message");
    this.client.on?.("message", this.handleIncomingMessage);
    await this.client.connect();
    this.isConnected = true;
    this.channelInfo.logConfigurationState();
    console.log(`Connected to Twitch chat for #${this.config.twitch.channel}`);
  }

  async disconnect() {
    this.client.removeAllListeners?.("message");
    this.removeTrackPlaybackListener?.();
    this.removeTrackPlaybackListener = null;

    if (!this.isConnected) {
      return;
    }

    await this.client.disconnect?.();
    this.isConnected = false;
  }

  async handleCommand(channel, tags, message) {
    const actionId = findChatCommandAction(message, this.getChatCommandConfig());
    if (!actionId) {
      return;
    }

    const [, ...rest] = message.trim().split(/\s+/);
    const query = rest.join(" ").trim();
    const permission = this.getCommandPermission(actionId);

    if (!hasCommandPermission(tags, this.config.twitch.channel, permission)) {
      await this.reply(channel, permissionLabel(permission));
      return;
    }

    if (actionId === "song_request") {
      if (this.config.requestPolicy?.requestsEnabled === false &&
        !hasCommandPermission(tags, this.config.twitch.channel, "moderator")
      ) {
        await this.reply(channel, "Song requests are currently closed.");
        return;
      }

      if (!query) {
        await this.reply(channel, "Usage: provide a YouTube or SoundCloud link, or a YouTube search query.");
        return;
      }

      const resolvedTrack = await this.songRequestResolver(query, this.config.youtubeApiKey);
      const queueTrack = await this.playerController.addRequest({
        ...resolvedTrack,
        requestedBy: {
          username: tags.username ?? "",
          displayName: tags["display-name"] ?? tags.username ?? ""
        }
      });

      if (queueTrack.duplicateType === "playing") {
        await this.reply(channel, `Song ${queueTrack.title} is already playing`);
        return;
      }

      if (queueTrack.alreadyQueued) {
        await this.reply(channel, `Song ${queueTrack.title} already in the queue`);
        return;
      }

      await this.reply(
        channel,
        `Queued: ${queueTrack.title} (requested by ${queueTrack.requestedBy.displayName || queueTrack.requestedBy.username})`
      );
      return;
    }

    if (actionId === "skip_current") {
      const skippedTrack = await this.playerController.skipCurrentTrack(tags.username ?? "unknown");

      if (!skippedTrack) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      await this.reply(channel, `${tags["display-name"] ?? tags.username} skipped the current song.`);
      await this.playerController.ensurePlayback();
      return;
    }

    if (actionId === "delete_current") {
      const deletedTrack = await this.playerController.deleteCurrentTrack(tags.username ?? "unknown");

      if (!deletedTrack) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      await this.reply(channel, `${tags["display-name"] ?? tags.username} deleted the current song.`);
      await this.playerController.ensurePlayback();
      return;
    }

    if (actionId === "save_current") {
      const result = await this.playerController.saveCurrentTrack(tags.username ?? "unknown");

      if (!result) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      if (result.alreadySaved) {
        await this.reply(channel, `Already saved: ${result.track.title}`);
        return;
      }

      await this.reply(channel, `Saved: ${result.track.title}`);
      return;
    }

    if (actionId === "current_song") {
      const track = this.playerController.getCurrentTrack();

      if (!track) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      await this.reply(channel, this.formatCurrentSongMessage(track));
      return;
    }

    if (actionId === "open_requests") {
      const nextSettings = await this.updateSettings({
        requestPolicy: {
          ...this.config.requestPolicy,
          requestsEnabled: true
        }
      });
      this.updateConfig({
        ...this.config,
        requestPolicy: nextSettings?.requestPolicy ?? {
          ...this.config.requestPolicy,
          requestsEnabled: true
        }
      });
      await this.reply(channel, "Song requests are now open.");
      return;
    }

    if (actionId === "close_requests") {
      const nextSettings = await this.updateSettings({
        requestPolicy: {
          ...this.config.requestPolicy,
          requestsEnabled: false
        }
      });
      this.updateConfig({
        ...this.config,
        requestPolicy: nextSettings?.requestPolicy ?? {
          ...this.config.requestPolicy,
          requestsEnabled: false
        }
      });
      await this.reply(channel, "Song requests are now closed.");
    }
  }

  async reply(channel, message) {
    if (await this.channelInfo.shouldSuppressChatMessages()) {
      logInfo("Suppressing Twitch chat message because of stream category", {
        channel: this.config.twitch.channel,
        category: this.channelInfo.lastCategoryName || null,
        messagePreview: message.slice(0, 120)
      });
      return;
    }

    const safeMessage = message.length > 450 ? `${message.slice(0, 447)}...` : message;
    await this.client.say(channel, safeMessage);
  }

  async announceNowPlaying(track) {
    if (!track) {
      return;
    }

    logInfo("Announcing now playing in chat", {
      title: track.title,
      url: track.url,
      requestedBy: track.requestedBy?.displayName || track.requestedBy?.username || null,
      origin: track.origin
    });

    await this.reply(`#${this.config.twitch.channel}`, this.formatCurrentSongMessage(track));
  }

  formatCurrentSongMessage(track) {
    const requester = track.requestedBy?.displayName || track.requestedBy?.username;
    const requesterText = requester ? `, requested by ${requester}` : "";

    return `Current song: ${track.title} ${track.url}${requesterText}`;
  }
}
