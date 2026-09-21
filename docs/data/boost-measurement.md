# Keyterm boost measurement — MIT 18.06 Lecture 22 (Strang), first 180 s

Two captures of the same audio, identical parameters except `keyterms_prompt` on the second. Every number
below comes from the two fixture files named here. No reference transcript was used; word error rate is not
computed (see the last section).

## Setup

| | plain | boosted |
| --- | --- | --- |
| Fixture | `docs/fixtures/strang-plain.jsonl` | `docs/fixtures/strang-boosted.jsonl` |
| Connect (UTC) | 2026-09-19T16:39:19.740Z | 2026-09-19T16:42:21.554Z |
| Session id | `0fcbcd56-2b82-4d61-b8c7-cf06cac22f03` | `5df6b0d0-373c-43e9-98bc-c52d16262bb1` |
| Model (`Begin.configuration.model`) | `universal-3-5-pro`, mode `balanced`, api_version `2025-05-12` | same |
| Query parameters | `speech_model=universal-3-5-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true&speaker_labels=true&max_speakers=2` | same, plus `keyterms_prompt` |
| Lines / server frames | 129 / 124 | 134 / 129 |
| Turn frames (partials + finals) | 88 (54 + 34) | 91 (56 + 35) |
| Tokens in finals | 347 | 345 |
| `Termination` | audio 180 s, session 181 s | audio 180 s, session 181 s |
| Close | 1000 `Session Ended` | 1000 `Session Ended` |

Audio: `audio/strang-3min.wav`, 5 758 976 bytes of 16 kHz mono PCM16, sent as 3600 chunks of 50 ms. Last word
end in both runs: 179 618 ms.

Keyterms as given: `eigenvector, eigenvalue, lambda, diagonalize, linearly independent, eigenvector matrix, invert, columns`.

The boosted request, verbatim from `strang-boosted.jsonl` line 1:

```
wss://streaming.assemblyai.com/v3/ws?speech_model=universal-3-5-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true&speaker_labels=true&max_speakers=2&keyterms_prompt=%5B%22eigenvector%22%2C%22eigenvalue%22%2C%22lambda%22%2C%22diagonalize%22%2C%22linearly+independent%22%2C%22eigenvector+matrix%22%2C%22invert%22%2C%22columns%22%5D
```

The two multi-word terms went over the wire as `linearly+independent` and `eigenvector+matrix`.

## Method

- Finals only: frames with `end_of_turn: true`, their `words[]` arrays concatenated in order.
- Token: `words[].text` lowercased, every character except `a–z`, `0–9` and apostrophe removed. Tokens that
  become empty (a standalone dash) are dropped. Hyphens are removed, so `eigen-vector` would count as
  `eigenvector`; none occurred.
- Term match: the exact token, or the exact consecutive tokens for a multi-word term. Inflected forms are
  counted separately and named: `eigenvectors`, `eigenvalues`, `lambdas`, `lambda's`, the `diagonaliz-` /
  `diagonalis-` family, `column`, `inverted` / `inverting` / `inverts` / `invertible`. `inverse` is counted as
  related to `invert`, not as the term.
- Alignment: token-level Levenshtein alignment (substitution, insertion, deletion each cost 1) between the two
  runs' complete final token sequences. A term occurrence is SAME when both runs contain the term inside the
  aligned span.
- Timestamps are the `start` of the first word of the span, in audio time.

## Alignment of the two runs

| | count |
| --- | --- |
| Tokens, plain | 347 |
| Tokens, boosted | 345 |
| Equal | 343 |
| Substitutions | 0 |
| Insertions (boosted only) | 2 |
| Deletions (plain only) | 4 |
| Edit distance | 6 |
| Difference hunks | 3 |

Every one of the three hunks contains the token `column` or `columns`. They are listed in full further down.

## Per-term counts

| Term | Plain exact | Plain inflected | Boosted exact | Boosted inflected | Aligned spans | SAME | Boosted only | Plain only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eigenvector | 7 | 4 `eigenvectors` | 7 | 4 `eigenvectors` | 11 | 11 | 0 | 0 |
| eigenvalue | 0 | 1 `eigenvalues` | 0 | 1 `eigenvalues` | 1 | 1 | 0 | 0 |
| lambda | 7 | 0 | 7 | 0 | 7 | 7 | 0 | 0 |
| diagonalize | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| linearly independent | 1 | 0 | 1 | 0 | 1 | 1 | 0 | 0 |
| eigenvector matrix | 3 | 0 | 3 | 0 | 3 | 3 | 0 | 0 |
| invert | 1 | 0 (`inverse` 2, related) | 1 | 0 (`inverse` 2, related) | 1 | 1 | 0 | 0 |
| columns | 4 | 11 `column` | 3 | 11 `column` | 16 | 13 | 1 | 2 |

Every distinct token in either run containing one of the stems `eigen`, `lambda`, `lamda`, `landa`,
`diagonal`, `invert`, `invers`, `column`, `independ`, `linearly`, `matrix`, with plain/boosted counts:
`eigenvalues` 1/1, `eigenvector` 7/7, `eigenvectors` 4/4, `lambda` 7/7, `invert` 1/1, `inverse` 2/2,
`column` 11/11, `columns` 4/3, `independent` 2/2, `linearly` 1/1, `matrix` 8/8. No token containing `lamda`,
`landa` or `diagonal` exists in either run.

## Every occurrence, per term

Rendering is the word text as it appears in the final, punctuation included.

### eigenvector (11 spans, all SAME)

| Time | Plain | Boosted |
| --- | --- | --- |
| 00:05.599 | eigenvectors | eigenvectors |
| 00:11.011 | eigenvector | eigenvector |
| 00:31.586 | eigenvector | eigenvector |
| 00:37.376 | eigenvectors. | eigenvectors. |
| 00:52.052 | Eigenvectors. | Eigenvectors. |
| 01:13.624 | eigenvector | eigenvector |
| 01:16.451 | eigenvectors | eigenvectors |
| 01:33.167 | eigenvector | eigenvector |
| 01:36.479 | eigenvector | eigenvector |
| 01:39.394 | eigenvector | eigenvector |
| 01:58.304 | eigenvector. | eigenvector. |

### eigenvalue (1 span, SAME)

| Time | Plain | Boosted |
| --- | --- | --- |
| 02:31.579 | eigenvalues, | eigenvalues, |

### lambda (7 spans, all SAME)

| Time | Plain | Boosted | Context (boosted) |
| --- | --- | --- | --- |
| 02:02.527 | lambda | lambda | is equal to the lambda times the x1 |
| 02:04.793 | lambda | lambda | And that lambda we'll call |
| 02:06.185 | lambda | lambda | we'll call lambda 1, of course |
| 02:12.743 | lambda | lambda | the same as lambda 1 x1 |
| 02:15.086 | lambda | lambda | Ax2 is lambda 2 x2 |
| 02:20.932 | lambda | lambda | we now have lambda n xn |
| 02:46.159 | lambda | lambda | So that number lambda 1 is multiplying |

### diagonalize (0 spans)

No token in either run matches `diagonalize` or any listed inflection, and no token contains `diagonal`.

### linearly independent (1 span, SAME)

| Time | Plain | Boosted |
| --- | --- | --- |
| 00:49.324 | linearly independent. | linearly independent. |

### eigenvector matrix (3 spans, all SAME)

| Time | Plain | Boosted |
| --- | --- | --- |
| 00:11.011 | eigenvector matrix. | eigenvector matrix. |
| 00:31.586 | eigenvector matrix | eigenvector matrix |
| 01:13.624 | eigenvector matrix, | eigenvector matrix, |

### invert (1 span, SAME)

| Time | Plain | Boosted |
| --- | --- | --- |
| 00:29.607 | invert. | invert. |

`inverse` at 00:16 and 00:24 in both runs (`S inverse AS`, `there's an S inverse`), identical.

### columns (16 spans: 13 SAME, 3 differences)

| Time | Plain | Boosted | Status |
| --- | --- | --- | --- |
| 00:07.215 | columns | columns | SAME |
| 01:05.776 | columns. | columns. | SAME |
| 01:17.485 | columns. Columns. | columns. | plain has the token twice, boosted once |
| 01:35.364 | column, | column, | SAME |
| 01:37.771 | column. | column. | SAME |
| 01:40.875 | column. | column. | SAME |
| 01:47.993 | column | column | SAME |
| 01:53.747 | column | column | SAME |
| 01:55.133 | column | column | SAME |
| 02:10.498 | column. | column. | SAME |
| 02:18.171 | its nth column. | (absent) | plain has three tokens boosted lacks |
| 02:19.147 | column, | column, | SAME |
| 02:47.597 | (absent) | first column. | boosted has two tokens plain lacks |
| 02:48.196 | column. | column. | SAME |
| 02:51.965 | column, | column, | SAME |

## The three differences in full

Each is quoted from the finals of both runs with its turn numbers and turn start times.

**1. 01:17.485**

- Plain, turn 14 (speaker A, starts 01:08.778): `Of this matrix S. So I'm naturally going to call that the eigenvector matrix, because it's got the eigenvectors in its columns.`
  Plain, turn 15 (speaker PENDING, starts 01:17.728, 1 word): `Columns.`
- Boosted, turn 15 (speaker A, starts 01:11.904): `So I'm naturally going to call that the eigenvector matrix, because it's got the eigenvectors in its columns. And all I want to do is show you what happens when`
- Turn boundaries differ here. Plain has turn starts at 77 728 and 78 816 ms; boosted has 71 904 and 81 920 ms instead.

**2. 02:18.171**

- Plain, turn 24 (A, starts 02:09.609): `So that's the first column. Ax1 is the same as lambda 1 x1. Ax2 is lambda 2 x2, so on along to its nth column.`
  Plain, turn 25 (A, starts 02:18.624): `In the nth column, we now have lambda n xn.`
- Boosted, turn 25 (A, starts 02:09.609): `So that's the first column. Ax1 is the same as lambda 1 x1. Ax2 is lambda 2 x2, so on along to— in`
  Boosted, turn 26 (A, starts 02:18.656): `the nth column, we now have lambda n xn.`
- Same turn boundary in both runs (`SpeechStarted` 138 624 ms). The boosted run lacks the three tokens
  `its nth column`; `in` sits at the end of the earlier turn instead of the start of the later one.

**3. 02:47.597**

- Plain, turn 29 (A, starts 02:38.873): `So then I'll have just what I want. OK, so how am I going to separate out? So that number lambda 1 is multiplying the`
  Plain, turn 30 (PENDING, starts 02:47.904, 2 words): `first column.`
- Boosted, turn 30 (A, starts 02:38.873): `So then I'll have just what I want. OK, so how am I going to separate out? So that number lambda 1 is multiplying the first column.`
  Boosted, turn 31 (PENDING, starts 02:47.904, 2 words): `first column.`
- Same turn boundary in both runs (167 904 ms). The boosted run has `first column` twice, the plain run once.

Which of the two runs matches what was said at each of the three points cannot be determined from these
files.

## Fixed, regressed, neither

- **Term renderings the plain run got wrong and the boosted run fixed: 0.** There is no aligned span in
  which the plain run rendered something other than the term and the boosted run rendered the term.
  0 substitutions exist between the runs at all.
- **Term renderings the boosted run made worse: 0.** The boosted run's deviations from plain are the two
  boundary events above: three tokens absent at 02:18.171 (including one `column`) and two tokens repeated at
  02:47.597 (including one `column`). Neither is a different spelling or a different word for a term.
- **Terms neither run produced:** `diagonalize` (0 and 0, no inflection, no `diagonal` stem) and the singular
  `eigenvalue` (0 and 0; the plural appears once in each). Whether either was spoken in these 180 s is not
  determinable from the two files.

Net over all eight terms: 39 term occurrences in the plain run, 38 in the boosted run, 38 aligned
identically. That total counts each of the three `eigenvector matrix` occurrences twice, once under
`eigenvector` and once under `eigenvector matrix`; counting each position once gives 36 and 35.

## lambda as the single-word control

`lambda` is the one term that carries no space and therefore no `+` in the query string.

| | plain | boosted |
| --- | --- | --- |
| Occurrences | 7 | 7 |
| Rendered as | `lambda` × 7 | `lambda` × 7 |
| Aligned identically | 7 of 7 | 7 of 7 |
| Tokens containing `lamda` or `landa` | 0 | 0 |

The plain run rendered all seven occurrences as `lambda` before any boost was applied, so there was nothing
for the boosted run to change. The two multi-word terms, the ones that did carry a `+`, show the same
pattern: `linearly independent` 1 and 1, `eigenvector matrix` 3 and 3, all aligned identically. These files
therefore contain no difference between plus-encoded and non-plus-encoded terms, and no evidence either way
about whether the `+` was read as a space.

## Other numbers from the same two files

- Turn start times: 32 of the plain run's 34 also occur in the boosted run. Plain only: 77 728, 78 816 ms.
  Boosted only: 71 904, 81 920, 110 016 ms.
- Longest final span: 9967 ms (plain), 9999 ms (boosted). Finals spanning 9900 ms or more: 1 and 2.
  Shortest final: 184 ms in both.
- `speaker_label` on finals: plain `PENDING` 12, `A` 22; boosted `PENDING` 12, `A` 22, `B` 1. Every
  `PENDING` final has between 1 and 5 words. Word-level `speaker`: plain `PENDING` 37, `A` 310; boosted
  `PENDING` 42, `A` 298, `B` 5. The `B` final is boosted turn 34, `And that's going to multiply—`, 5 words,
  starting 02:58.440.
- `"PENDING"` did not occur in any P0 fixture. Recorded as an addendum in `docs/fixtures/NOTES.md`.

## Word error rate

Not computed. It requires the MIT-published transcript of this lecture as ground truth. With it, the same
tokenisation and alignment give, for each run, WER = (substitutions + deletions + insertions) / reference
tokens over the 180 s window, plus per-term recall (reference occurrences of each term against rendered
occurrences), which would also settle the "neither got" and "which side of each boundary event is right"
questions above.

---

# Keyterm boost measurement 2 — out-of-distribution terms, `audio/jargon.wav`, 92 s

A separate measurement from the one above, on different audio with a different term list. Two captures of the
same audio, identical parameters except `keyterms_prompt` on the second. Every number below comes from the two
fixture files named here. No reference transcript was used. Throughout, "rendered the term" means the final
contains the exact string supplied in `keyterms_prompt`; it does not mean the string is what was said.

## Setup

| | plain | boosted |
| --- | --- | --- |
| Fixture | `docs/fixtures/jargon-plain.jsonl` | `docs/fixtures/jargon-boosted.jsonl` |
| Connect (UTC) | 2026-09-21T15:36:18.362Z | 2026-09-21T15:46:50.195Z |
| Session id | `54d202b1-16ea-49e2-8c5a-d3315f237b57` | `e0702609-a6ff-4bc8-8eb1-2c22dbaec83e` |
| Model (`Begin.configuration.model`) | `universal-3-5-pro`, mode `balanced`, api_version `2025-05-12` | same |
| Query parameters | `speech_model=universal-3-5-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true&speaker_labels=true&max_speakers=2` | same, plus `keyterms_prompt` |
| Lines / server frames | 55 / 50 | 55 / 50 |
| Frame types | 1 Begin, 10 SpeechStarted, 37 Turn, 1 SpeakerRevision, 1 Termination | same |
| Turn frames (partials + finals) | 37 (27 + 10) | 37 (27 + 10) |
| Tokens in finals | 170 | 167 |
| `Termination` | audio 92 s, session 92 s | audio 92 s, session 93 s |
| Close | 1000 `Session Ended` | 1000 `Session Ended` |

Audio: `audio/jargon.wav`, 2 944 342 bytes of 16 kHz mono PCM16 (92.0 s), sent as 1841 chunks of 50 ms. Last
word end in both runs: 90 121 ms. The ten `SpeechStarted` timestamps are identical in the two runs (256, 10 272,
13 184, 23 200, 33 216, 43 232, 53 248, 63 264, 73 280, 83 296 ms), and so are the ten final turn start times.
One final per `turn_order` in each run. All ten finals carry `speaker_label` `A` in both runs.

Keyterms as given, from the `keyterms` array on the connect line: `Venkataraman, Bhattacharya, Okonkwo,
Nkemdirim, Ravindranath, Szymanski, Adeyemi-Lindqvist, Thirunavukkarasu, kappa, self-adjoint`.

The boosted request, verbatim from `jargon-boosted.jsonl` line 1:

```
wss://streaming.assemblyai.com/v3/ws?speech_model=universal-3-5-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true&speaker_labels=true&max_speakers=2&keyterms_prompt=%5B%22Venkataraman%22%2C%22Bhattacharya%22%2C%22Okonkwo%22%2C%22Nkemdirim%22%2C%22Ravindranath%22%2C%22Szymanski%22%2C%22Adeyemi-Lindqvist%22%2C%22Thirunavukkarasu%22%2C%22kappa%22%2C%22self-adjoint%22%5D
```

No term contains a space, so no `+` appears in the query string. The two hyphens went over the wire as literal `-`.

The finals contain the same passage twice. Turns 0–4 (00:00.320 to 00:43) and turns 5–9 (00:43.232 to
01:30) have near-identical text in both runs, so each term has up to two positions, called the first and
second reading below. The two readings differ in a few words in both runs (`location in the` /
`notation in the course reader`, `A problem set 4` / `For problem set 4`, `criterion for fails for` / `criterion falls for`).

## Method

As in the first measurement (finals only, `words[].text` lowercased and stripped to `a–z`, `0–9`, apostrophe;
token-level Levenshtein alignment), with two additions:

- Hyphens are removed by the normalisation, so `self-adjoint` is the token `selfadjoint` and
  `Adeyemi-Lindqvist` is `adeyemilindqvist`. A hyphenated term would also have been matched as its parts in
  consecutive tokens (`self adjoint`); no such split rendering occurred in either run.
- Possessives are counted as inflected and named: `Bhattacharya's`, `Okonkwo's`, `Szymanski's`. The bare
  surname never occurs for `Bhattacharya` or `Okonkwo` in either run.

## Alignment of the two runs

| | count |
| --- | --- |
| Tokens, plain | 170 |
| Tokens, boosted | 167 |
| Equal | 149 |
| Substitutions | 16 |
| Insertions (boosted only) | 2 |
| Deletions (plain only) | 5 |
| Edit distance | 23 |
| Difference hunks | 15 |

Nine of the fifteen hunks contain a keyterm on the boosted side. Six contain no keyterm on either side. All
fifteen are listed further down. Turn boundaries are identical in the two runs; every hunk lies inside one
turn, with the same `turn_order` on both sides.

## Per-term counts

| Term | Plain exact | Plain inflected | Boosted exact | Boosted inflected | Aligned spans | SAME | Boosted only | Plain only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Venkataraman | 2 | 0 | 2 | 0 | 2 | 2 | 0 | 0 |
| Bhattacharya | 0 | 2 `Bhattacharya's` | 0 | 2 `Bhattacharya's` | 2 | 2 | 0 | 0 |
| Okonkwo | 0 | 2 `Okonkwo's` | 0 | 2 `Okonkwo's` | 2 | 2 | 0 | 0 |
| Nkemdirim | 0 | 0 | 2 | 0 | 2 | 0 | 2 | 0 |
| Ravindranath | 0 | 0 | 2 | 0 | 2 | 0 | 2 | 0 |
| Szymanski | 2 | 0 | 2 | 1 `Szymanski's` | 3 | 2 | 1 | 0 |
| Adeyemi-Lindqvist | 0 | 0 | 2 | 0 | 2 | 0 | 2 | 0 |
| Thirunavukkarasu | 0 | 0 (`Tirunavukkarasu` 1, one letter off, not counted) | 2 | 0 | 2 | 0 | 2 | 0 |
| kappa | 2 | 0 | 2 | 0 | 2 | 2 | 0 | 0 |
| self-adjoint | 2 | 0 | 2 | 0 | 2 | 2 | 0 | 0 |
| **Total** | 8 | 4 | 16 | 5 | 21 | 12 | 9 | 0 |

Plain-only tokens (in the plain multiset and not the boosted one): `course`, `strengths` ×2, `we'll` ×2, `nk` ×2,
`dirac`, `rabikonath` ×2, `a`, `weystrass` ×2, `adamilindquist` ×2, `there`, `are`, `now`, `crucial`, `dream`,
`tirunavukkarasu`. Boosted-only tokens: `we` ×2, `will` ×2, `globe`, `strength`, `nkemdirim` ×2, `ravindranath` ×2,
`wistress` ×2, `adeyemilindqvist` ×2, `thirunavukkarasu` ×2, `creates`, `szymanski's`.

## Every term, side by side

Rendering is the word text as it appears in the final, punctuation included. Time is the `start` of the first
word of the span; where the two sides of a hunk start at different times, both are given, plain first.

| Term | Reading | Time | Plain | Boosted | Status |
| --- | --- | --- | --- | --- | --- |
| Venkataraman | 1 | 00:03.438 | Venkataraman | Venkataraman | SAME |
| | 2 | 00:43.975 | Venkataraman | Venkataraman | SAME |
| Bhattacharya | 1 | 00:06.265 | Bhattacharya's | Bhattacharya's | SAME, possessive in both |
| | 2 | 00:45.929 | Bhattacharya's | Bhattacharya's | SAME, possessive in both |
| Okonkwo | 1 | 00:08.446 | Okonkwo's | Okonkwo's | SAME, possessive in both |
| | 2 | 00:48.595 | Okonkwo's | Okonkwo's | SAME, possessive in both |
| Nkemdirim | 1 | 00:17.255 | n-k Dirac | Nkemdirim | boosted only; plain has two tokens |
| | 2 | 00:56.995 | n-k dream | Nkemdirim | boosted only; plain has two tokens |
| Ravindranath | 1 | 00:19.839 | Rabi-Konath | Ravindranath | boosted only |
| | 2 | 00:59.192 | Rabi-Konath | Ravindranath | boosted only |
| Szymanski | 1 | 00:25.590 | Szymanski | Szymanski | SAME |
| | 2 | 01:04.588 | Szymanski | Szymanski | SAME |
| | extra, 2 | 00:51.971 / 00:52.149 | strengths. | Szymanski's. | boosted only; see "Regressions" |
| Adeyemi-Lindqvist | 1 | 00:30.485 | Adami-Lindquist | Adeyemi-Lindqvist | boosted only |
| | 2 | 01:11.050 | Adami-Lindquist | Adeyemi-Lindqvist | boosted only |
| Thirunavukkarasu | 1 | 00:34.459 / 00:34.944 | there are now a crucial, | Thirunavukkarasu creates, | boosted only; five-token hunk |
| | 2 | 01:16.947 | Tirunavukkarasu | Thirunavukkarasu | boosted only; plain differs by one letter |
| kappa | 1 | 00:15.881 | kappa. | kappa. | SAME |
| | 2 | 00:55.703 | kappa. | kappa. | SAME |
| self-adjoint | 1 | 00:21.390 | self-adjoint. | self-adjoint. | SAME |
| | 2 | 01:00.469 | self-adjoint. | self-adjoint. | SAME |

Word-level `confidence` on the term-bearing words in the finals: plain, 12 words, 0.911 to 0.999; boosted, 21
words, 0.983 to 1.000 except `Szymanski's.` at 00:52.149, which is 0.834.

## The fifteen differences in full

Turn numbers are the same on both sides of every hunk.

**Term-bearing, first reading**

1. 00:17.255, turn 2: plain `The n-k Dirac condition holds`, boosted `The Nkemdirim condition holds`.
2. 00:19.839, turn 2: plain `the Rabi-Konath operator is self-adjoint.`, boosted `the Ravindranath operator is self-adjoint.`
3. 00:30.485, turn 3: plain `the Adami-Lindquist bound from last week.`, boosted `the Adeyemi-Lindqvist bound from last week.`
4. 00:34.459, turn 4: plain `And note that there are now a crucial, uh, criterion for fails for non-compact operators. So` (16 words),
   boosted `And note that Thirunavukkarasu creates, uh, criterion for fails for non-compact operators. So` (13 words).
   Plain tokens `there are now a crucial` (5) against boosted `Thirunavukkarasu creates` (2); the only hunk that changes a turn's word count.

**Term-bearing, second reading**

5. 00:51.971, turn 5: plain `differs from strengths.`, boosted `differs from Szymanski's.` The first reading of the same
   sentence (turn 1, 00:11.630) is `differs from strengths.` in plain and `differs from strength.` in boosted.
6. 00:56.995, turn 6: plain `The n-k dream condition holds`, boosted `The Nkemdirim condition holds`.
7. 00:59.192, turn 6: plain `Rabi-Konath`, boosted `Ravindranath`.
8. 01:11.050, turn 7: plain `Adami-Lindquist`, boosted `Adeyemi-Lindqvist`.
9. 01:16.947, turn 8: plain `the Tirunavukkarasu criterion falls`, boosted `the Thirunavukkarasu criterion falls`.

**No keyterm on either side**

10. 00:10.126, turn 0: plain `Okonkwo's location in the course`, boosted `Okonkwo's location in the globe`.
11. 00:11.630, turn 1: plain `strengths.`, boosted `strength.`
12. 00:15.235, turn 2: plain `we'll write kappa.`, boosted `we will write kappa.`
13. 00:27.755, turn 3: plain `not the Weystrass form.`, boosted `not the Wistress form.`
14. 00:55.202, turn 6: plain `we'll write kappa.`, boosted `we will write kappa.`
15. 01:07.900, turn 7: plain `Weystrass`, boosted `Wistress`.

Hunks 13 and 15 change the rendering of a proper noun that is not in the keyterm list, at both readings.
Which run matches what was said at any of the fifteen points cannot be determined from these files.

## Fixed, regressed, neither

- **Terms the plain run did not render and the boosted run rendered: 4 terms, 8 spans.** `Nkemdirim`,
  `Ravindranath`, `Adeyemi-Lindqvist`, `Thirunavukkarasu`, at both readings each. At every one of the eight
  positions the plain run has something other than the term (listed in the table above) and the boosted run has
  the exact string from `keyterms_prompt`. The files show that the boosted run produced the supplied string at
  these positions; they do not show whether that string is what was spoken, so "got right" is not a claim these
  files support.
- **Terms neither run rendered: 0.** Every one of the ten terms occurs at least twice in the boosted run. Six
  (`Venkataraman`, `Bhattacharya`, `Okonkwo`, `Szymanski`, `kappa`, `self-adjoint`) occur in the plain run too, at
  the same positions, rendered identically, so the boost changed nothing for them.
- **Positions where the plain run rendered a term and the boosted run did not: 0.**
- **Regressions.** Nothing in the files is classifiable as a regression without a reference, but one position is
  unlike the eight above and is flagged: hunk 5, 00:51.971, turn 5, `differs from strengths.` (plain) against
  `differs from Szymanski's.` (boosted). It is the only boosted-only term occurrence that has no counterpart in
  the other reading: at the first reading of the same sentence both runs rendered a non-term (`strengths.`,
  `strength.`), and at the second reading the boosted run alone rendered a keyterm. Its word confidence, 0.834, is
  the lowest of the 21 term-bearing words in the boosted run; the next lowest is 0.983. Whether it is a keyterm
  substituted for a different spoken word or a term both runs otherwise missed cannot be determined from the two
  files.

Net over all ten terms: 12 term occurrences in the plain run, 21 in the boosted run, 12 aligned identically,
9 boosted-only, 0 plain-only.

## Other numbers from the same two files

- `SpeakerRevision`: one frame in each run, line 53, received after the local `sent_terminate` event and before
  `Termination` (67 ms and 194 ms after `audio_done` respectively). Five revisions in each, for turns 0, 2, 4,
  6 and 9. Turn 0 is relabelled `B` (13 `B` words, 6 `A`); turns 2 and 6 keep label `A` with word-level
  speakers split `A` 12 / `B` 12 and `A` 13 / `B` 12 in plain, `A` 13 / `B` 11 and `A` 14 / `B` 11 in boosted;
  turns 4 and 9 are all `A`. The finals themselves carry `A` on all ten turns in both runs. This is the frame
  the `docs/fixtures/NOTES.md` addendum of 2026-09-19 records as "captured once"; it is now in two of two
  captures on this audio.
- Word-level `speaker` on finals: plain `A` 163, `PENDING` 7; boosted `A` 160, `PENDING` 7. No final has
  `speaker_label` `PENDING` in either run.
- Turn 4 is the only turn whose word count differs between runs (16 plain, 13 boosted). The other nine turns
  have equal word counts.

## Word error rate

Not computed. It requires a reference transcript of `audio/jargon.wav`. With it, the same tokenisation and
alignment give WER for each run and per-term recall, and would classify each of the nine boosted-only spans
and the six non-term hunks as a fix, a regression, or neither.
