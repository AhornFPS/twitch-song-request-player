import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const electronArgs = process.argv.slice(2);
const childEnv = { ...process.env };

delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, electronArgs, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
  windowsHide: false
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (code === null) {
    console.error(`${electronBinary} exited with signal ${signal}`);
    process.exit(1);
    return;
  }

  process.exit(code);
});

const terminationSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

for (const signal of terminationSignals) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}
