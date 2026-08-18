import crypto from "node:crypto";
import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import os from "node:os";

export const MUSIC_LINK_PROTOCOL = "horngaming-music-link";
export const MUSIC_LINK_VERSION = 1;
export const AUTODJ_DISCOVERY_PORT = 45_711;
export const CONTROL_CENTER_DISCOVERY_PORT = 45_712;

const MAX_PACKET_BYTES = 4_096;
const DEFAULT_SEARCH_TIMEOUT_MS = 1_250;
const SEARCH_RETRY_INTERVAL_MS = 750;

export type MusicLinkRole = "autodj-engine" | "music-control-center";
export type LanPairingDecision = "accepted" | "declined";
export type LanPairingState = "pending" | LanPairingDecision;

export interface LanServicePeer {
  role: MusicLinkRole;
  displayName: string;
  hostname: string;
  address: string;
  servicePort: number;
  serviceUrl: string;
  apiPath: string;
  appVersion: string;
  tokenConfigured: boolean;
  lanAvailable: boolean;
  loopbackOnly: boolean;
  approvalState: LanPairingState;
  browserOutputPort?: number;
  browserOutputPath?: string;
  browserOutputUrl?: string;
  apiToken?: string;
}

interface DiscoveryRequester {
  role: MusicLinkRole;
  displayName: string;
  hostname: string;
  servicePort: number;
  apiPath: string;
  appVersion: string;
  browserOutputPort?: number;
  browserOutputPath?: string;
}

interface DiscoveryRequest {
  protocol: typeof MUSIC_LINK_PROTOCOL;
  version: typeof MUSIC_LINK_VERSION;
  type: "discover";
  requestId: string;
  wantedRole: MusicLinkRole;
  requester: DiscoveryRequester;
}

interface DiscoveryOffer {
  protocol: typeof MUSIC_LINK_PROTOCOL;
  version: typeof MUSIC_LINK_VERSION;
  type: "offer";
  requestId: string;
  role: MusicLinkRole;
  displayName: string;
  hostname: string;
  servicePort: number;
  apiPath: string;
  appVersion: string;
  tokenConfigured: boolean;
  lanAvailable: boolean;
  loopbackOnly: boolean;
  approvalState: LanPairingState;
  browserOutputPort?: number;
  browserOutputPath?: string;
  apiToken?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRole(value: unknown): value is MusicLinkRole {
  return value === "autodj-engine" || value === "music-control-center";
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65_535;
}

function normalizeBrowserOutputPath(value: unknown): string {
  const candidate = boundedText(value, 128);
  if (!candidate) return "";
  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

function decodePacket(message: Buffer): Record<string, unknown> | null {
  if (message.byteLength === 0 || message.byteLength > MAX_PACKET_BYTES) return null;
  try {
    const value: unknown = JSON.parse(message.toString("utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isProtocolPacket(value: Record<string, unknown>): boolean {
  return value.protocol === MUSIC_LINK_PROTOCOL && value.version === MUSIC_LINK_VERSION;
}

export function buildDiscoveryRequest(
  wantedRole: MusicLinkRole,
  requestId: string = crypto.randomUUID(),
  requester: Partial<DiscoveryRequester> = {}
): DiscoveryRequest {
  return {
    protocol: MUSIC_LINK_PROTOCOL,
    version: MUSIC_LINK_VERSION,
    type: "discover",
    requestId,
    wantedRole,
    requester: {
      role: isRole(requester.role)
        ? requester.role
        : wantedRole === "autodj-engine" ? "music-control-center" : "autodj-engine",
      displayName: boundedText(requester.displayName, 96),
      hostname: boundedText(requester.hostname ?? os.hostname(), 128),
      servicePort: validPort(requester.servicePort) ? requester.servicePort : 0,
      apiPath: boundedText(requester.apiPath, 128) || "/",
      appVersion: boundedText(requester.appVersion, 48),
      ...(validPort(requester.browserOutputPort)
        ? { browserOutputPort: requester.browserOutputPort }
        : {}),
      ...(normalizeBrowserOutputPath(requester.browserOutputPath)
        ? { browserOutputPath: normalizeBrowserOutputPath(requester.browserOutputPath) }
        : {})
    }
  };
}

function parseDiscoveryRequest(message: Buffer): DiscoveryRequest | null {
  const value = decodePacket(message);
  if (
    !value ||
    !isProtocolPacket(value) ||
    value.type !== "discover" ||
    !isRole(value.wantedRole)
  ) {
    return null;
  }
  const requestId = boundedText(value.requestId, 128);
  if (!requestId) return null;
  const requester = isRecord(value.requester) ? value.requester : value;
  const requesterRole = requester.role ?? requester.requesterRole;
  return buildDiscoveryRequest(value.wantedRole, requestId, {
    role: isRole(requesterRole) ? requesterRole : undefined,
    displayName: boundedText(requester.displayName ?? requester.requesterDisplayName, 96),
    hostname: boundedText(requester.hostname ?? requester.requesterHostname, 128),
    servicePort: validPort(requester.servicePort ?? requester.requesterServicePort)
      ? Number(requester.servicePort ?? requester.requesterServicePort)
      : 0,
    apiPath: boundedText(requester.apiPath ?? requester.requesterApiPath, 128),
    appVersion: boundedText(requester.appVersion ?? requester.requesterAppVersion, 48),
    browserOutputPort: validPort(requester.browserOutputPort)
      ? Number(requester.browserOutputPort)
      : undefined,
    browserOutputPath: normalizeBrowserOutputPath(requester.browserOutputPath) || undefined
  });
}

function buildDiscoveryOffer(
  requestId: string,
  options: StartLanDiscoveryResponderOptions,
  approvalState: LanPairingState
): DiscoveryOffer {
  const apiToken = approvalState === "accepted"
    ? boundedText(options.apiToken, 512)
    : "";
  return {
    protocol: MUSIC_LINK_PROTOCOL,
    version: MUSIC_LINK_VERSION,
    type: "offer",
    requestId,
    role: options.role,
    displayName: boundedText(options.displayName, 96) || options.role,
    hostname: boundedText(options.hostname ?? os.hostname(), 128),
    servicePort: options.servicePort,
    apiPath: boundedText(options.apiPath, 128) || "/",
    appVersion: boundedText(options.appVersion, 48),
    tokenConfigured: options.tokenConfigured === true,
    lanAvailable: options.lanAvailable === true,
    loopbackOnly: options.loopbackOnly === true,
    approvalState,
    ...(validPort(options.browserOutputPort)
      ? { browserOutputPort: options.browserOutputPort }
      : {}),
    ...(normalizeBrowserOutputPath(options.browserOutputPath)
      ? { browserOutputPath: normalizeBrowserOutputPath(options.browserOutputPath) }
      : {}),
    ...(apiToken ? { apiToken } : {})
  };
}

function serviceUrl(address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

function browserOutputUrl(address: string, port: number, outputPath: string): string {
  return `${serviceUrl(address, port)}${outputPath}`;
}

function parseDiscoveryOffer(
  message: Buffer,
  remote: RemoteInfo,
  requestId: string,
  wantedRole: MusicLinkRole
): LanServicePeer | null {
  const value = decodePacket(message);
  if (
    !value ||
    !isProtocolPacket(value) ||
    value.type !== "offer" ||
    value.requestId !== requestId ||
    value.role !== wantedRole ||
    !validPort(value.servicePort)
  ) {
    return null;
  }
  const approvalState = value.approvalState === "pending" ||
      value.approvalState === "declined"
    ? value.approvalState
    : "accepted";
  const apiToken = approvalState === "accepted"
    ? boundedText(value.apiToken, 512)
    : "";
  return {
    role: wantedRole,
    displayName: boundedText(value.displayName, 96) || wantedRole,
    hostname: boundedText(value.hostname, 128),
    address: remote.address,
    servicePort: value.servicePort,
    serviceUrl: serviceUrl(remote.address, value.servicePort),
    apiPath: boundedText(value.apiPath, 128) || "/",
    appVersion: boundedText(value.appVersion, 48),
    tokenConfigured: value.tokenConfigured === true,
    lanAvailable: value.lanAvailable === true,
    loopbackOnly: value.loopbackOnly === true,
    approvalState,
    ...(validPort(value.browserOutputPort)
      ? {
          browserOutputPort: Number(value.browserOutputPort),
          browserOutputPath: normalizeBrowserOutputPath(value.browserOutputPath) || "/output",
          browserOutputUrl: browserOutputUrl(
            remote.address,
            Number(value.browserOutputPort),
            normalizeBrowserOutputPath(value.browserOutputPath) || "/output"
          )
        }
      : {}),
    ...(apiToken ? { apiToken } : {})
  };
}

export interface IncomingLanPairingRequest {
  requestId: string;
  role: MusicLinkRole;
  displayName: string;
  hostname: string;
  address: string;
  servicePort: number;
  apiPath: string;
  appVersion: string;
  browserOutputPort?: number;
  browserOutputPath?: string;
  respond(decision: LanPairingDecision): void;
}

export interface StartLanDiscoveryResponderOptions {
  role: MusicLinkRole;
  displayName: string;
  servicePort: number;
  apiPath: string;
  appVersion: string;
  browserOutputPort?: number;
  browserOutputPath?: string;
  tokenConfigured?: boolean;
  lanAvailable?: boolean;
  loopbackOnly?: boolean;
  apiToken?: string;
  hostname?: string;
  discoveryPort?: number;
  socketFactory?: () => Socket;
  pairingTimeoutMs?: number;
  onPairingRequest?: (request: IncomingLanPairingRequest) => void;
}

export interface LanDiscoveryResponder {
  ready: Promise<{ running: boolean; port: number; error: string }>;
  close(): Promise<void>;
}

export function startLanDiscoveryResponder(
  options: StartLanDiscoveryResponderOptions
): LanDiscoveryResponder {
  const socket = options.socketFactory?.() ?? dgram.createSocket("udp4");
  const pendingPairings = new Map<string, NodeJS.Timeout>();
  let closed = false;
  let readySettled = false;
  let settleReady: (value: { running: boolean; port: number; error: string }) => void = () => {};
  const ready = new Promise<{ running: boolean; port: number; error: string }>((resolve) => {
    settleReady = resolve;
  });
  const finishReady = (value: { running: boolean; port: number; error: string }) => {
    if (readySettled) return;
    readySettled = true;
    settleReady(value);
  };

  socket.on("message", (message, remote) => {
    const request = parseDiscoveryRequest(message);
    if (!request || request.wantedRole !== options.role) return;
    const sendOffer = (approvalState: LanPairingState) => {
      const response = Buffer.from(JSON.stringify(
        buildDiscoveryOffer(request.requestId, options, approvalState)
      ));
      socket.send(response, remote.port, remote.address, () => {});
    };
    if (!options.onPairingRequest) {
      sendOffer("accepted");
      return;
    }
    sendOffer("pending");
    if (pendingPairings.has(request.requestId)) return;
    let settled = false;
    const respond = (decision: LanPairingDecision) => {
      if (settled || (decision !== "accepted" && decision !== "declined")) return;
      settled = true;
      const timeoutHandle = pendingPairings.get(request.requestId);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      pendingPairings.delete(request.requestId);
      sendOffer(decision);
    };
    const timeoutHandle = setTimeout(
      () => respond("declined"),
      Math.max(5_000, Math.min(120_000, options.pairingTimeoutMs ?? 60_000))
    );
    timeoutHandle.unref?.();
    pendingPairings.set(request.requestId, timeoutHandle);
    try {
      options.onPairingRequest({
        requestId: request.requestId,
        role: request.requester.role,
        displayName: request.requester.displayName || request.requester.role,
        hostname: request.requester.hostname,
        address: remote.address,
        servicePort: request.requester.servicePort,
        apiPath: request.requester.apiPath,
        appVersion: request.requester.appVersion,
        browserOutputPort: request.requester.browserOutputPort,
        browserOutputPath: request.requester.browserOutputPath,
        respond
      });
    } catch {
      respond("declined");
    }
  });
  socket.once("error", (error) => {
    finishReady({ running: false, port: 0, error: error.message });
  });
  socket.once("listening", () => {
    const address = socket.address();
    finishReady({
      running: true,
      port: typeof address === "object" ? address.port : 0,
      error: ""
    });
  });
  socket.bind(options.discoveryPort ?? CONTROL_CENTER_DISCOVERY_PORT, "0.0.0.0");

  return {
    ready,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const timeoutHandle of pendingPairings.values()) clearTimeout(timeoutHandle);
      pendingPairings.clear();
      await new Promise<void>((resolve) => {
        try {
          socket.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  };
}

export interface DiscoverLanServicesOptions {
  wantedRole: MusicLinkRole;
  discoveryPort: number;
  timeoutMs?: number;
  approvalTimeoutMs?: number;
  targets?: string[];
  socketFactory?: () => Socket;
  requester?: Partial<DiscoveryRequester>;
}

export async function discoverLanServices(
  options: DiscoverLanServicesOptions
): Promise<LanServicePeer[]> {
  const socket = options.socketFactory?.() ?? dgram.createSocket("udp4");
  const timeoutMs = Math.max(100, Math.min(120_000, options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS));
  const targets = options.targets?.length ? options.targets : ["127.0.0.1", "255.255.255.255"];
  const approvalTimeoutMs = Math.max(
    timeoutMs,
    Math.min(120_000, options.approvalTimeoutMs ?? 60_000)
  );
  const request = buildDiscoveryRequest(options.wantedRole, crypto.randomUUID(), options.requester);
  const packet = Buffer.from(JSON.stringify(request));
  const peers = new Map<string, LanServicePeer>();
  const pendingPeers = new Set<string>();
  const declinedPeers = new Set<string>();

  return await new Promise<LanServicePeer[]>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let retryTimer: NodeJS.Timeout | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (retryTimer) clearInterval(retryTimer);
      try {
        socket.close();
      } catch {
      }
      if (error) {
        reject(error);
      } else {
        resolve([...peers.values()].sort((left, right) => (
          left.displayName.localeCompare(right.displayName) || left.address.localeCompare(right.address)
        )));
      }
    };

    socket.on("message", (message, remote) => {
      const peer = parseDiscoveryOffer(message, remote, request.requestId, options.wantedRole);
      if (!peer) return;
      const key = `${peer.role}|${peer.hostname}|${peer.servicePort}`;
      if (peer.approvalState === "pending") {
        const alreadyPending = pendingPeers.has(key);
        pendingPeers.add(key);
        if (!alreadyPending && approvalTimeoutMs > timeoutMs) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => finish(), approvalTimeoutMs);
          timer.unref?.();
        }
        return;
      }
      if (peer.approvalState === "declined") {
        declinedPeers.add(key);
        if (pendingPeers.size > 0 && [...pendingPeers].every((pendingKey) => declinedPeers.has(pendingKey))) {
          finish();
        }
        return;
      }
      const existing = peers.get(key);
      if (!existing || (!existing.address.startsWith("127.") && peer.address.startsWith("127."))) {
        peers.set(key, peer);
      }
      finish();
    });
    socket.once("error", (error) => finish(error));
    socket.once("listening", () => {
      try {
        if (targets.includes("255.255.255.255")) socket.setBroadcast(true);
      } catch {
      }
      for (const target of new Set(targets)) {
        socket.send(packet, options.discoveryPort, target, () => {});
      }
      retryTimer = setInterval(() => {
        for (const target of new Set(targets)) {
          socket.send(packet, options.discoveryPort, target, () => {});
        }
      }, SEARCH_RETRY_INTERVAL_MS);
      retryTimer.unref?.();
      timer = setTimeout(() => finish(), timeoutMs);
    });
    socket.bind(0, "0.0.0.0");
  });
}

export function discoverAutoDjEngines(
  timeoutMs?: number,
  requester?: DiscoverLanServicesOptions["requester"]
): Promise<LanServicePeer[]> {
  return discoverLanServices({
    wantedRole: "autodj-engine",
    discoveryPort: AUTODJ_DISCOVERY_PORT,
    timeoutMs,
    requester
  });
}
