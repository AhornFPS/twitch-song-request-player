// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function getTypeScriptFiles(relativeDir) {
  const directory = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(relativeDir, entry.name));
}

async function main() {
  const srcFiles = await getTypeScriptFiles("src");

  await build({
    absWorkingDir: rootDir,
    entryPoints: ["server.ts", ...srcFiles],
    outdir: path.join(rootDir, "build"),
    outbase: ".",
    platform: "node",
    format: "esm",
    bundle: false,
    packages: "external"
  });

  await build({
    absWorkingDir: rootDir,
    entryPoints: ["electron/main.ts"],
    outfile: path.join(rootDir, "build", "electron", "main.cjs"),
    platform: "node",
    format: "cjs",
    bundle: false,
    packages: "external"
  });

  await build({
    absWorkingDir: rootDir,
    entryPoints: ["electron/bootstrap.ts"],
    outdir: path.join(rootDir, "build", "electron"),
    outbase: "electron",
    platform: "node",
    format: "esm",
    bundle: false,
    packages: "external"
  });

  await build({
    absWorkingDir: rootDir,
    entryPoints: ["client/app.ts", "client/dashboard.ts"],
    outdir: path.join(rootDir, "public"),
    outbase: "client",
    platform: "browser",
    bundle: false
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
