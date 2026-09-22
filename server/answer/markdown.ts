// The session output as Markdown. Deterministic and pure, so the client renders, copies
// and downloads the same text, and a test can pin it. Lives beside protocol.ts rather than
// in the client so that a harness can print it too; it touches nothing from Node or the
// DOM.

import type { Citation, SessionOutput, TermReport } from "../protocol.ts";
import { formatClock } from "../protocol.ts";

/** The same wording the panel uses for a citation control. */
export function citationLabel(citation: Citation): string {
  const n = citation.finalIds.length;
  const lines = n + (n === 1 ? " line" : " lines");
  if (citation.contiguous) {
    return "Captions " + formatClock(citation.startMs) + " to " + formatClock(citation.endMs) + " · " + lines;
  }
  return lines + " from " + formatClock(citation.startMs);
}

export function termStatusText(report: TermReport): string {
  switch (report.status) {
    case "found":
      return "found " + count(report.occurrences) + ", first at " + formatClock(report.firstMs ?? 0);
    case "found_inflected":
      return "found " + count(report.occurrences) + " as " + report.forms.map((f) => "“" + f + "”").join(", ") + ", first at " + formatClock(report.firstMs ?? 0);
    case "near_miss":
      return "not found as written; possibly " + report.candidates.map(candidateText).join("; ");
    case "absent":
      return "not found";
  }
}

function candidateText(candidate: TermReport["candidates"][number]): string {
  const how = candidate.source === "string" ? "similarity " + String(candidate.similarity) : "model suggestion";
  return "“" + candidate.text + "” at " + formatClock(candidate.startMs) + " (" + how + ")";
}

function count(n: number): string {
  return n === 1 ? "once" : n + " times";
}

function quote(passages: readonly string[]): string {
  return passages.map((p) => "“" + p + "”").join(" · ");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function toMarkdown(output: SessionOutput): string {
  const lines: string[] = [];
  lines.push("# Lexicon session output");
  lines.push("");
  lines.push(
    "Generated " + new Date(output.generatedAt).toISOString() + " from " + output.transcript.lines + " caption lines (" +
      output.transcript.words + " words), " + formatClock(output.transcript.startMs) + " to " +
      formatClock(output.transcript.endMs) + ", model " + output.model + ". Every point and definition below carries " +
      "passages copied verbatim from the captions and checked by the server; nothing here comes from outside the transcript.",
  );
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  if (output.summary.length === 0) lines.push("_No grounded summary points._");
  for (const point of output.summary) {
    lines.push("- " + point.text + " (" + citationLabel(point.citation) + ")");
    lines.push("  " + quote(point.evidence));
  }
  lines.push("");

  lines.push("## Key terms, as used in this lecture");
  lines.push("");
  if (output.keyTerms.length === 0) lines.push("_No grounded key terms._");
  for (const term of output.keyTerms) {
    lines.push("### " + term.term);
    lines.push("");
    lines.push(term.definition);
    lines.push("");
    lines.push("Evidence (" + citationLabel(term.citation) + "): " + quote(term.evidence));
    lines.push("");
  }

  lines.push("## Glossary terms: missed or mangled");
  lines.push("");
  const missed = output.glossary.filter((r) => r.status === "near_miss" || r.status === "absent");
  const found = output.glossary.filter((r) => r.status === "found" || r.status === "found_inflected");
  if (output.glossary.length === 0) {
    lines.push("_No glossary terms were supplied._");
  } else {
    if (missed.length === 0) {
      lines.push("Every supplied term was found in the captions.");
    } else {
      lines.push("| Term | Boosted | What the captions show |");
      lines.push("| --- | --- | --- |");
      for (const report of missed) {
        lines.push("| " + escapeCell(report.term) + " | " + (report.boosted ? "yes" : "no") + " | " + escapeCell(termStatusText(report)) + " |");
      }
    }
    lines.push("");
    lines.push(
      found.length + " of " + output.glossary.length + " supplied terms found" +
        (found.length > 0 ? ": " + found.map((r) => r.term + " (" + r.occurrences + ")").join(", ") : "") + ".",
    );
    lines.push("");
    lines.push(
      "A “possibly” span is a caption span that resembles the term by spelling or that the model proposed; " +
        "whether it really was the term cannot be settled without the audio.",
    );
  }
  lines.push("");

  const droppedTotal = output.dropped.summary + output.dropped.keyTerms + output.dropped.suggestions;
  if (droppedTotal > 0 || output.errors.length > 0) {
    lines.push("## Not shown");
    lines.push("");
    if (output.dropped.summary > 0) lines.push("- " + output.dropped.summary + " summary point(s) dropped for failing verification against the captions.");
    if (output.dropped.keyTerms > 0) lines.push("- " + output.dropped.keyTerms + " key term(s) dropped for failing verification against the captions.");
    if (output.dropped.suggestions > 0) lines.push("- " + output.dropped.suggestions + " mangled-term suggestion(s) dropped because the span was not in the named line.");
    for (const error of output.errors) lines.push("- " + error.part + " unavailable: " + error.detail);
    lines.push("");
  }

  return lines.join("\n");
}
