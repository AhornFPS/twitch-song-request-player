// @ts-nocheck
import { logInfo, logWarn } from "./logger.js";
import { stripOauthPrefix } from "./twitch-auth.js";

const TWITCH_HELIX_URL = "https://api.twitch.tv/helix";
const DEFAULT_CHAT_SUPPRESSED_CATEGORIES = new Set(["music", "djs"]);
const DEFAULT_PLAYBACK_SUPPRESSED_CATEGORIES = new Set();

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class TwitchChannelInfo {
  constructor({
    channelName,
    clientId,
    oauthToken,
    cacheTtlMs = 120000,
    chatSuppressedCategories = DEFAULT_CHAT_SUPPRESSED_CATEGORIES,
    playbackSuppressedCategories = DEFAULT_PLAYBACK_SUPPRESSED_CATEGORIES
  }) {
    this.channelName = channelName;
    this.clientId = clientId;
    this.oauthToken = oauthToken;
    this.cacheTtlMs = cacheTtlMs;
    this.chatSuppressedCategories = new Set(
      Array.from(chatSuppressedCategories, (value) => value.trim().toLowerCase())
    );
    this.playbackSuppressedCategories = new Set(
      Array.from(playbackSuppressedCategories, (value) => value.trim().toLowerCase())
    );
    this.broadcasterId = "";
    this.lastCategoryName = "";
    this.lastChatSuppressedValue = false;
    this.lastPlaybackSuppressedValue = false;
    this.lastRefreshAt = 0;
    this.refreshPromise = null;
    this.supportLogged = false;
    this.lookupStatus = {
      state: "idle",
      message: "Category lookup has not run yet.",
      categoryName: "",
      lastResolvedAt: null
    };
  }

  isConfigured() {
    return Boolean(this.channelName && this.clientId && this.oauthToken);
  }

  logConfigurationState() {
    if (this.supportLogged) {
      return;
    }

    this.supportLogged = true;

    if (this.isConfigured()) {
      if (this.lookupStatus.state === "idle") {
        this.lookupStatus = {
          state: "checking",
          message: "Checking Twitch category access...",
          categoryName: this.lastCategoryName,
          lastResolvedAt: this.lookupStatus.lastResolvedAt
        };
      }
      logInfo("Twitch category-aware chat suppression enabled", {
        channel: this.channelName,
        chatSuppressedCategories: Array.from(this.chatSuppressedCategories),
        playbackSuppressedCategories: Array.from(this.playbackSuppressedCategories)
      });
      return;
    }

    this.lookupStatus = {
      state: "disabled",
      message: "Category lookup needs a Twitch Client ID and valid bot token.",
      categoryName: this.lastCategoryName,
      lastResolvedAt: this.lookupStatus.lastResolvedAt
    };
    logWarn("Twitch category-aware chat suppression disabled", {
      reason: "Missing TWITCH_CLIENT_ID or Twitch bot OAuth token"
    });
  }

  getStatus() {
    return {
      ...this.lookupStatus,
      categoryName: this.lastCategoryName || this.lookupStatus.categoryName || ""
    };
  }

  async shouldSuppressChatMessages() {
    const state = await this.getCategorySuppressionState();
    return state.suppressChatMessages;
  }

  async shouldSuppressMusicPlayback() {
    const state = await this.getCategorySuppressionState();
    return state.suppressMusicPlayback;
  }

  async getCategorySuppressionState() {
    this.logConfigurationState();

    if (!this.isConfigured() || !this.hasSuppressionCategories()) {
      if (!this.hasSuppressionCategories()) {
        this.lookupStatus = {
          state: "disabled",
          message: "Category lookup is idle because no category rules are configured.",
          categoryName: this.lastCategoryName,
          lastResolvedAt: this.lookupStatus.lastResolvedAt
        };
      }

      return {
        categoryName: this.lastCategoryName,
        suppressChatMessages: false,
        suppressMusicPlayback: false
      };
    }

    const now = Date.now();
    if (this.lastRefreshAt && now - this.lastRefreshAt < this.cacheTtlMs) {
      return {
        categoryName: this.lastCategoryName,
        suppressChatMessages: this.lastChatSuppressedValue,
        suppressMusicPlayback: this.lastPlaybackSuppressedValue
      };
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshCategoryState().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  async refreshCategoryState() {
    try {
      const categoryName = await this.fetchChannelCategoryName();
      const normalizedCategory = categoryName.trim().toLowerCase();
      const shouldSuppressChatMessages = this.chatSuppressedCategories.has(normalizedCategory);
      const shouldSuppressMusicPlayback = this.playbackSuppressedCategories.has(normalizedCategory);

      this.lastCategoryName = categoryName;
      this.lastChatSuppressedValue = shouldSuppressChatMessages;
      this.lastPlaybackSuppressedValue = shouldSuppressMusicPlayback;
      this.lastRefreshAt = Date.now();
      this.lookupStatus = {
        state: "ok",
        message: categoryName
          ? `Reading Twitch category ${categoryName}.`
          : "Connected to Twitch category lookup.",
        categoryName,
        lastResolvedAt: new Date(this.lastRefreshAt).toISOString()
      };

      logInfo("Resolved Twitch channel category", {
        channel: this.channelName,
        category: categoryName || null,
        suppressChatMessages: shouldSuppressChatMessages,
        suppressMusicPlayback: shouldSuppressMusicPlayback
      });

      return {
        categoryName,
        suppressChatMessages: shouldSuppressChatMessages,
        suppressMusicPlayback: shouldSuppressMusicPlayback
      };
    } catch (error) {
      const message = error?.message ?? String(error);
      this.lookupStatus = {
        state: message.includes("invalid or expired")
          ? "oauth_error"
          : "error",
        message,
        categoryName: this.lastCategoryName,
        lastResolvedAt: this.lookupStatus.lastResolvedAt
      };
      logWarn("Could not resolve Twitch channel category", {
        channel: this.channelName,
        message
      });
      return {
        categoryName: this.lastCategoryName,
        suppressChatMessages: false,
        suppressMusicPlayback: false
      };
    }
  }

  hasSuppressionCategories() {
    return this.chatSuppressedCategories.size > 0 || this.playbackSuppressedCategories.size > 0;
  }

  async fetchChannelCategoryName() {
    await this.ensureBroadcasterId();
    const response = await this.fetchHelix(
      `${TWITCH_HELIX_URL}/channels?broadcaster_id=${encodeURIComponent(this.broadcasterId)}`
    );
    const channel = response?.data?.[0];

    if (!channel) {
      throw new Error(`Twitch channel "${this.channelName}" was not found.`);
    }

    return channel.game_name ?? "";
  }

  async ensureBroadcasterId() {
    if (this.broadcasterId) {
      return;
    }

    const response = await this.fetchHelix(
      `${TWITCH_HELIX_URL}/users?login=${encodeURIComponent(this.channelName)}`
    );
    const user = response?.data?.[0];

    if (!user?.id) {
      throw new Error(`Twitch user "${this.channelName}" was not found.`);
    }

    this.broadcasterId = user.id;
  }

  async fetchHelix(url, { allowRetry = true } = {}) {
    const token = this.getAccessToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId
      }
    });

    if (response.status === 401 && allowRetry) {
      throw new Error("The Twitch bot OAuth token is invalid or expired.");
    }

    if (!response.ok) {
      const body = await parseJsonResponse(response);
      throw new Error(`Twitch API ${response.status}: ${body.message ?? response.statusText}`);
    }

    return parseJsonResponse(response);
  }

  getAccessToken() {
    const accessToken = stripOauthPrefix(this.oauthToken);

    if (!accessToken) {
      throw new Error("Missing Twitch bot OAuth token.");
    }

    return accessToken;
  }
}
