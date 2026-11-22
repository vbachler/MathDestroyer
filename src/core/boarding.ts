import { BOARDING_CRAWLERS, MAX_INPUT_DIGITS, MAX_STEP_MS } from './battle';
import type { AnswerRecord } from './battle';
import { classify, fastThresholdMs } from './mastery';
import type { Outcome } from './mastery';
import { createRng } from './rng';
import type { Rng } from './rng';
import type { Fact } from './types';

export { BOARDING_CRAWLERS };

export type CrawlerKind = 'scorpion' | 'spider' | 'crab' | 'beetle';
export const CRAWLER_KINDS: readonly CrawlerKind[] = ['scorpion', 'spider', 'crab', 'beetle'];
/** Speed factor per kind (z per second = factor * speedScale * 1000 / APPROACH_MS). */
export const CRAWLER_SPEED: Record<CrawlerKind, number> = { scorpion: 1, spider: 1.2, crab: 0.85, beetle: 1 };
export const BOARDING_MAX_ALIVE = 3;
export const BOARDING_MAX_BITES = 3;
/** Time for z 1 -> 0 at speed factor 1 and speedScale 1. */
export const APPROACH_MS = 11000;
/** Interval between spawns at speedScale 1 (divided by speedScale). */
export const BOARDING_SPAWN_MS = 2600;
/** Delay before the first crawler (not scaled, like the battle's wave start delay). */
export const BOARDING_FIRST_SPAWN_MS = 1200;
/** Two crawlers on the same lane are never closer than this in z. */
export const LANE_GAP_Z = 0.25;
export const BOARDING_LANES: ReadonlyArray<-1 | 0 | 1> = [-1, 0, 1];

export interface Crawler {
  id: number; fact: Fact; kind: CrawlerKind; lane: -1 | 0 | 1;
  z: number;        // 1 = far door, 0 = at the turret
  speed: number;    // z per second
  spawnedAt: number;
}
export interface BoardingState {
  phase: 'fighting' | 'repelled' | 'overrun'; timeMs: number;
  crawlers: Crawler[]; input: string; bites: number; maxBites: number;
  remaining: number;   // not yet spawned
  kills: number;
}
export type BoardingEvent =
  | { type: 'spawn'; crawler: Crawler } | { type: 'kill'; crawler: Crawler; fast: boolean }
  | { type: 'wrong'; typed: number } | { type: 'bite'; crawler: Crawler }
  | { type: 'repelled' } | { type: 'overrun' };

export interface BoardingConfig { facts: Fact[]; seed: number; speedScale: number; }

/** Nearest crawler = smallest z (ties: oldest id). */
function nearest(crawlers: Crawler[]): Crawler | undefined {
  let best: Crawler | undefined;
  for (const c of crawlers) if (!best || c.z < best.z || (c.z === best.z && c.id < best.id)) best = c;
  return best;
}

export class BoardingSim {
  readonly state: BoardingState;
  readonly records: AnswerRecord[] = [];

  private readonly rng: Rng;
  private readonly speedScale: number;
  private readonly facts: Fact[];
  private spawnTimerMs = BOARDING_FIRST_SPAWN_MS;
  private nextId = 1;
  /** Kind of the next crawler, drawn once and kept while the spawn waits for a free lane. */
  private pendingKind: CrawlerKind | null = null;
  private lastSubmitAt = 0;
  private readonly wronged = new Set<number>();

  constructor(cfg: BoardingConfig) {
    this.rng = createRng(cfg.seed);
    this.speedScale = Number.isFinite(cfg.speedScale) && cfg.speedScale > 0 ? cfg.speedScale : 1;
    this.facts = cfg.facts.slice();
    this.state = {
      phase: 'fighting',
      timeMs: 0,
      crawlers: [],
      input: '',
      bites: 0,
      maxBites: BOARDING_MAX_BITES,
      remaining: this.facts.length,
      kills: 0,
    };
  }

  // ---------------------------------------------------------------- simulation

  step(dtMs: number): BoardingEvent[] {
    const events: BoardingEvent[] = [];
    let left = Math.max(0, dtMs);
    while (left > 0) {
      const dt = Math.min(MAX_STEP_MS, left);
      left -= dt;
      this.tick(dt, events);
    }
    return events;
  }

  private tick(dt: number, ev: BoardingEvent[]): void {
    const s = this.state;
    if (s.phase !== 'fighting') return;
    s.timeMs += dt;
    this.stepSpawn(dt, ev);
    for (const c of s.crawlers) c.z -= (c.speed * dt) / 1000;
    this.stepBites(ev);
    this.checkRepelled(ev);
  }

  private stepSpawn(dt: number, ev: BoardingEvent[]): void {
    const s = this.state;
    if (s.remaining <= 0) return;
    this.spawnTimerMs = Math.max(0, this.spawnTimerMs - dt);
    if (this.spawnTimerMs > 0 || s.crawlers.length >= BOARDING_MAX_ALIVE) return;
    this.pendingKind ??= this.rng.pick(CRAWLER_KINDS);
    const kind = this.pendingKind;
    const speed = (CRAWLER_SPEED[kind] * this.speedScale * 1000) / APPROACH_MS;
    const free = BOARDING_LANES.filter((lane) => s.crawlers.every((c) => c.lane !== lane || laneClear(c, speed)));
    if (free.length === 0) return;
    const crawler: Crawler = {
      id: this.nextId++,
      fact: this.facts[this.facts.length - s.remaining],
      kind,
      lane: this.rng.pick(free),
      z: 1,
      speed,
      spawnedAt: s.timeMs,
    };
    this.pendingKind = null;
    s.remaining--;
    s.crawlers.push(crawler);
    this.spawnTimerMs = BOARDING_SPAWN_MS / this.speedScale;
    ev.push({ type: 'spawn', crawler });
  }

  private stepBites(ev: BoardingEvent[]): void {
    const s = this.state;
    const biters = s.crawlers.filter((c) => c.z <= 0).sort((p, q) => p.z - q.z || p.id - q.id);
    for (const c of biters) {
      this.remove(c);
      c.z = 0;
      this.wronged.delete(c.id);
      s.bites++;
      this.records.push({ factId: c.fact.statId, outcome: 'missed', responseMs: s.timeMs - c.spawnedAt });
      ev.push({ type: 'bite', crawler: c });
      if (s.bites >= s.maxBites) {
        s.phase = 'overrun';
        s.input = '';
        ev.push({ type: 'overrun' });
        return;
      }
    }
  }

  private checkRepelled(ev: BoardingEvent[]): void {
    const s = this.state;
    if (s.phase !== 'fighting' || s.remaining > 0 || s.crawlers.length > 0) return;
    s.phase = 'repelled';
    s.input = '';
    ev.push({ type: 'repelled' });
  }

  private remove(c: Crawler): void {
    const i = this.state.crawlers.indexOf(c);
    if (i >= 0) this.state.crawlers.splice(i, 1);
  }

  // ---------------------------------------------------------------- input (as BattleSim)

  typeDigit(d: number): void {
    const s = this.state;
    if (s.phase !== 'fighting' || !Number.isInteger(d) || d < 0 || d > 9) return;
    const negative = s.input.startsWith('-');
    const digits = negative ? s.input.slice(1) : s.input;
    if (digits.length >= MAX_INPUT_DIGITS) return;
    const nextDigits = digits === '0' ? String(d) : digits + String(d);
    s.input = (negative ? '-' : '') + nextDigits;
  }

  toggleSign(): void {
    const s = this.state;
    if (s.phase !== 'fighting') return;
    if (!s.crawlers.some((c) => c.fact.answer < 0)) return;
    s.input = s.input.startsWith('-') ? s.input.slice(1) : `-${s.input}`;
  }

  backspace(): void {
    const s = this.state;
    if (s.phase !== 'fighting') return;
    s.input = s.input.slice(0, -1);
  }

  submit(): BoardingEvent[] {
    const s = this.state;
    if (s.phase !== 'fighting') return [];
    const digits = s.input.startsWith('-') ? s.input.slice(1) : s.input;
    if (digits.length === 0) return [];
    const typed = Number(s.input);
    const ev: BoardingEvent[] = [];
    s.input = '';
    const target = nearest(s.crawlers.filter((c) => c.fact.answer === typed));
    if (target) {
      const responseMs = s.timeMs - Math.max(target.spawnedAt, this.lastSubmitAt);
      const wasWrong = this.wronged.has(target.id);
      const outcome: Outcome = wasWrong ? 'slow' : classify(target.fact, true, responseMs);
      const fast = !wasWrong && responseMs <= fastThresholdMs(target.fact);
      this.remove(target);
      this.wronged.delete(target.id);
      s.kills++;
      this.records.push({ factId: target.fact.statId, outcome, responseMs });
      ev.push({ type: 'kill', crawler: target, fast });
      this.lastSubmitAt = s.timeMs;
      this.checkRepelled(ev);
      return ev;
    }
    const victim = nearest(s.crawlers);
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
}

/**
 * A new crawler (z 1, `speed`) may share a lane with `c` only if the gap stays >= LANE_GAP_Z
 * until `c` reaches the turret: the smallest gap is 1 - c.z now, or 1 - speed * c.z / c.speed
 * when the new one is faster.
 */
function laneClear(c: Crawler, speed: number): boolean {
  const limit = 1 - LANE_GAP_Z;
  return c.z <= limit && speed * c.z <= limit * c.speed;
}
