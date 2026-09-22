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

import type { AskMessage, EndMessage } from "../../server/protocol.ts";
import { SAMPLE_RATE } from "./constants.ts";
import { parseTerms, useStore } from "./store.ts";

let socket: WebSocket | null = null;
let context: AudioContext | null = null;
let micStream: MediaStream | null = null;

/** Bumped by every stop and every start. A start that is still awaiting the microphone
 *  or the worklet when a stop arrives sees the bump at its next checkpoint, releases what
 *  it created, and goes no further, so Stop during startup cannot leave a mic or socket
 *  alive behind an idle status bar. */
let generation = 0;

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

export function isConnected(): boolean {
  return socket !== null;
}

export async function startSession(terms: string[]): Promise<void> {
  if (socket !== null) return;
  const gen = ++generation;
  const store = useStore.getState();
  store.beginSession(terms);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch (error) {
    if (gen !== generation) return; // stopped meanwhile; the stop already set the status
    store.setLocalError("Microphone not available: " + describe(error));
    store.endSession();
    return;
  }
  if (gen !== generation) {
    // Stop arrived while the permission prompt was up. Release only what this start made.
    stopTracks(stream);
    return;
  }
  micStream = stream;

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  context = ctx;
  if (ctx.sampleRate !== SAMPLE_RATE) {
    // Fail loudly rather than resample. A silent rate mismatch reads as a bad recogniser
    // rather than a bad capture, and that is an expensive hour to spend.
    store.setLocalError(
      "This browser opened audio at " + ctx.sampleRate + " Hz, not " + SAMPLE_RATE + " Hz. Captions would be garbled.",
    );
    await teardown();
    store.endSession();
    return;
  }

  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
  } catch (error) {
    if (gen === generation) {
      store.setLocalError("Could not load the audio worklet: " + describe(error));
      await teardown();
      store.endSession();
    }
    return;
  }
  if (gen !== generation) {
    // Stop arrived while the worklet was loading. The stop's teardown ran before these
    // existed, so release them here, and only them.
    stopTracks(stream);
    void ctx.close();
    if (micStream === stream) micStream = null;
    if (context === ctx) context = null;
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
    const state = useStore.getState();
    if (state.status === "ending" && state.sessionOutput === null && state.outputError === null) {
      state.setOutputError("The connection closed before the session output arrived.");
    }
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

/** How long to wait for the proxy's session output after the end frame. Three model calls
 *  over a long lecture run a few tens of seconds; the proxy's own per-call timeout is
 *  120 s, so this is the outer bound. */
const END_TIMEOUT_MS = 150_000;

/** P4. End the session properly: mic off, tell the proxy, wait for the session output,
 *  then close. The proxy needs the socket open to reply, which is why this is not
 *  stopSession. If the reply never comes the panel is told, and the socket is closed
 *  anyway. */
export async function endSession(): Promise<void> {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    await stopSession();
    return;
  }
  generation += 1;
  const store = useStore.getState();
  await teardown(); // audio stops now; the socket stays up for the reply
  store.setStatus("ending", "generating session output");
  const endId = "end-" + Date.now().toString(36);
  const message: EndMessage = { type: "end", endId, terms: parseTerms(store.glossary.draft) };
  socket.send(JSON.stringify(message));
  const arrived = await waitForSessionOutput(END_TIMEOUT_MS);
  if (!arrived) {
    useStore.getState().setOutputError("The server did not return the session output within " + END_TIMEOUT_MS / 1000 + " s.");
  }
  await stopSession("Session ended");
}

function waitForSessionOutput(timeoutMs: number): Promise<boolean> {
  const done = (state: ReturnType<typeof useStore.getState>) => state.sessionOutput !== null || state.outputError !== null;
  return new Promise((resolve) => {
    if (done(useStore.getState())) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = useStore.subscribe((state) => {
      if (!done(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

export async function stopSession(detail?: string): Promise<void> {
  generation += 1;
  if (socket !== null) {
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, "client stopped");
    socket = null;
  }
  await teardown();
  const store = useStore.getState();
  store.failPendingAsks("The session ended before this was answered.");
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
