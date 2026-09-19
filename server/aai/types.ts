// AssemblyAI v3 streaming frames.
//
// Derived from docs/fixtures/NOTES.md and nothing else. Every field below was observed in
// docs/fixtures/*.jsonl. Nothing is typed from memory of the API reference. Where the
// fixtures are ambiguous it is marked AMBIGUOUS and left loose rather than guessed.
//
// AMBIGUOUS — frames absent from UpstreamFrame rather than typed from the reference page:
//   * Any error frame. NOTES "The captures": no error frame, no HTTP-level rejection ever
//     arrived, so neither the frame shape nor the 401/400 response body is known. Handled
//     structurally instead: unknown `type` is logged whole, an upgrade rejection becomes a
//     typed status from its HTTP status code.
//   * SpeakerRevision. NOTES records zero of these and concludes speaker_label is emitted
//     exactly once per turn with no later frame that could revise it. STALE as of
//     2026-09-19: it arrives on Strang audio, once, between Terminate and Termination,
//     revising both turn-level and word-level speakers and resolving "PENDING". It is
//     still not typed here, because NOTES.md is the source of record for this file and has
//     not been amended, and because acting on a revision means mutating finals already
//     emitted and stored — a P2 decision, not a type.

/** One recognised word. Timings are integer milliseconds from the first byte of audio sent
 *  in THIS upstream session — see NOTES "Word timings". Because a reconnect starts a new
 *  session at 0 ms, session.ts offsets these before anything else sees them. */
export interface Word {
  start: number;
  end: number;
  text: string;
  confidence: number;
  /** Present on every word of a final when speaker_labels is on, on no word of a partial.
   *  Values observed: "A", "B", and the literal "PENDING" (NOTES addendum). Not a closed
   *  set, so not a union — stored and relayed verbatim, and wrong is allowed. */
  speaker?: string;
  /** Optional even inside a final: NOTES "Speaker information" records turn 0 words 0-5
   *  without it and words 6-39 with it. */
  speaker_confidence?: number;
  word_is_final: boolean;
}

/** A partial or a final. `end_of_turn` is the only thing that tells them apart. */
export interface TurnFrame {
  turn_order: number;
  /** AMBIGUOUS as a signal: `true` on every frame in every capture, partials included
   *  (NOTES contradiction 2). It cannot discriminate anything. Use isFinalTurn. */
  turn_is_formatted: boolean;
  end_of_turn: boolean;
  transcript: string;
  /** Binary in the captures: 0.0 on all 220 partials, 1.0 on all 44 finals
   *  (NOTES contradiction 3). Nothing graded was ever observed. */
  end_of_turn_confidence: number;
  words: Word[];
  /** "" on every partial, identical to `transcript` on every final. */
  utterance: string;
  /** Finals only, and only with speaker_labels on. May be "PENDING". May also disagree
   *  with the `speaker` on the words inside the same final (NOTES turn 16) — it is a
   *  summary, the per-word field is the truth. */
  speaker_label?: string;
  speaker_confidence?: number;
  type: "Turn";
}

export interface BeginFrame {
  type: "Begin";
  id: string;
  /** Unix SECONDS, not milliseconds. Begin time plus three hours in all three runs. */
  expires_at: number;
  configuration: {
    model: string;
    mode: string;
    api_version: string;
    speaker_labels: boolean;
    redact_pii: boolean;
    filter_profanity: boolean;
    /** AMBIGUOUS: `null` in every capture, so the populated shape is unknown. */
    domain: unknown;
    /** AMBIGUOUS: `null` in every capture, so the populated shape is unknown. */
    voice_focus: unknown;
  };
}

/** Once per turn, immediately before that turn's first partial. `timestamp` is in the same
 *  millisecond unit as Word.start. */
export interface SpeechStartedFrame {
  type: "SpeechStarted";
  timestamp: number;
  confidence: number;
}

/** Whole seconds, unlike everything else in this API. */
export interface TerminationFrame {
  type: "Termination";
  audio_duration_seconds: number;
  session_duration_seconds: number;
}

export type UpstreamFrame = BeginFrame | SpeechStartedFrame | TurnFrame | TerminationFrame;

/** The partial/final discriminator, in one place because it is the rule most easily got
 *  wrong. NOTES "Partial vs final": `end_of_turn` is it. Not `turn_is_formatted`, which is
 *  always true; not `end_of_turn_confidence`, which is binary; not a non-empty `utterance`,
 *  which is a consequence rather than the signal. Exactly one final per turn_order. */
export function isFinalTurn(frame: TurnFrame): boolean {
  return frame.end_of_turn === true;
}
