// @ts-nocheck
import { stripOauthPrefix } from "./twitch-auth.js";

const TWITCH_AUTH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_URL = "https://api.twitch.tv/helix";

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

function normalizeLogin(value) {
  return String(value ?? "").trim().replace(/^#/, "").toLowerCase();
}

function buildError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

export class TwitchChatApi {
  constructor({ fetchImpl = fetch, tokenExpiryBufferMs = 60_000 } = {}) {
    this.fetch = fetchImpl;
    this.tokenExpiryBufferMs = tokenExpiryBufferMs;
    this.appToken = "";
    this.appTokenExpiresAt = 0;
    this.appTokenClientId = "";
    this.userIdCache = new Map();
  }

  async sendMessage({
    channelName,
    senderLogin,
    clientId,
    clientSecret,
    message,
    forSourceOnly
  }) {
    if (!clientId) {
      throw new Error("Missing Twitch Client ID for source-only Shared Chat messages.");
    }

    if (!clientSecret) {
      throw new Error("Missing Twitch Client Secret for source-only Shared Chat messages.");
    }

    const appAccessToken = await this.getAppAccessToken({ clientId, clientSecret });
    const [broadcasterId, senderId] = await Promise.all([
      this.resolveUserId({ login: channelName, clientId, accessToken: appAccessToken }),
      this.resolveUserId({ login: senderLogin, clientId, accessToken: appAccessToken })
    ]);
    const body = {
      broadcaster_id: broadcasterId,
      sender_id: senderId,
      message,
      for_source_only: forSourceOnly === true
    };
    const response = await this.fetch(`${TWITCH_HELIX_URL}/chat/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
        "Client-Id": clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw buildError(`Twitch Send Chat Message API ${response.status}: ${payload.message ?? response.statusText}`, {
        status: response.status,
        payload
      });
    }

    const result = payload?.data?.[0];
    if (result?.is_sent === false) {
      throw buildError(result.drop_reason?.message ?? "Twitch dropped the chat message.", {
        code: result.drop_reason?.code ?? "",
        payload
      });
    }

    return payload;
  }

  async getAppAccessToken({ clientId, clientSecret }) {
    const now = Date.now();
    if (
      this.appToken &&
      this.appTokenClientId === clientId &&
      now + this.tokenExpiryBufferMs < this.appTokenExpiresAt
    ) {
      return this.appToken;
    }

    const response = await this.fetch(TWITCH_AUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      })
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw buildError(`Twitch app token request failed: ${payload.message ?? payload.error ?? response.statusText}`, {
        status: response.status,
        payload
      });
    }

    this.appToken = stripOauthPrefix(payload.access_token ?? "");
    this.appTokenClientId = clientId;
    this.appTokenExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in ?? 0)) * 1000;

    if (!this.appToken) {
      throw new Error("Twitch app token response did not include an access token.");
    }

    return this.appToken;
  }

  async resolveUserId({ login, clientId, accessToken }) {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin) {
      throw new Error("Missing Twitch user login for source-only Shared Chat messages.");
    }

    const cacheKey = `${clientId}:${normalizedLogin}`;
    const cachedUserId = this.userIdCache.get(cacheKey);
    if (cachedUserId) {
      return cachedUserId;
    }

    const response = await this.fetch(
      `${TWITCH_HELIX_URL}/users?login=${encodeURIComponent(normalizedLogin)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": clientId
        }
      }
    );
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw buildError(`Twitch user lookup failed: ${payload.message ?? response.statusText}`, {
        status: response.status,
        payload
      });
    }

    const userId = payload?.data?.[0]?.id ?? "";
    if (!userId) {
      throw new Error(`Twitch user "${normalizedLogin}" was not found.`);
    }

    this.userIdCache.set(cacheKey, userId);
    return userId;
  }
}
