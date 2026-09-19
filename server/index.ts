// Lexicon proxy: GET /health, WS /ws, and the P1 gate page.
//
// The AssemblyAI key is read from the environment here and handed to UpstreamSession. It
// is never written to a response, a status message or a log line.

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { ASSEMBLYAI_API_KEY, PORT, TRANSCRIPT_WINDOW_MS } from "./config.ts";
import { healthReport } from "./aai/health.ts";
import { UpstreamSession, normaliseKeyterms, type StatusExtra } from "./aai/session.ts";
import type { ServerMessage, StatusCode } from "./protocol.ts";
import { TranscriptBuffer } from "./transcript/buffer.ts";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/health", (c) => {
  const report = healthReport(ASSEMBLYAI_API_KEY !== "");
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

      onMessage(event) {
        // Client -> server is audio only. The node adapter hands binary frames over as
        // ArrayBuffer; anything textual is a client that has misread the protocol.
        const data = event.data;
        if (typeof data === "string") {
          log("ignoring text frame from client: " + data.slice(0, 120));
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
  if (ASSEMBLYAI_API_KEY === "") console.warn("  ASSEMBLYAI_API_KEY is not set: /ws will refuse connections");
});

injectWebSocket(server);
