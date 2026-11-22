/**
 * Low-level building blocks shared by the sound effects, the ambience and the tension layer:
 * generated buffers (noise, reverb impulse response), waveshaper curves and `Voice`, a one-shot
 * container that owns every node it creates and disconnects them all when its last source ends.
 */

/** Gain floor for exponential ramps (-80 dB); exponential ramps can never reach 0. */
export const FLOOR = 0.0001;

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Noise sources every voice can draw from (both loop seamlessly). */
export interface Buffers {
  white: AudioBuffer;
  /** Brown (integrated) noise: dark rumble for booms, hull air and swells. */
  brown: AudioBuffer;
}

/** Where a voice sends its signal: `dry` straight to its bus, `wet` into the shared reverb. */
export interface Bus {
  ctx: BaseAudioContext;
  dry: AudioNode;
  wet: AudioNode;
  buffers: Buffers;
}

// ------------------------------------------------------------------ generated buffers

/**
 * Makes `raw` (length len + fade) loop without a seam: the tail is cross-faded into the head,
 * so sample len-1 flows into sample 0.
 */
function loopable(raw: Float32Array, len: number, fade: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    if (i < len - fade) {
      out[i] = raw[i + fade];
    } else {
      const a = (i - (len - fade)) / fade;
      out[i] = raw[i + fade] * (1 - a) + raw[i - (len - fade)] * a;
    }
  }
  return out;
}

export function makeBuffers(ctx: BaseAudioContext): Buffers {
  const sr = ctx.sampleRate;
  const fade = Math.floor(sr * 0.1);

  const wLen = Math.floor(sr * 2);
  const wRaw = new Float32Array(wLen + fade);
  for (let i = 0; i < wRaw.length; i++) wRaw[i] = Math.random() * 2 - 1;
  const white = ctx.createBuffer(1, wLen, sr);
  white.copyToChannel(loopable(wRaw, wLen, fade), 0);

  // Leaky integrator over white noise (-6 dB/octave), then normalised to a 0.9 peak.
  const bLen = Math.floor(sr * 4);
  const bRaw = new Float32Array(bLen + fade);
  let acc = 0;
  let peak = 0;
  for (let i = 0; i < bRaw.length; i++) {
    acc = (acc + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    bRaw[i] = acc;
    peak = Math.max(peak, Math.abs(acc));
  }
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < bRaw.length; i++) bRaw[i] *= k;
  const brown = ctx.createBuffer(1, bLen, sr);
  brown.copyToChannel(loopable(bRaw, bLen, fade), 0);

  return { white, brown };
}

/**
 * Impulse response for the shared reverb: a huge, cold metal hull. Stereo decaying noise
 * (-60 dB after ~3 s), 18 ms pre-delay, and a two-pole low-pass whose cutoff falls from 3.5 kHz
 * to 450 Hz over the tail, so the reverb gets darker as it dies (no bright hiss in the tail).
 * Each channel is normalised to unit energy, so a send gain of 0.3 reads as "0.3 of the dry level".
 */
export function makeImpulse(ctx: BaseAudioContext, seconds = 3.2): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.018);
  const decay = Math.log(1000) / 3.0; // -60 dB at 3 s
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(len);
    let y1 = 0;
    let y2 = 0;
    let energy = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const fc = 3500 * Math.pow(450 / 3500, t / seconds);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      const x = (Math.random() * 2 - 1) * Math.exp(-decay * t) * Math.min(1, t / 0.025);
      y1 += a * (x - y1);
      y2 += a * (y1 - y2);
      d[i] = y2;
      energy += y2 * y2;
    }
    const k = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let i = 0; i < len; i++) d[i] *= k;
    buf.copyToChannel(d, ch);
  }
  return buf;
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();

/** Soft-clipping tanh curve; `drive` 1 is almost clean, 3-4 is gritty saturation. */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const cached = curves.get(drive);
  if (cached) return cached;
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  curves.set(drive, c);
  return c;
}

// ------------------------------------------------------------------ Voice

/**
 * One sound event. Every node made through it is tracked; when the last scheduled source has
 * ended, everything is disconnected and `onDone` runs, so nothing leaks over a long session.
 * `out` is the voice's own level; it feeds the bus dry and (by `wet`) the reverb.
 */
export class Voice {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  /** The moment the voice was created (+5 ms so the first events are never in the past). */
  readonly t0: number;
  private readonly bus: Bus;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private finished = false;
  private readonly onDone: (() => void) | undefined;

  constructor(bus: Bus, level: number, wet: number, onDone?: () => void) {
    this.bus = bus;
    this.ctx = bus.ctx;
    this.onDone = onDone;
    this.t0 = bus.ctx.currentTime + 0.005;
    this.out = this.gain(level);
    this.out.connect(bus.dry);
    if (wet > 0) this.out.connect(this.gain(wet)).connect(bus.wet);
  }

  /** Extra reverb send for one layer (e.g. a ring that should hang in the hull). Returns the send gain. */
  send(from: AudioNode, amount: number): GainNode {
    const g = this.gain(amount);
    from.connect(g).connect(this.bus.wet);
    return g;
  }

  gain(value = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return this.track(g);
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return this.track(f);
  }

  shaper(drive: number): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = driveCurve(drive);
    s.oversample = '2x';
    return this.track(s);
  }

  osc(type: OscillatorType, freq: number, start: number, stop: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    this.schedule(o, start, stop);
    return o;
  }

  /** Looping noise from a random offset, so no two sounds share the same grain. */
  noise(kind: keyof Buffers, start: number, stop: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    const buf = this.bus.buffers[kind];
    src.buffer = buf;
    src.loop = true;
    this.schedule(src, start, stop, Math.random() * buf.duration * 0.9);
    return src;
  }

  /** Connects a, b, c ... in series; the last item may be an AudioParam (modulation). */
  chain(...items: Array<AudioNode | AudioParam>): void {
    for (let i = 0; i < items.length - 1; i++) {
      const from = items[i];
      const to = items[i + 1];
      if (!(from instanceof AudioNode)) throw new Error('chain: only the last item may be an AudioParam');
      if (to instanceof AudioNode) from.connect(to);
      else from.connect(to);
    }
  }

  /** Linear attack from silence to `peak`, then an exponential decay to the floor at `end`. */
  env(p: AudioParam, t: number, attack: number, peak: number, end: number): void {
    const pk = Math.max(peak, FLOOR * 2);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(pk, t + attack);
    p.exponentialRampToValueAtTime(FLOOR, Math.max(t + attack + 0.005, end));
  }

  /** Exponential glide of a frequency-like param from `from` to `to`, between t and end. */
  sweep(p: AudioParam, t: number, from: number, to: number, end: number): void {
    p.setValueAtTime(from, t);
    p.exponentialRampToValueAtTime(Math.max(0.001, to), end);
  }

  /** A tiny click-free burst on a gain param (debris, crackle, consonants). */
  grain(p: AudioParam, t: number, amp: number, len: number): void {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(amp, t + Math.min(0.002, len / 3));
    p.linearRampToValueAtTime(0, t + len);
  }

  /** Fades the whole voice out from now over `fade` s and stops its sources (used to cut the FTL charge). */
  release(fade: number): void {
    if (this.finished) return;
    const now = this.ctx.currentTime;
    try {
      const g = this.out.gain;
      const current = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(current, now);
      g.linearRampToValueAtTime(0, now + fade);
      for (const s of this.sources) {
        try {
          s.stop(now + fade + 0.02);
        } catch {
          // already ended
        }
      }
    } catch {
      // never let audio break the game
    }
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private schedule(src: AudioScheduledSourceNode, start: number, stop: number, offset?: number): void {
    this.track(src);
    this.sources.push(src);
    this.pending++;
    src.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.finish();
    };
    if (offset !== undefined && src instanceof AudioBufferSourceNode) src.start(start, offset);
    else src.start(start);
    src.stop(Math.max(start + 0.01, stop));
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        // ignore
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    this.onDone?.();
  }
}
