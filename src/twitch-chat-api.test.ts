// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { TwitchChatApi } from "./twitch-chat-api.js";

test("TwitchChatApi sends for_source_only with an app access token", async () => {
  const requests = [];
  const api = new TwitchChatApi({
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url: String(url),
        options
      });

      if (String(url) === "https://id.twitch.tv/oauth2/token") {
        return new Response(JSON.stringify({
          access_token: "app-token",
          expires_in: 3600,
          token_type: "bearer"
        }), {
          status: 200
        });
      }

      if (String(url).endsWith("/users?login=streamer")) {
        return new Response(JSON.stringify({
          data: [
            {
              id: "broadcaster-123"
            }
          ]
        }), {
          status: 200
        });
      }

      if (String(url).endsWith("/users?login=botuser")) {
        return new Response(JSON.stringify({
          data: [
            {
              id: "sender-456"
            }
          ]
        }), {
          status: 200
        });
      }

      if (String(url) === "https://api.twitch.tv/helix/chat/messages") {
        return new Response(JSON.stringify({
          data: [
            {
              message_id: "message-789",
              is_sent: true
            }
          ]
        }), {
          status: 200
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }
  });

  await api.sendMessage({
    channelName: "#Streamer",
    senderLogin: "BotUser",
    clientId: "client-123",
    clientSecret: "secret-123",
    message: "Hello chat",
    forSourceOnly: true
  });

  const chatRequest = requests.find((request) => request.url === "https://api.twitch.tv/helix/chat/messages");
  assert.equal(chatRequest.options.headers.Authorization, "Bearer app-token");
  assert.equal(chatRequest.options.headers["Client-Id"], "client-123");
  assert.deepEqual(JSON.parse(chatRequest.options.body), {
    broadcaster_id: "broadcaster-123",
    sender_id: "sender-456",
    message: "Hello chat",
    for_source_only: true
  });
});
