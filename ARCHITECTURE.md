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
| Answer layer | OpenAI Responses API, `gpt-5.6-luna`, Structured Outputs | No vector store — the window is small enough to pass directly; the JSON schema is enforced provider-side and re-checked server-side |
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
- **Accuracy uplift from glossary boosts: measured twice. None on in-distribution technical vocabulary,
  clear on out-of-distribution proper nouns.** Both measurements are in `docs/data/boost-measurement.md`.
  Neither used a reference transcript and WER was not computed, so every figure is agreement or
  disagreement between a plain and a boosted run of the same audio, not correctness. In-distribution: on
  MIT 18.06 lecture audio with eight linear-algebra terms, 38 of 39 term occurrences transcribed identically
  with and without boosting, 0 substitutions between the runs, and the only three differences are
  `column`/`columns` at turn boundaries; `diagonalize` and the singular `eigenvalue` appear in neither run,
  and whether they were spoken is not determinable from the captures. Out-of-distribution: on 92 s of audio
  with ten terms (eight surnames, `kappa`, `self-adjoint`), 4 of the 10 terms were rendered only with
  boosting, at all 8 of their positions: `n-k Dirac` to `Nkemdirim`, `Rabi-Konath` to `Ravindranath`,
  `Adami-Lindquist` to `Adeyemi-Lindqvist`, `there are now a crucial` to `Thirunavukkarasu`. The other six
  appear in both runs at the same positions, rendered identically. What the boosted run produced at those
  8 positions is the exact string supplied in `keyterms_prompt`; whether it is what was spoken is
  unverified. One further position is flagged in the measurement: the boosted run rendered `Szymanski's`
  where the plain run rendered `strengths` and the boosted run's own other reading of the same sentence
  rendered `strength`. Fix or substitution is not determinable without a reference.
- Single audio source only; no multi-room, no remote participants
- Speaker labels are diarization-based, not identity-based — no named speakers
- Session state is lost on refresh
- **Glossary terms are sent, not confirmed applied.** The chips report what the client put on the
  socket URL at session start. Nothing in the stream acknowledges them: `Begin.configuration` echoes
  `speaker_labels` and `mode` but not `keyterms_prompt`, and no later frame mentions the terms
  (NOTES, "Keyword boosting"). A term can be accepted, silently ignored, or mis-decoded and the
  payload looks identical. The panel says "sent" for that reason.
- **A turn with two speakers in it renders unlabelled.** The turn-level `speaker_label` can disagree
  with the words inside the same final (NOTES, "Speaker information"), so the per-word `speaker` is
  what the gutter reads, and a line whose words disagree gets a neutral gutter rather than a guess.
  The line is not split into per-speaker runs — the word data would support it, but it turns one
  caption into a list. Rare in the captures: 1 of 20 finals in the interview runs.
- **Ask-panel answers are grounded, not verified correct.** Every answer the client sees cites lines that
  were in the rolling window and carries a passage the proxy checked verbatim against those lines
  (`server/answer/ask.ts`); anything that fails that check reaches the client as "not found", never as an
  answer. That guarantees the evidence exists in the captions, not that the answer is right or that the
  cited lines are the best ones. No reference transcript was used in `docs/data/ask-measurement.md`;
  "landed" there means the quoted lines say what the answer says.
- **A cited range is a slab of caption time, not a quote.** Turns are time-capped near 10 s and cut
  mid-sentence (NOTES, "What contradicts or surprises" item 1), so a citation is the set of lines the model
  relied on. One adjacent run is labelled as a time range; scattered lines are labelled "N lines from
  <first>", because a range would imply continuous support. The verbatim evidence fragment, shown with
  ellipses where it was cut, is the part of the slab that carries the answer.
- **The grounding check errs towards refusal, and did.** Evidence is a list of passages, each verified
  verbatim against one run of adjacent cited lines; one unmatched passage refuses the whole answer. Before
  that rule, in 2 of 2 gate runs (`docs/data/ask-measurement.md`), the model answered "what is needed to
  invert S" correctly with two honest quotes from two non-adjacent lines and the check refused it, so the
  student saw "not found". Under the per-passage rule the rerun of the same question landed, citing three
  lines with three verbatim passages. A verdict can still be refused for quoting across a gap or
  paraphrasing, and that is the intended side to fail on.
- **Ask latency: 2.4 to 4.5 s per question**, ten asks over two live runs, inputs of 752 to 1339 tokens,
  `gpt-5.6-luna` at low reasoning effort (`docs/data/ask-measurement.md`, "Latency"). The three extraction
  answers used no reasoning tokens; only the two refusals did.
- **Citations for the same question vary between runs.** The same 180 s of audio produced 34, 30 and 31
  finals across the capture and two live sessions, with word-level differences (`its nth column` against
  `infinity` at 2:09) and different turn boundaries around the same sentences (`docs/data/ask-measurement.md`,
  "Other observations"). The answer layer only ever sees one session's transcript, so the same question in
  another session can cite different lines, or a different number of them. A citation is evidence about
  this session's captions, not a stable reference into the lecture.
- **Speaker revisions are never applied to captions already on screen.** AssemblyAI can send a
  `SpeakerRevision` that rewrites the speaker on turns whose finals were already delivered (NOTES,
  second addendum). The proxy does not relay it and the client does not apply it. A caption that
  changes its attribution after it has been read is a correction a reader with no audio cannot check,
  and the one captured revision was not obviously an improvement — it inverted the majority speaker
  across 209 words of single-lecturer audio. Consequence to state plainly: a gutter that reads as
  unresolved stays unresolved for the rest of the session.
