import { startAppServer } from "./src/app-server.js";
import { logError } from "./src/logger.js";
import { waitForExitAcknowledgement } from "./src/setup-wizard.js";

async function main() {
  await startAppServer({
    forceSetup: process.argv.includes("--setup"),
    noBrowser: process.argv.includes("--no-browser")
  });
}

main().catch((error) => {
  logError("Fatal startup error", {
    message: error?.message ?? String(error),
    stack: error?.stack ?? null
  });
  process.exitCode = 1;
  waitForExitAcknowledgement().catch(() => {});
});
