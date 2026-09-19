// One upstream AssemblyAI streaming session per client connection, with reconnect.
//
// Three behaviours here are DERIVED, not observed. NOTES "Open questions" records that no
// expiry, no error frame and no reconnect ever occurred in the captures, so the reasoning
// is written out at each site rather than presented as fact:
//
//   DERIVED 1 — the connection timeline. Word timings are per upstream session and a new
//     session presumably restarts at 0 ms, so each session carries an offset and every
//     timing is shifted onto a single connection-wide timeline before anyone sees it.
//   DERIVED 2 — audio arriving while upstream is down is dropped, not queued.
//   DERIVED 3 — sessions are rotated before Begin.expires_at as well as replaced after an
//     unexpected close. Only the second path is exercised by the P1 gate.

import WebSocket from "ws";
import { SAMPLE_RATE, pcmBytesToMs } from "../config.ts";
import { isFinalTurn, type BeginFrame, type TurnFrame } from "./types.ts";
import { toClientWords, type FinalMessage, type PartialMessage, type StatusCode } from "../protocol.ts";
import type { TranscriptBuffer } from "../transcript/buffer.ts";
import * as health from "./health.ts";

const UPSTREAM_URL = "wss://streaming.assemblyai.com/v3/ws";

// Pinned, deliberately not configurable in P1. speaker_labels=true is a product decision,
// not a default: NOTES "Turn segmentation" measures the same audio at 20 turns with labels
// on and 4 with them off, the longest final running 59 974 ms. Sixty-second gaps between
// finals are not captions. The price is turns capped near 10 s that cut mid-sentence, and
// partials that carry no speaker at all.
const PINNED: Record<string, string> = {
  speech_model: "universal-3-5-pro",
  sample_rate: String(SAMPLE_RATE),
  encoding: "pcm_s16le",
  format_turns: "true",
  speaker_labels: "true",
  max_speakers: "2",
};

/** NOTES "Keyword boosting": the API reference caps the list at 100. */
const MAX_KEYTERMS = 100;

/** Consecutive reconnect attempts and their delays. Exhausting the list is reported as
 *  upstream_unavailable rather than retried forever — a socket that has failed seven times
 *  in half a minute is a condition the client should be told about, not hidden from. */
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000];

/** How far before Begin.expires_at to rotate. Expiry sits three hours out in every
 *  capture; a minute of margin is cheap against a lecture that runs into it. */
const ROTATE_MARGIN_MS = 60_000;

/** NOTES "Session lifecycle": after Terminate the server flushes the open turn, sends
 *  Termination and closes with 1000 itself, 1.4-2.3 s later in the captures. This is how
 *  long to wait for that before forcing the socket shut. */
const TERMINATE_GRACE_MS = 5_000;

function buildUrl(keyterms: string[]): string {
  const parts = Object.entries(PINNED).map(([k, v]) => k + "=" + encodeURIComponent(v));
  if (keyterms.length > 0) {
    // encodeURIComponent, not URLSearchParams. NOTES "Open questions" flags that
    // URLSearchParams wrote `instrumental+convergence` inside the JSON array, and since
    // nothing echoes the terms back, whether the server read the `+` as a space or as a
    // literal is unknowable from the payloads. %20 is unambiguous under both decodings.
    parts.push("keyterms_prompt=" + encodeURIComponent(JSON.stringify(keyterms)));
  }
  return UPSTREAM_URL + "?" + parts.join("&");
}

/** Comma-separated terms from the /ws query string. P2 replaces this with the glossary
 *  panel; the shape it hands to a session is the same. */
export function normaliseKeyterms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYTERMS);
}

export interface StatusExtra {
  sessionId?: string;
  expiresAtMs?: number;
  bufferedFinals?: number;
}

export interface UpstreamSessionOptions {
  apiKey: string;
  keyterms: string[];
  buffer: TranscriptBuffer;
  onStatus: (code: StatusCode, detail: string, extra?: StatusExtra) => void;
  onPartial: (message: PartialMessage) => void;
  onFinal: (message: FinalMessage) => void;
  log?: (line: string) => void;
}

/** One upstream socket attempt. Handlers close over their own Conn, so a session being
 *  replaced can still deliver its final flush with its own offset while its successor is
 *  already opening. */
interface Conn {
  seq: number;
  ws: WebSocket;
  sessionId: string | null;
  /** Connection audio position at which this session's 0 ms sits. Null until the first
   *  audio byte is handed to it — the session's clock starts at its first byte. */
  offsetMs: number | null;
  /** This side asked for the close: a rotation or a teardown, never a reconnect trigger. */
  intentional: boolean;
  /** Counted as live for /health, so the decrement can be balanced. */
  counted: boolean;
  settled: boolean;
  expiryTimer: NodeJS.Timeout | null;
}

export class UpstreamSession {
  private readonly apiKey: string;
  private readonly keyterms: string[];
  private readonly buffer: TranscriptBuffer;
  private readonly onStatus: UpstreamSessionOptions["onStatus"];
  private readonly onPartial: UpstreamSessionOptions["onPartial"];
  private readonly onFinal: UpstreamSessionOptions["onFinal"];
  private readonly log: (line: string) => void;

  private current: Conn | null = null;
  private seq = 0;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private closed = false;

  /** DERIVED 1. Milliseconds of audio received from the client, counted whether or not it
   *  reached an upstream session. This — not the sum of what was forwarded — is the
   *  timeline every timestamp is expressed on. Counting received audio means an outage
   *  shows up as a hole; counting forwarded audio would splice the two sides of the gap
   *  together and quietly shift every later citation earlier by the length of the outage. */
  private clientAudioMs = 0;

  constructor(options: UpstreamSessionOptions) {
    this.apiKey = options.apiKey;
    this.keyterms = options.keyterms;
    this.buffer = options.buffer;
    this.onStatus = options.onStatus;
    this.onPartial = options.onPartial;
    this.onFinal = options.onFinal;
    this.log = options.log ?? (() => {});
  }

  start(): void {
    const terms = this.keyterms.length > 0 ? " with " + this.keyterms.length + " keyterms" : "";
    this.onStatus("connecting", "opening upstream session" + terms);
    this.openUpstream();
  }

  /** 16 kHz mono s16le, straight through. */
  sendAudio(chunk: Buffer): void {
    if (this.closed) return;
    const positionBefore = this.clientAudioMs;
    this.clientAudioMs += pcmBytesToMs(chunk.length);

    const conn = this.current;
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return; // DERIVED 2: drop, never queue.
    // A queue would have to choose between growing without bound and replaying stale audio
    // into a session whose clock starts at the first byte it receives, which would date
    // every word in it to the wrong moment. Dropping loses the gap and nothing else.

    if (conn.offsetMs === null) conn.offsetMs = positionBefore;
    conn.ws.send(chunk);
  }

  /** Clean teardown: no reconnect, upstream told to finish rather than dropped. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const conn = this.current;
    this.current = null;
    if (conn) this.terminate(conn);
  }

  private openUpstream(): void {
    if (this.closed) return;
    this.seq += 1;
    const ws = new WebSocket(buildUrl(this.keyterms), { headers: { Authorization: this.apiKey } });
    const conn: Conn = {
      seq: this.seq,
      ws,
      sessionId: null,
      offsetMs: null,
      intentional: false,
      counted: false,
      settled: false,
      expiryTimer: null,
    };
    this.current = conn;

    ws.on("open", () => {
      conn.counted = true;
      health.noteUpstreamOpen();
      this.log("upstream socket open (session seq " + conn.seq + ")");
    });

    // AMBIGUOUS upstream: the captures never produced an HTTP rejection, so the response
    // body shape is unknown. It is surfaced as text rather than parsed.
    ws.on("unexpected-response", (request, response) => {
      let body = "";
      response.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        request.destroy();
        health.noteUpstreamError("HTTP " + status);
        this.onStatus("upstream_rejected", "upstream refused the connection: HTTP " + status + " " + body.slice(0, 300));
        // A 4xx will not fix itself on a retry — a rejected key or an unacceptable
        // parameter is the same on the next attempt.
        this.settle(conn, status >= 400 && status < 500 ? "give-up" : "retry");
      });
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.log("ignoring binary upstream frame"); // never observed in any capture
        return;
      }
      this.handleFrame(conn, data.toString());
    });

    ws.on("error", (error) => {
      health.noteUpstreamError(error.message);
      this.onStatus("upstream_error", error.message);
      // 'close' follows and drives the reconnect decision.
    });

    ws.on("close", (code, reason) => {
      if (conn.counted) health.noteUpstreamClosed(code, reason.toString());
      this.log("upstream socket closed " + code + " " + reason.toString() + " (session seq " + conn.seq + ")");
      this.settle(conn, "retry");
    });
  }

  /** Runs once per Conn. Decides whether this socket ending means anything. */
  private settle(conn: Conn, disposition: "retry" | "give-up"): void {
    if (conn.settled) return;
    conn.settled = true;
    if (conn.expiryTimer) clearTimeout(conn.expiryTimer);
    conn.expiryTimer = null;

    // A teardown, or a rotation whose replacement is already opening.
    if (this.closed || conn.intentional) return;
    if (conn !== this.current) return; // superseded

    if (disposition === "give-up") {
      this.onStatus("upstream_unavailable", "upstream refused the connection and will not be retried");
      this.current = null;
      return;
    }

    this.onStatus("upstream_closed", "upstream session ended unexpectedly (seq " + conn.seq + ")");
    this.scheduleReconnect();
  }

  /** DERIVED 3, reactive half. The gate kills the upstream mid-session and watches this
   *  run. The transcript buffer is untouched throughout — it belongs to the connection,
   *  not to the session being replaced. */
  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = RECONNECT_DELAYS_MS[this.attempt];
    this.attempt += 1;
    if (delay === undefined) {
      this.onStatus("upstream_unavailable", "gave up after " + RECONNECT_DELAYS_MS.length + " reconnect attempts");
      this.current = null;
      return;
    }
    this.onStatus("reconnecting", "attempt " + this.attempt + " in " + delay + " ms, " + this.buffer.size + " finals held", {
      bufferedFinals: this.buffer.size,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openUpstream();
    }, delay);
    this.retryTimer.unref();
  }

  /** DERIVED 3, proactive half. Expiry was never observed — NOTES records expires_at as
   *  Begin plus three hours in all three runs and the sessions ran three minutes — so this
   *  path is reasoned from the field, not from a capture. Rotating early means a long
   *  lecture never finds out what an expired session does. */
  private rotate(conn: Conn): void {
    if (this.closed || conn !== this.current) return;
    this.log("rotating session " + (conn.sessionId ?? "?") + " ahead of expiry");
    conn.intentional = true;
    this.terminate(conn);
    // The replacement becomes this.current immediately; the old conn's handlers keep
    // running against their own offset so its flushed final still lands correctly.
    this.openUpstream();
  }

  private terminate(conn: Conn): void {
    conn.intentional = true;
    if (conn.expiryTimer) clearTimeout(conn.expiryTimer);
    conn.expiryTimer = null;
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: "Terminate" }));
      const grace = setTimeout(() => {
        if (conn.ws.readyState !== WebSocket.CLOSED) conn.ws.terminate();
      }, TERMINATE_GRACE_MS);
      grace.unref();
    } else {
      conn.ws.terminate();
    }
  }

  private handleFrame(conn: Conn, raw: string): void {
    health.noteUpstreamFrame();
    let parsed: { type?: string };
    try {
      parsed = JSON.parse(raw) as { type?: string };
    } catch {
      this.log("unparseable upstream frame: " + raw.slice(0, 200));
      return;
    }

    switch (parsed.type) {
      case "Begin":
        this.handleBegin(conn, parsed as BeginFrame);
        return;
      case "Turn":
        this.handleTurn(conn, parsed as TurnFrame);
        return;
      case "SpeechStarted":
        // Not relayed in P1: it only announces a turn whose first partial follows about a
        // millisecond later (NOTES "Session lifecycle", lines 4 and 5).
        return;
      case "Termination":
        this.log("upstream Termination: " + raw);
        return;
      default:
        // Everything uncaptured lands here rather than being parsed into a guessed shape:
        // SpeakerRevision, any error frame, anything added to the API since the capture.
        // Logged whole, not truncated — an unknown frame is the only evidence its shape
        // will ever leave behind, and a clipped one is worth little.
        this.log("unknown upstream frame type " + String(parsed.type) + ": " + raw);
    }
  }

  private handleBegin(conn: Conn, frame: BeginFrame): void {
    conn.sessionId = frame.id;
    this.attempt = 0;
    const expiresAtMs = frame.expires_at * 1000; // Unix seconds upstream, ms everywhere here
    const untilRotate = expiresAtMs - Date.now() - ROTATE_MARGIN_MS;
    if (untilRotate > 0) {
      conn.expiryTimer = setTimeout(() => this.rotate(conn), untilRotate);
      conn.expiryTimer.unref();
    }
    this.onStatus("live", "upstream session " + frame.id + " on " + frame.configuration.model, {
      sessionId: frame.id,
      expiresAtMs,
      bufferedFinals: this.buffer.size,
    });
  }

  private handleTurn(conn: Conn, frame: TurnFrame): void {
    const offsetMs = conn.offsetMs ?? 0;

    if (!isFinalTurn(frame)) {
      const words = toClientWords(frame.words, offsetMs);
      const first = words[0];
      const last = words[words.length - 1];
      this.onPartial({
        type: "partial",
        text: frame.transcript,
        startMs: first ? first.startMs : null,
        endMs: last ? last.endMs : null,
        words,
      });
      return;
    }

    const entry = this.buffer.add(frame, {
      sessionId: conn.sessionId,
      offsetMs,
      sessionSeq: conn.seq,
      fallbackMs: this.clientAudioMs,
      receivedAt: Date.now(),
    });
    if (entry) this.onFinal(entry);
  }
}
