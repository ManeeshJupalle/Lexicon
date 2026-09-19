import { useLayoutEffect } from "react";
import { useStore } from "../store.ts";
import { PARTIAL_GUTTER } from "../speaker.ts";
import { scrollToLive } from "../scroller.ts";
import { SpeakerGutter } from "./SpeakerGutter.tsx";

/** The in-flight line.
 *
 *  This is the only component subscribed to `partial`, which is what keeps a partial
 *  update off the finals list. It also drives auto-scroll while the line grows, by
 *  talking to the scroll container directly rather than through state — see scroller.ts.
 *
 *  The gutter is always neutral here. Partials carry no speaker information at all: NOTES
 *  measures zero of 680 partial words with a `speaker` key, at turn level or word level,
 *  in any capture. There is nothing to show until the final arrives. */
export function PartialLine() {
  const partial = useStore((state) => state.partial);
  const followLive = useStore((state) => state.followLive);

  useLayoutEffect(() => {
    if (followLive) scrollToLive();
  });

  if (partial === null || partial.text === "") return null;

  return (
    <div className="line line-partial" aria-live="polite" aria-atomic="true">
      <SpeakerGutter gutter={PARTIAL_GUTTER} />
      <p className="line-text">{partial.text}</p>
    </div>
  );
}
