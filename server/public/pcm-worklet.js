// Float32 mono -> 16-bit little-endian PCM, emitted in 50 ms blocks.
//
// 50 ms is what the P0 capture script used (1600 bytes at 16 kHz), so the proxy sees the
// same chunk cadence the fixtures were recorded at. No resampling: the page builds the
// AudioContext at 16 kHz and refuses to start if the browser did not honour it, which is
// a clearer failure than silently feeding the recogniser the wrong rate.

const SAMPLES_PER_BLOCK = 800; // 50 ms at 16 kHz

class Pcm16Writer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Int16Array(SAMPLES_PER_BLOCK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.block[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === SAMPLES_PER_BLOCK) {
        const out = this.block.buffer;
        this.port.postMessage(out, [out]);
        this.block = new Int16Array(SAMPLES_PER_BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm16-writer", Pcm16Writer);
