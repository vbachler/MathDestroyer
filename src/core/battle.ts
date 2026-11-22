import { headStartUpgradeCount, hullBonusHp, moduleTier, targetingMultiplier } from './economy';
import { classify, fastThresholdMs, isMastered } from './mastery';
import type { Outcome } from './mastery';
import { createRng } from './rng';
import type { Rng } from './rng';
import { buildWaveQueue } from './scheduler';
import type { Fact, FactStats } from './types';
import { headStartUpgrades, offerFor, pickOfferIds, upgradeById, upgradeEffects } from './upgrades';
import type { UpgradeEffects, UpgradeOffer } from './upgrades';

// ---- Field geometry (logical pixels) ----
/** Waves of a campaign mission (callers pass it as BattleConfig.totalWaves). */
export const MISSION_WAVES = 3;
export const FIELD_WIDTH = 1280;
export const FIELD_HEIGHT = 720;
export const SPAWN_Y = 60;
export const IMPACT_Y = 600;
export const LANE_X = [140, 340, 540, 740, 940, 1140];
export const DOME_X = [240, 507, 773, 1040];
/** No spawn in a lane whose newest enemy is still above this y. */
export const LANE_CLEAR_Y = 200;

// ---- Rules ----
export const MAX_ALIVE = 4;
export const EXPLAIN_MS = 2500;
export const BASE_DOME_HP = 2;
export const MAX_INPUT_DIGITS = 4;
/** Pause before the first enemy of each wave appears. */
export const WAVE_START_DELAY_MS = 1000;
/** update() advances the simulation in sub-steps of at most this length. */
export const MAX_STEP_MS = 50;
export const TURRET_POINTS = 5;
export const WRONG_PENALTY = 5;
export const REPAIR_STREAK = 10;

export const enemiesInWave = (w: number): number => 6 + 2 * w;
export const spawnIntervalMs = (w: number, speedScale = 1): number => Math.max(1800, 3600 - 250 * w) / speedScale;
export const baseSpeed = (w: number, speedScale = 1): number => (20 + 3 * w) * speedScale;
export interface Enemy {
  id: number; fact: Fact; lane: number; x: number; y: number;
  speed: number;            // px per second, already including modifiers
  spawnedAt: number;        // sim time ms
}
export interface Dome { hp: number; maxHp: number; }   // hp 0 = destroyed
export type BattlePhase = 'spawning' | 'waveCleared' | 'explaining' | 'won' | 'lost';

export interface BattleState {
  phase: BattlePhase;
  timeMs: number;
  wave: number;             // 1-based
  totalWaves: number;
  enemies: Enemy[];
  domes: Dome[];
  input: string;            // current typed answer, e.g. "-5", max 4 chars + sign
  score: number;
  streak: number;
  bestStreak: number;
  kills: number;
  wrongAnswers: number;
  ownedUpgrades: Record<string, number>;   // upgradeId -> tier
  missed: Fact[];           // facts that reached the planet (unique, in order)
  explaining: Fact | null;  // set while phase === 'explaining'
  autoTurretCooldownMs: number;
  /** Impacts the shield upgrade can still absorb in the current wave (refilled at each wave start). */
  shieldCharges: number;
}

export type BattleEvent =
  | { type: 'spawn'; enemy: Enemy }
  | { type: 'kill'; enemy: Enemy; fast: boolean; byTurret: boolean; points: number }
  | { type: 'wrong'; typed: number }
  | { type: 'impact'; enemy: Enemy; domeIndex: number; destroyed: boolean }
  /** The shield absorbed an impact: the enemy is destroyed, the dome loses no hp, the streak stays. */
  | { type: 'shieldBlock'; enemy: Enemy; domeIndex: number }
  | { type: 'repair'; domeIndex: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'explainStart'; fact: Fact }
  | { type: 'explainEnd' }
  | { type: 'won' } | { type: 'lost' };

/** One recorded answer, applied to mastery by the caller after the mission. */
export interface AnswerRecord { factId: string; outcome: Outcome; responseMs: number; }

export interface BattleConfig {
  planetId: string;
  totalWaves: number;                         // campaign missions: MISSION_WAVES (3)
  stats: Record<string, FactStats>;           // read-only snapshot at mission start
  modules: Record<string, number>;            // station modules owned: moduleId -> tier
  now: number;                                // epoch ms at mission start
  seed: number;
  speedScale: number;                         // 0.75 | 1 | 1.25 from settings.gameSpeed
}

/** "Lowest" enemy = closest to the planet = greatest y (ties: oldest id). */
function lowest(enemies: Enemy[]): Enemy | undefined {
  let best: Enemy | undefined;
  for (const e of enemies) if (!best || e.y > best.y || (e.y === best.y && e.id < best.id)) best = e;
  return best;
}

export class BattleSim {
  readonly state: BattleState;
  readonly records: AnswerRecord[] = [];
  readonly config: BattleConfig;

  private readonly rng: Rng;
  private readonly targetingMult: number;
  private readonly speedScale: number;
  private effects: UpgradeEffects;
  private queue: Fact[] = [];
  private queueIndex = 0;
  private spawnTimerMs = WAVE_START_DELAY_MS;
  private nextEnemyId = 1;
  private explainRemainingMs = 0;
  private lastSubmitAt = 0;
  private correctAnswers = 0;
  private readonly wronged = new Set<number>();
  private offerIds: string[] = [];

  constructor(cfg: BattleConfig) {
    this.config = cfg;
    this.rng = createRng(cfg.seed);
    // Guard against a missing or nonsensical value; normal values are 0.75 / 1 / 1.25.
    this.speedScale = Number.isFinite(cfg.speedScale) && cfg.speedScale > 0 ? cfg.speedScale : 1;
    this.targetingMult = targetingMultiplier(moduleTier(cfg.modules, 'targeting'));
    const maxHp = BASE_DOME_HP + hullBonusHp(moduleTier(cfg.modules, 'hull'));
    this.state = {
      phase: 'spawning',
      timeMs: 0,
      wave: 1,
      totalWaves: Math.max(1, cfg.totalWaves),
      enemies: [],
      domes: DOME_X.map(() => ({ hp: maxHp, maxHp })),
      input: '',
      score: 0,
      streak: 0,
      bestStreak: 0,
      kills: 0,
      wrongAnswers: 0,
      ownedUpgrades: headStartUpgrades(headStartUpgradeCount(moduleTier(cfg.modules, 'headStart')), this.rng),
      missed: [],
      explaining: null,
      autoTurretCooldownMs: 0,
      shieldCharges: 0,
    };
    this.effects = upgradeEffects(this.state.ownedUpgrades);
    if (this.effects.turretCooldownMs !== null) this.state.autoTurretCooldownMs = this.effects.turretCooldownMs;
    this.startWaveQueue();
  }

  // ---------------------------------------------------------------- queries

  /** Domes with hp > 0. */
  domesStanding(): number {
    return this.state.domes.filter((d) => d.hp > 0).length;
  }

  /** Correct player answers / all player answers (1 when nothing was answered). Turret kills excluded. */
  accuracy(): number {
    const total = this.correctAnswers + this.state.wrongAnswers;
    return total === 0 ? 1 : this.correctAnswers / total;
  }

  /** Combined effects of the upgrades bought this mission (e.g. salvageTier for missionCredits). */
  upgradeEffects(): UpgradeEffects {
    return { ...this.effects };
  }

  /** Enemies of the current wave not yet spawned. */
  remainingToSpawn(): number {
    return this.queue.length - this.queueIndex;
  }

  // ---------------------------------------------------------------- simulation

  update(dtMs: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    let left = Math.max(0, dtMs);
    while (left > 0) {
      const step = Math.min(MAX_STEP_MS, left);
      left -= step;
      this.step(step, events);
    }
    return events;
  }

  private step(dt: number, ev: BattleEvent[]): void {
    const s = this.state;
    if (s.phase === 'explaining') {
      this.explainRemainingMs -= dt;
      if (this.explainRemainingMs <= 0) {
        this.explainRemainingMs = 0;
        s.phase = 'spawning';
        s.explaining = null;
        ev.push({ type: 'explainEnd' });
        this.checkWaveEnd(ev);
      }
      return;
    }
    if (s.phase !== 'spawning') return;
    s.timeMs += dt;
    this.stepTurret(dt, ev);
    this.stepSpawn(dt, ev);
    for (const e of s.enemies) e.y += (e.speed * dt) / 1000;
    this.stepImpacts(ev);
    if (s.phase === 'spawning') this.checkWaveEnd(ev);
  }

  private stepTurret(dt: number, ev: BattleEvent[]): void {
    const cooldown = this.effects.turretCooldownMs;
    if (cooldown === null) return;
    const s = this.state;
    s.autoTurretCooldownMs = Math.max(0, s.autoTurretCooldownMs - dt);
    if (s.autoTurretCooldownMs > 0) return;
    const target = lowest(s.enemies.filter((e) => isMastered(this.config.stats[e.fact.id])));
    if (!target) return;   // stays ready until a mastered fact appears
    this.removeEnemy(target);
    s.score += TURRET_POINTS;
    s.kills++;
    this.wronged.delete(target.id);
    s.autoTurretCooldownMs = cooldown;
    ev.push({ type: 'kill', enemy: target, fast: false, byTurret: true, points: TURRET_POINTS });
  }

  private stepSpawn(dt: number, ev: BattleEvent[]): void {
    const s = this.state;
    if (this.queueIndex >= this.queue.length) return;
    this.spawnTimerMs = Math.max(0, this.spawnTimerMs - dt);
    if (this.spawnTimerMs > 0 || s.enemies.length >= MAX_ALIVE) return;
    const free = LANE_X.map((_, i) => i)
      .filter((lane) => !s.enemies.some((e) => e.lane === lane && e.y <= LANE_CLEAR_Y));
    if (free.length === 0) return;
    const lane = this.rng.pick(free);
    const factor = 0.9 + 0.2 * this.rng.next();
    const enemy: Enemy = {
      id: this.nextEnemyId++,
      fact: this.queue[this.queueIndex++],
      lane,
      x: LANE_X[lane],
      y: SPAWN_Y,
      speed: baseSpeed(s.wave, this.speedScale) * factor * this.effects.speedMult,
      spawnedAt: s.timeMs,
    };
    s.enemies.push(enemy);
    this.spawnTimerMs = spawnIntervalMs(s.wave, this.speedScale);
    ev.push({ type: 'spawn', enemy });
  }

  private stepImpacts(ev: BattleEvent[]): void {
    const s = this.state;
    const hits = s.enemies.filter((e) => e.y >= IMPACT_Y).sort((p, q) => q.y - p.y || p.id - q.id);
    if (hits.length === 0) return;
    let first: Fact | null = null;
    for (const enemy of hits) {
      this.removeEnemy(enemy);
      enemy.y = IMPACT_Y;
      const domeIndex = this.domeToHit(enemy.x);
      this.wronged.delete(enemy.id);
      this.records.push({ factId: enemy.fact.id, outcome: 'missed', responseMs: s.timeMs - enemy.spawnedAt });
      if (!s.missed.some((f) => f.id === enemy.fact.id)) s.missed.push(enemy.fact);
      if (first === null) first = enemy.fact;
      if (s.shieldCharges > 0) {
        s.shieldCharges--;
        ev.push({ type: 'shieldBlock', enemy, domeIndex });
        continue;
      }
      const dome = s.domes[domeIndex];
      dome.hp = Math.max(0, dome.hp - 1);
      s.streak = 0;
      ev.push({ type: 'impact', enemy, domeIndex, destroyed: dome.hp === 0 });
      if (this.domesStanding() === 0) {
        s.phase = 'lost';
        s.input = '';
        ev.push({ type: 'lost' });
        return;
      }
    }
    s.phase = 'explaining';
    s.explaining = first;
    s.input = '';
    this.explainRemainingMs = EXPLAIN_MS;
    if (first) ev.push({ type: 'explainStart', fact: first });
  }

  /** Nearest standing dome to x (the nearest one if it stands, else the next nearest standing). */
  private domeToHit(x: number): number {
    const order = DOME_X.map((dx, i) => ({ i, d: Math.abs(dx - x) })).sort((p, q) => p.d - q.d || p.i - q.i);
    const standing = order.find((o) => this.state.domes[o.i].hp > 0);
    return (standing ?? order[0]).i;
  }

  private checkWaveEnd(ev: BattleEvent[]): void {
    const s = this.state;
    if (s.phase !== 'spawning' || this.queueIndex < this.queue.length || s.enemies.length > 0) return;
    s.input = '';
    if (s.wave >= s.totalWaves) {
      s.phase = 'won';
      ev.push({ type: 'won' });
      return;
    }
    s.phase = 'waveCleared';
    this.offerIds = pickOfferIds(s.ownedUpgrades, this.rng);
    ev.push({ type: 'waveCleared', wave: s.wave });
  }

  private removeEnemy(enemy: Enemy): void {
    const i = this.state.enemies.indexOf(enemy);
    if (i >= 0) this.state.enemies.splice(i, 1);
  }

  /** Most damaged dome gains 1 hp (destroyed domes can be rebuilt). Returns its index or -1. */
  private repairMostDamaged(): number {
    let best = -1;
    this.state.domes.forEach((d, i) => {
      if (d.hp >= d.maxHp) return;
      if (best < 0 || d.hp < this.state.domes[best].hp) best = i;
    });
    if (best >= 0) this.state.domes[best].hp++;
    return best;
  }

  private startWaveQueue(): void {
    const s = this.state;
    this.queue = buildWaveQueue({
      planetId: this.config.planetId,
      count: enemiesInWave(s.wave),
      stats: this.config.stats,
      now: this.config.now,
      rng: this.rng,
      waveIndex: s.wave - 1,
    });
    this.queueIndex = 0;
    this.spawnTimerMs = WAVE_START_DELAY_MS;
    s.shieldCharges = this.effects.shieldPerWave;
  }

  // ---------------------------------------------------------------- input

  typeDigit(d: number): void {
    const s = this.state;
    if (s.phase !== 'spawning' || !Number.isInteger(d) || d < 0 || d > 9) return;
    const negative = s.input.startsWith('-');
    const digits = negative ? s.input.slice(1) : s.input;
    if (digits.length >= MAX_INPUT_DIGITS) return;
    const nextDigits = digits === '0' ? String(d) : digits + String(d);
    s.input = (negative ? '-' : '') + nextDigits;
  }

  toggleSign(): void {
    const s = this.state;
    if (s.phase !== 'spawning') return;
    if (!s.enemies.some((e) => e.fact.answer < 0)) return;
    s.input = s.input.startsWith('-') ? s.input.slice(1) : `-${s.input}`;
  }

  backspace(): void {
    const s = this.state;
    if (s.phase !== 'spawning') return;
    s.input = s.input.slice(0, -1);
  }

  submit(): BattleEvent[] {
    const s = this.state;
    if (s.phase !== 'spawning') return [];
    const digits = s.input.startsWith('-') ? s.input.slice(1) : s.input;
    if (digits.length === 0) return [];
    const typed = Number(s.input);
    const ev: BattleEvent[] = [];
    const target = lowest(s.enemies.filter((e) => e.fact.answer === typed));
    if (target) {
      const responseMs = s.timeMs - Math.max(target.spawnedAt, this.lastSubmitAt);
      const wasWrong = this.wronged.has(target.id);
      const outcome: Outcome = wasWrong ? 'slow' : classify(target.fact, true, responseMs);
      const fast = !wasWrong && responseMs <= fastThresholdMs(target.fact, this.targetingMult);
      const points = Math.round((10 + (fast ? 5 : 0) + Math.min(s.streak, 20)) * this.effects.scoreMult);
      this.removeEnemy(target);
      this.wronged.delete(target.id);
      s.score += points;
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.kills++;
      this.correctAnswers++;
      this.records.push({ factId: target.fact.id, outcome, responseMs });
      ev.push({ type: 'kill', enemy: target, fast, byTurret: false, points });
      if (s.streak % REPAIR_STREAK === 0) {
        const domeIndex = this.repairMostDamaged();
        if (domeIndex >= 0) ev.push({ type: 'repair', domeIndex });
      }
      s.input = '';
      this.lastSubmitAt = s.timeMs;
      this.checkWaveEnd(ev);
      return ev;
    }
    s.streak = 0;
    s.score = Math.max(0, s.score - WRONG_PENALTY);
    s.wrongAnswers++;
    s.input = '';
    const victim = lowest(s.enemies);
    if (victim && !this.wronged.has(victim.id)) {
      this.wronged.add(victim.id);
      this.records.push({
        factId: victim.fact.id,
        outcome: 'wrong',
        responseMs: s.timeMs - Math.max(victim.spawnedAt, this.lastSubmitAt),
      });
    }
    this.lastSubmitAt = s.timeMs;
    ev.push({ type: 'wrong', typed });
    return ev;
  }

  // ---------------------------------------------------------------- between waves

  /** The three (or fewer) upgrades offered after a cleared wave; [] outside phase 'waveCleared'
   *  and when every upgrade is at max tier (then call nextWave()). */
  offers(): UpgradeOffer[] {
    if (this.state.phase !== 'waveCleared') return [];
    const out: UpgradeOffer[] = [];
    for (const id of this.offerIds) {
      const d = upgradeById(id);
      const o = d ? offerFor(d, this.state.ownedUpgrades) : null;
      if (o) out.push(o);
    }
    return out;
  }

  /** Takes one offered upgrade for free (one tier up) and starts the next wave.
   *  Returns the events of nextWave(); [] (and no change) when the id is not on offer. */
  pickUpgrade(upgradeId: string): BattleEvent[] {
    const offer = this.offers().find((o) => o.def.id === upgradeId);
    if (!offer) return [];
    const s = this.state;
    s.ownedUpgrades = { ...s.ownedUpgrades, [upgradeId]: offer.nextTier };
    this.effects = upgradeEffects(s.ownedUpgrades);
    if (upgradeId === 'autoTurret' && this.effects.turretCooldownMs !== null) {
      s.autoTurretCooldownMs = this.effects.turretCooldownMs;
    }
    return this.nextWave();
  }

  /** Leaves 'waveCleared' without an upgrade (used when nothing can be offered): starts the next
   *  wave; the repair drone repairs at wave start and the shield is refilled. */
  nextWave(): BattleEvent[] {
    const s = this.state;
    if (s.phase !== 'waveCleared') return [];
    const ev: BattleEvent[] = [];
    s.wave++;
    s.phase = 'spawning';
    s.input = '';
    this.offerIds = [];
    this.startWaveQueue();
    for (let i = 0; i < this.effects.repairPerWave; i++) {
      const domeIndex = this.repairMostDamaged();
      if (domeIndex < 0) break;
      ev.push({ type: 'repair', domeIndex });
    }
    return ev;
  }
}
