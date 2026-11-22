import { FLOOR, clamp01 } from './dsp';

/** Smoothing time constant of the tension level, s (rises and releases; ~1.2 s to settle). */
const TAU = 0.4;
/** Scheduler period and look-ahead, s. Notes are placed on the AudioContext clock. */
const TICK_MS = 50;
const LOOKAHEAD = 0.2;
/** The two pulse notes, a semitone apart (A1 and Bb1): the "approach" motif. */
const PULSE_NOTES = [55, 58.27];
/** High cluster: four sines a minor second apart around 1 kHz. */
const CLUSTER = [1000, 1059.5, 1122.5, 1189.2];

/**
 * Adaptive dread layer for the battle ambience. Driven by `setTarget(0..1)` (how close the
 * lowest enemy is to the stations). A fixed set of nodes is built once and reused:
 *
 * - pulse: soft sawtooth alternating 55 / 58.3 Hz through a low-pass, one note per beat;
 *   tempo 50 bpm at tension 0.1 -> 150 bpm at 1.0, silent below ~0.04. The low-pass opens
 *   from ~110 Hz (a dull throb) to ~800 Hz (a growl) as tension rises.
 * - heartbeat: a sine "lub-dub" (75 -> 40 Hz drops) on each beat from tension 0.4 upward.
 * - cluster: four quiet detuned sines (1.0-1.19 kHz), slow tremolo, fading in above 0.6 and
 *   bending up ~70 cents toward 1.0. Very low level: an unease more than a tone.
 * - reverb send opens with tension (the threat fills the space).
 *
 * When tension falls, levels follow with the same ~0.4 s time constant, so the layers release
 * audibly over ~1.2 s instead of cutting off.
 */
export class Tension {
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  private readonly wet: GainNode;
  private readonly pulseOsc: OscillatorNode;
  private readonly pulseLp: BiquadFilterNode;
  private readonly pulseEnv: GainNode;
  private readonly subOsc: OscillatorNode;
  private readonly subEnv: GainNode;
  private readonly cluster: OscillatorNode[];
  private readonly clusterGain: GainNode;
  private readonly trem: OscillatorNode;
  private readonly nodes: AudioNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private target = 0;
  private level = 0;
  private lastTick: number;
  private nextBeat = 0;
  private beat = 0;

  constructor(ctx: BaseAudioContext, dest: AudioNode, reverb: AudioNode) {
    this.ctx = ctx;
    const t = ctx.currentTime;
    this.lastTick = t;
    const keep = <T extends AudioNode>(n: T): T => { this.nodes.push(n); return n; };

    this.out = keep(ctx.createGain());
    this.out.connect(dest);
    this.wet = keep(ctx.createGain());
    this.wet.gain.value = 0.1;
    this.out.connect(this.wet).connect(reverb);

    // Pulse: saw -> resonant-free low-pass -> per-beat envelope.
    this.pulseOsc = keep(ctx.createOscillator());
    this.pulseOsc.type = 'sawtooth';
    this.pulseOsc.frequency.value = PULSE_NOTES[0];
    this.pulseLp = keep(ctx.createBiquadFilter());
    this.pulseLp.type = 'lowpass';
    this.pulseLp.frequency.value = 110;
    this.pulseLp.Q.value = 2;
    this.pulseEnv = keep(ctx.createGain());
    this.pulseEnv.gain.value = 0;
    this.pulseOsc.connect(this.pulseLp).connect(this.pulseEnv).connect(this.out);

    // Heartbeat: sine with a per-thump pitch drop.
    this.subOsc = keep(ctx.createOscillator());
    this.subOsc.frequency.value = 50;
    this.subEnv = keep(ctx.createGain());
    this.subEnv.gain.value = 0;
    this.subOsc.connect(this.subEnv).connect(this.out);

    // Cluster with a slow tremolo (0.7 Hz, +-30 %).
    this.clusterGain = keep(ctx.createGain());
    this.clusterGain.gain.value = 0;
    const tremGain = keep(ctx.createGain());
    tremGain.gain.value = 0.7;
    this.trem = keep(ctx.createOscillator());
    this.trem.frequency.value = 0.7;
    const tremDepth = keep(ctx.createGain());
    tremDepth.gain.value = 0.3;
    this.trem.connect(tremDepth).connect(tremGain.gain);
    this.clusterGain.connect(tremGain).connect(this.out);
    this.cluster = CLUSTER.map((f) => {
      const o = keep(ctx.createOscillator());
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(this.clusterGain);
      return o;
    });

    for (const o of [this.pulseOsc, this.subOsc, this.trem, ...this.cluster]) o.start(t);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  setTarget(level: number): void {
    this.target = Number.isFinite(level) ? clamp01(level) : 0;
  }

  /** Fades out over `fade` s and releases every node. */
  stop(fade = 0.5): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    try {
      const now = this.ctx.currentTime;
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0, now + fade);
      for (const o of [this.pulseOsc, this.subOsc, this.trem, ...this.cluster]) o.stop(now + fade + 0.05);
      this.pulseOsc.onended = () => {
        for (const n of this.nodes) {
          try { n.disconnect(); } catch { /* ignore */ }
        }
        this.nodes.length = 0;
      };
    } catch {
      // ignore
    }
  }

  private tick(): void {
    try {
      const now = this.ctx.currentTime;
      const dt = Math.max(0, now - this.lastTick);
      this.lastTick = now;
      this.level += (this.target - this.level) * (1 - Math.exp(-dt / TAU));
      const lv = this.level;
      const high = clamp01((lv - 0.6) / 0.4);

      // Continuous parameters follow smoothly.
      this.pulseLp.frequency.setTargetAtTime(110 + 700 * lv * lv, now, 0.15);
      this.clusterGain.gain.setTargetAtTime(0.011 * high, now, TAU);
      for (const o of this.cluster) o.detune.setTargetAtTime(70 * high, now, TAU);
      this.wet.gain.setTargetAtTime(0.1 + 0.5 * lv, now, 0.3);

      // Beats, placed ahead on the audio clock.
      if (lv < 0.04) {
        this.nextBeat = now + 0.05;
        return;
      }
      if (this.nextBeat < now) this.nextBeat = now + 0.02;
      while (this.nextBeat < now + LOOKAHEAD) {
        this.scheduleBeat(this.nextBeat, lv);
        const bpm = 50 + 100 * clamp01((lv - 0.1) / 0.9);
        this.nextBeat += 60 / bpm;
      }
    } catch {
      // ignore
    }
  }

  private scheduleBeat(bt: number, lv: number): void {
    const interval = 60 / (50 + 100 * clamp01((lv - 0.1) / 0.9));
    // Pulse note: pitch changes while the envelope is at the floor, so the step is inaudible.
    const note = PULSE_NOTES[this.beat++ % 2];
    this.pulseOsc.frequency.setValueAtTime(note, bt);
    const peak = 0.2 * clamp01(lv / 0.25);
    const pg = this.pulseEnv.gain;
    pg.setValueAtTime(FLOOR, bt);
    pg.linearRampToValueAtTime(Math.max(FLOOR * 2, peak), bt + 0.03);
    pg.exponentialRampToValueAtTime(FLOOR, bt + Math.min(0.55, interval * 0.7));

    // Heartbeat from 0.4 upward: "lub" then a softer "dub" 160 ms later (fits 150 bpm = 0.4 s).
    const amt = 0.3 * clamp01((lv - 0.4) / 0.6);
    if (amt <= 0.005) return;
    const f = this.subOsc.frequency;
    const sg = this.subEnv.gain;
    f.setValueAtTime(75, bt);
    f.exponentialRampToValueAtTime(40, bt + 0.12);
    sg.setValueAtTime(FLOOR, bt);
    sg.linearRampToValueAtTime(amt, bt + 0.008);
    sg.exponentialRampToValueAtTime(FLOOR, bt + 0.14);
    f.setValueAtTime(65, bt + 0.16);
    f.exponentialRampToValueAtTime(38, bt + 0.28);
    sg.setValueAtTime(FLOOR, bt + 0.16);
    sg.linearRampToValueAtTime(amt * 0.6, bt + 0.168);
    sg.exponentialRampToValueAtTime(FLOOR, bt + 0.3);
  }
}
