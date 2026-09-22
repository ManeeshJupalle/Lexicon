// The one place the answer layer talks to a model provider.
//
// Provider: OpenAI, Responses API with Structured Outputs. Each schema goes up as
// `text.format = { type: "json_schema", strict: true, name, schema }`, built by the SDK's
// zodTextFormat from the same Zod schema the server validates against, so every contract
// is enforced by the provider on the way out and by grounding.ts on the way in. Surface
// and field names checked against developers.openai.com/api/docs/guides/structured-outputs
// and the installed SDK's declarations (node_modules/openai/resources/responses/) on
// 2026-09-21.
//
// Model: gpt-5.6-luna. Current generation; OpenAI's models page describes it as the
// cost-sensitive, high-volume member of the gpt-5.6 family and the one for extraction and
// routine tasks. $0.20 / $1.20 per MTok at the time of writing. Supports Structured
// Outputs and reasoning effort from `none` up. Effort is pinned low: extraction plus a
// grounding decision over a transcript, and in the ask path a student is waiting.
//
// The key is read once in config.ts, like the AssemblyAI key, and never leaves the server.

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { VerdictSchema, type ModelCaller, type Prompt } from "./ask.ts";
import { KeyTermsSchema, ManglesSchema, SummarySchema, type SessionCallers } from "./summarize.ts";

export const ANSWER_MODEL = "gpt-5.6-luna";

/** Tune against docs/data/ask-measurement.md, not by feel. */
const REASONING_EFFORT = "low";

/** Ask path: the verdict is a few hundred tokens; reasoning counts against this too, and
 *  hitting it leaves output_parsed null. */
const ASK_MAX_OUTPUT_TOKENS = 4096;
/** Milliseconds, the SDK's unit. A student is waiting on an ask. */
const ASK_TIMEOUT_MS = 30_000;

/** Session output: a summary or key-term list over a 50-minute lecture runs to a few
 *  thousand tokens, and nobody is mid-lecture any more. */
const SESSION_MAX_OUTPUT_TOKENS = 8192;
const SESSION_TIMEOUT_MS = 120_000;

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
  /** Which structured call: verdict, summary, keyTerms, mangles. */
  name: string;
  inputTokens: number;
  outputTokens: number;
  /** Included in outputTokens; broken out because it is the latency lever. */
  reasoningTokens: number;
  status: string | null;
}

export interface StructuredCallOptions {
  maxOutputTokens: number;
  timeoutMs: number;
}

export type StructuredCall = <T>(name: string, schema: ZodType<T>, prompt: Prompt, options: StructuredCallOptions) => Promise<T>;

export function createStructuredCall(apiKey: string, onUsage?: (usage: Usage) => void): StructuredCall {
  const client = new OpenAI({ apiKey, timeout: ASK_TIMEOUT_MS, maxRetries: 1 });

  return async <T>(name: string, schema: ZodType<T>, prompt: Prompt, options: StructuredCallOptions): Promise<T> => {
    const response = await client.responses
      .parse(
        {
          model: ANSWER_MODEL,
          instructions: prompt.system,
          input: prompt.user,
          text: { format: zodTextFormat(schema, name) },
          reasoning: { effort: REASONING_EFFORT },
          max_output_tokens: options.maxOutputTokens,
          // A live lecture transcript has no business in the provider's stored-response
          // history. Nothing here reads a previous response back.
          store: false,
        },
        { timeout: options.timeoutMs },
      )
      .catch((error: unknown) => {
        throw toAnswerError(error);
      });

    onUsage?.({
      name,
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
    if (response.output_parsed === null || response.output_parsed === undefined) {
      const why = response.incomplete_details?.reason ?? response.status ?? "unknown";
      throw new AnswerError("unparseable", "no parseable " + name + " (" + String(why) + ")");
    }
    // The SDK types output_parsed from the format's inferred type; the schema argument
    // is that type, so this is a restatement rather than a guess.
    return response.output_parsed as T;
  };
}

export function createModelCaller(apiKey: string, onUsage?: (usage: Usage) => void): ModelCaller {
  const call = createStructuredCall(apiKey, onUsage);
  return (prompt) => call("verdict", VerdictSchema, prompt, { maxOutputTokens: ASK_MAX_OUTPUT_TOKENS, timeoutMs: ASK_TIMEOUT_MS });
}

export function createSessionCallers(apiKey: string, onUsage?: (usage: Usage) => void): SessionCallers {
  const call = createStructuredCall(apiKey, onUsage);
  const options: StructuredCallOptions = { maxOutputTokens: SESSION_MAX_OUTPUT_TOKENS, timeoutMs: SESSION_TIMEOUT_MS };
  return {
    summary: (prompt) => call("summary", SummarySchema, prompt, options),
    keyTerms: (prompt) => call("keyTerms", KeyTermsSchema, prompt, options),
    mangles: (prompt) => call("mangles", ManglesSchema, prompt, options),
  };
}

/** Most specific first. All become `upstream` for the client; the detail is what differs,
 *  because what the operator should do about each one differs. */
function toAnswerError(error: unknown): AnswerError {
  if (error instanceof OpenAI.AuthenticationError) return new AnswerError("upstream", "OpenAI rejected the API key");
  if (error instanceof OpenAI.RateLimitError) return new AnswerError("upstream", "OpenAI rate limit; try again in a moment");
  if (error instanceof OpenAI.APIConnectionError) return new AnswerError("upstream", "could not reach OpenAI: " + error.message);
  if (error instanceof OpenAI.APIError) return new AnswerError("upstream", "OpenAI API error " + String(error.status) + ": " + error.message);
  return new AnswerError("upstream", error instanceof Error ? error.message : String(error));
}
