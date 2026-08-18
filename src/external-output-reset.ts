export const DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS = 35_000;

export type ExternalOutputResetFailureReason =
  | "no_socket"
  | "socket_disconnected"
  | "emit_failed"
  | "acknowledgement_mismatch"
  | "acknowledgement_rejected"
  | "timeout";

export interface ExternalOutputResetRequest {
  requestId: string;
  reason: string;
  trackId: string;
}

export interface ExternalOutputResetAcknowledgement {
  requestId: string;
  acknowledged: true;
}

export interface ExternalOutputResetSuccess extends ExternalOutputResetAcknowledgement {
  ok: true;
}

export interface ExternalOutputResetFailure {
  ok: false;
  requestId: string;
  acknowledged: false;
  reason: ExternalOutputResetFailureReason;
  responseReason?: string;
  message?: string;
}

export type ExternalOutputResetResult = ExternalOutputResetSuccess | ExternalOutputResetFailure;

export interface ExternalOutputResetSocket {
  readonly connected?: boolean;
  emit(
    event: "player:reset-output",
    payload: ExternalOutputResetRequest,
    acknowledge: (response: unknown) => void
  ): unknown;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface ExternalOutputResetOptions extends ExternalOutputResetRequest {
  socket: ExternalOutputResetSocket | null | undefined;
  timeoutMs?: number;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => TimeoutHandle;
  clearScheduledTimeout?: (handle: TimeoutHandle) => void;
}

function failure(
  requestId: string,
  reason: ExternalOutputResetFailureReason,
  details: Pick<ExternalOutputResetFailure, "responseReason" | "message"> = {}
): ExternalOutputResetFailure {
  return {
    ok: false,
    requestId,
    acknowledged: false,
    reason,
    ...details
  };
}

function timeoutMilliseconds(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || (timeoutMs ?? 0) <= 0) {
    return DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS;
  }
  return Math.min(
    DEFAULT_EXTERNAL_OUTPUT_RESET_TIMEOUT_MS,
    Math.max(1, Math.trunc(timeoutMs as number))
  );
}

function responseRecord(response: unknown): Record<string, unknown> | null {
  return response !== null && typeof response === "object"
    ? response as Record<string, unknown>
    : null;
}

/**
 * Establishes a silent output boundary with one authoritative playback client.
 * Expected transport failures resolve to a typed result so callers can fail
 * closed without parsing exceptions or human-readable messages.
 */
export function requestExternalOutputReset(
  options: ExternalOutputResetOptions
): Promise<ExternalOutputResetResult> {
  const { socket, requestId, reason, trackId } = options;
  if (!socket) {
    return Promise.resolve(failure(requestId, "no_socket"));
  }
  if (socket.connected !== true) {
    return Promise.resolve(failure(requestId, "socket_disconnected"));
  }

  const scheduleTimeout = options.scheduleTimeout ?? (
    (callback: () => void, timeoutMs: number): TimeoutHandle => setTimeout(callback, timeoutMs)
  );
  const clearScheduledTimeout = options.clearScheduledTimeout ?? (
    (handle: TimeoutHandle): void => clearTimeout(handle)
  );

  return new Promise((resolve) => {
    let settled = false;
    let timeoutCleared = false;
    let handle: TimeoutHandle;

    const settle = (result: ExternalOutputResetResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (!timeoutCleared) {
        timeoutCleared = true;
        clearScheduledTimeout(handle);
      }
      resolve(result);
    };

    handle = scheduleTimeout(() => {
      settle(failure(requestId, "timeout"));
    }, timeoutMilliseconds(options.timeoutMs));

    const payload: ExternalOutputResetRequest = { requestId, reason, trackId };
    try {
      socket.emit("player:reset-output", payload, (response) => {
        const record = responseRecord(response);
        if (!record || record.requestId !== requestId) {
          settle(failure(requestId, "acknowledgement_mismatch"));
          return;
        }
        if (record.acknowledged === true) {
          settle({ ok: true, requestId, acknowledged: true });
          return;
        }
        if (record.acknowledged === false) {
          settle(failure(requestId, "acknowledgement_rejected", {
            ...(typeof record.reason === "string" ? { responseReason: record.reason } : {}),
            ...(typeof record.message === "string" ? { message: record.message } : {})
          }));
          return;
        }
        settle(failure(requestId, "acknowledgement_mismatch"));
      });
    } catch (error) {
      settle(failure(requestId, "emit_failed", {
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  });
}
