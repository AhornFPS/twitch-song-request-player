import crypto from "node:crypto";
import { formatTrack, logInfo, logWarn } from "./logger.js";

export class PlayerController {
  constructor({ io, playlistRepository }) {
    this.io = io;
    this.playlistRepository = playlistRepository;
    this.queue = [];
    this.currentTrack = null;
    this.stoppedTrack = null;
    this.isAdvancing = false;
    this.isPlaybackPaused = false;
    this.playbackSuppressed = false;
    this.playbackSuppressedCategory = "";
    this.trackStartListeners = new Set();
    this.trackPlaybackListeners = new Set();
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
      queue: this.queue.map((track) => this.serializeTrack(track))
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

  async addRequest(track) {
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

    const queueTrack = {
      ...track,
      id: crypto.randomUUID(),
      origin: "queue"
    };

    this.queue.push(queueTrack);
    logInfo("Track queued", {
      track: formatTrack(queueTrack),
      queueLength: this.queue.length
    });
    this.broadcastState();
    await this.ensurePlayback();

    return {
      ...this.serializeTrack(queueTrack),
      alreadyQueued: false,
      duplicateType: null
    };
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
}
