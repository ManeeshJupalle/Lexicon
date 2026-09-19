// Rolling in-memory window of finalised turns.
//
// Owned by the client connection, not by the upstream session. That is the whole reason a
// reconnect preserves it: sessions are replaced underneath a buffer that never learns a
// reconnect happened.

import { TRANSCRIPT_WINDOW_MS } from "../config.ts";
import { isFinalTurn, type TurnFrame } from "../aai/types.ts";
import { toClientWords, type FinalMessage } from "../protocol.ts";

export interface TurnContext {
  /** Upstream Begin.id, null if Begin never arrived. */
  sessionId: string | null;
  /** Connection audio position at which this upstream session's 0 ms sits. */
  offsetMs: number;
  /** Monotonic per-connection counter, part of the entry id because turn_order restarts
   *  at 0 on every new upstream session. */
  sessionSeq: number;
  /** Connection audio position now. Timestamps a final that carries no words. */
  fallbackMs: number;
  receivedAt: number;
}

export class TranscriptBuffer {
  readonly windowMs: number;
  private entries_: FinalMessage[] = [];
  private newestEndMs = Number.NEGATIVE_INFINITY;

  constructor(windowMs: number = TRANSCRIPT_WINDOW_MS) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error(`windowMs must be positive, got ${windowMs}`);
    this.windowMs = windowMs;
  }

  /** Store a turn if it is final. Returns the stored entry, or null for a partial.
   *
   *  The buffer is the gatekeeper rather than the caller, so "partials are never stored"
   *  is enforced in one place and can be tested directly. NOTES "Partial vs final":
   *  end_of_turn is the discriminator — turn_is_formatted is true on partials too. */
  add(frame: TurnFrame, ctx: TurnContext): FinalMessage | null {
    if (!isFinalTurn(frame)) return null;

    const words = toClientWords(frame.words, ctx.offsetMs);
    const first = words[0];
    const last = words[words.length - 1];
    const entry: FinalMessage = {
      type: "final",
      id: `${ctx.sessionSeq}-${frame.turn_order}`,
      sessionId: ctx.sessionId,
      turnOrder: frame.turn_order,
      text: frame.transcript,
      // Verbatim. "PENDING" is a value the API really sends (NOTES addendum) and it can
      // disagree with the words inside the same final (NOTES turn 16). Neither is the
      // buffer's business to correct.
      speakerLabel: frame.speaker_label ?? null,
      startMs: first ? first.startMs : ctx.fallbackMs,
      endMs: last ? last.endMs : ctx.fallbackMs,
      words,
      receivedAt: ctx.receivedAt,
    };

    this.entries_.push(entry);
    if (entry.endMs > this.newestEndMs) this.newestEndMs = entry.endMs;
    this.evict();
    return entry;
  }

  entries(): readonly FinalMessage[] {
    return this.entries_;
  }

  get size(): number {
    return this.entries_.length;
  }

  /** Window measured in audio position, not wall clock, so the span the ask panel cites in
   *  P3 is the span the buffer holds. Entries are appended in arrival order; an
   *  out-of-order arrival just leaves the window marginally long, never short. */
  private evict(): void {
    const cutoff = this.newestEndMs - this.windowMs;
    while (this.entries_.length > 0 && this.entries_[0]!.endMs < cutoff) this.entries_.shift();
  }
}
