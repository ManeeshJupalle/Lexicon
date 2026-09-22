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
import type { AskMessage, AskResult, EndMessage, FinalMessage, ServerMessage, SessionOutput, StatusCode } from "./protocol.ts";
import { formatClock, parseClientMessage } from "./protocol.ts";
import { answerQuestion, type Prompt } from "./answer/ask.ts";
import { ANSWER_MODEL, AnswerError, createModelCaller, createSessionCallers, type Usage } from "./answer/model.ts";
import { generateSessionOutput } from "./answer/summarize.ts";
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
    // P4. The whole session, never evicted: what the end-of-session output is generated
    // from. The buffer above stays the ask window. Under a megabyte for an hour of speech.
    const fullTranscript: FinalMessage[] = [];
    let session: UpstreamSession | null = null;
    let ended = false;

    const send = (ws: WSContext, message: ServerMessage) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    };

    // P3 answer layer. One model caller per connection so its token usage lands in this
    // connection's log next to the question it belongs to.
    const onUsage = (usage: Usage) => {
      log(
        usage.name + " usage: in " + usage.inputTokens + ", out " + usage.outputTokens +
          " (reasoning " + usage.reasoningTokens + "), status " + String(usage.status),
      );
    };
    const rawCaller = OPENAI_API_KEY === "" ? null : createModelCaller(OPENAI_API_KEY, onUsage);
    const sessionCallers = OPENAI_API_KEY === "" ? null : createSessionCallers(OPENAI_API_KEY, onUsage);
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

    // P4. The session ends here, not at socket close: stop taking audio, let upstream
    // flush its open turn into the transcript, generate, reply. The client closes the
    // socket once it has the reply.
    const handleEnd = async (ws: WSContext, end: EndMessage): Promise<void> => {
      if (ended) {
        log("end frame ignored: session already ended");
        return;
      }
      ended = true;
      const started = Date.now();
      const closing = session;
      session = null; // audio arriving from now on is dropped: there is nothing to send it to
      log("end: " + fullTranscript.length + " finals so far, terminating upstream and waiting for its flush");
      if (closing) await closing.close();
      const finals = [...fullTranscript];
      let output: SessionOutput | null = null;
      let error: { code: AnswerError["code"] | "not_configured"; detail: string } | null = null;
      if (sessionCallers === null) {
        error = { code: "not_configured", detail: "OPENAI_API_KEY is not set on the server" };
      } else {
        try {
          output = await generateSessionOutput(
            { finals, terms: end.terms, boosted: keyterms, model: ANSWER_MODEL },
            sessionCallers,
            // The only record of what grounding refused: dropped items never reach the client.
            (drop) => log("session output dropped " + drop.part + " (" + drop.reason + "): " + drop.text.slice(0, 600)),
          );
        } catch (caught) {
          error = {
            code: caught instanceof AnswerError ? caught.code : "upstream",
            detail: caught instanceof Error ? caught.message : String(caught),
          };
        }
      }
      send(ws, { type: "session_output", endId: end.endId, output, error });
      log(
        "session output over " + finals.length + " finals: " +
          (output
            ? output.summary.length + " summary points, " + output.keyTerms.length + " key terms, " +
              output.glossary.filter((r) => r.status === "near_miss" || r.status === "absent").length + " of " +
              output.glossary.length + " terms missed, dropped " + JSON.stringify(output.dropped) +
              (output.errors.length > 0 ? ", errors " + JSON.stringify(output.errors) : "")
            : "error " + (error?.code ?? "?") + ": " + (error?.detail ?? "")) +
          ", " + (Date.now() - started) + " ms",
      );
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
          onFinal: (message) => {
            fullTranscript.push(message);
            send(ws, message);
          },
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
          const parsed = parseClientMessage(data);
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
            } else if (parsed.endId !== null) {
              send(ws, { type: "session_output", endId: parsed.endId, output: null, error: { code: "bad_request", detail: parsed.detail } });
            }
            return;
          }
          if (parsed.message.type === "ask") void handleAsk(ws, parsed.message);
          else void handleEnd(ws, parsed.message);
          return;
        }
        if (data instanceof ArrayBuffer) {
          session?.sendAudio(Buffer.from(data));
        }
      },

      onClose(event) {
        log("client disconnected " + event.code + " " + event.reason + ", " + buffer.size + " finals held, " + fullTranscript.length + " in the session");
        void session?.close();
        session = null;
      },

      onError(event) {
        log("client socket error: " + String(event.type));
        void session?.close();
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
