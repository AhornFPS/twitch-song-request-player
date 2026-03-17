import assert from "node:assert/strict";
import test from "node:test";
import { TwitchChannelInfo } from "./twitch-channel-info.js";

test("category suppression uses the bot user token without requiring a client secret", async (t) => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    requests.push({
      url,
      authorization: options.headers?.Authorization ?? "",
      clientId: options.headers?.["Client-Id"] ?? ""
    });

    if (String(url).includes("/users?login=")) {
      return new Response(JSON.stringify({
        data: [
          {
            id: "1234"
          }
        ]
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (String(url).includes("/channels?broadcaster_id=")) {
      return new Response(JSON.stringify({
        data: [
          {
            game_name: "Music"
          }
        ]
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

  const channelInfo = new TwitchChannelInfo({
    channelName: "ahorn",
    clientId: "client-123",
    oauthToken: "oauth:user-token-123",
    chatSuppressedCategories: ["Music"],
    playbackSuppressedCategories: ["Just Chatting"]
  });

  const state = await channelInfo.getCategorySuppressionState();

  assert.equal(state.suppressChatMessages, true);
  assert.equal(state.suppressMusicPlayback, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].authorization, "Bearer user-token-123");
  assert.equal(requests[0].clientId, "client-123");
  assert.equal(requests[1].authorization, "Bearer user-token-123");
  assert.equal(channelInfo.lastCategoryName, "Music");
  assert.equal(channelInfo.getStatus().state, "ok");
  assert.equal(channelInfo.getStatus().categoryName, "Music");
});

test("category lookup status reports oauth errors separately", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async () => new Response(JSON.stringify({
    message: "Invalid OAuth token"
  }), {
    status: 401,
    headers: {
      "Content-Type": "application/json"
    }
  });

  t.after(() => {
    global.fetch = originalFetch;
  });

  const channelInfo = new TwitchChannelInfo({
    channelName: "ahorn",
    clientId: "client-123",
    oauthToken: "oauth:expired-token",
    chatSuppressedCategories: ["Music"]
  });

  const state = await channelInfo.getCategorySuppressionState();

  assert.equal(state.suppressChatMessages, false);
  assert.equal(channelInfo.getStatus().state, "oauth_error");
});
