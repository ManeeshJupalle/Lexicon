import { useEffect, useRef, useState } from "react";
import { FIXTURES, cancelReplay, runReplay, type FixtureName } from "./replay.ts";

/** DEV-ONLY. Renders nothing in a production build — see replay.ts for why this exists
 *  and how to delete it. */
export function ReplayControl() {
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  const start = async (name: FixtureName) => {
    setRunning(true);
    await runReplay(name);
    setRunning(false);
  };

  // `?replay=<fixture>` starts one on load, so a screenshot of a known caption state can
  // be reproduced without driving the UI by hand. StrictMode mounts effects twice in dev;
  // the ref makes that one replay rather than two interleaved ones.
  useEffect(() => {
    if (!import.meta.env.DEV || started.current) return;
    const requested = new URLSearchParams(location.search).get("replay");
    if (requested === null || !(requested in FIXTURES)) return;
    started.current = true;
    void start(requested as FixtureName);
  }, []);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="replay">
      <span className="replay-tag">dev</span>
      <span className="replay-label">replay fixture</span>
      {Object.keys(FIXTURES).map((name) => (
        <button key={name} className="replay-button" disabled={running} onClick={() => void start(name)}>
          {name}
        </button>
      ))}
      {running && (
        <button className="replay-button" onClick={cancelReplay}>
          stop
        </button>
      )}
    </div>
  );
}
