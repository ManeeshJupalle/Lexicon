# Lexicon — architecture

Glossary-aware live captions and an ask-panel for lectures.
Built for the AssemblyAI Voice Agent Hackathon (lablab.ai). Submission deadline: Sep 30, 2026.

## Problem

Generic live captions mangle domain vocabulary. A deaf or hard-of-hearing student in a linear algebra
lecture gets "Eigen values" as "I can values", "Hermitian" as "her mission". The caption is technically
present and practically useless — exactly the words that carry the lecture are the ones that break.

Lexicon takes the course glossary as an input and feeds it to the recognizer as keyword boosts, so the
terms that matter transcribe correctly. Captions are the first surface; a grounded ask-panel over the
rolling transcript is the second.

## Scope

In:

- Live captions, English, single room-mic source
- Speaker labels
- Glossary input, applied as keyword boosts at session start
- Ask-panel answering from the rolling transcript window, with timestamp citations
- End-of-session summary, key-term list, and missed-term list

Out (deliberately, for the build window):

- Accounts, auth, persistence beyond the session
- Mobile layouts
- Multi-language, translation
- AAC, TTS, or any voice output
- LMS integration

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | Hono on Node (TypeScript) | Already in use across the portfolio; thin WS proxy is all that's needed |
| Frontend | React + Vite + zustand | Same reason; zustand suits a high-frequency transcript stream |
| STT | AssemblyAI real-time streaming | Hackathon requirement and the source of the keyword-boost feature |
| Answer layer | LLM over the rolling transcript | No vector store — the window is small enough to pass directly |
| State | In-memory rolling buffer | No database. Session-scoped by design |

## Data flow

```
Browser client            mic capture, caption view, ask panel
      |  PCM 16 kHz chunks over WebSocket
      v
Hono backend              holds the API key, one socket per session
      |                                  |
      v                                  v
AssemblyAI streaming              Answer layer
 captions, speakers, boosts        Q&A, summary
      |                                  ^
      v                                  |
Transcript buffer  -----------------------
 rolling window, in memory
```

The client never sees the AssemblyAI key. Every upstream call is server-side.

## Modules

```
server/
  index.ts          Hono app, /health, /ws
  aai/
    session.ts      upstream socket lifecycle, reconnect, boost params
    types.ts        message types derived from captured fixtures
  transcript/
    buffer.ts       rolling window, finals only, timestamped
  answer/
    ask.ts          question -> grounded answer + cited range
    summarize.ts    end-of-session summary, key terms, missed terms
client/
  store.ts          zustand: partial line, finals, glossary, answers
  CaptionStream.tsx
  GlossaryPanel.tsx
  AskPanel.tsx
docs/
  fixtures/         raw captured AssemblyAI stream messages
  data/             any measured numbers before they appear in README
```

## Key decisions

**Payload-first.** No types, no ingestion code, and no UI until real streaming messages are captured to
`docs/fixtures/` and read by a human. Partial-vs-final semantics, word timing fields, speaker fields,
and the exact name of the keyword-boost parameter all come from the fixtures, never from memory of the
docs. This rule exists because of prior misses on Deepgram timestamp semantics and OpenRouter sort params.

**The key never leaves the server.** A browser-side key is a demo-day disqualifier and an obvious thing
for a judge to check.

**Finals only in the buffer.** Partials update in place in the UI and are discarded. The answer layer
reads finals so it never cites text that was later revised.

**Answers cite a time range.** The ask-panel returns the transcript span it used, and the UI makes that
span clickable. An uncited answer is indistinguishable from a hallucination, which is fatal for an
accessibility tool.

**Refuse over guess.** If the rolling window does not contain the answer, the panel says so. A student
who cannot hear the lecture has no way to catch a confident wrong answer.

**No database.** Session-scoped memory removes an entire class of setup failure during a demo, and
nothing in the scope requires cross-session state.

## Risks

| Risk | Mitigation |
| --- | --- |
| Streaming message shapes differ from docs | P0 fixture capture before any code |
| Upstream session expiry mid-lecture | Reconnect with buffer preserved; tested before P2 |
| Boost list too long or ignored | Measure with a fixed term list; record before/after early |
| Demo audio sounds staged | Record a real 3-minute technical explanation, not a script read |
| Latency makes captions unusable | Measure end-to-end lag, log to `docs/data/`, state it honestly |

## Limitations (to keep current, and to ship in the README)

Fill these in as they are verified. Claims only go here once measured against the running system.

- Latency: not yet measured
- Accuracy uplift from glossary boosts: not yet measured
- Single audio source only; no multi-room, no remote participants
- Speaker labels are diarization-based, not identity-based — no named speakers
- Session state is lost on refresh
