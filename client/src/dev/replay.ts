// DEV-ONLY FIXTURE REPLAY. Deletable: remove client/src/dev/ and the <ReplayControl />
// line in App.tsx and nothing else changes.
//
// Why it exists. The neutral gutter's most important input is `speaker_label: "PENDING"`,
// and PENDING cannot be produced on demand from a microphone — it appears on short turns
// after a pause, which is luck, not a test. docs/fixtures/strang-plain.jsonl contains 12
// PENDING finals out of 34, so replaying it is the only way to actually look at the
// unresolved gutter before shipping it.
//
// It feeds the store directly and opens no socket, so it also exercises the caption view
// with the proxy stopped.
//
// It duplicates a little of the proxy's frame mapping (server/aai/session.ts). That is
// deliberate for a throwaway: importing the proxy's mapper would drag its session,
// buffer and offset bookkeeping into the browser bundle for no benefit. The duplication
// is allowed to rot — if it ever disagrees with the proxy, the proxy is right.

import type { ClientWord, FinalMessage, PartialMessage } from "../../../server/protocol.ts";
import { useStore } from "../store.ts";

/** The eight terms strang-boosted.jsonl actually sent, read off its connect URL
 *  (docs/data/boost-measurement.md, "Setup"). */
const STRANG_TERMS = [
  "eigenvector",
  "eigenvalue",
  "lambda",
  "diagonalize",
  "linearly independent",
  "eigenvector matrix",
  "invert",
  "columns",
] as const;

interface Fixture {
  load: () => Promise<{ default: string }>;
  /** `keyterms_prompt` on that capture's connect line — what the recogniser was actually
   *  given. Replayed into the glossary as the applied list so the panel shows the run's
   *  real boost state rather than an empty one. */
  sent: readonly string[];
  /** Seeded into the textarea. For the plain run this is the same eight terms with none
   *  applied, which is exactly the state the capture was made in and renders every chip
   *  as pending. */
  draft: readonly string[];
}

export const FIXTURES: Record<string, Fixture> = {
  "strang-plain": {
    load: () => import("../../../docs/fixtures/strang-plain.jsonl?raw"),
    sent: [],
    draft: STRANG_TERMS,
  },
  "strang-boosted": {
    load: () => import("../../../docs/fixtures/strang-boosted.jsonl?raw"),
    sent: STRANG_TERMS,
    draft: STRANG_TERMS,
  },
};

export type FixtureName = keyof typeof FIXTURES;

/** Wall-clock speed-up. A 180 s capture at 6x is 30 s, long enough to watch the gutter
 *  behave and short enough to re-run while tweaking it. */
const SPEED = 6;
/** No single wait longer than this, whatever the capture says. */
const MAX_GAP_MS = 1500;

interface RawWord {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface RawTurn {
  turn_order: number;
  end_of_turn: boolean;
  transcript: string;
  speaker_label?: string;
  words: RawWord[];
  type?: string;
}

interface RawLine {
  received_at: string;
  message?: RawTurn & { type?: string };
}

let cancelled = false;

export function cancelReplay(): void {
  cancelled = true;
}

export async function runReplay(name: FixtureName): Promise<void> {
  cancelled = false;
  const fixture = FIXTURES[name]!;
  const module = await fixture.load();
  const lines = module.default
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as RawLine)
    // Turn frames only. `type` is present on every server frame and is the last key on a
    // Turn (NOTES "What contradicts or surprises", item 9). Begin, SpeechStarted,
    // Termination and the local connect/open/close events are not captions.
    //
    // This also drops the SpeakerRevision frame in strang-boosted.jsonl, which is the
    // correct behaviour and not an accident: the proxy does not relay revisions and the
    // store does not apply them, so a harness that replayed one would be testing a path
    // the product does not have. See the note at the top of store.ts.
    .filter((line): line is RawLine & { message: RawTurn } => line.message?.type === "Turn");

  const store = useStore.getState();
  store.setDraft(fixture.draft.join("\n"));
  store.beginSession([...fixture.sent]);
  store.setStatus("live", "replaying " + name + " at " + SPEED + "x");

  let previous = lines.length > 0 ? Date.parse(lines[0]!.received_at) : 0;

  for (const line of lines) {
    const at = Date.parse(line.received_at);
    const wait = Math.min((at - previous) / SPEED, MAX_GAP_MS);
    previous = at;
    if (wait > 0) await sleep(wait);
    if (cancelled) {
      useStore.getState().setStatus("idle", "replay cancelled");
      return;
    }
    useStore.getState().applyServerMessage(toClientMessage(line.message, line.received_at));
  }

  useStore.getState().setStatus("closed", "replay of " + name + " finished");
}

function toClientMessage(turn: RawTurn, receivedAt: string): FinalMessage | PartialMessage {
  const words: ClientWord[] = turn.words.map((word) => ({
    text: word.text,
    startMs: word.start,
    endMs: word.end,
    speaker: word.speaker ?? null,
  }));
  const startMs = words[0]?.startMs ?? 0;
  const endMs = words.at(-1)?.endMs ?? 0;

  if (!turn.end_of_turn) {
    return { type: "partial", text: turn.transcript, startMs, endMs, words };
  }
  return {
    type: "final",
    id: "replay-" + turn.turn_order,
    sessionId: "replay",
    turnOrder: turn.turn_order,
    text: turn.transcript,
    speakerLabel: turn.speaker_label ?? null,
    startMs,
    endMs,
    words,
    receivedAt: Date.parse(receivedAt),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// DEV-ONLY, like everything in this file: the store on window, so a canned answer can be
// injected from the devtools console and the citation control exercised end to end
// without a model call. Deleted with the rest of client/src/dev/.
declare global {
  interface Window {
    __lexiconStore?: typeof useStore;
  }
}
if (import.meta.env.DEV) window.__lexiconStore = useStore;
