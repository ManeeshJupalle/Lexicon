// zustand store. Holds exactly what BUILD_PROMPTS P2 specifies: the partial line, the
// finals array, the glossary terms, and the connection status. P3 adds the questions
// asked this session and the citation highlight.
//
// SPEAKER REVISIONS ARE NOT APPLIED TO `finals`, DELIBERATELY.
//
// AssemblyAI can emit a `SpeakerRevision` frame that rewrites the speaker on turns whose
// finals were already sent (docs/fixtures/NOTES.md, second addendum). Nothing in this file
// consumes one, and the proxy does not relay it — server/aai/session.ts routes unknown
// frame types to a log and stops there. That is a choice at both layers, not an oversight,
// and it is written down in both places so neither gets "fixed" later by accident.
//
// Two reasons:
//
// 1. The reader. This is a caption surface for someone who cannot hear the room. A line
//    that silently changes its speaker after they have read it is a correction they can
//    never verify, and it invalidates what they already understood. An unresolved gutter
//    is honest about the same uncertainty and costs them nothing. Unresolved beats
//    retroactively wrong.
// 2. The evidence. The one captured revision is not obviously an improvement. On audio of
//    a single lecturer it inverted the majority speaker across 209 words — A 162 / B 5 /
//    PENDING 42 became B 153 / A 56 — and dropped `speaker_confidence` from every word it
//    touched. "Later" is not "more correct", and n = 1.
//
// If this is ever revisited, the thing to build is a separate review surface after the
// session ends, not an in-place rewrite of lines on screen.

import { create } from "zustand";
import type { AskResult, FinalMessage, PartialMessage, ServerMessage, SessionOutput, StatusCode } from "../../server/protocol.ts";

/** Server status codes plus the states the client reaches on its own, before or after any
 *  socket exists. Kept distinct from StatusCode so the wire contract stays the server's. */
export type UiStatus = StatusCode | "idle" | "ending";

/** Legibility floor from BUILD_PROMPTS P2: "text no smaller than 24px". The size control
 *  cannot go below it — it is the accessibility requirement, not a default. */
export const FONT_STEPS = [24, 32, 40, 52] as const;
export const MIN_FONT_PX = FONT_STEPS[0];

/** The proxy splits the keyterms query parameter on commas (server/aai/session.ts,
 *  normaliseKeyterms) and caps the list at 100. */
export const MAX_KEYTERMS = 100;

/** One question and, once the proxy answers, its result. */
export interface AskState {
  askId: string;
  question: string;
  askedAt: number;
  result: AskResult | null;
  elapsedMs: number | null;
}

interface LexiconState {
  status: UiStatus;
  statusDetail: string;
  /** Finals the proxy reports holding in its rolling window, from the `live` status. Lets
   *  a reconnect be seen to have preserved the buffer rather than merely claimed to. */
  bufferedFinals: number;
  /** A failure on this side of the socket — mic denied, wrong sample rate. Not a
   *  StatusCode: those describe the upstream, and conflating them would hide which half
   *  of the system broke. */
  localError: string | null;

  /** Append-only for the life of one session. Never mutated in place, never reordered,
   *  and never rewritten by a later frame — see the note at the top of this file. */
  finals: FinalMessage[];
  /** The in-flight line, replaced wholesale on every update. NOTES records partials that
   *  shrink and retime between frames, so nothing here may be merged or treated as
   *  append-only. Its own top-level key so that updating it touches no selector that the
   *  finals list subscribes to. */
  partial: PartialMessage | null;

  /** P3. Questions asked this session, newest first. Session-scoped: cleared on the next
   *  session start, kept on screen after a stop so the last answers can still be read. */
  asks: AskState[];
  /** Final ids highlighted in the caption view by the last citation click. */
  highlight: ReadonlySet<string>;
  /** A final id the caption view should scroll to once it is mounted and laid out. Set by
   *  a citation click, consumed by CaptionStream; the indirection is what lets a click in
   *  the session output land in a caption view that is not on screen yet. */
  jumpTo: string | null;

  /** P4. The end-of-session output, once the proxy has answered the end frame. Held until
   *  the next session start, never persisted. */
  sessionOutput: SessionOutput | null;
  outputError: string | null;
  /** Which surface the caption column shows. The output takes it once it exists; the
   *  captions stay a click away, and any citation click switches back to them. */
  view: "captions" | "output";

  glossary: {
    /** Raw textarea contents, one term per line. */
    draft: string;
    /** Terms sent upstream at the last session start. Upstream accepts keyterms only at
     *  socket open, so this is frozen for the life of a session by the API, not by us. */
    applied: string[];
  };

  fontPx: number;
  followLive: boolean;

  applyServerMessage: (message: ServerMessage) => void;
  setStatus: (status: UiStatus, detail: string) => void;
  setLocalError: (error: string | null) => void;
  beginSession: (applied: string[]) => void;
  endSession: () => void;
  setDraft: (draft: string) => void;
  setFontPx: (px: number) => void;
  setFollowLive: (follow: boolean) => void;
  addAsk: (ask: AskState) => void;
  setHighlight: (ids: readonly string[]) => void;
  jumpToFinal: (ids: readonly string[]) => void;
  clearJumpTo: () => void;
  setView: (view: "captions" | "output") => void;
  setOutputError: (error: string | null) => void;
  /** Every question still waiting gets an error result: the socket that would have
   *  answered it is gone, and "Asking\u2026" forever would be a lie. */
  failPendingAsks: (detail: string) => void;
}

export const useStore = create<LexiconState>((set) => ({
  status: "idle",
  statusDetail: "",
  bufferedFinals: 0,
  localError: null,
  finals: [],
  partial: null,
  asks: [],
  highlight: new Set<string>(),
  jumpTo: null,
  sessionOutput: null,
  outputError: null,
  view: "captions",
  glossary: { draft: "", applied: [] },
  fontPx: MIN_FONT_PX,
  followLive: true,

  applyServerMessage: (message) =>
    set((state) => {
      switch (message.type) {
        case "status":
          return {
            status: message.code,
            statusDetail: message.detail,
            bufferedFinals: message.bufferedFinals ?? state.bufferedFinals,
          };
        case "partial":
          return { partial: message };
        case "final":
          // The partial belonged to the turn that just finalised, so it is spent. Clearing
          // it here rather than waiting for the next partial stops the in-flight line
          // showing a stale duplicate of the final directly above it.
          return { finals: [...state.finals, message], partial: null };
        case "answer":
          // Attach the result to its question. Nothing else moves: an answer arriving must
          // not touch `finals` or `partial`.
          return {
            asks: state.asks.map((ask) =>
              ask.askId === message.askId ? { ...ask, result: message.result, elapsedMs: message.elapsedMs } : ask,
            ),
          };
        case "session_output":
          return {
            sessionOutput: message.output,
            outputError:
              message.error === null
                ? null
                : message.error.code === "not_configured"
                  ? "The server has no answer key, so no session output was generated."
                  : "Could not generate the session output: " + message.error.detail,
            view: message.output === null ? state.view : "output",
          };
      }
    }),

  setStatus: (status, detail) => set({ status, statusDetail: detail }),
  setLocalError: (localError) => set({ localError }),

  beginSession: (applied) =>
    set((state) => ({
      finals: [],
      partial: null,
      asks: [],
      highlight: new Set<string>(),
      jumpTo: null,
      sessionOutput: null,
      outputError: null,
      view: "captions",
      bufferedFinals: 0,
      localError: null,
      status: "connecting",
      statusDetail: "opening socket",
      followLive: true,
      glossary: { ...state.glossary, applied },
    })),

  endSession: () => set({ status: "idle", statusDetail: "", partial: null }),
  setDraft: (draft) => set((state) => ({ glossary: { ...state.glossary, draft } })),
  setFontPx: (fontPx) => set({ fontPx }),
  setFollowLive: (followLive) => set({ followLive }),
  addAsk: (ask) => set((state) => ({ asks: [ask, ...state.asks] })),
  setHighlight: (ids) => set({ highlight: new Set(ids) }),
  jumpToFinal: (ids) => set({ highlight: new Set(ids), jumpTo: ids[0] ?? null, view: "captions", followLive: false }),
  clearJumpTo: () => set({ jumpTo: null }),
  setView: (view) => set({ view }),
  setOutputError: (outputError) => set({ outputError }),
  failPendingAsks: (detail) =>
    set((state) => ({
      asks: state.asks.map((ask) =>
        ask.result === null ? { ...ask, result: { kind: "error", error: "upstream", detail } } : ask,
      ),
    })),
}));

/** Textarea text to a term list. Commas split as well as newlines: the proxy's query
 *  parameter is comma-separated, so a term containing a comma cannot survive the wire
 *  either way. Splitting on it is lossless and predictable; silently stripping it would
 *  change the term the user typed. */
export function parseTerms(draft: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of draft.split(/[\n,]/)) {
    const term = raw.trim();
    if (term === "") continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === MAX_KEYTERMS) break;
  }
  return terms;
}

/** Terms typed but not yet sent upstream. Derived rather than stored: a second array
 *  would have to be kept in step with the textarea on every keystroke, and this cannot
 *  drift. Before the first session every term is pending, which is accurate. */
export function pendingTerms(draft: string, applied: string[]): string[] {
  const live = new Set(applied.map((t) => t.toLowerCase()));
  return parseTerms(draft).filter((t) => !live.has(t.toLowerCase()));
}

export function isSessionActive(status: UiStatus): boolean {
  return (
    status !== "idle" &&
    status !== "ending" &&
    status !== "closed" &&
    status !== "upstream_unavailable" &&
    status !== "not_configured"
  );
}
