// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { startAppServer } from "./app-server.js";
import { createConfigStore } from "./config.js";
import { checkYouTubeApiKey } from "./youtube-api-check.js";

const accepted = () => Response.json({ kind: "youtube#videoListResponse", items: [] });
const rejected = (reason, status = 403, details = false, message = "private-key must never be echoed") => Response.json({
  error: { message, [details ? "details" : "errors"]: [{ reason }] }
}, { status });

test("empty and malformed keys do not make a Google request", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return accepted(); };
  for (const key of ["", "   "]) {
    assert.equal((await checkYouTubeApiKey(key, { fetchImpl })).status, "missing");
  }
  for (const key of ['"private-key"', "private key", "key=private-key", "https://example.com", "x".repeat(257)]) {
    assert.equal((await checkYouTubeApiKey(key, { fetchImpl })).status, "malformed");
  }
  assert.equal(calls, 0);
});

test("the check trims the key and makes one metadata request without requiring a returned video", async () => {
  let calls = 0;
  const check = await checkYouTubeApiKey("  private-key  ", { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(url.pathname, "/youtube/v3/videos");
    assert.equal(url.searchParams.get("key"), "private-key");
    assert.equal(url.searchParams.get("part"), "id");
    assert.ok(url.searchParams.get("id"));
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.redirect, "error");
    return accepted();
  } });
  assert.equal(calls, 1);
  assert.equal(check.status, "valid");
  assert.equal(JSON.stringify(check).includes("private-key"), false);
});

for (const [reason, expected, hint] of [
  ["keyInvalid", "invalid", /active API key/],
  ["API_KEY_INVALID", "invalid", /active API key/],
  ["API_KEY_EXPIRED", "invalid", /active API key/],
  ["accessNotConfigured", "api_disabled", /Enable it/],
  ["SERVICE_DISABLED", "api_disabled", /Enable it/],
  ["API_KEY_HTTP_REFERRER_BLOCKED", "referrer_blocked", /without a website referrer/],
  ["API_KEY_IP_ADDRESS_BLOCKED", "ip_blocked", /public outbound IP/],
  ["API_KEY_SERVICE_BLOCKED", "api_blocked", /Allow YouTube Data API v3/],
  ["API_KEY_ANDROID_APP_BLOCKED", "app_blocked", /mobile app/],
  ["API_KEY_IOS_APP_BLOCKED", "app_blocked", /mobile app/],
  ["quotaExceeded", "quota_exceeded", /does not mean the key is invalid/],
  ["dailyLimitExceeded", "quota_exceeded", /quota resets/],
  ["rateLimitExceeded", "rate_limited", /Wait and try again/],
  ["forbidden", "forbidden", /API and application restrictions/]
]) {
  test(`Google ${reason} errors explain the problem without returning secrets`, async () => {
    for (const details of [false, true]) {
      const check = await checkYouTubeApiKey("private-key", { fetchImpl: async () => rejected(reason, 403, details) });
      assert.equal(check.status, expected);
      assert.match(check.message, hint);
      assert.equal(JSON.stringify(check).includes("private-key"), false);
    }
  });
}

test("legacy error messages are classified, while unknown and malformed replies remain inconclusive", async () => {
  for (const [response, expected] of [
    [rejected("badRequest", 400, false, "API key not valid. Please pass a valid API key."), "invalid"],
    [rejected("forbidden", 403, false, "Requests from referer <empty> are blocked."), "referrer_blocked"],
    [rejected("unknown", 429), "rate_limited"],
    [rejected("unknown", 500), "service_error"],
    [new Response("private-key upstream error", { status: 503 }), "service_error"],
    [Response.json({}), "service_error"],
    [Response.json({ kind: "youtube#videoListResponse", items: null }), "service_error"],
    [Response.json({ error: { errors: "bad", details: null } }), "service_error"]
  ]) {
    const check = await checkYouTubeApiKey("private-key", { fetchImpl: async () => response });
    assert.equal(check.status, expected);
    assert.equal(JSON.stringify(check).includes("private-key"), false);
  }
});

test("network failure and a deadline during headers or body reading do not condemn the key", async () => {
  const network = await checkYouTubeApiKey("private-key", { fetchImpl: async () => {
    throw new Error("Could not fetch https://example.invalid/?key=private-key");
  } });
  assert.equal(network.status, "network_error");
  assert.equal(JSON.stringify(network).includes("private-key"), false);
  // Keep a handle alive because AbortSignal.timeout uses an unref'ed timer in Node.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    for (const duringBody of [false, true]) {
      const check = await checkYouTubeApiKey("private-key", { timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
        const hang = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
        return duringBody ? { ok: true, status: 200, json: hang } : hang();
      } });
      assert.equal(check.status, "timeout");
      assert.match(check.message, /validity could not be confirmed/);
    }
  } finally {
    clearInterval(keepAlive);
  }
});

test("HTTP checking uses the draft or saved key without changing settings, library, or playback", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-api-check-"));
  const originalFetch = global.fetch;
  let appServer;
  t.after(async () => {
    await appServer?.close();
    global.fetch = originalFetch;
    await fs.rm(runtimeDir, { recursive: true, force: true, maxRetries: 5 });
  });
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await fs.writeFile(path.join(runtimeDir, "playlist.csv"), "Link,Title\n");
  await fs.writeFile(path.join(runtimeDir, "settings.json"), JSON.stringify({ port, youtubeApiKey: "saved-key" }));
  const configStore = createConfigStore({ rootDir: runtimeDir, runtimeDir, publicDir: path.resolve("public") });
  configStore.loadEnvSettings = () => ({});
  const checkedKeys = [];
  global.fetch = async (url) => {
    const target = new URL(url);
    assert.equal(target.origin, "https://www.googleapis.com", "No external services should start in this test.");
    checkedKeys.push(target.searchParams.get("key"));
    return target.searchParams.get("key") === "rejected-key" ? rejected("API_KEY_INVALID", 400, true) : accepted();
  };
  appServer = await startAppServer({ noBrowser: true, configStore });
  const read = async route => (await originalFetch(new URL(route, appServer.urls.dashboardUrl))).json();
  const settingsBefore = await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8");
  const libraryBefore = await fs.readFile(path.join(runtimeDir, "playlist.csv"), "utf8");
  const stateBefore = await read("/api/state");
  for (const [body, expectedStatus, expectedResult] of [
    [{ youtubeApiKey: "  draft-key  " }, 200, "valid"],
    [{}, 200, "valid"],
    [{ youtubeApiKey: "" }, 200, "missing"],
    [{ youtubeApiKey: "rejected-key" }, 200, "invalid"],
    [{ youtubeApiKey: { key: "nested-key" } }, 400, undefined],
    [{ youtubeApiKey: null }, 400, undefined]
  ]) {
    const response = await originalFetch(new URL("/api/settings/youtube/check", appServer.urls.dashboardUrl), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).status, expectedResult);
  }
  assert.deepEqual(checkedKeys, ["draft-key", "saved-key", "rejected-key"]);
  assert.equal(await fs.readFile(path.join(runtimeDir, "settings.json"), "utf8"), settingsBefore);
  assert.equal(await fs.readFile(path.join(runtimeDir, "playlist.csv"), "utf8"), libraryBefore);
  assert.deepEqual(await read("/api/state"), stateBefore);
});

const dashboardSource = await fs.readFile(new URL("../client/dashboard.ts", import.meta.url), "utf8");
function dashboardCheck(fetchJson) {
  const button = { disabled: false, textContent: "Check API key" };
  const input = { value: "draft-key" };
  const feedback = { textContent: "", className: "" };
  const context = vm.createContext({
    AbortController, window: { setTimeout, clearTimeout }, fetchJson,
    youtubeApiCheckController: null, settingsPayload: { settings: { youtubeApiKey: "saved-key" } },
    el: id => ({ "youtube-api-check": button, youtubeApiKey: input, "youtube-api-feedback": feedback })[id]
  });
  const start = dashboardSource.indexOf("function setYouTubeApiFeedback(");
  const end = dashboardSource.indexOf("async function persistSettings(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(dashboardSource.slice(start, end), context);
  return { context, button, input, feedback };
}

test("editing during a check cancels it and a late old response cannot overwrite the new result", async () => {
  const requests = [];
  const { context, button, input, feedback } = dashboardCheck((url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  const first = context.checkEnteredYouTubeApiKey();
  assert.equal(button.disabled, true);
  await context.checkEnteredYouTubeApiKey();
  assert.equal(requests.length, 1, "Repeated clicks should not consume more quota.");
  assert.equal(requests[0].url, "/api/settings/youtube/check");
  assert.deepEqual(JSON.parse(requests[0].options.body), { youtubeApiKey: "draft-key" });
  input.value = "new-key";
  context.resetYouTubeApiCheck();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(button.disabled, false);
  assert.match(feedback.textContent, /Not checked/);
  const second = context.checkEnteredYouTubeApiKey();
  requests[1].resolve({ status: "valid", message: "Key accepted." });
  await second;
  assert.match(feedback.textContent, /Key accepted/);
  requests[0].resolve({ status: "invalid", message: "Old rejection" });
  await first;
  assert.match(feedback.textContent, /Key accepted/);
  assert.equal(feedback.className, "feedback is-success");
  assert.equal(button.disabled, false);
});

test("a lost dashboard connection leaves the result unknown and enables retry without exposing errors", async () => {
  const { context, button, feedback } = dashboardCheck(async () => { throw new Error("private-key"); });
  await context.checkEnteredYouTubeApiKey();
  assert.match(feedback.textContent, /validity is unknown/);
  assert.equal(feedback.textContent.includes("private-key"), false);
  assert.equal(button.disabled, false);
});
