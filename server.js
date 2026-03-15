import express from "express";
import http from "node:http";
import { Server as SocketServer } from "socket.io";
import { loadConfig } from "./src/config.js";
import { logError, logInfo, logWarn } from "./src/logger.js";
import { PlaylistRepository } from "./src/playlist-repository.js";
import { PlayerController } from "./src/player-controller.js";
import { waitForExitAcknowledgement } from "./src/setup-wizard.js";
import { TwitchBot } from "./src/twitch-bot.js";

async function main() {
  const config = await loadConfig({
    forceSetup: process.argv.includes("--setup")
  });

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: {
      origin: "*"
    }
  });

  const playlistRepository = new PlaylistRepository(config.playlistPath);
  await playlistRepository.init();

  const playerController = new PlayerController({
    io,
    playlistRepository
  });

  const twitchBot = new TwitchBot({
    config,
    playerController
  });

  app.use(express.json());
  app.use(express.static(config.publicDir));

  app.get("/api/state", (_request, response) => {
    logInfo("HTTP state requested", playerController.getPublicState());
    response.json(playerController.getPublicState());
  });

  app.post("/api/player-event", async (request, response) => {
    logInfo("HTTP player event received", request.body);
    await playerController.handlePlayerEvent(request.body);
    response.status(204).end();
  });

  app.post("/api/client-log", (request, response) => {
    const level = typeof request.body?.level === "string" ? request.body.level : "info";
    const message = typeof request.body?.message === "string" ? request.body.message : "Client log";
    const details = request.body?.details;

    if (level === "warn") {
      logWarn(`Browser source: ${message}`, details);
    } else if (level === "error") {
      logError(`Browser source: ${message}`, details);
    } else {
      logInfo(`Browser source: ${message}`, details);
    }

    response.status(204).end();
  });

  io.on("connection", (socket) => {
    playerController.handleSocketConnection(socket);
  });

  await twitchBot.connect();
  await playerController.ensurePlayback();

  server.listen(config.port, () => {
    logInfo("Server listening", {
      url: `http://localhost:${config.port}`,
      browserSourceUrl: `http://localhost:${config.port}`
    });
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
