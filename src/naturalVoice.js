import { File, Paths } from 'expo-file-system';
import { createAudioPlayer } from 'expo-audio';

// Kokoro renders at 24 kHz mono.
export const KOKORO_SAMPLE_RATE = 24000;

/**
 * Encode Float32 PCM samples (nominally -1..1) as a 16-bit mono WAV.
 * expo-audio plays files, not raw buffers, so the synth output has to land on
 * disk before it can be heard.
 */
export function encodeWav(samples, sampleRate = KOKORO_SAMPLE_RATE) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);

  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);   // chunk size
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM header size
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, 1, true);           // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 2 bytes/sample)
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  ascii(36, 'data');
  view.setUint32(40, n * 2, true);

  // Clamp before scaling; the model can overshoot 1.0 slightly and wrapping
  // an out-of-range value turns a loud sample into a nasty click.
  let off = 44;
  for (let i = 0; i < n; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

let seq = 0;
let current = null;

/** Write the samples to a cache file and play them. Resolves when playback starts. */
export async function playSamples(samples, sampleRate = KOKORO_SAMPLE_RATE) {
  stopPlayback();

  // Alternate filenames: reusing one path can make the player replay a cached
  // decode of the previous utterance.
  seq = (seq + 1) % 8;
  const file = new File(Paths.cache, `ttt-natural-${seq}.wav`);
  try { if (file.exists) file.delete(); } catch {}
  file.write(encodeWav(samples, sampleRate));

  const player = createAudioPlayer(file.uri);
  current = player;
  player.play();
  return player;
}

export function stopPlayback() {
  if (!current) return;
  try { current.pause(); } catch {}
  try { current.remove(); } catch {}
  current = null;
}

/** True once the player has finished, so callers can clear their speaking flag. */
export function onPlaybackEnd(player, cb) {
  if (!player) return () => {};
  const sub = player.addListener('playbackStatusUpdate', (s) => {
    if (s?.didJustFinish) cb();
  });
  return () => { try { sub.remove(); } catch {} };
}
