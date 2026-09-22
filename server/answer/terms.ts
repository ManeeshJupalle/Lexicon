// Which supplied glossary terms landed in the transcript, and where the ones that did not
// probably went.
//
// Deterministic, over the words of the finals with their timings. Every claim it makes
// is a span of the transcript with a time, never an opinion: "found 7 times, first at
// 2:02", or "not found as written; nearest span `n-k Dirac` at 0:17, similarity 0.56".
// Whether a near miss really was the term is not decidable without a reference
// transcript, so the output says "possibly" and shows the span for the reader to judge.
//
// Why spans and not words. docs/data/boost-measurement.md, second measurement: without
// boosting, `Nkemdirim` arrived as `n-k Dirac` (two words), `Thirunavukkarasu` as `there
// are now a crucial` (five). A mangled term is often several ordinary words, so candidates
// are runs of one to a few consecutive words, squashed to letters and compared by edit
// distance. That catches `Rabi-Konath`, `Adami-Lindquist`, `n-k Dirac` and
// `Tirunavukkarasu`. It cannot catch `there are now a crucial`; that is what the model
// pass in summarize.ts is for, and its suggestions are verified verbatim before they are
// shown.

import type { FinalMessage, TermCandidate, TermReport } from "../protocol.ts";
import { includesWords, normaliseForMatch } from "../protocol.ts";

interface Token {
  norm: string;
  /** Index of the source word, so a hyphenated word that split into two tokens is
   *  rendered once. */
  word: number;
  text: string;
  startMs: number;
  endMs: number;
  finalId: string;
}

/** Below this many letters a term gets exact matching only: near-miss scoring on short
 *  words matches everything. */
const MIN_NEAR_MISS_LETTERS = 6;
/** How many extra words a mangled rendering may spread over, beyond the term's own. */
const EXTRA_SPAN_WORDS = 3;
const MAX_SPAN_WORDS = 6;
const MAX_CANDIDATES = 3;

export function tokenise(finals: readonly FinalMessage[]): Token[] {
  const out: Token[] = [];
  let word = 0;
  for (const final of finals) {
    for (const w of final.words) {
      const parts = normaliseForMatch(w.text).split(" ").filter(Boolean);
      for (const part of parts) {
        out.push({ norm: part, word, text: w.text, startMs: w.startMs, endMs: w.endMs, finalId: final.id });
      }
      word += 1;
    }
  }
  return out;
}

export function termTokens(term: string): string[] {
  return normaliseForMatch(term).split(" ").filter(Boolean);
}

/** `columns` for `column`, `eigenvectors` for `eigenvector`, `Okonkwo's` for `Okonkwo`:
 *  a short suffix on the last word, or a plural dropped from it. Only the last word of a
 *  multi-word term may inflect. */
function inflected(token: string, want: string): boolean {
  if (token.startsWith(want) && token.length - want.length <= 3) return true;
  if (want.endsWith("es") && token === want.slice(0, -2)) return true;
  if (want.endsWith("s") && token === want.slice(0, -1)) return true;
  return false;
}

function matchAt(tokens: readonly Token[], at: number, want: readonly string[]): "exact" | "inflected" | null {
  for (let k = 0; k < want.length; k++) {
    const token = tokens[at + k];
    if (token === undefined) return null;
    const target = want[k]!;
    if (token.norm === target) continue;
    if (k === want.length - 1 && inflected(token.norm, target)) return "inflected";
    return null;
  }
  return "exact";
}

function spanText(tokens: readonly Token[], from: number, to: number): string {
  const parts: string[] = [];
  let lastWord = -1;
  for (let i = from; i <= to; i++) {
    const token = tokens[i]!;
    if (token.word !== lastWord) parts.push(token.text);
    lastWord = token.word;
  }
  return parts.join(" ");
}

/** Trailing punctuation off a rendered form, so `eigenvalues,` reads as `eigenvalues`. */
function trimForm(text: string): string {
  return text.replace(/[.,;:!?—–"')\]]+$/u, "");
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array<number>(cols);
  let current = new Array<number>(cols);
  for (let j = 0; j < cols; j++) previous[j] = j;
  for (let i = 1; i < rows; i++) {
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[cols - 1]!;
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient on character bigrams: a cheap prefilter so edit distance runs on the
 *  few spans that share letters with the term, not on every span of the transcript. */
function bigramDice(a: Map<string, number>, bTotal: number, b: Map<string, number>, aTotal: number): number {
  let common = 0;
  for (const [g, n] of a) {
    const m = b.get(g);
    if (m !== undefined) common += Math.min(n, m);
  }
  return aTotal + bTotal === 0 ? 0 : (2 * common) / (aTotal + bTotal);
}

/** Longer terms tolerate more damage before they stop being recognisable. Thresholds set
 *  against the jargon captures (terms.test.ts): `n-k Dirac` scores 0.56 against
 *  `Nkemdirim`, `Rabi-Konath` 0.58 against `Ravindranath`, and no wrong span scores above
 *  them. */
function similarityThreshold(letters: number): number {
  return letters >= 8 ? 0.55 : 0.65;
}

/** Consonants only, doubles collapsed. Vowels are what the recogniser gets wrong in a
 *  name it does not know (`n-k dream` for `Nkemdirim`, `Adami` for `Adeyemi`), so two
 *  spellings that agree on their consonants are close even when their letters are not.
 *  Used as a second signal, never alone: `and made him` shares consonants with
 *  `Nkemdirim` too. */
function skeleton(letters: string): string {
  return letters.replace(/[aeiouy']/g, "").replace(/(.)\1+/g, "$1");
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - levenshtein(a, b) / longest;
}

/** The letter similarity is the score reported. A span is accepted on letters alone
 *  above the threshold, or on letters at 0.4 or better when its consonant skeleton is
 *  within 0.7 of the term's. */
const SKELETON_FLOOR_LETTERS = 0.4;
const SKELETON_THRESHOLD = 0.7;

/** Letters and digits only. The verbatim normaliser keeps hyphens, apostrophes and signs
 *  because they can change a claim; this comparison is only looking for a name that the
 *  recogniser spelled wrong, and `n-k Dirac` should still score against `Nkemdirim`. */
function lettersOnly(token: string): string {
  return token.replace(/[^\p{L}\p{N}]/gu, "");
}

export function nearMisses(tokens: readonly Token[], want: readonly string[]): TermCandidate[] {
  const squashed = lettersOnly(want.join(""));
  if (squashed.length < MIN_NEAR_MISS_LETTERS) return [];
  const threshold = similarityThreshold(squashed.length);
  const termGrams = bigrams(squashed);
  const termGramTotal = squashed.length - 1;
  const termSkeleton = skeleton(squashed);
  const termSkeletonGrams = bigrams(termSkeleton);
  const maxSpan = Math.min(MAX_SPAN_WORDS, want.length + EXTRA_SPAN_WORDS);
  const found: (TermCandidate & { from: number; to: number })[] = [];

  for (let i = 0; i < tokens.length; i++) {
    let spanLetters = "";
    for (let k = 0; k < maxSpan && i + k < tokens.length; k++) {
      spanLetters += lettersOnly(tokens[i + k]!.norm);
      const ratio = spanLetters.length / squashed.length;
      if (ratio > 1.6) break;
      if (ratio < 0.6) continue;
      // Cheap prefilter on shared bigrams, of the letters or of the skeletons, so edit
      // distance runs on the few spans that share material with the term.
      const spanSkeleton = skeleton(spanLetters);
      const sharesLetters = bigramDice(termGrams, spanLetters.length - 1, bigrams(spanLetters), termGramTotal) >= 0.25;
      const sharesSkeleton = bigramDice(termSkeletonGrams, spanSkeleton.length - 1, bigrams(spanSkeleton), termSkeleton.length - 1) >= 0.3;
      if (!sharesLetters && !sharesSkeleton) continue;
      const letterSimilarity = similarity(spanLetters, squashed);
      const accepted =
        letterSimilarity >= threshold ||
        (letterSimilarity >= SKELETON_FLOOR_LETTERS && similarity(spanSkeleton, termSkeleton) >= SKELETON_THRESHOLD);
      if (!accepted) continue;
      const sim = letterSimilarity;
      const first = tokens[i]!;
      const last = tokens[i + k]!;
      found.push({
        text: spanText(tokens, i, i + k),
        startMs: first.startMs,
        endMs: last.endMs,
        finalId: first.finalId,
        similarity: Math.round(sim * 100) / 100,
        source: "string",
        from: i,
        to: i + k,
      });
    }
  }

  // Best first; overlapping spans keep only their best.
  found.sort((a, b) => b.similarity! - a.similarity! || a.from - b.from);
  const kept: (TermCandidate & { from: number; to: number })[] = [];
  for (const candidate of found) {
    if (kept.some((k) => candidate.from <= k.to && candidate.to >= k.from)) continue;
    kept.push(candidate);
    if (kept.length === MAX_CANDIDATES) break;
  }
  return kept.map(({ from: _from, to: _to, ...candidate }) => candidate);
}

/** One report per supplied term, in the order supplied. `boosted` are the terms that went
 *  up as keyterms this session; a missed term that was never boosted says nothing about
 *  boosting, and the report keeps the two apart. */
export function analyseTerms(terms: readonly string[], boosted: readonly string[], finals: readonly FinalMessage[]): TermReport[] {
  const tokens = tokenise(finals);
  const boostedSet = new Set(boosted.map((t) => t.toLowerCase()));
  const reports: TermReport[] = [];

  for (const term of terms) {
    const want = termTokens(term);
    if (want.length === 0) continue;

    let occurrences = 0;
    let allExact = true;
    let firstMs: number | null = null;
    // Distinct renderings, first spelling seen wins: `Eigenvectors` is `eigenvectors`.
    const forms = new Map<string, string>();
    for (let i = 0; i < tokens.length; i++) {
      const kind = matchAt(tokens, i, want);
      if (kind === null) continue;
      occurrences += 1;
      if (kind === "inflected") allExact = false;
      if (firstMs === null) firstMs = tokens[i]!.startMs;
      const form = trimForm(spanText(tokens, i, i + want.length - 1));
      if (!forms.has(form.toLowerCase())) forms.set(form.toLowerCase(), form);
      i += want.length - 1;
    }

    const candidates = occurrences === 0 ? nearMisses(tokens, want) : [];
    reports.push({
      term,
      boosted: boostedSet.has(term.toLowerCase()),
      status: occurrences > 0 ? (allExact ? "found" : "found_inflected") : candidates.length > 0 ? "near_miss" : "absent",
      occurrences,
      forms: [...forms.values()],
      firstMs,
      candidates,
    });
  }
  return reports;
}

/** Locate a verbatim span inside one final, for a model-suggested mangle. Word-level
 *  times when the span's words can be found in order; the line's own span otherwise. */
export function locateSpan(span: string, final: FinalMessage): { startMs: number; endMs: number } | null {
  const want = termTokens(span);
  if (want.length === 0) return null;
  // Whole words, as in grounding.ts: "normal matrix" is not in "abnormal matrix".
  if (!includesWords(normaliseForMatch(final.text), want.join(" "))) return null;
  const tokens = tokenise([final]);
  for (let i = 0; i + want.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (tokens[i + k]!.norm !== want[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return { startMs: tokens[i]!.startMs, endMs: tokens[i + want.length - 1]!.endMs };
  }
  return { startMs: final.startMs, endMs: final.endMs };
}
