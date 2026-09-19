import type { Gutter } from "../speaker.ts";
import { NEUTRAL_REASON_TEXT, speakerColor } from "../speaker.ts";

/** The left gutter. A known speaker gets its label and its colour; an unknown one gets a
 *  dim rule and no text.
 *
 *  What it never renders: a question mark, an invented name, or the previous line's
 *  speaker. Each of those reads to the viewer as information, and we do not have any. The
 *  blank gutter is the honest rendering of an unresolved label — see speaker.ts for which
 *  payload states land here and why. */
export function SpeakerGutter({ gutter }: { gutter: Gutter }) {
  if (gutter.kind === "speaker") {
    const color = speakerColor(gutter.label);
    return (
      <div className="gutter" aria-label={"Speaker " + gutter.label}>
        <span className="gutter-rule" style={{ background: color }} />
        <span className="gutter-label" style={{ color }}>
          {gutter.label}
        </span>
      </div>
    );
  }

  const description = NEUTRAL_REASON_TEXT[gutter.reason];
  return (
    <div className="gutter" aria-label={description} title={description}>
      <span className="gutter-rule gutter-rule-neutral" />
    </div>
  );
}
