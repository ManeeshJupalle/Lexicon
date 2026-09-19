# AssemblyAI v3 streaming — what the payloads actually say

Written from the three fixture files in this directory and nothing else. Where the API reference page is
mentioned, it is named as such; everything else is observed. Line numbers refer to the `.jsonl` files.
JSON samples are pretty-printed for whitespace only; key order is preserved. One re-serialisation artefact:
the raw frames write `0.0`, the samples below show `0`.

## The captures

**Removed 2026-09-22.** The three captures below were made from a third-party broadcast interview clip and
have been removed from the repository and its history for licensing. Counts and line numbers that cite them
can no longer be checked against committed files. Every quotation of their speech has been replaced with a
pointer to the same behaviour in the Strang or jargon captures, or a statement that no remaining capture
shows it.

| File | Run | Query params beyond the shared set | Lines | Server frames |
| --- | --- | --- | --- | --- |
| `aai-stream.jsonl` | 1 | `speaker_labels=true&max_speakers=2` | 101 | 1 Begin, 20 SpeechStarted, 74 Turn, 1 Termination |
| `aai-stream-nodiarization.jsonl` | 2 | `speaker_labels=false` | 127 | 1 Begin, 4 SpeechStarted, 116 Turn, 1 Termination |
| `aai-stream-boosted.jsonl` | 3 | as run 1 plus `keyterms_prompt=[8 terms]` | 101 | 1 Begin, 20 SpeechStarted, 74 Turn, 1 Termination |

Shared: `speech_model=universal-3-5-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true`, API key in
the `Authorization` header, audio `audio/lecture-3min.wav` (180 s, 16 kHz mono PCM16, a two-voice interview
about AI risk) sent as 3600 chunks of 1600 bytes (50 ms) paced against the wall clock. All three runs on
2026-09-18, exit 0, close code 1000.

Each line is either a server frame written verbatim, `{"received_at": <ISO>, "message": <frame>}`, or a
local event, `{"received_at": <ISO>, "event": "connect" | "open" | "audio_done" | "sent_terminate" | "close", ...}`.
Line 1 of every file is the `connect` event and records the exact URL sent.

Only four frame types ever arrived: `Begin`, `SpeechStarted`, `Turn`, `Termination`. No `SpeakerRevision`,
no `Heartbeat`, no error frame, no HTTP-level rejection.

## Partial vs final

The discriminator is `end_of_turn`. Nothing else works.

| Field | Partial (`end_of_turn: false`) | Final (`end_of_turn: true`) |
| --- | --- | --- |
| `end_of_turn_confidence` | `0.0` on all 220 partials across the three runs | `1.0` on all 44 finals |
| `words[].word_is_final` | `false` on every word | `true` on every word |
| `utterance` | `""` on every partial | identical to `transcript` on every final |
| `turn_is_formatted` | `true` | `true` |
| `speaker_label`, `speaker_confidence` | absent | present when speaker labels are on |
| `type` | `"Turn"`, and it is the **last** key | same |

Exactly one final per `turn_order` in every run (20/20, 4/4, 20/20). No turn ever received a second final,
and no unformatted final preceded a formatted one.

Run 1, turn 0, four frames growing from 4 to 40 words (quote removed with the capture, for licensing). Same pattern, three partials then one final:
`jargon-plain.jsonl` lines 5–8.

First partial, complete (quote removed with the capture, for licensing). Same shape: `strang-plain.jsonl` line 5 and `jargon-plain.jsonl` line 5.

The final for the same turn (quote removed with the capture, for licensing). Same shape, with `speaker_label` and per-word `speaker`:
`jargon-plain.jsonl` line 8.

Three things about partials that matter for a caption view:

- **Partials are not append-only.** The `words` array shrinks between consecutive partials. Run 2, turn 0:
  83 words at line 21 → 78 at line 22; 134 → 130 at line 30. Turn 1, line 55: 48 → 47, and the text
  changed (quote removed with the capture, for licensing). No remaining capture shows a partial losing words; earlier words rewritten by the next
  partial are in `strang-plain.jsonl` turn 14, lines 52→53.
  A partial replaces the previous partial wholesale; nothing in it is stable.
- **The final almost always differs from the last partial.** 19 of 20 turns in run 1, 3 of 4 in run 2,
  19 of 20 in run 3. Partly because the final carries words that arrived after the last partial, partly
  casing and punctuation (quote removed with the capture, for licensing). Also 10 of 10 turns in `jargon-plain.jsonl`.
- **Word timings move at finalisation.** A turn's first word is 0–86 ms in the partial and 32–64 ms in the
  final. Same in `strang-plain.jsonl` lines 5→6: 0–173 ms, then 100–218 ms. Partial timings are estimates.

## Word timings

Word-level timing lives only in `words[].start` and `words[].end`. Integer milliseconds, measured from the
first byte of audio sent in the session. Evidence: the last word of the last final ends at 179983 ms
(runs 1 and 3) and 179956 ms (run 2), against 180 s of audio; every one of the 12 058 word objects across
the runs has integer `start` and `end` with `end >= start`. There is no turn-level start or end field; a
turn's span is its first word's `start` to its last word's `end`.

`SpeechStarted.timestamp` is in the same unit and equals the `start` of the first word of the next turn's
first partial in all 44 cases.

Units are not consistent across the API:

| Field | Unit | Sample |
| --- | --- | --- |
| `words[].start`, `words[].end`, `SpeechStarted.timestamp` | milliseconds from session audio start | `10016` |
| `Termination.audio_duration_seconds`, `session_duration_seconds` | whole seconds | `180`, `181` |
| `Begin.expires_at` | Unix seconds | `1789760718` = 2026-09-18T19:45:18Z |

## Speaker information

Requires `speaker_labels=true`. Run 2 (`false`) has no speaker key anywhere: 0 of 116 Turn frames and
0 of 9512 word objects.

With labels on:

- **Turn level:** `speaker_label` (`"A"` or `"B"` in these three captures; the literal string `"PENDING"`
  appeared in later captures, see the addendum at the end) and `speaker_confidence` (float), **only on finals**. 20 of 20 finals carry them, 0 of 54 partials do.
- **Word level:** every word in a final has `speaker` (573 of 573 in run 1). Most words also carry
  `speaker_confidence`, but not all: in turn 0, words 0–5 lack it and words 6–39 have it. Treat it as
  optional per word. No partial word carries `speaker` (0 of 680).
- **Consequence:** a partial has no speaker information at all. The live caption line cannot be labelled
  until the final arrives, which with labels on is up to ~10 s later (see next section).

**Retroactive change:** never observed. `speaker_label` is emitted exactly once per turn, on its single
final, so there is no later frame in which it could be revised. Zero `SpeakerRevision` frames in any run.
Within a turn, no word ever changed from one label to a different label across frames (the only
transitions are absent → present, partial → final).

**But the turn label is not the whole story.** The turn-level label can disagree with the words inside the
same final. Run 1, turn 16 final (same in run 3):

Words (quote removed with the capture, for licensing): the first clause is `B`, the rest `A`. No remaining final changes between `A` and `B`
inside one turn. The weaker form, an `A` label over `A` and `PENDING` words, is in `strang-plain.jsonl`
line 22 (turn 4). A revision splitting one `A` turn into `A` 12 / `B` 12 words is in `jargon-plain.jsonl`
line 53 (turn 2).

A speaker change happened mid-turn and the turn label reports one of the two. For a speaker gutter the
per-word `speaker` field is the truth; `speaker_label` is a summary.

## Turn segmentation: run 1 vs run 2

Same audio, same model, only `speaker_labels` differs. The result is a different product.

| | Run 1, labels on | Run 2, labels off |
| --- | --- | --- |
| Turns | 20 | 4 |
| Turn frames (partials + finals) | 74 | 116 |
| `SpeechStarted` timestamps (ms) | 0, 10016, 20032, 30048, 40064, 49024, 59040, 69056, 79072, 84608, 94624, 104640, 114656, 122176, 132192, 142208, 152224, 162240, 172256, 176768 | 0, 60000, 85504, 145504 |
| Deltas between turn starts | 15 of 19 are exactly 10016 ms; the rest 8960, 5536, 7520, 4512 | 60000, 25504, 60000 |
| Longest audio span of a single final | 9999 ms (turns 7 and 13) | 59974 ms (turn 2) |
| Words in the longest final | 40 | 199 |
| First final received after `Begin` | 10.233 s | 60.346 s |
| Longest gap between consecutive finals, wall clock | 10.375 s (turn 8 → 9) | 60.530 s (turn 1 → 2) |
| Longest gap between consecutive finals, audio time | 10.840 s (turn 12 → 13) | 60.422 s (turn 1 → 2) |
| Interval between partials within a turn, median (min–max) | 3279 ms (1095–3990) | 1556 ms (251–2690) |
| Finals beginning with a lowercase letter | 12 of 20 (turns 0, 1, 2, 3, 8, 11, 12, 14, 16, 17, 18, 19) | 1 of 4 |

Read together: a "turn" here is not an utterance. With labels on, a turn closes at a detected pause **or**
at a cap of about 10 s of audio, whichever comes first, and most of this interview hit the cap. With labels
off the cap is about 60 s. The finals are cut mid-sentence either way:

- Run 1 turn 0 ends mid-sentence and turn 1 opens lowercase (quote removed with the capture, for licensing). Same pattern: `jargon-plain.jsonl`
  line 8 ends `in the course` and line 11 opens `reader differs from strengths.`
- Run 2 turn 0 is a single 60-second final of 199 words (quote removed with the capture, for licensing). No remaining capture was made with
  `speaker_labels=false`, so the ~60 s cap is not visible in any committed file.

Run 3 (labels on, boosted) reproduces run 1's segmentation: all 20 `SpeechStarted` timestamps are
identical, and 18 of 20 per-turn spans are identical. Turn 2 ends at 29644 ms instead of 29531 and turn 3
starts at 30322 ms instead of 30225; the turn boundaries themselves did not move.

Words differ at the cut points. Run 1 finals total 577 words, run 2 finals 578, but each has words the other
lacks. One verified omission and bag-of-words differences in both
directions (quote removed with the capture, for licensing). A boundary omission in committed files: `strang-plain.jsonl` line 94 ends `its nth
column.`, which `strang-boosted.jsonl` lines 98 and 101 lack (`docs/data/boost-measurement.md`, difference 2). Whether slab boundaries drop or duplicate words
is not settled by three minutes of audio.

## Session lifecycle

Run 1 timeline, seconds after the `connect` line (line 1, 2026-09-18T16:45:18.629Z):

| Line | Event | t |
| --- | --- | --- |
| 2 | `open` (WebSocket upgraded) | 0.402 |
| 3 | `Begin` | 0.605 |
| 4 | `SpeechStarted` timestamp 0 | 1.469 |
| 5 | first `Turn` partial | 1.470 |
| 8 | first final | 10.838 |
| 97 | `audio_done`, 3600 chunks in 180 001 ms | 180.403 |
| 98 | `sent_terminate` (`{"type":"Terminate"}`) | 180.404 |
| 99 | `Turn` turn 19, `end_of_turn: true` (the open turn, flushed) | 181.274 |
| 100 | `Termination` | 181.611 |
| 101 | `close` code 1000 reason `Session Ended` | 182.704 |

`Begin`, line 3, complete:

```json
{"type":"Begin","id":"46e94a48-1c2c-41c8-b004-f3d05ba6b8c3","expires_at":1789760718,"configuration":{"model":"universal-3-5-pro","mode":"balanced","api_version":"2025-05-12","speaker_labels":true,"redact_pii":false,"filter_profanity":false,"domain":null,"voice_focus":null}}
```

- `expires_at` is `Begin` time plus three hours in all three runs (2.9997 h, 2.9996 h, 2.9999 h). Expiry
  itself was not observed; the sessions ran three minutes.
- `configuration` echoes `speaker_labels` and the defaulted `mode: "balanced"`. It does **not** echo
  `format_turns`, `max_speakers`, `sample_rate`, `encoding`, or `keyterms_prompt`. Acceptance of those can
  only be inferred from the session running normally.
- `api_version` is `"2025-05-12"`.

What follows `Terminate`, in all three runs: the server finalises whatever turn is open, sends
`Termination`, then closes the socket itself with code 1000 and reason `Session Ended`. The client never
had to close.

| Run | After `sent_terminate` |
| --- | --- |
| 1 | turn 19 final +0.870 s → `Termination` +1.207 s → close +2.300 s |
| 2 | turn 3 partial +0.044 s → turn 3 final +0.295 s → `Termination` +1.159 s → close +1.402 s |
| 3 | turn 19 final +1.391 s → `Termination` +1.741 s → close +2.247 s |

`Termination`, line 100: `{"type":"Termination","audio_duration_seconds":180,"session_duration_seconds":181}`.
Run 3 reported `session_duration_seconds: 182`.

`SpeechStarted` arrives once per turn, immediately before the turn's first partial (line 4 at 20.098Z,
line 5 at 20.099Z in run 1), with a `confidence` between 0.46 and 0.99. Sample, line 4:
`{"type":"SpeechStarted","timestamp":0,"confidence":0.847772}`.

A latency indicator, not a measurement: with the sender paced at real time, each final arrived 0.39–1.22 s
(median 0.77 s) after the audio position of its last word in run 1, 0.34–0.67 s (median 0.55 s) in run 2,
0.63–1.75 s (median 1.12 s) in run 3. This assumes the first chunk left at `open`, and it is not end-to-end
through a browser and a proxy. The real number belongs in `docs/data/` once measured against the running
system.

## Keyword boosting

**Parameter:** `keyterms_prompt`, a query-string parameter whose value is a JSON array of strings,
URL-encoded. The encoding comes from the official Node SDK's streaming client, which does
`searchParams.set("keyterms_prompt", JSON.stringify(terms))`. The API reference lists a maximum of 100 terms.

Exactly what run 3 sent, from `aai-stream-boosted.jsonl` line 1:

```
wss://streaming.assemblyai.com/v3/ws?speech_model=universal-3-5-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true&speaker_labels=true&max_speakers=2&keyterms_prompt=%5B%22mesa-optimization%22%2C%22instrumental+convergence%22%2C%22interpretability%22%2C%22RLHF%22%2C%22scalable+oversight%22%2C%22deceptive+alignment%22%2C%22eval%22%2C%22scheming%22%5D
```

The server accepted it: `Begin` arrived, the session ran to a normal `Termination`. Nothing in any frame
echoes the terms.

**Result: null.** None of the eight terms transcribed differently, because none of them occur in either
transcript. Exact, case- and hyphen-insensitive counts in the finals:

| Term | Run 1 (plain) | Run 3 (boosted) |
| --- | --- | --- |
| mesa-optimization | 0 | 0 |
| instrumental convergence | 0 | 0 |
| interpretability | 0 | 0 |
| RLHF | 0 | 0 |
| scalable oversight | 0 | 0 |
| deceptive alignment | 0 | 0 |
| eval | 0 | 0 |
| scheming | 0 | 0 |

No word in either transcript contains any of the stems `mesa`, `optimi`, `instrumental`, `converg`,
`interpret`, `rlhf`, `scalab`, `oversight`, `decept`, `align`, `eval`, `schem`. The two transcripts (577 vs
576 words) differ in exactly one turn, by a filler word unrelated to any term (quote removed with the capture, for licensing). The Strang pair
shows the same closeness: 3 differences, all at turn boundaries (`docs/data/boost-measurement.md`).

**Reason:** the audio is an interview about extinction risk and recursive self-improvement. The speakers
never use the glossary vocabulary. This recording is the wrong test for the glossary feature, and boost
efficacy remains unmeasured. It needs audio in which the terms are actually spoken, ideally several times
each, with a reference transcript.

A useful side result: same audio, two sessions, one changed turn out of twenty. The recogniser is close to
deterministic for identical input, so a before/after comparison on the right audio will be meaningful.

## What contradicts or surprises, relative to the reference page

1. **Turns are time-capped, not utterance-bounded.** ~10 s with speaker labels, ~60 s without, cutting
   mid-sentence and producing lowercase-initial finals. The reference page describes turns as
   end-of-turn-detected. This is the finding that changes the design the most: "finals only" in a buffer
   means 10-second slabs, and "cite a time range" means citing a slab, not a sentence.
2. **`turn_is_formatted` is `true` on every frame**, partials included. It cannot tell partial from final,
   and there is no unformatted final on this model with `format_turns=true`.
3. **`end_of_turn_confidence` is binary.** `0.0` on every partial, `1.0` on every final, 264 frames. The
   documented threshold parameter has nothing graded to act on in these captures.
4. **Speaker labels change the stream, not just add a field.** Partials arrive half as often (median 3.3 s
   vs 1.6 s) and the turn cap drops from ~60 s to ~10 s.
5. **Partials carry no speaker information**, at turn or word level. Only finals do.
6. **Turn-level `speaker_label` can disagree with the words inside the final** (turn 16).
7. **Partials shrink.** The `words` array and the text can lose material between consecutive partials.
8. **Word timings shift between partial and final** by tens of milliseconds.
9. **`type` is the last key in `Turn` frames** and the first in every other frame. Harmless to a parser,
   misleading to a reader of the raw stream.
10. **Three different time units** in one API: ms for audio positions, whole seconds for durations, Unix
    seconds for expiry.
11. **`Begin.configuration` does not echo `format_turns`, `max_speakers`, or `keyterms_prompt`**, so there
    is no payload-level confirmation that those were applied.

## Open questions

Things the fixtures cannot settle. None should be resolved from memory of the docs.

- **Plus-encoding of multi-word keyterms.** URLSearchParams wrote `instrumental+convergence` inside the
  JSON array. Under form-urlencoding rules `+` is a space, but nothing echoes the terms back, so whether
  the server read `instrumental convergence` or `instrumental+convergence` is unknowable from the payload.
  The official SDK encodes identically, which is the only evidence it works. The cheap fix is to encode with
  `encodeURIComponent(JSON.stringify(terms))`, which writes `%20` and is unambiguous under both decodings.
- **Whether `keyterms_prompt` does anything on this model.** Untested; wrong audio.
- **Whether the ~10 s / ~60 s turn caps are configurable**, and by what. The reference page lists
  `min_turn_silence`, `max_turn_silence`, and `end_of_turn_confidence_threshold`, and marks the last
  "Universal Streaming only". Whether `universal-3-5-pro` honours any of them, and whether the cap is tied
  to `speaker_labels` or to the `continuous_partials` behaviour the page attributes to this model, needs a
  targeted capture.
- **Whether slab boundaries lose or duplicate words.** One omission verified, bag-of-words differences in
  both directions. Needs longer audio with a reference transcript.
- **Expiry at three hours, inactivity timeout, and the shape of any error frame.** None occurred. The
  script's HTTP-rejection path never fired either, so the 401/400 response body shape is uncaptured.
- **What a reconnect looks like.** A new session presumably restarts `turn_order` at 0 and word timings at
  0 ms, which would force the buffer to add a per-session offset. Unobserved.
- **`SpeakerRevision`.** Documented, never emitted in three minutes with two speakers. Its shape is
  uncaptured; do not type it from memory.
- **Whether labels beyond `A` and `B` appear** with `max_speakers` above 2. Only `A` and `B` were seen, at
  `max_speakers=2`.
- **`format_turns=false` on this model.** All runs used `true`. Whether unformatted finals exist, and what
  `turn_is_formatted` does then, is uncaptured.
- **Why `speaker_confidence` is missing on some words** (turn 0, words 0–5) and present on the rest.

## Addendum, 2026-09-19: values first seen in the Strang captures

From `strang-plain.jsonl` and `strang-boosted.jsonl` (same script and parameters as run 1, the second with
eight keyterms; 180 s of a single lecturer with frequent pauses). Details and counts in
`docs/data/boost-measurement.md`.

- `speaker_label` and `words[].speaker` can be the literal string `"PENDING"`. 12 of 34 finals in the plain
  run and 12 of 35 in the boosted run carry it, every one of them 1 to 5 words long; at word level 37 and 42
  word objects. The statement above that only `A` and `B` appeared holds for the interview captures only.
- `speaker_label: "B"` appeared once, on a 5-word final, in audio described as a single lecturer.
- Segmentation followed pauses when the audio had them: 34 and 35 turns in 180 s, shortest final 184 ms, and
  only 1 and 2 finals at the ~10 s cap.
- The two runs of the same audio did not produce identical turn boundaries: 32 of 34 start times shared.
- Whole words repeated or omitted at turn boundaries occurred in both runs, in both directions: a word
  present at the end of one final and again as the whole of the next; three words present in one run and
  absent in the other at the same boundary.
