import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ensureSetup } from "./setup-wizard.js";

const moduleDir =
  path.resolve(
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url))
  );

const moduleBaseName = path.basename(moduleDir).toLowerCase();
const sourceRootDir =
  moduleBaseName === "src" || moduleBaseName === "build"
    ? path.resolve(moduleDir, "..")
    : moduleDir;
const runtimeDir = process.pkg ? path.dirname(process.execPath) : sourceRootDir;
const settingsPath = path.join(runtimeDir, "settings.json");
const runtimeEnvPath = path.join(runtimeDir, ".env");
const bundledPlaylistPath = path.join(sourceRootDir, "playlist.csv");
const runtimePlaylistPath = path.join(runtimeDir, "playlist.csv");

function trimValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeSettings(raw) {
  return {
    twitchChannel: trimValue(raw.twitchChannel ?? raw.TWITCH_CHANNEL).replace(/^#/, ""),
    twitchUsername: trimValue(raw.twitchUsername ?? raw.TWITCH_USERNAME),
    twitchOauthToken: trimValue(raw.twitchOauthToken ?? raw.TWITCH_OAUTH_TOKEN),
    twitchClientId: trimValue(raw.twitchClientId ?? raw.TWITCH_CLIENT_ID),
    twitchClientSecret: trimValue(raw.twitchClientSecret ?? raw.TWITCH_CLIENT_SECRET),
    youtubeApiKey: trimValue(raw.youtubeApiKey ?? raw.YOUTUBE_API_KEY),
    port: Number.parseInt(String(raw.port ?? raw.PORT ?? "3000"), 10) || 3000
  };
}

function mergeSettings(baseSettings, overridingSettings) {
  return {
    twitchChannel: overridingSettings.twitchChannel || baseSettings.twitchChannel,
    twitchUsername: overridingSettings.twitchUsername || baseSettings.twitchUsername,
    twitchOauthToken: overridingSettings.twitchOauthToken || baseSettings.twitchOauthToken,
    twitchClientId: overridingSettings.twitchClientId || baseSettings.twitchClientId,
    twitchClientSecret: overridingSettings.twitchClientSecret || baseSettings.twitchClientSecret,
    youtubeApiKey: overridingSettings.youtubeApiKey || baseSettings.youtubeApiKey,
    port: overridingSettings.port || baseSettings.port || 3000
  };
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function ensureRuntimePlaylist() {
  try {
    await fs.access(runtimePlaylistPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    const bundled = await fs.readFile(bundledPlaylistPath);
    await fs.writeFile(runtimePlaylistPath, bundled);
  }
}

export async function loadConfig({ forceSetup = false } = {}) {
  dotenv.config({ path: runtimeEnvPath });
  dotenv.config();

  const storedSettings = normalizeSettings(await readJsonFile(settingsPath));
  const envSettings = normalizeSettings(process.env);

  const settings = await ensureSetup({
    forceSetup,
    settingsPath,
    initialSettings: mergeSettings(storedSettings, envSettings)
  });

  await ensureRuntimePlaylist();

  return {
    rootDir: sourceRootDir,
    runtimeDir,
    publicDir: path.join(sourceRootDir, "public"),
    playlistPath: runtimePlaylistPath,
    port: settings.port,
    twitch: {
      channel: settings.twitchChannel,
      username: settings.twitchUsername,
      oauthToken: settings.twitchOauthToken,
      clientId: settings.twitchClientId,
      clientSecret: settings.twitchClientSecret
    },
    youtubeApiKey: settings.youtubeApiKey
  };
}
