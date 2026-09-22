# Session output measurement — P4 gate, MIT 18.06 Lecture 22 (Strang), first 20 minutes

One live run of the full lecture recording through the real proxy: twenty minutes of audio at real-time
pace, the five P3 questions during the first three, then an end frame and the session output. Every number
below comes from the run report, the generated Markdown and the proxy's log of the run, all named here. No
reference transcript was used. "Grounded" means the server verified every passage verbatim against the
captions; whether a summary point or definition is right is a reader's comparison of its text with the
passages quoted, and nothing more.

## Setup

| | run 1 |
| --- | --- |
| Report | `docs/data/gate-p4-run1.json` |
| Generated Markdown, as the panel's copy and download would produce it | `docs/data/gate-p4-output.md` |
| Started / finished (UTC) | 2026-09-22T02:25:09.207Z / 2026-09-22T02:45:30.827Z |
| Upstream session id | `25e55ff8-b9e7-43b9-9fd7-2811aa09c43f` |
| Audio | `audio/strang.wav`, 99 521 840 PCM bytes (51.8 min); the first 24 000 chunks of 50 ms streamed, 1 200 s |
| Finals received | 200: 199 before the end frame, 1 flushed by upstream after it |
| Partials | 351 |
| `speaker_label` on finals | `A`, `B`, and `PENDING` on 19 |
| Reconnects | 0. `SpeakerRevision` frames: 0 |
| Glossary sent as keyterms | `eigenvector, eigenvalue, lambda, diagonalize, linearly independent, eigenvector matrix, invert, columns` |
| Extra glossary terms on the end frame only, never boosted | `diagonalization, invertible, matrix multiplication` |
| Answer layer | `gpt-5.6-luna`, reasoning effort low, Structured Outputs, `store: false` |
| Driver | `scripts/gate-p3.ts --stop-at-ms 1200000 --end --extra-terms ...` |

The driver stands in for the browser client, as in the P3 measurement. Everything below the browser is real.
The panel's rendering of the output was not seen; see "Not verified".

## Method

- The full session transcript is the connection's append-only list of finals (`server/index.ts`), not
  the ten-minute ask window; at the end frame the two held 199 and 108 finals respectively.
- Session output grounding is the ask path's (`server/answer/grounding.ts`): every summary point and key
  term cites line numbers that exist and carries passages each found verbatim inside one run of adjacent
  cited lines. Items that fail are dropped and counted. In this run the proxy did not log what was dropped;
  it does now (`session output dropped` lines), added after the run.
- The missed-term list is computed deterministically (`server/answer/terms.ts`) and the model is asked
  only about terms the detector could not find. Nothing was unfound here, so that call was not made.
- Latency: round trip from the end frame leaving the driver to the `session_output` frame arriving;
  `elapsedMs` inside the output is the generation alone. Tokens are the proxy's usage lines.

## The questions, an incidental finding

The P3 schedule was written for `audio/strang-3min.wav`. The full recording begins about a minute earlier
in the lecture: the cut's opening sentence at 0:03, "This matrix A, I put its eigenvectors in the columns
of a matrix S", is this recording's line at 1:03. So four of the five questions were asked before or
without their content, and the result is a test the schedule did not intend.

| Label | Asked at | Finals held | Result | Round trip | Tokens in / out (reasoning) |
| --- | --- | --- | --- | --- | --- |
| real-1, invert S | 1:00 | 8 | not found (`model`) | 3264 ms | 777 / 23 (0) |
| real-2, what is S | 1:40 | 14 | answer, one line at 1:03 | 3618 ms | 956 / 69 (0) |
| real-3, A times x1 | 2:22 | 23 | not found (`model`) | 5381 ms | 1169 / 151 (126) |
| adversarial, S inverse A S | 2:36 | 25 | not found (`model`) | 3250 ms | 1219 / 61 (36) |
| uncovered, determinant | 2:52 | 28 | not found (`model`) | 3286 ms | 1324 / 23 (0) |

Read against the transcript: "invert" is first said at 1:29 and "A times x1 is equal to the lambda times
the x1" at about 3:05, both after their questions were asked, so the two refusals are right for the
captions held at the time. The one answer, "S is the eigenvector matrix: the matrix whose columns contain
the eigenvectors of A", cites the 1:03 line, which says exactly that. Every verdict is in the proxy log.

## Session output

End frame sent at 20:00 with 199 finals held. Round trip 21 440 ms: about 5 s for the upstream terminate
and flush (one more final arrived after the end frame), 16 427 ms generating.

| Call | Tokens in | Tokens out | of which reasoning |
| --- | --- | --- | --- |
| summary | 6 495 | 1 768 | 57 |
| key terms | 6 572 | 1 619 | 144 |
| mangles | not made: no term was unfound | | |
| total | 13 067 | 3 387 | 201 |

At the model's listed prices ($0.20 / $1.20 per MTok) that is about $0.007 for the session output; the
five asks added about $0.002. The transcript was 2 273 words over 200 lines, 0:09 to 19:44, so a
50-minute lecture would carry roughly 2.5 times the input per call. That is an extrapolation; it was not
run.

**Summary: 6 points kept, 2 dropped.** Which two, and why, is not recoverable from this run (see Method).
The six, with the span of their cited lines:

| Lines cited | Point |
| --- | --- |
| 4 lines from 0:09 | The lecture began with the eigenvalue equation Ax = lambda x; the first task is to find the eigenvalues and eigenvectors |
| 6 lines from 0:42 | To diagonalize A, the eigenvectors go in the columns of S; the combination S inverse A S and the need to invert S |
| 9 lines from 1:47 | With n linearly independent eigenvectors in S, A times S applies A column by column; each column is the eigenvalue times its eigenvector |
| 11 lines from 3:28 | Separating the eigenvalues gives the diagonal matrix capital Lambda and the relation AS = S Lambda |
| 12 lines from 6:27 | Rearranged into A = S Lambda S inverse, presented as a new factorization |
| 11 lines from 13:59 | Powers of A go to zero when every eigenvalue has absolute value below 1; S and S inverse stay fixed |

Every point's citation is scattered rather than one run, so each label is "N lines from", and every point
carries between 3 and 12 verbatim passages. The stretch from 16:00 to 19:44, on distinct eigenvalues and
independence, has a key term but no summary point.

**Key terms: 15 kept, 0 dropped.** The cap is 15. All eight boosted glossary terms, all three unboosted
extras, and four the model chose: `diagonalized matrix`, `eigenvalue matrix`, `stable`, `distinct
eigenvalues`. Each definition carries 2 to 7 verbatim passages. Two read as the lecture's own usage rather
than a textbook's: "stable: a matrix is called stable, possibly, when its powers go to zero", quoting "I
would call that matrix stable, maybe"; and "distinct eigenvalues: when all eigenvalues are different, the
eigenvectors are automatically independent", quoting "The eigenvectors are automatically independent."

**Glossary: 11 of 11 found, none missed or mangled.**

| Term | Boosted | Occurrences | Forms found | First |
| --- | --- | --- | --- | --- |
| eigenvector | yes | 39 | eigenvector, eigenvectors | 0:23 |
| eigenvalue | yes | 33 | eigenvalues, eigenvalue | 0:13 |
| lambda | yes | 42 | lambda, lambdas, Lambda's | 0:21 |
| diagonalize | yes | 4 | diagonalize, diagonalized | 0:48 |
| linearly independent | yes | 1 | linearly independent | 1:49 |
| eigenvector matrix | yes | 3 | eigenvector matrix | 1:11 |
| invert | yes | 2 | invert | 1:29 |
| columns | yes | 23 | columns, column | 1:07 |
| diagonalization | no | 2 | diagonalization | 7:52 |
| invertible | no | 2 | invertible | 6:55 |
| matrix multiplication | no | 2 | matrix multiplication | 2:44 |

`diagonalize`, absent from the three-minute cut in both P3 measurements, is said four times in the first
twenty minutes, first at 0:48.

**Readability.** The Markdown is 11 849 bytes: the summary, fifteen term entries with their evidence, the
glossary section reading "Every supplied term was found in the captions" with the counts, and a "Not shown"
section stating the two dropped points. It reads without editing to this writer; the gate asks for the
user's eyes on it.

## Harness runs before the gate

Two runs of `scripts/summarize.ts` over the captures, made to tune the prompts before the live run. Raw
model output and the grounded result for each are in the session log; what matters is recorded here.

**`strang-plain`, eight terms, all boosted.** Summary 5 raw, 5 kept. Key terms 7 raw, 6 kept: `invert` was
dropped because its evidence quoted "And I want to look at this—", which is line 3, and line 3 was not
among the lines it cited. Only `diagonalize` was unfound; the model proposed no span for it, which is
right, since no `diagonal` stem occurs in the cut. 12.7 s, 4 121 tokens in, 2 231 out.

**`jargon-plain`, ten terms, none boosted.** Summary 5 raw, 4 kept: the dropped point quoted "A problem
set 4, use the Szymanski decomposition", which runs across lines 3 and 4, while citing only line 4. Key
terms 8 raw, 8 kept. The detector reported six found and four near misses at the spans the boost
measurement recorded. 11.4 s, 2 632 in, 2 041 out.

**Whether the model finds `there are now a crucial` for `Thirunavukkarasu`.** This is the mangle string
similarity cannot reach and the reason the model pass exists. Three samples of the mangles call:

| Prompt | Proposed for Thirunavukkarasu | Verbatim in the named line |
| --- | --- | --- |
| Original: list the unfound terms, ask for spans | nothing beyond the spelling matches | |
| Plus the spelling matches given as known, ask for other occurrences | line 5, "a crucial, uh" | yes |
| Plus "copy the whole run of words that stands in for the term" | line 5, "now a crucial, uh" | yes |

With the original prompt the model reproduced the six spans spelling similarity had already found and
nothing else. With the revised prompt, both samples pointed at the right line and a span inside the
mangled phrase, and neither returned the whole phrase. The panel shows such a span as "possibly ‘now a
crucial, uh’ at 0:35 (model suggestion)" with a jump to the line, where the reader sees the whole sentence.
In the same original run, the summary call cited that line as evidence for "a Thirunavukkarasu criterion",
so the association is within the model's reach when the other reading is in view. Three samples support
"it can locate the line" and do not support "it returns the span".

## Not verified

- **The panel.** No browser was connected. The Markdown above is what the panel's copy and download
  produce; the on-screen rendering, the citation jumps from the output into the captions, and the copy and
  download controls were not seen. The gate requires human eyes on output.
- **The two dropped summary points.** Not logged in this run.
- **The mangles pass on a live run.** It was not exercised here because every term was found; its behaviour
  rests on the three harness samples above.
- **Correctness of any point or definition.** No reference transcript; only the quoted passages.
- **A 50-minute session.** Costs and timings above 20 minutes are extrapolated from this run.
