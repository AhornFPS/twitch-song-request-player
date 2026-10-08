// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../client/dashboard.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("dashboard.ts", source, ts.ScriptTarget.Latest, true);
function functions(...names) {
  return names.map(name => {
    const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(declaration, name);
    return declaration.getText(parsed);
  }).join("\n");
}

function harness() {
  let draft = {
    radio: { setting: "radioTrackCount", value: "3" },
    requests: { setting: "requestPolicy", value: "0" },
    token: { setting: "twitchOauthToken", value: "" },
    categories: { setting: "chatSuppressedCategories", value: ["Music"] }
  };
  const context = vm.createContext({
    savedSettingsDraft: structuredClone(draft),
    captureSettingsDraft: () => structuredClone(draft),
    fetchJson: async () => ({ settings: {} })
  });
  vm.runInContext(functions("pendingSettingsDraft", "persistSettings"), context);
  return { context, draft };
}

test("settings drafts track toggles, empty numbers, credentials, categories and reverted edits", () => {
  const { context, draft } = harness();
  assert.equal(Object.keys(context.pendingSettingsDraft()).length, 0);
  draft.radio.value = "";
  draft.token.value = "fixture-token";
  draft.categories.value.push("Preview");
  draft.toggle = { setting: "radioModeEnabled", value: false };
  assert.deepEqual(Object.keys(context.pendingSettingsDraft()).sort(), ["categories", "radio", "toggle", "token"]);
  draft.radio.value = "3";
  assert.equal(Object.hasOwn(context.pendingSettingsDraft(), "radio"), false);
});

test("request autosave acknowledges only request controls, preserving settings and category drafts", async () => {
  const { context, draft } = harness();
  draft.radio.value = "5";
  draft.requests.value = "10";
  draft.categories.value.push("Preview");
  await context.persistSettings({ requestPolicy: { maxQueueLength: 10 } });
  assert.deepEqual(Object.keys(context.pendingSettingsDraft()).sort(), ["categories", "radio"]);
  await context.persistSettings({ theme: "sunset" });
  assert.deepEqual(Object.keys(context.pendingSettingsDraft()).sort(), ["categories", "radio"]);
});

test("a successful save leaves newer in-flight edits pending", async () => {
  const { context, draft } = harness();
  let resolve;
  context.fetchJson = () => new Promise(done => resolve = done);
  draft.radio.value = "5";
  const saving = context.persistSettings({ radioTrackCount: 5 });
  draft.radio.value = "7";
  resolve({ settings: { radioTrackCount: 5 } });
  await saving;
  assert.equal(context.savedSettingsDraft.radio.value, "5");
  assert.equal(context.pendingSettingsDraft().radio.value, "7");
});

test("a rejected save retains all drafts and allows a later retry", async () => {
  const { context, draft } = harness();
  draft.radio.value = "5";
  context.fetchJson = async () => { throw new Error("offline"); };
  await assert.rejects(context.persistSettings({ radioTrackCount: 5 }), /offline/);
  assert.equal(context.pendingSettingsDraft().radio.value, "5");
  context.fetchJson = async () => ({ settings: { radioTrackCount: 5 } });
  await context.persistSettings({ radioTrackCount: 5 });
  assert.equal(Object.keys(context.pendingSettingsDraft()).length, 0);
});

test("manual save sends only edited settings and blocks duplicate submissions", async () => {
  const { context, draft } = harness();
  draft.radio.value = "5";
  let calls = 0;
  let resolve;
  Object.assign(context, {
    settingsPayload: { settings: {} }, isSavingSettings: false, isRequestPolicyAutosaveSaving: false,
    hasPendingRequestPolicyAutosave: false, guiPlayerVolume: 100,
    settingsControls: () => [], collectSettingsPayload: () => ({ radioTrackCount: 5, twitchChannel: "unchanged", requestPolicy: {} }),
    clearRequestPolicyAutosaveTimer() {}, updateSettingsSaveState() {}, applyRequestAutosaveState() {},
    setFeedback() {}, el: () => null, applySettingsPayload() {}, applyYoutubeFallbackState() {},
    normalizeOverlayScalePercent: () => 100,
    fetchJson: (_url, options) => {
      calls++;
      assert.deepEqual(JSON.parse(options.body), { radioTrackCount: 5 });
      return new Promise(done => resolve = done);
    }
  });
  vm.runInContext(functions("saveSettings"), context);
  const saving = context.saveSettings();
  await context.saveSettings();
  assert.equal(calls, 1);
  resolve({ settings: { radioTrackCount: 5 } });
  await saving;
  assert.equal(context.isSavingSettings, false);
});

test("OBS status refresh does not clear unsaved fields after a failed save", () => {
  class Input {}
  const toggle = Object.assign(new Input(), { checked: true });
  const password = Object.assign(new Input(), { value: "fixture-password" });
  const values = { "youtube-fallback-enabled-toggle": toggle, "obs-websocket-password": password };
  const context = vm.createContext({
    settingsPayload: { settings: { obsYoutubeFallbackEnabled: false } },
    isHydratingForm: false, isSavingSettings: false,
    HTMLInputElement: Input, HTMLButtonElement: class {},
    el: id => values[id], setValue: () => assert.fail("status refresh must not write draft values")
  });
  vm.runInContext(functions("applyYoutubeFallbackState"), context);
  context.applyYoutubeFallbackState();
  assert.equal(toggle.checked, true);
  assert.equal(password.value, "fixture-password");
});

test("enabling AutoDJ saves its connection without applying unrelated drafts", async () => {
  let saved;
  const context = vm.createContext({
    autoDjStatus: { activation: { desired: false } },
    collectSettingsPayload: () => ({ autoDjServiceUrl: "http://preview.invalid", autoDjServiceLeaseSeconds: 90,
      autoDjServiceToken: "fixture-token", radioTrackCount: 7, chatCommands: {} }),
    persistSettings: async payload => { saved = payload; return { settings: {} }; },
    setText() {}, applySettingsPayload() {}, renderAutoDjStatus() {},
    fetchJson: async () => ({ activation: { desired: true } }),
    loadAutoDjStatus: async () => {}
  });
  vm.runInContext(functions("setAutoDjActivation"), context);
  await context.setAutoDjActivation();
  assert.deepEqual(Object.keys(saved).sort(), ["autoDjServiceLeaseSeconds", "autoDjServiceToken", "autoDjServiceUrl"]);
  assert.equal(context.autoDjStatus.activation.desired, true);
});

test("OBS login saves only its own settings and retains other pending drafts", async () => {
  let saved;
  const context = vm.createContext({
    settingsPayload: { settings: {} }, isSavingSettings: false, guiPlayerVolume: 100,
    collectSettingsPayload: () => ({ obsYoutubeFallbackEnabled: true, obsWebSocketUrl: "ws://preview.invalid",
      obsWebSocketPassword: "fixture-password", obsYoutubeFallbackSourceName: "Preview", radioTrackCount: 7 }),
    persistSettings: async payload => { saved = payload; return { settings: {} }; },
    HTMLButtonElement: class {}, el: () => null, normalizeOverlayScalePercent: () => 100,
    setYoutubeFallbackFeedback() {}, applySettingsPayload() {}, applyYoutubeFallbackState() {}, fetchJson: async () => ({})
  });
  vm.runInContext(functions("openYoutubeFallbackLogin"), context);
  await context.openYoutubeFallbackLogin();
  assert.deepEqual(Object.keys(saved).sort(), ["obsWebSocketPassword", "obsWebSocketUrl", "obsYoutubeFallbackEnabled", "obsYoutubeFallbackSourceName"]);
});

test("leaving with unsaved settings asks the browser to warn, but clean settings do not", () => {
  let beforeUnload;
  const start = source.indexOf('window.addEventListener("beforeunload"');
  const end = source.indexOf('\n});', start) + 4;
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({
    window: { addEventListener: (_event, handler) => beforeUnload = handler },
    pendingSettingsDraft: () => ({}), isSavingSettings: false, isRequestPolicyAutosaveSaving: false
  });
  vm.runInContext(source.slice(start, end), context);
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  beforeUnload(event);
  assert.equal(prevented, 0);
  context.pendingSettingsDraft = () => ({ radio: { value: "5" } });
  beforeUnload(event);
  assert.equal(prevented, 1);
  assert.equal(event.returnValue, "");
});
