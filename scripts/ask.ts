// Ask-layer harness. Loads a capture into a TranscriptBuffer and asks it a question with
// the real model, so the prompt can be tuned against known transcripts before a live run.
//
//   node scripts/ask.ts <fixture> "<question>" [term,term,...] [--dry]
//
// <fixture> is a name under docs/fixtures/ (strang-plain, jargon-boosted, ...) or a path.
// --dry prints the prompt the model would see and exits without calling it. Every
// non-dry run is a paid API call.

import fs from "node:fs";
import path from "node:path";
import type { TurnFrame } from "../server/aai/types.ts";
import { answerQuestion, buildPrompt, type Prompt } from "../server/answer/ask.ts";
import { ANSWER_MODEL, createModelCaller } from "../server/answer/model.ts";
import { OPENAI_API_KEY, TRANSCRIPT_WINDOW_MS } from "../server/config.ts";
import { formatClock } from "../server/protocol.ts";
import { TranscriptBuffer } from "../server/transcript/buffer.ts";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [fixtureArg, question, termsArg] = args.filter((arg) => arg !== "--dry");

if (fixtureArg === undefined || question === undefined) {
  console.error('usage: node scripts/ask.ts <fixture> "<question>" [term,term,...] [--dry]');
  process.exit(2);
}

const file = fs.existsSync(fixtureArg) ? fixtureArg : path.join("docs", "fixtures", fixtureArg + ".jsonl");
const buffer = new TranscriptBuffer(TRANSCRIPT_WINDOW_MS);

for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line) as { received_at: string; message?: { type?: string } };
  if (row.message?.type !== "Turn") continue;
  // One session, offset 0: the harness has no reconnects. buffer.add drops partials.
  buffer.add(row.message as TurnFrame, {
    sessionId: "harness",
    offsetMs: 0,
    sessionSeq: 1,
    fallbackMs: 0,
    receivedAt: Date.parse(row.received_at),
  });
}

const terms = termsArg === undefined ? [] : termsArg.split(",").map((t) => t.trim()).filter(Boolean);
const finals = [...buffer.entries()];
const first = finals[0];
const last = finals[finals.length - 1];
console.log(
  file + ": " + finals.length + " finals" +
    (first && last ? ", " + formatClock(first.startMs) + " to " + formatClock(last.endMs) : "") +
    ", " + terms.length + " glossary terms",
);

if (dry) {
  const prompt = buildPrompt({ question, terms, finals }, finals);
  console.log("--- system\n" + prompt.system + "\n--- user\n" + prompt.user);
  process.exit(0);
}

if (OPENAI_API_KEY === "") {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

const rawCaller = createModelCaller(OPENAI_API_KEY, (usage) => {
  console.log("usage: in " + usage.inputTokens + ", out " + usage.outputTokens + " (reasoning " + usage.reasoningTokens + "), status " + String(usage.status));
});

// Print what the model returned before the grounding check sees it, with the text of
// every line it cited, so a rejection can be read against what was actually offered.
const callModel = async (prompt: Prompt) => {
  const verdict = await rawCaller(prompt);
  console.log("--- raw verdict (model output, before verification)");
  console.log(JSON.stringify(verdict, null, 2));
  for (const n of verdict.cited) {
    const line = finals[n - 1];
    console.log(
      "  cited [" + n + "] " +
        (line ? formatClock(line.startMs) + " to " + formatClock(line.endMs) + ": " + line.text : "(no such line)"),
    );
  }
  return verdict;
};

const started = Date.now();
const result = await answerQuestion({ question, terms, finals }, callModel);
console.log("--- grounding check: " + result.kind + (result.kind === "not_found" ? " (" + result.reason + ")" : ""));
console.log("model " + ANSWER_MODEL + ", " + (Date.now() - started) + " ms");
console.log(JSON.stringify(result, null, 2));
if (result.kind === "answer") {
  console.log(
    "cited " + result.citation.finalIds.join(", ") + " = " +
      formatClock(result.citation.startMs) + " to " + formatClock(result.citation.endMs),
  );
}
