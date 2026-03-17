import crypto from "node:crypto";
import { formatTrack, logInfo, logWarn } from "./logger.js";

const validRequestAccessLevels = new Set([
  "everyone",
  "subscriber",
  "vip",
  "moderator",
  "broadcaster"
]);

const validProviders = new Set([
  "youtube",
  "soundcloud"
]);

function normalizeRequestPolicyList(value, { lowerCase = false } = {}) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      list
        .map((item) => typeof item === "string" ? item.trim() : "")
        .map((item) => lowerCase ? item.toLowerCase() : item)
        .filter(Boolean)
    )
  );
}

function normalizeAllowedProviders(value) {
  const sourceValue =
    Array.isArray(value) || typeof value === "string"
      ? value
      : ["youtube", "soundcloud"];
  const allowedProviders = normalizeRequestPolicyList(sourceValue, {
    lowerCase: true
  }).filter((provider) => validProviders.has(provider));

  return allowedProviders;
}

function normalizeRequestPolicy(requestPolicy = {}) {
  const accessLevel = typeof requestPolicy.accessLevel === "string"
    ? requestPolicy.accessLevel.trim().toLowerCase()
    : "everyone";

  return {
    requestsEnabled: requestPolicy.requestsEnabled !== false,
    accessLevel: validRequestAccessLevels.has(accessLevel) ? accessLevel : "everyone",
    maxQueueLength: Number.parseInt(String(requestPolicy.maxQueueLength ?? 0), 10) || 0,
    maxRequestsPerUser: Number.parseInt(String(requestPolicy.maxRequestsPerUser ?? 0), 10) || 0,
    cooldownSeconds: Number.parseInt(String(requestPolicy.cooldownSeconds ?? 0), 10) || 0,
    allowSearchRequests: requestPolicy.allowSearchRequests !== false,
    youtubeSafeSearch: typeof requestPolicy.youtubeSafeSearch === "string"
      ? requestPolicy.youtubeSafeSearch
      : "none",
    allowedProviders: normalizeAllowedProviders(requestPolicy.allowedProviders),
    blockedUsers: normalizeRequestPolicyList(requestPolicy.blockedUsers, {
      lowerCase: true
    }),
    blockedPhrases: normalizeRequestPolicyList(requestPolicy.blockedPhrases)
  };
}

export class PlayerController {
  constructor({
    io,
    playlistRepository,
    runtimeStateStore = null,
    historyLimit = 25,
    requestPolicy = {}
  }) {
    this.io = io;
    this.playlistRepository = playlistRepository;
    this.runtimeStateStore = runtimeStateStore;
    this.historyLimit = historyLimit;
    this.requestPolicy = normalizeRequestPolicy(requestPolicy);
    this.queue = [];
    this.currentTrack = null;
    this.stoppedTrack = null;
    this.history = [];
    this.isAdvancing = false;
    this.isPlaybackPaused = false;
    this.playbackSuppressed = false;
    this.playbackSuppressedCategory = "";
    this.trackStartListeners = new Set();
    this.trackPlaybackListeners = new Set();
    this.requestTimestampsByUser = new Map();
  }

  serializeTrack(track) {
    if (!track) {
      return null;
    }

    return {
      id: track.id,
      provider: track.provider,
      url: track.url,
      title: track.title,
      key: track.key,
      origin: track.origin,
      artworkUrl: track.artworkUrl ?? "",
      requestedBy: track.requestedBy,
      isSaved: this.playlistRepository.hasTrack(track),
      isPaused: track.id === this.currentTrack?.id ? this.isPlaybackPaused : false
    };
  }

  getPublicState() {
    return {
      currentTrack: this.serializeTrack(this.currentTrack),
      stoppedTrack: this.serializeTrack(this.stoppedTrack),
      playbackStatus: this.getPlaybackStatus(),
      queue: this.queue.map((track) => this.serializeTrack(track)),
      history: this.history.map((entry) => ({
        track: this.serializeTrack(entry.track),
        status: entry.status,
        completedAt: entry.completedAt
      }))
    };
  }

  getPlaybackStatus() {
    if (this.currentTrack) {
      return this.isPlaybackPaused ? "paused" : "playing";
    }

    if (this.stoppedTrack) {
      return "stopped";
    }

    return "idle";
  }

  handleSocketConnection(socket) {
    logInfo("Browser source connected", {
      socketId: socket.id,
      currentTrack: formatTrack(this.currentTrack),
      queueLength: this.queue.length
    });
    socket.emit("state", this.getPublicState());

    if (this.currentTrack) {
      logInfo("Sending current track to newly connected browser source", {
        socketId: socket.id,
        track: formatTrack(this.currentTrack)
      });
      socket.emit("player:load", {
        track: this.serializeTrack(this.currentTrack)
      });
    }

    socket.on("player:event", async (payload) => {
      await this.handlePlayerEvent(payload);
    });
  }

  setRequestPolicy(requestPolicy = {}) {
    this.requestPolicy = normalizeRequestPolicy(requestPolicy);
  }

  async addRequest(track, { bypassRequestLimits = false } = {}) {
    const duplicateMatch = this.findDuplicateTrack(track.key);

    if (duplicateMatch) {
      logInfo("Ignoring duplicate track request", {
        requestedTrack: formatTrack(track),
        duplicateTrack: formatTrack(duplicateMatch.track),
        duplicateType: duplicateMatch.type,
        queueLength: this.queue.length
      });

      return {
        ...this.serializeTrack(duplicateMatch.track),
        alreadyQueued: duplicateMatch.type === "queue",
        duplicateType: duplicateMatch.type
      };
    }

    this.assertRequestAllowed(track, { bypassRequestLimits });

    const queueTrack = {
      ...track,
      id: crypto.randomUUID(),
      origin: "queue"
    };

    this.queue.push(queueTrack);
    const requesterUsername = track.requestedBy?.username?.trim().toLowerCase();
    if (!bypassRequestLimits && requesterUsername) {
      this.requestTimestampsByUser.set(requesterUsername, Date.now());
    }
    logInfo("Track queued", {
      track: formatTrack(queueTrack),
      queueLength: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    await this.ensurePlayback();

    return {
      ...this.serializeTrack(queueTrack),
      alreadyQueued: false,
      duplicateType: null
    };
  }

  assertRequestAllowed(track, { bypassRequestLimits = false } = {}) {
    if (bypassRequestLimits) {
      return;
    }

    const maxQueueLength = Number.isInteger(this.requestPolicy.maxQueueLength)
      ? this.requestPolicy.maxQueueLength
      : 0;
    const maxRequestsPerUser = Number.isInteger(this.requestPolicy.maxRequestsPerUser)
      ? this.requestPolicy.maxRequestsPerUser
      : 0;
    const cooldownSeconds = Number.isInteger(this.requestPolicy.cooldownSeconds)
      ? this.requestPolicy.cooldownSeconds
      : 0;

    if (maxQueueLength > 0 && this.queue.length >= maxQueueLength) {
      throw new Error("The request queue is full right now.");
    }

    const requesterUsername = track.requestedBy?.username?.trim().toLowerCase();
    if (!requesterUsername) {
      return;
    }

    if (cooldownSeconds > 0) {
      const lastRequestedAt = this.requestTimestampsByUser.get(requesterUsername) ?? 0;
      const cooldownMs = cooldownSeconds * 1000;
      const remainingMs = lastRequestedAt + cooldownMs - Date.now();

      if (remainingMs > 0) {
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        throw new Error(
          `You need to wait ${remainingSeconds} more second${remainingSeconds === 1 ? "" : "s"} before requesting another song.`
        );
      }
    }

    if (maxRequestsPerUser <= 0) {
      return;
    }

    const activeRequestCount = [
      ...this.queue,
      this.currentTrack,
      this.stoppedTrack
    ].filter((candidate) => {
      if (!candidate || candidate.origin !== "queue") {
        return false;
      }

      return candidate.requestedBy?.username?.trim().toLowerCase() === requesterUsername;
    }).length;

    if (activeRequestCount >= maxRequestsPerUser) {
      throw new Error("You already have too many active song requests.");
    }
  }

  async removeQueuedTrack(trackId, triggeredBy) {
    const trackIndex = this.queue.findIndex((track) => track.id === trackId);

    if (trackIndex < 0) {
      logWarn("Requested queued-track removal for an unknown track", {
        triggeredBy,
        trackId
      });
      return null;
    }

    const [removedTrack] = this.queue.splice(trackIndex, 1);
    logInfo("Removed queued track", {
      triggeredBy,
      track: formatTrack(removedTrack),
      remainingQueue: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(removedTrack);
  }

  async moveQueuedTrack(trackId, offset, triggeredBy) {
    const trackIndex = this.queue.findIndex((track) => track.id === trackId);

    if (trackIndex < 0) {
      logWarn("Requested queued-track move for an unknown track", {
        triggeredBy,
        trackId,
        offset
      });
      return null;
    }

    const normalizedOffset = Number.isInteger(offset)
      ? offset
      : Number.parseInt(String(offset ?? 0), 10) || 0;
    const nextIndex = Math.max(0, Math.min(this.queue.length - 1, trackIndex + normalizedOffset));
    const [trackToMove] = this.queue.splice(trackIndex, 1);
    this.queue.splice(nextIndex, 0, trackToMove);

    logInfo("Moved queued track", {
      triggeredBy,
      track: formatTrack(trackToMove),
      fromIndex: trackIndex,
      toIndex: nextIndex,
      queueLength: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(trackToMove);
  }

  async promoteQueuedTrack(trackId, triggeredBy) {
    const trackIndex = this.queue.findIndex((track) => track.id === trackId);

    if (trackIndex < 0) {
      logWarn("Requested queued-track promotion for an unknown track", {
        triggeredBy,
        trackId
      });
      return null;
    }

    const [trackToPromote] = this.queue.splice(trackIndex, 1);
    this.queue.unshift(trackToPromote);
    logInfo("Promoted queued track", {
      triggeredBy,
      track: formatTrack(trackToPromote),
      queueLength: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(trackToPromote);
  }

  async clearQueue(triggeredBy) {
    const clearedTracks = this.queue.map((track) => this.serializeTrack(track));
    this.queue = [];
    logInfo("Cleared queue", {
      triggeredBy,
      clearedCount: clearedTracks.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return {
      clearedCount: clearedTracks.length,
      clearedTracks
    };
  }

  getQueueSummary(limit = 3) {
    return this.queue.slice(0, Math.max(1, limit)).map((track) => this.serializeTrack(track));
  }

  getQueuePositionForRequester(username) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!normalizedUsername) {
      return null;
    }

    const queueIndex = this.queue.findIndex((track) =>
      track.requestedBy?.username?.trim().toLowerCase() === normalizedUsername
    );

    if (queueIndex < 0) {
      return null;
    }

    return {
      position: queueIndex + 1,
      track: this.serializeTrack(this.queue[queueIndex])
    };
  }

  async removeQueuedTrackByRequester(username, triggeredBy) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!normalizedUsername) {
      return null;
    }

    const trackIndex = this.queue.findIndex((track) =>
      track.requestedBy?.username?.trim().toLowerCase() === normalizedUsername
    );

    if (trackIndex < 0) {
      logWarn("Requested own queued-track removal but nothing matched the requester", {
        triggeredBy,
        username: normalizedUsername
      });
      return null;
    }

    const [removedTrack] = this.queue.splice(trackIndex, 1);
    logInfo("Removed queued track by requester", {
      triggeredBy,
      username: normalizedUsername,
      track: formatTrack(removedTrack),
      remainingQueue: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(removedTrack);
  }

  findDuplicateTrack(trackKey) {
    if (!trackKey) {
      return null;
    }

    if (this.currentTrack?.key === trackKey) {
      return {
        track: this.currentTrack,
        type: "playing"
      };
    }

    const queuedTrack = this.queue.find((queuedTrack) => queuedTrack.key === trackKey);

    if (!queuedTrack) {
      if (this.stoppedTrack?.key === trackKey) {
        return {
          track: this.stoppedTrack,
          type: "stopped"
        };
      }

      return null;
    }

    return {
      track: queuedTrack,
      type: "queue"
    };
  }

  onTrackStart(listener) {
    this.trackStartListeners.add(listener);

    return () => {
      this.trackStartListeners.delete(listener);
    };
  }

  onTrackPlayback(listener) {
    this.trackPlaybackListeners.add(listener);

    return () => {
      this.trackPlaybackListeners.delete(listener);
    };
  }

  async skipCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Skip requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    const skippedTrack = this.currentTrack;

    logInfo("Skipping current track", {
      triggeredBy,
      track: formatTrack(skippedTrack)
    });

    this.io.emit("player:stop", {
      reason: "skip",
      triggeredBy
    });

    await this.finishCurrentTrack({
      status: "skipped",
      trackId: skippedTrack.id,
      suppressEnsurePlayback: true
    });

    return skippedTrack;
  }

  async skipToNextTrack(triggeredBy) {
    if (this.currentTrack) {
      const skippedTrack = await this.skipCurrentTrack(triggeredBy);

      if (skippedTrack) {
        this.stoppedTrack = null;
        await this.ensurePlayback();
      }

      return skippedTrack;
    }

    if (this.stoppedTrack) {
      const skippedTrack = this.stoppedTrack;
      this.stoppedTrack = null;
      this.isPlaybackPaused = false;

      logInfo("Skipping stopped track and advancing playback", {
        triggeredBy,
        track: formatTrack(skippedTrack)
      });

      this.broadcastState();
      await this.ensurePlayback();
      return skippedTrack;
    }

    logWarn("Next track requested but nothing is currently available", {
      triggeredBy
    });
    await this.ensurePlayback();
    return this.currentTrack;
  }

  async deleteCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Delete requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    const trackToDelete = this.currentTrack;

    logInfo("Deleting current track", {
      triggeredBy,
      track: formatTrack(trackToDelete)
    });

    await this.playlistRepository.removeTrack(trackToDelete);

    this.io.emit("player:stop", {
      reason: "delete",
      triggeredBy
    });

    await this.finishCurrentTrack({
      status: "deleted",
      trackId: trackToDelete.id,
      suppressEnsurePlayback: true
    });

    return trackToDelete;
  }

  async saveCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Save requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    const saved = await this.playlistRepository.appendTrack(this.currentTrack);
    const track = this.currentTrack;

    logInfo("Saving current track", {
      triggeredBy,
      saved,
      track: formatTrack(track)
    });

    this.broadcastState();

    return {
      saved,
      alreadySaved: !saved,
      track: this.serializeTrack(track)
    };
  }

  getCurrentTrack() {
    return this.serializeTrack(this.currentTrack);
  }

  async restoreRuntimeState() {
    if (!this.runtimeStateStore) {
      return;
    }

    const persistedState = await this.runtimeStateStore.load();
    this.queue = Array.isArray(persistedState.queue)
      ? persistedState.queue.map((track) => ({ ...track }))
      : [];
    this.stoppedTrack = persistedState.stoppedTrack
      ? { ...persistedState.stoppedTrack }
      : null;
    this.history = Array.isArray(persistedState.history)
      ? persistedState.history.slice(0, this.historyLimit).map((entry) => ({
          track: { ...entry.track },
          status: entry.status,
          completedAt: entry.completedAt
        }))
      : [];

    logInfo("Restored runtime playback state", {
      queueLength: this.queue.length,
      hasStoppedTrack: Boolean(this.stoppedTrack),
      historyLength: this.history.length
    });
  }

  async setPlaybackSuppressed(isSuppressed, { category = "" } = {}) {
    const nextSuppressed = Boolean(isSuppressed);
    const nextCategory = nextSuppressed ? category : "";

    if (
      this.playbackSuppressed === nextSuppressed &&
      this.playbackSuppressedCategory === nextCategory
    ) {
      return;
    }

    this.playbackSuppressed = nextSuppressed;
    this.playbackSuppressedCategory = nextCategory;

    if (nextSuppressed) {
      logInfo("Playback suppressed by Twitch category", {
        category: nextCategory || null,
        currentTrack: formatTrack(this.currentTrack)
      });

      if (this.currentTrack) {
        const interruptedTrack = {
          ...this.currentTrack
        };

        if (interruptedTrack.origin === "queue") {
          delete interruptedTrack.playbackConfirmed;
          this.queue.unshift(interruptedTrack);
        }

        this.io.emit("player:stop", {
          reason: "category_suppressed",
          category: nextCategory || null
        });

        this.isPlaybackPaused = false;
        this.currentTrack = null;
        await this.persistRuntimeState();
        this.broadcastState();
      }

      return;
    }

    logInfo("Playback suppression cleared", {
      category: this.playbackSuppressedCategory || null
    });
    await this.ensurePlayback();
  }

  async handlePlayerEvent(payload) {
    if (!payload?.trackId || payload.trackId !== this.currentTrack?.id) {
      logWarn("Ignoring player event for unknown track", payload ?? {});
      return;
    }

    if (!["playing", "ended", "error", "deleted"].includes(payload.status)) {
      logWarn("Ignoring unsupported player event status", payload ?? {});
      return;
    }

    logInfo("Received player event", payload);

    if (payload.status === "playing") {
      await this.confirmCurrentTrackPlayback(payload);
      return;
    }

    await this.finishCurrentTrack(payload);
  }

  async confirmCurrentTrackPlayback(payload) {
    if (!this.currentTrack || this.currentTrack.id !== payload.trackId) {
      return;
    }

    if (this.currentTrack.playbackConfirmed) {
      return;
    }

    this.currentTrack.playbackConfirmed = true;

    logInfo("Playback confirmed for current track", {
      track: formatTrack(this.currentTrack)
    });

    for (const listener of this.trackPlaybackListeners) {
      try {
        await listener(this.currentTrack);
      } catch (error) {
        logWarn("Track playback listener failed", {
          message: error?.message ?? String(error)
        });
      }
    }
  }

  async finishCurrentTrack(payload) {
    const finishedTrack = this.currentTrack;

    if (!finishedTrack || finishedTrack.id !== payload.trackId) {
      return;
    }

    logInfo("Finishing current track", {
      status: payload.status,
      track: formatTrack(finishedTrack)
    });

    this.currentTrack = null;
    this.isPlaybackPaused = false;
    this.pushHistoryEntry(finishedTrack, payload.status);
    await this.persistRuntimeState();
    this.broadcastState();

    if (payload.status === "ended" && finishedTrack.origin === "queue") {
      await this.playlistRepository.appendTrack(finishedTrack);
    }

    if (payload.status === "error" && finishedTrack.provider === "youtube") {
      await this.playlistRepository.removeTrack(finishedTrack);
    }

    if (!payload.suppressEnsurePlayback) {
      await this.ensurePlayback();
    }

    return finishedTrack;
  }

  async ensurePlayback() {
    if (this.currentTrack || this.isAdvancing) {
      if (this.currentTrack) {
        logInfo("Playback already active", {
          track: formatTrack(this.currentTrack)
        });
      }
      return;
    }

    if (this.playbackSuppressed) {
      logInfo("Playback suppressed; not starting a track", {
        category: this.playbackSuppressedCategory || null,
        queueLength: this.queue.length
      });
      return;
    }

    if (this.stoppedTrack) {
      logInfo("Playback is manually stopped; not auto-starting a track", {
        stoppedTrack: formatTrack(this.stoppedTrack),
        queueLength: this.queue.length
      });
      return;
    }

    this.isAdvancing = true;

    try {
      const nextTrack = this.queue.shift() ?? await this.playlistRepository.getRandomTrack();

      if (!nextTrack) {
        logWarn("No track available for playback", {
          queueLength: this.queue.length
        });
        await this.persistRuntimeState();
        this.broadcastState();
        return;
      }

      await this.startTrackPlayback(nextTrack, {
        notifyTrackStartListeners: true
      });
    } finally {
      this.isAdvancing = false;
    }
  }

  async startTrackPlayback(track, { notifyTrackStartListeners = false } = {}) {
    this.stoppedTrack = null;
    this.currentTrack = {
      ...track,
      id: track.id ?? crypto.randomUUID(),
      playbackConfirmed: false
    };
    this.isPlaybackPaused = false;

    logInfo("Starting playback", {
      track: formatTrack(this.currentTrack),
      remainingQueue: this.queue.length
    });

    if (notifyTrackStartListeners) {
      for (const listener of this.trackStartListeners) {
        try {
          await listener(this.currentTrack);
        } catch (error) {
          logWarn("Track start listener failed", {
            message: error?.message ?? String(error)
          });
        }
      }
    }

    await this.persistRuntimeState();
    this.broadcastState();
    this.io.emit("player:load", {
      track: this.serializeTrack(this.currentTrack)
    });
  }

  broadcastState() {
    logInfo("Broadcasting state", {
      currentTrack: formatTrack(this.currentTrack),
      queueLength: this.queue.length
    });
    this.io.emit("state", this.getPublicState());
  }

  async togglePauseCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Pause toggle requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    this.isPlaybackPaused = !this.isPlaybackPaused;

    logInfo("Toggling playback pause state", {
      triggeredBy,
      paused: this.isPlaybackPaused,
      track: formatTrack(this.currentTrack)
    });

    this.io.emit("player:toggle-pause", {
      trackId: this.currentTrack.id,
      paused: this.isPlaybackPaused,
      triggeredBy
    });
    this.broadcastState();

    return {
      track: this.serializeTrack(this.currentTrack),
      paused: this.isPlaybackPaused
    };
  }

  async playOrPausePlayback(triggeredBy) {
    if (this.currentTrack) {
      return this.togglePauseCurrentTrack(triggeredBy);
    }

    if (this.stoppedTrack) {
      logInfo("Resuming stopped track from the beginning", {
        triggeredBy,
        track: formatTrack(this.stoppedTrack)
      });
      await this.startTrackPlayback(this.stoppedTrack, {
        notifyTrackStartListeners: false
      });

      return {
        track: this.serializeTrack(this.currentTrack),
        paused: false,
        resumedFromStopped: true
      };
    }

    logInfo("Starting playback from idle state", {
      triggeredBy,
      queueLength: this.queue.length
    });
    await this.ensurePlayback();

    return {
      track: this.serializeTrack(this.currentTrack),
      paused: false,
      resumedFromStopped: false
    };
  }

  async stopPlayback(triggeredBy) {
    if (this.currentTrack) {
      const stoppedTrack = {
        ...this.currentTrack
      };

      delete stoppedTrack.playbackConfirmed;

      logInfo("Stopping playback without advancing", {
        triggeredBy,
        track: formatTrack(stoppedTrack)
      });

      this.stoppedTrack = stoppedTrack;
      this.io.emit("player:stop", {
        reason: "manual_stop",
        triggeredBy
      });
      this.currentTrack = null;
      this.isPlaybackPaused = false;
      this.pushHistoryEntry(stoppedTrack, "stopped");
      await this.persistRuntimeState();
      this.broadcastState();

      return this.serializeTrack(this.stoppedTrack);
    }

    if (this.stoppedTrack) {
      logInfo("Stop requested while playback is already stopped", {
        triggeredBy,
        track: formatTrack(this.stoppedTrack)
      });
      return this.serializeTrack(this.stoppedTrack);
    }

    logWarn("Stop requested but no track is available", {
      triggeredBy
    });
    return null;
  }

  pushHistoryEntry(track, status) {
    if (!track) {
      return;
    }

    this.history.unshift({
      track: {
        id: track.id,
        provider: track.provider,
        url: track.url,
        title: track.title,
        key: track.key,
        origin: track.origin,
        artworkUrl: track.artworkUrl ?? "",
        requestedBy: track.requestedBy ?? null
      },
      status,
      completedAt: new Date().toISOString()
    });

    if (this.history.length > this.historyLimit) {
      this.history.length = this.historyLimit;
    }
  }

  async persistRuntimeState() {
    if (!this.runtimeStateStore) {
      return;
    }

    await this.runtimeStateStore.save({
      queue: this.queue,
      stoppedTrack: this.stoppedTrack,
      history: this.history
    });
  }
}
