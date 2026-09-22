// question -> grounded answer + cited range. Pure: the model call is injected, so every
// rule in this file runs under `node --test` without a key.
//
// The rules exist because of who reads the answer. The student cannot hear the lecture,
// so an answer they cannot check against the captions is worse than "not found". The
// prompt tells the model to stay inside the transcript; grounding.ts makes sure it did,
// structurally, and anything that fails becomes not_found with the reason kept for the
// log.
//
// A citation is a set of caption lines, not a sentence. NOTES "What contradicts or
// surprises" item 1: with speaker labels on, turns are time-capped near 10 s and cut
// mid-sentence, so a cited range is a slab of time whose edges mean nothing. The panel
// presents it that way (client/src/components/AskPanel.tsx); the verbatim evidence is the
// part of the slab that actually carries the answer.

import { z } from "zod";
import type { AskResult, FinalMessage, HeldSpan } from "../protocol.ts";
import { formatClock } from "../protocol.ts";
import { ground } from "./grounding.ts";

/** What the model must return. Strings, integers and booleans only: structured outputs
 *  enforce the shape, grounding.ts enforces the meaning. */
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

/** The transcript as every model call sees it: lines numbered from 1 in the order given,
 *  with times on the connection timeline and the turn-level speaker when there is one. The
 *  model never sees an id or a turn_order: numbers are per request and mapped back by
 *  grounding.ts, so a reconnect (which restarts turn_order) cannot produce a collision. */
export function formatTranscript(finals: readonly FinalMessage[]): string {
  const lines = finals.map((final, index) => {
    const speaker =
      final.speakerLabel !== null && final.speakerLabel !== "PENDING" ? ", speaker " + final.speakerLabel : "";
    return (
      "[" + (index + 1) + "] " + formatClock(final.startMs) + " to " + formatClock(final.endMs) + speaker + ": " + final.text
    );
  });
  return [
    "Transcript, oldest first. Each line is [number] start to end, the speaker if known, then the words.",
    ...lines,
  ].join("\n");
}

export function formatGlossary(terms: readonly string[]): string {
  return terms.length > 0 ? "Course glossary: " + terms.join(", ") : "Course glossary: none supplied.";
}

export function buildPrompt(input: AskInput, finals: readonly FinalMessage[]): Prompt {
  const user = [formatGlossary(input.terms), "", formatTranscript(finals), "", "Question: " + input.question].join("\n");
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

  const grounded = ground(verdict.cited, verdict.evidence, finals);
  if (!grounded.ok) return { kind: "not_found", reason: grounded.reason, held };

  return { kind: "answer", answer, evidence: grounded.evidence, citation: grounded.citation, held };
}

export async function answerQuestion(input: AskInput, callModel: ModelCaller): Promise<AskResult> {
  // Snapshot. The buffer keeps evicting while the model call is in flight, and the
  // verdict's line numbers must map back onto exactly the lines the model was shown.
  const finals = [...input.finals];
  if (finals.length === 0) return { kind: "not_found", reason: "empty_window", held: null };
  const verdict = await callModel(buildPrompt(input, finals));
  return verify(verdict, finals);
}
