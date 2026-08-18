import fs from "node:fs/promises";
import path from "node:path";
import OBSWebSocket from "obs-websocket-js";

const apply = process.argv.includes("--apply");
const runtimeRoot = path.join(
  process.env.USERPROFILE,
  "Documents",
  "TwitchSongRequestPlayer-local-prototype-server"
);
const settings = JSON.parse((await fs.readFile(
  path.join(runtimeRoot, "settings.json"),
  "utf8"
)).replace(/^\uFEFF/, ""));
const loaderPath = path.join(runtimeRoot, "obs-overlay-loader.html");
await fs.access(loaderPath);

const obs = new OBSWebSocket();
await obs.connect(
  String(settings.obsWebSocketUrl || "ws://127.0.0.1:4455"),
  String(settings.obsWebSocketPassword || "")
);

async function browserInputs() {
  const { inputs } = await obs.call("GetInputList");
  return await Promise.all(
    inputs
      .filter(({ inputKind }) => /^browser_source/.test(inputKind))
      .map(async (input) => ({
        ...input,
        settings: (await obs.call("GetInputSettings", {
          inputName: input.inputName
        })).inputSettings,
        muted: (await obs.call("GetInputMute", {
          inputName: input.inputName
        })).inputMuted
      }))
  );
}

function isMusicInput(input) {
  const haystack = JSON.stringify(input.settings ?? {}).toLowerCase();
  return input.inputName === "youtube" || (
    haystack.includes("obs-unified-overlay-loader.html") ||
    haystack.includes("obs-overlay-loader.html") ||
    /127\.0\.0\.1:(3000|3100)/.test(haystack)
  );
}

const beforeInputs = await browserInputs();
const target = beforeInputs.find(({ inputName }) => inputName === "youtube")
  ?? beforeInputs.find(isMusicInput);
if (!target) {
  throw new Error("Could not identify the OBS music Browser Source.");
}

const sceneCollections = await obs.call("GetSceneCollectionList");
const before = {
  sceneCollection: sceneCollections.currentSceneCollectionName,
  target,
  fallback: beforeInputs.find(({ inputName }) => inputName === "Youtube Fallback") ?? null,
  musicInputs: beforeInputs.filter(isMusicInput)
};
let backupPath = "";
let backupDirectory = "";

if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  backupDirectory = path.join(
    runtimeRoot,
    "runtime",
    "backups",
    `obs-single-overlay-${stamp}`
  );
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, "before.json");
  await fs.writeFile(backupPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

  await obs.call("SetInputSettings", {
    inputName: target.inputName,
    inputSettings: {
      ...target.settings,
      is_local_file: true,
      local_file: loaderPath.replaceAll("\\", "/"),
      shutdown: false,
      restart_when_active: false
    },
    overlay: true
  });
  await obs.call("SetInputMute", {
    inputName: target.inputName,
    inputMuted: false
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const afterInputs = await browserInputs();
const verified = afterInputs.find(({ inputName }) => inputName === target.inputName);
const verifiedFallback = afterInputs.find(({ inputName }) => inputName === "Youtube Fallback") ?? null;
if (apply && path.normalize(String(verified?.settings?.local_file ?? "")) !== path.normalize(loaderPath)) {
  throw new Error("OBS did not retain the unified program's single local loader path.");
}
if (apply && JSON.stringify(verifiedFallback) !== JSON.stringify(before.fallback)) {
  throw new Error("The OBS YouTube fallback source changed during the single-loader migration.");
}

const obsSceneRoot = path.join(process.env.APPDATA, "obs-studio", "basic", "scenes");
const persistedReferences = [];
let persistedCollection = null;
const currentCollectionStem = before.sceneCollection.replace(/[^\p{L}\p{N}._-]+/gu, "_");
for (const entry of await fs.readdir(obsSceneRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  const filePath = path.join(obsSceneRoot, entry.name);
  try {
    const collection = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (
      apply &&
      collection.name === before.sceneCollection &&
      path.basename(entry.name, ".json").toLocaleLowerCase() === currentCollectionStem.toLocaleLowerCase()
    ) {
      const source = (collection.sources ?? []).find((candidate) => (
        candidate.name === target.inputName || candidate.uuid === target.inputUuid
      ));
      if (!source) {
        throw new Error(`Could not find ${target.inputName} in ${filePath}.`);
      }
      source.settings = {
        ...(source.settings ?? {}),
        is_local_file: true,
        local_file: loaderPath.replaceAll("\\", "/"),
        shutdown: false,
        restart_when_active: false
      };
      const collectionBackupPath = path.join(backupDirectory, entry.name);
      await fs.copyFile(filePath, collectionBackupPath);
      await fs.writeFile(filePath, `${JSON.stringify(collection, null, 4)}\n`, "utf8");
      persistedCollection = {
        file: filePath,
        backupPath: collectionBackupPath,
        source: source.name,
        localFile: source.settings.local_file
      };
    }
    for (const source of collection.sources ?? []) {
      if (source.name !== target.inputName && source.uuid !== target.inputUuid) continue;
      persistedReferences.push({
        file: filePath,
        collection: collection.name,
        source: source.name,
        localFile: source.settings?.local_file ?? "",
        isLocalFile: source.settings?.is_local_file === true
      });
    }
  } catch {
  }
}
if (apply && !persistedCollection) {
  throw new Error(`Could not persist the active OBS scene collection ${before.sceneCollection}.`);
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "inspect",
  loaderPath,
  backupPath,
  before,
  after: {
    target: verified,
    fallback: verifiedFallback,
    musicInputs: afterInputs.filter(isMusicInput),
    persistedCollection,
    persistedReferences
  }
}, null, 2));

obs.disconnect();
