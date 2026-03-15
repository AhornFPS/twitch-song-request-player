import { logInfo, logWarn } from "./logger.js";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_URL = "https://api.twitch.tv/helix";
const DEFAULT_SUPPRESSED_CATEGORIES = new Set(["music", "djs"]);

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
    clientSecret,
    cacheTtlMs = 120000,
    suppressedCategories = DEFAULT_SUPPRESSED_CATEGORIES
  }) {
    this.channelName = channelName;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.cacheTtlMs = cacheTtlMs;
    this.suppressedCategories = new Set(
      Array.from(suppressedCategories, (value) => value.trim().toLowerCase())
    );
    this.accessToken = "";
    this.accessTokenExpiresAt = 0;
    this.broadcasterId = "";
    this.lastCategoryName = "";
    this.lastSuppressedValue = false;
    this.lastRefreshAt = 0;
    this.refreshPromise = null;
    this.supportLogged = false;
  }

  isConfigured() {
    return Boolean(this.channelName && this.clientId && this.clientSecret);
  }

  logConfigurationState() {
    if (this.supportLogged) {
      return;
    }

    this.supportLogged = true;

    if (this.isConfigured()) {
      logInfo("Twitch category-aware chat suppression enabled", {
        channel: this.channelName,
        suppressedCategories: Array.from(this.suppressedCategories)
      });
      return;
    }

    logWarn("Twitch category-aware chat suppression disabled", {
      reason: "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET"
    });
  }

  async shouldSuppressChatMessages() {
    this.logConfigurationState();

    if (!this.isConfigured()) {
      return false;
    }

    const now = Date.now();
    if (this.lastRefreshAt && now - this.lastRefreshAt < this.cacheTtlMs) {
      return this.lastSuppressedValue;
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
      const shouldSuppress = this.suppressedCategories.has(normalizedCategory);

      this.lastCategoryName = categoryName;
      this.lastSuppressedValue = shouldSuppress;
      this.lastRefreshAt = Date.now();

      logInfo("Resolved Twitch channel category", {
        channel: this.channelName,
        category: categoryName || null,
        suppressChatMessages: shouldSuppress
      });

      return shouldSuppress;
    } catch (error) {
      logWarn("Could not resolve Twitch channel category", {
        channel: this.channelName,
        message: error?.message ?? String(error)
      });
      return false;
    }
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
    const token = await this.ensureAccessToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId
      }
    });

    if (response.status === 401 && allowRetry) {
      this.accessToken = "";
      this.accessTokenExpiresAt = 0;
      return this.fetchHelix(url, { allowRetry: false });
    }

    if (!response.ok) {
      const body = await parseJsonResponse(response);
      throw new Error(`Twitch API ${response.status}: ${body.message ?? response.statusText}`);
    }

    return parseJsonResponse(response);
  }

  async ensureAccessToken() {
    const refreshBufferMs = 60_000;
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - refreshBufferMs) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials"
    });

    const response = await fetch(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok || !payload.access_token) {
      throw new Error(`Token request failed: ${payload.message ?? response.statusText}`);
    }

    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = Date.now() + Number(payload.expires_in ?? 0) * 1000;
    return this.accessToken;
  }
}
