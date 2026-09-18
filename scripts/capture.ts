// P0 throwaway. Pipes a 16 kHz mono PCM16 WAV through the AssemblyAI v3 streaming
// WebSocket at real-time pace and appends every raw inbound frame to a JSONL file.
// No parsing of inbound messages, no interfaces, no error swallowing.
//
//   node scripts/capture.ts --wav <file.wav> --out <file.jsonl>
//     [--keyterms "term one,term two,..."] [--max-speakers 2] [--no-speaker-labels]
//
// Endpoint, auth header, and param names come from the v3 API reference; the
// keyterms_prompt encoding (JSON array in the query string) comes from the
// official Node SDK's streaming client. Everything else is learned from the capture.

import { config as loadEnv } from "dotenv";
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

loadEnv({ quiet: true });

const { values: args } = parseArgs({
  options: {
    wav: { type: "string" },
    out: { type: "string" },
    keyterms: { type: "string" },
    "max-speakers": { type: "string", default: "2" },
    "no-speaker-labels": { type: "boolean", default: false },
  },
});
if (!args.wav || !args.out) {
  console.error('usage: node scripts/capture.ts --wav <file.wav> --out <file.jsonl> [--keyterms "a,b,c"] [--max-speakers 2] [--no-speaker-labels]');
  process.exit(2);
}
const wavPath = args.wav;
const outPath = args.out;
const speakerLabels = !args["no-speaker-labels"];
const maxSpeakers = Number(args["max-speakers"]);
if (!Number.isInteger(maxSpeakers)) throw new Error(`--max-speakers must be an integer, got "${args["max-speakers"]}"`);

const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY is not set (expected in .env)");

if (existsSync(outPath)) {
  throw new Error(`${outPath} already exists; one session per fixture file - delete it or choose another --out`);
}
mkdirSync(dirname(outPath), { recursive: true });

// ---- WAV: find the PCM payload and assert it is what we tell AssemblyAI it is.
const SAMPLE_RATE = 16000;
const wav = readFileSync(wavPath);
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
  throw new Error(`${wavPath}: not a RIFF/WAVE file`);
}
let fmtChecked = false;
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
      throw new Error(
        `${wavPath}: need PCM (format 1), mono, ${SAMPLE_RATE} Hz, 16-bit; got format=${format} channels=${channels} rate=${rate} bits=${bits}`,
      );
    }
    fmtChecked = true;
  } else if (id === "data") {
    pcm = wav.subarray(body, body + size);
  }
  offset = body + size + (size % 2); // RIFF chunks are word-aligned
}
if (!fmtChecked) throw new Error(`${wavPath}: no fmt chunk`);
if (!pcm || pcm.length === 0) throw new Error(`${wavPath}: no data chunk`);
const audio: Buffer = pcm;

// ---- Chunking: 50 ms of 16 kHz mono PCM16 = 1600 bytes, paced against wall clock.
const CHUNK_MS = 50;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;

// ---- Connection params. Kept as one visible object so the fixture header shows exactly what was sent.
// universal-3-5-pro is the v3 default; it supports speaker_labels and keyterms_prompt, and it is the only
// model with continuous_partials, which the reference says speaker_labels switches off. Both behaviours
// need to show up in the fixtures, so the model is pinned here rather than left to the server default.
const params = new URLSearchParams({
  speech_model: "universal-3-5-pro",
  sample_rate: String(SAMPLE_RATE),
  encoding: "pcm_s16le",
  format_turns: "true",
  speaker_labels: String(speakerLabels),
});
if (speakerLabels) params.set("max_speakers", String(maxSpeakers)); // reference: only used when speaker_labels is on
const keyterms = args.keyterms ? args.keyterms.split(",").map((s) => s.trim()).filter(Boolean) : [];
if (keyterms.length > 0) params.set("keyterms_prompt", JSON.stringify(keyterms));
const url = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;

// ---- Output. Server frames are written verbatim; local events are wrapped so they are distinguishable.
const now = () => new Date().toISOString();
const writeLine = (s: string) => appendFileSync(outPath, s + "\n");
const record = (raw: string) => writeLine(`{"received_at":"${now()}","message":${raw}}`);
const event = (fields: Record<string, unknown>) => writeLine(JSON.stringify({ received_at: now(), ...fields }));

event({ event: "connect", url, wav: wavPath, pcm_bytes: audio.length, chunk_ms: CHUNK_MS, chunk_bytes: CHUNK_BYTES, keyterms });

const ws = new WebSocket(url, { headers: { Authorization: apiKey } });

// HTTP-level rejection (401, 400 on bad params). ws would otherwise surface this as a bare error string.
ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    event({ event: "unexpected_response", status: res.statusCode, headers: res.headers, body });
    console.error(`HTTP ${res.statusCode}: ${body}`);
    process.exit(1);
  });
});

ws.on("open", () => {
  event({ event: "open" });
  console.error("open");
  void pump();
});

ws.on("message", (data, isBinary) => {
  const text = Buffer.isBuffer(data) ? data.toString(isBinary ? "base64" : "utf8") : String(data);
  if (isBinary) event({ event: "binary_frame", base64: text });
  else record(text);
  console.error(text.length > 160 ? text.slice(0, 160) + "…" : text);
});

ws.on("error", (err) => {
  event({ event: "error", message: err.message });
  console.error("error:", err.message);
});

ws.on("close", (code, reason) => {
  event({ event: "close", code, reason: reason.toString() });
  console.error(`close ${code} ${reason.toString()}`);
  process.exit(code === 1000 ? 0 : 1);
});

async function pump(): Promise<void> {
  const started = Date.now();
  let sent = 0;
  for (let i = 0; i < audio.length; i += CHUNK_BYTES) {
    if (ws.readyState !== WebSocket.OPEN) return; // close handler records why and exits
    ws.send(audio.subarray(i, i + CHUNK_BYTES));
    sent += 1;
    await sleep(Math.max(0, started + sent * CHUNK_MS - Date.now()));
  }
  event({ event: "audio_done", chunks_sent: sent, elapsed_ms: Date.now() - started });
  ws.send(JSON.stringify({ type: "Terminate" }));
  event({ event: "sent_terminate" });
  await sleep(10_000);
  event({ event: "no_close_after_terminate_10s" });
  console.error("server did not close within 10 s of Terminate");
  process.exit(1);
}
