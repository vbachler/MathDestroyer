import { FLOOR, Voice, rnd } from './dsp';
import type { Bus } from './dsp';

/** Level trim of the whole hangar layer (sits under skitter, turret and bite on the fx bus). */
const HANGAR_LEVEL = 0.85;
/** Seconds between events [min, max]. */
const HULL_EVERY: readonly [number, number] = [4, 12];
const THUD_EVERY: readonly [number, number] = [9, 22];
const DRIP_EVERY: readonly [number, number] = [2.5, 7.5];
const SCREECH_EVERY: readonly [number, number] = [28, 55];

/**
 * Hangar ambience for the boarding fight, layered over the battle bed on the music bus: a low,
 * unstable drone of a damaged ship (detuned saws whose pitch wanders, a stuttering mains hum),
 * and irregular events: metal creaks and long hull groans (every 4-12 s), distant heavy thuds
 * on the hull, sparse water drips, and rarely a far alien screech behind the door. Everything
 * (events included) runs through one gain, so `stop` fades all of it; the persistent nodes are
 * disconnected after the fade and event voices clean themselves up (dsp Voice).
 */
export class HangarBed {
  private readonly ctx: BaseAudioContext;
  private readonly bus: Bus;
  private readonly gain: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private stopped = false;

  /** `outer`: the music bus (dry = music gain, wet = its reverb send). */
  constructor(outer: Bus) {
    const ctx = outer.ctx;
    this.ctx = ctx;
    const t = ctx.currentTime + 0.02;
    this.gain = this.keep(ctx.createGain());
    this.gain.gain.setValueAtTime(0, t);
    this.gain.gain.linearRampToValueAtTime(HANGAR_LEVEL, t + 2.5);
    this.gain.connect(outer.dry);
    const wet = this.keep(ctx.createGain());
    wet.gain.setValueAtTime(0, t);
    wet.gain.linearRampToValueAtTime(HANGAR_LEVEL, t + 2.5);
    wet.connect(outer.wet);
    this.bus = { ctx, dry: this.gain, wet, buffers: outer.buffers };
    this.buildDrone();
    for (const s of this.sources) {
      if (s instanceof AudioBufferSourceNode) s.start(t, Math.random() * 3);
      else s.start(t);
    }
    this.every(HULL_EVERY, 0.5, () => (Math.random() < 0.55 ? this.creak() : this.groan()));
    this.every(THUD_EVERY, 0.6, () => this.thud());
    this.every(DRIP_EVERY, 0.4, () => this.drip());
    this.every(SCREECH_EVERY, 0.5, () => this.farScreech());
  }

  /** Fades everything out over `fade` s, then tears the persistent nodes down. Idempotent. */
  stop(fade = 1.2): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.length = 0;
    try {
      const now = this.ctx.currentTime;
      const f = Math.max(0.05, fade);
      for (const n of this.nodes) {
        if (!(n instanceof GainNode) || (n !== this.gain && n !== this.bus.wet)) continue;
        n.gain.cancelScheduledValues(now);
        n.gain.setValueAtTime(n.gain.value, now);
        n.gain.linearRampToValueAtTime(0, now + f);
      }
      for (const s of this.sources) s.stop(now + f + 0.05);
      const first = this.sources[0];
      if (first) {
        first.onended = () => {
          for (const n of this.nodes) {
            try { n.disconnect(); } catch { /* ignore */ }
          }
          this.nodes.length = 0;
          this.sources.length = 0;
        };
      }
    } catch {
      // never let audio break the game
    }
  }

  // ------------------------------------------------------------------ drone

  private keep<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private source<T extends AudioScheduledSourceNode>(n: T): T {
    this.keep(n);
    this.sources.push(n);
    return n;
  }

  private lfo(freq: number, depth: number, target: AudioParam, type: OscillatorType = 'sine'): void {
    const o = this.source(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    const g = this.keep(this.ctx.createGain());
    g.gain.value = depth;
    o.connect(g).connect(target);
  }

  /**
   * Two detuned saws around D1 (36.7 Hz) and a sine a fifth up, under a low-pass that breathes;
   * their pitch wanders (two slow LFOs at unrelated rates, +-14 cents) and the amplitude
   * stutters now and then (a 9 Hz flutter whose depth itself swells), like a failing generator.
   * Over it a thin mains hum (110 Hz square through a 330 Hz band) fading in and out.
   */
  private buildDrone(): void {
    const ctx = this.ctx;
    const lp = this.keep(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    lp.Q.value = 4;
    this.lfo(0.043, 45, lp.frequency);
    const flutter = this.keep(ctx.createGain());
    flutter.gain.value = 0.8;
    lp.connect(flutter).connect(this.gain);
    // Stutter: a 9 Hz triangle into the gain, its depth swelling 0..0.3 over ~17 s.
    const stutter = this.source(ctx.createOscillator());
    stutter.type = 'triangle';
    stutter.frequency.value = 9;
    const stutterDepth = this.keep(ctx.createGain());
    stutterDepth.gain.value = 0.15;
    this.lfo(0.059, 0.15, stutterDepth.gain);
    stutter.connect(stutterDepth).connect(flutter.gain);

    const voices: ReadonlyArray<readonly [number, OscillatorType, number]> = [
      [36.7, 'sawtooth', 0.05], [36.95, 'sawtooth', 0.042], [55.1, 'sine', 0.055],
    ];
    for (const [f, type, level] of voices) {
      const o = this.source(ctx.createOscillator());
      o.type = type;
      o.frequency.value = f;
      this.lfo(rnd(0.05, 0.09), 9, o.detune);
      this.lfo(rnd(0.11, 0.17), 5, o.detune);
      const g = this.keep(ctx.createGain());
      g.gain.value = level;
      o.connect(g).connect(lp);
    }

    const hum = this.source(ctx.createOscillator());
    hum.type = 'square';
    hum.frequency.value = 110;
    this.lfo(0.13, 6, hum.detune);
    const bp = this.keep(ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = 330;
    bp.Q.value = 5;
    const humGain = this.keep(ctx.createGain());
    humGain.gain.value = 0.006;
    this.lfo(0.071, 0.005, humGain.gain);
    hum.connect(bp).connect(humGain).connect(this.gain);
  }

  // ------------------------------------------------------------------ events

  /** Runs `play` at random intervals in [min, max] s (the first after at least `firstFrac` of min). */
  private every([min, max]: readonly [number, number], firstFrac: number, play: () => void, first = true): void {
    if (this.stopped || typeof setTimeout === 'undefined') return;
    const delay = rnd(first ? min * firstFrac : min, max) * 1000;
    const id = setTimeout(() => {
      const i = this.timers.indexOf(id);
      if (i >= 0) this.timers.splice(i, 1);
      if (this.stopped) return;
      const live = !(this.ctx instanceof AudioContext) || this.ctx.state === 'running';
      if (live) {
        try { play(); } catch { /* ignore */ }
      }
      this.every([min, max], firstFrac, play, false);
    }, delay);
    this.timers.push(id);
  }

  /** Metal creak: a saw with stick-slip gating through a narrow, moving band; 0.6-2.2 s. */
  private creak(): void {
    const v = new Voice(this.bus, rnd(0.18, 0.3), 0.7);
    const t = v.t0;
    const dur = rnd(0.6, 2.2);
    const f = rnd(70, 150);
    const saw = v.osc('sawtooth', f, t, t + dur + 0.05);
    saw.frequency.linearRampToValueAtTime(f * rnd(0.75, 1.35), t + dur * rnd(0.3, 0.7));
    saw.frequency.linearRampToValueAtTime(f * rnd(0.6, 1.1), t + dur);
    const gate = v.gain(0.5);
    const slip = v.osc('square', rnd(7, 19), t, t + dur + 0.05);
    slip.frequency.linearRampToValueAtTime(rnd(4, 25), t + dur);
    v.chain(slip, v.gain(0.45), gate.gain);
    const bp = v.filter('bandpass', rnd(350, 900), rnd(5, 9));
    bp.frequency.linearRampToValueAtTime(rnd(300, 1100), t + dur);
    const env = v.gain(0);
    v.env(env.gain, t, dur * rnd(0.15, 0.4), 1, t + dur);
    v.chain(saw, gate, bp, v.filter('lowpass', 1800, 0), env, v.out);
  }

  /** Long hull groan: two detuned saws bending slowly in the low register, vibrato, 2.5-5.5 s. */
  private groan(): void {
    const v = new Voice(this.bus, rnd(0.2, 0.32), 0.9);
    const t = v.t0;
    const dur = rnd(2.5, 5.5);
    const f = rnd(38, 70);
    const lp = v.filter('lowpass', rnd(220, 420), 7);
    lp.frequency.linearRampToValueAtTime(rnd(140, 300), t + dur);
    for (const det of [0, rnd(8, 20)]) {
      const o = v.osc('sawtooth', f, t, t + dur + 0.05);
      o.detune.value = det;
      o.frequency.linearRampToValueAtTime(f * rnd(0.8, 1.25), t + dur * rnd(0.35, 0.65));
      o.frequency.linearRampToValueAtTime(f * rnd(0.65, 1), t + dur);
      v.chain(v.osc('sine', rnd(3, 6), t, t + dur + 0.05), v.gain(rnd(15, 35)), o.detune);
      o.connect(lp);
    }
    const env = v.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + dur * 0.35);
    env.gain.setValueAtTime(1, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
    v.chain(lp, v.shaper(1.6), env, v.out);
  }

  /** Distant heavy thud on the hull (sometimes two): a falling low sine and dull noise, mostly reverb. */
  private thud(): void {
    const v = new Voice(this.bus, rnd(0.35, 0.5), 1.1);
    const hits = Math.random() < 0.3 ? 2 : 1;
    for (let i = 0; i < hits; i++) {
      const t = v.t0 + i * rnd(0.35, 0.6);
      const k = i === 0 ? 1 : rnd(0.6, 0.8);
      const s = v.osc('sine', rnd(55, 70), t, t + 0.7);
      v.sweep(s.frequency, t, rnd(55, 70), 28, t + 0.6);
      const sg = v.gain(0);
      v.env(sg.gain, t, 0.01, 0.8 * k, t + 0.65);
      v.chain(s, sg, v.out);
      const ng = v.gain(0);
      v.env(ng.gain, t, 0.006, 0.6 * k, t + 0.5);
      v.chain(v.noise('brown', t, t + 0.55), v.filter('lowpass', 180, 0.7), ng, v.out);
    }
  }

  /** One water drop: a tiny pitched blip gliding up, very short, wet. */
  private drip(): void {
    const v = new Voice(this.bus, rnd(0.04, 0.08), 1.2);
    const t = v.t0;
    const f = rnd(900, 1700);
    const o = v.osc('sine', f, t, t + 0.09);
    v.sweep(o.frequency, t, f, f * rnd(1.6, 2.2), t + 0.05);
    const g = v.gain(0);
    v.env(g.gain, t, 0.002, 1, t + 0.07);
    v.chain(o, g, v.out);
    if (Math.random() < 0.35) {
      // A second, smaller drop just after.
      const t2 = t + rnd(0.12, 0.3);
      const f2 = f * rnd(0.8, 1.2);
      const o2 = v.osc('sine', f2, t2, t2 + 0.07);
      v.sweep(o2.frequency, t2, f2, f2 * 1.8, t2 + 0.04);
      const g2 = v.gain(0);
      v.env(g2.gain, t2, 0.002, 0.5, t2 + 0.06);
      v.chain(o2, g2, v.out);
    }
  }

  /** Far-off alien screech behind the door: a falling FM wail, band-limited and drowned in reverb. */
  private farScreech(): void {
    const v = new Voice(this.bus, rnd(0.06, 0.1), 1.4);
    const t = v.t0;
    const dur = rnd(1.1, 2);
    const f = rnd(500, 850);
    const car = v.osc('sawtooth', f, t, t + dur + 0.05);
    v.sweep(car.frequency, t, f, f * rnd(0.35, 0.55), t + dur);
    const mod = v.osc('sine', f * 1.37, t, t + dur + 0.05);
    v.chain(mod, v.gain(f * 0.6), car.frequency);
    v.chain(v.osc('triangle', rnd(18, 28), t, t + dur + 0.05), v.gain(70), car.detune);
    const env = v.gain(0);
    v.env(env.gain, t, dur * 0.3, 1, t + dur);
    v.chain(car, v.shaper(2.5), v.filter('bandpass', rnd(800, 1200), 3), v.filter('lowpass', 1500, 0), env, v.out);
  }
}
