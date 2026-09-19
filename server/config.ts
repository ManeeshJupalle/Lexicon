// Environment and audio constants. The upstream session parameters are NOT here:
// they are pinned in aai/session.ts because P1 deliberately does not make them configurable.

import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

export const PORT = intFromEnv("PORT", 8787);

/** Read at startup, never sent to the client. Empty string means "not configured"; the
 *  server still starts, /health reports it, and /ws refuses with a typed status. */
export const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY ?? "";

/** Rolling transcript window. Configurable, default 10 minutes. */
export const TRANSCRIPT_WINDOW_MS = intFromEnv("TRANSCRIPT_WINDOW_MS", 10 * 60_000);

// Audio format. Fixed on both sides of the proxy: the browser sends exactly this, and
// aai/session.ts declares exactly this upstream, so one constant serves both.
export const SAMPLE_RATE = 16_000;
export const BYTES_PER_SAMPLE = 2; // pcm_s16le

/** Milliseconds of audio a PCM byte count represents. The proxy's only clock. */
export function pcmBytesToMs(bytes: number): number {
  return (bytes / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return value;
}
