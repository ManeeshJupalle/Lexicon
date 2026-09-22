# Demo script, about 3 minutes

Audio: `audio/jargon.wav` (92 s, the author's own recording). The same passage is read twice: 0:00 to 0:43,
then 0:43 to 1:30. Every caption string quoted below comes from the captures in `docs/fixtures/jargon-*.jsonl`.
Recognition varies between sessions (`docs/data/ask-measurement.md`, "Other observations"), and the captures
streamed the WAV directly rather than through a microphone. A live take can therefore render differently.
Rehearse, and narrate whatever is actually on screen, never what the fixture says.

## Before recording

- Run `npm run dev` and `npm run dev:client`, open `http://localhost:5173`, and set caption size to at least 32.
- Route the WAV into the browser's microphone input. A virtual audio cable is cleaner than speakers into a
  mic, because room acoustics change what the recogniser hears.
- Have the ten terms ready to paste:
  `Venkataraman, Bhattacharya, Okonkwo, Nkemdirim, Ravindranath, Szymanski, Adeyemi-Lindqvist, Thirunavukkarasu, kappa, self-adjoint`,
  one per line.
- **Record two full takes, A then B.** Starting a session clears the previous session's output
  (`client/src/store.ts`), so capture take A's output on screen before starting take B.
  - Take A: glossary empty at Start. Paste the terms while the audio plays, then press Stop at the end.
    The end frame sends the textarea's terms (`client/src/connection.ts`, `endSession`), so the missed-terms
    list compares all ten against captions that were never boosted.
  - Take B: terms in the glossary at Start. Ask both questions during playback, then press Stop.
- The two questions below were not measured on this audio. Try them in a rehearsal take first.
- **Say on camera, in shot 1, that the audio is a constructed test passage you wrote and read.** It is not
  a real lecture, and viewers should hear that from you rather than work it out.

## Shots

| # | Time | On screen | What I say (roughly) |
| --- | --- | --- | --- |
| 1 | 0:00–0:35 | Take A. Empty glossary, Start session, captions rolling. Hold on the line `The n-k Dirac condition holds only when the Rabi-Konath operator is self-adjoint.` Zoom on `n-k Dirac`. | "This is a constructed test passage. I wrote it to be full of names a recogniser won't have seen, and I'm reading it aloud. It's not a real lecture. The name I said is Nkemdirim. The captions say 'n-k Dirac', and 'Ravindranath' became 'Rabi-Konath'. If you're relying on captions, there's nothing here to tell you they're wrong." |
| 2 | 0:35–1:05 | Take B. Paste the ten terms, Start session, and show the chips under "Sent this session". Same audio. Hold on `The Nkemdirim condition holds only when the Ravindranath operator is self-adjoint.` Split screen with shot 1's line if the edit allows. | "Same audio. This time I paste the course glossary before starting, and Lexicon sends it to AssemblyAI as keyterm boosts. Now the names come through as I supplied them. The panel says 'sent', not 'applied', because nothing in the stream confirms the recogniser used them." |
| 3 | 1:05–1:40 | Take B, around 0:45 of audio, while captions still roll. Type **"Which operator has to be self-adjoint for the Nkemdirim condition?"** The answer appears with its quoted evidence. Click the citation: the caption view scrolls back and highlights the line. | "I missed something, so I ask. The answer comes only from the captions so far, with the exact words it relied on. Click the citation and I'm back at that moment in the lecture, so I can check it myself." |
| 4 | 1:40–2:00 | Take B. Type **"When is problem set 4 due?"** The panel shows not found. | "Problem set 4 is mentioned, but its due date never is. So it says so. It won't fill the gap from general knowledge, because I'd have no way to check that by ear." |
| 5 | 2:00–2:40 | Take B, audio finished. Press Stop, then open the output: summary points, each with its "N lines from" anchor. Click one anchor and land in the captions. Scroll to the glossary section. Then cut to take A's glossary section, showing near misses such as "not found as written; possibly 'n-k Dirac'". | "When the lecture ends I get a summary where every point is tied to caption lines, and key terms defined as this lecture used them. It also checks the glossary against what landed. With the boost, the list below is what it found. Without it, this is the report from the first take: Nkemdirim wasn't found as written, possibly 'n-k Dirac', at this time. These are candidates, not verdicts." |
| 6 | 2:40–3:00 | Plain slide or the README's Limitations section. | "What this doesn't do. The boost helped on names the recogniser had never seen. On standard linear-algebra vocabulary I measured no difference, because it already got those right. Answers are grounded in the captions, not verified correct. I haven't measured caption latency. It's English, one microphone, no accounts, and nothing is saved after the session." |

Total: about 3:00. Takes A and B are each about 1:40 of real time, so shots 1 to 5 need jump cuts. Don't speed
up the footage: the captions are the product, and they should be readable at normal speed.

## Things that can go wrong on the take

- **The plain take renders the names differently, or correctly.** Narrate what appears. If the plain take
  gets every name right, the demo's premise fails for that take. Re-record, and don't substitute the fixture.
- **The first question comes back "not found".** The grounding check errs towards refusal. Show it if it
  happens, or re-take.
- **The boosted output's glossary section** will probably say every term was found, as the boosted capture
  rendered all ten. That is expected, and it is why take A's list is cut in.
