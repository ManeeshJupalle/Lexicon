// node --test server
//
// The inbound half of the wire contract: what the proxy accepts as a question or an end
// frame, what it tells the client about frames it will not accept, and the two helpers
// both sides share.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_QUESTION_CHARS, formatClock, includesWords, normaliseForMatch, parseClientMessage } from "./protocol.ts";

test("accepts a well-formed ask and trims what it can", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ type: "ask", askId: "ask-1", question: "  what is S?  ", terms: [" eigenvector ", "", 42, "invert"] }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    message: { type: "ask", askId: "ask-1", question: "what is S?", terms: ["eigenvector", "invert"] },
  });
});

test("accepts an end frame with its terms", () => {
  const parsed = parseClientMessage(JSON.stringify({ type: "end", endId: "end-1", terms: ["eigenvector", 7, " lambda "] }));
  assert.deepEqual(parsed, { ok: true, message: { type: "end", endId: "end-1", terms: ["eigenvector", "lambda"] } });
});

test("a frame that names itself is refused with its id, so the panel can be told", () => {
  const tooLong = parseClientMessage(JSON.stringify({ type: "ask", askId: "ask-2", question: "x".repeat(MAX_QUESTION_CHARS + 1) }));
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.askId, "ask-2");

  const empty = parseClientMessage(JSON.stringify({ type: "ask", askId: "ask-3", question: "   " }));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.askId, "ask-3");

  const endless = parseClientMessage(JSON.stringify({ type: "end" }));
  assert.equal(endless.ok, false);
  if (!endless.ok) assert.equal(endless.endId, null);
});

test("anything else is refused without an id", () => {
  for (const raw of ["not json", "[]", JSON.stringify({ type: "ping" }), JSON.stringify({ type: "ask", question: "no id" })]) {
    const parsed = parseClientMessage(raw);
    assert.equal(parsed.ok, false, raw);
    if (!parsed.ok) {
      assert.equal(parsed.askId, null, raw);
      assert.equal(parsed.endId, null, raw);
    }
  }
});

test("formatClock is m:ss on the connection timeline, h:mm:ss past an hour", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(9_900), "0:09");
  assert.equal(formatClock(138_624), "2:18");
  assert.equal(formatClock(3_661_000), "1:01:01");
});

test("normaliseForMatch folds case, punctuation and whitespace and keeps words", () => {
  assert.equal(normaliseForMatch("  Eigenvectors, in its columns.  "), "eigenvectors in its columns");
  assert.equal(normaliseForMatch("we’ll"), "we'll");
  assert.equal(normaliseForMatch("And I want to look at this—"), "and i want to look at this");
  assert.equal(normaliseForMatch("Okonkwo's location in the (course) reader…"), "okonkwo's location in the course reader");
});

test("normaliseForMatch keeps comparison operators and signs: 'x > 0' is not 'x < 0'", () => {
  assert.equal(normaliseForMatch("Assume x > 0"), "assume x > 0");
  assert.equal(normaliseForMatch("Assume x < 0"), "assume x < 0");
  assert.notEqual(normaliseForMatch("Assume x > 0"), normaliseForMatch("Assume x < 0"));
  // Minus, ASCII or Unicode, spaced, is a token; unspaced it stays inside the word.
  assert.equal(normaliseForMatch("x − y"), "x - y");
  assert.equal(normaliseForMatch("x - y"), "x - y");
  assert.notEqual(normaliseForMatch("x - y"), normaliseForMatch("x y"));
  assert.equal(normaliseForMatch("x-y"), "x-y");
  assert.notEqual(normaliseForMatch("x-y"), normaliseForMatch("x y"));
  assert.equal(normaliseForMatch("a = b + c * d / e ^ 2, 50%"), "a = b + c * d / e ^ 2 50 %");
  assert.equal(normaliseForMatch("≤ ≥ ≠ → ∞"), "≤ ≥ ≠ → ∞");
});

test("normaliseForMatch keeps Greek letters and digit joiners", () => {
  assert.equal(normaliseForMatch("λ times x1"), "λ times x1");
  assert.notEqual(normaliseForMatch("λ times x1"), normaliseForMatch("times x1"));
  assert.equal(normaliseForMatch("θ sub k, we'll write κ."), "θ sub k we'll write κ");
  // Case is folded, by decision: capital Lambda and lambda compare equal.
  assert.equal(normaliseForMatch("Λ"), "λ");
  // No compatibility folding: a subscript digit is not a digit.
  assert.notEqual(normaliseForMatch("λ₁"), normaliseForMatch("λ1"));
  assert.equal(normaliseForMatch("0.5 and 1,000 and 3rd"), "0.5 and 1,000 and 3rd");
  assert.equal(includesWords(normaliseForMatch("the answer is 0.5"), normaliseForMatch("5")), false);
  assert.equal(normaliseForMatch("self-adjoint."), "self-adjoint");
  assert.notEqual(normaliseForMatch("self-adjoint"), normaliseForMatch("self adjoint"));
});

test("includesWords matches whole words only, never a substring inside a word", () => {
  assert.equal(includesWords("so the abnormal matrix case", "normal matrix"), false);
  assert.equal(includesWords("so the abnormal matrix case", "abnormal matrix"), true);
  assert.equal(includesWords("a normal matrix commutes", "normal matrix"), true);
  assert.equal(includesWords("normal matrix", "normal matrix"), true);
  assert.equal(includesWords("normal", "normal matrix"), false);
  assert.equal(includesWords("anything", ""), false);
});
