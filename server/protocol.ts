// The proxy's own wire protocol: what /ws sends down to the browser.
//
// Distinct from server/aai/types.ts on purpose. Upstream frames are session-relative and
// carry fields the client has no use for; these are connection-relative and are the
// contract P2's client will import. Client -> server is audio only: binary PCM frames,
// 16 kHz mono s16le. There are no client control messages in P1.

import type { Word } from "./aai/types.ts";

/** Every non-transcript event the client can receive. One `status` message with a typed
 *  code, so an upstream failure is always an observable state change rather than a socket
 *  that stops producing captions. */
export type StatusCode =
  /** Proxy accepted the socket, upstream session not yet established. */
  | "connecting"
  /** Upstream sent Begin. Captions should start flowing. */
  | "live"
  /** Upstream went away; a replacement session is being opened. Audio is dropped until
   *  it is live. The transcript buffer is untouched. */
  | "reconnecting"
  /** Upstream closed and will be replaced — informational, `reconnecting` follows. */
  | "upstream_closed"
  /** Upstream socket error. */
  | "upstream_error"
  /** Upstream refused the WebSocket upgrade (HTTP status in `detail`). Not retried for a
   *  4xx: a rejected key or bad parameter will not fix itself. */
  | "upstream_rejected"
  /** Reconnect attempts exhausted. No further captions will arrive on this socket. */
  | "upstream_unavailable"
  /** No ASSEMBLYAI_API_KEY on the server. */
  | "not_configured"
  /** Proxy is tearing the connection down. */
  | "closed";

export interface StatusMessage {
  type: "status";
  code: StatusCode;
  detail: string;
  /** Upstream session id from Begin, when there is one. */
  sessionId?: string;
  /** Upstream Begin.expires_at, converted to milliseconds. */
  expiresAtMs?: number;
  /** Finals held in the rolling window at the moment of the status. Reported on `live` so
   *  a reconnect can be seen to have preserved the buffer rather than merely claimed to. */
  bufferedFinals?: number;
}

/** Word timings are milliseconds on the connection timeline (see session.ts), not the
 *  upstream session timeline. `speaker` is verbatim: "A", "B", "PENDING", or null. */
export interface ClientWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker: string | null;
}

/** In-flight line. Replaces the previous partial wholesale — NOTES records partials that
 *  shrink, so nothing here may be treated as append-only. Never stored. */
export interface PartialMessage {
  type: "partial";
  text: string;
  startMs: number | null;
  endMs: number | null;
  words: ClientWord[];
}

/** A finalised turn. Also the shape the transcript buffer stores. */
export interface FinalMessage {
  type: "final";
  /** Unique across the connection. `turn_order` alone is not: it restarts at 0 on a
   *  reconnect, so the upstream session sequence is part of the id. */
  id: string;
  /** Upstream Begin.id of the session that produced it, null if Begin never arrived. */
  sessionId: string | null;
  turnOrder: number;
  text: string;
  /** Verbatim, including the literal "PENDING". Never normalised, never dropped; null
   *  only when the frame carried no speaker_label at all. */
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  words: ClientWord[];
  /** Wall clock at the proxy, epoch ms. */
  receivedAt: number;
}

export type ServerMessage = StatusMessage | PartialMessage | FinalMessage;

/** Upstream words onto the connection timeline. `offsetMs` is the connection audio
 *  position at which the producing upstream session began — see session.ts. */
export function toClientWords(words: Word[], offsetMs: number): ClientWord[] {
  return words.map((w) => ({
    text: w.text,
    startMs: w.start + offsetMs,
    endMs: w.end + offsetMs,
    speaker: w.speaker ?? null,
  }));
}
