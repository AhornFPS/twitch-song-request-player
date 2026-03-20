// @ts-nocheck
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildReleaseNotes,
  bumpVersion,
  readReleaseArtifacts,
  readPackageVersion,
  readUnreleasedNotes,
  rollChangelogRelease
} from "./release-lib.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(rootDir, "package.json");
const changelogPath = path.join(rootDir, "CHANGELOG.md");

function quoteWindowsArg(value) {
  const stringValue = String(value ?? "");
  if (stringValue.length === 0) {
    return "\"\"";
  }

  if (!/[\s"]/u.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
  const execOptions = {
    cwd: rootDir,
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.captureOutput ? "utf8" : undefined
  };

  const shouldUseCmdShim =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command));

  const result = shouldUseCmdShim
    ? execFileSync(
        "cmd.exe",
        ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")],
        execOptions
      )
    : execFileSync(command, args, execOptions);

  return options.captureOutput ? result.trim() : "";
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = [...argv];
  const bumpArg = args.shift();

  if (!bumpArg || bumpArg === "--help" || bumpArg === "-h") {
    return {
      showHelp: true
    };
  }

  const options = {
    bumpArg,
    dryRun: false,
    repo: "",
    skipBuild: false
  };

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "--repo") {
      options.repo = args.shift() ?? "";
      if (!options.repo) {
        throw new Error("--repo requires a value like OWNER/REPO.");
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log("Usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run] [--skip-build] [--repo OWNER/REPO]");
  console.log("");
  console.log("Examples:");
  console.log("  npm run release -- patch");
  console.log("  npm run release -- minor");
  console.log("  npm run release -- 2.0.0");
  console.log("  npm run release -- patch --dry-run");
}

function parseGithubRepoFromRemote(remoteUrl) {
  const normalized = String(remoteUrl ?? "").trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[:/](.+?)\/(.+)$/i);

  if (!match) {
    throw new Error(
      "Could not determine the GitHub repo from origin. Pass --repo OWNER/REPO explicitly."
    );
  }

  return `${match[1]}/${match[2]}`;
}

function getGitHubRepo(explicitRepo) {
  if (explicitRepo) {
    return explicitRepo;
  }

  const remoteUrl = run("git", ["remote", "get-url", "origin"], { captureOutput: true });
  return parseGithubRepoFromRemote(remoteUrl);
}

function ensureCleanGitTree() {
  const status = run("git", ["status", "--porcelain"], { captureOutput: true });
  if (status) {
    throw new Error("Git working tree is not clean. Commit or stash changes before releasing.");
  }
}

function getCurrentBranch() {
  const branch = run("git", ["branch", "--show-current"], { captureOutput: true });
  if (!branch) {
    throw new Error("Detached HEAD detected. Checkout a branch before releasing.");
  }

  return branch;
}

function releaseExists(repo, tag) {
  try {
    run("gh", ["release", "view", tag, "--repo", repo], { captureOutput: true });
    return true;
  } catch {
    return false;
  }
}

async function ensureArtifacts(version, skipBuild) {
  if (!skipBuild) {
    run(getNpmCommand(), ["run", "build:release"]);
  }

  const artifactPaths = await readReleaseArtifacts(
    path.join(rootDir, "dist"),
    "TwitchSongRequestPlayer-Portable.exe"
  );
  for (const artifactPath of artifactPaths) {
    await fs.access(artifactPath);
  }

  return artifactPaths;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) {
    printHelp();
    return;
  }

  const currentVersion = await readPackageVersion(packageJsonPath);
  const nextVersion = bumpVersion(currentVersion, options.bumpArg);
  const releaseDate = getTodayIsoDate();
  const unreleasedNotes = await readUnreleasedNotes(changelogPath);
  const repo = getGitHubRepo(options.repo);
  const tag = `v${nextVersion}`;
  const branch = getCurrentBranch();

  if (options.dryRun) {
    console.log(`Repo: ${repo}`);
    console.log(`Branch: ${branch}`);
    console.log(`Current version: ${currentVersion}`);
    console.log(`Next version: ${nextVersion}`);
    console.log(`Release date: ${releaseDate}`);
    console.log("");
    console.log("Unreleased notes:");
    console.log(unreleasedNotes);
    return;
  }

  ensureCleanGitTree();

  run(getNpmCommand(), ["version", nextVersion, "--no-git-tag-version"]);
  await rollChangelogRelease(changelogPath, nextVersion, releaseDate);

  const releaseNotes = await buildReleaseNotes(changelogPath, nextVersion);
  const releaseNotesPath = path.join(os.tmpdir(), `twitch-song-request-player-${tag}-notes.md`);
  await fs.writeFile(releaseNotesPath, releaseNotes, "utf8");

  const artifactPaths = await ensureArtifacts(nextVersion, options.skipBuild);

  run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
  run("git", ["commit", "-m", `release: ${tag}`]);
  run("git", ["tag", tag]);
  run("git", ["push", "origin", `HEAD:${branch}`]);
  run("git", ["push", "origin", `refs/tags/${tag}`]);

  if (releaseExists(repo, tag)) {
    run("gh", ["release", "edit", tag, "--repo", repo, "--title", tag, "--notes-file", releaseNotesPath]);
    run("gh", [
      "release",
      "upload",
      tag,
      ...artifactPaths,
      "--repo",
      repo,
      "--clobber"
    ]);
  } else {
    run("gh", [
      "release",
      "create",
      tag,
      ...artifactPaths,
      "--repo",
      repo,
      "--title",
      tag,
      "--notes-file",
      releaseNotesPath
    ]);
  }

  console.log(`Released ${tag} to https://github.com/${repo}/releases/tag/${tag}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
