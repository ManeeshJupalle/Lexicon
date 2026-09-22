import { useEffect, useRef } from "react";
import { isSessionActive, useStore } from "../store.ts";
import { isAtBottom, registerScroller, scrollToFinal, scrollToLive } from "../scroller.ts";
import { FinalLine } from "./FinalLine.tsx";
import { PartialLine } from "./PartialLine.tsx";

/** The caption view.
 *
 *  Subscribes to `finals` and `followLive` and nothing else. In particular it does not
 *  subscribe to `partial`: the in-flight line renders itself and scrolls the container
 *  itself, so a partial arriving does not re-render this list. */
export function CaptionStream() {
  const finals = useStore((state) => state.finals);
  const status = useStore((state) => state.status);
  const followLive = useStore((state) => state.followLive);
  const setFollowLive = useStore((state) => state.setFollowLive);
  const jumpTo = useStore((state) => state.jumpTo);
  const clearJumpTo = useStore((state) => state.clearJumpTo);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerScroller(ref.current);
    return () => registerScroller(null);
  }, []);

  useEffect(() => {
    if (followLive) scrollToLive();
  }, [finals, followLive]);

  // A citation click, from the ask panel or the session output. Runs after layout, so
  // it also works when the click is what brought this view on screen.
  useEffect(() => {
    if (jumpTo === null) return;
    scrollToFinal(jumpTo);
    clearJumpTo();
  }, [jumpTo, clearJumpTo]);

  // Scroll fires continuously; read the current value straight off the store rather than
  // writing the same boolean back on every frame and waking every subscriber.
  const onScroll = () => {
    const atBottom = isAtBottom();
    if (atBottom !== useStore.getState().followLive) setFollowLive(atBottom);
  };

  return (
    <div className="captions">
      <div className="caption-scroll" ref={ref} onScroll={onScroll} role="log" aria-label="Live captions">
        {finals.length === 0 && (
          <p className="caption-empty">
            {isSessionActive(status)
              ? "Listening. Captions appear as speech is recognised."
              : "Captions will appear here once the session starts."}
          </p>
        )}
        {finals.map((final) => (
          <FinalLine key={final.id} final={final} />
        ))}
        <PartialLine />
      </div>

      {!followLive && (
        <button
          className="jump-to-live"
          onClick={() => {
            setFollowLive(true);
            scrollToLive();
          }}
        >
          Jump to live ↓
        </button>
      )}
    </div>
  );
}
