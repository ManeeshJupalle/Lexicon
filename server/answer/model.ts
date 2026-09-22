// The one place the answer layer talks to a model provider.
//
// Provider: OpenAI, Responses API with Structured Outputs. The verdict schema goes up as
// `text.format = { type: "json_schema", strict: true, name, schema }`, built by the SDK's
// zodTextFormat from the same Zod schema ask.ts validates against, so the
// { found, answer, cited, evidence } contract is enforced by the provider on the way out
// and by ask.ts on the way in. Surface and field names checked against
// developers.openai.com/api/docs/guides/structured-outputs and the installed SDK's
// declarations (node_modules/openai/resources/responses/responses.d.ts) on 2026-09-21.
//
// Model: gpt-5.6-luna. Current generation; OpenAI's models page describes it as the
// cost-sensitive, high-volume member of the gpt-5.6 family and the one for extraction and
// routine tasks. $0.20 / $1.20 per MTok at the time of writing, so a question over a full
// ten-minute window costs about a tenth of a cent. Supports Structured Outputs and
// reasoning effort from `none` up. Effort is pinned low: the task is extraction plus a
// yes/no grounding decision over a few thousand tokens, and a student is waiting. `none`
// is the latency floor to try at the gate if low is still slow.
//
// The key is read once in config.ts, like the AssemblyAI key, and never leaves the server.

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { VerdictSchema, type ModelCaller, type Prompt, type Verdict } from "./ask.ts";

export const ANSWER_MODEL = "gpt-5.6-luna";

/** Tune against docs/data/ask-measurement.md, not by feel. */
const REASONING_EFFORT = "low";

/** A ceiling, not a target. The verdict is a few hundred tokens; reasoning tokens count
 *  against this too, and hitting it leaves output_parsed null. */
const MAX_OUTPUT_TOKENS = 4096;

/** Milliseconds, the SDK's unit. Long enough for the model, short enough that a stuck
 *  request does not leave the panel spinning through the next slide. */
const TIMEOUT_MS = 30_000;

export type AnswerErrorCode = "declined" | "unparseable" | "upstream";

export class AnswerError extends Error {
  readonly code: AnswerErrorCode;

  constructor(code: AnswerErrorCode, message: string) {
    super(message);
    this.name = "AnswerError";
    this.code = code;
  }
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Included in outputTokens; broken out because it is the latency lever. */
  reasoningTokens: number;
  status: string | null;
}

export function createModelCaller(apiKey: string, onUsage?: (usage: Usage) => void): ModelCaller {
  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const format = zodTextFormat(VerdictSchema, "verdict");

  return async (prompt: Prompt): Promise<Verdict> => {
    const response = await client.responses
      .parse({
        model: ANSWER_MODEL,
        instructions: prompt.system,
        input: prompt.user,
        text: { format },
        reasoning: { effort: REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        // A live lecture transcript has no business in the provider's stored-response
        // history. Nothing here reads a previous response back.
        store: false,
      })
      .catch((error: unknown) => {
        throw toAnswerError(error);
      });

    onUsage?.({
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      status: response.status ?? null,
    });

    // A refusal is a content part in place of the JSON, not an exception.
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type === "refusal") throw new AnswerError("declined", part.refusal);
      }
    }
    if (response.output_parsed === null) {
      const why = response.incomplete_details?.reason ?? response.status ?? "unknown";
      throw new AnswerError("unparseable", "no parseable verdict (" + String(why) + ")");
    }
    return response.output_parsed;
  };
}

/** Most specific first. Most become `upstream` for the client; the detail is what
 *  differs, because what the operator should do about each one differs. */
function toAnswerError(error: unknown): AnswerError {
  if (error instanceof OpenAI.AuthenticationError) return new AnswerError("upstream", "OpenAI rejected the API key");
  if (error instanceof OpenAI.RateLimitError) return new AnswerError("upstream", "OpenAI rate limit; try again in a moment");
  if (error instanceof OpenAI.APIConnectionError) return new AnswerError("upstream", "could not reach OpenAI: " + error.message);
  if (error instanceof OpenAI.APIError) return new AnswerError("upstream", "OpenAI API error " + String(error.status) + ": " + error.message);
  return new AnswerError("upstream", error instanceof Error ? error.message : String(error));
}
