import { useState } from "react";
import type { Citation, FinalMessage, TermReport } from "../../../server/protocol.ts";
import { formatClock } from "../../../server/protocol.ts";
import { citationLabel, termStatusText, toMarkdown } from "../../../server/answer/markdown.ts";
import { evidenceFragment } from "../citation.ts";
import { useStore } from "../store.ts";

/** The end-of-session output: summary, key terms as used, missed or mangled glossary
 *  terms. Takes the caption column once the session has ended.
 *
 *  Every summary point and definition is grounded exactly like an answer: the paraphrase
 *  is the main text, and beneath it sit the verbatim passages the server checked against
 *  the captions, with a citation control that jumps back to the lines. A line number
 *  alone would let a point drift with nothing to catch it, and this reader cannot check
 *  by ear. The missed-term table shows spans of the captions, never a verdict: whether a
 *  "possibly" span really was the term is not decidable without the audio.
 *
 *  Copy and download carry the same Markdown, rendered by server/answer/markdown.ts, so
 *  what leaves the app is exactly what is on screen. */
export function SessionOutputPanel() {
  const output = useStore((state) => state.sessionOutput);
  const error = useStore((state) => state.outputError);
  const finals = useStore((state) => state.finals);
  const setView = useStore((state) => state.setView);
  const jumpToFinal = useStore((state) => state.jumpToFinal);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  if (output === null) return null;

  const markdown = toMarkdown(output);
  const missed = output.glossary.filter((r) => r.status === "near_miss" || r.status === "absent");
  const found = output.glossary.filter((r) => r.status === "found" || r.status === "found_inflected");
  const droppedTotal = output.dropped.summary + output.dropped.keyTerms + output.dropped.suggestions;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lexicon-session-" + new Date(output.generatedAt).toISOString().replace(/[:.]/g, "-") + ".md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="output" aria-label="Session output">
      <header className="output-head">
        <div>
          <h2>Session output</h2>
          <p className="output-meta">
            {output.transcript.lines} caption lines, {formatClock(output.transcript.startMs)} to{" "}
            {formatClock(output.transcript.endMs)}. Every point and definition carries passages copied from the captions
            and checked by the server; nothing here comes from outside the transcript.
          </p>
        </div>
        <div className="output-actions">
          <button className="output-button" onClick={() => void copy()}>
            {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy markdown"}
          </button>
          <button className="output-button" onClick={download}>
            Download .md
          </button>
          <button className="output-button" onClick={() => setView("captions")}>
            Show captions
          </button>
        </div>
      </header>

      {error !== null && <p className="ask-error">{error}</p>}

      <h3>Summary</h3>
      {output.summary.length === 0 ? (
        <p className="output-empty">No grounded summary points.</p>
      ) : (
        <ol className="output-list">
          {output.summary.map((point, index) => (
            <li key={index} className="output-point">
              <p className="output-text">{point.text}</p>
              <Anchors evidence={point.evidence} citation={point.citation} finals={finals} onJump={jumpToFinal} />
            </li>
          ))}
        </ol>
      )}

      <h3>Key terms, as used in this lecture</h3>
      {output.keyTerms.length === 0 ? (
        <p className="output-empty">No grounded key terms.</p>
      ) : (
        <ul className="output-list output-terms">
          {output.keyTerms.map((term) => (
            <li key={term.term} className="output-point">
              <p className="output-term">{term.term}</p>
              <p className="output-text">{term.definition}</p>
              <Anchors evidence={term.evidence} citation={term.citation} finals={finals} onJump={jumpToFinal} />
            </li>
          ))}
        </ul>
      )}

      <h3>Glossary terms: missed or mangled</h3>
      {output.glossary.length === 0 ? (
        <p className="output-empty">No glossary terms were supplied.</p>
      ) : (
        <>
          {missed.length === 0 ? (
            <p className="output-text">Every supplied term was found in the captions.</p>
          ) : (
            <table className="output-table">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Boosted</th>
                  <th>What the captions show</th>
                </tr>
              </thead>
              <tbody>
                {missed.map((report) => (
                  <tr key={report.term}>
                    <td className="output-term-cell">{report.term}</td>
                    <td>{report.boosted ? "yes" : "no"}</td>
                    <td>
                      <MissedCell report={report} onJump={jumpToFinal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="output-note">
            {found.length} of {output.glossary.length} supplied terms found
            {found.length > 0 ? ": " + found.map((r) => r.term + " (" + r.occurrences + ")").join(", ") : ""}. A
            "possibly" span resembles the term by spelling or was proposed by the model; whether it really was the term
            cannot be settled without the audio.
          </p>
        </>
      )}

      {(droppedTotal > 0 || output.errors.length > 0) && (
        <>
          <h3>Not shown</h3>
          <ul className="output-list output-notshown">
            {output.dropped.summary > 0 && <li>{output.dropped.summary} summary point(s) dropped for failing verification against the captions.</li>}
            {output.dropped.keyTerms > 0 && <li>{output.dropped.keyTerms} key term(s) dropped for failing verification against the captions.</li>}
            {output.dropped.suggestions > 0 && <li>{output.dropped.suggestions} mangled-term suggestion(s) dropped because the span was not in the named line.</li>}
            {output.errors.map((e) => (
              <li key={e.part}>
                {e.part} unavailable: {e.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Anchors({
  evidence,
  citation,
  finals,
  onJump,
}: {
  evidence: readonly string[];
  citation: Citation;
  finals: readonly FinalMessage[];
  onJump: (ids: readonly string[]) => void;
}) {
  const wanted = new Set(citation.finalIds);
  const cited = finals.filter((final) => wanted.has(final.id));
  return (
    <div className="output-anchors">
      <button className="ask-cite" onClick={() => onJump(citation.finalIds)}>
        {citationLabel(citation)}
      </button>
      {evidence.map((passage, index) => (
        <span key={index} className="output-passage">
          {evidenceFragment(passage, cited)}
        </span>
      ))}
    </div>
  );
}

function MissedCell({ report, onJump }: { report: TermReport; onJump: (ids: readonly string[]) => void }) {
  if (report.status !== "near_miss") return <>{termStatusText(report)}</>;
  return (
    <>
      <span>not found as written; possibly </span>
      {report.candidates.map((candidate, index) => (
        <button key={index} className="output-candidate" onClick={() => onJump([candidate.finalId])}>
          {"“" + candidate.text + "” at " + formatClock(candidate.startMs)}
          {candidate.source === "string" ? " (similarity " + String(candidate.similarity) + ")" : " (model suggestion)"}
        </button>
      ))}
    </>
  );
}
