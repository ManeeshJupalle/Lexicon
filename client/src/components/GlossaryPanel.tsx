import { isSessionActive, parseTerms, pendingTerms, useStore, MAX_KEYTERMS } from "../store.ts";

/** Course terms, pasted one per line, sent to the proxy as keyword boosts.
 *
 *  Terms apply at session start only. That is the upstream API's shape, not a shortcut:
 *  `keyterms_prompt` is a query parameter on the WebSocket URL, so the term list is fixed
 *  when the socket opens (NOTES, "Keyword boosting"). Anything typed mid-session is shown
 *  as pending and goes up on the next start. */
export function GlossaryPanel() {
  const draft = useStore((state) => state.glossary.draft);
  const applied = useStore((state) => state.glossary.applied);
  const setDraft = useStore((state) => state.setDraft);
  const status = useStore((state) => state.status);

  const active = isSessionActive(status);
  const pending = pendingTerms(draft, applied);
  const total = parseTerms(draft).length;

  return (
    <aside className="glossary">
      <h2>Glossary</h2>
      <p className="glossary-help">
        One term per line. Sent to the recogniser as keyword boosts when the session starts.
      </p>

      <textarea
        className="glossary-input"
        value={draft}
        spellCheck={false}
        placeholder={"eigenvector\neigenvalue\ndiagonalize\nlinearly independent"}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Course terms, one per line"
      />

      {total >= MAX_KEYTERMS && (
        <p className="glossary-warn">Only the first {MAX_KEYTERMS} terms are sent — the rest are ignored upstream.</p>
      )}

      {applied.length > 0 && (
        <section className="chips-block">
          <h3>
            Sent this session <span className="count">{applied.length}</span>
          </h3>
          <ul className="chips">
            {applied.map((term) => (
              <li key={term} className="chip chip-applied">
                {term}
              </li>
            ))}
          </ul>
          {/* Honesty about what "sent" means. NOTES "Keyword boosting": Begin.configuration
              does not echo keyterms_prompt, and nothing else in the stream mentions the
              terms either, so there is no payload-level confirmation that the recogniser
              accepted them. Claiming "applied" here would be claiming something the wire
              never told us. */}
          <p className="glossary-note">
            Sent at session start. Nothing in the stream confirms the recogniser used them.
          </p>
        </section>
      )}

      {pending.length > 0 && (
        <section className="chips-block">
          <h3>
            {active ? "Pending next session" : "Will be sent on start"} <span className="count">{pending.length}</span>
          </h3>
          <ul className="chips">
            {pending.map((term) => (
              <li key={term} className="chip chip-pending">
                {term}
              </li>
            ))}
          </ul>
          {active && <p className="glossary-note">Terms can only be set when a session opens. Restart to apply these.</p>}
        </section>
      )}
    </aside>
  );
}
