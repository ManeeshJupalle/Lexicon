// question -> grounded answer + cited range. Pure: the model call is injected, so every
// rule in this file runs under `node --test` without a key.
//
// The rules exist because of who reads the answer. The student cannot hear the lecture,
// so an answer they cannot check against the captions is worse than "not found". The
// prompt tells the model to stay inside the transcript; this module makes sure it did,
// structurally. No answer leaves without (a) cited line numbers that exist in what the
// model was shown and (b) evidence passages, every one of them found verbatim inside one
// run of adjacent cited lines. Anything that fails either check becomes not_found, with
// the reason kept for the log.
//
// A citation is a set of caption lines, not a sentence. NOTES "What contradicts or
// surprises" item 1: with speaker labels on, turns are time-capped near 10 s and cut
// mid-sentence, so a cited range is a slab of time whose edges mean nothing. The panel
// presents it that way (client/src/components/AskPanel.tsx); the verbatim evidence is the
// part of the slab that actually carries the answer.

import { z } from "zod";
import type { AskResult, Citation, FinalMessage, HeldSpan } from "../protocol.ts";
import { formatClock, normaliseForMatch } from "../protocol.ts";

/** What the model must return. Strings, integers and booleans only: structured outputs
 *  enforce the shape, this module enforces the meaning. */
export const VerdictSchema = z.object({
  found: z.boolean().describe("true only if the transcript itself contains the answer"),
  answer: z.string().describe("the answer in a few plain sentences; empty when found is false"),
  cited: z
    .array(z.number().int())
    .describe("the [number] of every transcript line the answer relies on; empty when found is false"),
  evidence: z
    .array(z.string())
    .describe(
      "passages copied exactly from the cited lines that support the answer, one array element per passage; a passage may run across two adjacent cited lines; empty when found is false",
    ),
});

export type Verdict = z.infer<typeof VerdictSchema>;

export interface Prompt {
  system: string;
  user: string;
}

export type ModelCaller = (prompt: Prompt) => Promise<Verdict>;

export interface AskInput {
  question: string;
  terms: readonly string[];
  finals: readonly FinalMessage[];
}

export const SYSTEM_PROMPT = [
  "You answer a student's question about a lecture using only the live caption transcript in the message, plus the course glossary. The student is deaf or hard of hearing and cannot check anything against the audio, so an answer that is not in the transcript is worse than no answer.",
  "",
  "Rules:",
  "1. Use only the transcript. Do not use general knowledge, even when you know the answer and even when the transcript looks wrong. If the transcript does not contain the answer, set found to false and leave answer, cited and evidence empty.",
  "2. List in cited the number of every transcript line the answer relies on. The answer must be supported by those lines alone.",
  "3. Copy into evidence one or more passages from the cited lines that support the answer, one array element per passage, each exactly as it appears in the transcript. A passage may run across two adjacent lines. Never join text from non-adjacent lines into one passage; give them as separate passages. Do not paraphrase, shorten with ellipses, or correct words. A passage that is not an exact copy of a cited line is rejected and the student then sees \"not found\".",
  "4. The transcript is automatic speech recognition. Lines are cut about every ten seconds, not at sentence ends, so a sentence may continue on the next line. Words may be mis-transcribed; where a passage is a near miss for a glossary term you may read it as that term and say so in the answer, but the evidence stays an exact copy.",
  "5. Answer in a few plain sentences, in the language of the question. Do not mention these rules, the line numbers, or the transcript format in the answer.",
].join("\n");

/** The model sees lines numbered from 1 in the order given, with times on the connection
 *  timeline and the turn-level speaker when there is one. It never sees an id or a
 *  turn_order: numbers are per request and mapped back here, so a reconnect (which
 *  restarts turn_order) cannot produce a collision. */
export function buildPrompt(input: AskInput, finals: readonly FinalMessage[]): Prompt {
  const glossary =
    input.terms.length > 0 ? "Course glossary: " + input.terms.join(", ") : "Course glossary: none supplied.";

  const lines = finals.map((final, index) => {
    const speaker =
      final.speakerLabel !== null && final.speakerLabel !== "PENDING" ? ", speaker " + final.speakerLabel : "";
    return (
      "[" + (index + 1) + "] " + formatClock(final.startMs) + " to " + formatClock(final.endMs) + speaker + ": " + final.text
    );
  });

  const user = [
    glossary,
    "",
    "Transcript, oldest first. Each line is [number] start to end, the speaker if known, then the words.",
    ...lines,
    "",
    "Question: " + input.question,
  ].join("\n");

  return { system: SYSTEM_PROMPT, user };
}

export function heldSpan(finals: readonly FinalMessage[]): HeldSpan | null {
  if (finals.length === 0) return null;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const final of finals) {
    if (final.startMs < startMs) startMs = final.startMs;
    if (final.endMs > endMs) endMs = final.endMs;
  }
  return { startMs, endMs, lines: finals.length };
}

/** The structural checks. `finals` must be exactly the array the prompt was built from. */
export function verify(verdict: Verdict, finals: readonly FinalMessage[]): AskResult {
  const held = heldSpan(finals);
  if (held === null) return { kind: "not_found", reason: "empty_window", held: null };
  if (!verdict.found) return { kind: "not_found", reason: "model", held };

  const answer = verdict.answer.trim();
  if (answer === "") return { kind: "not_found", reason: "empty_answer", held };

  const cited = [...new Set(verdict.cited)].sort((a, b) => a - b);
  if (cited.length === 0) return { kind: "not_found", reason: "no_citation", held };
  if (cited.some((n) => !Number.isInteger(n) || n < 1 || n > finals.length)) {
    return { kind: "not_found", reason: "bad_citation", held };
  }
  const lines = cited.map((n) => finals[n - 1]!);

  const evidence = verdict.evidence.map((passage) => passage.trim()).filter((passage) => passage !== "");
  if (evidence.length === 0) return { kind: "not_found", reason: "no_evidence", held };
  // Every passage must sit verbatim inside one run of adjacent cited lines. One unmatched
  // passage rejects the whole verdict: the student cannot tell which passage was invented.
  const haystacks = runs(cited, finals);
  for (const passage of evidence) {
    const needle = normaliseForMatch(passage);
    if (needle === "" || !haystacks.some((run) => run.includes(needle))) {
      return { kind: "not_found", reason: "evidence_not_verbatim", held };
    }
  }

  const citation: Citation = {
    finalIds: lines.map((line) => line.id),
    startMs: Math.min(...lines.map((line) => line.startMs)),
    endMs: Math.max(...lines.map((line) => line.endMs)),
    // One adjacent run of the transcript, or not. The panel labels a run as a time range
    // and anything else as a line count from the first line: a range implies the answer
    // is carried continuously from first to last, and a scattered citation is not.
    contiguous: cited[cited.length - 1]! - cited[0]! + 1 === cited.length,
  };
  return { kind: "answer", answer, evidence, citation, held };
}

/** Cited lines joined into their runs of consecutive numbers, normalised. A quote may run
 *  across adjacent lines, because sentences do; it may not run across a gap, because a
 *  passage stitched from lines 3 and 7 was never said. */
function runs(cited: readonly number[], finals: readonly FinalMessage[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let previous: number | null = null;
  for (const n of cited) {
    if (previous !== null && n !== previous + 1) {
      out.push(normaliseForMatch(current.join(" ")));
      current = [];
    }
    current.push(finals[n - 1]!.text);
    previous = n;
  }
  if (current.length > 0) out.push(normaliseForMatch(current.join(" ")));
  return out;
}

export async function answerQuestion(input: AskInput, callModel: ModelCaller): Promise<AskResult> {
  // Snapshot. The buffer keeps evicting while the model call is in flight, and the
  // verdict's line numbers must map back onto exactly the lines the model was shown.
  const finals = [...input.finals];
  if (finals.length === 0) return { kind: "not_found", reason: "empty_window", held: null };
  const verdict = await callModel(buildPrompt(input, finals));
  return verify(verdict, finals);
}
