import { memo } from "react";
import type { FinalMessage } from "../../../server/protocol.ts";
import { formatClock } from "../../../server/protocol.ts";
import { gutterForFinal } from "../speaker.ts";
import { useStore } from "../store.ts";
import { SpeakerGutter } from "./SpeakerGutter.tsx";

/** One finalised turn.
 *
 *  Memoised on the message identity. Appending a final gives the finals array a new
 *  identity and re-renders CaptionStream, but every line already on screen gets the same
 *  `final` object it had before and skips its render. Only the new line actually renders.
 *
 *  A line re-renders for exactly one other reason: the citation highlight flipping on or
 *  off for that line (P3). A final is never edited after it arrives — see the note at the
 *  top of store.ts for why speaker revisions do not change that. */
function FinalLineImpl({ final }: { final: FinalMessage }) {
  // The one store subscription a line has. A boolean selector re-renders only the lines
  // whose value flips, so a citation click touches its own lines and nothing else, and
  // the partial-line isolation that CaptionStream relies on still holds.
  const cited = useStore((state) => state.highlight.has(final.id));

  return (
    <div className={"line" + (cited ? " line-cited" : "")} data-final-id={final.id} aria-current={cited ? "true" : undefined}>
      <SpeakerGutter gutter={gutterForFinal(final)} />
      <p className="line-text">{final.text}</p>
      {/* Shown only while cited. Captions do not carry timestamps in normal reading; the
          badge exists so the citation control's range can be matched to lines on screen. */}
      {cited && (
        <span className="line-time" aria-label={"captions at " + formatClock(final.startMs)}>
          {formatClock(final.startMs)}
        </span>
      )}
    </div>
  );
}

export const FinalLine = memo(FinalLineImpl);
