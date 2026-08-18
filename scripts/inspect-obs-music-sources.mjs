import fs from "node:fs/promises";
import path from "node:path";

const obsRoot = path.join(process.env.APPDATA, "obs-studio");
const globalIni = await fs.readFile(path.join(obsRoot, "global.ini"), "utf8");
const sceneCollectionFile = globalIni.match(/^SceneCollectionFile=(.+)$/m)?.[1]?.trim();
if (!sceneCollectionFile) {
  throw new Error("Could not determine the active OBS scene collection file from global.ini.");
}

const collectionPath = path.join(obsRoot, "basic", "scenes", `${sceneCollectionFile}.json`);
const collection = JSON.parse(await fs.readFile(collectionPath, "utf8"));
const musicSources = (collection.sources ?? []).filter((source) =>
  /^browser_source/.test(source.id) && (
    /127\.0\.0\.1:(3000|3100)/.test(String(source.settings?.url ?? "")) ||
    /obs-(?:unified-)?overlay-loader\.html/i.test(String(source.settings?.local_file ?? ""))
  )
);
const sourceIds = new Set(musicSources.map((source) => source.uuid));
const placements = [];
for (const container of collection.sources ?? []) {
  for (const item of container.settings?.items ?? []) {
    if (!sourceIds.has(item.source_uuid)) continue;
    placements.push({
      container: container.name,
      containerType: container.id,
      itemName: item.name,
      sourceUuid: item.source_uuid,
      visible: item.visible,
      locked: item.locked,
      position: item.pos,
      scale: item.scale,
      bounds: item.bounds
    });
  }
}

console.log(JSON.stringify({
  collectionName: collection.name,
  collectionPath,
  currentScene: collection.current_scene,
  currentProgramScene: collection.current_program_scene,
  port3100Sources: (collection.sources ?? [])
    .filter((source) => JSON.stringify(source.settings ?? {}).includes("3100"))
    .map((source) => ({ name: source.name, id: source.id, uuid: source.uuid, settings: source.settings })),
  sources: musicSources.map((source) => ({
    name: source.name,
    uuid: source.uuid,
    enabled: source.enabled,
    muted: source.muted,
    volume: source.volume,
    localFile: source.settings?.local_file,
    isLocalFile: source.settings?.is_local_file,
    url: source.settings?.url,
    width: source.settings?.width,
    height: source.settings?.height,
    shutdownWhenNotVisible: source.settings?.shutdown,
    restartWhenActive: source.settings?.restart_when_active
  })),
  placements
}, null, 2));
