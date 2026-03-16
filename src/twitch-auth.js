const TWITCH_AUTH_BASE_URL = "https://id.twitch.tv/oauth2";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";

export const TWITCH_BOT_SCOPES = ["chat:read", "chat:edit"];

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

function buildError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

export function stripOauthPrefix(token) {
  const trimmed = typeof token === "string" ? token.trim() : "";
  return trimmed.replace(/^oauth:/i, "");
}

export function toOauthToken(token) {
  const trimmed = stripOauthPrefix(token);
  return trimmed ? `oauth:${trimmed}` : "";
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw buildError(payload.message ?? payload.error ?? response.statusText, {
      status: response.status,
      code: payload.message ?? payload.error ?? "",
      payload
    });
  }

  return payload;
}

export class TwitchAuthManager {
  async requestDeviceCode({ clientId, scopes = TWITCH_BOT_SCOPES }) {
    const payload = await postForm(`${TWITCH_AUTH_BASE_URL}/device`, {
      client_id: clientId,
      scopes: scopes.join(" ")
    });

    return {
      deviceCode: payload.device_code ?? "",
      userCode: payload.user_code ?? "",
      verificationUri: payload.verification_uri ?? "",
      verificationUriComplete: payload.verification_uri_complete ?? "",
      expiresIn: Number(payload.expires_in ?? 0),
      intervalSeconds: Number(payload.interval ?? 5)
    };
  }

  async exchangeDeviceCode({ clientId, deviceCode, scopes = TWITCH_BOT_SCOPES }) {
    const payload = await postForm(`${TWITCH_AUTH_BASE_URL}/token`, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      scopes: scopes.join(" ")
    });

    return {
      oauthToken: toOauthToken(payload.access_token ?? ""),
      refreshToken: payload.refresh_token ?? "",
      expiresIn: Number(payload.expires_in ?? 0),
      scopes: Array.isArray(payload.scope) ? payload.scope : []
    };
  }

  async refreshUserToken({ clientId, clientSecret = "", refreshToken }) {
    const requestBody = {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    };

    if (clientSecret) {
      requestBody.client_secret = clientSecret;
    }

    const payload = await postForm(`${TWITCH_AUTH_BASE_URL}/token`, requestBody);

    return {
      oauthToken: toOauthToken(payload.access_token ?? ""),
      refreshToken: payload.refresh_token ?? refreshToken,
      expiresIn: Number(payload.expires_in ?? 0),
      scopes: Array.isArray(payload.scope) ? payload.scope : []
    };
  }

  async validateAccessToken(oauthToken) {
    const accessToken = stripOauthPrefix(oauthToken);

    if (!accessToken) {
      return null;
    }

    const response = await fetch(TWITCH_VALIDATE_URL, {
      headers: {
        Authorization: `OAuth ${accessToken}`
      }
    });

    if (response.status === 401) {
      return null;
    }

    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw buildError(payload.message ?? response.statusText, {
        status: response.status,
        payload
      });
    }

    return {
      clientId: payload.client_id ?? "",
      login: payload.login ?? "",
      userId: payload.user_id ?? "",
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
      expiresIn: Number(payload.expires_in ?? 0)
    };
  }

  async ensureValidUserToken({
    clientId = "",
    clientSecret = "",
    oauthToken = "",
    refreshToken = ""
  }) {
    const validatedToken = await this.validateAccessToken(oauthToken);

    if (validatedToken) {
      return {
        oauthToken: toOauthToken(oauthToken),
        refreshToken,
        ...validatedToken
      };
    }

    if (!clientId || !refreshToken) {
      return null;
    }

    const refreshedToken = await this.refreshUserToken({
      clientId,
      clientSecret,
      refreshToken
    });
    const refreshedValidation = await this.validateAccessToken(refreshedToken.oauthToken);

    if (!refreshedValidation) {
      return null;
    }

    return {
      oauthToken: refreshedToken.oauthToken,
      refreshToken: refreshedToken.refreshToken,
      ...refreshedValidation
    };
  }
}
