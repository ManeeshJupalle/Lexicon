// node --test server
//
// The term detector against the captures it was built from. docs/data/boost-measurement.md
// records, from the fixture files, which of the ten jargon terms the plain run rendered
// and what it rendered instead; these tests pin the detector to those facts. If a
// threshold change makes one fail, the measurement says which side is wrong.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TurnFrame } from "../aai/types.ts";
import { isFinalTurn } from "../aai/types.ts";
import type { FinalMessage } from "../protocol.ts";
import { toClientWords } from "../protocol.ts";
import { analyseTerms, locateSpan, nearMisses, termTokens, tokenise } from "./terms.ts";

function loadFixture(name: string): FinalMessage[] {
  const finals: FinalMessage[] = [];
  let seq = 0;
  for (const line of readFileSync("docs/fixtures/" + name + ".jsonl", "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as { received_at: string; message?: { type?: string } };
    if (row.message?.type !== "Turn") continue;
    const frame = row.message as TurnFrame;
    if (!isFinalTurn(frame)) continue;
    const words = toClientWords(frame.words, 0);
    finals.push({
      type: "final",
      id: "1-" + seq++,
      sessionId: "fixture",
      turnOrder: frame.turn_order,
      text: frame.transcript,
      speakerLabel: frame.speaker_label ?? null,
      startMs: words[0]?.startMs ?? 0,
      endMs: words[words.length - 1]?.endMs ?? 0,
      words,
      receivedAt: Date.parse(row.received_at),
    });
  }
  return finals;
}

const JARGON_TERMS = [
  "Venkataraman",
  "Bhattacharya",
  "Okonkwo",
  "Nkemdirim",
  "Ravindranath",
  "Szymanski",
  "Adeyemi-Lindqvist",
  "Thirunavukkarasu",
  "kappa",
  "self-adjoint",
];

const STRANG_TERMS = ["eigenvector", "eigenvalue", "lambda", "diagonalize", "linearly independent", "eigenvector matrix", "invert", "columns"];

test("jargon-plain: the six terms the measurement found are found, with the measured counts", () => {
  const reports = analyseTerms(JARGON_TERMS, [], loadFixture("jargon-plain"));
  const by = Object.fromEntries(reports.map((r) => [r.term, r]));
  assert.equal(by["Venkataraman"]!.status, "found");
  assert.equal(by["Venkataraman"]!.occurrences, 2);
  assert.equal(by["Szymanski"]!.status, "found");
  assert.equal(by["Szymanski"]!.occurrences, 2);
  assert.equal(by["kappa"]!.status, "found");
  assert.equal(by["kappa"]!.occurrences, 2);
  assert.equal(by["self-adjoint"]!.status, "found");
  assert.equal(by["self-adjoint"]!.occurrences, 2);
  // The measurement counted the possessives as inflected and named them.
  assert.equal(by["Bhattacharya"]!.status, "found_inflected");
  assert.deepEqual(by["Bhattacharya"]!.forms, ["Bhattacharya's"]);
  assert.equal(by["Okonkwo"]!.status, "found_inflected");
  assert.deepEqual(by["Okonkwo"]!.forms, ["Okonkwo's"]);
  assert.equal(reports.every((r) => r.boosted === false), true);
});

test("jargon-plain: the four terms the plain run mangled come back as near misses at the measured spans", () => {
  const reports = analyseTerms(JARGON_TERMS, ["Nkemdirim"], loadFixture("jargon-plain"));
  const by = Object.fromEntries(reports.map((r) => [r.term, r]));

  const nkemdirim = by["Nkemdirim"]!;
  assert.equal(nkemdirim.status, "near_miss");
  assert.equal(nkemdirim.boosted, true);
  assert.ok(nkemdirim.candidates.some((c) => c.text === "n-k Dirac"), JSON.stringify(nkemdirim.candidates));
  assert.ok(nkemdirim.candidates.some((c) => c.text === "n-k dream"), JSON.stringify(nkemdirim.candidates));

  const ravindranath = by["Ravindranath"]!;
  assert.equal(ravindranath.status, "near_miss");
  assert.equal(ravindranath.candidates[0]?.text, "Rabi-Konath");
  assert.equal(ravindranath.candidates[0]?.source, "string");

  const adeyemi = by["Adeyemi-Lindqvist"]!;
  assert.equal(adeyemi.status, "near_miss");
  assert.equal(adeyemi.candidates[0]?.text, "Adami-Lindquist");

  // The second reading was one letter off; the first ("there are now a crucial") is
  // beyond string similarity and is the model pass's job.
  const thiru = by["Thirunavukkarasu"]!;
  assert.equal(thiru.status, "near_miss");
  assert.equal(thiru.candidates[0]?.text, "Tirunavukkarasu");
  assert.ok((thiru.candidates[0]?.similarity ?? 0) >= 0.9);
  assert.ok(!thiru.candidates.some((c) => c.text.toLowerCase().includes("crucial")));
});

test("jargon-boosted: every term found, none mangled", () => {
  const reports = analyseTerms(JARGON_TERMS, JARGON_TERMS, loadFixture("jargon-boosted"));
  for (const report of reports) {
    assert.ok(report.status === "found" || report.status === "found_inflected", report.term + " " + report.status);
    assert.equal(report.boosted, true);
  }
});

test("strang-plain: inflections count and are named, the absent term is absent, the counts match the measurement", () => {
  const reports = analyseTerms(STRANG_TERMS, [], loadFixture("strang-plain"));
  const by = Object.fromEntries(reports.map((r) => [r.term, r]));
  assert.equal(by["eigenvalue"]!.status, "found_inflected");
  assert.deepEqual(by["eigenvalue"]!.forms, ["eigenvalues"]);
  assert.equal(by["diagonalize"]!.status, "absent");
  assert.deepEqual(by["diagonalize"]!.candidates, []);
  assert.equal(by["lambda"]!.occurrences, 7);
  assert.equal(by["linearly independent"]!.occurrences, 1);
  assert.equal(by["eigenvector matrix"]!.occurrences, 3);
  // 4 `columns` plus 11 `column`: the singular is an inflection of the supplied plural.
  assert.equal(by["columns"]!.occurrences, 15);
  assert.equal(by["columns"]!.status, "found_inflected");
  // 7 `eigenvector` plus 4 `eigenvectors`.
  assert.equal(by["eigenvector"]!.occurrences, 11);
});

test("short terms never get near-miss candidates", () => {
  const finals = loadFixture("strang-plain");
  assert.deepEqual(nearMisses(tokenise(finals), termTokens("cap")), []);
  assert.deepEqual(nearMisses(tokenise(finals), termTokens("landa")), []);
});

test("locateSpan finds a verbatim span's word times inside a final, and nothing otherwise", () => {
  const finals = loadFixture("jargon-plain");
  const line = finals.find((f) => f.text.includes("there are now a crucial"))!;
  const located = locateSpan("there are now a crucial", line);
  assert.ok(located);
  assert.ok(located.startMs >= line.startMs && located.endMs <= line.endMs);
  assert.ok(located.endMs > located.startMs);
  assert.equal(locateSpan("Thirunavukkarasu criterion", line), null);
});

test("locateSpan aligns with word boundaries: 'normal matrix' is not in 'abnormal matrix'", () => {
  const words = ["The", "abnormal", "matrix", "case."].map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 400, speaker: "A" }));
  const line = {
    type: "final" as const,
    id: "1-0",
    sessionId: "s",
    turnOrder: 0,
    text: "The abnormal matrix case.",
    speakerLabel: "A",
    startMs: 0,
    endMs: 1_900,
    words,
    receivedAt: 0,
  };
  assert.equal(locateSpan("normal matrix", line), null);
  assert.deepEqual(locateSpan("abnormal matrix", line), { startMs: 500, endMs: 1_400 });
});
