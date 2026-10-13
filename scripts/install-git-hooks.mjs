import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.CI && fs.existsSync(path.join(rootDir, ".git"))) {
  let existing = "";
  try {
    existing = execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    if (error.status !== 1) throw new Error("Could not inspect Git hook configuration.");
  }
  if (existing && existing !== ".githooks") {
    throw new Error("Existing core.hooksPath retained. Integrate .githooks secret checks into your hooks before committing.");
  }
  const hookDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  if (!existing && ["pre-commit", "pre-push"].some((name) => fs.existsSync(path.resolve(rootDir, hookDir, name)))) {
    throw new Error("Existing Git hooks retained. Integrate .githooks secret checks before configuring core.hooksPath.");
  }
  for (const name of ["pre-commit", "pre-push"]) fs.chmodSync(path.join(rootDir, ".githooks", name), 0o755);
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: rootDir });
  console.log("Installed secret checks for Git commits and pushes.");
}
