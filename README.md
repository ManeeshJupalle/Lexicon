# Lexicon

Glossary-aware live captions and a grounded ask panel for lectures. Built for the AssemblyAI Voice Agent
Hackathon (lablab.ai).

## The problem

Live captions break on the words a lecture is actually about: the names and course-specific terms the
recogniser has never seen. A student who cannot hear the room has no way to tell a caption is wrong.

## What it does

You paste the course glossary, one term per line, and start a session. Lexicon streams your microphone to
AssemblyAI's real-time recogniser with those terms sent as keyterm boosts, and shows large, high-contrast
captions with speaker labels.

While the lecture runs you can type a question. The answer comes only from what has been captioned so far.
It comes with the exact caption lines it relied on, and you can click the citation to scroll to that moment.
If the captions don't contain the answer, the panel says "not found" instead of answering from general
knowledge. The server checks that every quoted passage appears word for word in the cited lines. An answer
that fails the check reaches you as "not found".

When you press Stop, you get a summary and key terms defined as this lecture used them, each tied to caption
lines. You also get a report of which glossary terms never showed up as written, with the nearest caption
spans marked "possibly". All of it can be copied or downloaded as Markdown.

## Setup

Requirements: Node 24 or later (`engines` in `package.json`; developed on 24.11.1). The server and scripts
run TypeScript directly through Node's type stripping, so there is no build step for the server. You need
an AssemblyAI API key with streaming access. You also need an OpenAI API key with access to `gpt-5.6-luna`,
which is the answer layer's model (`server/answer/model.ts`).

```sh
git clone https://github.com/ManeeshJupalle/Lexicon.git
cd Lexicon
npm install
```

Create `.env` in the repo root:

```
ASSEMBLYAI_API_KEY=...
OPENAI_API_KEY=...
```

Leave `PORT` unset. The proxy defaults to 8787, and the Vite dev server's proxy target is hard-coded to
`http://localhost:8787` (`client/vite.config.ts`).

Run the two processes in two terminals:

```sh
npm run dev          # proxy on http://localhost:8787 (holds both keys)
npm run dev:client   # client on http://localhost:5173
```

Open **http://localhost:5173** and allow microphone access. The page at 8787 is the bare P1 gate page, not
the app. `http://localhost:5173/health` reports whether each key is configured. The server still starts
without keys: `/health` returns 503, a session without the AssemblyAI key is refused with a typed status,
and a question without the OpenAI key gets a typed error.

Checks: `npm test` (44 unit tests) and `npm run typecheck`.

Audio input is the microphone only. To caption a recording, play it into the mic or through a virtual audio
device.

## Architecture

```
Browser (React + zustand)  --PCM 16 kHz over /ws-->  Hono proxy (holds both keys)
                                                       |-> AssemblyAI real-time streaming (keyterms_prompt)
                                                       |-> in-memory transcript: finals only, 10 min ask window
                                                       '-> OpenAI Responses API, Structured Outputs
                                                           answers, summary, key terms; every passage re-checked
                                                           verbatim against the captions before it is sent
```

- Neither key reaches the browser. All upstream calls are server-side.
- Only finals are stored. Partials update in place on screen and are discarded, so nothing is ever cited
  from text the recogniser later revised.
- There is no database and no vector store. The window is small enough to pass to the model directly.
  Everything is session-scoped.
- Message types come from captured AssemblyAI frames (`docs/fixtures/NOTES.md`), not from memory of the
  API docs.

Full design, module map and decisions: [ARCHITECTURE.md](ARCHITECTURE.md).

## Measured results

Every figure below is from a file in `docs/data/`, measured against the running system. No reference
transcript was used anywhere, and word error rate was not computed. Recognition figures compare a plain run
and a boosted run of the same audio. They show agreement between the runs, not correctness.

**Keyterm boost, in-distribution vocabulary: no uplift.** Source: [boost-measurement.md](docs/data/boost-measurement.md).
The test used the first 180 s of MIT 18.06 Lecture 22 with eight linear-algebra terms. 38 of 39 term
occurrences were transcribed identically with and without boosting. There were 0 substitutions between the
two runs. All three differences are `column`/`columns` at turn boundaries. The plain run already rendered
every term correctly, so boosting had nothing to fix. `diagonalize` and the singular `eigenvalue` appear in
neither run.

**Keyterm boost, out-of-distribution names: 4 of 10 terms rendered only with boosting.** Source: the second
half of [boost-measurement.md](docs/data/boost-measurement.md). The test used 92 s of audio with ten terms
(eight surnames, `kappa`, `self-adjoint`). The four terms appeared at all 8 of their positions in the
boosted run:

| Plain run | Boosted run |
| --- | --- |
| `n-k Dirac` / `n-k dream` | `Nkemdirim` |
| `Rabi-Konath` | `Ravindranath` |
| `Adami-Lindquist` | `Adeyemi-Lindqvist` |
| `there are now a crucial` / `Tirunavukkarasu` | `Thirunavukkarasu` |

The other six terms were identical in both runs. The boosted run produced the exact supplied string at those
8 positions, but whether that is what was spoken is unverified. One boosted-only occurrence is flagged as a
possible substitution: `Szymanski's` where the plain run has `strengths`, at word confidence 0.834 against
0.983 or more for every other term.

**Ask panel.** Source: [ask-measurement.md](docs/data/ask-measurement.md). This gate asked five questions
during live runs on the Strang audio: three answerable, one that the lecture sets up but doesn't answer, and
one never covered.

- In both full runs, two of the three answerable questions were answered. Their cited lines say what the
  answer says.
- The adversarial and uncovered questions were refused in both runs.
- The third answerable question was answered correctly by the model but refused by the grounding check in
  2 of 2 runs, because it quoted two non-adjacent lines. The rule was changed to check each passage
  separately, and the rerun landed, citing three lines.
- Latency was 2.4 to 4.5 s per question over eleven asks, with inputs of 752 to 1339 tokens.

**Session output.** Source: [session-output-measurement.md](docs/data/session-output-measurement.md), and
the output itself in [gate-p4-output.md](docs/data/gate-p4-output.md). This gate was a 20-minute run of the
same lecture with no crash and 0 reconnects. It produced 200 finals.

- The summary kept 6 of 8 points; 2 failed verification and were dropped.
- The last four minutes got a key term but no summary point.
- 15 key terms were kept and 0 dropped.
- All 11 of 11 glossary terms were found.
- End frame to output took 21.4 s, of which 16.4 s was generation. The two calls used 13,067 input and
  3,387 output tokens, about $0.007.
- In the same run, five questions took 3.3 to 5.4 s each. Four of them were asked before their content was
  spoken, because the question schedule was written for the 3-minute cut. The model refused all four, and it
  was right to: the captions held at the time did not contain the answers.

## Limitations

These are verified claims only. Numbers link to where they were measured.

- **Caption latency is not measured.** No figure exists for the delay from speech to caption.
- **The browser flow was checked by hand, not measured.** The numbers above come from gate runs that drove
  the real proxy, recogniser and model with a script standing in for the browser. Separately, on
  2026-09-22 the author ran the full flow in the browser and confirmed that each of these worked:
  captions, glossary, ask, citation jump and highlight, jump to live, session output, copy, download, and
  citation back from the output into the captions. That walkthrough was a pass/fail check and recorded no
  numbers.
- **Boosting helps unseen proper nouns, not vocabulary the recogniser already knows.** See the two
  measurements above. Without a reference transcript, a boosted rendering is not proven correct. A boost can
  also plausibly put a supplied term where a different word was said (the `Szymanski's` position).
- **Glossary terms are sent, not confirmed applied.** Root cause: AssemblyAI's `Begin` frame echoes other
  parameters but not `keyterms_prompt`, and no later frame mentions the terms. The panel therefore says
  "sent", not "applied".
- **Answers are grounded, not verified correct.** The check guarantees that the quoted evidence exists in
  the captions. It does not guarantee that the answer is right or that the best lines were cited.
- **The grounding check errs towards refusal.** A correct answer can be refused when the model quotes
  across a gap between lines or paraphrases. This happened in 2 of 2 runs before the per-passage rule
  ([ask-measurement.md](docs/data/ask-measurement.md)). Refusal is the intended failure direction.
- **The same question can cite different lines in different sessions.** Root cause: the recogniser is not
  deterministic. The same 180 s of audio produced 34, 30 and 31 finals across three sessions, with
  word-level differences and different turn boundaries ([ask-measurement.md](docs/data/ask-measurement.md)).
- **A citation is a slab of caption time, not a quote.** Turns are cut at about 10 s, often mid-sentence.
  Non-adjacent lines are labelled "N lines from <time>" rather than as a range.
- **Session output can be incomplete.** Points that fail verification are dropped and counted: 2 of 8 in
  the 20-minute run, leaving the last four minutes without a summary point
  ([session-output-measurement.md](docs/data/session-output-measurement.md)).
- **The missed-terms list shows candidates, never verdicts.** Near-miss search uses spelling similarity with
  thresholds tuned on one capture, and it over-matches. It runs only for terms never found, so a term found
  once is never checked for mangling elsewhere. The model-assisted pass, meant for mangles that spelling
  can't reach, was tested on captures only, not on a live run. In both samples with the revised prompt it
  located `there are now a crucial` for `Thirunavukkarasu`, but it returned only part of that phrase.
- **Inflection matching over-matches.** `columnar` counts as `column`, for example. The found forms are
  listed, so the reader can see what matched.
- **Output needs the socket open.** If you close the tab or the connection drops before the output arrives,
  you get nothing. Nothing is persisted, and a refresh loses the session.
- **Session end can race an upstream rotation.** Upstream sessions are rotated before they expire. If Stop
  lands mid-rotation, the outgoing session's last turn can miss the output. During a rotation, finals can
  also be stored slightly out of time order.
- **Speaker labels come from diarization, not identity.** A turn whose words disagree about the speaker gets
  a neutral gutter. The line is not split. AssemblyAI's later `SpeakerRevision` frames are not applied to
  captions already on screen, because a caption that changes its attribution after it was read is a
  correction a reader with no audio can't check.
- **Robustness gaps, not yet fixed:**
  - There is no upstream handshake timeout. An upstream that never sends `Begin` leaves the client stuck
    at "Connecting".
  - Concurrent questions are unbounded, and each one is a paid model call.
  - There is no audio backpressure. Audio that arrives while upstream is down is dropped.
- **Out of scope by design:** English only, single mic source, no accounts or persistence, no mobile layout,
  no translation, no voice output, no LMS integration.

## Audio sources

- **Jargon recording** (`audio/jargon.wav`, 92 s): recorded by the author. It is used for the out-of-distribution
  boost measurement and the demo. Not committed.
- **MIT 18.06 Lecture 22**: "Lecture 22: Diagonalization and powers of A", Prof. Gilbert Strang, 18.06
  Linear Algebra, Spring 2010, MIT OpenCourseWare (video recorded Fall 1999),
  <https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-22-diagonalization-and-powers-of-a/>.
  Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). It was used for
  measurement only, and the audio is not committed. The captured recogniser output in `docs/fixtures/strang-*.jsonl`
  and the transcript excerpts quoted in `docs/data/` are machine transcriptions of this lecture. They are
  derived from the OCW material and remain under CC BY-NC-SA 4.0 with attribution to MIT OpenCourseWare and
  Prof. Strang.
- **P0 payload captures** were first made on a third-party interview clip. Those captures have been removed
  from the repository and its history for licensing. `docs/fixtures/NOTES.md` points each finding that
  quoted them to the Strang or jargon captures instead.

## License

The code is MIT-licensed. The Strang-derived transcripts and excerpts are CC BY-NC-SA 4.0. See
[LICENSE](LICENSE).
