// Turning a citation into caption lines, and showing evidence honestly.
//
// Both halves exist because of the fixtures. Turns are time-capped near 10 s and cut
// mid-sentence (NOTES "What contradicts or surprises" item 1), so a cited range is a slab
// of time, not a quote, and the evidence the model copied out of it usually starts or
// ends partway through a line. And turn_order restarts at 0 on a reconnect, so a citation
// is resolved by final id first (the id carries the upstream session sequence) and by
// connection-timeline overlap second, never by turn order.

import type { Citation, FinalMessage } from "../../server/protocol.ts";
import { normaliseForMatch } from "../../server/protocol.ts";

/** The ids of the cited lines that this client holds, in transcript order. Ids first;
 *  time overlap as the fallback if none of them is known, which should not happen (the
 *  client holds every final the proxy ever sent it) but costs nothing to cover. */
export function resolveCitation(citation: Citation, finals: readonly FinalMessage[]): string[] {
  const wanted = new Set(citation.finalIds);
  const byId = finals.filter((final) => wanted.has(final.id)).map((final) => final.id);
  if (byId.length > 0) return byId;
  return finals
    .filter((final) => final.endMs >= citation.startMs && final.startMs <= citation.endMs)
    .map((final) => final.id);
}

/** One verified passage with an ellipsis on whichever side was cut. No leading ellipsis
 *  when the passage begins where a cited line begins, none trailing when it ends where a
 *  cited line ends; otherwise the fragment says it is a fragment. Never capitalised,
 *  never given a full stop: those would be edits to what was said. Each passage is judged
 *  against every cited line, because the proxy verified each one against its own line. */
export function evidenceFragment(passage: string, cited: readonly FinalMessage[]): string {
  const text = passage.trim();
  const needle = normaliseForMatch(text);
  if (cited.length === 0 || needle === "") return text;

  const lines = cited.map((line) => normaliseForMatch(line.text));
  const startsLine = lines.some((line) => line.startsWith(needle) || needle.startsWith(line));
  const endsLine = lines.some((line) => line.endsWith(needle) || needle.endsWith(line));
  return (startsLine ? "" : "…") + text + (endsLine ? "" : "…");
}
