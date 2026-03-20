// @ts-nocheck
import fs from "node:fs/promises";
import { createInterface } from "node:readline/promises";

function sanitizeSettings(raw) {
  return {
    twitchChannel: raw.twitchChannel?.trim().replace(/^#/, "") ?? "",
    twitchUsername: raw.twitchUsername?.trim() ?? "",
    twitchOauthToken: raw.twitchOauthToken?.trim() ?? "",
    twitchClientId: raw.twitchClientId?.trim() ?? "",
    twitchClientSecret: raw.twitchClientSecret?.trim() ?? "",
    youtubeApiKey: raw.youtubeApiKey?.trim() ?? "",
    port: Number.isInteger(raw.port) ? raw.port : Number.parseInt(String(raw.port ?? "3000"), 10) || 3000
  };
}

function hasRequiredSettings(settings) {
  return Boolean(settings.twitchChannel && settings.twitchUsername && settings.twitchOauthToken);
}

async function persistSettings(settingsPath, settings) {
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function askQuestion(readline, label, fallback = "", { required = false } = {}) {
  while (true) {
    const suffix = fallback ? ` [${fallback}]` : "";
    const response = (await readline.question(`${label}${suffix}: `)).trim();
    const value = response || fallback;

    if (!required || value) {
      return value;
    }

    console.log("This value is required.");
  }
}

async function askPort(readline, fallback = 3000) {
  while (true) {
    const response = await askQuestion(readline, "Local web server port", String(fallback));
    const port = Number.parseInt(response, 10);

    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port;
    }

    console.log("Enter a port between 1 and 65535.");
  }
}

async function promptForSettings(existingSettings) {
  console.log("Configuration is required before the player can start.");
  console.log("These values will be stored in settings.json next to the executable.");

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const twitchChannel = await askQuestion(readline, "Twitch channel name", existingSettings.twitchChannel, {
      required: true
    });
    const twitchUsername = await askQuestion(readline, "Twitch bot username", existingSettings.twitchUsername, {
      required: true
    });
    const twitchOauthToken = await askQuestion(readline, "Twitch bot OAuth token", existingSettings.twitchOauthToken, {
      required: true
    });
    const twitchClientId = await askQuestion(
      readline,
      "Twitch app Client ID (optional, enables in-app bot login and category-aware suppression)",
      existingSettings.twitchClientId
    );
    const twitchClientSecret = await askQuestion(
      readline,
      "Twitch app Client Secret (optional advanced setting)",
      existingSettings.twitchClientSecret
    );
    const youtubeApiKey = await askQuestion(
      readline,
      "YouTube API key (leave blank to disable !sr search terms)",
      existingSettings.youtubeApiKey
    );
    const port = await askPort(readline, existingSettings.port || 3000);

    return sanitizeSettings({
      twitchChannel,
      twitchUsername,
      twitchOauthToken,
      twitchClientId,
      twitchClientSecret,
      youtubeApiKey,
      port
    });
  } finally {
    readline.close();
  }
}

export async function waitForExitAcknowledgement() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    await readline.question("Press Enter to close...");
  } finally {
    readline.close();
  }
}

export async function ensureSetup({ forceSetup = false, settingsPath, initialSettings }) {
  const existingSettings = sanitizeSettings(initialSettings);

  if (!forceSetup && hasRequiredSettings(existingSettings)) {
    return existingSettings;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Missing required configuration and no interactive terminal is available.");
  }

  const promptedSettings = await promptForSettings(existingSettings);
  await persistSettings(settingsPath, promptedSettings);

  return promptedSettings;
}
