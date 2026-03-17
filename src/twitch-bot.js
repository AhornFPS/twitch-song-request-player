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
    isVip: Boolean(badges.vip),
    isSubscriber: Boolean(tags.subscriber || badges.subscriber)
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

function hasRequestAccess(roleState, accessLevel) {
  if (roleState.isBroadcaster) {
    return true;
  }

  if (accessLevel === "moderator") {
    return roleState.isModerator;
  }

  if (accessLevel === "vip") {
    return roleState.isModerator || roleState.isVip;
  }

  if (accessLevel === "subscriber") {
    return roleState.isModerator || roleState.isVip || roleState.isSubscriber;
  }

  if (accessLevel === "broadcaster") {
    return false;
  }

  return true;
}

function requestAccessLabel(accessLevel) {
  if (accessLevel === "moderator") {
    return "Song requests are currently limited to moderators and the broadcaster.";
  }

  if (accessLevel === "vip") {
    return "Song requests are currently limited to VIPs, moderators, and the broadcaster.";
  }

  if (accessLevel === "subscriber") {
    return "Song requests are currently limited to subscribers, VIPs, moderators, and the broadcaster.";
  }

  if (accessLevel === "broadcaster") {
    return "Song requests are currently limited to the broadcaster.";
  }

  return "Song requests are not available right now.";
}

function normalizeRequestList(value, { lowerCase = false } = {}) {
  const list = Array.isArray(value) ? value : [];

  return list
    .map((item) => typeof item === "string" ? item.trim() : "")
    .map((item) => lowerCase ? item.toLowerCase() : item)
    .filter(Boolean);
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
    const roleState = getViewerRoleState(tags, this.config.twitch.channel);

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

      const blockedUsers = normalizeRequestList(this.config.requestPolicy?.blockedUsers, {
        lowerCase: true
      });
      const normalizedUsername = tags.username?.trim().toLowerCase() ?? "";

      if (blockedUsers.includes(normalizedUsername)) {
        await this.reply(channel, "You are not allowed to send song requests in this channel.");
        return;
      }

      const accessLevel = typeof this.config.requestPolicy?.accessLevel === "string"
        ? this.config.requestPolicy.accessLevel
        : "everyone";
      if (!hasRequestAccess(roleState, accessLevel)) {
        await this.reply(channel, requestAccessLabel(accessLevel));
        return;
      }

      if (!query) {
        await this.reply(channel, "Usage: provide a YouTube or SoundCloud link, or a YouTube search query.");
        return;
      }

      const blockedPhrases = normalizeRequestList(this.config.requestPolicy?.blockedPhrases, {
        lowerCase: true
      });
      const normalizedQuery = query.toLowerCase();
      const blockedPhrase = blockedPhrases.find((phrase) => normalizedQuery.includes(phrase));

      if (blockedPhrase) {
        await this.reply(channel, "That request matches a blocked phrase and could not be queued.");
        return;
      }

      const resolvedTrack = await this.songRequestResolver(query, this.config.youtubeApiKey, {
        allowSearchRequests: this.config.requestPolicy?.allowSearchRequests,
        youtubeSafeSearch: this.config.requestPolicy?.youtubeSafeSearch
      });
      const allowedProviders = Array.isArray(this.config.requestPolicy?.allowedProviders)
        ? normalizeRequestList(this.config.requestPolicy.allowedProviders, {
            lowerCase: true
          })
        : ["youtube", "soundcloud"];

      if (!allowedProviders.includes(resolvedTrack.provider)) {
        await this.reply(channel, `${resolvedTrack.provider} requests are currently disabled.`);
        return;
      }
      const queueTrack = await this.playerController.addRequest({
        ...resolvedTrack,
        requestedBy: {
          username: tags.username ?? "",
          displayName: tags["display-name"] ?? tags.username ?? ""
        }
      }, {
        bypassRequestLimits: roleState.isBroadcaster || roleState.isModerator
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

    if (actionId === "queue_status") {
      const queueSummary = this.playerController.getQueueSummary(3);
      const currentTrack = this.playerController.getCurrentTrack();

      if (!currentTrack && queueSummary.length === 0) {
        await this.reply(channel, "The request queue is empty right now.");
        return;
      }

      const nowPlayingText = currentTrack ? `Now playing: ${currentTrack.title}. ` : "";
      const queueText = queueSummary.length > 0
        ? `Up next: ${queueSummary.map((track, index) => `${index + 1}. ${track.title}`).join(" | ")}`
        : "No queued requests after the current song.";
      await this.reply(channel, `${nowPlayingText}${queueText}`);
      return;
    }

    if (actionId === "queue_position") {
      const position = this.playerController.getQueuePositionForRequester(tags.username ?? "");

      if (!position) {
        await this.reply(channel, "You do not have a queued request right now.");
        return;
      }

      await this.reply(channel, `${position.track.title} is #${position.position} in the queue.`);
      return;
    }

    if (actionId === "remove_own_request") {
      const removedTrack = await this.playerController.removeQueuedTrackByRequester(tags.username ?? "", tags.username ?? "unknown");

      if (!removedTrack) {
        await this.reply(channel, "You do not have a queued request to remove.");
        return;
      }

      await this.reply(channel, `Removed your queued request: ${removedTrack.title}`);
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
      return;
    }

    if (actionId === "clear_queue") {
      const result = await this.playerController.clearQueue(tags.username ?? "unknown");
      await this.reply(channel, `Cleared ${result.clearedCount} queued request${result.clearedCount === 1 ? "" : "s"}.`);
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
