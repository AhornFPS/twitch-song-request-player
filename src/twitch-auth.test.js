import assert from "node:assert/strict";
import test from "node:test";
import { TwitchAuthManager, toOauthToken } from "./twitch-auth.js";

test("ensureValidUserToken refreshes an expired token and returns the validated Twitch login", async (t) => {
  const originalFetch = global.fetch;
  const authManager = new TwitchAuthManager();

  global.fetch = async (url, options = {}) => {
    if (url === "https://id.twitch.tv/oauth2/validate") {
      const authHeader = options.headers?.Authorization ?? "";

      if (authHeader === "OAuth expired-token") {
        return new Response(JSON.stringify({
          status: 401,
          message: "invalid access token"
        }), {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }

      if (authHeader === "OAuth fresh-token") {
        return new Response(JSON.stringify({
          client_id: "client-123",
          login: "bot_account",
          user_id: "user-123",
          scopes: ["chat:read", "chat:edit"],
          expires_in: 3600
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
    }

    if (url === "https://id.twitch.tv/oauth2/token") {
      return new Response(JSON.stringify({
        access_token: "fresh-token",
        refresh_token: "fresh-refresh-token",
        scope: ["chat:read", "chat:edit"],
        expires_in: 3600,
        token_type: "bearer"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await authManager.ensureValidUserToken({
    clientId: "client-123",
    oauthToken: toOauthToken("expired-token"),
    refreshToken: "refresh-token"
  });

  assert.deepEqual(result, {
    oauthToken: "oauth:fresh-token",
    refreshToken: "fresh-refresh-token",
    clientId: "client-123",
    login: "bot_account",
    userId: "user-123",
    scopes: ["chat:read", "chat:edit"],
    expiresIn: 3600
  });
});
