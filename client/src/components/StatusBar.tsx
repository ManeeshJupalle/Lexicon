import type { UiStatus } from "../store.ts";
import { FONT_STEPS, isSessionActive, parseTerms, useStore } from "../store.ts";
import { startSession, stopSession } from "../connection.ts";

/** Plain-language text for every status the proxy can send. The codes themselves are
 *  precise and unreadable; this is the accessibility surface, so the bar says what has
 *  happened to the captions, not what happened to the socket. */
const STATUS_TEXT: Record<UiStatus, string> = {
  idle: "Not running",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting — captions paused",
  upstream_closed: "Recogniser dropped the session",
  upstream_error: "Recogniser error",
  upstream_rejected: "Recogniser refused the session",
  upstream_unavailable: "Captions stopped — could not reconnect",
  not_configured: "Server has no API key",
  closed: "Session ended",
};

/** Which statuses mean captions are actually arriving. Drives the dot only. */
const HEALTHY: ReadonlySet<UiStatus> = new Set<UiStatus>(["live"]);
const WARNING: ReadonlySet<UiStatus> = new Set<UiStatus>(["connecting", "reconnecting", "upstream_closed"]);
/** Ended, but not broken. A clean stop should not paint the same colour as a failure. */
const QUIET: ReadonlySet<UiStatus> = new Set<UiStatus>(["idle", "closed"]);

export function StatusBar() {
  const status = useStore((state) => state.status);
  const detail = useStore((state) => state.statusDetail);
  const localError = useStore((state) => state.localError);
  const bufferedFinals = useStore((state) => state.bufferedFinals);
  const fontPx = useStore((state) => state.fontPx);
  const setFontPx = useStore((state) => state.setFontPx);
  const draft = useStore((state) => state.glossary.draft);

  const active = isSessionActive(status);
  const tone = HEALTHY.has(status) ? "ok" : WARNING.has(status) ? "warn" : QUIET.has(status) ? "idle" : "bad";

  return (
    <header className="statusbar">
      <div className="brand">
        <span className="brand-name">Lexicon</span>
        <span className="brand-sub">glossary-aware live captions</span>
      </div>

      <div className="status" role="status">
        <span className={"dot dot-" + tone} aria-hidden="true" />
        <span className="status-text">{STATUS_TEXT[status]}</span>
        {detail !== "" && <span className="status-detail">{detail}</span>}
        {bufferedFinals > 0 && <span className="status-detail">{bufferedFinals} held</span>}
      </div>

      <div className="controls">
        <div className="size-control" role="group" aria-label="Caption text size">
          <span className="size-label">Size</span>
          {FONT_STEPS.map((px) => (
            <button
              key={px}
              className={"size-button" + (px === fontPx ? " size-button-on" : "")}
              aria-pressed={px === fontPx}
              onClick={() => setFontPx(px)}
            >
              {px}
            </button>
          ))}
        </div>

        {active ? (
          <button className="primary primary-stop" onClick={() => void stopSession()}>
            Stop
          </button>
        ) : (
          <button className="primary" onClick={() => void startSession(parseTerms(draft))}>
            Start session
          </button>
        )}
      </div>

      {localError !== null && <p className="local-error">{localError}</p>}
    </header>
  );
}
