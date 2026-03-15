import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startAppServer } from "./app-server.js";
import { createConfigStore } from "./config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRootDir = path.resolve(moduleDir, "..");

async function getAvailablePort() {
  const probe = net.createServer();

  return await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;

      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

test("app server closes even when a client keeps a connection open", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-app-server-"));
  const originalPort = process.env.PORT;
  let appServer = null;
  let closeStarted = false;
  let lingeringSocket = null;

  t.after(async () => {
    lingeringSocket?.destroy();

    if (appServer && !closeStarted) {
      await appServer.close().catch(() => {});
    }

    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });

    if (typeof originalPort === "string") {
      process.env.PORT = originalPort;
    } else {
      delete process.env.PORT;
    }
  });

  const port = await getAvailablePort();
  process.env.PORT = String(port);
  await fs.writeFile(
    path.join(runtimeDir, "settings.json"),
    `${JSON.stringify({ port }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(runtimeDir, "playlist.csv"),
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,Test Track\n",
    "utf8"
  );

  const configStore = createConfigStore({
    rootDir: appRootDir,
    runtimeDir,
    publicDir: path.join(appRootDir, "public")
  });

  appServer = await startAppServer({
    noBrowser: true,
    configStore
  });

  lingeringSocket = net.createConnection({
    host: "127.0.0.1",
    port
  });
  lingeringSocket.on("error", () => {});

  await new Promise((resolve, reject) => {
    lingeringSocket.once("connect", resolve);
    lingeringSocket.once("error", reject);
  });
  lingeringSocket.write("GET /api/state HTTP/1.1\r\nHost: localhost\r\n");

  closeStarted = true;
  const socketClosed = new Promise((resolve) => {
    lingeringSocket.once("close", resolve);
  });
  await Promise.race([
    appServer.close(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Timed out waiting for app server shutdown."));
      }, 1500);
    })
  ]);

  await Promise.race([
    socketClosed,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Timed out waiting for lingering client socket to close."));
      }, 1500);
    })
  ]);

  assert.equal(lingeringSocket.destroyed, true);
});
