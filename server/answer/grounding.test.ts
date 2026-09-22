// node --test server
//
// The shared grounding check on its own. ask.test.ts and summarize.test.ts cover it
// through their callers; this file pins the matching rule itself, with the audit's
// counterexamples.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ground, type GroundedLine } from "./grounding.ts";

function line(id: string, startMs: number, text: string): GroundedLine {
  return { id, text, startMs, endMs: startMs + 9_000 };
}

test("a passage must align with word boundaries: 'normal matrix' is not in 'abnormal matrix'", () => {
  const lines = [line("1-0", 0, "So the abnormal matrix case is the one to watch.")];
  const inside = ground([1], ["normal matrix"], lines);
  assert.equal(inside.ok, false);
  if (!inside.ok) assert.equal(inside.reason, "evidence_not_verbatim");

  // The same words as whole words do verify.
  const whole = ground([1], ["abnormal matrix"], [line("1-0", 0, "So the abnormal matrix case is the one to watch.")]);
  assert.equal(whole.ok, true);
  const plain = ground([1], ["normal matrix"], [line("1-0", 0, "A normal matrix commutes with its adjoint.")]);
  assert.equal(plain.ok, true);
});

test("a passage must keep its operators and signs: 'x > 0' is not in 'x < 0'", () => {
  const lines = [line("1-0", 0, "Assume x < 0 for the moment.")];
  const flipped = ground([1], ["Assume x > 0"], lines);
  assert.equal(flipped.ok, false);
  if (!flipped.ok) assert.equal(flipped.reason, "evidence_not_verbatim");
  assert.equal(ground([1], ["Assume x < 0"], lines).ok, true);

  const minus = [line("1-0", 0, "So A − B is singular.")];
  assert.equal(ground([1], ["A - B is singular"], minus).ok, true);
  assert.equal(ground([1], ["A B is singular"], minus).ok, false);

  const greek = [line("1-0", 0, "Then λ times x1 gives the first column.")];
  assert.equal(ground([1], ["λ times x1"], greek).ok, true);
  assert.equal(ground([1], ["μ times x1"], greek).ok, false);
});

test("word alignment holds at both ends and across an adjacent-line join", () => {
  const lines = [line("1-0", 0, "Call it the eigenvector matrix, but"), line("1-1", 9_100, "quite possibly not invertible.")];
  // "matrix, but quite" runs across the join, whole words on both sides.
  assert.equal(ground([1, 2], ["matrix, but quite"], lines).ok, true);
  // Trailing partial word: "quit" is the start of "quite", not a word.
  assert.equal(ground([1, 2], ["but quit"], lines).ok, false);
  // Leading partial word: "ite possibly" begins inside "quite".
  assert.equal(ground([2], ["ite possibly"], lines).ok, false);
});
