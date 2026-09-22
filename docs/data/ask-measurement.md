# Ask panel measurement — P3 gate, MIT 18.06 Lecture 22 (Strang), first 180 s

Three live runs of the same audio through the real proxy: two full runs with five questions each, asked over
the socket while the audio was still streaming, under the original evidence rule; then a rerun of the one
question that rule refused, under the per-passage rule that replaced it. Every number below comes from the
run reports named here and the proxy's log of each run. No reference transcript was used. "Landed" below
means the cited lines, quoted in full in this file, say what the answer says; a reader can check that from
the quotes alone, and it is the only sense of correctness these files support.

## Setup

| | run 1 | run 2 | run 3 (real-1 only) |
| --- | --- | --- | --- |
| Report | `docs/data/gate-p3-run1.json` | `docs/data/gate-p3-run2.json` | `docs/data/gate-p3-run3.json` |
| Started (UTC) | 2026-09-21T23:49:32.136Z | 2026-09-21T23:54:20.463Z | 2026-09-22T00:07:31.429Z |
| Upstream session id (`live` status) | `70875852-99f4-409c-a661-f9d5918be6d3` | `883cb253-4c1f-45bc-b077-5cf0d7eb2c08` | `3a25ff6b-c9c4-4195-a14c-bbb12a911c56` |
| Evidence rule | one string, one run | one string, one run | array of passages, each its own run |
| Proxy code | verdicts not logged | verdicts logged (`server/index.ts`, "answer verdict") | verdicts logged |
| Audio sent | 3600 chunks, 180 s | 3600 chunks, 180 s | 1281 chunks, 64 s, stopped once answered |
| Finals received by the client | 30 | 31 | 11 |
| Partials | 53 | 53 | 17 |
| `Termination` | audio 178 s, session 182 s | audio 178 s, session 182 s | audio 60 s, session 64 s |

Common to both: audio `audio/strang-3min.wav` (5 758 976 PCM bytes, 16 kHz mono PCM16) sent as 3600 chunks
of 50 ms at wall-clock pace by `scripts/gate-p3.ts` to `/ws` on a proxy started with `node server/index.ts`;
eight glossary terms on the socket URL and on every ask (`eigenvector, eigenvalue, lambda, diagonalize,
linearly independent, eigenvector matrix, invert, columns`); answer layer `gpt-5.6-luna`, reasoning effort
`low`, Structured Outputs, `store: false` (`server/answer/model.ts`); transcript window 600 s, never reached.

The driver stands in for the browser client. Everything below the browser is real: the proxy, the upstream
AssemblyAI session, the rolling buffer, the answer layer, the wire protocol. What it does not exercise is the
panel itself: no browser was connected to this machine, so the rendering of the citation control, the
highlight and the scroll are unverified. See "Not verified".

## Questions

Fixed schedule, identical in both runs. Positions are audio time at which the ask frame was sent.

| Label | Asked at | Question | Why |
| --- | --- | --- | --- |
| real-1 | 1:00 | What is needed to be able to invert S? | Stated at 0:28 to 0:38 and again at 0:47 |
| real-2 | 1:40 | What is S? | Stated at 0:03 and restated at 1:08 |
| real-3 | 2:22 | What is A times the eigenvector x1 equal to? | Stated at 2:00 and restated at 2:09 |
| adversarial | 2:36 | What does S inverse A S equal? | The combination is named at 0:15 ("Magic combination S inverse AS") and set up as the thing to be shown, but the first 180 s never say what it equals. Chosen to see whether the model refuses or cites the naming line as if it answered |
| uncovered | 2:52 | What is the determinant of A? | Never mentioned |

## Method

- Latency: client round trip is the wall clock from the ask frame leaving the driver to the answer frame
  arriving; server elapsed is `AnswerMessage.elapsedMs`, measured in the proxy. Both processes are on the same
  machine, so the two differ by at most 2 ms and only the round trip is tabulated.
- Tokens: the proxy's "answer usage" log line for each ask (`input_tokens`, `output_tokens`,
  `reasoning_tokens` from the provider's usage object).
- "Finals held": the number of finals the driver had received when it sent the ask, which is also the number
  of numbered lines the model was shown (the proxy snapshots its buffer at the same moment; both counts
  agree in every case).
- Citation label: what `client/src/components/AskPanel.tsx` would render for the returned `Citation`:
  a time range and line count for one adjacent run, "N lines from <first>" otherwise.
- The verdict is the model's structured output before the grounding check (`server/answer/ask.ts`, `verify`);
  it is quoted verbatim from the proxy log. Run 1 did not log it.
- Evidence rule. Runs 1 and 2: `evidence` was one string, required to occur verbatim inside one run of
  adjacent cited lines. Run 3 and the code as it now stands: `evidence` is an array of passages, each
  required to occur verbatim inside one run of adjacent cited lines, and any passage that matches none
  rejects the whole verdict. Adjacent runs may still be joined by a single passage; non-adjacent lines must
  be quoted as separate passages. The change was made after run 2 for the reason recorded under real-1.

## Run 2, with verdicts

| Label | Finals held | Verdict (raw) | Grounding check | Citation label | Landed | Round trip | Tokens in / out (reasoning) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| real-1 | 11 | found, cited [5, 9], see below | **rejected**, `evidence_not_verbatim` | (not found) | no answer given | 3079 ms | 772 / 79 (0) |
| real-2 | 17 | found, cited [1, 14, 17] | accepted | `3 lines from 0:03` | yes | 3233 ms | 939 / 72 (0) |
| real-3 | 24 | found, cited [23, 24] | accepted | `Captions 2:00 to 2:18 · 2 lines` | yes | 3389 ms | 1174 / 69 (0) |
| adversarial | 26 | not found | passed through as `model` | (not found) | refused, as intended | 4499 ms | 1225 / 178 (152) |
| uncovered | 30 | not found | passed through as `model` | (not found) | refused, as intended | 2376 ms | 1339 / 49 (23) |

### real-1, rejected

Verdict, verbatim from the proxy log:

```
{"found":true,"answer":"To be able to invert S, we need n independent (linearly independent) eigenvectors.","cited":[5,9],"evidence":"We have to be able to invert this eigenvector matrix S. So for that, we need n independent eigenvectors.\nWe have n linearly independent eigenvectors."}
```

The two cited lines as the model saw them:

- [5] `1-4`, 0:27.978 to 0:37.929: `We have to be able to invert this eigenvector matrix S. So for that, we need n independent eigenvectors.`
- [9] `1-8`, 0:47.231 to 0:50.859: `We have n linearly independent eigenvectors.`

Each of the two newline-separated passages in the evidence is a verbatim copy of its line. The check still
rejected it, because `verify` requires the whole evidence string to occur inside one adjacent run of cited
lines, and lines 5 and 9 are separated by three uncited lines (6 to 8, the `PENDING` fragments `So that's
the—`, `That's the case. Okay, so.`, `Suppose—`). The rule was written to stop a passage being stitched
across a gap; here nothing was stitched, two passages were quoted, and the rule cannot tell the difference.
The answer the student did not see is supported by line 5 alone.

Resolved after run 2 by changing the rule the first way: evidence became an array of passages, each checked
verbatim against its own run of cited lines (schema, prompt and tests in `server/answer/ask.ts` and
`ask.test.ts`). Run 3 below is the same question rerun live under that rule.

### real-2, accepted

Verdict: found, cited [1, 14, 17], evidence `This matrix A, I put its eigenvectors in the columns of a matrix S.
So S will be the eigenvector matrix.` Answer: `S is the eigenvector matrix: the matrix whose columns contain the
eigenvectors of A.`

- [1] `1-0`, 0:03.235 to 0:12.185: `This matrix A, I put its eigenvectors in the columns of a matrix S. So S will be the eigenvector matrix.`
- [14] `1-13`, 1:08.756 to 1:17.609: `Of this matrix S. So I'm naturally going to call that the eigenvector matrix, because it's got the eigenvectors in its columns.`
- [17] `1-16`, 1:29.235 to 1:37.910: `So this is A times the matrix with the first eigenvector in its first column, the second eigenvector in its second column.`

The evidence is line 1 in full. The citation is not one run (`contiguous: false`), so the panel labels it
`3 lines from 0:03` rather than a range from 0:03 to 1:37; clicking it would highlight the three lines and
scroll to the first. Landed: line 1 says what the answer says.

### real-3, accepted

Verdict: found, cited [23, 24], evidence `A times x1 is equal to the lambda times the x1. And that lambda we'll
call lambda 1, of course.` Answer: `A times the eigenvector x1 is equal to λ₁ times x1.`

- [23] `1-22`, 2:00.028 to 2:07.312: `A times x1 is equal to the lambda times the x1. And that lambda we'll call lambda 1, of course.`
- [24] `1-23`, 2:09.619 to 2:18.472: `So that's the first column. Ax1 is the same as lambda 1 x1. Ax2 is lambda 2 x2, so on along to infinity.`

One adjacent run, label `Captions 2:00 to 2:18 · 2 lines`. The evidence is line 23 in full; line 24 restates
it. Landed. The answer writes `λ₁` where the transcript says `lambda 1`; the evidence does not.

### adversarial and uncovered, refused

Both verdicts were `{"found":false,"answer":"","cited":[],"evidence":""}`. The adversarial question is the one
the transcript sets up without answering; the model did not cite line [3] (`Magic combination S inverse AS.`)
as if it answered, in either run. These two are the only asks on which the model spent reasoning tokens:
152 and 23 in run 2, 84 and 27 in run 1. The three extraction questions used none.

## Run 1, without verdicts

| Label | Finals held | Result | Citation label | Landed | Round trip | Tokens in / out (reasoning) |
| --- | --- | --- | --- | --- | --- | --- |
| real-1 | 10 | not found, `evidence_not_verbatim` | (not found) | no answer given | 3489 ms | 752 / 85 (0) |
| real-2 | 16 | answer, cited `1-0`, `1-12` | `2 lines from 0:03` | yes | 3170 ms | 919 / 68 (0) |
| real-3 | 23 | answer, cited `1-21`, `1-22` | `Captions 2:00 to 2:18 · 2 lines` | yes | 3646 ms | 1154 / 67 (0) |
| adversarial | 25 | not found, `model` | (not found) | refused | 3417 ms | 1205 / 110 (84) |
| uncovered | 29 | not found, `model` | (not found) | refused | 3003 ms | 1319 / 53 (27) |

Run 1's real-1 rejection could not be explained at the time because the proxy did not log the verdict; the
log line was added before run 2, which reproduced the rejection with the verdict above. Run 1's transcript
differs from run 2's at exactly that point: its line `1-3` (0:19.530 to 0:27.220) ends `there's an S
inverse.` and its line `1-4` (0:29.610 to 0:39.481) begins `Invert this eigenvector matrix S.`; the words
`We have to be able to` do not appear anywhere in run 1's finals. Run 2 has them in one line. Which run's
verdict was rejected for which reason in run 1 is not recoverable.

Run 1's real-2 answer (`S is the eigenvector matrix: its columns are the eigenvectors of A.`) cited `1-0` and
`1-12`, the same two sentences as run 2's lines [1] and [14], with the same evidence (line `1-0` in full).
Run 1's real-3 cited `1-21` and `1-22`, the same two sentences as run 2's [23] and [24].

## Run 3, real-1 rerun under the per-passage rule

Same schedule entry, asked at 1:00 with 10 finals held; audio stopped at 64 s once the answer arrived.

Verdict, verbatim from the proxy log:

```
{"found":true,"answer":"To invert S, you need n linearly independent eigenvectors of A.","cited":[6,9,10],"evidence":["this eigenvector matrix S. So for that, we need n independent eigenvectors.","We have n linearly independent eigenvectors.","Of A."]}
```

The cited lines as the model saw them:

- [6] `1-5`, 0:31.124 to 0:39.467: `this eigenvector matrix S. So for that, we need n independent eigenvectors. So that's the—`
- [9] `1-8`, 0:47.228 to 0:52.765: `We have n linearly independent eigenvectors.`
- [10] `1-9`, 0:56.938 to 0:57.123: `Of A.`

Grounding check: accepted. Passage 1 is verbatim in line 6; passages 2 and 3 are verbatim in lines 9 and 10,
which form one adjacent run. Line 6 is not adjacent to them, so `contiguous` is false and the panel label is
`3 lines from 0:31`. Landed: line 6 says what the answer says; lines 9 and 10 restate it with "linearly".
Round trip 4023 ms; tokens 811 in, 164 out, of which 89 reasoning. This is the first extraction question on
which the model spent reasoning tokens.

This session's transcript differs again at the same place: `invert.` is a one-word `PENDING` line (`1-4`,
0:29.627 to 0:30.091), as in the capture, with `We have to be able to` ending the line before it. Run 1
dropped those five words; run 2 kept the whole sentence in one line. The model's evidence avoided the
boundary in every run.

## Latency

| | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| Round trips, ms, in schedule order | 3489, 3170, 3646, 3417, 3003 | 3079, 3233, 3389, 4499, 2376 | 4023 |
| Median | 3417 | 3233 | |
| Slowest | 3646 (real-3) | 4499 (adversarial, 152 reasoning tokens) | |
| Fastest | 3003 (uncovered) | 2376 (uncovered) | |

Eleven asks, all between 2.4 s and 4.5 s, on inputs of 752 to 1339 tokens. In runs 1 and 2 the extraction
answers used no reasoning tokens and only the refusals did; in run 3 the extraction answer used 89.

## Other observations from the same runs

- **The transcript is not deterministic across sessions.** Same audio, three full transcriptions (the
  `strang-plain` capture and runs 1 and 2): 34, 30 and 31 finals. Word-level differences exist, not only
  boundaries: the capture's turn 24 reads `Ax2 is lambda 2 x2, so on along to its nth column.`; both live runs
  read `Ax2 is lambda 2 x2, so on along to infinity.` at the same position. Run 3 segmented the first minute
  differently again (see above). The answer layer's input therefore differs from run to run on identical
  audio, and so do its citations: for the same question, the run 2 verdict cited lines [5, 9] and the run 3
  verdict cited [6, 9, 10], different numbers and different ids for the same sentences. Run 1's verdict was
  not logged.
- **`SpeakerRevision` arrived in runs 1 and 3 and not in run 2**, logged by the proxy as an unknown upstream
  frame after the client disconnected. Two of three here, against one of two on the Strang captures and two
  of two on the jargon captures.
- The proxy's snapshot and the driver's count of finals held agreed on every ask (10/16/23/25/29 and
  11/17/24/26/30).

## Not verified

- **The panel.** No browser was connected, so the citation control's label, the highlight and the scroll-with-
  context behaviour were not seen. The labels above are what the code would render for the returned
  citations, not screenshots. BUILD_PROMPTS asks for human eyes on output at every gate; that part is still
  owed.
- **Correctness beyond the quoted lines.** No reference transcript. "Landed" is a reader's comparison of the
  answer with the cited lines quoted here, nothing more.
- **A reconnect during an ask.** None occurred in either run; the citation-survives-reconnect behaviour rests
  on the unit tests (`server/answer/ask.test.ts`), not on these runs.
