import { alienChatter } from './chatter';
import { Voice, rnd } from './dsp';
import type { Buffers, Bus } from './dsp';
import { Tension } from './Tension';

export type AmbienceKind = 'battle' | 'menu' | 'map';

/** Trim on the drone and air layers: the bed sits ~20 dB under the effects, felt more than heard. */
const BED_LEVEL = 0.2;

interface BedSpec {
  /** Drone voices: [frequency Hz, waveform, level]. */
  drone: ReadonlyArray<readonly [number, OscillatorType, number]>;
  /** Centre of the drone's slow-moving low-pass, Hz. */
  cutoff: number;
  /** Centre of the band-passed "air" (brown noise) and its level. */
  air: number;
  airLevel: number;
  /** Seconds between distant events [min, max]; null = no events. */
  events: readonly [number, number] | null;
}

/**
 * Bed designs. All drones live in 40-90 Hz with a low-pass around 100-150 Hz, so they are felt
 * more than heard. Battle uses a tritone (E1 + Bb1) for unease; menu a hollow fifth (G1 + D2);
 * the star map a slightly brighter fifth (A1 + E2). The detuned pair beats slowly (~0.2 Hz).
 */
const BEDS: Record<AmbienceKind, BedSpec> = {
  battle: {
    drone: [[41.2, 'sawtooth', 0.12], [41.45, 'sawtooth', 0.1], [58.27, 'sine', 0.16]],
    cutoff: 130, air: 380, airLevel: 0.05, events: [8, 20],
  },
  menu: {
    drone: [[49, 'sawtooth', 0.1], [49.2, 'sawtooth', 0.09], [73.42, 'sine', 0.12]],
    cutoff: 110, air: 300, airLevel: 0.045, events: null,
  },
  map: {
    drone: [[55, 'sawtooth', 0.09], [55.25, 'sawtooth', 0.08], [82.41, 'sine', 0.1]],
    cutoff: 150, air: 520, airLevel: 0.04, events: [18, 35],
  },
};

interface Bed {
  kind: AmbienceKind;
  gain: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  tension: Tension | null;
  eventTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Very quiet, endlessly looping background bed per screen, plus (battle) rare distant events
 * and the adaptive tension layer. Uses about a dozen persistent nodes per bed. Output goes to
 * the music bus, whose level follows the music volume setting (polled, so the Settings slider
 * takes effect live).
 */
export class Ambience {
  private readonly ctx: BaseAudioContext;
  private readonly bus: Bus;
  private readonly music: GainNode;
  private readonly musicWet: GainNode;
  private readonly volume: () => number;
  private current: Bed | null = null;
  private volumeTimer: ReturnType<typeof setInterval> | null = null;
  private lastVolume = -1;

  /** `music` / `musicWet`: the dry and reverb-send gains of the music bus; both follow the music volume. */
  constructor(ctx: BaseAudioContext, music: GainNode, musicWet: GainNode, buffers: Buffers, volume: () => number) {
    this.ctx = ctx;
    this.music = music;
    this.musicWet = musicWet;
    this.volume = volume;
    this.bus = { ctx, dry: music, wet: musicWet, buffers };
  }

  get kind(): AmbienceKind | null {
    return this.current?.kind ?? null;
  }

  /** Starts (or cross-fades to) a bed. Same kind again is a no-op. */
  start(kind: AmbienceKind): void {
    if (this.current?.kind === kind) return;
    this.syncVolume(true);
    if (this.current) this.retire(this.current, 2.5);
    this.current = this.build(kind);
    if (this.volumeTimer === null) this.volumeTimer = setInterval(() => this.syncVolume(false), 400);
  }

  stop(fadeSec = 1.5): void {
    if (this.current) this.retire(this.current, Math.max(0.05, fadeSec));
    this.current = null;
    if (this.volumeTimer !== null) clearInterval(this.volumeTimer);
    this.volumeTimer = null;
  }

  setTension(level: number): void {
    this.current?.tension?.setTarget(level);
  }

  /** One-off distant event on the music bus (e.g. chatter while viewing a hostile planet). */
  chatter(level = 1): void {
    const v = new Voice(this.bus, 0.09 * level, 0.35);
    alienChatter(v, v.t0, rnd(1.2, 2.5));
  }

  // ------------------------------------------------------------------ beds

  private build(kind: AmbienceKind): Bed {
    const spec = BEDS[kind];
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const keep = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
    const source = <T extends AudioScheduledSourceNode>(n: T): T => { keep(n); sources.push(n); return n; };

    // Bed master: slow 3.5 s fade-in, so starting is never a step.
    const gain = keep(ctx.createGain());
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 3.5);
    gain.connect(this.music);

    // Drone: detuned low oscillators through a low-pass whose cutoff breathes (+-45 %) over ~32 s.
    const lp = keep(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = spec.cutoff;
    lp.Q.value = 3;
    lp.connect(gain);
    spec.drone.forEach(([f, type, level], i) => {
      const o = source(ctx.createOscillator());
      o.type = type;
      o.frequency.value = f;
      const g = keep(ctx.createGain());
      g.gain.value = level * BED_LEVEL;
      o.connect(g).connect(lp);
      if (i === 1) {
        // Very slow pitch drift on one voice: the beating speeds up and slows down (~1 min cycle).
        const drift = source(ctx.createOscillator());
        drift.frequency.value = 0.017;
        const depth = keep(ctx.createGain());
        depth.gain.value = 6; // cents
        drift.connect(depth).connect(o.detune);
      }
    });
    const lfo = source(ctx.createOscillator());
    lfo.frequency.value = 0.031;
    const lfoDepth = keep(ctx.createGain());
    lfoDepth.gain.value = spec.cutoff * 0.45;
    lfo.connect(lfoDepth).connect(lp.frequency);

    // Air: looping brown noise in a broad band, swelling in and out (~21 s cycle), a little reverb.
    const air = source(ctx.createBufferSource());
    air.buffer = this.bus.buffers.brown;
    air.loop = true;
    const bp = keep(ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = spec.air;
    bp.Q.value = 0.8;
    const airGain = keep(ctx.createGain());
    airGain.gain.value = spec.airLevel * BED_LEVEL * 0.55;
    const swell = source(ctx.createOscillator());
    swell.frequency.value = 0.047;
    const swellDepth = keep(ctx.createGain());
    swellDepth.gain.value = spec.airLevel * BED_LEVEL * 0.45;
    swell.connect(swellDepth).connect(airGain.gain);
    air.connect(bp).connect(airGain).connect(gain);
    const airWet = keep(ctx.createGain());
    airWet.gain.value = 0.25;
    airGain.connect(airWet).connect(this.bus.wet);

    for (const s of sources) {
      if (s instanceof AudioBufferSourceNode) s.start(t, Math.random() * 3);
      else s.start(t);
    }

    const bed: Bed = {
      kind, gain, nodes, sources, eventTimer: null,
      tension: kind === 'battle' ? new Tension(ctx, gain, this.bus.wet) : null,
    };
    if (spec.events) this.scheduleEvent(bed, spec.events, true);
    return bed;
  }

  /** Fades a bed out and tears it down afterwards. */
  private retire(bed: Bed, fade: number): void {
    if (bed.eventTimer !== null) clearTimeout(bed.eventTimer);
    bed.eventTimer = null;
    bed.tension?.stop(fade);
    try {
      const now = this.ctx.currentTime;
      const g = bed.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
      for (const s of bed.sources) s.stop(now + fade + 0.05);
      const first = bed.sources[0];
      if (first) {
        first.onended = () => {
          for (const n of bed.nodes) {
            try { n.disconnect(); } catch { /* ignore */ }
          }
          bed.nodes.length = 0;
        };
      }
    } catch {
      // ignore
    }
  }

  private syncVolume(immediate: boolean): void {
    const v = Math.min(1, Math.max(0, this.volume()));
    if (v === this.lastVolume) return;
    this.lastVolume = v;
    try {
      const target = v * MUSIC_SCALE;
      for (const g of [this.music.gain, this.musicWet.gain]) {
        if (immediate) g.setValueAtTime(target, this.ctx.currentTime);
        else g.setTargetAtTime(target, this.ctx.currentTime, 0.1);
      }
    } catch {
      // ignore
    }
  }

  // ------------------------------------------------------------------ distant events

  private scheduleEvent(bed: Bed, [min, max]: readonly [number, number], first: boolean): void {
    // The first event comes a little later than the minimum so a scene never opens with one.
    const delay = rnd(first ? min * 0.7 : min, max) * 1000;
    bed.eventTimer = setTimeout(() => {
      if (this.current !== bed) return;
      if (!(this.ctx instanceof AudioContext) || this.ctx.state === 'running') this.playEvent(bed.kind);
      this.scheduleEvent(bed, [min, max], false);
    }, delay);
  }

  private playEvent(kind: AmbienceKind): void {
    try {
      if (kind === 'map') {
        this.sonar();
        return;
      }
      const r = Math.random();
      if (r < 1 / 3) this.chatter(rnd(0.6, 1));
      else if (r < 5 / 9) this.creak();
      else if (r < 7 / 9) this.alienCall();
      else this.sonar();
    } catch {
      // ignore
    }
  }

  /** Far metallic creak: a low saw with stick-slip gating, through a narrow band-pass, mostly reverb. */
  private creak(): void {
    const v = new Voice(this.bus, 0.22, 0.8);
    const t = v.t0;
    const dur = rnd(1.2, 2);
    const f = rnd(55, 85);
    const saw = v.osc('sawtooth', f, t, t + dur + 0.05);
    saw.frequency.linearRampToValueAtTime(f * rnd(0.8, 1.25), t + dur * 0.5);
    saw.frequency.linearRampToValueAtTime(f * rnd(0.7, 1.1), t + dur);
    // Stick-slip: a 9-16 Hz triangle gating the amplitude between 0.1 and 0.9.
    const gate = v.gain(0.5);
    const slip = v.osc('triangle', rnd(9, 16), t, t + dur + 0.05);
    v.chain(slip, v.gain(0.4), gate.gain);
    const bp = v.filter('bandpass', rnd(300, 600), 6);
    const env = v.gain(0);
    v.env(env.gain, t, dur * 0.3, 1, t + dur);
    v.chain(saw, gate, bp, env, v.out);
  }

  /** Faint alien call: a slow FM moan sliding down, far away. */
  private alienCall(): void {
    const v = new Voice(this.bus, 0.1, 0.9);
    const t = v.t0;
    const dur = rnd(1.8, 2.6);
    const f = rnd(240, 340);
    const car = v.osc('sine', f, t, t + dur + 0.05);
    v.sweep(car.frequency, t, f, f * rnd(0.55, 0.7), t + dur);
    const mod = v.osc('sine', f * 0.5, t, t + dur + 0.05);
    v.sweep(mod.frequency, t, f * 0.5, f * 0.3, t + dur);
    const depth = v.gain(f * 0.8);
    v.chain(mod, depth, car.frequency);
    const wobble = v.osc('sine', rnd(4, 6), t, t + dur + 0.05);
    v.chain(wobble, v.gain(30), car.detune);
    const env = v.gain(0);
    v.env(env.gain, t, dur * 0.25, 1, t + dur);
    v.chain(car, v.filter('bandpass', 700, 3), v.filter('lowpass', 2000, 0), env, v.out);
  }

  /** Sonar-like ping: a pure tone with a slight drop, almost all reverb. */
  private sonar(): void {
    const v = new Voice(this.bus, 0.07, 1.1);
    const t = v.t0;
    const f = rnd(700, 950);
    const o = v.osc('sine', f, t, t + 1.7);
    v.sweep(o.frequency, t, f, f * 0.98, t + 1.6);
    const env = v.gain(0);
    v.env(env.gain, t, 0.005, 1, t + 1.6);
    v.chain(o, env, v.out);
  }
}

/** Music bus level at music volume 1 (the beds are mixed well below the effects). */
export const MUSIC_SCALE = 0.6;
