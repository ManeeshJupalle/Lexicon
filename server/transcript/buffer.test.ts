// node --test server
//
// Covers the four invariants P1 states for the buffer: partials are never stored, the
// speaker label is kept verbatim, the window evicts by audio position, and a reconnect
// does not disturb either the ordering or the timeline.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TurnFrame, Word } from "../aai/types.ts";
import { TranscriptBuffer, type TurnContext } from "./buffer.ts";

function word(start: number, end: number, text: string, speaker?: string): Word {
  const w: Word = { start, end, text, confidence: 0.99, word_is_final: true };
  if (speaker !== undefined) w.speaker = speaker;
  return w;
}

function turn(options: {
  order: number;
  final: boolean;
  text: string;
  words: Word[];
  speakerLabel?: string;
}): TurnFrame {
  const frame: TurnFrame = {
    turn_order: options.order,
    // True on partials as well as finals in every capture, which is the point: it must
    // not be what decides anything here.
    turn_is_formatted: true,
    end_of_turn: options.final,
    transcript: options.text,
    end_of_turn_confidence: options.final ? 1 : 0,
    words: options.words,
    utterance: options.final ? options.text : "",
    type: "Turn",
  };
  if (options.speakerLabel !== undefined) frame.speaker_label = options.speakerLabel;
  return frame;
}

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    sessionId: "session-1",
    offsetMs: 0,
    sessionSeq: 1,
    fallbackMs: 0,
    receivedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("stores a final with its speaker label and word timings", () => {
  const buffer = new TranscriptBuffer(600_000);
  const entry = buffer.add(
    turn({
      order: 0,
      final: true,
      text: "in the columns of a matrix.",
      words: [word(32, 64, "in", "A"), word(113, 371, "the", "A"), word(9547, 9660, "matrix.", "A")],
      speakerLabel: "A",
    }),
    ctx(),
  );

  assert.ok(entry);
  assert.equal(entry.speakerLabel, "A");
  assert.equal(entry.startMs, 32);
  assert.equal(entry.endMs, 9660);
  assert.equal(entry.words.length, 3);
  assert.equal(entry.words[0]?.speaker, "A");
  assert.equal(buffer.size, 1);
});

test("never stores a partial, however formatted it claims to be", () => {
  const buffer = new TranscriptBuffer(600_000);
  const partial = buffer.add(
    turn({ order: 0, final: false, text: "In areas like coding.", words: [word(0, 86, "In"), word(94, 309, "areas")] }),
    ctx(),
  );

  assert.equal(partial, null);
  assert.equal(buffer.size, 0);
});

test("keeps speaker_label verbatim, including PENDING and absent", () => {
  const buffer = new TranscriptBuffer(600_000);
  const pending = buffer.add(
    turn({ order: 0, final: true, text: "Okay.", words: [word(0, 200, "Okay.", "PENDING")], speakerLabel: "PENDING" }),
    ctx(),
  );
  const unlabelled = buffer.add(turn({ order: 1, final: true, text: "Right.", words: [word(300, 500, "Right.")] }), ctx());

  assert.equal(pending?.speakerLabel, "PENDING");
  assert.equal(pending?.words[0]?.speaker, "PENDING");
  assert.equal(unlabelled?.speakerLabel, null);
  assert.equal(unlabelled?.words[0]?.speaker, null);
});

test("evicts by audio position once the window is exceeded", () => {
  const buffer = new TranscriptBuffer(10_000);
  for (let i = 0; i < 4; i++) {
    const start = i * 5_000;
    buffer.add(
      turn({ order: i, final: true, text: "turn " + i, words: [word(start, start + 4_000, "turn")] }),
      ctx(),
    );
  }

  // Newest ends at 19 000 ms, so anything ending before 9 000 ms is out: turn 0 only.
  assert.deepEqual(
    buffer.entries().map((e) => e.text),
    ["turn 1", "turn 2", "turn 3"],
  );
});

test("a reconnect preserves earlier finals and keeps the timeline moving forward", () => {
  const buffer = new TranscriptBuffer(600_000);
  buffer.add(
    turn({ order: 0, final: true, text: "before the drop", words: [word(0, 9_900, "before")], speakerLabel: "A" }),
    ctx({ sessionSeq: 1, sessionId: "session-1", offsetMs: 0 }),
  );

  // New upstream session: turn_order restarts at 0 and word timings restart at 0 ms, and
  // 12 s of connection time passed (2 s of it dropped during the outage).
  const entry = buffer.add(
    turn({ order: 0, final: true, text: "after the drop", words: [word(0, 8_000, "after")], speakerLabel: "B" }),
    ctx({ sessionSeq: 2, sessionId: "session-2", offsetMs: 12_000 }),
  );

  assert.equal(buffer.size, 2);
  assert.deepEqual(
    buffer.entries().map((e) => e.text),
    ["before the drop", "after the drop"],
  );
  assert.equal(entry?.startMs, 12_000);
  assert.equal(entry?.endMs, 20_000);
  // turn_order collides across sessions; the entry id must not.
  assert.notEqual(buffer.entries()[0]?.id, buffer.entries()[1]?.id);
});

test("timestamps a final that arrives with no words", () => {
  const buffer = new TranscriptBuffer(600_000);
  const entry = buffer.add(turn({ order: 0, final: true, text: "", words: [] }), ctx({ fallbackMs: 4_200 }));

  assert.equal(entry?.startMs, 4_200);
  assert.equal(entry?.endMs, 4_200);
});
