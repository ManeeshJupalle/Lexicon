// Evidence for GET /health.
//
// It performs no probe. The only true test of upstream reachability is a WebSocket upgrade
// against the streaming endpoint, which opens a real session; a health check that quietly
// opens sessions is worse than one that admits it knows less. So this reports two things
// it can honestly know — whether a key is configured, and what upstream traffic has
// actually been observed — and the response says `probed: false` rather than claiming
// reachability it has not established. A live session is real evidence; silence is not
// evidence of anything, and the field names say so.

const state = {
  liveSessions: 0,
  lastFrameAt: null as number | null,
  lastCloseCode: null as number | null,
  lastCloseReason: null as string | null,
  lastError: null as string | null,
};

export function noteUpstreamOpen(): void {
  state.liveSessions += 1;
}

export function noteUpstreamFrame(): void {
  state.lastFrameAt = Date.now();
}

export function noteUpstreamClosed(code: number, reason: string): void {
  state.liveSessions = Math.max(0, state.liveSessions - 1);
  state.lastCloseCode = code;
  state.lastCloseReason = reason;
}

export function noteUpstreamError(message: string): void {
  state.lastError = message;
}

export interface HealthReport {
  /** Captions can be served. The answer layer being unconfigured degrades the ask panel,
   *  not the captions, so it is reported beside `ok` rather than folded into it. */
  ok: boolean;
  apiKeyConfigured: boolean;
  answerConfigured: boolean;
  upstream: {
    probed: false;
    note: string;
    liveSessions: number;
    lastFrameAt: string | null;
    lastCloseCode: number | null;
    lastCloseReason: string | null;
    lastError: string | null;
  };
}

export function healthReport(apiKeyConfigured: boolean, answerConfigured: boolean): HealthReport {
  return {
    ok: apiKeyConfigured,
    apiKeyConfigured,
    answerConfigured,
    upstream: {
      probed: false,
      note: "no upstream probe is performed; liveSessions and lastFrameAt are observed traffic, silence is not a failure signal",
      liveSessions: state.liveSessions,
      lastFrameAt: state.lastFrameAt === null ? null : new Date(state.lastFrameAt).toISOString(),
      lastCloseCode: state.lastCloseCode,
      lastCloseReason: state.lastCloseReason,
      lastError: state.lastError,
    },
  };
}
