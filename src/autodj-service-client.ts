// @ts-nocheck
import crypto from "node:crypto";
import {
  AUTODJ_API_PREFIX,
  AUTODJ_API_VERSION,
  normalizeAutoDjLeaseSeconds,
  normalizeAutoDjServiceUrl
} from "./autodj-service-contract.js";

export class AutoDjServiceClient {
  constructor({
    serviceUrl,
    browserOutputUrl = "",
    token,
    fetchImpl = globalThis.fetch,
    timeoutMs = 2500,
    applicationTimeoutMs = 10_000,
    leaseSeconds = 90,
    clientInstanceId = crypto.randomUUID(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    now = () => Date.now(),
    logInfo = () => {},
    logWarn = () => {}
  } = {}) {
    this.serviceUrl = normalizeAutoDjServiceUrl(serviceUrl);
    this.configuredBrowserOutputUrl = String(browserOutputUrl ?? "").trim();
    this.token = String(token ?? "").trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(250, Math.min(10_000, Number(timeoutMs) || 2500));
    this.applicationTimeoutMs = Math.max(1000, Math.min(30_000, Number(applicationTimeoutMs) || 10_000));
    this.leaseSeconds = normalizeAutoDjLeaseSeconds(leaseSeconds);
    this.clientInstanceId = clientInstanceId;
    this.leaseId = crypto.randomUUID();
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.now = now;
    this.logInfo = logInfo;
    this.logWarn = logWarn;
    this.heartbeat = null;
    this.trackMonitor = null;
    this.trackMonitorPolling = false;
    this.remoteTrackInitialized = false;
    this.remoteCurrentTrack = null;
    this.remoteTrackListeners = new Set();
    this.remoteStateListeners = new Set();
    this.activeTrack = null;
    this.lastStatus = {
      configured: Boolean(this.serviceUrl),
      connected: false,
      takeoverActive: false,
      serviceUrl: this.serviceUrl,
      browserOutputUrl: this.configuredBrowserOutputUrl,
      activation: null,
      state: null,
      engineEpoch: "",
      revision: null,
      lastSuccessAt: null,
      lastSeenAt: null,
      lastError: ""
    };
  }

  getStatus() {
    const lastSeenMs = Date.parse(this.lastStatus.lastSeenAt || "");
    const seenAgeMs = Number.isFinite(lastSeenMs) ? Math.max(0, this.now() - lastSeenMs) : null;
    return {
      ...this.lastStatus,
      liveness: this.lastStatus.connected
        ? "responding"
        : seenAgeMs !== null && seenAgeMs <= 15_000
          ? "recently-seen"
          : "unavailable",
      lastSeenAgeMs: seenAgeMs,
      activation: this.lastStatus.activation ? { ...this.lastStatus.activation } : null,
      state: this.lastStatus.state ? structuredClone(this.lastStatus.state) : null,
      activeTrack: this.activeTrack ? { ...this.activeTrack } : null
    };
  }

  getBrowserOutputUrl() {
    return this.lastStatus.browserOutputUrl || this.configuredBrowserOutputUrl || "";
  }

  async probe() {
    if (!this.serviceUrl) {
      return this.getStatus();
    }
    try {
      const health = await this.request(
        "GET",
        `${AUTODJ_API_PREFIX}/${this.token ? "state" : "health"}`
      );
      this.markSuccess(health);
    } catch (error) {
      this.markFailure(error);
    }
    return this.getStatus();
  }

  async queueOwnedRequest(track) {
    if (!this.serviceUrl || !track || typeof track !== "object") {
      return { matched: false, queued: false, track: null };
    }
    const body = this.commandBody({
      track: {
        id: String(track.id ?? ""),
        provider: String(track.provider ?? ""),
        url: String(track.url ?? ""),
        title: String(track.title ?? ""),
        artist: String(track.artist ?? ""),
        trackTitle: String(track.trackTitle ?? ""),
        key: String(track.key ?? ""),
        durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
        sourceName: String(track.sourceName ?? ""),
        sourceUrl: String(track.sourceUrl ?? ""),
        requestedFromProvider: String(track.requestedFromProvider ?? ""),
        requestedFromUrl: String(track.requestedFromUrl ?? ""),
        requestedFromTitle: String(track.requestedFromTitle ?? ""),
        requestedFromName: String(track.requestedFromName ?? ""),
        requestedFromKey: String(track.requestedFromKey ?? ""),
        requestedBy: track.requestedBy && typeof track.requestedBy === "object"
          ? {
              username: String(track.requestedBy.username ?? ""),
              displayName: String(track.requestedBy.displayName ?? "")
            }
          : null
      }
    });
    try {
      const result = await this.requestWithRetries("POST", `${AUTODJ_API_PREFIX}/requests/owned`, body);
      this.markSuccess(result);
      if (result?.matched) {
        this.logInfo("Routed owned request to the AutoDJ mix queue", {
          track: result.track,
          queuePosition: result.queuePosition,
          duplicateType: result.duplicateType
        });
      }
      return result;
    } catch (error) {
      this.markFailure(error);
      this.logWarn("Could not route request through the AutoDJ owned-track queue", {
        track: { id: track.id, title: track.title, provider: track.provider },
        message: error?.message ?? String(error)
      });
      return {
        matched: false,
        queued: false,
        track: null,
        unavailable: true,
        error: error?.message ?? String(error)
      };
    }
  }

  getRemoteCurrentTrack() {
    return this.remoteCurrentTrack ? { ...this.remoteCurrentTrack } : null;
  }

  onRemoteTrackStart(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.remoteTrackListeners.add(listener);
    return () => this.remoteTrackListeners.delete(listener);
  }

  onRemoteState(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.remoteStateListeners.add(listener);
    return () => this.remoteStateListeners.delete(listener);
  }

  async pollRemoteTrack() {
    if (!this.serviceUrl || this.trackMonitorPolling) {
      return this.getRemoteCurrentTrack();
    }
    this.trackMonitorPolling = true;
    try {
      const state = await this.request("GET", `${AUTODJ_API_PREFIX}/state`);
      this.markSuccess(state);
      for (const listener of this.remoteStateListeners) {
        try {
          listener(this.getStatus());
        } catch (error) {
          this.logWarn("AutoDJ remote-state listener failed", {
            message: error?.message ?? String(error)
          });
        }
      }
      const track = state?.autoDj?.currentTrack && typeof state.autoDj.currentTrack === "object"
        ? { ...state.autoDj.currentTrack }
        : null;
      const trackId = String(track?.id ?? "");
      const previousId = String(this.remoteCurrentTrack?.id ?? "");
      this.remoteCurrentTrack = track;
      if (!this.remoteTrackInitialized) {
        this.remoteTrackInitialized = true;
        return this.getRemoteCurrentTrack();
      }
      if (!trackId || trackId === previousId) {
        return this.getRemoteCurrentTrack();
      }
      for (const listener of this.remoteTrackListeners) {
        try {
          await listener({ ...track });
        } catch (error) {
          this.logWarn("AutoDJ remote-track listener failed", {
            track: { id: track.id, title: track.title },
            message: error?.message ?? String(error)
          });
        }
      }
      return this.getRemoteCurrentTrack();
    } catch (error) {
      this.markFailure(error);
      return this.getRemoteCurrentTrack();
    } finally {
      this.trackMonitorPolling = false;
    }
  }

  async startTrackMonitor({ intervalMs = 3000 } = {}) {
    if (this.trackMonitor || !this.serviceUrl) {
      return this.getRemoteCurrentTrack();
    }
    await this.pollRemoteTrack();
    const safeIntervalMs = Math.max(1000, Math.min(30_000, Number(intervalMs) || 3000));
    this.trackMonitor = this.setIntervalFn(() => {
      void this.pollRemoteTrack();
    }, safeIntervalMs);
    this.trackMonitor?.unref?.();
    return this.getRemoteCurrentTrack();
  }

  stopTrackMonitor() {
    if (!this.trackMonitor) {
      return;
    }
    this.clearIntervalFn(this.trackMonitor);
    this.trackMonitor = null;
  }

  async mixNext({ triggeredBy = "twitch_chat", leadSeconds = 5 } = {}) {
    if (!this.serviceUrl) {
      return null;
    }
    try {
      const result = await this.requestWithRetries(
        "POST",
        `${AUTODJ_API_PREFIX}/control/mix-next`,
        this.commandBody({ triggeredBy, leadSeconds })
      );
      this.markSuccess(result);
      if (!result?.ok) {
        return null;
      }
      await this.waitForCommandApplication(result, { requirePlaybackActive: true });
      return {
        ...(result.track ?? this.getRemoteCurrentTrack() ?? {}),
        autoDjMixQueued: true,
        transition: result.transition ?? null
      };
    } catch (error) {
      this.markFailure(error);
      this.logWarn("Could not bring the next AutoDJ mix forward", {
        triggeredBy,
        message: error?.message ?? String(error)
      });
      return null;
    }
  }

  async setActivation(enabled, {
    fadeSeconds = 2,
    reason = "music_control_center"
  } = {}) {
    if (!this.serviceUrl) {
      throw new Error("The AutoDJ service URL is not configured.");
    }
    try {
      const result = await this.requestWithRetries(
        "POST",
        `${AUTODJ_API_PREFIX}/control/activation`,
        this.commandBody({
          ...(Number.isInteger(this.lastStatus.revision)
            ? { expectedRevision: this.lastStatus.revision }
            : {}),
          enabled: enabled === true,
          fadeSeconds: Math.max(0, Math.min(10, Number(fadeSeconds) || 0)),
          reason: String(reason || "music_control_center")
        })
      );
      this.markSuccess(result);
      await this.waitForCommandApplication(result, {
        requireActivation: enabled === true
      });
      this.logInfo("Applied Music Control Center AutoDJ authority", {
        enabled: enabled === true,
        revision: this.lastStatus.revision
      });
      return result;
    } catch (error) {
      this.markFailure(error);
      this.logWarn("Could not apply Music Control Center AutoDJ authority", {
        enabled: enabled === true,
        message: error?.message ?? String(error)
      });
      throw error;
    }
  }

  async acquire(track) {
    if (!this.serviceUrl || !track || track.provider === "local" || track.origin === "local") {
      return null;
    }
    const activeTrack = {
      id: String(track.id ?? ""),
      title: String(track.title ?? ""),
      provider: String(track.provider ?? "")
    };
    this.activeTrack = activeTrack;
    try {
      const result = await this.sendAcquire("request-starting", { requireApplied: true });
      this.startHeartbeat();
      return result;
    } catch (error) {
      this.stopHeartbeat();
      this.activeTrack = null;
      this.lastStatus.takeoverActive = false;
      throw error;
    }
  }

  async getRequestHandoffReadiness({ leadSeconds = 3 } = {}) {
    if (!this.serviceUrl) {
      return { ready: false, error: "AutoDJ is not configured." };
    }
    try {
      const payload = await this.requestWithRetries("GET", `${AUTODJ_API_PREFIX}/state`, undefined, {
        retryDelaysMs: [250]
      });
      this.markSuccess(payload);
      const state = payload?.state && typeof payload.state === "object" ? payload.state : payload;
      const autoDj = state?.autoDj && typeof state.autoDj === "object" ? state.autoDj : {};
      if (state?.takeover || this.lastStatus.takeoverActive) {
        return { ready: true };
      }
      if (autoDj.playbackStatus !== "playing" || !autoDj.currentTrack) {
        return { ready: true };
      }
      if (autoDj.transitionLive === true) {
        return {
          ready: false,
          retryAfterMs: 1_000,
          error: "Waiting for the active AutoDJ transition to finish."
        };
      }
      const safeLeadSeconds = Math.max(1, Math.min(8, Number(leadSeconds) || 3));
      const publishedHandoff = typeof autoDj.naturalHandoffInSeconds === "number"
        ? autoDj.naturalHandoffInSeconds
        : Number.NaN;
      const playbackRate = Number.isFinite(autoDj.playbackRate) && autoDj.playbackRate > 0
        ? autoDj.playbackRate
        : 1;
      const fallbackRemaining = Number.isFinite(autoDj.durationSeconds) && Number.isFinite(autoDj.currentTimeSeconds)
        ? Math.max(0, (autoDj.durationSeconds - autoDj.currentTimeSeconds) / playbackRate)
        : null;
      const handoffInSeconds = Number.isFinite(publishedHandoff)
        ? Math.max(0, publishedHandoff)
        : fallbackRemaining;
      if (handoffInSeconds !== null && handoffInSeconds > safeLeadSeconds) {
        return {
          ready: false,
          retryAfterMs: Math.max(500, Math.min(15_000, (handoffInSeconds - safeLeadSeconds) * 1_000)),
          error: `Waiting ${Math.ceil(handoffInSeconds)} seconds for AutoDJ's natural handoff.`
        };
      }
      return { ready: true };
    } catch (error) {
      this.markFailure(error);
      return {
        ready: false,
        retryAfterMs: 3_000,
        error: error?.message ?? "AutoDJ state is temporarily unavailable."
      };
    }
  }

  async release(reason = "request_finished") {
    if (!this.serviceUrl) {
      return null;
    }
    this.stopHeartbeat();
    const body = this.commandBody({ reason });
    try {
      const result = await this.requestWithRetries("POST", `${AUTODJ_API_PREFIX}/handoff/request-finished`, body);
      this.markSuccess(result);
      await this.waitForCommandApplication(result, {
        requireLeaseReleased: true,
        requirePlaybackActive: this.lastStatus.activation?.effective === true
      });
      this.activeTrack = null;
      this.lastStatus.takeoverActive = false;
      this.logInfo("Released AutoDJ request takeover", { reason, leaseId: this.leaseId });
      this.leaseId = crypto.randomUUID();
      return result;
    } catch (error) {
      this.markFailure(error);
      this.logWarn("Could not release AutoDJ request takeover", { reason, message: error?.message ?? String(error) });
      throw error;
    }
  }

  async close() {
    this.stopHeartbeat();
    this.stopTrackMonitor();
    this.remoteTrackListeners.clear();
    this.remoteStateListeners.clear();
  }

  async sendAcquire(reason, { requireApplied = false } = {}) {
    const body = this.commandBody({
      leaseSeconds: this.leaseSeconds,
      fadeSeconds: reason === "request-starting" ? 2 : 0,
      track: this.activeTrack,
      reason
    });
    try {
      const result = await this.requestWithRetries("POST", `${AUTODJ_API_PREFIX}/handoff/request-starting`, body);
      this.lastStatus.takeoverActive = true;
      this.markSuccess(result);
      if (requireApplied) {
        await this.waitForCommandApplication(result, { requireLeaseId: this.leaseId });
      }
      if (reason === "request-starting") {
        this.logInfo("Acquired AutoDJ request takeover", { track: this.activeTrack, leaseId: this.leaseId });
      }
      return result;
    } catch (error) {
      this.markFailure(error);
      this.logWarn("Could not acquire AutoDJ request takeover", {
        track: this.activeTrack,
        message: error?.message ?? String(error)
      });
      throw error;
    }
  }

  startHeartbeat() {
    if (this.heartbeat) {
      return;
    }
    const intervalMs = Math.max(5000, Math.floor(this.leaseSeconds * 1000 / 3));
    this.heartbeat = this.setIntervalFn(() => {
      if (!this.activeTrack) {
        return;
      }
      void this.sendAcquire("renew").catch(() => {});
    }, intervalMs);
    this.heartbeat?.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeat) {
      return;
    }
    this.clearIntervalFn(this.heartbeat);
    this.heartbeat = null;
  }

  commandBody(extra = {}) {
    return {
      apiVersion: AUTODJ_API_VERSION,
      commandId: crypto.randomUUID(),
      clientInstanceId: this.clientInstanceId,
      leaseId: this.leaseId,
      ...extra
    };
  }

  async request(method, path, body = undefined) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Fetch is unavailable for the AutoDJ service client.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout?.unref?.();
    try {
      const response = await this.fetchImpl(`${this.serviceUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `AutoDJ service returned HTTP ${response.status}.`);
        error.code = payload.code || "autodj_service_error";
        error.statusCode = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestWithRetries(method, path, body = undefined, {
    retryDelaysMs = [250, 1000]
  } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        return await this.request(method, path, body);
      } catch (error) {
        lastError = error;
        const retryable = !Number.isInteger(error?.statusCode) || error.statusCode >= 500;
        if (!retryable || attempt >= retryDelaysMs.length) {
          throw error;
        }
        await new Promise((resolve) => {
          const timer = this.setTimeoutFn(resolve, retryDelaysMs[attempt]);
          timer?.unref?.();
        });
      }
    }
    throw lastError ?? new Error("AutoDJ service request failed.");
  }

  async waitForCommandApplication(command, {
    requireLeaseId = "",
    requireLeaseReleased = false,
    requireActivation = null,
    requirePlaybackActive = false
  } = {}) {
    const sequence = Number(command?.sequence);
    if (!Number.isInteger(sequence)) {
      throw new Error("AutoDJ did not return a command sequence acknowledgement.");
    }
    const deadline = this.now() + this.applicationTimeoutMs;
    while (this.now() < deadline) {
      const state = await this.requestWithRetries("GET", `${AUTODJ_API_PREFIX}/state`, undefined, {
        retryDelaysMs: [250]
      });
      this.markSuccess(state);
      const application = state?.application ?? state?.state?.application ?? {};
      const lastAppliedSequence = Number(application.lastAppliedSequence);
      const outcome = String(application.lastApplyOutcome ?? "");
      if (lastAppliedSequence >= sequence) {
        if (outcome !== "applied") {
          const error = new Error(application.lastApplyError || "AutoDJ could not apply the control command.");
          error.code = "autodj_application_failed";
          throw error;
        }
        const resolvedState = state?.state && typeof state.state === "object" ? state.state : state;
        const takeover = resolvedState?.takeover ?? null;
        const activation = resolvedState?.activation ?? null;
        if (requireLeaseId && takeover?.leaseId !== requireLeaseId) {
          throw new Error("AutoDJ applied the command without confirming this request takeover lease.");
        }
        if (requireLeaseReleased && takeover) {
          throw new Error("AutoDJ applied the release command but still reports an active takeover lease.");
        }
        if (typeof requireActivation === "boolean" && activation?.effective !== requireActivation) {
          throw new Error("AutoDJ applied the activation command but did not confirm the requested state.");
        }
        if (requirePlaybackActive && resolvedState?.autoDj?.playbackStatus !== "playing") {
          await new Promise((resolve) => {
            const timer = this.setTimeoutFn(resolve, 200);
            timer?.unref?.();
          });
          continue;
        }
        return resolvedState;
      }
      await new Promise((resolve) => {
        const timer = this.setTimeoutFn(resolve, 200);
        timer?.unref?.();
      });
    }
    const error = new Error("AutoDJ did not confirm playback application before the safety deadline.");
    error.code = "autodj_application_timeout";
    throw error;
  }

  markSuccess(payload) {
    const state = payload?.state && typeof payload.state === "object"
      ? payload.state
      : payload?.autoDj || payload?.activation || payload?.browserOutput
        ? payload
        : null;
    const browserOutput = state?.browserOutput ?? payload?.browserOutput;
    if (browserOutput?.available !== false && Number.isInteger(browserOutput?.port)) {
      try {
        const service = new URL(this.serviceUrl);
        const outputPath = String(browserOutput.path || "/output");
        service.port = String(browserOutput.port);
        service.pathname = outputPath.startsWith("/") ? outputPath : `/${outputPath}`;
        service.search = "";
        service.hash = "";
        this.lastStatus.browserOutputUrl = service.toString().replace(/\/$/, "");
      } catch {
      }
    }
    const nextEpoch = payload?.engineEpoch ?? payload?.state?.engineEpoch ?? "";
    const nextRevision = payload?.revision ?? payload?.state?.revision;
    if (
      nextEpoch &&
      nextEpoch === this.lastStatus.engineEpoch &&
      Number.isInteger(nextRevision) &&
      Number.isInteger(this.lastStatus.revision) &&
      nextRevision < this.lastStatus.revision
    ) {
      return false;
    }
    this.lastStatus.connected = true;
    this.lastStatus.engineEpoch = payload?.engineEpoch ?? payload?.state?.engineEpoch ?? this.lastStatus.engineEpoch;
    this.lastStatus.revision = payload?.revision ?? payload?.state?.revision ?? this.lastStatus.revision;
    this.lastStatus.activation = state?.activation && typeof state.activation === "object"
      ? { ...state.activation }
      : this.lastStatus.activation;
    this.lastStatus.state = state ? structuredClone(state) : this.lastStatus.state;
    this.lastStatus.lastSuccessAt = new Date().toISOString();
    this.lastStatus.lastSeenAt = this.lastStatus.lastSuccessAt;
    this.lastStatus.lastError = "";
    return true;
  }

  markFailure(error) {
    this.lastStatus.connected = false;
    this.lastStatus.lastError = error?.message ?? String(error);
  }
}
