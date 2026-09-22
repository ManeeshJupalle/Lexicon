// Session-output harness. Loads a capture into finals and generates the end-of-session
// output with the real model, printing the verdicts, the grounded result and the
// Markdown, so the prompts can be tuned against known transcripts before a live run.
//
//   node scripts/summarize.ts <fixture> [term,term,...] [--boosted term,term] [--dry]
//
// <fixture> is a name under docs/fixtures/ (strang-plain, jargon-plain, ...) or a path.
// --dry prints the three prompts and the deterministic term report and exits without
// calling the model. Every non-dry run is three paid API calls.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { TurnFrame } from "../server/aai/types.ts";
import { toMarkdown } from "../server/answer/markdown.ts";
import { ANSWER_MODEL, createSessionCallers } from "../server/answer/model.ts";
import {
  buildKeyTermsPrompt,
  buildManglesPrompt,
  buildSummaryPrompt,
  generateSessionOutput,
  type SessionCallers,
} from "../server/answer/summarize.ts";
import { analyseTerms } from "../server/answer/terms.ts";
import { OPENAI_API_KEY } from "../server/config.ts";
import { formatClock } from "../server/protocol.ts";
import { TranscriptBuffer } from "../server/transcript/buffer.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    boosted: { type: "string", default: "" },
    dry: { type: "boolean", default: false },
    /** Comma-separated subset of summary,keyTerms,mangles to actually call; the rest
     *  return empty, so one part can be re-run for the price of one call. */
    only: { type: "string", default: "summary,keyTerms,mangles" },
  },
});
const parts = new Set(args.only.split(",").map((p) => p.trim()));
const [fixtureArg, termsArg] = positionals;
if (fixtureArg === undefined) {
  console.error("usage: node scripts/summarize.ts <fixture> [term,term,...] [--boosted term,term] [--dry]");
  process.exit(2);
}

const file = fs.existsSync(fixtureArg) ? fixtureArg : path.join("docs", "fixtures", fixtureArg + ".jsonl");
// A window long enough to hold any capture whole: this is the full transcript, not the
// ask window.
const buffer = new TranscriptBuffer(24 * 60 * 60_000);
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line) as { received_at: string; message?: { type?: string } };
  if (row.message?.type !== "Turn") continue;
  buffer.add(row.message as TurnFrame, { sessionId: "harness", offsetMs: 0, sessionSeq: 1, fallbackMs: 0, receivedAt: Date.parse(row.received_at) });
}
const finals = [...buffer.entries()];
const split = (s: string | undefined) => (s ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const terms = split(termsArg);
const boosted = split(args.boosted);
const first = finals[0];
const last = finals[finals.length - 1];
console.log(
  file + ": " + finals.length + " finals" +
    (first && last ? ", " + formatClock(first.startMs) + " to " + formatClock(last.endMs) : "") +
    ", " + terms.length + " glossary terms (" + boosted.length + " boosted)",
);

const report = analyseTerms(terms, boosted, finals);
console.log("--- term report (deterministic)");
for (const r of report) {
  console.log(
    "  " + r.term + ": " + r.status + (r.occurrences > 0 ? " x" + r.occurrences + " " + JSON.stringify(r.forms) : "") +
      r.candidates.map((c) => " | " + JSON.stringify(c.text) + " " + formatClock(c.startMs) + " sim " + String(c.similarity)).join(""),
  );
}

if (args.dry) {
  const unfound = report.filter((r) => r.status === "near_miss" || r.status === "absent");
  for (const [name, prompt] of [
    ["summary", buildSummaryPrompt(finals, terms)],
    ["keyTerms", buildKeyTermsPrompt(finals, terms)],
    ["mangles", buildManglesPrompt(finals, unfound)],
  ] as const) {
    console.log("--- " + name + " system\n" + prompt.system + "\n--- " + name + " user (" + prompt.user.length + " chars)\n" + prompt.user.slice(0, 600) + "\n...");
  }
  process.exit(0);
}

if (OPENAI_API_KEY === "") {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

const raw = createSessionCallers(OPENAI_API_KEY, (usage) => {
  console.log(
    "usage " + usage.name + ": in " + usage.inputTokens + ", out " + usage.outputTokens +
      " (reasoning " + usage.reasoningTokens + "), status " + String(usage.status),
  );
});

// Print each model result before grounding, so a dropped item can be read against what
// the model actually said.
const callers: SessionCallers = {
  summary: async (p) => {
    if (!parts.has("summary")) return { points: [] };
    const v = await raw.summary(p);
    console.log("--- raw summary\n" + JSON.stringify(v, null, 2));
    return v;
  },
  keyTerms: async (p) => {
    if (!parts.has("keyTerms")) return { terms: [] };
    const v = await raw.keyTerms(p);
    console.log("--- raw key terms\n" + JSON.stringify(v, null, 2));
    return v;
  },
  mangles: async (p) => {
    if (!parts.has("mangles")) return { suggestions: [] };
    console.log("--- mangles prompt, term list\n" + p.user.split("\n\n")[0]);
    const v = await raw.mangles(p);
    console.log("--- raw mangle suggestions\n" + JSON.stringify(v, null, 2));
    return v;
  },
};

const started = Date.now();
const output = await generateSessionOutput({ finals, terms, boosted, model: ANSWER_MODEL }, callers);
console.log("--- grounded output (" + (Date.now() - started) + " ms wall, " + output.elapsedMs + " ms in generate)");
console.log(JSON.stringify({ ...output, glossary: undefined }, null, 2));
console.log("--- markdown\n" + toMarkdown(output));
