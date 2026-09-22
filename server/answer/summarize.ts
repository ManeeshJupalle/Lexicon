// End-of-session output: a summary of what was covered, the key terms as the lecturer used
// them, and which supplied glossary terms were missed or mangled. Pure: the three model
// calls are injected, so every rule here runs under `node --test` without a key.
//
// Grounding is the same as the ask path (grounding.ts) and applies to the summary as much
// as to the definitions. A summary point cites lines and carries verbatim passages; the
// panel shows the paraphrase as the main text with the passages as small anchors beneath
// it. A line number alone would let a point drift with nothing to catch it, and this
// reader cannot check by ear. Points and terms that fail grounding are dropped, and the
// output says how many.
//
// The missed-term list is deterministic first (terms.ts) and model-assisted second: the
// model is only asked about terms the detector could not find, may only answer with a
// verbatim span from a named line, and every suggestion is verified against that line
// before it is shown, labelled as the model's suggestion.
//
// Size: a 50-minute lecture is roughly 11k tokens of transcript. Each of the three calls
// carries it once, in parallel, so the whole output costs about three transcripts of
// input and a few thousand tokens of output.

import { z } from "zod";
import type { FinalMessage, KeyTerm, SessionOutput, SummaryPoint, TermReport } from "../protocol.ts";
import { normaliseForMatch } from "../protocol.ts";
import { formatGlossary, formatTranscript, type Prompt } from "./ask.ts";
import { ground } from "./grounding.ts";
import { analyseTerms, locateSpan } from "./terms.ts";

const CITED = z.array(z.number().int()).describe("the [number] of every transcript line this rests on");
const EVIDENCE = z
  .array(z.string())
  .describe(
    "passages copied exactly from the cited lines, one array element per passage; a passage may run across two adjacent cited lines, never across a gap",
  );

export const SummarySchema = z.object({
  points: z.array(
    z.object({
      text: z.string().describe("one or two plain sentences saying what was covered"),
      cited: CITED,
      evidence: EVIDENCE,
    }),
  ),
});
export type Summary = z.infer<typeof SummarySchema>;

export const KeyTermsSchema = z.object({
  terms: z.array(
    z.object({
      term: z.string().describe("the term as the lecturer used it"),
      definition: z.string().describe("what it means in this lecture, as used here, one or two sentences"),
      cited: CITED,
      evidence: EVIDENCE,
    }),
  ),
});
export type KeyTerms = z.infer<typeof KeyTermsSchema>;

export const ManglesSchema = z.object({
  suggestions: z.array(
    z.object({
      term: z.string().describe("one of the listed glossary terms, exactly as listed"),
      line: z.number().int().describe("the [number] of the transcript line containing the span"),
      span: z.string().describe("the span of that line, copied exactly, that is probably this term mis-transcribed"),
    }),
  ),
});
export type Mangles = z.infer<typeof ManglesSchema>;

export interface SessionCallers {
  summary: (prompt: Prompt) => Promise<Summary>;
  keyTerms: (prompt: Prompt) => Promise<KeyTerms>;
  mangles: (prompt: Prompt) => Promise<Mangles>;
}

export interface SessionInput {
  finals: readonly FinalMessage[];
  /** Every supplied glossary term, as the client holds it at session end. */
  terms: readonly string[];
  /** The subset that went up as keyterms at session start. */
  boosted: readonly string[];
  model: string;
}

const SHARED_RULES = [
  "The transcript is automatic speech recognition of a lecture, for a student who could not hear it and read live captions instead. Use only the transcript in the message and the course glossary. Do not use general knowledge about the subject.",
  "Lines are cut about every ten seconds, not at sentence ends, so a sentence may continue on the next line. Words may be mis-transcribed; where a passage is a near miss for a glossary term you may read it as that term.",
  "Evidence rules: give in cited the [number] of every transcript line the item rests on, and in evidence one or more passages copied exactly from those lines, one array element per passage. Quote the shortest passages that carry the item, a phrase or a sentence, not whole lines when a phrase will do. A passage may run across two adjacent lines, and then both lines must be in cited. Never join text from non-adjacent lines into one passage. Do not paraphrase, shorten with ellipses, or correct words inside a passage. Items whose evidence is not an exact copy of cited lines are discarded before the student sees them, so copy carefully.",
  "Do not mention the transcript, the line numbers or these rules in the text you write.",
].join("\n");

export const SUMMARY_SYSTEM = [
  "You write the end-of-session summary of what a lecture covered.",
  SHARED_RULES,
  "Write 5 to 12 points in the order the lecture covered them. Each point's text is one or two plain sentences describing what was covered or said, not what you know about the topic.",
].join("\n\n");

export const KEY_TERMS_SYSTEM = [
  "You compile the key terms of a lecture, each defined as the lecturer used it.",
  SHARED_RULES,
  "List up to 15 terms: course glossary terms that appear in the transcript, and other terms the lecturer defines, names or explains. For each give the term as the lecturer used it, and a definition of one or two sentences saying what it means in this lecture as used here, never a textbook definition. Skip a term the transcript only mentions without saying what it is. Where the same idea is named in several ways, give it once.",
].join("\n\n");

export const MANGLES_SYSTEM = [
  "You look for glossary terms that automatic speech recognition mis-heard.",
  "The transcript in the message is automatic speech recognition of a lecture. The listed course glossary terms were expected to occur but were not found in it as written. A term may have been transcribed as one or more ordinary words that sound like it: a surname as a short phrase, a technical word as a common one. A term may occur several times, rendered differently each time.",
  "Some spans have already been matched to a term by spelling similarity; they are listed with the term. Do not repeat those. Look for other occurrences, especially ones that do not resemble the spelling at all: a run of ordinary words that reads oddly where a name or technical term belongs, or a sentence that appears more than once in the transcript with the term rendered differently in each copy.",
  "For each span you find, give the term exactly as listed, the [number] of the line, and the span copied exactly as it appears in that line. Copy the whole run of words that stands in for the term, from its first word to its last, not a part of it and not the words around it. If you find no further span for a term, leave it out. Never invent or adjust a span; every span must be an exact copy from the line you name. Suggestions that are not exact copies are discarded.",
].join("\n\n");

export function buildSummaryPrompt(finals: readonly FinalMessage[], terms: readonly string[]): Prompt {
  return { system: SUMMARY_SYSTEM, user: [formatGlossary(terms), "", formatTranscript(finals)].join("\n") };
}

export function buildKeyTermsPrompt(finals: readonly FinalMessage[], terms: readonly string[]): Prompt {
  return { system: KEY_TERMS_SYSTEM, user: [formatGlossary(terms), "", formatTranscript(finals)].join("\n") };
}

/** The unfound terms, each with the spans the string detector already matched (by line
 *  number, so the model can look at the sentence around them and hunt for the other
 *  readings). */
export function buildManglesPrompt(finals: readonly FinalMessage[], unfound: readonly TermReport[]): Prompt {
  const lineOf = new Map(finals.map((final, index) => [final.id, index + 1]));
  const list = unfound
    .map((report) => {
      const known = report.candidates
        .filter((candidate) => candidate.source === "string")
        .map((candidate) => "“" + candidate.text + "” in line " + String(lineOf.get(candidate.finalId) ?? "?"));
      return "- " + report.term + (known.length > 0 ? " (already matched by spelling: " + known.join(", ") + ")" : "");
    })
    .join("\n");
  return {
    system: MANGLES_SYSTEM,
    user: ["Glossary terms not found in the transcript as written:", list, "", formatTranscript(finals)].join("\n"),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What grounding refused and why. Never sent to the client; the proxy logs it so a drop
 *  count in the output can be read against what the model actually said. */
export interface Drop {
  part: "summary" | "keyTerms" | "suggestions";
  reason: string;
  text: string;
}

export async function generateSessionOutput(
  input: SessionInput,
  callers: SessionCallers,
  onDrop?: (drop: Drop) => void,
): Promise<SessionOutput> {
  const started = Date.now();
  const finals = [...input.finals];
  const glossary = analyseTerms(input.terms, input.boosted, finals);
  const unfound = glossary.filter((report) => report.status === "near_miss" || report.status === "absent");
  const errors: SessionOutput["errors"] = [];
  const dropped = { summary: 0, keyTerms: 0, suggestions: 0 };

  const empty = finals.length === 0;
  const [summaryResult, keyTermsResult, manglesResult] = await Promise.allSettled([
    empty ? Promise.resolve<Summary>({ points: [] }) : callers.summary(buildSummaryPrompt(finals, input.terms)),
    empty ? Promise.resolve<KeyTerms>({ terms: [] }) : callers.keyTerms(buildKeyTermsPrompt(finals, input.terms)),
    empty || unfound.length === 0
      ? Promise.resolve<Mangles>({ suggestions: [] })
      : callers.mangles(buildManglesPrompt(finals, unfound)),
  ]);

  const summary: SummaryPoint[] = [];
  if (summaryResult.status === "fulfilled") {
    for (const point of summaryResult.value.points) {
      const text = point.text.trim();
      const grounded = ground(point.cited, point.evidence, finals);
      if (text === "" || !grounded.ok) {
        dropped.summary += 1;
        onDrop?.({ part: "summary", reason: text === "" ? "empty_text" : grounded.ok ? "" : grounded.reason, text: JSON.stringify(point) });
        continue;
      }
      summary.push({ text, evidence: grounded.evidence, citation: grounded.citation });
    }
  } else {
    errors.push({ part: "summary", detail: describeError(summaryResult.reason) });
  }

  const keyTerms: KeyTerm[] = [];
  const seenTerms = new Set<string>();
  if (keyTermsResult.status === "fulfilled") {
    for (const entry of keyTermsResult.value.terms) {
      const term = entry.term.trim();
      const definition = entry.definition.trim();
      const key = term.toLowerCase();
      const grounded = ground(entry.cited, entry.evidence, finals);
      if (term === "" || definition === "" || seenTerms.has(key) || !grounded.ok) {
        dropped.keyTerms += 1;
        onDrop?.({
          part: "keyTerms",
          reason: term === "" || definition === "" ? "empty" : seenTerms.has(key) ? "duplicate" : grounded.ok ? "" : grounded.reason,
          text: JSON.stringify(entry),
        });
        continue;
      }
      seenTerms.add(key);
      keyTerms.push({ term, definition, evidence: grounded.evidence, citation: grounded.citation });
    }
  } else {
    errors.push({ part: "keyTerms", detail: describeError(keyTermsResult.reason) });
  }

  if (manglesResult.status === "fulfilled") {
    for (const suggestion of manglesResult.value.suggestions) {
      const report = unfound.find((r) => r.term.toLowerCase() === suggestion.term.trim().toLowerCase());
      const final = Number.isInteger(suggestion.line) ? finals[suggestion.line - 1] : undefined;
      const span = suggestion.span.trim();
      const located = report !== undefined && final !== undefined && span !== "" ? locateSpan(span, final) : null;
      if (report === undefined || final === undefined || located === null) {
        dropped.suggestions += 1;
        onDrop?.({
          part: "suggestions",
          reason: report === undefined ? "unknown_term" : final === undefined ? "bad_line" : "span_not_in_line",
          text: JSON.stringify(suggestion),
        });
        continue;
      }
      const duplicate = report.candidates.some(
        (c) => normaliseForMatch(c.text) === normaliseForMatch(span) && c.finalId === final.id,
      );
      if (!duplicate) {
        report.candidates.push({ text: span, startMs: located.startMs, endMs: located.endMs, finalId: final.id, similarity: null, source: "model" });
      }
      if (report.status === "absent") report.status = "near_miss";
    }
  } else {
    errors.push({ part: "mangles", detail: describeError(manglesResult.reason) });
  }

  const first = finals[0];
  const last = finals[finals.length - 1];
  return {
    generatedAt: Date.now(),
    transcript: {
      lines: finals.length,
      words: finals.reduce((n, f) => n + f.words.length, 0),
      startMs: first ? Math.min(...finals.map((f) => f.startMs)) : 0,
      endMs: last ? Math.max(...finals.map((f) => f.endMs)) : 0,
    },
    summary,
    keyTerms,
    glossary,
    dropped,
    errors,
    model: input.model,
    elapsedMs: Date.now() - started,
  };
}
