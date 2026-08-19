// @ts-nocheck
import tmi from "tmi.js";
import { logInfo, logWarn } from "./logger.js";
import { findChatCommandAction, getDefaultChatCommands } from "./chat-commands.js";
import { resolveSongRequest, resolveYouTubePlaylistFromApi } from "./providers.js";
import { TwitchChatApi } from "./twitch-chat-api.js";
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

function normalizeLimit(value) {
  const parsedValue = Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return parsedValue;
}

function normalizeBlockedDomain(value) {
  const trimmedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!trimmedValue) {
    return "";
  }

  try {
    return new URL(trimmedValue).hostname.toLowerCase();
  } catch {
    return trimmedValue.replace(/^[./]+/, "").split("/")[0] ?? "";
  }
}

function findBlockedDomainMatch(rawUrl, blockedDomains) {
  if (typeof rawUrl !== "string" || !rawUrl.trim() || !Array.isArray(blockedDomains) || blockedDomains.length === 0) {
    return "";
  }

  try {
    const hostname = new URL(rawUrl.trim()).hostname.toLowerCase();
    return blockedDomains.find((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) ?? "";
  } catch {
    return "";
  }
}

function getYouTubeSourceCandidates(track) {
  const candidates = new Set();

  if (typeof track?.sourceChannelId === "string" && track.sourceChannelId.trim()) {
    candidates.add(track.sourceChannelId.trim().toLowerCase());
  }

  if (typeof track?.sourceName === "string" && track.sourceName.trim()) {
    candidates.add(track.sourceName.trim().toLowerCase());
  }

  if (typeof track?.sourceUrl === "string" && track.sourceUrl.trim()) {
    const normalizedUrl = track.sourceUrl.trim().toLowerCase();
    candidates.add(normalizedUrl);

    try {
      const parsedUrl = new URL(track.sourceUrl);
      candidates.add(`${parsedUrl.hostname.toLowerCase()}${parsedUrl.pathname.toLowerCase()}`);
      const pathParts = parsedUrl.pathname.split("/").filter(Boolean).map((value) => value.trim().toLowerCase());
      const channelIndex = pathParts.findIndex((segment) => segment === "channel");

      if (channelIndex !== -1 && pathParts[channelIndex + 1]) {
        candidates.add(pathParts[channelIndex + 1]);
      }

      if (pathParts[0]?.startsWith("@")) {
        candidates.add(pathParts[0]);
        candidates.add(pathParts[0].slice(1));
      }

      if (pathParts[0] === "user" && pathParts[1]) {
        candidates.add(pathParts[1]);
      }

      if (pathParts[0] === "c" && pathParts[1]) {
        candidates.add(pathParts[1]);
      }
    } catch {
    }
  }

  return candidates;
}

function getSoundCloudSourceCandidates(track) {
  const candidates = new Set();

  if (typeof track?.sourceName === "string" && track.sourceName.trim()) {
    candidates.add(track.sourceName.trim().toLowerCase());
  }

  if (typeof track?.sourceUrl === "string" && track.sourceUrl.trim()) {
    const normalizedUrl = track.sourceUrl.trim().toLowerCase();
    candidates.add(normalizedUrl);

    try {
      const parsedUrl = new URL(track.sourceUrl);
      candidates.add(`${parsedUrl.hostname.toLowerCase()}${parsedUrl.pathname.toLowerCase()}`);
      const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
      const username = pathParts[0]?.trim().toLowerCase();
      if (username) {
        candidates.add(username);
      }
    } catch {
    }
  }

  return candidates;
}

function formatChatTrackTitle(track) {
  const title = String(track?.title ?? "").replace(/\s*[\u2013\u2014]\s*/gu, " - ").trim();
  const artist = String(track?.artist ?? "").replace(/\s*[\u2013\u2014]\s*/gu, " - ").trim();
  if (!artist || title.toLocaleLowerCase().includes(artist.toLocaleLowerCase())) {
    return title;
  }
  return title ? `${artist} - ${title}` : artist;
}

function formatPlaybackFailureReason({ reason = "", message = "" } = {}) {
  const normalizedReason = typeof reason === "string" ? reason.trim().toLowerCase() : "";
  const normalizedMessage = typeof message === "string" ? message.trim() : "";

  if (normalizedMessage) {
    return normalizedMessage;
  }

  if (normalizedReason === "youtube_startup_timeout") {
    return "the YouTube player never started it.";
  }

  if (normalizedReason === "youtube_2") {
    return "YouTube rejected the video ID.";
  }

  if (normalizedReason === "youtube_5") {
    return "YouTube reported an HTML5 playback error.";
  }

  if (normalizedReason === "youtube_100") {
    return "YouTube says the video is missing, private, or unavailable.";
  }

  if (normalizedReason === "youtube_101" || normalizedReason === "youtube_150") {
    return "the video owner blocks embedded playback.";
  }

  if (normalizedReason === "soundcloud_load_timeout") {
    return "the SoundCloud player never finished loading it.";
  }

  if (normalizedReason === "soundcloud_widget_error") {
    return "SoundCloud reported a player error.";
  }

  if (normalizedReason === "invalid_youtube_url") {
    return "the YouTube link did not contain a playable video ID.";
  }

  if (normalizedReason === "suno_audio_unavailable") {
    return "Suno did not provide a playable audio file.";
  }

  if (normalizedReason === "suno_missing_audio_url") {
    return "Suno did not return an audio URL.";
  }

  if (normalizedReason === "suno_audio_error") {
    return "the Suno audio player reported an error.";
  }

  if (normalizedReason === "unsupported_provider") {
    return "that provider is not supported by the embedded player.";
  }

  if (normalizedReason) {
    return `${normalizedReason.replaceAll("_", " ")}.`;
  }

  return "the embedded player reported an error.";
}

export class TwitchBot {
  constructor({
    config,
    playerController,
    autoDjController = null,
    client = null,
    channelInfo = null,
    chatApi = null,
    songRequestResolver = resolveSongRequest,
    youtubePlaylistResolver = resolveYouTubePlaylistFromApi,
    updateSettings = async () => null
  }) {
    this.config = config;
    this.playerController = playerController;
    this.autoDjController = autoDjController;
    this.songRequestResolver = songRequestResolver;
    this.youtubePlaylistResolver = youtubePlaylistResolver;
    this.updateSettings = updateSettings;
    this.chatApi = chatApi ?? new TwitchChatApi();
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
    this.removeTrackFinishListener = this.playerController.onTrackFinish?.(async (event) => {
      await this.announcePlaybackFailure(event);
    }) ?? null;
  }

  updateConfig(nextConfig) {
    this.config = nextConfig;

    if (this.channelInfo) {
      this.channelInfo.channelName = nextConfig.twitch.channel;
      this.channelInfo.clientId = nextConfig.twitch.clientId;
      this.channelInfo.oauthToken = nextConfig.twitch.oauthToken;
      if (typeof this.channelInfo.updateSuppressionCategories === "function") {
        this.channelInfo.updateSuppressionCategories({
          chatSuppressedCategories: nextConfig.twitch.chatSuppressedCategories,
          playbackSuppressedCategories: nextConfig.twitch.playbackSuppressedCategories
        });
      } else {
        this.channelInfo.chatSuppressedCategories = new Set(
          Array.from(nextConfig.twitch.chatSuppressedCategories ?? [], (value) => value.trim().toLowerCase())
        );
        this.channelInfo.playbackSuppressedCategories = new Set(
          Array.from(nextConfig.twitch.playbackSuppressedCategories ?? [], (value) => value.trim().toLowerCase())
        );
      }
    }
  }

  getChatCommandConfig() {
    return this.config.chatCommands ?? getDefaultChatCommands();
  }

  getCommandPermission(actionId) {
    return this.getChatCommandConfig()?.[actionId]?.permission ?? "everyone";
  }

  getCurrentTrackForChat() {
    return this.playerController.getCurrentTrack()
      ?? this.autoDjController?.getRemoteCurrentTrack?.()
      ?? null;
  }

  buildRequestAuditRequester(tags) {
    return {
      username: tags?.username ?? "",
      displayName: tags?.["display-name"] ?? tags?.username ?? ""
    };
  }

  async auditRejectedSongRequest({
    tags,
    roleState,
    input = "",
    track = null,
    reason = "",
    message = "",
    extraDetails = null,
    bypassRequestLimits = false
  }) {
    await this.playerController.recordRequestOutcome?.({
      source: "twitch_chat",
      outcome: "rejected",
      reason,
      message,
      input,
      requestedBy: this.buildRequestAuditRequester(tags),
      track,
      bypassRequestLimits,
      details: {
        channel: this.config.twitch.channel,
        command: "song_request",
        roleState,
        ...(extraDetails && typeof extraDetails === "object" ? extraDetails : {})
      }
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
    this.removeTrackFinishListener?.();
    this.removeTrackFinishListener = null;

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
      const bypassRequestLimits = roleState.isBroadcaster || roleState.isModerator;

      if (this.config.requestPolicy?.requestsEnabled === false &&
        !hasCommandPermission(tags, this.config.twitch.channel, "moderator")
      ) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: "requests_closed",
          message: "Song requests are currently closed.",
          bypassRequestLimits
        });
        await this.reply(channel, "Song requests are currently closed.");
        return;
      }

      const blockedUsers = normalizeRequestList(this.config.requestPolicy?.blockedUsers, {
        lowerCase: true
      });
      const normalizedUsername = tags.username?.trim().toLowerCase() ?? "";

      if (blockedUsers.includes(normalizedUsername)) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: "blocked_user",
          message: "You are not allowed to send song requests in this channel.",
          bypassRequestLimits
        });
        await this.reply(channel, "You are not allowed to send song requests in this channel.");
        return;
      }

      const accessLevel = typeof this.config.requestPolicy?.accessLevel === "string"
        ? this.config.requestPolicy.accessLevel
        : "everyone";
      if (!hasRequestAccess(roleState, accessLevel)) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: "access_level_blocked",
          message: requestAccessLabel(accessLevel),
          extraDetails: {
            accessLevel
          },
          bypassRequestLimits
        });
        await this.reply(channel, requestAccessLabel(accessLevel));
        return;
      }

      if (!query) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: "missing_input",
          message: "Usage: provide a YouTube, SoundCloud, Spotify, or Suno link, or a YouTube search query.",
          bypassRequestLimits
        });
        await this.reply(channel, "Usage: provide a YouTube, SoundCloud, Spotify, or Suno link, or a YouTube search query.");
        return;
      }

      const blockedPhrases = normalizeRequestList(this.config.requestPolicy?.blockedPhrases, {
        lowerCase: true
      });
      const normalizedQuery = query.toLowerCase();
      const blockedPhrase = blockedPhrases.find((phrase) => normalizedQuery.includes(phrase));

      if (blockedPhrase) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: "blocked_phrase",
          message: "That request matches a blocked phrase and could not be queued.",
          extraDetails: {
            blockedPhrase
          },
          bypassRequestLimits
        });
        await this.reply(channel, "That request matches a blocked phrase and could not be queued.");
        return;
      }

      const blockedDomains = normalizeRequestList(this.config.requestPolicy?.blockedDomains, {
        lowerCase: true
      }).map((domain) => normalizeBlockedDomain(domain)).filter(Boolean);
      const blockedInputDomain = findBlockedDomainMatch(query, blockedDomains);
      if (blockedInputDomain) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: "blocked_input_domain",
          message: "Direct links from that domain are blocked.",
          extraDetails: {
            blockedDomain: blockedInputDomain
          },
          bypassRequestLimits
        });
        await this.reply(channel, "Direct links from that domain are blocked.");
        return;
      }

      let resolvedTrack;

      try {
        resolvedTrack = await this.songRequestResolver(query, this.config.youtubeApiKey, {
          allowSearchRequests: this.config.requestPolicy?.allowSearchRequests,
          youtubeSafeSearch: this.config.requestPolicy?.youtubeSafeSearch,
          preferYouTubeApiMetadata: true
        });
      } catch (error) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          reason: error?.code ?? "request_resolution_failed",
          message: error?.message ?? "Failed to resolve song request.",
          bypassRequestLimits
        });
        throw error;
      }
      const allowedProviders = Array.isArray(this.config.requestPolicy?.allowedProviders)
        ? normalizeRequestList(this.config.requestPolicy.allowedProviders, {
            lowerCase: true
          })
        : ["youtube", "soundcloud", "spotify", "suno"];
      const requestedProvider = typeof resolvedTrack?.requestedFromProvider === "string" &&
        resolvedTrack.requestedFromProvider.trim()
        ? resolvedTrack.requestedFromProvider.trim().toLowerCase()
        : resolvedTrack.provider;

      if (!allowedProviders.includes(requestedProvider)) {
        const providerBlockedMessage = `${requestedProvider} requests are currently disabled.`;
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          track: resolvedTrack,
          reason: "provider_blocked",
          message: providerBlockedMessage,
          bypassRequestLimits
        });
        await this.reply(channel, providerBlockedMessage);
        return;
      }

      const maxTrackDurationSeconds = normalizeLimit(this.config.requestPolicy?.maxTrackDurationSeconds);
      if (
        maxTrackDurationSeconds > 0 &&
        Number.isFinite(resolvedTrack.durationSeconds) &&
        resolvedTrack.durationSeconds > maxTrackDurationSeconds
      ) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          track: resolvedTrack,
          reason: "track_too_long",
          message: `That track is too long for requests. The limit is ${maxTrackDurationSeconds} seconds.`,
          extraDetails: {
            maxTrackDurationSeconds
          },
          bypassRequestLimits
        });
        await this.reply(
          channel,
          `That track is too long for requests. The limit is ${maxTrackDurationSeconds} seconds.`
        );
        return;
      }

      if (this.config.requestPolicy?.rejectLiveStreams === true && resolvedTrack.isLive) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          track: resolvedTrack,
          reason: "live_stream_blocked",
          message: "Live streams are blocked from song requests right now.",
          bypassRequestLimits
        });
        await this.reply(channel, "Live streams are blocked from song requests right now.");
        return;
      }

      const blockedTrackDomain = findBlockedDomainMatch(resolvedTrack.url, blockedDomains);
      if (blockedTrackDomain) {
        await this.auditRejectedSongRequest({
          tags,
          roleState,
          input: query,
          track: resolvedTrack,
          reason: "blocked_track_domain",
          message: "Direct links from that domain are blocked.",
          extraDetails: {
            blockedDomain: blockedTrackDomain
          },
          bypassRequestLimits
        });
        await this.reply(channel, "Direct links from that domain are blocked.");
        return;
      }

      const blockedYouTubeChannels = normalizeRequestList(
        this.config.requestPolicy?.blockedYouTubeChannelIds,
        {
          lowerCase: true
        }
      );
      if (
        resolvedTrack.provider === "youtube" &&
        blockedYouTubeChannels.length > 0
      ) {
        const sourceCandidates = getYouTubeSourceCandidates(resolvedTrack);
        if (blockedYouTubeChannels.some((blockedChannel) => sourceCandidates.has(blockedChannel))) {
          await this.auditRejectedSongRequest({
            tags,
            roleState,
            input: query,
            track: resolvedTrack,
            reason: "blocked_youtube_channel",
            message: "Requests from that YouTube channel are blocked.",
            bypassRequestLimits
          });
          await this.reply(channel, "Requests from that YouTube channel are blocked.");
          return;
        }
      }

      const blockedSoundCloudUsers = normalizeRequestList(
        this.config.requestPolicy?.blockedSoundCloudUsers,
        {
          lowerCase: true
        }
      );
      if (resolvedTrack.provider === "soundcloud" && blockedSoundCloudUsers.length > 0) {
        const sourceCandidates = getSoundCloudSourceCandidates(resolvedTrack);
        if (blockedSoundCloudUsers.some((blockedUser) => sourceCandidates.has(blockedUser))) {
          await this.auditRejectedSongRequest({
            tags,
            roleState,
            input: query,
            track: resolvedTrack,
            reason: "blocked_soundcloud_user",
            message: "Requests from that SoundCloud account are blocked.",
            bypassRequestLimits
          });
          await this.reply(channel, "Requests from that SoundCloud account are blocked.");
          return;
        }
      }

      const queueTrack = await this.playerController.addRequest({
        ...resolvedTrack,
        requestedBy: this.buildRequestAuditRequester(tags)
      }, {
        bypassRequestLimits,
        requestSource: "twitch_chat",
        requestInput: query,
        requestContext: {
          channel: this.config.twitch.channel,
          command: actionId,
          roleState
        }
      });

      if (queueTrack.duplicateType === "playing") {
        await this.reply(channel, `Song ${formatChatTrackTitle(queueTrack)} is already playing`);
        return;
      }

      if (queueTrack.duplicateType === "history") {
        await this.reply(channel, `Song ${formatChatTrackTitle(queueTrack)} was played recently`);
        return;
      }

      if (queueTrack.alreadyQueued) {
        await this.reply(channel, `Song ${formatChatTrackTitle(queueTrack)} already in the queue`);
        return;
      }

      if (queueTrack.queuedForAutoDj) {
        const placement = queueTrack.autoDjPlacement === "following_transition"
          ? "the AutoDJ mix after next"
          : "the next AutoDJ mix";
        await this.reply(
          channel,
          `Queued for ${placement}: ${formatChatTrackTitle(queueTrack)} (requested by ${queueTrack.requestedBy.displayName || queueTrack.requestedBy.username})`
        );
        return;
      }

      if (queueTrack.autoDjPreparationPending) {
        await this.reply(
          channel,
          `Queued for AutoDJ preparation: ${formatChatTrackTitle(queueTrack)} (Suno download and analysis running; requested by ${queueTrack.requestedBy.displayName || queueTrack.requestedBy.username})`
        );
        return;
      }

      await this.reply(
        channel,
        `Queued: ${formatChatTrackTitle(queueTrack)} (requested by ${queueTrack.requestedBy.displayName || queueTrack.requestedBy.username})`
      );
      return;
    }

    if (actionId === "queue_status") {
      const queueSummary = this.playerController.getQueueSummary(3);
      const currentTrack = this.getCurrentTrackForChat();

      if (!currentTrack && queueSummary.length === 0) {
        await this.reply(channel, "The request queue is empty right now.");
        return;
      }

      const nowPlayingText = currentTrack ? `Now playing: ${formatChatTrackTitle(currentTrack)}. ` : "";
      const queueText = queueSummary.length > 0
        ? `Up next: ${queueSummary.map((track, index) => `${index + 1}. ${formatChatTrackTitle(track)}`).join(" | ")}`
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

      await this.reply(channel, `${formatChatTrackTitle(position.track)} is #${position.position} in the queue.`);
      return;
    }

    if (actionId === "remove_own_request") {
      const removedTrack = await this.playerController.removeQueuedTrackByRequester(tags.username ?? "", tags.username ?? "unknown");

      if (!removedTrack) {
        await this.reply(channel, "You do not have a queued request to remove.");
        return;
      }

      await this.reply(channel, `Removed your queued request: ${formatChatTrackTitle(removedTrack)}`);
      return;
    }

    if (actionId === "skip_current") {
      const triggeredBy = tags.username ?? "unknown";
      const currentTrack = this.playerController.getCurrentTrack();
      const shouldMixLocalTrack = Boolean(
        this.autoDjController?.mixNext &&
        (currentTrack?.provider === "local" || currentTrack?.origin === "local")
      );
      const skippedTrack = shouldMixLocalTrack
        ? await this.autoDjController.mixNext({ triggeredBy, leadSeconds: 5 })
        : await this.playerController.skipToNextTrack(triggeredBy)
          ?? await this.autoDjController?.mixNext?.({ triggeredBy, leadSeconds: 5 });

      if (!skippedTrack) {
        if (this.playerController.isPlaybackAdvancePending?.()) {
          await this.reply(
            channel,
            `${tags["display-name"] ?? tags.username} is already advancing AutoDJ to the next track.`
          );
          return;
        }
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      if (skippedTrack.autoDjMixQueued) {
        await this.reply(channel, `${tags["display-name"] ?? tags.username} is mixing at the next good AutoDJ exit.`);
        return;
      }

      await this.reply(channel, `${tags["display-name"] ?? tags.username} skipped the current song.`);
      return;
    }

    if (actionId === "delete_current") {
      const deletedTrack = await this.playerController.deleteCurrentTrack(tags.username ?? "unknown");

      if (!deletedTrack) {
        await this.reply(channel, "No song is currently playing.");
        return;
      }

      if (deletedTrack.unsupported) {
        await this.reply(channel, "Standalone AutoDJ tracks are read-only here. Use skip; the AutoDJ library was not changed.");
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

      if (result.unsupported) {
        await this.reply(channel, "Local fallback tracks are not added to the saved online playlist.");
        return;
      }

      if (result.alreadySaved) {
        await this.reply(channel, `Already saved: ${formatChatTrackTitle(result.track)}`);
        return;
      }

      await this.reply(channel, `Saved: ${formatChatTrackTitle(result.track)}`);
      return;
    }

    if (actionId === "import_youtube_playlist") {
      if (!query) {
        await this.reply(channel, "Usage: provide a YouTube playlist URL.");
        return;
      }

      const playlistImport = await this.youtubePlaylistResolver(query, this.config.youtubeApiKey);
      const result = await this.playerController.appendTracksToPlaylist(playlistImport.tracks, {
        triggeredBy: tags.username ?? "unknown",
        details: {
          input: query,
          playlistId: playlistImport.playlistId,
          playlistTitle: playlistImport.title,
          requestedCount: playlistImport.trackCount
        }
      });

      if (result.addedCount === 0) {
        await this.reply(
          channel,
          `No new tracks were added from ${playlistImport.title}. ${result.duplicateCount} duplicates skipped.`
        );
        return;
      }

      const duplicateSuffix = result.duplicateCount > 0
        ? ` ${result.duplicateCount} duplicates skipped.`
        : "";
      await this.reply(
        channel,
        `Imported ${result.addedCount} tracks from ${playlistImport.title} into the playlist.${duplicateSuffix}`
      );
      return;
    }

    if (actionId === "current_song") {
      const track = this.getCurrentTrackForChat();

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
      this.playerController.recordAdminEvent?.("open_requests", {
        triggeredBy: tags.username ?? "unknown"
      });
      await this.playerController.persistRuntimeState?.();
      this.playerController.broadcastState?.();
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
      this.playerController.recordAdminEvent?.("close_requests", {
        triggeredBy: tags.username ?? "unknown"
      });
      await this.playerController.persistRuntimeState?.();
      this.playerController.broadcastState?.();
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
    if (this.config.twitch.sharedChatForSourceOnly === true) {
      try {
        await this.chatApi.sendMessage({
          channelName: this.config.twitch.channel,
          senderLogin: this.config.twitch.username,
          clientId: this.config.twitch.clientId,
          clientSecret: this.config.twitch.clientSecret,
          message: safeMessage,
          forSourceOnly: true
        });
        return;
      } catch (error) {
        logWarn("Could not send Twitch source-only chat message; falling back to IRC", {
          channel: this.config.twitch.channel,
          message: error?.message ?? String(error)
        });
      }
    }

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

  async announcePlaybackFailure({ track, status, reason = "", message = "" } = {}) {
    if (!track || track.origin !== "queue" || status !== "error") {
      return;
    }

    const requester = track.requestedBy?.displayName || track.requestedBy?.username;
    const requesterText = requester ? ` (requested by ${requester})` : "";
    const failureReason = formatPlaybackFailureReason({ reason, message });

    logWarn("Announcing skipped song playback failure in chat", {
      title: track.title,
      reason,
      message,
      requester: requester || null
    });

    await this.reply(
      `#${this.config.twitch.channel}`,
      `Skipped ${formatChatTrackTitle(track)}${requesterText}: ${failureReason}`
    );
  }

  formatCurrentSongMessage(track) {
    const requester = track.requestedBy?.displayName || track.requestedBy?.username;
    const requesterText = requester ? `, requested by ${requester}` : "";

    const urlText = track.url ? ` ${track.url}` : "";
    return `Current song: ${formatChatTrackTitle(track)}${urlText}${requesterText}`;
  }
}
