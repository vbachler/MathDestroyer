// Renders the game's WebAudio synth (src/audio/*.ts) offline into audio files for the Godot port.
// Usage: npm run audio:render              (all)
//        npm run audio:render -- laser hit   (only these names; the manifest is merged)
//        npm run audio:render -- --wav       (one-shots as 16-bit WAV instead of Ogg Vorbis)
//
// The real Sfx.ts runs in Node on node-web-audio-api's OfflineAudioContext (Sfx accepts { context }),
// so every sound goes through the same graph as in the browser: voice -> fx bus / reverb send ->
// 3.2 s hull convolver -> limiter (DynamicsCompressor, with its make-up gain) -> 0.85 -> out.
//
// Output (godot/assets/audio/):
//   sfx/<name>_<n>.ogg        one-shots, 48 kHz stereo, trailing silence trimmed (reverb tail kept).
//                             Ogg Vorbis q6 by default: as 16-bit WAV (--wav) the set is ~100 MB.
//   ambience/<name>.ogg       seamless loops (beds, hangar drone, tension levels), Ogg Vorbis
//   manifest.json             name -> files, gain, priority, bus, voice_sec, params
// See godot/PORT.md "Audio (as built)".

import { registerHooks } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as wa from 'node-web-audio-api';
import { createOggEncoder } from 'wasm-media-encoders';
import { makeLoop, findLoopLength, trimTail, wav16, peakDb } from './audio-util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'godot', 'assets', 'audio');
const SR = 48000;
/** Effects are rendered at the default settings.sfxVolume; sfx.gd scales the SFX bus by volume / SFX_VOL. */
const SFX_VOL = 0.8;
/** Music-bus sounds are rendered at music volume 1; sfx.gd scales the Music bus by the music volume. */
const MUSIC_VOL = 1;
/** HangarBed's HANGAR_LEVEL (src/audio/Hangar.ts, not exported). */
const HANGAR_LEVEL = 0.85;
/** Vorbis quality (-1..10): loops (quiet, slow) and one-shots (transients). */
const OGG_QUALITY = 4;
const OGG_QUALITY_SFX = 6;

// ------------------------------------------------------------------ load the TS synth in Node

// Extensionless relative imports inside src/ ('./dsp') -> './dsp.ts'; Node strips the types.
registerHooks({
  resolve(spec, ctx, next) {
    if (/^\.\.?\//.test(spec) && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) {
      try {
        return next(`${spec}.ts`, ctx);
      } catch {
        // fall through
      }
    }
    return next(spec, ctx);
  },
});
// The synth uses `instanceof AudioNode / AudioContext / GainNode ...`: expose the node classes globally.
for (const [k, v] of Object.entries(wa)) {
  if (k !== 'default' && typeof v === 'function' && !(k in globalThis)) globalThis[k] = v;
}
const src = (f) => import(pathToFileURL(path.join(ROOT, 'src', 'audio', f)).href);
const { Sfx } = await src('Sfx.ts');
const { Voice } = await src('dsp.ts');
const { HangarBed } = await src('Hangar.ts');
const { Tension } = await src('Tension.ts');

// Voice length (until its last source stops: what the TS counts as an active voice).
let rec = null;
const schedule = Voice.prototype.schedule;
Voice.prototype.schedule = function (s, start, stop, offset) {
  if (rec) rec.maxStop = Math.max(rec.maxStop, Math.max(start + 0.01, stop));
  return schedule.call(this, s, start, stop, offset);
};

/** Runs synth code with timers stubbed: events, volume polls and tension ticks are driven here instead. */
function quiet(fn) {
  const st = globalThis.setTimeout;
  const si = globalThis.setInterval;
  globalThis.setTimeout = () => 0;
  globalThis.setInterval = () => 0;
  try {
    return fn();
  } finally {
    globalThis.setTimeout = st;
    globalThis.setInterval = si;
  }
}

/** Renders `fn(sfx, ctx)` for `seconds` through the full Sfx graph. */
async function render(seconds, fn) {
  const ctx = new wa.OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const sfx = new Sfx(SFX_VOL, MUSIC_VOL, { context: ctx });
  rec = { maxStop: 0 };
  quiet(() => {
    sfx.ensure();
    fn(sfx, ctx);
  });
  const voiceSec = rec.maxStop;
  rec = null;
  const buf = await ctx.startRendering();
  return { ch: [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()], voiceSec };
}

const rnd = (a, b) => a + Math.random() * (b - a);
/** Music-bus voices (ambience events) need the music gain up: the bed's start() does that in the game. */
const music = (sfx) => {
  sfx.ambience.syncVolume(true);
  return sfx.ambience;
};
/** A HangarBed with only its event bus (no drone, no timers): events go through HANGAR_LEVEL like in the bed. */
function hangarEvents(sfx, ctx) {
  const amb = music(sfx);
  const h = Object.create(HangarBed.prototype);
  const dry = ctx.createGain();
  dry.gain.value = HANGAR_LEVEL;
  dry.connect(amb.music);
  const wet = ctx.createGain();
  wet.gain.value = HANGAR_LEVEL;
  wet.connect(amb.musicWet);
  h.ctx = ctx;
  h.bus = { ctx, dry, wet, buffers: amb.bus.buffers };
  return h;
}

// ------------------------------------------------------------------ what to render

const Ui = 0;
const Normal = 1;
const Weapon = 2;

/**
 * One-shots. `call(sfx, param)`; `params` = one render per value x `n` variants (else `n` variants).
 * `scale`: how sfx.gd scales a call's level argument relative to the render (linear gain); `level`
 * is the rendered level, used to check that the limiter stays out of the way for linear scaling.
 */
const ONE_SHOTS = [
  // name, prio, variants, seconds, call
  { name: 'laser', prio: Weapon, n: 6, sec: 5, call: (s) => s.laser() },
  { name: 'laser_rapid', prio: Weapon, n: 6, sec: 5, call: (s) => { s.lastLaser = 0; s.laser(); } },
  { name: 'laser_miss', prio: Weapon, n: 6, sec: 6, call: (s) => s.laserMiss() },
  { name: 'wrong', prio: Normal, n: 6, sec: 5, call: (s) => s.wrong() },
  { name: 'hit', prio: Weapon, n: 6, sec: 5, call: (s) => s.hit() },
  { name: 'miss', prio: Weapon, n: 6, sec: 6, call: (s) => s.miss() },
  { name: 'shield_block', prio: Weapon, n: 6, sec: 6, call: (s) => s.shieldBlock() },
  { name: 'station_destroyed', prio: Weapon, n: 4, sec: 7, call: (s) => s.stationDestroyed() },
  { name: 'alarm', prio: Normal, n: 3, sec: 6, call: (s) => s.alarm() },
  { name: 'radio_chirp', prio: Normal, n: 6, sec: 5, call: (s) => s.radioChirp() },
  // Durations used by the game: default rnd(1.2, 2.5), after miss() rnd(1, 1.6). Level scales linearly.
  {
    name: 'alien_chatter', prio: Normal, n: 1, sec: 7, params: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5],
    call: (s, d) => s.alienChatter(d, 1), scale: 'level',
  },
  { name: 'repair', prio: Normal, n: 4, sec: 6, call: (s) => s.repair() },
  { name: 'upgrade', prio: Normal, n: 4, sec: 6, call: (s) => s.upgrade() },
  { name: 'click', prio: Ui, n: 6, sec: 1, call: (s) => s.click() },
  { name: 'win', prio: Normal, n: 3, sec: 8, call: (s) => s.win() },
  { name: 'lose', prio: Normal, n: 3, sec: 7, call: (s) => s.lose() },
  // FtlScene: (500 + 1500) / 1000 = 2 s; StarMapScene: TRAVEL_MS / 1000 = 1.5 s.
  { name: 'ftl_charge', prio: Weapon, n: 3, sec: 6, params: [1.5, 2], call: (s, d) => s.ftlCharge(d) },
  { name: 'ftl_drop', prio: Weapon, n: 4, sec: 6, call: (s) => s.ftlDrop() },
  { name: 'enemy_laser', prio: Weapon, n: 6, sec: 5, call: (s) => s.enemyLaser() },
  { name: 'hull_hit', prio: Weapon, n: 6, sec: 6, call: (s) => s.hullHit() },
  { name: 'breach_alarm', prio: Weapon, n: 3, sec: 6, call: (s) => s.breachAlarm() },
  // BoardingScene: skitter(0.15 + 0.85 * level); content (density, brightness, wetness) depends on level.
  { name: 'skitter', prio: Ui, n: 4, sec: 5, params: [0.15, 0.35, 0.55, 0.75, 1], call: (s, l) => s.skitter(l) },
  // BoardingScene: screech(0.5), screech(0.35); level only scales the output (rendered at 1).
  { name: 'screech', prio: Normal, n: 6, sec: 5, call: (s) => s.screech(1), scale: 'level' },
  { name: 'turret_shot', prio: Weapon, n: 6, sec: 5, call: (s) => s.turretShot() },
  { name: 'bite', prio: Weapon, n: 6, sec: 6, call: (s) => s.bite() },
  // BoardingScene: sparkCrackle(0.5 + 0.5 * lamp.size), size 0.5 or 1; rendered at 1.
  { name: 'spark_crackle', prio: Ui, n: 6, sec: 5, call: (s) => s.sparkCrackle(1), scale: 'level' },

  // Ambience events (music bus; not counted as voices). Battle bed: every 8-20 s one of these; map: sonar.
  { name: 'amb_chatter', bus: 'Music', n: 6, sec: 7, call: (s) => music(s).chatter(1), scale: 'level' },
  { name: 'amb_creak', bus: 'Music', n: 6, sec: 7, call: (s) => music(s).creak() },
  { name: 'amb_alien_call', bus: 'Music', n: 6, sec: 7, call: (s) => music(s).alienCall() },
  { name: 'amb_sonar', bus: 'Music', n: 6, sec: 6, call: (s) => music(s).sonar() },
  // Hangar events (through the hangar layer's gain, so its fade applies in sfx.gd).
  { name: 'hangar_creak', bus: 'Music', n: 6, sec: 7, call: (s, _p, c) => hangarEvents(s, c).creak() },
  { name: 'hangar_groan', bus: 'Music', n: 5, sec: 10, call: (s, _p, c) => hangarEvents(s, c).groan() },
  { name: 'hangar_thud', bus: 'Music', n: 5, sec: 6, call: (s, _p, c) => hangarEvents(s, c).thud() },
  { name: 'hangar_drip', bus: 'Music', n: 6, sec: 5, call: (s, _p, c) => hangarEvents(s, c).drip() },
  { name: 'hangar_far_screech', bus: 'Music', n: 4, sec: 7, call: (s, _p, c) => hangarEvents(s, c).farScreech() },
];

/** Tension loops: one per level; sfx.gd crossfades the two around the smoothed level. */
const TENSION_LEVELS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];

/**
 * Loudness trim to match Chrome (dB, written to the manifest as linear `gain`, applied by sfx.gd).
 * Measured 2026-11: the same seeded renders in Chrome's OfflineAudioContext vs node-web-audio-api,
 * limiter settled (sound started 1 s into the render), mean RMS over 4 seeds. node-web-audio-api's
 * sawtooth is a little louder in the low harmonics (upgrade, laser, ftlCharge, creaks), its
 * compressor make-up gain ~0.3 dB lower (pure sines: sonar, drip). Chatter differs per seed (the
 * formant shuffle uses Array.sort with a random comparator), its trim is the mean.
 */
const CHROME_TRIM_DB = {
  laser: -1.0, laser_rapid: -0.2, laser_miss: -0.4, wrong: -0.7, hit: 0.3, miss: -0.1, shield_block: 0.4,
  station_destroyed: 0.3, alarm: -0.8, radio_chirp: 0.3, alien_chatter: -1.7, repair: 0.0, upgrade: -2.6,
  click: 0.4, win: 0.2, lose: 0.0, ftl_charge: -1.0, ftl_drop: 0.5, enemy_laser: 0.2, hull_hit: 0.3,
  breach_alarm: 0.2, skitter: 0.4, screech: -0.6, turret_shot: 0.1, bite: 0.2, spark_crackle: 0.6,
  amb_chatter: -1.7, amb_creak: -1.2, amb_alien_call: 0.4, amb_sonar: 0.3, hangar_creak: -1.3,
  hangar_groan: -0.1, hangar_thud: 0.3, hangar_drip: 0.3, hangar_far_screech: 0.1, bed_menu: -0.2,
  bed_map: -0.3, bed_battle: -0.2, hangar_bed: -0.3, tension: -0.2,
};
const trim = (name) => round(10 ** ((CHROME_TRIM_DB[name] ?? CHROME_TRIM_DB[name.split('_')[0]] ?? 0) / 20), 4);

// ------------------------------------------------------------------ rendering

const args = process.argv.slice(2);
const WAV = args.includes('--wav');
const only = new Set(args.filter((a) => !a.startsWith('--')));
const want = (name) => only.size === 0 || only.has(name) || [...only].some((o) => name.startsWith(o));

async function renderOneShots(manifest) {
  await mkdir(path.join(OUT, 'sfx'), { recursive: true });
  for (const def of ONE_SHOTS) {
    if (!want(def.name)) continue;
    const params = def.params ?? [null];
    const entry = {
      bus: def.bus ?? 'SFX', priority: def.prio ?? null, gain: trim(def.name), scale: def.scale ?? null,
      files: [], params: def.params ? [] : null, voice_sec: [], length_sec: [], peak_db: [],
    };
    let k = 0;
    for (const p of params) {
      for (let i = 0; i < def.n; i++) {
        const r = await render(def.sec, (s, c) => def.call(s, p, c));
        const ch = trimTail(r.ch, SR);
        const rel = `sfx/${def.name}_${k++}.${WAV ? 'wav' : 'ogg'}`;
        await writeFile(path.join(OUT, rel), WAV ? wav16(ch, SR) : await encodeOgg(ch, OGG_QUALITY_SFX));
        entry.files.push(rel);
        if (entry.params) entry.params.push(p);
        entry.voice_sec.push(round(r.voiceSec, 3));
        entry.length_sec.push(round(ch[0].length / SR, 3));
        entry.peak_db.push(round(peakDb(ch), 2));
      }
    }
    manifest.sounds[def.name] = entry;
    log(`${def.name.padEnd(20)} ${entry.files.length} files, peak ${Math.max(...entry.peak_db).toFixed(1)} dBFS,` +
      ` voice ${Math.max(...entry.voice_sec).toFixed(2)} s, len ${Math.max(...entry.length_sec).toFixed(2)} s`);
  }
}

let ogg = null;
async function encodeOgg(ch, quality = OGG_QUALITY) {
  ogg ??= await createOggEncoder();
  ogg.configure({ channels: 2, sampleRate: SR, vbrQuality: quality });
  const parts = [];
  const block = SR;
  for (let i = 0; i < ch[0].length; i += block) {
    parts.push(ogg.encode([ch[0].subarray(i, i + block), ch[1].subarray(i, i + block)]).slice());
  }
  parts.push(ogg.finalize().slice());
  return Buffer.concat(parts);
}

async function writeLoop(manifest, name, ch, extra = {}) {
  await mkdir(path.join(OUT, 'ambience'), { recursive: true });
  const rel = `ambience/${name}.ogg`;
  await writeFile(path.join(OUT, rel), await encodeOgg(ch));
  manifest.loops[name] = { bus: 'Music', file: rel, gain: trim(name), length_sec: round(ch[0].length / SR, 4), peak_db: round(peakDb(ch), 2), ...extra };
  log(`${name.padEnd(20)} loop ${(ch[0].length / SR).toFixed(2)} s, peak ${peakDb(ch).toFixed(1)} dBFS`);
}

/** Beds and hangar drone: render past the fade-in, then find a loop length near `len` with a matching junction. */
async function renderBedLoop(manifest, name, len, start) {
  const settle = 8;
  const fade = 3;
  const range = 1.5;
  const r = await render(settle + len + range + fade + 1, start);
  const s0 = settle * SR;
  const L = findLoopLength(r.ch, s0, Math.round((len - range) * SR), Math.round((len + range) * SR), fade * SR, SR);
  await writeLoop(manifest, name, makeLoop(r.ch, s0, L, fade * SR));
}

async function renderTension(manifest, lv) {
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const beat = 60 / (50 + 100 * clamp01((lv - 0.1) / 0.9));
  let beats = 2;
  while (beats * beat < 8) beats += 2; // an even number of beats (notes alternate) of at least 8 s
  const L = Math.round(beats * beat * SR);
  const settle = 4;
  const F = Math.round(0.25 * SR);
  const total = settle + L / SR + 0.25 + 1;
  const r = await render(total, (sfx, ctx) => {
    const amb = music(sfx);
    // In the game the layer feeds the battle bed's gain (1 once faded in) -> music bus.
    const tn = new Tension(ctx, amb.music, amb.musicWet);
    tn.target = lv;
    tn.level = lv;
    const clock = { currentTime: 0 };
    tn.ctx = clock;
    tn.lastTick = 0;
    for (let t = 0; t < total; t += 0.05) {
      clock.currentTime = t;
      tn.tick();
    }
  });
  const name = `tension_${Math.round(lv * 100).toString().padStart(3, '0')}`;
  await writeLoop(manifest, name, makeLoop(r.ch, settle * SR, L, F), { level: lv, beats, bpm: round(60 / beat, 3) });
}

async function renderLoops(manifest) {
  for (const kind of ['menu', 'map', 'battle']) {
    // ~64.5 s: two cycles of the 0.031 Hz filter LFO and ~three of the 0.047 Hz air swell.
    if (want(`bed_${kind}`)) await renderBedLoop(manifest, `bed_${kind}`, 64.5, (s) => s.startAmbience(kind));
  }
  // ~70 s: three cycles of the 0.043 Hz filter LFO, five of the 0.071 Hz hum swell.
  if (want('hangar_bed')) await renderBedLoop(manifest, 'hangar_bed', 70, (s) => s.startHangar());
  for (const lv of TENSION_LEVELS) if (want('tension')) await renderTension(manifest, lv);
}

// ------------------------------------------------------------------ main

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const log = (s) => process.stdout.write(`${s}\n`);

const manifestPath = path.join(OUT, 'manifest.json');
let manifest = { version: 1, sounds: {}, loops: {} };
if (only.size > 0 && existsSync(manifestPath)) {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} else if (only.size === 0) {
  await rm(path.join(OUT, 'sfx'), { recursive: true, force: true });
  await rm(path.join(OUT, 'ambience'), { recursive: true, force: true });
}
await mkdir(OUT, { recursive: true });

const t0 = Date.now();
await renderOneShots(manifest);
await renderLoops(manifest);

// The limiter ceiling for sfx.gd's Master hard limiter: the loudest single rendered sound. One sound
// alone is already limited in the render; layered sounds are held to the same ceiling, as in the TS.
let ceiling = -120;
for (const e of Object.values(manifest.sounds)) ceiling = Math.max(ceiling, ...e.peak_db.map((p) => p + 20 * Math.log10(e.gain)));
manifest.sample_rate = SR;
manifest.render = { sfx_volume: SFX_VOL, music_volume: MUSIC_VOL, hangar_level: HANGAR_LEVEL };
manifest.limiter_ceiling_db = round(ceiling, 2);
manifest.tension_levels = Object.values(manifest.loops).filter((l) => l.level !== undefined).map((l) => l.level).sort((a, b) => a - b);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s; limiter ceiling ${manifest.limiter_ceiling_db} dBFS`);
