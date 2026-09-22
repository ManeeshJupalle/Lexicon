import { useState } from "react";
import type { AskResult, Citation, FinalMessage } from "../../../server/protocol.ts";
import { MAX_QUESTION_CHARS, formatClock } from "../../../server/protocol.ts";
import { evidenceFragment, resolveCitation } from "../citation.ts";
import { askQuestion } from "../connection.ts";
import { scrollToFinal } from "../scroller.ts";
import { isSessionActive, useStore, type AskState } from "../store.ts";

/** Questions about what was said, answered from this session's captions and nothing else.
 *
 *  Every answer carries a citation control. Clicking it turns follow-live off, highlights
 *  the cited lines in the caption view and scrolls to them, with one line of context
 *  above, because the first cited line often starts mid-sentence. The control is labelled
 *  as a time range and a line count, never as a quotation: what it points at is a slab of
 *  caption time (see citation.ts). The evidence fragment underneath is the model's own
 *  verbatim anchor, checked by the proxy against the cited lines before it was allowed
 *  through (server/answer/ask.ts). */
export function AskPanel() {
  const asks = useStore((state) => state.asks);
  const status = useStore((state) => state.status);
  const finals = useStore((state) => state.finals);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const active = isSessionActive(status);

  const submit = () => {
    const question = draft.trim();
    if (question === "") return;
    if (!askQuestion(question)) {
      setLocalError("No connection to the caption server.");
      return;
    }
    setLocalError(null);
    setDraft("");
  };

  return (
    <section className="ask" aria-label="Ask about the lecture">
      <h2>Ask</h2>
      <p className="ask-help">
        Answered from this session's captions only, never from outside knowledge. A cited range is a slab of
        caption time and may start or end mid-sentence.
      </p>

      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          className="ask-input"
          type="text"
          value={draft}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={active ? "What did they say about…" : "Start a session to ask"}
          disabled={!active}
          aria-label="Question about the lecture"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="ask-submit" disabled={!active || draft.trim() === ""}>
          Ask
        </button>
      </form>

      {localError !== null && <p className="ask-error">{localError}</p>}

      {asks.length > 0 && (
        <ul className="ask-list" aria-live="polite">
          {asks.map((ask) => (
            <AskItem key={ask.askId} ask={ask} finals={finals} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AskItem({ ask, finals }: { ask: AskState; finals: readonly FinalMessage[] }) {
  const setHighlight = useStore((state) => state.setHighlight);
  const setFollowLive = useStore((state) => state.setFollowLive);
  const [offScreen, setOffScreen] = useState(false);
  const result = ask.result;

  const jump = (result: Extract<AskResult, { kind: "answer" }>) => {
    const ids = resolveCitation(result.citation, finals);
    const first = ids[0];
    if (first === undefined) {
      setOffScreen(true);
      return;
    }
    setOffScreen(false);
    setFollowLive(false);
    setHighlight(ids);
    scrollToFinal(first);
  };

  return (
    <li className="ask-item">
      <p className="ask-q">{ask.question}</p>

      {result === null && <p className="ask-pending">Asking…</p>}

      {result?.kind === "answer" && (
        <>
          <p className="ask-answer">{result.answer}</p>
          {result.evidence.map((passage, index) => (
            <p key={index} className="ask-evidence">
              {evidenceFragment(passage, citedLines(result, finals))}
            </p>
          ))}
          <button className="ask-cite" onClick={() => jump(result)}>
            {citationLabel(result.citation)}
          </button>
          {offScreen && <p className="ask-note">Those lines are no longer in the caption view.</p>}
        </>
      )}

      {result?.kind === "not_found" && (
        <p className="ask-notfound" title={result.reason}>
          {notFoundText(result)}
        </p>
      )}

      {result?.kind === "error" && <p className="ask-error">{errorText(result)}</p>}
    </li>
  );
}

/** One adjacent run reads as a range. Scattered support reads as a count from the first
 *  line: a range would imply the answer is carried continuously from first to last. */
function citationLabel(citation: Citation): string {
  const n = citation.finalIds.length;
  const lines = n + (n === 1 ? " line" : " lines");
  if (citation.contiguous) {
    return "Captions " + formatClock(citation.startMs) + " to " + formatClock(citation.endMs) + " · " + lines;
  }
  return lines + " from " + formatClock(citation.startMs);
}

function citedLines(result: Extract<AskResult, { kind: "answer" }>, finals: readonly FinalMessage[]): FinalMessage[] {
  const wanted = new Set(result.citation.finalIds);
  return finals.filter((final) => wanted.has(final.id));
}

function notFoundText(result: Extract<AskResult, { kind: "not_found" }>): string {
  if (result.held === null) return "No captions yet to search.";
  return "Not in the captions held (" + formatClock(result.held.startMs) + " to " + formatClock(result.held.endMs) + ").";
}

function errorText(result: Extract<AskResult, { kind: "error" }>): string {
  switch (result.error) {
    case "not_configured":
      return "The server has no answer key, so questions cannot be answered.";
    case "declined":
      return "The answer layer declined this question.";
    case "unparseable":
      return "The answer layer returned nothing usable. Try again.";
    case "bad_request":
      return "The question could not be sent: " + result.detail;
    case "upstream":
      return "Could not get an answer: " + result.detail;
  }
}
