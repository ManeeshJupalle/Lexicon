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
    grounding.ts    the one grounding check: cited lines exist, every passage verbatim in them
    ask.ts          question -> grounded answer + cited range
    terms.ts        supplied glossary terms against what landed: found, inflected, near miss, absent
    summarize.ts    end-of-session summary, key terms, missed terms, all grounded
    markdown.ts     the session output as Markdown, shared with the client
client/
  store.ts          zustand: partial line, finals, glossary, answers, session output
  CaptionStream.tsx
  GlossaryPanel.tsx
  AskPanel.tsx
  SessionOutputPanel.tsx
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
- **Session output is grounded, not verified correct, and can be incomplete.** Every summary point and
  key-term definition carries passages the proxy checked verbatim against the captions
  (`server/answer/grounding.ts`, the same check as answers); anything that fails is dropped and the
  output says how many. That guarantees the evidence exists, not that the paraphrase is right. In the
  20-minute gate run (`docs/data/session-output-measurement.md`) 2 of 8 summary points were dropped and
  the last four minutes of the lecture got a key term but no summary point.
- **The missed-terms list shows candidates, never verdicts.** A term not found as written is reported
  with the nearest caption spans: by spelling similarity over runs of one to six words, tuned on the
  jargon captures where it recovers `n-k Dirac`, `Rabi-Konath`, `Adami-Lindquist` and `Tirunavukkarasu`;
  and by a model pass over the unfound terms whose suggestions are kept only when verbatim in the line
  named. On the one mangle spelling cannot reach, `there are now a crucial`, the model pass located the
  line in two of two samples with the revised prompt and returned part of the phrase, not all of it.
  Whether any candidate really was the term is not decidable without the audio, and a term found once
  may still have been mangled elsewhere; near-miss search runs only for terms never found.
- **Session output needs the socket open.** Stop sends an end frame and waits for the reply; closing the
  tab, or a dropped connection, yields no output, and nothing is persisted. Measured on the 20-minute
  run: 21 s from end frame to output, of which 16 s generating, 13k input and 3.4k output tokens across
  two calls, about $0.007. A 50-minute lecture is an extrapolation from that, not a measurement.
- **Verbatim matching: what the normaliser keeps and what it cannot protect.** Evidence is compared
  whole word by whole word after a normalisation that erases only what the caption formatter adds
  (`server/protocol.ts`, `normaliseForMatch`): case, sentence punctuation, quotation marks, brackets and
  pause dashes. Letters of any script, digits, word-internal apostrophes, hyphens and decimal points,
  and every operator and sign are kept, so `x > 0` never verifies against `x < 0`, `x - y` is not `x y`,
  and `normal matrix` is not inside `abnormal matrix`. Case folding is a decision with a residual:
  single-letter names such as `A` and `a`, or `Λ` and `λ`, compare equal. Symbols the recogniser never
  writes, primes and factorials, get no protection. And on live captions the symbol rules rarely fire at
  all: this recogniser emits "lambda", "theta sub k" and "kappa" as words, not symbols, so the
  protection is real for formatted input (pasted glossary terms, model-written passages) and is not
  carrying weight on streaming transcripts today.
- **Session end races an upstream rotation.** Sessions are rotated a minute before their upstream
  expiry (`server/aai/session.ts`, `rotate`). If the end frame arrives while a rotation is in flight,
  only the current upstream socket is awaited for its flush; the outgoing session's last turn can land
  after the output was generated and is not in it.
- **Finals are stored in arrival order, not time order.** During a rotation two upstream sessions are
  open, and the outgoing one's last turn can arrive after the new one's first. The buffer, the full
  transcript and the numbered lines the model sees then hold those two lines out of time order, and the
  eviction window can hold marginally more than its length.
- **No handshake timeout upstream.** Reconnect is driven by the upstream socket closing or erroring. An
  upstream that accepts the TCP connection and never completes the WebSocket handshake or never sends
  `Begin` leaves the client at "Connecting" indefinitely.
- **Concurrent questions are unbounded.** Every ask frame becomes a paid model call, and nothing limits
  how many a client may have in flight at once.
- **No audio backpressure.** Chunks are forwarded upstream as they arrive; nothing checks the upstream
  socket's buffered amount. A slow upstream grows memory rather than slowing the client. Audio that
  arrives while upstream is down is dropped, not queued (documented in `session.ts`).
- **Inflection matching over-matches.** A supplied term counts as found when a caption word begins with
  it and is at most three characters longer, or is the term's plural with its `s` removed. That accepts
  `inverted` for `invert` and `column` for `columns`, and also `columnar` for `column` or `lambdaXY` for
  `lambda`; the found count and forms list say what matched, so a reader can see it.
- **Near-miss spans over-match.** A mangled term is sought over runs of one to six caption words scored
  by letter and consonant similarity with thresholds tuned on one capture (`docs/fixtures/jargon-*`).
  Ordinary words can score as a mangled name, a span can straddle two phrases, and the search runs only
  for terms never found, so a term found once is never checked for mangling elsewhere. Every candidate
  is shown with its span, time and score and labelled "possibly"; none is a verdict.
- **Speaker revisions are never applied to captions already on screen.** AssemblyAI can send a
  `SpeakerRevision` that rewrites the speaker on turns whose finals were already delivered (NOTES,
  second addendum). The proxy does not relay it and the client does not apply it. A caption that
  changes its attribution after it has been read is a correction a reader with no audio cannot check,
  and the one captured revision was not obviously an improvement — it inverted the majority speaker
  across 209 words of single-lecturer audio. Consequence to state plainly: a gutter that reads as
  unresolved stays unresolved for the rest of the session.
