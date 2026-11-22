import { FLOOR, pick, rnd } from './dsp';
import type { Voice } from './dsp';

/**
 * Vowel-like formant targets (F1, F2, F3 in Hz), deliberately skewed away from human vowels
 * and kept inside the radio band (400-2600 Hz) so nothing gets shrill.
 */
const FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [420, 1050, 2250], [560, 880, 2050], [700, 1250, 2400], [380, 1600, 2300],
  [620, 1400, 2150], [480, 760, 1950], [820, 1150, 2500], [450, 1900, 2450],
];

/**
 * Intercepted alien "speech" over a bad radio link, `dur` seconds from `t`, written into voice
 * `v` (whose out level sets the loudness). Every call gets its own phrase rhythm, pitch range,
 * ring-mod ratio and formant subset, so no two transmissions sound alike.
 *
 * Signal path:
 *   glottal saw (70-140 Hz, jumping pitch + 20-30 Hz jitter) -> [dry + ring-modulated by a slow
 *   inharmonic sine: insect-machine sidebands] -> 3 parallel band-pass formants gliding between
 *   random vowel targets every 60-160 ms -> syllable gate (bursts, pauses) + consonant clicks
 *   -> mild tanh grit -> radio band 400-2600 Hz -> out; static noise with squelch clicks at both ends.
 */
export function alienChatter(v: Voice, t: number, dur: number): void {
  const end = t + dur;
  const stop = end + 0.25;

  // --- glottal source: rough low sawtooth with fast random pitch jumps
  const base = rnd(70, 140);
  const range = rnd(1.2, 1.6); // how far the pitch jumps up/down in a phrase
  const src = v.osc('sawtooth', base, t, stop);
  // Jitter: a fast triangle wobbling the pitch by ~40 cents; rough and unstable, not musical.
  const jitter = v.osc('triangle', rnd(19, 31), t, stop);
  v.chain(jitter, v.gain(rnd(25, 50)), src.detune);

  // Ring modulation by a slow inharmonic sine (no carrier left): metallic sidebands at f0 +- fm.
  const ringMix = v.gain(0);
  const ringOsc = v.osc('sine', base * rnd(0.37, 0.61), t, stop);
  ringOsc.connect(ringMix.gain);
  src.connect(ringMix);
  const mix = v.gain(1);
  v.chain(src, v.gain(rnd(0.25, 0.55)), mix);
  v.chain(ringMix, v.gain(0.8), mix);

  // --- formants: three parallel resonant band-passes (F1 strongest)
  const set = [...FORMANTS].sort(() => Math.random() - 0.5).slice(0, 5);
  const shift = rnd(0.88, 1.12); // per-speaker "vocal tract" size
  const fGains = [1, 0.6, 0.3];
  const qs = [rnd(6, 9), rnd(8, 12), rnd(9, 13)];
  const formantOut = v.gain(1);
  const bands = fGains.map((g, i) => {
    const bp = v.filter('bandpass', set[0][i] * shift, qs[i]);
    v.chain(mix, bp, v.gain(g * 2.2), formantOut);
    return bp;
  });

  // --- syllable gate: irregular bursts with short pauses
  const gate = v.gain(0);
  formantOut.connect(gate);
  const g = gate.gain;
  g.setValueAtTime(0, t);
  // Consonants: short band-passed noise ticks at some syllable onsets.
  const cons = v.gain(0);
  const consBp = v.filter('bandpass', 1800, 2.5);
  v.chain(v.noise('white', t, stop), consBp, cons);

  let ts = t + 0.06;
  let pitch = base;
  while (ts < end - 0.05) {
    const syl = rnd(0.06, 0.16);
    if (Math.random() < 0.18) {
      // A pause: the speaker stops for a moment.
      const pause = rnd(0.08, 0.25);
      g.setTargetAtTime(0, ts, 0.015);
      ts += pause;
      continue;
    }
    // New vowel target and a pitch jump; formants glide (time constant ~20 ms), never step.
    const vowel = pick(set);
    bands.forEach((bp, i) => bp.frequency.setTargetAtTime(vowel[i] * shift, ts, 0.02));
    pitch = base * Math.pow(range, rnd(-1, 1));
    src.frequency.setTargetAtTime(pitch, ts, 0.012);
    ringOsc.frequency.setTargetAtTime(pitch * rnd(0.37, 0.61), ts, 0.03);
    // Burst open, then sag toward the end of the syllable.
    g.setTargetAtTime(rnd(0.55, 1), ts, 0.012);
    g.setTargetAtTime(rnd(0.05, 0.3), ts + syl * 0.7, 0.02);
    if (Math.random() < 0.3) {
      consBp.frequency.setValueAtTime(rnd(1200, 2400), ts);
      v.grain(cons.gain, ts, rnd(0.15, 0.35), rnd(0.008, 0.02));
    }
    ts += syl;
  }
  g.setTargetAtTime(0, Math.max(ts, end - 0.04), 0.015);

  // --- radio: grit, then a narrow band (400-2600 Hz, no resonance)
  const radio = v.gain(1);
  v.chain(gate, v.shaper(2.2), radio);
  cons.connect(radio);
  const hp = v.filter('highpass', 400, 0.7);
  const lp = v.filter('lowpass', 2600, 0);
  v.chain(radio, v.gain(0.55), hp, lp, v.out);

  // --- static underneath, with squelch clicks at the start and end of the transmission
  const stat = v.gain(0);
  const statBp = v.filter('bandpass', 1600, 0.6);
  v.chain(v.noise('white', t, stop), statBp, stat, lp);
  const s = stat.gain;
  s.setValueAtTime(0, t);
  s.linearRampToValueAtTime(0.18, t + 0.003);         // squelch open: "tk"
  s.linearRampToValueAtTime(0.05, t + 0.03);          // hiss bed under the voice
  s.setValueAtTime(0.05, end);
  s.linearRampToValueAtTime(0.15, end + 0.004);       // squelch close: "tsk"
  s.exponentialRampToValueAtTime(FLOOR, end + 0.16);
  statBp.frequency.setValueAtTime(1600, end);
  statBp.frequency.exponentialRampToValueAtTime(800, end + 0.15);
}
