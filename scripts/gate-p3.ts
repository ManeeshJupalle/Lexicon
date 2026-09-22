// P3 gate driver. Streams a 16 kHz mono PCM16 WAV through the running proxy's /ws at
// real-time pace, exactly as the browser client would, and asks questions over the same
// socket at fixed audio positions while the audio is still playing. Every answer's
// citation is resolved against the finals this socket received, so "the citation points
// at the right moment" can be read off the cited lines' own text and times.
//
//   node scripts/gate-p3.ts [--wav audio/strang-3min.wav] [--port 8787]
//                           [--keyterms "a,b,c"] [--out report.json]
//
// It exists because the gate asks for a live run and this machine has no microphone
// wired to the browser. Everything below the browser is real: the proxy, the upstream
// AssemblyAI session, the rolling buffer, the answer layer. What it does not exercise is
// the panel itself; that still needs eyes.

import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import WebSocket from "ws";
import type { AnswerMessage, FinalMessage, ServerMessage, StatusMessage } from "../server/protocol.ts";
import { formatClock } from "../server/protocol.ts";

const { values: args } = parseArgs({
  options: {
    wav: { type: "string", default: "audio/strang-3min.wav" },
    port: { type: "string", default: "8787" },
    keyterms: { type: "string", default: "" },
    out: { type: "string" },
    /** Comma-separated labels from SCHEDULE. With this set, audio stops once every
     *  selected question is answered, so a single question costs a minute, not three. */
    only: { type: "string" },
  },
});

/** The gate's questions, asked at these audio positions. Three the lecture answers in
 *  its first three minutes, one it mentions but does not answer (the adversarial one),
 *  and one it never covers. */
const SCHEDULE: { atMs: number; label: string; question: string }[] = [
  { atMs: 60_000, label: "real-1", question: "What is needed to be able to invert S?" },
  { atMs: 100_000, label: "real-2", question: "What is S?" },
  { atMs: 142_000, label: "real-3", question: "What is A times the eigenvector x1 equal to?" },
  { atMs: 156_000, label: "adversarial", question: "What does S inverse A S equal?" },
  { atMs: 172_000, label: "uncovered", question: "What is the determinant of A?" },
];

// ---- WAV, as in scripts/capture.ts.
const SAMPLE_RATE = 16_000;
const wav = readFileSync(args.wav);
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error(args.wav + ": not RIFF/WAVE");
let pcm: Buffer | undefined;
let offset = 12;
while (offset + 8 <= wav.length) {
  const id = wav.toString("ascii", offset, offset + 4);
  const size = wav.readUInt32LE(offset + 4);
  const body = offset + 8;
  if (id === "fmt ") {
    const format = wav.readUInt16LE(body);
    const channels = wav.readUInt16LE(body + 2);
    const rate = wav.readUInt32LE(body + 4);
    const bits = wav.readUInt16LE(body + 14);
    if (format !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) {
      throw new Error(args.wav + ": need PCM mono 16 kHz 16-bit, got " + format + "/" + channels + "/" + rate + "/" + bits);
    }
  } else if (id === "data") {
    pcm = wav.subarray(body, body + size);
  }
  offset = body + size + (size % 2);
}
if (!pcm || pcm.length === 0) throw new Error(args.wav + ": no data chunk");
const audio: Buffer = pcm;
const CHUNK_MS = 50;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;

// ---- Bookkeeping.
const terms = args.keyterms.split(",").map((t) => t.trim()).filter(Boolean);
const startedAt = new Date().toISOString();
const statuses: { at: number; code: string; detail: string; sessionId?: string; bufferedFinals?: number }[] = [];
const finals: FinalMessage[] = [];
let partials = 0;

interface AskRecord {
  label: string;
  askId: string;
  question: string;
  askedAtAudioMs: number;
  finalsHeldClientSide: number;
  lastFinalEndMs: number | null;
  sentAt: number;
  roundTripMs: number | null;
  serverElapsedMs: number | null;
  result: AnswerMessage["result"] | null;
  citedLines: { id: string; startMs: number; endMs: number; text: string }[];
  unresolvedIds: string[];
}
const asks: AskRecord[] = [];
let audioPositionMs = 0;

const log = (line: string) => console.error("[gate " + formatClock(audioPositionMs) + "] " + line);

const ws = new WebSocket("ws://localhost:" + args.port + "/ws" + (terms.length > 0 ? "?keyterms=" + encodeURIComponent(terms.join(",")) : ""));

ws.on("open", () => {
  log("socket open");
  void pump();
});

ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const message = JSON.parse(data.toString()) as ServerMessage;
  switch (message.type) {
    case "status": {
      const status = message as StatusMessage;
      statuses.push({ at: audioPositionMs, code: status.code, detail: status.detail, sessionId: status.sessionId, bufferedFinals: status.bufferedFinals });
      log("status " + status.code + ": " + status.detail);
      return;
    }
    case "partial":
      partials += 1;
      return;
    case "final":
      finals.push(message);
      log("final " + message.id + " " + formatClock(message.startMs) + " to " + formatClock(message.endMs) + " " + JSON.stringify(message.text.slice(0, 60)));
      return;
    case "answer": {
      const record = asks.find((a) => a.askId === message.askId);
      if (!record) {
        log("answer for unknown askId " + message.askId);
        return;
      }
      record.roundTripMs = Date.now() - record.sentAt;
      record.serverElapsedMs = message.elapsedMs;
      record.result = message.result;
      if (message.result.kind === "answer") {
        for (const id of message.result.citation.finalIds) {
          const line = finals.find((f) => f.id === id);
          if (line) record.citedLines.push({ id, startMs: line.startMs, endMs: line.endMs, text: line.text });
          else record.unresolvedIds.push(id);
        }
      }
      log("answer " + record.label + " -> " + describe(message) + " (round trip " + record.roundTripMs + " ms, server " + message.elapsedMs + " ms)");
      return;
    }
  }
});

ws.on("error", (error) => log("socket error " + error.message));
ws.on("close", (code, reason) => {
  log("socket closed " + code + " " + reason.toString());
  finish();
});

function describe(message: AnswerMessage): string {
  const r = message.result;
  if (r.kind === "answer") {
    return "answer citing " + r.citation.finalIds.join(",") + (r.citation.contiguous ? " (one run)" : " (scattered)") + ": " + JSON.stringify(r.answer);
  }
  if (r.kind === "not_found") return "not_found (" + r.reason + ")";
  return "error " + r.error + ": " + r.detail;
}

function ask(entry: (typeof SCHEDULE)[number]): void {
  const askId = "gate-" + entry.label;
  const last = finals[finals.length - 1];
  asks.push({
    label: entry.label,
    askId,
    question: entry.question,
    askedAtAudioMs: audioPositionMs,
    finalsHeldClientSide: finals.length,
    lastFinalEndMs: last ? last.endMs : null,
    sentAt: Date.now(),
    roundTripMs: null,
    serverElapsedMs: null,
    result: null,
    citedLines: [],
    unresolvedIds: [],
  });
  ws.send(JSON.stringify({ type: "ask", askId, question: entry.question, terms }));
  log("ask " + entry.label + " " + JSON.stringify(entry.question) + " with " + finals.length + " finals on screen");
}

async function pump(): Promise<void> {
  const started = Date.now();
  let sent = 0;
  const selected = args.only === undefined ? null : new Set(args.only.split(",").map((s) => s.trim()));
  const pending = SCHEDULE.filter((entry) => selected === null || selected.has(entry.label));
  if (pending.length === 0) throw new Error("--only matched no schedule label");
  for (let i = 0; i < audio.length; i += CHUNK_BYTES) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(audio.subarray(i, i + CHUNK_BYTES));
    sent += 1;
    audioPositionMs = sent * CHUNK_MS;
    while (pending.length > 0 && audioPositionMs >= pending[0]!.atMs) ask(pending.shift()!);
    if (selected !== null && pending.length === 0 && asks.every((a) => a.result !== null)) {
      log("every selected question answered; stopping audio early");
      break;
    }
    await sleep(Math.max(0, started + sent * CHUNK_MS - Date.now()));
  }
  log("audio done, " + sent + " chunks in " + (Date.now() - started) + " ms");
  while (pending.length > 0) ask(pending.shift()!);

  // Give every answer, and the upstream flush of the last turn, time to arrive.
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline && asks.some((a) => a.result === null)) await sleep(250);
  await sleep(3_000);
  ws.close(1000, "gate done");
}

function finish(): void {
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    wav: args.wav,
    pcmBytes: audio.length,
    port: args.port,
    terms,
    statuses,
    partials,
    finals: finals.map((f) => ({ id: f.id, startMs: f.startMs, endMs: f.endMs, speakerLabel: f.speakerLabel, text: f.text })),
    asks,
  };
  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    writeFileSync(args.out, json + "\n");
    log("report written to " + args.out);
  } else {
    console.log(json);
  }
  process.exit(asks.every((a) => a.result !== null) ? 0 : 1);
}
