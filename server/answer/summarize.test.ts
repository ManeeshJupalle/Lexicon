// node --test server
//
// Session output without a model: every summary point and key term is grounded the same
// way an answer is, failures are dropped and counted, a failing call loses only its own
// part, and a model-suggested mangle is kept only when its span is verbatim in the line
// it names.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinalMessage } from "../protocol.ts";
import { generateSessionOutput, type SessionCallers } from "./summarize.ts";

function final(id: string, startMs: number, endMs: number, text: string): FinalMessage {
  const words = text.split(" ").map((w, i, all) => ({
    text: w,
    startMs: startMs + Math.floor(((endMs - startMs) * i) / all.length),
    endMs: startMs + Math.floor(((endMs - startMs) * (i + 1)) / all.length),
    speaker: "A",
  }));
  return { type: "final", id, sessionId: "s", turnOrder: 0, text, speakerLabel: "A", startMs, endMs, words, receivedAt: 0 };
}

const FINALS: FinalMessage[] = [
  final("1-0", 0, 9_000, "Today we will cover the Venkataraman transform and its relationship to the third lemma."),
  final("1-1", 9_100, 19_000, "The n-k Dirac condition holds only when the operator is self-adjoint."),
  final("1-2", 19_100, 29_000, "For problem set four, use the Szymanski decomposition, not the other form."),
];

const TERMS = ["Venkataraman", "Nkemdirim", "self-adjoint", "Thirunavukkarasu"];

function callers(overrides: Partial<SessionCallers>): SessionCallers {
  return {
    summary: async () => ({ points: [] }),
    keyTerms: async () => ({ terms: [] }),
    mangles: async () => ({ suggestions: [] }),
    ...overrides,
  };
}

test("grounded points and terms pass; ungrounded ones are dropped and counted", async () => {
  const output = await generateSessionOutput(
    { finals: FINALS, terms: TERMS, boosted: ["Venkataraman"], model: "test" },
    callers({
      summary: async () => ({
        points: [
          { text: "The lecture opened with the Venkataraman transform.", cited: [1], evidence: ["cover the Venkataraman transform"] },
          { text: "A point with a paraphrased passage.", cited: [1], evidence: ["the transform's relationship to a lemma"] },
          { text: "A point citing a line that does not exist.", cited: [9], evidence: ["Today we will cover"] },
          { text: "", cited: [1], evidence: ["Today"] },
        ],
      }),
      keyTerms: async () => ({
        terms: [
          { term: "self-adjoint", definition: "The condition under which the n-k Dirac condition holds.", cited: [2], evidence: ["holds only when the operator is self-adjoint"] },
          { term: "Self-Adjoint", definition: "Duplicate, dropped.", cited: [2], evidence: ["self-adjoint"] },
          { term: "Szymanski decomposition", definition: "What to use for problem set four.", cited: [3], evidence: ["use the Szymanski decomposition"] },
          { term: "lemma", definition: "Ungrounded: no evidence.", cited: [1], evidence: [] },
        ],
      }),
    }),
  );

  assert.equal(output.summary.length, 1);
  assert.equal(output.summary[0]?.text, "The lecture opened with the Venkataraman transform.");
  assert.deepEqual(output.summary[0]?.citation.finalIds, ["1-0"]);
  assert.equal(output.dropped.summary, 3);

  assert.deepEqual(
    output.keyTerms.map((t) => t.term),
    ["self-adjoint", "Szymanski decomposition"],
  );
  assert.equal(output.dropped.keyTerms, 2);
  assert.deepEqual(output.errors, []);
  assert.equal(output.transcript.lines, 3);
});

test("the glossary report is deterministic and the model only sees the unfound terms", async () => {
  let manglesPrompt = "";
  const output = await generateSessionOutput(
    { finals: FINALS, terms: TERMS, boosted: ["Venkataraman", "Nkemdirim"], model: "test" },
    callers({
      mangles: async (prompt) => {
        manglesPrompt = prompt.user;
        return { suggestions: [] };
      },
    }),
  );
  const by = Object.fromEntries(output.glossary.map((r) => [r.term, r]));
  assert.equal(by["Venkataraman"]!.status, "found");
  assert.equal(by["self-adjoint"]!.status, "found");
  assert.equal(by["Nkemdirim"]!.status, "near_miss");
  assert.equal(by["Nkemdirim"]!.candidates[0]?.text, "n-k Dirac");
  assert.equal(by["Nkemdirim"]!.boosted, true);
  assert.equal(by["Thirunavukkarasu"]!.status, "absent");
  assert.equal(by["Thirunavukkarasu"]!.boosted, false);
  // The string detector's spans go up with their line numbers; a term with none goes bare.
  assert.match(manglesPrompt, /- Nkemdirim \(already matched by spelling: “n-k Dirac” in line 2\)\n- Thirunavukkarasu\n/);
  assert.doesNotMatch(manglesPrompt, /- Venkataraman/);
});

test("a model-suggested mangle is kept only when its span is verbatim in the named line", async () => {
  const output = await generateSessionOutput(
    { finals: FINALS, terms: TERMS, boosted: [], model: "test" },
    callers({
      mangles: async () => ({
        suggestions: [
          { term: "Thirunavukkarasu", line: 2, span: "n-k Dirac condition" },
          { term: "Thirunavukkarasu", line: 1, span: "third lemma" },
          { term: "Thirunavukkarasu", line: 3, span: "the other formulation" },
          { term: "not a glossary term", line: 1, span: "Today" },
        ],
      }),
    }),
  );
  const thiru = output.glossary.find((r) => r.term === "Thirunavukkarasu")!;
  assert.equal(thiru.status, "near_miss");
  assert.deepEqual(
    thiru.candidates.map((c) => [c.text, c.finalId, c.source, c.similarity]),
    [
      ["n-k Dirac condition", "1-1", "model", null],
      ["third lemma", "1-0", "model", null],
    ],
  );
  assert.ok(thiru.candidates.every((c) => c.startMs >= 0 && c.endMs > c.startMs));
  assert.equal(output.dropped.suggestions, 2);
});

test("a failing call loses only its own part", async () => {
  const output = await generateSessionOutput(
    { finals: FINALS, terms: TERMS, boosted: [], model: "test" },
    callers({
      summary: async () => {
        throw new Error("rate limited");
      },
      keyTerms: async () => ({
        terms: [{ term: "Szymanski decomposition", definition: "For problem set four.", cited: [3], evidence: ["Szymanski decomposition"] }],
      }),
    }),
  );
  assert.deepEqual(output.summary, []);
  assert.equal(output.keyTerms.length, 1);
  assert.deepEqual(output.errors, [{ part: "summary", detail: "rate limited" }]);
});

test("an empty transcript makes no model calls", async () => {
  const output = await generateSessionOutput(
    { finals: [], terms: TERMS, boosted: [], model: "test" },
    callers({
      summary: async () => {
        throw new Error("must not be called");
      },
      keyTerms: async () => {
        throw new Error("must not be called");
      },
      mangles: async () => {
        throw new Error("must not be called");
      },
    }),
  );
  assert.deepEqual(output.summary, []);
  assert.deepEqual(output.keyTerms, []);
  assert.deepEqual(output.errors, []);
  assert.equal(output.glossary.every((r) => r.status === "absent"), true);
});
