const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const mode = String(process.argv[2] || "inspect").toLowerCase();
const target = String(process.argv[3] || "");
const snapshotPath = String(process.argv[4] || "");
const inputName = String(process.env.OBS_MUSIC_INPUT || "youtube");
const configPath = path.join(
  String(process.env.APPDATA || ""),
  "obs-studio",
  "plugin_config",
  "obs-websocket",
  "config.json"
);

if (!["inspect", "file", "direct", "restore"].includes(mode)) {
  throw new Error(`Unsupported OBS Browser Source mode: ${mode}`);
}
if ((mode === "file" || mode === "direct" || mode === "restore") && !target) {
  throw new Error(`${mode} mode requires a target path or URL.`);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
const port = Number(config.server_port || 4455);
const password = String(config.server_password || "");
if (!password) throw new Error("OBS WebSocket password is empty.");

const sha256Base64 = (value) => crypto.createHash("sha256").update(value).digest("base64");
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
const timeout = setTimeout(() => {
  console.error("OBS Browser Source control timed out.");
  process.exit(2);
}, 15_000);
let currentRequest = null;
let original = null;

function sendRequest(requestType, requestData = {}) {
  currentRequest = {
    requestType,
    requestId: `obs-browser-${Date.now()}-${requestType}`,
    requestData
  };
  socket.send(JSON.stringify({ op: 6, d: currentRequest }));
}

function finish(payload, exitCode = 0) {
  clearTimeout(timeout);
  console.log(JSON.stringify(payload));
  socket.close();
  process.exit(exitCode);
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.op === 0) {
    const authentication = message.d.authentication;
    const identify = { rpcVersion: 1, eventSubscriptions: 0 };
    if (authentication) {
      const secret = sha256Base64(password + authentication.salt);
      identify.authentication = sha256Base64(secret + authentication.challenge);
    }
    socket.send(JSON.stringify({ op: 1, d: identify }));
    return;
  }
  if (message.op === 2) {
    sendRequest("GetInputSettings", { inputName });
    return;
  }
  if (message.op !== 7 || !currentRequest || message.d.requestId !== currentRequest.requestId) return;
  const status = message.d.requestStatus || {};
  if (!status.result) {
    finish({ updated: false, mode, inputName, code: status.code, comment: status.comment || "" }, 3);
    return;
  }
  if (currentRequest.requestType === "GetInputSettings") {
    original = {
      inputKind: message.d.responseData?.inputKind || "",
      inputSettings: message.d.responseData?.inputSettings || {}
    };
    if (snapshotPath) {
      fs.writeFileSync(snapshotPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");
    }
    if (mode === "inspect") {
      finish({ mode, inputName, ...original });
      return;
    }
    let inputSettings;
    let overlay = true;
    if (mode === "restore") {
      const snapshot = JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
      inputSettings = snapshot.inputSettings || {};
      overlay = false;
    } else if (mode === "file") {
      inputSettings = { is_local_file: true, local_file: target };
    } else {
      inputSettings = { is_local_file: false, url: target };
    }
    sendRequest("SetInputSettings", { inputName, inputSettings, overlay });
    return;
  }
  if (currentRequest.requestType === "SetInputSettings") {
    // A browser source which has already redirected from the local loader to
    // the loopback overlay does not reliably recreate CEF merely because its
    // stored local_file changed. Force the same scoped refresh as OBS's
    // Refresh cache button, and only report success after both acknowledgements.
    sendRequest("PressInputPropertiesButton", {
      inputName,
      propertyName: "refreshnocache"
    });
    return;
  }
  finish({
    updated: true,
    refreshed: true,
    mode,
    inputName,
    target: mode === "restore" ? "snapshot" : target,
    previousLocalFileMode: Boolean(original?.inputSettings?.is_local_file)
  });
});

socket.addEventListener("error", () => {
  clearTimeout(timeout);
  console.error("OBS WebSocket connection failed.");
  process.exit(4);
});
