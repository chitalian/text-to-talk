import { File, Paths } from 'expo-file-system';
import { createAudioPlayer } from 'expo-audio';

// Kokoro renders at 24 kHz mono.
export const KOKORO_SAMPLE_RATE = 24000;

/**
 * Encode Float32 PCM samples (nominally -1..1) as a 16-bit mono WAV.
 * expo-audio plays files, not raw buffers, so synth output has to land on disk
 * before it can be heard.
 */
export function encodeWav(samples, sampleRate = KOKORO_SAMPLE_RATE) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);

  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  ascii(36, 'data');
  view.setUint32(40, n * 2, true);

  // Clamp before scaling; the model can overshoot 1.0 slightly, and wrapping an
  // out-of-range value turns a loud sample into a nasty click.
  let off = 44;
  for (let i = 0; i < n; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

let fileSeq = 0;
function writeChunk(samples, sampleRate) {
  // Rotate filenames: reusing one path can make the player replay a cached
  // decode of the previous chunk.
  fileSeq = (fileSeq + 1) % 24;
  const file = new File(Paths.cache, `ttt-nat-${fileSeq}.wav`);
  try { if (file.exists) file.delete(); } catch {}
  file.write(encodeWav(samples, sampleRate));
  return file.uri;
}

/**
 * Plays synthesised audio as it arrives. Kokoro emits a sentence in chunks, so
 * queueing them lets speech start on the first chunk instead of after the whole
 * utterance is rendered, which is the difference between a noticeable pause and
 * near-immediate speech.
 */
class StreamPlayer {
  constructor(sampleRate, onDone) {
    this.sampleRate = sampleRate;
    this.onDone = onDone;
    this.queue = [];
    this.player = null;
    this.sub = null;
    this.busy = false;
    this.ended = false;
    this.stopped = false;
  }

  push(samples) {
    if (this.stopped || !samples || !samples.length) return;
    this.queue.push(samples);
    this.pump();
  }

  /** No more chunks are coming; finish what's queued then report done. */
  end() {
    this.ended = true;
    if (!this.busy && !this.queue.length) this.finish();
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.teardown();
  }

  teardown() {
    if (this.sub) { try { this.sub.remove(); } catch {} this.sub = null; }
    if (this.player) {
      try { this.player.pause(); } catch {}
      try { this.player.remove(); } catch {}
      this.player = null;
    }
    this.busy = false;
  }

  finish() {
    if (this.stopped) return;
    this.stopped = true;
    this.teardown();
    if (this.onDone) this.onDone();
  }

  pump() {
    if (this.busy || this.stopped) return;
    const samples = this.queue.shift();
    if (!samples) {
      if (this.ended) this.finish();
      return;
    }
    this.busy = true;

    let uri;
    try {
      uri = writeChunk(samples, this.sampleRate);
    } catch {
      this.busy = false;
      return;
    }

    const player = createAudioPlayer(uri);
    this.player = player;
    this.sub = player.addListener('playbackStatusUpdate', (s) => {
      if (!s || !s.didJustFinish) return;
      try { this.sub.remove(); } catch {}
      this.sub = null;
      try { player.remove(); } catch {}
      if (this.player === player) this.player = null;
      this.busy = false;
      this.pump();
    });
    player.play();
  }
}

let active = null;

/** Begin a new streamed utterance. Any previous one is cancelled. */
export function startStream(onDone, sampleRate = KOKORO_SAMPLE_RATE) {
  stopPlayback();
  active = new StreamPlayer(sampleRate, onDone);
  return active;
}

export function stopPlayback() {
  if (active) { active.stop(); active = null; }
}

/** One-shot playback for the non-streaming fallback path. */
export async function playSamples(samples, onDone, sampleRate = KOKORO_SAMPLE_RATE) {
  const s = startStream(onDone, sampleRate);
  s.push(samples);
  s.end();
  return s;
}
