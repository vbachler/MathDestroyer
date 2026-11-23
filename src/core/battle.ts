import { headStartUpgradeCount, hullBonusHp, moduleTier, targetingMultiplier } from './economy';
import { classify, fastThresholdMs, isMastered } from './mastery';
import type { Outcome } from './mastery';
import { createRng } from './rng';
import type { Rng } from './rng';
import { createMissionScheduler } from './scheduler';
import type { MissionScheduler } from './scheduler';
import type { Fact, FactStats, PlanetProgress } from './types';
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
/** Enemies alive at once at the default density (1). */
export const MAX_ALIVE = 4;
/** Enemies alive at once for a density: 2 / 3 / 4 / 5 for 0.5 / 0.75 / 1 / 1.25. */
export const maxAlive = (density = 1): number => Math.max(1, Math.round(MAX_ALIVE * density));
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

// ---- Attack and boarding (v6) ----
/** An armed enemy charges its laser while its y is at or below this line. */
export const FIRE_LINE_Y = 90;
/** Hull points of the player's ship; at 0 the ship is boarded. */
export const HULL_MAX = 2;
/** Charge time of an enemy laser at speedScale 1. */
export const CHARGE_MS = 6000;
/** Tolerance for the sum of sub-step charge increments (floating point). */
const CHARGE_EPSILON = 1e-9;
/** Points (and kills) per crawler destroyed in a boarding. */
export const BOARDING_KILL_POINTS = 10;
/** Crawlers per boarding (also exported by core/boarding). */
export const BOARDING_CRAWLERS = 8;
/** Chance that an enemy is armed, by wave (index 0 = wave 1); later waves use the last value. */
export const ARMED_CHANCE: readonly number[] = [0.4, 0.5, 0.6];

export const enemiesInWave = (w: number): number => 6 + 2 * w;
export const spawnIntervalMs = (w: number, speedScale = 1, density = 1): number =>
  Math.max(1800, 3600 - 250 * w) / speedScale / density;
export const baseSpeed = (w: number, speedScale = 1): number => (20 + 3 * w) * speedScale;
export const armedChance = (w: number): number => ARMED_CHANCE[Math.min(Math.max(1, w), ARMED_CHANCE.length) - 1];
/** Time an armed enemy needs from charge 0 to firing. */
export const chargeMs = (speedScale = 1): number => CHARGE_MS / speedScale;
export interface Enemy {
  id: number; fact: Fact; lane: number; x: number; y: number;
  speed: number;            // px per second, already including modifiers
  spawnedAt: number;        // sim time ms
  armed: boolean;           // shoots at the ship once below FIRE_LINE_Y
  charge: number;           // 0..1; fires at 1
}
export interface Dome { hp: number; maxHp: number; }   // hp 0 = destroyed
export type BattlePhase = 'spawning' | 'waveCleared' | 'explaining' | 'boarding' | 'won' | 'lost';

/** Result of a boarding fight, handed back by the boarding scene. */
export interface BoardingResult { repelled: boolean; records: AnswerRecord[]; kills: number; }

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
  missed: Fact[];           // problems that reached the planet (unique by id, in order)
  explaining: Fact | null;  // set while phase === 'explaining'
  autoTurretCooldownMs: number;
  /** Impacts the shield upgrade can still absorb in the current wave (refilled at each wave start). */
  shieldCharges: number;
  /** Ship hull; an enemy laser hit costs 1, at 0 the ship is boarded. */
  hull: number;
  hullMax: number;
  /** Boardings repelled this mission. */
  boardings: number;
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
  /** An armed enemy fired at the ship; `hull` is the hull left after the hit. */
  | { type: 'shipHit'; enemy: Enemy; hull: number }
  /** The hull reached 0: phase 'boarding' until resolveBoarding(). */
  | { type: 'breach' }
  | { type: 'won' } | { type: 'lost' };

/** One recorded answer, applied to mastery by the caller after the mission. `factId` holds the
 *  problem's `statId` (the fact id when enumerated, `cat:<sectorId>:<category>` when generated). */
export interface AnswerRecord { factId: string; outcome: Outcome; responseMs: number; }

export interface BattleConfig {
  planetId: string;
  totalWaves: number;                         // campaign missions: MISSION_WAVES (3)
  stats: Record<string, FactStats>;           // read-only snapshot at mission start
  planets: Record<string, PlanetProgress>;    // read-only snapshot (the core draws from played sectors)
  modules: Record<string, number>;            // station modules owned: moduleId -> tier
  now: number;                                // epoch ms at mission start
  seed: number;
  /** settings.gameSpeed (0.5 | 0.75 | 1 | 1.25) times the planet's tier factor (tierSpeedFactor). */
  speedScale: number;
  /** settings.density (0.5 | 0.75 | 1 | 1.25), default 1: spawn interval / density, max alive maxAlive(density).
   *  Enemies per wave do not change. */
  density?: number;
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
  private readonly density: number;
  private readonly maxAlive: number;
  private effects: UpgradeEffects;
  private readonly scheduler: MissionScheduler;
  private queue: Fact[] = [];
  private queueIndex = 0;
  /** Id of the problem spawned last (never spawned twice in a row). */
  private lastSpawnedId: string | null = null;
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
    // Guard against a missing or nonsensical value; normal values are 0.5 / 0.75 / 1 / 1.25.
    this.speedScale = Number.isFinite(cfg.speedScale) && cfg.speedScale > 0 ? cfg.speedScale : 1;
    const d = cfg.density ?? 1;
    this.density = Number.isFinite(d) && d > 0 ? d : 1;
    this.maxAlive = maxAlive(this.density);
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
      hull: HULL_MAX,
      hullMax: HULL_MAX,
      boardings: 0,
    };
    this.effects = upgradeEffects(this.state.ownedUpgrades);
    if (this.effects.turretCooldownMs !== null) this.state.autoTurretCooldownMs = this.effects.turretCooldownMs;
    this.scheduler = createMissionScheduler({
      planetId: cfg.planetId, stats: cfg.stats, planets: cfg.planets, now: cfg.now, rng: this.rng,
    });
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
    if (s.phase === 'spawning') this.stepCharge(dt, ev);
    if (s.phase === 'spawning') this.checkWaveEnd(ev);
  }

  /** Armed enemies below the fire line charge; at 1 they hit the hull. At hull 0: breach. */
  private stepCharge(dt: number, ev: BattleEvent[]): void {
    const s = this.state;
    const rate = dt / chargeMs(this.speedScale);
    for (const e of s.enemies) {
      if (!e.armed || e.y < FIRE_LINE_Y) continue;
      e.charge = Math.min(1, e.charge + rate);
      if (e.charge < 1 - CHARGE_EPSILON) continue;
      e.charge = 0;
      s.hull = Math.max(0, s.hull - 1);
      ev.push({ type: 'shipHit', enemy: e, hull: s.hull });
      if (s.hull === 0) {
        s.phase = 'boarding';
        s.input = '';
        ev.push({ type: 'breach' });
        return;
      }
    }
  }

  private stepTurret(dt: number, ev: BattleEvent[]): void {
    const cooldown = this.effects.turretCooldownMs;
    if (cooldown === null) return;
    const s = this.state;
    s.autoTurretCooldownMs = Math.max(0, s.autoTurretCooldownMs - dt);
    if (s.autoTurretCooldownMs > 0) return;
    const target = lowest(s.enemies.filter((e) => isMastered(this.config.stats[e.fact.statId])));
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
    if (this.spawnTimerMs > 0 || s.enemies.length >= this.maxAlive) return;
    const free = LANE_X.map((_, i) => i)
      .filter((lane) => !s.enemies.some((e) => e.lane === lane && e.y <= LANE_CLEAR_Y));
    if (free.length === 0) return;
    const fact = this.nextFact();
    if (!fact) return;   // every candidate is on screen already: wait for one to go
    const lane = this.rng.pick(free);
    const factor = 0.9 + 0.2 * this.rng.next();
    // The first enemy of a mission is never armed (and draws nothing for it).
    const armed = this.nextEnemyId > 1 && this.rng.next() < armedChance(s.wave);
    const enemy: Enemy = {
      id: this.nextEnemyId++,
      fact,
      lane,
      x: LANE_X[lane],
      y: SPAWN_Y,
      speed: baseSpeed(s.wave, this.speedScale) * factor * this.effects.speedMult,
      spawnedAt: s.timeMs,
      armed,
      charge: 0,
    };
    s.enemies.push(enemy);
    this.spawnTimerMs = spawnIntervalMs(s.wave, this.speedScale, this.density);
    ev.push({ type: 'spawn', enemy });
  }

  /**
   * The next problem to spawn: the queued one unless the same problem is alive or was spawned
   * last; then the first later queued problem that fits is moved forward, else the scheduler
   * draws a replacement. Null (spawn waits) when nothing fits. Advances the queue.
   */
  private nextFact(): Fact | null {
    const alive = new Set(this.state.enemies.map((e) => e.fact.id));
    const strict = new Set(alive);
    if (this.lastSpawnedId) strict.add(this.lastSpawnedId);
    const q = this.queue;
    let j = this.queueIndex;
    while (j < q.length && strict.has(q[j].id)) j++;
    if (j < q.length) {
      [q[this.queueIndex], q[j]] = [q[j], q[this.queueIndex]];
    } else {
      const wave = this.state.wave - 1;
      const replacement = this.scheduler.replacement(wave, strict) ?? this.scheduler.replacement(wave, alive);
      if (!replacement) return null;
      q[this.queueIndex] = replacement;
    }
    const fact = q[this.queueIndex++];
    this.lastSpawnedId = fact.id;
    return fact;
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
      this.records.push({ factId: enemy.fact.statId, outcome: 'missed', responseMs: s.timeMs - enemy.spawnedAt });
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
    this.queue = this.scheduler.wave(s.wave - 1, enemiesInWave(s.wave));
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
      this.records.push({ factId: target.fact.statId, outcome, responseMs });
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
        factId: victim.fact.statId,
        outcome: 'wrong',
        responseMs: s.timeMs - Math.max(victim.spawnedAt, this.lastSubmitAt),
      });
    }
    this.lastSubmitAt = s.timeMs;
    ev.push({ type: 'wrong', typed });
    return ev;
  }

  // ---------------------------------------------------------------- boarding

  /** Problems for one boarding, drawn from the mission scheduler with the usual weighting.
   *  Consumes the sim Rng: call once per boarding. */
  boardingFacts(n: number = BOARDING_CRAWLERS): Fact[] {
    return this.scheduler.wave(this.state.wave - 1, Math.max(0, Math.floor(n)));
  }

  /** Applies the outcome of a boarding (phase 'boarding' only; otherwise no-op, []).
   *  Repelled: hull refilled, every charge reset, back to 'spawning'. Not repelled: 'lost'. */
  resolveBoarding(result: BoardingResult): BattleEvent[] {
    const s = this.state;
    if (s.phase !== 'boarding') return [];
    this.records.push(...result.records);
    const kills = Math.max(0, Math.floor(result.kills));
    s.score += BOARDING_KILL_POINTS * kills;
    s.kills += kills;
    s.input = '';
    if (!result.repelled) {
      s.phase = 'lost';
      return [{ type: 'lost' }];
    }
    s.hull = s.hullMax;
    for (const e of s.enemies) e.charge = 0;
    s.boardings++;
    s.phase = 'spawning';
    return [];
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
