// The grounding check, shared by the ask path and the session output.
//
// A grounded claim is (a) a set of cited line numbers that exist in what the model was
// shown and (b) one or more evidence passages, each found verbatim inside one run of
// adjacent cited lines. A passage may run across adjacent lines, because sentences do; it
// may not run across a gap, because a passage stitched from lines 3 and 7 was never said;
// and one passage that matches nothing rejects the whole claim, because the reader cannot
// tell which passage was invented. Anything the model says that fails this never reaches
// the client as a claim: an answer becomes "not found", a summary point or key term is
// dropped and counted.
//
// The rule exists because of who reads the output. A student who could not hear the
// lecture has no way to catch a confident wrong claim; a verbatim anchor into the captions
// is the one thing they can check.

import type { Citation } from "../protocol.ts";
import { includesWords, normaliseForMatch } from "../protocol.ts";

/** What a line needs to be cited: FinalMessage satisfies this. */
export interface GroundedLine {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export type GroundingFailure = "no_citation" | "bad_citation" | "no_evidence" | "evidence_not_verbatim";

export type Grounding =
  | { ok: true; cited: number[]; evidence: string[]; citation: Citation }
  | { ok: false; reason: GroundingFailure };

/** `cited` are 1-based numbers into `lines`, exactly as the model was shown them. */
export function ground(citedRaw: readonly number[], passagesRaw: readonly string[], lines: readonly GroundedLine[]): Grounding {
  const cited = [...new Set(citedRaw)].sort((a, b) => a - b);
  if (cited.length === 0) return { ok: false, reason: "no_citation" };
  if (cited.some((n) => !Number.isInteger(n) || n < 1 || n > lines.length)) return { ok: false, reason: "bad_citation" };

  const evidence = passagesRaw.map((passage) => passage.trim()).filter((passage) => passage !== "");
  if (evidence.length === 0) return { ok: false, reason: "no_evidence" };

  const haystacks = runs(cited, lines);
  for (const passage of evidence) {
    const needle = normaliseForMatch(passage);
    // Whole words only: a substring test would let "normal matrix" verify against
    // "abnormal matrix".
    if (needle === "" || !haystacks.some((run) => includesWords(run, needle))) return { ok: false, reason: "evidence_not_verbatim" };
  }

  return { ok: true, cited, evidence, citation: citationFor(cited, lines) };
}

/** Cited lines joined into their runs of consecutive numbers, normalised for matching. */
export function runs(cited: readonly number[], lines: readonly GroundedLine[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let previous: number | null = null;
  for (const n of cited) {
    if (previous !== null && n !== previous + 1) {
      out.push(normaliseForMatch(current.join(" ")));
      current = [];
    }
    current.push(lines[n - 1]!.text);
    previous = n;
  }
  if (current.length > 0) out.push(normaliseForMatch(current.join(" ")));
  return out;
}

export function citationFor(cited: readonly number[], lines: readonly GroundedLine[]): Citation {
  const chosen = cited.map((n) => lines[n - 1]!);
  return {
    finalIds: chosen.map((line) => line.id),
    startMs: Math.min(...chosen.map((line) => line.startMs)),
    endMs: Math.max(...chosen.map((line) => line.endMs)),
    // One adjacent run of the transcript, or not. The panel labels a run as a time range
    // and anything else as a line count from the first line: a range implies the claim is
    // carried continuously from first to last, and a scattered citation is not.
    contiguous: cited[cited.length - 1]! - cited[0]! + 1 === cited.length,
  };
}
