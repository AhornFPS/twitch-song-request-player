import tmi from "tmi.js";
import { logInfo } from "./logger.js";
import { resolveSongRequest } from "./providers.js";
import { TwitchChannelInfo } from "./twitch-channel-info.js";

function canModeratePlayback(tags, channelName) {
  const username = tags.username?.toLowerCase() ?? "";
  const badges = tags.badges ?? {};

  return Boolean(
    username === channelName.toLowerCase() ||
    tags.mod ||
    badges.broadcaster ||
    badges.moderator ||
    badges.vip
  );
}

export class TwitchBot {
  constructor({ config, playerController, client = null, channelInfo = null, songRequestResolver = resolveSongRequest }) {
    this.config = config;
    this.playerController = playerController;
    this.songRequestResolver = songRequestResolver;
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
    const [command, ...rest] = message.trim().split(/\s+/);
    const query = rest.join(" ").trim();

    if (command === "!sr") {
      if (!query) {
        await this.reply(channel, "Usage: !sr <youtube/soundcloud link or youtube search>");
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

    if (command === "!skip") {
      if (!canModeratePlayback(tags, this.config.twitch.channel)) {
        await this.reply(channel, "Only the broadcaster, moderators, or VIPs can skip songs.");
        return;
      }

      const skippedTrack = await this.playerController.skipCurrentTrack(tags.username ?? "unknown");

      if (!skippedTrack) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      await this.reply(channel, `${tags["display-name"] ?? tags.username} skipped the current song.`);
      await this.playerController.ensurePlayback();
      return;
    }

    if (command === "!delete") {
      if (!canModeratePlayback(tags, this.config.twitch.channel)) {
        await this.reply(channel, "Only the broadcaster, moderators, or VIPs can delete songs.");
        return;
      }

      const deletedTrack = await this.playerController.deleteCurrentTrack(tags.username ?? "unknown");

      if (!deletedTrack) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      await this.reply(channel, `${tags["display-name"] ?? tags.username} deleted the current song.`);
      await this.playerController.ensurePlayback();
      return;
    }

    if (command === "!save") {
      if (!canModeratePlayback(tags, this.config.twitch.channel)) {
        await this.reply(channel, "Only the broadcaster, moderators, or VIPs can save songs.");
        return;
      }

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

    if (command === "!currentsong") {
      const track = this.playerController.getCurrentTrack();

      if (!track) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      await this.reply(channel, this.formatCurrentSongMessage(track));
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
