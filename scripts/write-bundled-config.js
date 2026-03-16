import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, ".env");
const bundledConfigPath = path.join(rootDir, "build", "bundled-config.json");

function trimValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function main() {
  dotenv.config({
    path: envPath,
    override: false
  });

  const bundledConfig = {
    twitchClientId: trimValue(process.env.TWITCH_CLIENT_ID)
  };

  await fs.mkdir(path.dirname(bundledConfigPath), {
    recursive: true
  });
  await fs.writeFile(bundledConfigPath, `${JSON.stringify(bundledConfig, null, 2)}\n`, "utf8");

  console.log(
    bundledConfig.twitchClientId
      ? `Bundled Twitch Client ID into ${path.relative(rootDir, bundledConfigPath)}`
      : `Wrote empty bundled config to ${path.relative(rootDir, bundledConfigPath)}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
