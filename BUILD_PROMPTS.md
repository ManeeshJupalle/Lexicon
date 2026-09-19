# Lexicon — build prompts

One phase per build session. Commit at each gate. No phase bleeds forward.
A build tool reporting success is not gate evidence — human eyes on output, every time.

Target schedule at 3–4 h/day:

| Days | Phase |
| --- | --- |
| Sep 17–18 | P0 payload capture |
| Sep 19–20 | P1 backend proxy |
| Sep 21–23 | P2 caption UI + glossary |
| Sep 24–26 | P3 ask panel |
| Sep 27 | P4 session output |
| Sep 28–29 | P5 submission |
| Sep 30 | Buffer |

---

## P0 — payload capture

No app code. No types. No structure. This phase exists only to learn what the API actually sends.

> Write a throwaway Node script at `scripts/capture.ts` that opens AssemblyAI's real-time streaming
> WebSocket, pipes a local 16 kHz WAV of speech through it in realistic chunk sizes, and appends every
> raw inbound message to `docs/fixtures/aai-stream.jsonl` with a local receive timestamp. No parsing,
> no interfaces, no error swallowing — if a message doesn't fit an expectation, write it anyway.
>
> Then run it a second time with a keyword-boost list of ten technical terms, writing to
> `docs/fixtures/aai-stream-boosted.jsonl`.
>
> Finally write `docs/fixtures/NOTES.md` documenting, from the captured files only:
> the distinction between partial and final messages; where word-level timings live and what units they
> use; what speaker information is present and in what shape; the exact parameter name and format for
> keyword boosting in this API version; session lifecycle messages including expiry and termination;
> and anything in the payloads that contradicts what the docs imply.

**Gate:** both fixture files exist and are non-empty. `NOTES.md` is read by you, line by line, before P1.
Note in it at least one thing that surprised you — if nothing did, you skimmed.

---

## P1 — backend proxy

> Build a Hono server in TypeScript at `server/`.
>
> One WebSocket route `/ws`: the browser connects, sends 16 kHz PCM audio chunks, and the server relays
> them to an upstream AssemblyAI streaming session, relaying transcript messages back down. One upstream
> session per client connection. The AssemblyAI key is read from env and never sent to the client.
>
> Handle: upstream session expiry with automatic reconnect that preserves the transcript buffer;
> client disconnect with clean upstream teardown; upstream errors surfaced to the client as a typed
> status message rather than a silent dead socket.
>
> Add `GET /health` returning upstream reachability.
>
> All message types in `server/aai/types.ts` derive from `docs/fixtures/NOTES.md`. Do not invent fields.
> Where the fixtures are ambiguous, say so in a comment rather than guessing.
>
> Add `server/transcript/buffer.ts`: a rolling in-memory window holding finalized utterances with
> speaker and timestamp. Configurable window length, default 10 minutes. Partials are never stored.

**Gate:** a minimal HTML page captures mic audio and logs live captions to the browser console.
Kill the upstream mid-session and confirm the reconnect works without losing buffered text.

---

## P2 — caption UI + glossary

> Build the client at `client/` with React, Vite, and zustand.
>
> Caption view: finalized lines stack vertically, the in-flight partial line updates in place at the
> bottom, speaker labels sit in a left gutter. Text no smaller than 24px, high contrast, with a size
> control. Auto-scroll that pauses when the user scrolls up and resumes on a "jump to live" button.
> This is the accessibility surface — legibility beats density everywhere it conflicts.
>
> Glossary panel: a textarea where the user pastes course terms one per line. On session start the terms
> go to the backend and are applied as keyword boosts. Applied terms render as chips. Terms added
> mid-session queue until the next session start and are labeled as pending.
>
> zustand store holds: partial line, finals array, glossary terms, connection status. The partial line
> updates at high frequency — make sure it does not re-render the whole finals list.

**Gate:** screenshot the running UI, critique it yourself against legibility, then commit.
Record a before/after clip of one technical term with boosts off, then on. Save it — this is the pitch.

---

## P3 — ask panel

> Add an ask panel beside the captions.
>
> The user types a question. The backend answers using only the rolling transcript window plus the
> glossary, and returns both the answer and the timestamp range of the transcript it relied on.
> The UI renders that range as a control that scrolls the caption view to that moment.
>
> If the window does not contain the answer, return an explicit not-found response and render it as
> such. Never produce an answer from general knowledge — the user cannot verify it by ear.
>
> Questions and answers are session-scoped; no persistence.

**Gate:** ask three real questions during a live run. Every answer's citation points at the right
moment. Ask one question the lecture never covered and confirm the refusal path fires.

---

## P4 — session output

> On session end, generate three things from the full session transcript:
> a summary of what was covered; a key-term list with each term defined as it was used in this lecture,
> not in general; and a list of glossary terms that appear to have been missed or mangled, derived by
> comparing supplied glossary terms against what actually landed in the transcript.
>
> Render all three, with copy-to-clipboard and download as markdown.

**Gate:** a full 20-minute run, start to finish, no crash, output readable without editing.

---

## P5 — submission

> Write `README.md`: the problem in one sentence, a 40-second explanation of what the app does, setup
> steps that work from a clean clone, the architecture summary, and a limitations section.
>
> The limitations section carries verified claims only. Any performance or accuracy number must already
> exist in `docs/data/`, measured against the running system. Failures stay in, with root causes named,
> rather than being omitted.

Then the demo video, roughly three minutes:

1. The problem, shown not told — captions without the glossary, mangling terms
2. Paste the glossary, restart, same audio, terms now correct
3. Ask a question mid-lecture, click the citation, land on the moment
4. End the session, show the summary and the missed-terms list
5. What is out of scope, said plainly

Use real lecture audio of someone explaining something technical. A script read sounds like a script read.

**Gate:** submit by Sep 29. Do not leave it to the final day.
