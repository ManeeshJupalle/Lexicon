// node --test server

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionOutput } from "../protocol.ts";
import { citationLabel, termStatusText, toMarkdown } from "./markdown.ts";

const OUTPUT: SessionOutput = {
  generatedAt: Date.UTC(2026, 8, 22, 1, 2, 3),
  transcript: { lines: 3, words: 40, startMs: 0, endMs: 29_000 },
  summary: [
    {
      text: "The lecture opened with the Venkataraman transform.",
      evidence: ["cover the Venkataraman transform"],
      citation: { finalIds: ["1-0"], startMs: 0, endMs: 9_000, contiguous: true },
    },
  ],
  keyTerms: [
    {
      term: "self-adjoint",
      definition: "The condition under which the n-k Dirac condition holds.",
      evidence: ["holds only when the operator is self-adjoint"],
      citation: { finalIds: ["1-1"], startMs: 9_100, endMs: 19_000, contiguous: true },
    },
  ],
  glossary: [
    { term: "Venkataraman", boosted: true, status: "found", occurrences: 1, forms: ["Venkataraman"], firstMs: 2_000, candidates: [] },
    {
      term: "Nkemdirim",
      boosted: true,
      status: "near_miss",
      occurrences: 0,
      forms: [],
      firstMs: null,
      candidates: [{ text: "n-k Dirac", startMs: 10_000, endMs: 11_000, finalId: "1-1", similarity: 0.56, source: "string" }],
    },
    { term: "Thirunavukkarasu", boosted: false, status: "absent", occurrences: 0, forms: [], firstMs: null, candidates: [] },
  ],
  dropped: { summary: 2, keyTerms: 0, suggestions: 1 },
  errors: [],
  model: "test-model",
  elapsedMs: 1234,
};

test("renders the three sections, the citation labels and the drop counts", () => {
  const md = toMarkdown(OUTPUT);
  assert.match(md, /^# Lexicon session output/);
  assert.match(md, /## Summary\n\n- The lecture opened with the Venkataraman transform\. \(Captions 0:00 to 0:09 · 1 line\)\n  “cover the Venkataraman transform”/);
  assert.match(md, /### self-adjoint\n\nThe condition under which/);
  assert.match(md, /\| Nkemdirim \| yes \| not found as written; possibly “n-k Dirac” at 0:10 \(similarity 0\.56\) \|/);
  assert.match(md, /\| Thirunavukkarasu \| no \| not found \|/);
  assert.match(md, /1 of 3 supplied terms found: Venkataraman \(1\)\./);
  assert.match(md, /2 summary point\(s\) dropped/);
  assert.match(md, /1 mangled-term suggestion\(s\) dropped/);
  assert.doesNotMatch(md, /key term\(s\) dropped/);
});

test("labels: a run is a range, scattered lines are a count from the first", () => {
  assert.equal(citationLabel({ finalIds: ["a", "b"], startMs: 120_028, endMs: 138_472, contiguous: true }), "Captions 2:00 to 2:18 · 2 lines");
  assert.equal(citationLabel({ finalIds: ["a", "b", "c"], startMs: 3_235, endMs: 97_910, contiguous: false }), "3 lines from 0:03");
  assert.equal(termStatusText(OUTPUT.glossary[0]!), "found once, first at 0:02");
});

test("an empty output still renders without throwing", () => {
  const md = toMarkdown({ ...OUTPUT, summary: [], keyTerms: [], glossary: [], dropped: { summary: 0, keyTerms: 0, suggestions: 0 } });
  assert.match(md, /_No grounded summary points\._/);
  assert.match(md, /_No glossary terms were supplied\._/);
  assert.doesNotMatch(md, /## Not shown/);
});
