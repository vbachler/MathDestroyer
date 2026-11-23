import { Ambience } from './Ambience';
import type { AmbienceKind } from './Ambience';
import { alienChatter } from './chatter';
import { FLOOR, Voice, makeBuffers, makeImpulse, pick, rnd } from './dsp';
import type { Buffers, Bus } from './dsp';

export type { AmbienceKind } from './Ambience';

type AudioCtor = new () => AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Effects bus level at volume 1. Individual sounds peak around 0.6-0.9 before this. */
const FX_SCALE = 0.7;
/** Simultaneous one-shot voices: above MAX_VOICES only weapons/explosions play; above HARD_MAX nothing. */
const MAX_VOICES = 10;
const HARD_MAX = 16;

/** Voice priority: UI ticks are dropped first, weapons and explosions last. */
const Prio = { Ui: 0, Normal: 1, Weapon: 2 } as const;
type Prio = (typeof Prio)[keyof typeof Prio];

/** Inharmonic partial ratios of a free metal bar: the "hull ring" after each shot. */
const BAR_MODES = [1, 2.76, 5.4];

interface Engine {
  ctx: BaseAudioContext;
  fx: Bus;
}

export interface SfxOptions {
  /** Render into this context instead of creating one (tests: an OfflineAudioContext). */
  context?: BaseAudioContext;
}

/**
 * The game's sound: industrial sci-fi horror, fully synthesised with WebAudio.
 *
 * Graph:
 *   voices -> fxBus (sfx volume) ----------------------------\
 *   voices -> fxWet (sfx volume) -> reverbIn -> HP 120 Hz -> Convolver (3.2 s dark hull IR)
 *   ambience -> musicBus (music volume) ----------------------+-> limiter -> 0.85 -> destination
 *   ambience -> musicWet -> reverbIn                          /
 *                                       Convolver -> return -/
 * The limiter is a DynamicsCompressor set hard (-4 dB, ratio 20, 2 ms attack) so layered
 * explosions never clip; individual sounds are also kept well below full scale.
 *
 * The AudioContext is created lazily (first sound or first gesture) and resumed on the first
 * pointer/key/touch. Every public method is a safe no-op when WebAudio is unavailable, the
 * context is not running yet, or the volume is 0.
 */
export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private engine: Engine | null = null;
  private fxBus: GainNode | null = null;
  private fxWet: GainNode | null = null;
  private ambience: Ambience | null = null;
  private volume: number;
  private musicVolume: () => number;
  private failed = false;
  private readonly injected: BaseAudioContext | null;
  private active = 0;
  private lastLaser = -1;
  private ftlVoice: Voice | null = null;
  private wantedAmbience: AmbienceKind | null = null;
  private tension = 0;
  private wantedHangar = false;

  /**
   * @param volume  effects volume 0..1 (settings.sfxVolume)
   * @param musicVolume  ambience volume 0..1, or a getter (polled, so a live settings change applies)
   */
  constructor(volume = 0.8, musicVolume: number | (() => number) = 0.6, opts: SfxOptions = {}) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.musicVolume = typeof musicVolume === 'function' ? musicVolume : () => musicVolume;
    this.injected = opts.context ?? null;
    if (typeof window !== 'undefined' && !this.injected) {
      const unlock = (): void => {
        const ctx = this.ensure();
        if (ctx instanceof AudioContext && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
        if (ctx && ctx.state === 'running') {
          this.applyAmbience();
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
          window.removeEventListener('touchend', unlock);
        }
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      window.addEventListener('touchend', unlock);
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (!this.ctx || !this.fxBus || !this.fxWet) return;
    try {
      const now = this.ctx.currentTime;
      this.fxBus.gain.setTargetAtTime(this.volume * FX_SCALE, now, 0.02);
      this.fxWet.gain.setTargetAtTime(this.volume * FX_SCALE, now, 0.02);
    } catch {
      // ignore
    }
  }

  getVolume(): number {
    return this.volume;
  }

  /** Sets the ambience (music) volume 0..1; replaces the getter given to the constructor. */
  setMusicVolume(v: number): void {
    const vol = Math.min(1, Math.max(0, v));
    this.musicVolume = () => vol;
  }

  // ================================================================== ambience

  /** Starts (or cross-fades to) a looping background bed. Deferred until audio is unlocked. */
  startAmbience(kind: AmbienceKind): void {
    this.wantedAmbience = kind;
    this.applyAmbience();
  }

  stopAmbience(fadeSec = 1.5): void {
    this.wantedAmbience = null;
    this.tension = 0;
    try {
      this.ambience?.stop(fadeSec);
    } catch {
      // ignore
    }
  }

  /** Battle dread level 0..1 (lowest enemy's approach); smoothed inside. No-op outside battle ambience. */
  setTension(level: number): void {
    this.tension = level;
    this.ambience?.setTension(level);
  }

  /**
   * Boarding hangar ambience (audio/Hangar.ts) layered over the current bed on the music bus:
   * unstable drone, hull creaks and groans, distant thuds, drips, a far screech now and then.
   * Deferred until audio is unlocked, like the beds.
   */
  startHangar(): void {
    this.wantedHangar = true;
    this.applyAmbience();
  }

  /** Fades the hangar layer out (boarding ended, paused or shut down). */
  stopHangar(fadeSec = 1.2): void {
    this.wantedHangar = false;
    try {
      this.ambience?.stopHangar(fadeSec);
    } catch {
      // ignore
    }
  }

  /**
   * A failing strip light crackles: a short burst of sharp electric grains (2.5-7 kHz) over a
   * tiny 100 Hz buzz, 80-160 ms, quiet. The boarding scene rations it (not every flash).
   */
  sparkCrackle(level = 1): void {
    const v = this.begin(Prio.Ui, 0.32 * Math.min(1, Math.max(0, level)), 0.5);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const len = rnd(0.08, 0.16);
      const cr = v.gain(0);
      const bp = v.filter('bandpass', 4000, 3);
      v.chain(v.noise('white', t, t + len + 0.02), bp, v.filter('highpass', 1800, 0.7), cr, v.out);
      for (let s = t; s < t + len;) {
        const g = rnd(0.002, 0.008);
        bp.frequency.setValueAtTime(rnd(2500, 7000), s);
        v.grain(cr.gain, s, rnd(0.2, 0.55), g);
        s += g + rnd(0.004, 0.025);
      }
      const buzz = v.osc('sawtooth', 100, t, t + len + 0.02);
      const bg = v.gain(0);
      v.env(bg.gain, t, 0.004, 0.035, t + len);
      v.chain(buzz, v.filter('bandpass', 600, 2), bg, v.out);
    });
  }

  // ================================================================== weapons

  /**
   * The ship's main guns: a capital-ship energy weapon, not a "pew".
   * Layers: crack (25 ms band-passed noise ~1.9 kHz) / body (detuned saw + square sweeping
   * ~900 -> 90 Hz in 350 ms, tanh grit, resonant low-pass 3.2 kHz -> 160 Hz) / sub thump
   * (56 -> 34 Hz sine, 0.4 s) / ion sizzle (noise band 1.4 kHz -> 450 Hz) / hull ring (three
   * inharmonic sines ~330 / 910 / 1780 Hz, up to 0.9 s, heavy reverb). Loud part ~120 ms;
   * tails overlap quietly when firing several times a second. +-6 % pitch and 0-12 ms jitter per shot.
   */
  laser(): void {
    const t = this.ctxTime();
    const rapid = t >= 0 && this.lastLaser >= 0 && t - this.lastLaser < 0.15;
    const v = this.begin(Prio.Weapon, rapid ? 1.35 : 1.8, 0.28);
    if (!v) return;
    this.lastLaser = v.t0;
    this.safely(() => this.gunBlast(v, v.t0 + rnd(0, 0.012), rnd(0.94, 1.06), true, 1));
  }

  /**
   * The same guns firing into nothing: the blast without the hull ring and with a lighter thump,
   * then the beam's whine climbs away (420 -> ~1150 Hz, vibrato) while its dry level dies and its
   * reverb send grows: the shot vanishes into empty space. A faint hollow air swell remains.
   */
  laserMiss(): void {
    const v = this.begin(Prio.Weapon, 1.5, 0.25);
    if (!v) return;
    this.safely(() => {
      const r = rnd(0.94, 1.06);
      const t = v.t0 + rnd(0, 0.01);
      this.gunBlast(v, t, r, false, 0.7);

      const ws = t + 0.05;
      const we = t + 1.0;
      const whine = v.osc('sawtooth', 420 * r, ws, we + 0.05);
      v.sweep(whine.frequency, ws, 420 * r, 1150 * r, we);
      v.chain(v.osc('sine', 7, ws, we + 0.05), v.gain(18), whine.detune);
      const bp = v.filter('bandpass', 600, 4);
      v.sweep(bp.frequency, ws, 600 * r, 1500 * r, we);
      const lp = v.filter('lowpass', 2600, 0);
      const env = v.gain(0);
      v.env(env.gain, ws, 0.06, 0.32, we);
      v.chain(whine, bp, lp, env);
      // Distance: the dry path fades fast, the reverb send swells.
      const dry = v.gain(1);
      dry.gain.setValueAtTime(1, ws);
      dry.gain.exponentialRampToValueAtTime(0.05, ws + 0.6);
      v.chain(env, dry, v.out);
      const far = v.send(env, 0.3);
      far.gain.setValueAtTime(0.3, ws);
      far.gain.linearRampToValueAtTime(1.1, ws + 0.5);

      // Hollow air afterwards: brown noise in a narrow band around 220 Hz, mostly reverb.
      const air = v.gain(0);
      v.env(air.gain, t + 0.15, 0.3, 0.1, t + 1.3);
      v.chain(v.noise('brown', t + 0.15, t + 1.35), v.filter('bandpass', 220, 2), air, v.out);
      v.send(air, 0.8);
    });
  }

  /**
   * Wrong answer: a low dissonant stab, G2 + G#2 + C#3 (minor second and tritone) on saws through
   * a closing low-pass (900 -> 350 Hz) over a 49 Hz sine. Short (~0.45 s), dark, not a buzzer.
   */
  wrong(): void {
    const v = this.begin(Prio.Normal, 1, 0.35);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const k = rnd(0.97, 1.03);
      const end = t + 0.5;
      const lp = v.filter('lowpass', 900, 4);
      v.sweep(lp.frequency, t, 900, 350, t + 0.4);
      const stab = v.gain(0);
      stab.gain.setValueAtTime(0, t);
      stab.gain.linearRampToValueAtTime(0.13, t + 0.008);
      stab.gain.setValueAtTime(0.13, t + 0.07);
      stab.gain.exponentialRampToValueAtTime(FLOOR, end);
      for (const f of [98, 103.83, 138.59]) v.osc('sawtooth', f * k, t, end + 0.02).connect(lp);
      v.chain(lp, stab, v.out);
      const sub = v.osc('sine', 49 * k, t, end + 0.02);
      sub.frequency.exponentialRampToValueAtTime(46 * k, end);
      const sg = v.gain(0);
      v.env(sg.gain, t, 0.01, 0.22, t + 0.45);
      v.chain(sub, sg, v.out);
    });
  }

  // ================================================================== explosions

  /**
   * Enemy destroyed, heard through the hull: low boom (sine 95 -> 32 Hz + brown noise under a
   * closing low-pass), a debris rattle (short band-passed noise grains, 0.7-3.5 kHz, thinning out),
   * and a brief alien machine shriek (FM on a falling saw carrier through two moving band-pass
   * formants, low-passed at 4.5 kHz, quiet under the boom). Under 0.6 s plus reverb.
   */
  hit(): void {
    const v = this.begin(Prio.Weapon, 1.6, 0.35);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const r = rnd(0.92, 1.08);
      this.boom(v, t, 95 * r, 32, 0.55, 0.6, 900, 0.5);
      this.debris(v, t + 0.02, 0.43, 700, 3500, 1);
      this.shriek(v, t + rnd(0.02, 0.06));
    });
  }

  /**
   * An enemy reached a station: a bigger, darker impact, metal crunch, a groaning hull (two
   * slightly detuned saws bending 72 -> 46 Hz under a 320 Hz low-pass with slow vibrato) and a
   * short two-pulse alarm blip. Their chatter follows ~0.4 s later, faintly, as if reporting the hit.
   */
  miss(): void {
    const v = this.begin(Prio.Weapon, 0.85, 0.4);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const r = rnd(0.94, 1.06);
      this.boom(v, t, 75 * r, 28, 0.8, 0.7, 700, 0.6);
      this.debris(v, t + 0.02, 0.5, 400, 1800, 1.2);

      // Hull groan.
      const gs = t + 0.08;
      const ge = t + 1.4;
      const lp = v.filter('lowpass', 320, 6);
      for (const detune of [0, 12]) {
        const o = v.osc('sawtooth', 72 * r, gs, ge + 0.05);
        o.detune.value = detune;
        v.sweep(o.frequency, gs, 72 * r, 46 * r, ge);
        v.chain(v.osc('sine', 4.5, gs, ge + 0.05), v.gain(25), o.detune);
        o.connect(lp);
      }
      const groan = v.gain(0);
      v.env(groan.gain, gs, 0.15, 0.2, ge);
      v.chain(lp, groan, v.out);

      // Alarm blip: two 70 ms triangle pulses at 620 Hz, soft edges, into the reverb.
      const bs = t + 0.35;
      const blip = v.gain(0);
      const tri = v.osc('triangle', 620, bs, bs + 0.25);
      for (const a of [bs, bs + 0.12]) {
        blip.gain.setValueAtTime(0, a);
        blip.gain.linearRampToValueAtTime(0.09, a + 0.006);
        blip.gain.setValueAtTime(0.09, a + 0.06);
        blip.gain.linearRampToValueAtTime(0, a + 0.07);
      }
      v.chain(tri, v.filter('lowpass', 2000, 0), blip, v.out);
      v.send(blip, 0.5);
    });
    this.later(0.4, () => this.alienChatter(rnd(1, 1.6), 0.45));
  }

  /**
   * Shield absorbed a hit: an electric zap (saw with random 8 ms pitch jumps 70-420 Hz, tanh
   * grit, 1.6 kHz band), crackle grains, a glassy resonant ping (~870 Hz with partials x2.32 and
   * x4.25, ringing up to 1.3 s in the reverb) and a muffled thump of the ship bursting on it.
   */
  shieldBlock(): void {
    const v = this.begin(Prio.Weapon, 1, 0.45);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const zap = v.osc('sawtooth', 110, t, t + 0.2);
      for (let s = t; s < t + 0.16; s += 0.008) zap.frequency.setValueAtTime(rnd(70, 420), s);
      const zg = v.gain(0);
      v.env(zg.gain, t, 0.002, 0.22, t + 0.2);
      v.chain(zap, v.shaper(4), v.filter('bandpass', 1600, 1.5), v.filter('lowpass', 4500, 0), zg, v.out);
      this.debris(v, t, 0.12, 2500, 4000, 0.6);

      const base = rnd(820, 920);
      const ping = v.gain(1);
      [0.07, 0.035, 0.015].forEach((amp, i) => {
        const o = v.osc('sine', base * [1, 2.32, 4.25][i], t + 0.01, t + 1.35);
        const g = v.gain(0);
        v.env(g.gain, t + 0.01, 0.003, amp, t + 0.01 + [1.3, 0.9, 0.5][i]);
        v.chain(o, g, ping);
      });
      ping.connect(v.out);
      v.send(ping, 0.7);

      const thump = v.osc('sine', 120, t, t + 0.3);
      v.sweep(thump.frequency, t, 120, 45, t + 0.25);
      const tg = v.gain(0);
      v.env(tg.gain, t, 0.004, 0.4, t + 0.25);
      v.chain(thump, tg, v.out);
    });
  }

  /**
   * A station is destroyed: a deep, muffled boom heard through the hull (sine 62 -> 22 Hz + brown
   * noise under a 450 Hz low-pass) with a secondary detonation 0.2 s later, then the structure
   * coming apart: metal tearing (saw with random pitch jerks sagging 170 -> ~55 Hz, grit, a
   * band-pass sweeping down), a slow inharmonic hull groan bending flat, a crumbling rattle that
   * thins out over ~1.8 s, and a few distant metal pings left hanging in the reverb. ~2.6 s.
   */
  stationDestroyed(): void {
    const v = this.begin(Prio.Weapon, 1, 0.5);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const r = rnd(0.94, 1.06);
      this.boom(v, t, 62 * r, 22, 1.3, 0.85, 450, 0.8);
      this.boom(v, t + 0.2, 88 * r, 30, 0.5, 0.35, 380, 0.35);

      // Tearing metal.
      const ts = t + 0.12;
      const te = t + 1.9;
      const tear = v.osc('sawtooth', 170 * r, ts, te + 0.05);
      for (let s = ts; s < te - 0.05; s += rnd(0.025, 0.08)) {
        tear.frequency.setValueAtTime(rnd(90, 170) * r * (1 - 0.6 * (s - ts) / (te - ts)), s);
      }
      const tbp = v.filter('bandpass', 900, 2.5);
      v.sweep(tbp.frequency, ts, 900, 260, te);
      const tg = v.gain(0);
      v.env(tg.gain, ts, 0.18, 0.2, te);
      v.chain(tear, v.shaper(3), tbp, v.filter('lowpass', 1300, 2), tg, v.out);
      v.send(tg, 0.4);

      // Hull groan: low inharmonic partials sagging as the frame gives way.
      const groan = v.gain(1);
      [0.08, 0.045, 0.025].forEach((amp, i) => {
        const f = 96 * r * BAR_MODES[i];
        const dec = [2.2, 1.6, 1.1][i];
        const o = v.osc('sine', f, t + 0.05, t + 0.05 + dec + 0.05);
        v.sweep(o.frequency, t + 0.05, f, f * 0.9, t + 0.05 + dec);
        const g = v.gain(0);
        v.env(g.gain, t + 0.05, 0.08, amp, t + 0.05 + dec);
        v.chain(o, g, groan);
      });
      groan.connect(v.out);
      v.send(groan, 0.9);

      // Crumbling debris, darker than a ship's.
      this.debris(v, t + 0.25, 1.8, 300, 1700, 1);

      // Distant pings of loose plates.
      for (let k = 0; k < 3; k++) {
        const s = t + rnd(0.8, 2.3);
        const f = rnd(700, 1500);
        const o = v.osc('sine', f, s, s + 0.5);
        const g = v.gain(0);
        v.env(g.gain, s, 0.002, rnd(0.015, 0.03), s + 0.45);
        v.chain(o, g, v.out);
        v.send(g, 1.2);
      }
    });
  }

  // ================================================================== alerts and comms

  /**
   * Slow, lonely two-tone klaxon: E4 then C4 (a falling major third), each ~0.45 s with soft
   * 60 ms attacks and a slight sag at the end, saw + sub-octave through a 1.2 kHz low-pass,
   * heavy reverb.
   */
  alarm(): void {
    const v = this.begin(Prio.Normal, 0.8, 0.6);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const lp = v.filter('lowpass', 1200, 4);
      const g = v.gain(0);
      const saw = v.osc('sawtooth', 330, t, t + 1.15);
      const low = v.osc('sawtooth', 165, t, t + 1.15);
      const sub = v.gain(0.5);
      low.connect(sub).connect(lp);
      saw.connect(lp);
      [[t, 330], [t + 0.55, 262]].forEach(([s, f]) => {
        for (const [o, k] of [[saw, 1], [low, 0.5]] as const) {
          o.frequency.setValueAtTime(f * k, s);
          o.frequency.setValueAtTime(f * k, s + 0.38);
          o.frequency.exponentialRampToValueAtTime(f * k * 0.975, s + 0.47);
        }
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.1, s + 0.06);
        g.gain.setValueAtTime(0.1, s + 0.37);
        g.gain.linearRampToValueAtTime(0, s + 0.47);
      });
      v.chain(lp, g, v.out);
    });
  }

  /**
   * Incoming call: crackling radio static (noise band 1.7 kHz, high-passed at 350 Hz, amplitude
   * jumping every 12-25 ms with 4 ms ramps), then a squelch tail sweeping down, with a soft
   * ~1 kHz carrier tone underneath.
   */
  radioChirp(): void {
    const v = this.begin(Prio.Normal, 1, 0.2);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const sq = t + 0.28;
      const stat = v.gain(0);
      const bp = v.filter('bandpass', 1700, 0.7);
      v.chain(v.noise('white', t, t + 0.5), bp, v.filter('highpass', 350, 0.7), v.filter('lowpass', 3500, 0), stat, v.out);
      const g = stat.gain;
      g.setValueAtTime(0, t);
      for (let s = t; s < sq; s += rnd(0.012, 0.025)) g.linearRampToValueAtTime(rnd(0.03, 0.14), s + 0.004);
      g.linearRampToValueAtTime(0.16, sq + 0.004);
      g.exponentialRampToValueAtTime(FLOOR, sq + 0.14);
      bp.frequency.setValueAtTime(1700, sq);
      bp.frequency.exponentialRampToValueAtTime(800, sq + 0.12);

      const f = rnd(980, 1060);
      const car = v.osc('sine', f, t + 0.05, t + 0.5);
      const cg = v.gain(0);
      cg.gain.setValueAtTime(0, t + 0.05);
      cg.gain.linearRampToValueAtTime(0.025, t + 0.09);
      cg.gain.setValueAtTime(0.025, t + 0.3);
      cg.gain.exponentialRampToValueAtTime(FLOOR, t + 0.45);
      v.chain(car, cg, v.out);
    });
  }

  /**
   * Intercepted alien radio chatter (see chatter.ts): unintelligible, eerie, quiet.
   * @param durationSec  length of the transmission (default random 1.2-2.5 s)
   * @param level  relative loudness 0..1 (1 = normal, still well under the laser)
   */
  alienChatter(durationSec?: number, level = 1): void {
    const dur = Math.min(6, Math.max(0.4, durationSec ?? rnd(1.2, 2.5)));
    const v = this.begin(Prio.Normal, 0.5 * Math.min(1, Math.max(0, level)), 0.25);
    if (!v) return;
    this.safely(() => alienChatter(v, v.t0, dur));
  }

  // ================================================================== station and UI

  /**
   * Station repaired: a servo (saw 85 -> 150 -> 120 Hz in a 550 Hz band with a 28 Hz gear
   * chatter), a latch clunk, a welding crackle (dense 2-8 ms grains, 2-4.2 kHz), and a quiet
   * power hum rising 110/220 -> 165/330 Hz as systems come back.
   */
  repair(): void {
    const v = this.begin(Prio.Normal, 1, 0.3);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const servo = v.osc('sawtooth', 85, t, t + 0.42);
      servo.frequency.linearRampToValueAtTime(150, t + 0.18);
      servo.frequency.linearRampToValueAtTime(120, t + 0.35);
      const sg = v.gain(0);
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.18, t + 0.02);
      sg.gain.setValueAtTime(0.18, t + 0.3);
      sg.gain.exponentialRampToValueAtTime(FLOOR, t + 0.4);
      v.chain(v.osc('triangle', 28, t, t + 0.42), v.gain(0.06), sg.gain);
      v.chain(servo, v.filter('bandpass', 550, 3), sg, v.out);

      this.clunk(v, t + 0.38, 160, 0.25);

      const weld = v.gain(0);
      const wbp = v.filter('bandpass', 3000, 3);
      v.chain(v.noise('white', t + 0.42, t + 1.0), wbp, v.filter('lowpass', 5000, 0), weld, v.out);
      for (let s = t + 0.42; s < t + 0.95;) {
        const len = rnd(0.002, 0.008);
        wbp.frequency.setValueAtTime(rnd(1800, 3600), s);
        v.grain(weld.gain, s, rnd(0.05, 0.15), len);
        s += len + rnd(0.005, 0.03);
      }

      const hum = v.gain(0);
      v.env(hum.gain, t + 0.4, 0.2, 0.05, t + 1.1);
      for (const f of [110, 220]) {
        const o = v.osc('sine', f, t + 0.4, t + 1.15);
        o.frequency.linearRampToValueAtTime(f * 1.5, t + 1.0);
        o.connect(hum);
      }
      hum.connect(v.out);
    });
  }

  /**
   * Upgrade installed: a heavy clunk-latch (brown-noise thud + 110 -> 55 Hz sine + a latch tick)
   * then a rising power-up hum (detuned saws 55 -> 110 Hz through a low-pass opening
   * 180 -> 1400 Hz, plus a sine octave), swelling for ~0.8 s and dying away.
   */
  upgrade(): void {
    const v = this.begin(Prio.Normal, 1, 0.3);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const thud = v.gain(0);
      v.env(thud.gain, t, 0.002, 0.5, t + 0.08);
      v.chain(v.noise('brown', t, t + 0.1), v.filter('lowpass', 400, 0), thud, v.out);
      this.clunk(v, t, 110, 0.4);
      this.clunk(v, t + 0.07, 0, 0);

      const hs = t + 0.1;
      const he = t + 1.15;
      const lp = v.filter('lowpass', 180, 6);
      v.sweep(lp.frequency, hs, 180, 1400, t + 0.9);
      for (const d of [-8, 8]) {
        const o = v.osc('sawtooth', 55, hs, he + 0.05);
        o.detune.value = d;
        v.sweep(o.frequency, hs, 55, 110, t + 1.0);
        o.connect(lp);
      }
      const oct = v.osc('sine', 110, hs, he + 0.05);
      v.sweep(oct.frequency, hs, 110, 220, t + 1.0);
      const og = v.gain(0.5);
      v.chain(oct, og, lp);
      const hum = v.gain(0);
      hum.gain.setValueAtTime(0, hs);
      hum.gain.linearRampToValueAtTime(0.12, t + 0.8);
      hum.gain.exponentialRampToValueAtTime(FLOOR, he);
      v.chain(lp, hum, v.out);
    });
  }

  /** UI: a soft, dry relay tick (4 ms noise in a 2.4 kHz band + a 150 Hz body). Barely audible. */
  click(): void {
    const v = this.begin(Prio.Ui, 1, 0.04);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const n = v.gain(0);
      v.env(n.gain, t, 0.0008, 0.06, t + 0.012);
      v.chain(v.noise('white', t, t + 0.02), v.filter('bandpass', 2400, 1.5), n, v.out);
      const body = v.gain(0);
      v.env(body.gain, t, 0.001, 0.05, t + 0.02);
      v.chain(v.osc('sine', 150, t, t + 0.03), body, v.out);
    });
  }

  // ================================================================== mission end

  /**
   * Mission won: not a fanfare. A low A-major chord (A2 C#3 E3 A3, triangle + quiet detuned saw)
   * swelling in over ~1 s through a slowly opening then closing low-pass, a 55 Hz floor under it,
   * long reverb. Relief, ~3.4 s.
   */
  win(): void {
    const v = this.begin(Prio.Normal, 0.7, 0.55);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const end = t + 3.4;
      const lp = v.filter('lowpass', 250, 2);
      lp.frequency.setValueAtTime(250, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + 1.2);
      lp.frequency.exponentialRampToValueAtTime(500, t + 3.0);
      for (const f of [110, 138.59, 164.81, 220]) {
        v.chain(v.osc('triangle', f, t, end + 0.05), v.gain(0.25), lp);
        const saw = v.osc('sawtooth', f, t, end + 0.05);
        saw.detune.value = rnd(4, 8);
        v.chain(saw, v.gain(0.1), lp);
      }
      const chord = v.gain(0);
      chord.gain.setValueAtTime(0, t);
      chord.gain.linearRampToValueAtTime(0.3, t + 1.0);
      chord.gain.linearRampToValueAtTime(0.26, t + 2.0);
      chord.gain.exponentialRampToValueAtTime(FLOOR, end);
      v.chain(lp, chord, v.out);
      const sub = v.gain(0);
      sub.gain.setValueAtTime(0, t);
      sub.gain.linearRampToValueAtTime(0.12, t + 1.0);
      sub.gain.exponentialRampToValueAtTime(FLOOR, end);
      v.chain(v.osc('sine', 55, t, end + 0.05), sub, v.out);
    });
  }

  /**
   * Mission lost: a minor cluster (C3 G3 Ab3 Bb3) sinking ~4 semitones over 2.4 s under a
   * closing low-pass, and a dying power-down (saw 240 -> 30 Hz, low-pass 1.5 kHz -> 90 Hz)
   * over a fading sub.
   */
  lose(): void {
    const v = this.begin(Prio.Normal, 0.8, 0.55);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const end = t + 2.8;
      const lp = v.filter('lowpass', 1100, 3);
      v.sweep(lp.frequency, t, 1100, 260, t + 2.6);
      for (const f of [130.81, 196, 207.65, 233.08]) {
        const o = v.osc('triangle', f, t, end + 0.05);
        o.frequency.setValueAtTime(f, t + 0.2);
        o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 2.6);
        v.chain(o, v.gain(0.25), lp);
      }
      const cl = v.gain(0);
      v.env(cl.gain, t, 0.25, 0.3, end);
      v.chain(lp, cl, v.out);

      const pd = v.osc('sawtooth', 240, t, t + 2.65);
      v.sweep(pd.frequency, t, 240, 30, t + 2.4);
      const plp = v.filter('lowpass', 1500, 2);
      v.sweep(plp.frequency, t, 1500, 90, t + 2.4);
      const pg = v.gain(0);
      v.env(pg.gain, t, 0.05, 0.12, t + 2.6);
      v.chain(pd, plp, pg, v.out);
      const sub = v.osc('sine', 60, t, t + 2.05);
      v.sweep(sub.frequency, t, 60, 25, t + 2.0);
      const sg = v.gain(0);
      v.env(sg.gain, t, 0.05, 0.2, t + 2.0);
      v.chain(sub, sg, v.out);
    });
  }

  // ================================================================== FTL

  /**
   * FTL drive spooling up for `durationSec`: detuned saws rising 45 -> 160 Hz through a low-pass
   * opening 200 -> 1500 Hz, with tremolo accelerating 3 -> 24 Hz, plus a thin turbine whine
   * 380 -> 1700 Hz. Grows linearly to the end; `ftlDrop()` cuts it off.
   */
  ftlCharge(durationSec: number): void {
    this.ftlVoice?.release(0.05);
    const v = this.begin(Prio.Weapon, 1, 0.3);
    this.ftlVoice = v;
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const dur = Math.min(10, Math.max(0.3, durationSec));
      const end = t + dur;
      const stop = end + 0.3;
      const lp = v.filter('lowpass', 200, 6);
      v.sweep(lp.frequency, t, 200, 1500, end);
      for (const d of [0, 17]) {
        const o = v.osc('sawtooth', 45, t, stop);
        o.detune.value = d;
        v.sweep(o.frequency, t, 45, 160, end);
        o.connect(lp);
      }
      const trem = v.gain(0.6);
      const lfo = v.osc('sine', 3, t, stop);
      v.sweep(lfo.frequency, t, 3, 24, end);
      v.chain(lfo, v.gain(0.4), trem.gain);
      const charge = v.gain(0);
      charge.gain.setValueAtTime(0, t);
      charge.gain.linearRampToValueAtTime(0.22, end);
      charge.gain.exponentialRampToValueAtTime(FLOOR, end + 0.25);
      v.chain(lp, trem, charge, v.out);

      const whine = v.osc('sine', 380, t, stop);
      v.sweep(whine.frequency, t, 380, 1700, end);
      const wg = v.gain(0);
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.025, end);
      wg.gain.exponentialRampToValueAtTime(FLOOR, end + 0.2);
      v.chain(whine, wg, v.out);
    });
  }

  /**
   * Drop out of FTL: a reversed-reverb-like swell (noise rising exponentially for 0.28 s under an
   * opening low-pass, ending abruptly-but-ramped) into a deep whoomp (sine 85 -> 28 Hz + brown
   * noise under a closing low-pass). Cuts any running `ftlCharge`.
   */
  ftlDrop(): void {
    this.ftlVoice?.release(0.08);
    this.ftlVoice = null;
    const v = this.begin(Prio.Weapon, 0.8, 0.5);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const tb = t + 0.28;
      const swell = v.gain(0);
      swell.gain.setValueAtTime(0.002, t);
      swell.gain.exponentialRampToValueAtTime(0.25, tb);
      swell.gain.linearRampToValueAtTime(0, tb + 0.02);
      const slp = v.filter('lowpass', 300, 1);
      v.sweep(slp.frequency, t, 300, 2500, tb);
      v.chain(v.noise('brown', t, tb + 0.05), slp, swell, v.out);
      v.send(swell, 0.6);
      this.boom(v, tb, 85, 28, 1.0, 0.55, 1000, 0.3);
    });
  }

  // ================================================================== attack and boarding

  /**
   * An enemy ship fires on us: an alien weapon, unlike our guns. A ring-modulated chirp that
   * flicks up (300 -> 1300 Hz in 50 ms; the charge itself is shown, not heard) and snaps down into a
   * gritty zap (saw 1800 -> 120 Hz, tanh, resonant low-pass), with a hiss of ionised air.
   */
  enemyLaser(): void {
    const v = this.begin(Prio.Weapon, 1.3, 0.35);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const r = rnd(0.95, 1.05);
      const rise = t + 0.05;
      const end = rise + 0.45;
      // Charging whine, ring-modulated by an inharmonic sine for an alien edge.
      const whine = v.osc('sawtooth', 300 * r, t, rise + 0.03);
      v.sweep(whine.frequency, t, 300 * r, 1300 * r, rise);
      const ring = v.gain(0);
      v.chain(v.osc('sine', 437 * r, t, rise + 0.03), ring.gain);
      const wg = v.gain(0);
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.exponentialRampToValueAtTime(0.16, rise);
      wg.gain.linearRampToValueAtTime(0, rise + 0.02);
      v.chain(whine, ring, v.filter('bandpass', 1100, 1.2), wg, v.out);

      // The shot: a falling saw through grit and a closing resonant low-pass.
      const zap = v.osc('sawtooth', 1800 * r, rise, end);
      v.sweep(zap.frequency, rise, 1800 * r, 120 * r, end - 0.05);
      const lp = v.filter('lowpass', 5000, 9);
      v.sweep(lp.frequency, rise, 5000, 300, end);
      const zg = v.gain(0);
      v.env(zg.gain, rise, 0.003, 0.3, end);
      v.chain(zap, v.shaper(4), lp, zg, v.out);
      v.send(zg, 0.5);

      const hiss = v.gain(0);
      v.env(hiss.gain, rise, 0.01, 0.12, end + 0.1);
      v.chain(v.noise('white', rise, end + 0.15), v.filter('highpass', 2500, 0.7), hiss, v.out);
    });
  }

  /**
   * Our hull is hit: a heavy, close boom, the ship's metal ringing like a struck bell (low
   * inharmonic partials ~110 Hz, long tail in the reverb), sparks crackling and a groan.
   */
  hullHit(): void {
    const v = this.begin(Prio.Weapon, 1.1, 0.5);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const r = rnd(0.94, 1.06);
      this.boom(v, t, 70 * r, 24, 0.9, 0.8, 1100, 0.75);
      this.debris(v, t + 0.03, 0.6, 1500, 4500, 1.1);
      const bell = v.gain(1);
      [0.09, 0.06, 0.035].forEach((amp, i) => {
        const f = 112 * r * BAR_MODES[i];
        const dec = [1.8, 1.2, 0.8][i];
        const o = v.osc('sine', f, t, t + dec + 0.05);
        v.sweep(o.frequency, t, f, f * 0.96, t + dec);
        const g = v.gain(0);
        v.env(g.gain, t, 0.004, amp, t + dec);
        v.chain(o, g, bell);
      });
      bell.connect(v.out);
      v.send(bell, 0.9);
      const gs = t + 0.1;
      const groan = v.osc('sawtooth', 64 * r, gs, gs + 1.1);
      v.sweep(groan.frequency, gs, 64 * r, 41 * r, gs + 1.0);
      const gg = v.gain(0);
      v.env(gg.gain, gs, 0.2, 0.16, gs + 1.05);
      v.chain(groan, v.filter('lowpass', 300, 5), gg, v.out);
    });
  }

  /**
   * Hull breached: a fast, frantic two-tone alarm (square + saw, 880 / 660 Hz, 6 pulses through
   * a 1.6 kHz low-pass), under it the roar of venting air (noise swelling through an opening
   * band) and metal tearing (saw bending 150 -> 60 Hz with random pitch jerks). About 2.2 s.
   */
  breachAlarm(): void {
    const v = this.begin(Prio.Weapon, 1, 0.45);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const end = t + 2.2;
      const lp = v.filter('lowpass', 1600, 3);
      const ag = v.gain(0);
      const sq = v.osc('square', 880, t, end);
      const sw = v.osc('sawtooth', 440, t, end);
      v.chain(sq, v.gain(0.4), lp);
      v.chain(sw, v.gain(0.6), lp);
      for (let i = 0; i < 6; i++) {
        const s = t + i * 0.3;
        const f = i % 2 === 0 ? 880 : 660;
        sq.frequency.setValueAtTime(f, s);
        sw.frequency.setValueAtTime(f / 2, s);
        ag.gain.setValueAtTime(0, s);
        ag.gain.linearRampToValueAtTime(0.1, s + 0.01);
        ag.gain.setValueAtTime(0.1, s + 0.22);
        ag.gain.linearRampToValueAtTime(0, s + 0.26);
      }
      v.chain(lp, ag, v.out);

      const vent = v.gain(0);
      vent.gain.setValueAtTime(0.0001, t);
      vent.gain.exponentialRampToValueAtTime(0.3, t + 0.5);
      vent.gain.exponentialRampToValueAtTime(FLOOR, end);
      const vbp = v.filter('bandpass', 400, 0.8);
      v.sweep(vbp.frequency, t, 400, 2200, t + 0.6);
      v.chain(v.noise('white', t, end + 0.05), vbp, vent, v.out);
      v.send(vent, 0.5);

      const tear = v.osc('sawtooth', 150, t, t + 1.3);
      for (let s = t; s < t + 1.2; s += rnd(0.03, 0.09)) tear.frequency.setValueAtTime(rnd(60, 150) * (1 - (s - t) / 2.4), s);
      const tg = v.gain(0);
      v.env(tg.gain, t, 0.05, 0.22, t + 1.25);
      v.chain(tear, v.shaper(3), v.filter('lowpass', 900, 6), tg, v.out);
    });
  }

  /**
   * Legs on the deck plates: a short run of hard chitin clicks (2-6 ms noise grains, 2-6 kHz)
   * over soft thumps. The boarding scene calls it repeatedly; `level` 0..1 follows the nearest
   * crawler (louder, denser, drier as it closes in).
   */
  skitter(level: number): void {
    const lv = Math.min(1, Math.max(0, level));
    if (lv < 0.03) return;
    const v = this.begin(Prio.Ui, 0.25 + 0.75 * lv, 0.45 * (1 - lv) + 0.08);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const len = 0.2;
      const clicks = v.gain(0);
      const bp = v.filter('bandpass', 3500, 4);
      v.chain(v.noise('white', t, t + len + 0.03), bp, v.filter('lowpass', 2500 + 4000 * lv, 0), clicks, v.out);
      const n = Math.round(4 + 8 * lv);
      for (let i = 0; i < n; i++) {
        const s = t + rnd(0, len);
        bp.frequency.setValueAtTime(rnd(2000, 6000), s);
        v.grain(clicks.gain, s, rnd(0.15, 0.4), rnd(0.002, 0.006));
      }
      const thump = v.gain(0);
      v.chain(v.noise('brown', t, t + len + 0.03), v.filter('lowpass', 220, 0), thump, v.out);
      for (let s = t; s < t + len; s += rnd(0.05, 0.09)) v.grain(thump.gain, s, rnd(0.2, 0.4) * lv, 0.03);
    });
  }

  /**
   * A crawler screams: a longer, rawer version of the machine shriek (two detuned FM voices,
   * strong grit, formants sliding down), 0.5-0.8 s. `level` 0..1.
   */
  screech(level = 1): void {
    const v = this.begin(Prio.Normal, 0.75 * Math.min(1, Math.max(0, level)), 0.5);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      const dur = rnd(0.5, 0.8);
      const end = t + dur;
      const f0 = rnd(700, 1100);
      const shr = v.gain(0);
      v.env(shr.gain, t, 0.04, 0.22, end);
      for (const det of [1, 1.07]) {
        const car = v.osc('sawtooth', f0 * det, t, end + 0.05);
        v.sweep(car.frequency, t, f0 * det, f0 * det * rnd(0.35, 0.5), end);
        const mod = v.osc('sine', f0 * 1.41 * det, t, end + 0.05);
        const depth = v.gain(f0 * 0.8);
        v.chain(mod, depth, car.frequency);
        v.chain(v.osc('triangle', rnd(23, 37), t, end + 0.05), v.gain(80), car.detune);
        car.connect(shr);
      }
      const bp = v.filter('bandpass', 1600, 3);
      v.sweep(bp.frequency, t, rnd(1500, 2200), rnd(500, 800), end);
      v.chain(shr, v.shaper(3), bp, v.filter('lowpass', 4200, 0), v.out);
    });
  }

  /**
   * The hangar guns: lighter and quicker than the ship's main guns, two barrels a few ms apart.
   * Each: a crack, a short body (saw 1400 -> 160 Hz in 0.14 s, grit, closing low-pass) and a thump.
   */
  turretShot(): void {
    const v = this.begin(Prio.Weapon, 1.2, 0.25);
    if (!v) return;
    this.safely(() => {
      for (const [dt, r] of [[0, rnd(0.96, 1.04)], [rnd(0.012, 0.025), rnd(0.9, 0.96)]] as const) {
        const t = v.t0 + dt;
        const crack = v.gain(0);
        v.env(crack.gain, t, 0.001, 0.35, t + 0.03);
        v.chain(v.noise('white', t, t + 0.04), v.filter('bandpass', 2600 * r, 0.9), crack, v.out);
        const saw = v.osc('sawtooth', 1400 * r, t, t + 0.2);
        v.sweep(saw.frequency, t, 1400 * r, 160 * r, t + 0.14);
        const lp = v.filter('lowpass', 4000, 6);
        v.sweep(lp.frequency, t, 4000, 300, t + 0.16);
        const body = v.gain(0);
        v.env(body.gain, t, 0.002, 0.2, t + 0.18);
        v.chain(saw, v.shaper(2.5), lp, body, v.out);
        const sub = v.osc('sine', 90 * r, t, t + 0.16);
        v.sweep(sub.frequency, t, 90 * r, 45, t + 0.14);
        const sg = v.gain(0);
        v.env(sg.gain, t, 0.004, 0.3, t + 0.15);
        v.chain(sub, sg, v.out);
      }
    });
  }

  /**
   * A crawler gets us: a screech cut short by a wet crunch (dense low noise grains 150-900 Hz
   * under a closing low-pass), a body thump and a ringing in the ears (quiet 3.1 kHz sine).
   */
  bite(): void {
    const v = this.begin(Prio.Weapon, 1.2, 0.35);
    if (!v) return;
    this.safely(() => {
      const t = v.t0;
      this.shriek(v, t);
      const c = t + 0.12;
      const crunch = v.gain(0);
      const bp = v.filter('bandpass', 500, 2);
      const lp = v.filter('lowpass', 2500, 1);
      v.sweep(lp.frequency, c, 2500, 400, c + 0.4);
      v.chain(v.noise('brown', c, c + 0.45), bp, lp, crunch, v.out);
      for (let s = c; s < c + 0.38;) {
        const len = rnd(0.01, 0.035);
        bp.frequency.setValueAtTime(rnd(150, 900), s);
        v.grain(crunch.gain, s, rnd(0.5, 1.0) * (1 - (s - c) / 0.45), len);
        s += len + rnd(0.002, 0.02);
      }
      this.boom(v, c, 90, 30, 0.45, 0.8, 600, 0.5);
      const ring = v.osc('sine', 3100, c + 0.05, c + 1.6);
      const rg = v.gain(0);
      v.env(rg.gain, c + 0.05, 0.1, 0.018, c + 1.55);
      v.chain(ring, rg, v.out);
    });
  }

  // ================================================================== layers

  /**
   * One gun shot (shared by laser and laserMiss). `r` = pitch factor, `ring` = hull ring,
   * `weight` scales the sub thump.
   */
  private gunBlast(v: Voice, t: number, r: number, ring: boolean, weight: number): void {
    // 1. Crack: 25 ms of band-passed noise, the instant of discharge.
    const crack = v.gain(0);
    v.env(crack.gain, t, 0.001, 0.45, t + 0.035);
    v.chain(v.noise('white', t, t + 0.05), v.filter('bandpass', 1900 * r, 0.8), crack, v.out);

    // 2. Body: saw + square (detuned 10-18 cents) diving 900 -> 90 Hz, saturated, then a resonant
    //    low-pass diving 3.2 kHz -> 160 Hz, so the grit darkens as it falls.
    const end = t + 0.5;
    const drive = v.shaper(3);
    const sawG = v.gain(0.55);
    const sqG = v.gain(0.22);
    const saw = v.osc('sawtooth', 900 * r, t, end);
    const sq = v.osc('square', 900 * r, t, end);
    sq.detune.value = rnd(10, 18);
    for (const o of [saw, sq]) v.sweep(o.frequency, t, 900 * r, 90 * r, t + 0.35);
    v.chain(saw, sawG, drive);
    v.chain(sq, sqG, drive);
    const lp = v.filter('lowpass', 3200 * r, 8);
    v.sweep(lp.frequency, t, 3200 * r, 160, t + 0.38);
    const body = v.gain(0);
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(0.3, t + 0.004);
    body.gain.exponentialRampToValueAtTime(0.09, t + 0.11);
    body.gain.exponentialRampToValueAtTime(FLOOR, t + 0.45);
    v.chain(drive, lp, body, v.out);

    // 3. Sub thump: the weight of it, 56 -> 34 Hz.
    const sub = v.osc('sine', 56 * r, t, t + 0.45);
    v.sweep(sub.frequency, t, 56 * r, 34, t + 0.4);
    const sg = v.gain(0);
    v.env(sg.gain, t, 0.006, 0.5 * weight, t + 0.42);
    v.chain(sub, sg, v.out);

    // Ion sizzle: a quiet band of noise falling with the body.
    const siz = v.gain(0);
    const sbp = v.filter('bandpass', 1400 * r, 1.2);
    v.sweep(sbp.frequency, t, 1400 * r, 450, t + 0.3);
    v.env(siz.gain, t, 0.01, 0.07, t + 0.3);
    v.chain(v.noise('white', t, t + 0.32), sbp, siz, v.out);

    // 4. Hull ring: three inharmonic partials, sagging 2 % as the metal flexes; mostly reverb.
    if (!ring) return;
    const rs = t + 0.01;
    const base = 330 * r;
    const bus = v.gain(1);
    [0.05, 0.03, 0.018].forEach((amp, i) => {
      const f = base * BAR_MODES[i];
      const dec = [0.9, 0.6, 0.4][i];
      const o = v.osc('sine', f, rs, rs + dec + 0.05);
      v.sweep(o.frequency, rs, f, f * 0.98, rs + dec);
      const g = v.gain(0);
      v.env(g.gain, rs, 0.003, amp, rs + dec);
      v.chain(o, g, bus);
    });
    bus.connect(v.out);
    v.send(bus, 0.6);
  }

  /** Low boom: a falling sine plus brown noise under a closing low-pass. */
  private boom(v: Voice, t: number, from: number, to: number, dur: number, peak: number, lpFrom: number, noisePeak: number): void {
    const s = v.osc('sine', from, t, t + dur + 0.05);
    v.sweep(s.frequency, t, from, to, t + dur * 0.9);
    const sg = v.gain(0);
    v.env(sg.gain, t, 0.004, peak, t + dur);
    v.chain(s, sg, v.out);
    const lp = v.filter('lowpass', lpFrom, 0);
    v.sweep(lp.frequency, t, lpFrom, 100, t + dur * 0.9);
    const ng = v.gain(0);
    v.env(ng.gain, t, 0.003, noisePeak, t + dur * 1.1);
    v.chain(v.noise('brown', t, t + dur * 1.1 + 0.05), lp, ng, v.out);
  }

  /**
   * Debris rattle: one noise source, one band-pass retuned per grain, one gain carrying
   * a sequence of 6-30 ms grains that thin out over `len` s.
   */
  private debris(v: Voice, t: number, len: number, fLo: number, fHi: number, level: number): void {
    const g = v.gain(0);
    const bp = v.filter('bandpass', (fLo + fHi) / 2, 5);
    v.chain(v.noise('white', t, t + len + 0.05), bp, v.filter('lowpass', 5000, 0), g, v.out);
    for (let s = t; s < t + len;) {
      const p = (s - t) / len;
      const glen = rnd(0.006, 0.03);
      bp.frequency.setValueAtTime(rnd(fLo, fHi), s);
      v.grain(g.gain, s, rnd(0.1, 0.35) * (1 - p) * level, glen);
      s += glen + rnd(0.005, 0.05) * (1 + p * 4);
    }
  }

  /**
   * Alien machine shriek, different every time: a saw carrier falling ~1.1-1.6 kHz -> a quarter
   * to a third of that, frequency-modulated at an inharmonic ratio with shrinking depth, with a
   * 17-31 Hz stutter on its pitch, through two band-pass formants that slide down, low-passed at
   * 4.5 kHz so it never gets shrill. Quiet, 0.32-0.45 s.
   */
  private shriek(v: Voice, t: number): void {
    const dur = rnd(0.32, 0.45);
    const end = t + dur;
    const f0 = rnd(1100, 1600);
    const f1 = f0 * rnd(0.22, 0.38);
    const ratio = pick([1.41, 1.73, 2.13, 0.71]);
    const car = v.osc('sawtooth', f0, t, end + 0.05);
    v.sweep(car.frequency, t, f0, f1, end);
    const mod = v.osc('sine', f0 * ratio, t, end + 0.05);
    v.sweep(mod.frequency, t, f0 * ratio, f1 * ratio, end);
    const depth = v.gain(0);
    v.sweep(depth.gain, t, f0 * 0.9, f1 * 0.3, end);
    v.chain(mod, depth, car.frequency);
    v.chain(v.osc('triangle', rnd(17, 31), t, end + 0.05), v.gain(60), car.detune);

    const shr = v.gain(0);
    v.env(shr.gain, t, 0.02, 0.3, end);
    const bp1 = v.filter('bandpass', 2000, 7);
    v.sweep(bp1.frequency, t, rnd(1500, 2400), rnd(600, 900), end);
    const bp2 = v.filter('bandpass', 1000, 5);
    v.sweep(bp2.frequency, t, rnd(800, 1200), rnd(400, 600), end);
    car.connect(bp1).connect(shr);
    car.connect(bp2).connect(shr);
    v.chain(shr, v.filter('lowpass', 4500, 0), v.out);
  }

  /** Mechanical clunk: a short falling sine (skipped when `freq` is 0) and a latch tick. */
  private clunk(v: Voice, t: number, freq: number, peak: number): void {
    if (freq > 0) {
      const o = v.osc('sine', freq, t, t + 0.1);
      v.sweep(o.frequency, t, freq, freq * 0.45, t + 0.08);
      const g = v.gain(0);
      v.env(g.gain, t, 0.003, peak, t + 0.09);
      v.chain(o, g, v.out);
    }
    const tick = v.gain(0);
    v.grain(tick.gain, t, 0.18, 0.012);
    v.chain(v.noise('white', t, t + 0.02), v.filter('bandpass', 1800, 2), tick, v.out);
  }

  // ================================================================== engine

  /** Current audio time, or -1 when there is no context. */
  private ctxTime(): number {
    return this.ctx ? this.ctx.currentTime : -1;
  }

  private ensure(): BaseAudioContext | null {
    if (this.ctx || this.failed) return this.ctx;
    try {
      let ctx: BaseAudioContext;
      if (this.injected) {
        ctx = this.injected;
      } else {
        const Ctor = audioCtor();
        if (!Ctor) {
          this.failed = true;
          return null;
        }
        ctx = new Ctor();
      }
      this.build(ctx);
      if (ctx instanceof AudioContext) ctx.addEventListener('statechange', () => this.applyAmbience());
    } catch {
      this.failed = true;
      this.ctx = null;
      this.engine = null;
    }
    return this.ctx;
  }

  private build(ctx: BaseAudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    const post = ctx.createGain();
    post.gain.value = 0.85;
    limiter.connect(post).connect(ctx.destination);

    // Shared reverb: high-passed input (no sub mud in the tail) into a dark 3.2 s hull IR.
    const reverbIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = makeImpulse(ctx);
    const ret = ctx.createGain();
    ret.gain.value = 0.8;
    reverbIn.connect(hp).connect(conv).connect(ret).connect(limiter);

    const fxBus = ctx.createGain();
    fxBus.gain.value = this.volume * FX_SCALE;
    fxBus.connect(limiter);
    const fxWet = ctx.createGain();
    fxWet.gain.value = this.volume * FX_SCALE;
    fxWet.connect(reverbIn);

    const music = ctx.createGain();
    music.gain.value = 0;
    music.connect(limiter);
    // Reverb send of the ambience; its level follows the music volume too (set by Ambience).
    const musicWet = ctx.createGain();
    musicWet.gain.value = 0;
    musicWet.connect(reverbIn);

    const buffers: Buffers = makeBuffers(ctx);
    this.ctx = ctx;
    this.fxBus = fxBus;
    this.fxWet = fxWet;
    this.engine = { ctx, fx: { ctx, dry: fxBus, wet: fxWet, buffers } };
    this.ambience = new Ambience(ctx, music, musicWet, buffers, () => this.musicVolume());
  }

  private running(ctx: BaseAudioContext): boolean {
    if (ctx === this.injected) return true; // offline rendering: always schedule
    if (ctx.state === 'running') return true;
    if (ctx instanceof AudioContext && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return false;
  }

  /** Brings the ambience in line with what scenes asked for, once audio is running. */
  private applyAmbience(): void {
    try {
      // A real context is only created by a gesture or a sound; an injected (offline) one at once.
      const ctx = this.injected ? this.ensure() : this.ctx;
      if (!ctx || !this.ambience || !this.running(ctx)) return;
      if (this.wantedAmbience) {
        this.ambience.start(this.wantedAmbience);
        this.ambience.setTension(this.tension);
      } else if (this.ambience.kind) {
        this.ambience.stop(1.5);
      }
      if (this.wantedHangar) this.ambience.startHangar();
    } catch {
      // ignore
    }
  }

  /**
   * Opens a one-shot voice, or returns null (no audio, not running, muted, or too many voices).
   * Above MAX_VOICES only weapon-priority sounds start; above HARD_MAX nothing does.
   */
  private begin(prio: Prio, level: number, wet: number): Voice | null {
    if (this.volume <= 0) return null;
    const ctx = this.ensure();
    if (!ctx || !this.engine || !this.running(ctx)) return null;
    if (this.active >= HARD_MAX || (this.active >= MAX_VOICES && prio < Prio.Weapon)) return null;
    try {
      const v = new Voice(this.engine.fx, level, wet, () => { this.active--; });
      this.active++;
      return v;
    } catch {
      return null;
    }
  }

  /** Runs a sound builder; audio failures must never break the game. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // ignore
    }
  }

  private later(sec: number, fn: () => void): void {
    if (typeof window === 'undefined' || this.injected) return;
    window.setTimeout(() => this.safely(fn), sec * 1000);
  }
}
