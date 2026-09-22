// The proxy's own wire protocol: what /ws sends down to the browser.
//
// Distinct from server/aai/types.ts on purpose. Upstream frames are session-relative and
// carry fields the client has no use for; these are connection-relative and are the
// contract the client imports. Client -> server is binary PCM audio (16 kHz mono s16le)
// plus exactly one JSON text frame type, AskMessage, added in P3.
//
// Nothing in this file touches Node, so the client imports its runtime helpers too
// (formatClock, normaliseForMatch) — unlike config.ts, which loads dotenv and must not
// reach the browser bundle.

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

/** P3. The one text frame the client sends. Anything else textual is dropped by the proxy. */
export interface AskMessage {
  type: "ask";
  /** Client-generated; echoed on the AnswerMessage so several questions can be in flight. */
  askId: string;
  question: string;
  /** The glossary as the client holds it when the question is asked: the terms sent at
   *  session start plus anything typed since. The recogniser only ever sees the former;
   *  the answer layer can use both. */
  terms: string[];
}

export type ClientMessage = AskMessage;

export const MAX_QUESTION_CHARS = 500;
export const MAX_ASK_TERMS = 100;
const MAX_ASK_ID_CHARS = 64;

export type ParsedAsk = { ok: true; ask: AskMessage } | { ok: false; askId: string | null; detail: string };

/** Validates an inbound text frame. A frame that at least carries an askId gets it back
 *  in the failure, so the proxy can answer with an error rather than leave the panel
 *  waiting. */
export function parseAskMessage(raw: string): ParsedAsk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, askId: null, detail: "not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, askId: null, detail: "not an object" };
  const frame = parsed as Record<string, unknown>;
  const askId = typeof frame.askId === "string" && frame.askId.length > 0 && frame.askId.length <= MAX_ASK_ID_CHARS ? frame.askId : null;
  if (frame.type !== "ask") return { ok: false, askId, detail: "unknown type " + String(frame.type) };
  if (askId === null) return { ok: false, askId, detail: "missing askId" };
  if (typeof frame.question !== "string") return { ok: false, askId, detail: "missing question" };
  const question = frame.question.trim();
  if (question === "") return { ok: false, askId, detail: "empty question" };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, askId, detail: "question longer than " + MAX_QUESTION_CHARS + " characters" };
  const terms = Array.isArray(frame.terms)
    ? frame.terms
        .filter((term): term is string => typeof term === "string")
        .map((term) => term.trim().slice(0, 100))
        .filter((term) => term !== "")
        .slice(0, MAX_ASK_TERMS)
    : [];
  return { ok: true, ask: { type: "ask", askId, question, terms } };
}

/** Which lines an answer relied on. Both forms survive a reconnect: ids carry the
 *  upstream session sequence (buffer.ts), and the times are on the connection timeline
 *  (session.ts, DERIVED 1), which never restarts. Neither is a turn_order. */
export interface Citation {
  /** FinalMessage.id of every cited line, in transcript order. */
  finalIds: string[];
  startMs: number;
  endMs: number;
  /** True when the cited lines are one adjacent run of the transcript. The panel shows a
   *  run as a time range; anything else as a line count from the first line, because a
   *  range would imply continuous support the answer does not have. */
  contiguous: boolean;
}

/** What the rolling window held when the question was answered, so "not found" can say
 *  what was actually searched rather than a nominal window length. */
export interface HeldSpan {
  startMs: number;
  endMs: number;
  lines: number;
}

/** Why there is no answer. `model` is the model saying so; the rest are the proxy
 *  refusing to pass on a verdict that failed a grounding check (server/answer/ask.ts).
 *  The client renders all of them as not found; the reason is for the log. */
export type NotFoundReason =
  | "empty_window"
  | "model"
  | "empty_answer"
  | "no_citation"
  | "bad_citation"
  | "no_evidence"
  | "evidence_not_verbatim";

export type AskErrorCode = "not_configured" | "bad_request" | "declined" | "unparseable" | "upstream";

export type AskResult =
  | {
      kind: "answer";
      answer: string;
      /** Passages the model copied from the cited lines, each verified verbatim by the
       *  proxy against one run of adjacent cited lines. Never empty on an answer. */
      evidence: string[];
      citation: Citation;
      held: HeldSpan;
    }
  | { kind: "not_found"; reason: NotFoundReason; held: HeldSpan | null }
  | { kind: "error"; error: AskErrorCode; detail: string };

export interface AnswerMessage {
  type: "answer";
  askId: string;
  result: AskResult;
  /** Wall-clock milliseconds the proxy spent on it, model call included. */
  elapsedMs: number;
}

export type ServerMessage = StatusMessage | PartialMessage | FinalMessage | AnswerMessage;

/** Connection-timeline milliseconds as m:ss, or h:mm:ss past an hour. The unit every
 *  citation is shown in, on both sides of the socket. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return (hours > 0 ? hours + ":" : "") + mm + ":" + String(seconds).padStart(2, "0");
}

/** How the proxy decides that evidence is verbatim (server/answer/ask.ts) and how the
 *  panel decides whether a fragment starts or ends a line (client/src/citation.ts): case
 *  and punctuation folded, whitespace collapsed, words untouched. One definition so the
 *  two sides cannot drift. */
export function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

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
