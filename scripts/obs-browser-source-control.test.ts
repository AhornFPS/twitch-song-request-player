import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const controlScript = path.join(scriptsDirectory, "obs-browser-source-control.cjs");

async function runControlFixture({ failSet = false } = {}) {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "obs-browser-control-"));
  const appData = path.join(runtimeDirectory, "appdata");
  const configDirectory = path.join(
    appData,
    "obs-studio",
    "plugin_config",
    "obs-websocket"
  );
  const preloadPath = path.join(runtimeDirectory, "fake-websocket.cjs");
  const transcriptPath = path.join(runtimeDirectory, "transcript.json");
  const snapshotPath = path.join(runtimeDirectory, "snapshot.json");
  await fs.mkdir(configDirectory, { recursive: true });
  await fs.writeFile(path.join(configDirectory, "config.json"), JSON.stringify({
    server_port: 4455,
    server_password: "fixture-password"
  }));
  await fs.writeFile(preloadPath, String.raw`
const fs = require("node:fs");
const transcript = [];
process.on("exit", () => {
  fs.writeFileSync(process.env.OBS_CONTROL_TRANSCRIPT, JSON.stringify(transcript));
});
class FakeWebSocket {
  constructor(url) {
    this.listeners = new Map();
    transcript.push({ kind: "connect", url });
    queueMicrotask(() => this.emit("message", { data: JSON.stringify({ op: 0, d: {} }) }));
  }
  addEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }
  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  send(raw) {
    const message = JSON.parse(String(raw));
    if (message.op === 1) {
      transcript.push({ kind: "identify" });
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ op: 2, d: {} }) }));
      return;
    }
    const request = message.d;
    transcript.push({
      kind: "request",
      requestType: request.requestType,
      requestData: request.requestData
    });
    const fail = process.env.OBS_CONTROL_FAIL_SET === "1" &&
      request.requestType === "SetInputSettings";
    const responseData = request.requestType === "GetInputSettings"
      ? {
          inputKind: "browser_source",
          inputSettings: {
            is_local_file: true,
            local_file: "C:/old-loader.html",
            reroute_audio: true,
            width: 1280,
            height: 720
          }
        }
      : {};
    queueMicrotask(() => this.emit("message", { data: JSON.stringify({
      op: 7,
      d: {
        requestId: request.requestId,
        requestStatus: fail
          ? { result: false, code: 500, comment: "fixture set failure" }
          : { result: true, code: 100 },
        responseData
      }
    }) }));
  }
  close() {}
}
globalThis.WebSocket = FakeWebSocket;
`);

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [
        "--require",
        preloadPath,
        controlScript,
        "file",
        "C:/fresh-loader.html",
        snapshotPath
      ], {
        env: {
          ...process.env,
          APPDATA: appData,
          OBS_CONTROL_TRANSCRIPT: transcriptPath,
          OBS_CONTROL_FAIL_SET: failSet ? "1" : "0"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    }
  );
  const transcript = JSON.parse(await fs.readFile(transcriptPath, "utf8"));
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  await fs.rm(runtimeDirectory, { recursive: true, force: true });
  return { ...result, transcript, snapshot };
}

test("OBS local loader update is acknowledged and cache-refreshed in order", async () => {
  const result = await runControlFixture();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    result.transcript.filter((entry) => entry.kind === "request").map((entry) => entry.requestType),
    ["GetInputSettings", "SetInputSettings", "PressInputPropertiesButton"]
  );
  const setRequest = result.transcript.find((entry) => entry.requestType === "SetInputSettings");
  assert.deepEqual(setRequest.requestData, {
    inputName: "youtube",
    inputSettings: {
      is_local_file: true,
      local_file: "C:/fresh-loader.html"
    },
    overlay: true
  });
  const refreshRequest = result.transcript.find(
    (entry) => entry.requestType === "PressInputPropertiesButton"
  );
  assert.deepEqual(refreshRequest.requestData, {
    inputName: "youtube",
    propertyName: "refreshnocache"
  });
  assert.deepEqual(result.snapshot.inputSettings, {
    is_local_file: true,
    local_file: "C:/old-loader.html",
    reroute_audio: true,
    width: 1280,
    height: 720
  });
  assert.equal(JSON.parse(result.stdout).refreshed, true);
});

test("OBS loader control never refreshes after a rejected settings update", async () => {
  const result = await runControlFixture({ failSet: true });
  assert.equal(result.code, 3);
  assert.deepEqual(
    result.transcript.filter((entry) => entry.kind === "request").map((entry) => entry.requestType),
    ["GetInputSettings", "SetInputSettings"]
  );
  assert.match(result.stdout, /fixture set failure/);
});
