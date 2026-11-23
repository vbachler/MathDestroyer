// Small PCM helpers for tools/render-audio.mjs (stereo = [Float32Array L, Float32Array R]).

/** Peak of a stereo buffer in dBFS. */
export function peakDb(ch) {
  let p = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p > 0 ? 20 * Math.log10(p) : -120;
}

/**
 * Cuts trailing silence: keeps everything up to the last sample above `floorDb`, plus `padSec`,
 * fading the pad to zero (it is far below audibility anyway).
 */
export function trimTail(ch, sr, floorDb = -72, padSec = 0.02) {
  const thr = 10 ** (floorDb / 20);
  let last = 0;
  for (const c of ch) {
    for (let i = c.length - 1; i > last; i--) {
      if (Math.abs(c[i]) > thr) {
        last = i;
        break;
      }
    }
  }
  const pad = Math.round(padSec * sr);
  const len = Math.min(ch[0].length, last + 1 + pad);
  return ch.map((c) => {
    const out = c.slice(0, len);
    for (let i = 0; i < pad && len - 1 - i >= 0; i++) out[len - 1 - i] *= i / pad;
    return out;
  });
}

/**
 * Seamless loop of `len` samples from raw[start ...]: the last `fade` samples cross-fade (linear)
 * into the head, so sample len-1 flows into sample 0 (same scheme as dsp.ts loopable). Needs
 * raw length >= start + len + fade.
 */
export function makeLoop(ch, start, len, fade) {
  return ch.map((raw) => {
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      if (i < len - fade) {
        out[i] = raw[start + i + fade];
      } else {
        const a = (i - (len - fade)) / fade;
        out[i] = raw[start + i + fade] * (1 - a) + raw[start + i - (len - fade)] * a;
      }
    }
    return out;
  });
}

/**
 * Loop length in [minLen, maxLen] whose junction matches best: maximises the normalised correlation
 * of raw[start, start + fade) with raw[start + L, start + L + fade) (the two parts the cross-fade
 * mixes), on a decimated mid signal (the beds' tonal content is all below ~300 Hz).
 */
export function findLoopLength(ch, start, minLen, maxLen, fade, sr) {
  const D = Math.max(1, Math.round(sr / 3000));
  const n = Math.floor(ch[0].length / D);
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += ch[0][i * D + k] + ch[1][i * D + k];
    mid[i] = s / (2 * D);
  }
  const a0 = Math.floor(start / D);
  const w = Math.floor(fade / D);
  let ea = 0;
  for (let i = 0; i < w; i++) ea += mid[a0 + i] * mid[a0 + i];
  let best = minLen;
  let bestScore = -Infinity;
  for (let L = Math.ceil(minLen / D); L <= Math.floor(maxLen / D); L++) {
    let dot = 0;
    let eb = 0;
    for (let i = 0; i < w; i++) {
      const b = mid[a0 + L + i];
      dot += mid[a0 + i] * b;
      eb += b * b;
    }
    const score = dot / Math.sqrt(ea * eb + 1e-30);
    if (score > bestScore) {
      bestScore = score;
      best = L * D;
    }
  }
  return best;
}

/** 16-bit PCM WAV (interleaved, TPDF-dithered). */
export function wav16(ch, sr) {
  const nch = ch.length;
  const n = ch[0].length;
  const data = n * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * nch * 2, 28);
  b.writeUInt16LE(nch * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const d = (Math.random() - Math.random()) / 32768;
      const v = Math.max(-1, Math.min(1, ch[c][i] + d));
      b.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return b;
}
