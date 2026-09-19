// The speaker gutter decision, in one place.
//
// Rules come from docs/fixtures/NOTES.md and are deliberately conservative: this is the
// accessibility surface, and a reader who cannot hear the room has no way to catch a
// speaker attribution that is wrong. When the payload does not say who spoke, the gutter
// says nothing. It never guesses, never invents a name, and never carries the previous
// line's speaker forward.
//
// Why per-word `speaker` and not the turn's `speaker_label`: NOTES "Speaker information"
// records a final whose turn label is "A" while its words run [B ... A ...]. The turn
// label is a summary and can disagree with the words inside the same frame, so the words
// are the truth and the label is only a fallback for the case where no word carries one.

import type { FinalMessage } from "../../server/protocol.ts";

/** The literal AssemblyAI emits when diarization has not resolved a speaker yet. NOTES
 *  addendum: 12 of 34 finals in one capture carried it, all of them 1-5 words long. */
export const PENDING = "PENDING";

export type Gutter =
  | { kind: "speaker"; label: string }
  | { kind: "neutral"; reason: NeutralReason };

/** Why the gutter is blank. Not shown as body text — it drives the tooltip and the
 *  screen-reader description, so "we don't know yet" is distinguishable from "two people
 *  talked here" by anyone who goes looking. */
export type NeutralReason = "pending" | "mixed" | "absent" | "partial";

export const NEUTRAL_REASON_TEXT: Record<NeutralReason, string> = {
  pending: "speaker not yet resolved for this line",
  mixed: "more than one speaker in this line",
  absent: "no speaker information in this line",
  partial: "speaker is not known until the line is final",
};

/** Partials carry no speaker information at all — NOTES measures 0 of 680 partial words
 *  with a `speaker` key, at any point in any capture. So this is not an edge case that
 *  occasionally fires: the in-flight line is always neutral. */
export const PARTIAL_GUTTER: Gutter = { kind: "neutral", reason: "partial" };

export function gutterForFinal(final: FinalMessage): Gutter {
  const labels = new Set<string>();
  let sawPending = false;

  for (const word of final.words) {
    if (word.speaker === null) continue;
    if (word.speaker === PENDING) {
      sawPending = true;
      continue;
    }
    labels.add(word.speaker);
  }

  // Any unresolved word makes the whole line unresolved. A line labelled "A" that is
  // really "A, then someone we haven't identified" is the kind of half-truth this gutter
  // exists to avoid.
  if (sawPending) return { kind: "neutral", reason: "pending" };

  // KNOWN SIMPLIFICATION, confirmed as a P2 choice: a final containing two speakers gets
  // one neutral gutter and is not split into per-speaker runs. Splitting would be more
  // faithful — the per-word data supports it — but it changes a line into a list and the
  // legibility cost is real. Revisit if mixed finals turn out to be common; in the
  // captures they are rare (1 of 20 in the interview runs).
  if (labels.size > 1) return { kind: "neutral", reason: "mixed" };

  if (labels.size === 1) return { kind: "speaker", label: [...labels][0]! };

  // No word said anything. Fall back to the turn-level label.
  if (final.speakerLabel === null) return { kind: "neutral", reason: "absent" };
  if (final.speakerLabel === PENDING) return { kind: "neutral", reason: "pending" };
  return { kind: "speaker", label: final.speakerLabel };
}

/** Colour per speaker label. The two labels the captures actually produce are pinned by
 *  hand so they are maximally distinct from each other and both clear the contrast floor
 *  against the caption background; anything else falls back to a checked palette. Labels
 *  are not a closed set (NOTES: "A", "B" and "PENDING" observed, more possible above
 *  max_speakers=2), so an unknown label still gets a stable colour rather than an error.
 *
 *  Colour is never the only channel — the gutter shows the label text too. */
const PINNED_COLORS: Record<string, string> = { A: "#5ad1e6", B: "#ffb454" };
const FALLBACK_COLORS = ["#8ee07a", "#ff9ec4", "#c3a6ff", "#ffd966"];

export function speakerColor(label: string): string {
  const pinned = PINNED_COLORS[label];
  if (pinned !== undefined) return pinned;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}
