import { memo } from "react";
import type { FinalMessage } from "../../../server/protocol.ts";
import { gutterForFinal } from "../speaker.ts";
import { SpeakerGutter } from "./SpeakerGutter.tsx";

/** One finalised turn.
 *
 *  Memoised on the message identity. Appending a final gives the finals array a new
 *  identity and re-renders CaptionStream, but every line already on screen gets the same
 *  `final` object it had before and skips its render. Only the new line actually renders.
 *
 *  A line never re-renders for any other reason, because there is no other reason: a
 *  final is never edited after it arrives. See the note at the top of store.ts for why
 *  speaker revisions do not change that. */
function FinalLineImpl({ final }: { final: FinalMessage }) {
  return (
    <div className="line">
      <SpeakerGutter gutter={gutterForFinal(final)} />
      <p className="line-text">{final.text}</p>
    </div>
  );
}

export const FinalLine = memo(FinalLineImpl);
