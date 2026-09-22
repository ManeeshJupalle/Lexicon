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

/** P4. The session is over: stop, flush upstream, generate the session output, reply. */
export interface EndMessage {
  type: "end";
  /** Client-generated; echoed on the SessionOutputMessage. */
  endId: string;
  /** Every supplied glossary term as the client holds it now. Which of them were boosted
   *  the proxy already knows from the socket URL. */
  terms: string[];
}

export type ClientMessage = AskMessage | EndMessage;

export const MAX_QUESTION_CHARS = 500;
export const MAX_ASK_TERMS = 100;
const MAX_ASK_ID_CHARS = 64;

export type ParsedClient =
  | { ok: true; message: ClientMessage }
  | { ok: false; askId: string | null; endId: string | null; detail: string };

function idField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ASK_ID_CHARS ? value : null;
}

function termsField(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((term): term is string => typeof term === "string")
        .map((term) => term.trim().slice(0, 100))
        .filter((term) => term !== "")
        .slice(0, MAX_ASK_TERMS)
    : [];
}

/** Validates an inbound text frame. A frame that at least carries its id gets it back in
 *  the failure, so the proxy can answer with an error rather than leave the panel
 *  waiting. */
export function parseClientMessage(raw: string): ParsedClient {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, askId: null, endId: null, detail: "not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, askId: null, endId: null, detail: "not an object" };
  const frame = parsed as Record<string, unknown>;
  const askId = idField(frame.askId);
  const endId = idField(frame.endId);

  if (frame.type === "end") {
    if (endId === null) return { ok: false, askId: null, endId, detail: "missing endId" };
    return { ok: true, message: { type: "end", endId, terms: termsField(frame.terms) } };
  }
  if (frame.type !== "ask") return { ok: false, askId, endId, detail: "unknown type " + String(frame.type) };
  if (askId === null) return { ok: false, askId, endId: null, detail: "missing askId" };
  if (typeof frame.question !== "string") return { ok: false, askId, endId: null, detail: "missing question" };
  const question = frame.question.trim();
  if (question === "") return { ok: false, askId, endId: null, detail: "empty question" };
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, askId, endId: null, detail: "question longer than " + MAX_QUESTION_CHARS + " characters" };
  }
  return { ok: true, message: { type: "ask", askId, question, terms: termsField(frame.terms) } };
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

/** P4. One point of the end-of-session summary: the paraphrase is the text, the passages
 *  are its verbatim anchors, verified like an answer's (server/answer/grounding.ts). */
export interface SummaryPoint {
  text: string;
  evidence: string[];
  citation: Citation;
}

/** A key term defined as it was used in this lecture, grounded the same way. */
export interface KeyTerm {
  term: string;
  definition: string;
  evidence: string[];
  citation: Citation;
}

export type TermStatus = "found" | "found_inflected" | "near_miss" | "absent";

/** A span of the captions that may be a supplied term mis-transcribed. `similarity` is
 *  the string detector's score, null for a model suggestion; `source` says which. */
export interface TermCandidate {
  text: string;
  startMs: number;
  endMs: number;
  finalId: string;
  similarity: number | null;
  source: "string" | "model";
}

/** One supplied glossary term against what actually landed (server/answer/terms.ts). */
export interface TermReport {
  term: string;
  /** Sent as a keyterm at session start. A missed term that was never boosted says
   *  nothing about boosting. */
  boosted: boolean;
  status: TermStatus;
  /** Exact plus inflected occurrences. */
  occurrences: number;
  /** Distinct renderings found, e.g. `eigenvalues` for `eigenvalue`. */
  forms: string[];
  firstMs: number | null;
  /** Best first. Empty when found or when nothing came close. */
  candidates: TermCandidate[];
}

export interface SessionOutput {
  generatedAt: number;
  transcript: { lines: number; words: number; startMs: number; endMs: number };
  summary: SummaryPoint[];
  keyTerms: KeyTerm[];
  /** Every supplied term, found ones included, in the order supplied. */
  glossary: TermReport[];
  /** Model output that failed grounding and was not shown. */
  dropped: { summary: number; keyTerms: number; suggestions: number };
  /** Parts whose model call failed outright. */
  errors: { part: "summary" | "keyTerms" | "mangles"; detail: string }[];
  model: string;
  elapsedMs: number;
}

export interface SessionOutputMessage {
  type: "session_output";
  endId: string;
  output: SessionOutput | null;
  error: { code: AskErrorCode; detail: string } | null;
}

export type ServerMessage = StatusMessage | PartialMessage | FinalMessage | AnswerMessage | SessionOutputMessage;

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

/** How the proxy decides that evidence is verbatim (server/answer/grounding.ts) and how
 *  the panel decides whether a fragment starts or ends a line (client/src/citation.ts).
 *  One definition so the two sides cannot drift.
 *
 *  The rule: normalisation may erase only what the caption formatter adds, never anything
 *  the speaker could have said. Two different claims must never normalise equal.
 *
 *  Kept, as space-separated tokens:
 *  - letters of any script after NFC composition, lowercased (Greek survives);
 *  - digits of any script, with no compatibility folding, so `\u03bb\u2081` is not `\u03bb1`;
 *  - word-internal joiners stay inside the word: apostrophe (we'll), hyphen (self-adjoint,
 *    x-y), and a decimal point or thousands comma between digits (0.5, 1,000);
 *  - every operator and sign as its own token: + - * / ^ % < > = | ~, every Unicode math
 *    symbol and currency symbol. A hyphen or Unicode minus not between two word characters
 *    is the minus token, so `x - y` is not `x y`.
 *
 *  Dropped, as separators: whitespace; sentence punctuation . , ; : ! ?; quotation marks
 *  that are not word-internal apostrophes; brackets; the em dash, en dash and ellipsis the
 *  formatter emits as pause markers ("I want to look at this\u2014"); other punctuation.
 *
 *  Decided and accepted: case is folded, because the formatter capitalises sentence starts
 *  on its own; the residual is that single-letter names such as A and a, or \u039b and \u03bb,
 *  become equal. Symbols this recogniser never writes (primes, factorials) get no protection:
 *  `n!` is `n`. */
export function normaliseForMatch(text: string): string {
  const folded = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2212/g, "-");
  return (folded.match(MATCH_TOKEN) ?? []).join(" ");
}

/** A word (letters, marks, digits, with joiners between word characters) or a single
 *  operator or sign. Everything the pattern skips is a separator. */
const MATCH_TOKEN = /[\p{L}\p{M}\p{N}]+(?:['.,-][\p{L}\p{M}\p{N}]+)*|[\p{Sm}\p{Sc}+*\/^%<>=|~-]/gu;

/** Whether `needle` occurs in `haystack` as whole words, both already normalised. A
 *  substring test is not enough: "normal matrix" is a substring of "abnormal matrix" and
 *  is not what was said. Words are the space-separated tokens the normaliser produces, and
 *  the needle must align with word boundaries at both ends. */
export function includesWords(haystack: string, needle: string): boolean {
  const words = haystack.split(" ").filter(Boolean);
  const wanted = needle.split(" ").filter(Boolean);
  if (wanted.length === 0 || wanted.length > words.length) return false;
  outer: for (let i = 0; i + wanted.length <= words.length; i++) {
    for (let k = 0; k < wanted.length; k++) {
      if (words[i + k] !== wanted[k]) continue outer;
    }
    return true;
  }
  return false;
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
