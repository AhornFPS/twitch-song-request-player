import assert from "node:assert/strict";
import dgram from "node:dgram";
import test from "node:test";
import {
  type IncomingLanPairingRequest,
  MUSIC_LINK_PROTOCOL,
  MUSIC_LINK_VERSION,
  buildDiscoveryRequest,
  discoverLanServices,
  startLanDiscoveryResponder
} from "./lan-discovery.js";

test("LAN discovery finds a responder and derives the URL from the packet source", async () => {
  const responder = startLanDiscoveryResponder({
    role: "autodj-engine",
    displayName: "Studio AutoDJ",
    hostname: "booth-pc",
    servicePort: 3_100,
    apiPath: "/api/v1/autodj",
    appVersion: "0.1.0",
    browserOutputPort: 18_463,
    browserOutputPath: "/output",
    tokenConfigured: true,
    lanAvailable: true,
    discoveryPort: 0
  });
  const status = await responder.ready;
  assert.equal(status.running, true);

  try {
    const peers = await discoverLanServices({
      wantedRole: "autodj-engine",
      discoveryPort: status.port,
      targets: ["127.0.0.1"],
      timeoutMs: 150
    });
    assert.deepEqual(peers, [{
      role: "autodj-engine",
      displayName: "Studio AutoDJ",
      hostname: "booth-pc",
      address: "127.0.0.1",
      servicePort: 3_100,
      serviceUrl: "http://127.0.0.1:3100",
      apiPath: "/api/v1/autodj",
      appVersion: "0.1.0",
      tokenConfigured: true,
      lanAvailable: true,
      loopbackOnly: false,
      approvalState: "accepted",
      browserOutputPort: 18_463,
      browserOutputPath: "/output",
      browserOutputUrl: "http://127.0.0.1:18463/output"
    }]);
  } finally {
    await responder.close();
  }
});

test("LAN discovery uses the shared nested requester packet contract", () => {
  const packet = buildDiscoveryRequest("autodj-engine", "pair-request-1", {
    role: "music-control-center",
    displayName: "Control Center",
    hostname: "stream-pc",
    servicePort: 3_000,
    apiPath: "/",
    appVersion: "2.10.17",
    browserOutputPort: 18_464,
    browserOutputPath: "/output"
  });
  assert.deepEqual(packet.requester, {
    role: "music-control-center",
    displayName: "Control Center",
    hostname: "stream-pc",
    servicePort: 3_000,
    apiPath: "/",
    appVersion: "2.10.17",
    browserOutputPort: 18_464,
    browserOutputPath: "/output"
  });
  assert.equal("requesterRole" in packet, false);
});

test("pending pairing offers never contain the accepted credential", async () => {
  const responder = startLanDiscoveryResponder({
    role: "autodj-engine",
    displayName: "Studio AutoDJ",
    servicePort: 3_100,
    apiPath: "/api/v1/autodj",
    appVersion: "0.1.0",
    apiToken: "must-not-leak-before-accept",
    discoveryPort: 0,
    onPairingRequest() {}
  });
  const status = await responder.ready;
  const requester = dgram.createSocket("udp4");
  try {
    const reply = new Promise<Record<string, unknown>>((resolve) => {
      requester.once("message", (message) => resolve(JSON.parse(message.toString("utf8"))));
    });
    await new Promise<void>((resolve) => requester.bind(0, "127.0.0.1", resolve));
    requester.send(
      Buffer.from(JSON.stringify(buildDiscoveryRequest("autodj-engine", "private-token-check", {
        role: "music-control-center",
        displayName: "Control Center",
        servicePort: 3_000
      }))),
      status.port,
      "127.0.0.1"
    );
    const packet = await reply;
    assert.equal(packet.approvalState, "pending");
    assert.equal("apiToken" in packet, false);
  } finally {
    requester.close();
    await responder.close();
  }
});

test("a retained search retries long enough for the other app to opt in", async () => {
  const portProbe = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => portProbe.bind(0, "127.0.0.1", resolve));
  const address = portProbe.address();
  const discoveryPort = typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve) => portProbe.close(() => resolve()));

  const search = discoverLanServices({
    wantedRole: "autodj-engine",
    discoveryPort,
    targets: ["127.0.0.1"],
    timeoutMs: 2_000
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const responder = startLanDiscoveryResponder({
    role: "autodj-engine",
    displayName: "Late AutoDJ",
    servicePort: 3_100,
    apiPath: "/api/v1/autodj",
    appVersion: "0.1.0",
    discoveryPort
  });
  await responder.ready;
  try {
    const peers = await search;
    assert.equal(peers[0]?.displayName, "Late AutoDJ");
  } finally {
    await responder.close();
  }
});

test("LAN pairing waits for an explicit approval before returning a peer", async () => {
  let receivePairingRequest: (request: IncomingLanPairingRequest) => void = () => {};
  const pairingRequest = new Promise<IncomingLanPairingRequest>((resolve) => {
    receivePairingRequest = resolve;
  });
  const responder = startLanDiscoveryResponder({
    role: "autodj-engine",
    displayName: "Studio AutoDJ",
    hostname: "booth-pc",
    servicePort: 3_100,
    apiPath: "/api/v1/autodj",
    appVersion: "0.1.0",
    lanAvailable: true,
    apiToken: "pair-token-only-after-accept",
    discoveryPort: 0,
    onPairingRequest(request) {
      receivePairingRequest(request);
    }
  });
  const status = await responder.ready;

  try {
    const search = discoverLanServices({
      wantedRole: "autodj-engine",
      discoveryPort: status.port,
      targets: ["127.0.0.1"],
      timeoutMs: 120,
      approvalTimeoutMs: 2_000,
      requester: {
        role: "music-control-center",
        displayName: "Control Center",
        hostname: "stream-pc",
        servicePort: 3_000,
        appVersion: "2.10.17"
      }
    });
    const request = await pairingRequest;
    assert.equal(request.displayName, "Control Center");
    assert.equal(request.hostname, "stream-pc");
    assert.equal(request.address, "127.0.0.1");
    assert.equal(request.servicePort, 3_000);
    await new Promise((resolve) => setTimeout(resolve, 25));
    request.respond("accepted");

    const peers = await search;
    assert.equal(peers.length, 1);
    assert.equal(peers[0].approvalState, "accepted");
    assert.equal(peers[0].serviceUrl, "http://127.0.0.1:3100");
    assert.equal(peers[0].apiToken, "pair-token-only-after-accept");
  } finally {
    await responder.close();
  }
});

test("LAN discovery ignores a different protocol and stale request identity", async () => {
  const responder = startLanDiscoveryResponder({
    role: "music-control-center",
    displayName: "Control Center",
    servicePort: 3_000,
    apiPath: "/",
    appVersion: "2.10.17",
    discoveryPort: 0,
    socketFactory: undefined
  });
  const status = await responder.ready;
  assert.equal(status.running, true);
  assert.equal(MUSIC_LINK_PROTOCOL, "horngaming-music-link");
  assert.equal(MUSIC_LINK_VERSION, 1);
  try {
    const peers = await discoverLanServices({
      wantedRole: "autodj-engine",
      discoveryPort: status.port,
      targets: ["127.0.0.1"],
      timeoutMs: 120
    });
    assert.deepEqual(peers, []);
  } finally {
    await responder.close();
  }
});
