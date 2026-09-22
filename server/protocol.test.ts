// node --test server
//
// The inbound half of the wire contract: what the proxy accepts as a question, what it
// tells the client about frames it will not accept, and the two helpers both sides share.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_QUESTION_CHARS, formatClock, normaliseForMatch, parseAskMessage } from "./protocol.ts";

test("accepts a well-formed ask and trims what it can", () => {
  const parsed = parseAskMessage(
    JSON.stringify({ type: "ask", askId: "ask-1", question: "  what is S?  ", terms: [" eigenvector ", "", 42, "invert"] }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    ask: { type: "ask", askId: "ask-1", question: "what is S?", terms: ["eigenvector", "invert"] },
  });
});

test("a frame that names itself is refused with its askId, so the panel can be told", () => {
  const tooLong = parseAskMessage(JSON.stringify({ type: "ask", askId: "ask-2", question: "x".repeat(MAX_QUESTION_CHARS + 1) }));
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.askId, "ask-2");

  const empty = parseAskMessage(JSON.stringify({ type: "ask", askId: "ask-3", question: "   " }));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.askId, "ask-3");
});

test("anything else is refused without an askId", () => {
  for (const raw of ["not json", "[]", JSON.stringify({ type: "ping" }), JSON.stringify({ type: "ask", question: "no id" })]) {
    const parsed = parseAskMessage(raw);
    assert.equal(parsed.ok, false, raw);
    if (!parsed.ok) assert.equal(parsed.askId, null, raw);
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
});
