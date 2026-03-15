import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

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
const bundledPlaylistPath = path.join(sourceRootDir, "playlist.csv");
const themeOptions = [
  {
    id: "aurora",
    label: "Aurora",
    description: "Cool cyan glass with blue highlights."
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm amber glow with deeper contrast."
  },
  {
    id: "winamp",
    label: "Winamp Classic",
    description: "Retro dark-steel skin with glowing green EQ bars."
  },
  {
    id: "compact",
    label: "Compact",
    description: "Slim ticker bar: stacked coloured badges, inline UP NEXT queue."
  }
];
const validThemeIds = new Set(themeOptions.map((theme) => theme.id));

function trimValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeTheme(value) {
  const themeId = trimValue(value).toLowerCase();
  return validThemeIds.has(themeId) ? themeId : themeOptions[0].id;
}

function normalizePort(value) {
  const port = Number.parseInt(String(value ?? "3000"), 10) || 3000;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 3000;
}

function normalizeSettings(raw) {
  return {
    twitchChannel: trimValue(raw.twitchChannel ?? raw.TWITCH_CHANNEL).replace(/^#/, ""),
    twitchUsername: trimValue(raw.twitchUsername ?? raw.TWITCH_USERNAME),
    twitchOauthToken: trimValue(raw.twitchOauthToken ?? raw.TWITCH_OAUTH_TOKEN),
    twitchClientId: trimValue(raw.twitchClientId ?? raw.TWITCH_CLIENT_ID),
    twitchClientSecret: trimValue(raw.twitchClientSecret ?? raw.TWITCH_CLIENT_SECRET),
    youtubeApiKey: trimValue(raw.youtubeApiKey ?? raw.YOUTUBE_API_KEY),
    port: normalizePort(raw.port ?? raw.PORT ?? "3000"),
    theme: normalizeTheme(raw.theme ?? raw.THEME)
  };
}

function hasOwnSetting(raw, keys) {
  return keys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      return false;
    }

    const value = raw[key];
    if (value === null || typeof value === "undefined") {
      return false;
    }

    return typeof value === "string"
      ? value.trim().length > 0
      : true;
  });
}

function normalizeOverrideSettings(raw) {
  const overrides = {};

  if (hasOwnSetting(raw, ["twitchChannel", "TWITCH_CHANNEL"])) {
    overrides.twitchChannel = trimValue(raw.twitchChannel ?? raw.TWITCH_CHANNEL).replace(/^#/, "");
  }

  if (hasOwnSetting(raw, ["twitchUsername", "TWITCH_USERNAME"])) {
    overrides.twitchUsername = trimValue(raw.twitchUsername ?? raw.TWITCH_USERNAME);
  }

  if (hasOwnSetting(raw, ["twitchOauthToken", "TWITCH_OAUTH_TOKEN"])) {
    overrides.twitchOauthToken = trimValue(raw.twitchOauthToken ?? raw.TWITCH_OAUTH_TOKEN);
  }

  if (hasOwnSetting(raw, ["twitchClientId", "TWITCH_CLIENT_ID"])) {
    overrides.twitchClientId = trimValue(raw.twitchClientId ?? raw.TWITCH_CLIENT_ID);
  }

  if (hasOwnSetting(raw, ["twitchClientSecret", "TWITCH_CLIENT_SECRET"])) {
    overrides.twitchClientSecret = trimValue(raw.twitchClientSecret ?? raw.TWITCH_CLIENT_SECRET);
  }

  if (hasOwnSetting(raw, ["youtubeApiKey", "YOUTUBE_API_KEY"])) {
    overrides.youtubeApiKey = trimValue(raw.youtubeApiKey ?? raw.YOUTUBE_API_KEY);
  }

  if (hasOwnSetting(raw, ["port", "PORT"])) {
    overrides.port = normalizePort(raw.port ?? raw.PORT);
  }

  if (hasOwnSetting(raw, ["theme", "THEME"])) {
    overrides.theme = normalizeTheme(raw.theme ?? raw.THEME);
  }

  return overrides;
}

function mergeSettings(baseSettings, overridingSettings) {
  return {
    twitchChannel: overridingSettings.twitchChannel || baseSettings.twitchChannel,
    twitchUsername: overridingSettings.twitchUsername || baseSettings.twitchUsername,
    twitchOauthToken: overridingSettings.twitchOauthToken || baseSettings.twitchOauthToken,
    twitchClientId: overridingSettings.twitchClientId || baseSettings.twitchClientId,
    twitchClientSecret: overridingSettings.twitchClientSecret || baseSettings.twitchClientSecret,
    youtubeApiKey: overridingSettings.youtubeApiKey || baseSettings.youtubeApiKey,
    port: overridingSettings.port || baseSettings.port || 3000,
    theme: overridingSettings.theme || baseSettings.theme || themeOptions[0].id
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

export function hasRequiredSettings(settings) {
  return Boolean(settings.twitchChannel && settings.twitchUsername && settings.twitchOauthToken);
}

export class ConfigStore {
  constructor({
    rootDir = sourceRootDir,
    runtimeDir = process.pkg ? path.dirname(process.execPath) : sourceRootDir,
    publicDir = path.join(sourceRootDir, "public"),
    runtimeDebug = null
  } = {}) {
    this.rootDir = rootDir;
    this.runtimeDir = runtimeDir;
    this.publicDir = publicDir;
    this.runtimeDebug = runtimeDebug;
    this.settingsPath = path.join(this.runtimeDir, "settings.json");
    this.runtimeEnvPath = path.join(this.runtimeDir, ".env");
    this.playlistPath = path.join(this.runtimeDir, "playlist.csv");
  }

  async loadStoredSettings() {
    return normalizeSettings(await readJsonFile(this.settingsPath));
  }

  loadEnvSettings() {
    dotenv.config({ path: this.runtimeEnvPath, override: false });
    dotenv.config({ override: false });
    return normalizeOverrideSettings(process.env);
  }

  async loadEffectiveSettings() {
    const storedSettings = await this.loadStoredSettings();
    const envSettings = this.loadEnvSettings();
    return mergeSettings(storedSettings, envSettings);
  }

  async saveSettings(nextSettings) {
    const normalizedSettings = normalizeSettings(nextSettings);
    await fs.writeFile(this.settingsPath, `${JSON.stringify(normalizedSettings, null, 2)}\n`, "utf8");
    return normalizedSettings;
  }

  async ensureRuntimePlaylist() {
    try {
      await fs.access(this.playlistPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      const bundled = await fs.readFile(bundledPlaylistPath);
      await fs.writeFile(this.playlistPath, bundled);
    }
  }

  getThemeOptions() {
    return themeOptions.map((theme) => ({ ...theme }));
  }

  async loadRuntimeConfig() {
    const settings = await this.loadEffectiveSettings();
    await this.ensureRuntimePlaylist();

    return {
      rootDir: this.rootDir,
      runtimeDir: this.runtimeDir,
      publicDir: this.publicDir,
      playlistPath: this.playlistPath,
      port: settings.port,
      settings,
      runtimeDebug: this.runtimeDebug
    };
  }
}

export function createConfigStore(options = {}) {
  return new ConfigStore(options);
}

export function toRuntimeAppConfig(runtimeConfig) {
  return {
    rootDir: runtimeConfig.rootDir,
    runtimeDir: runtimeConfig.runtimeDir,
    publicDir: runtimeConfig.publicDir,
    playlistPath: runtimeConfig.playlistPath,
    port: runtimeConfig.settings.port,
    twitch: {
      channel: runtimeConfig.settings.twitchChannel,
      username: runtimeConfig.settings.twitchUsername,
      oauthToken: runtimeConfig.settings.twitchOauthToken,
      clientId: runtimeConfig.settings.twitchClientId,
      clientSecret: runtimeConfig.settings.twitchClientSecret
    },
    youtubeApiKey: runtimeConfig.settings.youtubeApiKey,
    theme: runtimeConfig.settings.theme
  };
}

export async function loadConfig() {
  const configStore = createConfigStore();
  const runtimeConfig = await configStore.loadRuntimeConfig();
  return toRuntimeAppConfig(runtimeConfig);
}
