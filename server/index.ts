// Lexicon proxy: GET /health, WS /ws, and the P1 gate page.
//
// The AssemblyAI key is read from the environment here and handed to UpstreamSession; the
// OpenAI key likewise, to the answer layer. Neither is ever written to a response, a
// status message or a log line.

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { OPENAI_API_KEY, ASSEMBLYAI_API_KEY, PORT, TRANSCRIPT_WINDOW_MS } from "./config.ts";
import { healthReport } from "./aai/health.ts";
import { UpstreamSession, normaliseKeyterms, type StatusExtra } from "./aai/session.ts";
import type { AskMessage, AskResult, ServerMessage, StatusCode } from "./protocol.ts";
import { formatClock, parseAskMessage } from "./protocol.ts";
import { answerQuestion, type Prompt } from "./answer/ask.ts";
import { ANSWER_MODEL, AnswerError, createModelCaller } from "./answer/model.ts";
import { TranscriptBuffer } from "./transcript/buffer.ts";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/health", (c) => {
  const report = healthReport(ASSEMBLYAI_API_KEY !== "", OPENAI_API_KEY !== "");
  return c.json(report, report.ok ? 200 : 503);
});

let connectionSeq = 0;

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const id = ++connectionSeq;
    // P2 replaces this with the glossary panel. Until then a comma-separated list on the
    // query string is enough to exercise keyterms end to end through the real proxy.
    const keyterms = normaliseKeyterms(c.req.query("keyterms"));
    const log = (line: string) => console.log("[ws " + id + "] " + line);

    // The buffer is created per client connection and outlives every upstream session
    // opened beneath it. That is what "reconnect preserves the buffer" means here.
    const buffer = new TranscriptBuffer(TRANSCRIPT_WINDOW_MS);
    let session: UpstreamSession | null = null;

    const send = (ws: WSContext, message: ServerMessage) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    };

    // P3 answer layer. One model caller per connection so its token usage lands in this
    // connection's log next to the question it belongs to.
    const rawCaller =
      OPENAI_API_KEY === ""
        ? null
        : createModelCaller(OPENAI_API_KEY, (usage) => {
            log(
              "answer usage: in " + usage.inputTokens + ", out " + usage.outputTokens +
                " (reasoning " + usage.reasoningTokens + "), status " + String(usage.status),
            );
          });
    // The verdict as the model returned it, before the grounding check. A rejected verdict
    // never reaches the client, so this log line is the only record of what was rejected
    // and why; without it a not_found(evidence_not_verbatim) cannot be explained.
    const callModel =
      rawCaller === null
        ? null
        : async (prompt: Prompt) => {
            const verdict = await rawCaller(prompt);
            log("answer verdict: " + JSON.stringify(verdict).slice(0, 600));
            return verdict;
          };

    const handleAsk = async (ws: WSContext, ask: AskMessage): Promise<void> => {
      const started = Date.now();
      const held = buffer.size;
      let result: AskResult;
      if (callModel === null) {
        result = { kind: "error", error: "not_configured", detail: "OPENAI_API_KEY is not set on the server" };
      } else {
        try {
          result = await answerQuestion({ question: ask.question, terms: ask.terms, finals: buffer.entries() }, callModel);
        } catch (error) {
          result = {
            kind: "error",
            error: error instanceof AnswerError ? error.code : "upstream",
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const elapsedMs = Date.now() - started;
      send(ws, { type: "answer", askId: ask.askId, result, elapsedMs });
      log("ask " + JSON.stringify(ask.question.slice(0, 80)) + " over " + held + " finals: " + describeResult(result) + ", " + elapsedMs + " ms");
    };

    return {
      onOpen(_event, ws) {
        log("client connected" + (keyterms.length > 0 ? ", keyterms: " + keyterms.join(", ") : ""));

        if (ASSEMBLYAI_API_KEY === "") {
          send(ws, { type: "status", code: "not_configured", detail: "ASSEMBLYAI_API_KEY is not set on the server" });
          ws.close(1011, "upstream not configured");
          return;
        }

        const status = (code: StatusCode, detail: string, extra?: StatusExtra) => {
          log(code + ": " + detail);
          send(ws, { type: "status", code, detail, ...extra });
        };

        session = new UpstreamSession({
          apiKey: ASSEMBLYAI_API_KEY,
          keyterms,
          buffer,
          onStatus: status,
          onPartial: (message) => send(ws, message),
          onFinal: (message) => send(ws, message),
          log,
        });
        session.start();
      },

      onMessage(event, ws) {
        // Client -> server is audio, plus one JSON text frame: a question (protocol.ts,
        // AskMessage). The node adapter hands binary frames over as ArrayBuffer; any other
        // text is a client that has misread the protocol.
        const data = event.data;
        if (typeof data === "string") {
          const parsed = parseAskMessage(data);
          if (!parsed.ok) {
            log("bad text frame from client (" + parsed.detail + "): " + data.slice(0, 120));
            // A frame that at least named itself is told, so the panel does not wait forever.
            if (parsed.askId !== null) {
              send(ws, {
                type: "answer",
                askId: parsed.askId,
                elapsedMs: 0,
                result: { kind: "error", error: "bad_request", detail: parsed.detail },
              });
            }
            return;
          }
          void handleAsk(ws, parsed.ask);
          return;
        }
        if (data instanceof ArrayBuffer) {
          session?.sendAudio(Buffer.from(data));
        }
      },

      onClose(event) {
        log("client disconnected " + event.code + " " + event.reason + ", " + buffer.size + " finals held");
        session?.close();
        session = null;
      },

      onError(event) {
        log("client socket error: " + String(event.type));
        session?.close();
        session = null;
      },
    };
  }),
);

// The gate page. Registered last so it cannot shadow /health or /ws.
app.use("/*", serveStatic({ root: "./server/public" }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log("lexicon proxy on http://localhost:" + info.port);
  console.log("  gate page  http://localhost:" + info.port + "/");
  console.log("  health     http://localhost:" + info.port + "/health");
  console.log("  transcript window " + Math.round(TRANSCRIPT_WINDOW_MS / 1000) + " s");
  console.log("  answer layer " + (OPENAI_API_KEY === "" ? "not configured: OPENAI_API_KEY unset, questions get a typed error" : ANSWER_MODEL));
  if (ASSEMBLYAI_API_KEY === "") console.warn("  ASSEMBLYAI_API_KEY is not set: /ws will refuse connections");
});

injectWebSocket(server);

function describeResult(result: AskResult): string {
  switch (result.kind) {
    case "answer":
      return (
        "answer citing " + result.citation.finalIds.length + " lines, " +
        formatClock(result.citation.startMs) + " to " + formatClock(result.citation.endMs)
      );
    case "not_found":
      return "not_found (" + result.reason + ")";
    case "error":
      return "error " + result.error + ": " + result.detail;
  }
}
