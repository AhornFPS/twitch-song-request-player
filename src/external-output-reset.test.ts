import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS,
  requestExternalOutputReset,
  type ExternalOutputResetOptions,
  type ExternalOutputResetRequest,
  type ExternalOutputResetSocket
} from "./external-output-reset.js";

interface ScheduledTimer {
  callback: () => void;
  timeoutMs: number;
}

function fakeTimers() {
  const scheduled: ScheduledTimer[] = [];
  const cleared: ScheduledTimer[] = [];
  return {
    scheduled,
    cleared,
    scheduleTimeout(callback: () => void, timeoutMs: number) {
      const timer = { callback, timeoutMs };
      scheduled.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearScheduledTimeout(handle: ReturnType<typeof setTimeout>) {
      cleared.push(handle as unknown as ScheduledTimer);
    }
  };
}

function requestOptions(
  overrides: Partial<ExternalOutputResetOptions> = {}
): ExternalOutputResetOptions {
  return {
    socket: null,
    requestId: "reset-123",
    reason: "external_playback_handoff",
    trackId: "soundcloud:secret-track",
    ...overrides
  };
}

test("sends the exact reset request and accepts one matching positive acknowledgement", async () => {
  const timers = fakeTimers();
  const emissions: Array<{ event: string; payload: ExternalOutputResetRequest }> = [];
  let acknowledge: (response: unknown) => void = () => assert.fail("acknowledgement callback missing");
  const socket: ExternalOutputResetSocket = {
    connected: true,
    emit(event, payload, callback) {
      emissions.push({ event, payload });
      acknowledge = callback;
    }
  };

  const operation = requestExternalOutputReset(requestOptions({ socket, ...timers }));
  assert.deepEqual(emissions, [{
    event: "player:reset-output",
    payload: {
      requestId: "reset-123",
      reason: "external_playback_handoff",
      trackId: "soundcloud:secret-track"
    }
  }]);
  assert.equal(timers.scheduled[0]?.timeoutMs, DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS);

  acknowledge({ requestId: "reset-123", acknowledged: true });
  acknowledge({ requestId: "reset-123", acknowledged: false, reason: "late_duplicate" });

  assert.deepEqual(await operation, {
    ok: true,
    requestId: "reset-123",
    acknowledged: true
  });
  assert.equal(timers.cleared.length, 1);
  assert.equal(timers.cleared[0], timers.scheduled[0]);
});

test("fails without scheduling when the authority socket is absent or disconnected", async () => {
  for (const [socket, expectedReason] of [
    [null, "no_socket"],
    [{ connected: false, emit() {} }, "socket_disconnected"]
  ] as const) {
    const timers = fakeTimers();
    assert.deepEqual(
      await requestExternalOutputReset(requestOptions({ socket, ...timers })),
      {
        ok: false,
        requestId: "reset-123",
        acknowledged: false,
        reason: expectedReason
      }
    );
    assert.equal(timers.scheduled.length, 0);
    assert.equal(timers.cleared.length, 0);
  }
});

test("turns synchronous emit failures into a typed result and clears its timer once", async () => {
  const timers = fakeTimers();
  const socket: ExternalOutputResetSocket = {
    connected: true,
    emit() {
      throw new Error("transport exploded");
    }
  };

  assert.deepEqual(
    await requestExternalOutputReset(requestOptions({ socket, ...timers })),
    {
      ok: false,
      requestId: "reset-123",
      acknowledged: false,
      reason: "emit_failed",
      message: "transport exploded"
    }
  );
  assert.equal(timers.cleared.length, 1);
});

test("rejects mismatched and negative acknowledgements with distinct typed reasons", async () => {
  for (const [response, expected] of [
    [
      { requestId: "some-other-reset", acknowledged: true },
      { reason: "acknowledgement_mismatch" }
    ],
    [
      { requestId: "reset-123", acknowledged: false, reason: "output_reset_busy", message: "busy" },
      { reason: "acknowledgement_rejected", responseReason: "output_reset_busy", message: "busy" }
    ]
  ] as const) {
    const timers = fakeTimers();
    const socket: ExternalOutputResetSocket = {
      connected: true,
      emit(_event, _payload, acknowledge) {
        acknowledge(response);
      }
    };

    assert.deepEqual(
      await requestExternalOutputReset(requestOptions({ socket, ...timers })),
      {
        ok: false,
        requestId: "reset-123",
        acknowledged: false,
        ...expected
      }
    );
    assert.equal(timers.cleared.length, 1);
  }
});

test("times out within the configured bound and ignores a late acknowledgement", async () => {
  const timers = fakeTimers();
  let acknowledge: (response: unknown) => void = () => assert.fail("acknowledgement callback missing");
  const socket: ExternalOutputResetSocket = {
    connected: true,
    emit(_event, _payload, callback) {
      acknowledge = callback;
    }
  };
  const operation = requestExternalOutputReset(requestOptions({
    socket,
    timeoutMs: DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS + 10_000,
    ...timers
  }));

  assert.equal(timers.scheduled[0]?.timeoutMs, DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS);
  timers.scheduled[0]?.callback();
  assert.deepEqual(await operation, {
    ok: false,
    requestId: "reset-123",
    acknowledged: false,
    reason: "timeout"
  });

  acknowledge({ requestId: "reset-123", acknowledged: true });
  timers.scheduled[0]?.callback();
  assert.equal(timers.cleared.length, 1);
});
