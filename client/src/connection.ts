// WebSocket and microphone. Deliberately outside React.
//
// The audio worklet posts a 1600-byte PCM block every 50 ms. Those blocks go straight from
// the worklet port to the socket and never enter the store, so twenty times a second the
// React tree does nothing at all. Only the three ServerMessage types cross into state.
//
// The capture pipeline is the one proven at the P1 gate (server/public/index.html): mono
// getUserMedia, an AudioContext pinned to 16 kHz that refuses to run at any other rate,
// and the pcm16-writer worklet. Chunk size matches the P0 capture script, so the proxy
// sees the cadence the fixtures were recorded at.

import type { AskMessage } from "../../server/protocol.ts";
import { SAMPLE_RATE } from "./constants.ts";
import { parseTerms, useStore } from "./store.ts";

let socket: WebSocket | null = null;
let context: AudioContext | null = null;
let micStream: MediaStream | null = null;

export function isConnected(): boolean {
  return socket !== null;
}

export async function startSession(terms: string[]): Promise<void> {
  if (socket !== null) return;
  const store = useStore.getState();
  store.beginSession(terms);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch (error) {
    store.setLocalError("Microphone not available: " + describe(error));
    store.endSession();
    return;
  }

  context = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (context.sampleRate !== SAMPLE_RATE) {
    // Fail loudly rather than resample. A silent rate mismatch reads as a bad recogniser
    // rather than a bad capture, and that is an expensive hour to spend.
    store.setLocalError(
      "This browser opened audio at " + context.sampleRate + " Hz, not " + SAMPLE_RATE + " Hz. Captions would be garbled.",
    );
    await teardown();
    store.endSession();
    return;
  }

  try {
    await context.audioWorklet.addModule("/pcm-worklet.js");
  } catch (error) {
    store.setLocalError("Could not load the audio worklet: " + describe(error));
    await teardown();
    store.endSession();
    return;
  }

  const query = terms.length > 0 ? "?keyterms=" + encodeURIComponent(terms.join(",")) : "";
  const scheme = location.protocol === "https:" ? "wss://" : "ws://";
  socket = new WebSocket(scheme + location.host + "/ws" + query);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    if (context === null || micStream === null) return;
    const source = context.createMediaStreamSource(micStream);
    const writer = new AudioWorkletNode(context, "pcm16-writer");
    writer.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
    // A worklet is only pulled when something downstream of it reaches the destination,
    // so route it there through a muted gain node. Without this it never runs.
    const mute = new GainNode(context, { gain: 0 });
    source.connect(writer).connect(mute).connect(context.destination);
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    useStore.getState().applyServerMessage(JSON.parse(event.data));
  };

  // Detached in stopSession before a deliberate close, so tearing down from the UI does
  // not re-enter here through the close event it causes.
  socket.onclose = (event) => {
    void stopSession(event.reason === "" ? "Connection closed (" + event.code + ")" : event.reason);
  };

  socket.onerror = () => {
    useStore.getState().setLocalError("The connection to the caption server failed.");
  };
}

let askSeq = 0;

/** Send a question up the open socket. The glossary goes with it as the client holds it
 *  now, applied and pending alike (protocol.ts, AskMessage.terms). False when there is no
 *  open socket, which includes a fixture replay: the panel says so rather than waiting. */
export function askQuestion(question: string): boolean {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
  askSeq += 1;
  const askId = "ask-" + Date.now().toString(36) + "-" + askSeq;
  const terms = parseTerms(useStore.getState().glossary.draft);
  const message: AskMessage = { type: "ask", askId, question, terms };
  socket.send(JSON.stringify(message));
  useStore.getState().addAsk({ askId, question, askedAt: Date.now(), result: null, elapsedMs: null });
  return true;
}

export async function stopSession(detail?: string): Promise<void> {
  if (socket !== null) {
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "client stopped");
    socket = null;
  }
  await teardown();
  const store = useStore.getState();
  store.endSession();
  if (detail !== undefined) store.setStatus("idle", detail);
}

async function teardown(): Promise<void> {
  micStream?.getTracks().forEach((track) => track.stop());
  micStream = null;
  if (context !== null) {
    await context.close();
    context = null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
