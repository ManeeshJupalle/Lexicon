// node --test server
//
// The grounding rules of ask.ts, without a model: an answer never leaves uncited or with
// evidence that is not in the cited lines, every evidence passage is checked on its own,
// citations survive a reconnect, and an empty window never costs an API call.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinalMessage } from "../protocol.ts";
import { answerQuestion, buildPrompt, verify, type Verdict } from "./ask.ts";

function final(id: string, startMs: number, endMs: number, text: string, speakerLabel: string | null = "A"): FinalMessage {
  const [seq, order] = id.split("-");
  return {
    type: "final",
    id,
    sessionId: "session-" + seq,
    turnOrder: Number(order),
    text,
    speakerLabel,
    startMs,
    endMs,
    words: [],
    receivedAt: 1_700_000_000_000,
  };
}

/** Two upstream sessions, one reconnect between them: turn_order restarts at 0, ids and
 *  the connection timeline do not (buffer.test.ts proves the buffer side of this). */
const RECONNECT: FinalMessage[] = [
  final("1-0", 0, 9_900, "the eigenvector matrix S has the eigenvectors in its columns, but"),
  final("2-0", 12_000, 20_000, "only when they are linearly independent can we invert it."),
];

/** Three lines with a sentence running across the first two. */
const THREE: FinalMessage[] = [
  final("1-0", 0, 9_000, "Call it the eigenvector matrix, but"),
  final("1-1", 9_100, 19_000, "quite possibly it has no inverse at all."),
  final("1-2", 19_100, 29_000, "Now, a completely different point about powers."),
];

const neverCalled = async (): Promise<Verdict> => {
  throw new Error("the model must not be called");
};

const reply =
  (verdict: Verdict) =>
  async (): Promise<Verdict> =>
    verdict;

test("an empty window is not_found without a model call", async () => {
  const result = await answerQuestion({ question: "anything", terms: [], finals: [] }, neverCalled);
  assert.deepEqual(result, { kind: "not_found", reason: "empty_window", held: null });
});

test("cited numbers map onto ids and the connection timeline across a reconnect", async () => {
  const result = await answerQuestion(
    { question: "when can S be inverted?", terms: [], finals: RECONNECT },
    reply({
      found: true,
      answer: "When its columns are linearly independent.",
      cited: [2],
      evidence: ["only when they are linearly independent can we invert it"],
    }),
  );
  assert.equal(result.kind, "answer");
  if (result.kind !== "answer") return;
  // The second session's turn 0, not the first session's turn 0.
  assert.deepEqual(result.citation, { finalIds: ["2-0"], startMs: 12_000, endMs: 20_000, contiguous: true });
  assert.deepEqual(result.evidence, ["only when they are linearly independent can we invert it"]);
  assert.deepEqual(result.held, { startMs: 0, endMs: 20_000, lines: 2 });
});

test("a citation naming a line the model was not shown is rejected", () => {
  for (const cited of [[3], [0], [1, 3], [1.5]]) {
    const result = verify({ found: true, answer: "x", cited, evidence: ["the eigenvector matrix"] }, RECONNECT);
    assert.equal(result.kind, "not_found");
    if (result.kind === "not_found") assert.equal(result.reason, "bad_citation", JSON.stringify(cited));
  }
});

test("an answer never leaves without cited lines, an answer and evidence", () => {
  const cases: [Verdict, string][] = [
    [{ found: false, answer: "", cited: [], evidence: [] }, "model"],
    [{ found: true, answer: "   ", cited: [1], evidence: ["the eigenvector matrix"] }, "empty_answer"],
    [{ found: true, answer: "x", cited: [], evidence: ["the eigenvector matrix"] }, "no_citation"],
    [{ found: true, answer: "x", cited: [1], evidence: [] }, "no_evidence"],
    [{ found: true, answer: "x", cited: [1], evidence: ["  ", ""] }, "no_evidence"],
  ];
  for (const [verdict, reason] of cases) {
    const result = verify(verdict, RECONNECT);
    assert.equal(result.kind, "not_found");
    if (result.kind === "not_found") {
      assert.equal(result.reason, reason);
      assert.deepEqual(result.held, { startMs: 0, endMs: 20_000, lines: 2 });
    }
  }
});

test("a passage must be verbatim in the cited lines, not paraphrased and not from elsewhere", () => {
  const paraphrased = verify(
    { found: true, answer: "x", cited: [1], evidence: ["the eigenvector matrix has eigenvectors as columns"] },
    RECONNECT,
  );
  assert.equal(paraphrased.kind, "not_found");
  if (paraphrased.kind === "not_found") assert.equal(paraphrased.reason, "evidence_not_verbatim");

  // Verbatim, but in a line that was not cited.
  const elsewhere = verify({ found: true, answer: "x", cited: [1], evidence: ["linearly independent"] }, RECONNECT);
  assert.equal(elsewhere.kind, "not_found");
  if (elsewhere.kind === "not_found") assert.equal(elsewhere.reason, "evidence_not_verbatim");
});

test("one unmatched passage rejects the whole verdict, however many others match", () => {
  const result = verify(
    { found: true, answer: "x", cited: [1, 2], evidence: ["the eigenvector matrix", "can we invert it", "S is diagonalizable"] },
    RECONNECT,
  );
  assert.equal(result.kind, "not_found");
  if (result.kind === "not_found") assert.equal(result.reason, "evidence_not_verbatim");
});

test("the verbatim check folds case, punctuation and whitespace but not words", () => {
  const folded = verify({ found: true, answer: "x", cited: [1], evidence: ["Eigenvectors in its columns"] }, RECONNECT);
  assert.equal(folded.kind, "answer");
  const wrongWord = verify({ found: true, answer: "x", cited: [1], evidence: ["eigenvectors in its rows"] }, RECONNECT);
  assert.equal(wrongWord.kind, "not_found");
});

test("a passage may run across adjacent cited lines but not across a gap", () => {
  const across = verify(
    { found: true, answer: "x", cited: [1, 2], evidence: ["the eigenvector matrix, but quite possibly it has"] },
    THREE,
  );
  assert.equal(across.kind, "answer");
  if (across.kind === "answer") {
    assert.deepEqual(across.citation, { finalIds: ["1-0", "1-1"], startMs: 0, endMs: 19_000, contiguous: true });
  }

  // Lines 1 and 3 are both cited; a passage stitched over the missing line 2 was never said.
  const gap = verify({ found: true, answer: "x", cited: [1, 3], evidence: ["but Now, a completely different point"] }, THREE);
  assert.equal(gap.kind, "not_found");
  if (gap.kind === "not_found") assert.equal(gap.reason, "evidence_not_verbatim");
});

test("separate passages from non-adjacent cited lines are accepted, each against its own line", () => {
  // The P3 gate case (docs/data/ask-measurement.md, real-1): two honest quotes from lines
  // that are not neighbours, given as two passages rather than stitched into one.
  const result = verify(
    {
      found: true,
      answer: "x",
      cited: [1, 3],
      evidence: ["Call it the eigenvector matrix", "a completely different point about powers."],
    },
    THREE,
  );
  assert.equal(result.kind, "answer");
  if (result.kind === "answer") {
    assert.deepEqual(result.citation, { finalIds: ["1-0", "1-2"], startMs: 0, endMs: 29_000, contiguous: false });
    assert.deepEqual(result.evidence, ["Call it the eigenvector matrix", "a completely different point about powers."]);
  }
});

test("duplicate cited numbers collapse and the range covers first to last", () => {
  const result = verify({ found: true, answer: "x", cited: [2, 1, 2], evidence: ["the eigenvector matrix"] }, RECONNECT);
  assert.equal(result.kind, "answer");
  if (result.kind === "answer") {
    assert.deepEqual(result.citation, { finalIds: ["1-0", "2-0"], startMs: 0, endMs: 20_000, contiguous: true });
  }
});

test("the prompt numbers lines from 1 in order and shows neither ids nor turn orders", () => {
  const prompt = buildPrompt({ question: "what is S?", terms: ["eigenvector", "invert"], finals: RECONNECT }, RECONNECT);
  assert.match(prompt.user, /\[1\] 0:00 to 0:09, speaker A: the eigenvector matrix/);
  assert.match(prompt.user, /\[2\] 0:12 to 0:20, speaker A: only when/);
  assert.match(prompt.user, /Course glossary: eigenvector, invert/);
  assert.match(prompt.user, /Question: what is S\?$/);
  assert.doesNotMatch(prompt.user, /1-0|2-0|turn/);
});
