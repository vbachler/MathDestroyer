# MathDestroyer — Architecture

Space defence game that trains arithmetic. The player is a commander defending planets of
the Meridian Reach; solving the problem on an enemy ship breaks its shield. The star map is
the mastery map: systems are skills, planets are number ranges, planet colour is mastery.

This file is the contract between modules. If code and this file disagree, fix one of them
in the same change.

## Milestone 1 scope (vertical slice)

In: campaign loop (star map -> mission -> between-wave upgrades -> results -> station shop),
all eight skill systems as data, per-fact mastery tracking with spaced repetition, distress
calls, parent mastery grid, settings, Croatian (default) and English, keyboard and on-screen
keypad, procedural visuals and synthesised sound effects.

Out (later milestones): story briefings and voice, playable commanders, bosses, special
power-up enemies, endless and practice modes, daily challenge, generated art and 3D ships,
portrait phone layout.

## Stack

- TypeScript (strict), Vite, Phaser **3.90.0** (pinned; Phaser 4 exists but v3 is the
  better-known API, and all Phaser use is isolated in `scenes/`, `ui/`, `fx/`, `audio/`).
- Vitest for unit tests of `core/`.
- No other runtime dependencies. No network calls at runtime. No external assets in M1.
- npm scripts: `dev`, `build` (runs `tsc --noEmit` then `vite build`), `test`, `typecheck`.

## Layering rule

```
core/      pure TypeScript. No Phaser, no DOM, no Date.now(), no Math.random(), no localStorage.
           Time and randomness are passed in. Everything here is unit tested.
scenes/    Phaser scenes. Render core state, forward input to core. No game rules here.
ui/ fx/ audio/   Phaser helpers shared by scenes.
```

`core/` never imports from the other folders. Scenes never implement rules (scoring, mastery,
spawn logic, costs); they call `core/`.

## Folder layout

```
index.html
src/
  main.ts                 Phaser game config, scene registration
  app.ts                  App singleton: save data, locale, services shared by scenes
  core/
    types.ts              shared types (below)
    rng.ts                seeded RNG (mulberry32): createRng(seed) -> { next(): number; int(min,max); pick(arr); shuffle(arr) }
    content.ts            SECTORS / SYSTEMS / PLANETS of the galaxy and their lookups (data only)
    factgen.ts            fact generation per sector, chunk / group sizes
    names.ts              seeded syllable name generator, stableHash
    layout.ts             galaxy layout math (sector spiral, system scatter, hues)
    galaxy.ts             re-exports the layout; territory (hold, under attack, mastery means)
    facts.ts              factsForPlanet(planetId) -> Fact[]; factById(id); formatProblem(fact, locale)
    mastery.ts            per-fact stats, Leitner boxes, planet mastery, due facts
    scheduler.ts          which fact to spawn next (mission pool, review facts)
    story.ts              calls (defend / liberate / patrol), skill intros
    battle.ts             BattleSim: the whole mission simulation, no rendering
    upgrades.ts           in-mission upgrade definitions, offers, effects
    economy.ts            credits, station modules, prices
    save.ts               SaveData, defaults, migrate, serialise; Storage adapter interface
    i18n.ts               t(key, params), number and operator formatting per locale
  locales/
    hr/common.json  hr/battle.json  hr/meta.json
    en/common.json  en/battle.json  en/meta.json
  scenes/
    BootScene.ts  MenuScene.ts  StarMapScene.ts  StationScene.ts
    MasteryScene.ts  SettingsScene.ts
    BattleScene.ts  UpgradeScene.ts  ResultsScene.ts
  ui/
    theme.ts              colours, font families, sizes, spacing
    Button.ts  Panel.ts  Keypad.ts  TextStyles.ts
  fx/
    Starfield.ts  textures.ts (procedural textures generated at boot)  Explosion.ts
  audio/
    Sfx.ts                WebAudio synthesised effects: laser, hit, miss, wrong, upgrade, click, alarm
tests/
  *.test.ts               one file per core module
```

Locale file ownership: `common.json` = menus, settings, shared words; `battle.json` = battle,
upgrades, results; `meta.json` = star map, station, mastery view, content names.

## Screen

Logical resolution 1280x720, landscape, `Phaser.Scale.FIT` with `CENTER_BOTH`. All positions
are in logical pixels. Portrait layout is a later milestone.

## Core types (`core/types.ts`)

```ts
export type Locale = 'hr' | 'en';
export type SkillId =
  | 'typing' | 'addition' | 'subtraction' | 'multiplication'
  | 'division' | 'negatives' | 'missing' | 'mixed';
export type Op = 'type' | 'add' | 'sub' | 'mul' | 'div';

/** One practisable item. The id is stable forever; it is the key in the save file. */
export interface Fact {
  id: string;            // e.g. "mul:7x8", "add:6+7", "sub:15-8", "div:56/7", "type:42",
                         // "miss:mul:7x?=56", "miss:add:?+7=13"
  planetId: string;
  op: Op;
  a: number;             // left operand (for 'type': the number itself)
  b: number;             // right operand (for 'type': 0)
  result: number;        // value of a op b
  unknown: 'result' | 'a' | 'b';   // which part the player types
  answer: number;        // the number the player must type (may be negative)
}

export interface PlanetDef {
  id: string;            // "mul-7"
  systemId: SkillId;
  nameKey: string;       // i18n key in meta.json
  order: number;         // position inside the system, 0-based
}
export interface SystemDef {
  id: SkillId;
  nameKey: string;
  order: number;         // 0..7
  planets: PlanetDef[];
}

export interface FactStats {
  box: number;           // Leitner box 0..5
  attempts: number;
  correct: number;
  avgMs: number;         // running mean of response time for correct answers
  lastSeen: number;      // epoch ms, 0 = never
  dueAt: number;         // epoch ms
}
```

## Content (`core/content.ts`, `core/facts.ts`)

Eight systems in this order. Planet ids in brackets.

1. **typing** — `type-1` digits 0–9; `type-2` numbers 10–99 (sample of 30, fixed list chosen
   by seeded RNG with seed 1 so ids are stable); `type-3` numbers 100–999 (sample of 30, seed 2).
2. **addition** — `add-10` sums up to 10 (a,b in 0..10, a+b<=10); `add-20` a,b in 2..10 with
   sum 11..20; `add-100` a in 11..89 step chosen, b in 2..9, sum<=100 (fixed sample of 40, seed 3).
3. **subtraction** — `sub-10` a in 0..10, b<=a; `sub-20` a in 11..20, b in 2..10, result>=0;
   `sub-100` a in 21..100, b in 2..9 (fixed sample of 40, seed 4).
4. **multiplication** — `mul-2` … `mul-10`: nine planets; planet `mul-n` holds n x k for k in 1..10.
5. **division** — `div-2` … `div-10`: planet `div-n` holds (n*k) / n for k in 1..10.
6. **negatives** — `neg-10` a,b in -10..10 for add and sub where at least one operand or the
   result is negative (fixed sample of 40, seed 5); `neg-20` same in -20..20 (sample of 40, seed 6).
7. **missing** — `miss-add` (`? + b = c` and `a + ? = c`, sums up to 20, sample 40, seed 7);
   `miss-sub` (`a - ? = c`, a up to 20, sample 40, seed 8); `miss-mul` (`a x ? = c`, tables 2..10,
   sample 40, seed 9); `miss-div` (`c / ? = a`, sample 40, seed 10).
8. **mixed** — `mix-1`: no facts of its own. A mission here draws from every unlocked planet
   of all other systems. `factsForPlanet('mix-1')` returns `[]`.

Rules: fact ids are unique across the game; `factsForPlanet` is deterministic (same list every
call, every run). Answers are integers.

`formatProblem(fact, locale)` returns the string shown on the enemy, with `?` for the unknown
when the unknown is an operand, and no `= ?` suffix when the unknown is the result:
`7 · 8` (hr) / `7 × 8` (en); `56 : 7` (hr) / `56 ÷ 7` (en); `7 · ? = 56`; negatives in
brackets when they are the right operand: `5 − (−3)`. Use the real minus sign `−` for display.
For `type` facts the string is the number itself.

## Mastery (`core/mastery.ts`)

```ts
export const BOX_INTERVAL_MS = [0, 2*60e3, 24*3600e3, 3*24*3600e3, 7*24*3600e3, 21*24*3600e3];
export const MASTERED_BOX = 4;

export type Outcome = 'fast' | 'slow' | 'wrong' | 'missed';
/** fast threshold: 3000 ms + 700 ms per digit of the answer beyond the first. */
export function classify(fact: Fact, correct: boolean, responseMs: number): Outcome;
export function emptyStats(): FactStats;
/** Promotion happens only when the fact is due (now >= s.dueAt; a never-seen fact is due):
 *  fast and due: box+1 (max 5), dueAt = now + BOX_INTERVAL_MS[box].
 *  fast and not due: box and dueAt unchanged (only the counters and avgMs change), so a fact
 *  cannot climb several boxes inside one sitting; real mastery needs returning on later days.
 *  slow: box 0 becomes 1 with a new dueAt; otherwise box and dueAt unchanged.
 *  wrong: box-1 (min 0). missed (enemy reached the planet): box-2 (min 0). Demotions always
 *  apply and set dueAt = now + BOX_INTERVAL_MS[box]. */
export function applyOutcome(s: FactStats, o: Outcome, responseMs: number, now: number): FactStats;
export function isMastered(s: FactStats | undefined): boolean;         // box >= MASTERED_BOX
export function factLevel(s: FactStats | undefined): number;           // box/5, 0 if undefined
export function planetMastery(planetId: string, stats: Record<string, FactStats>): number; // mean factLevel
export function systemMastery(systemId: SkillId, stats: Record<string, FactStats>): number;
/** Facts of the planet seen before (attempts>0) whose dueAt <= now. */
export function dueFacts(planetId: string, stats: Record<string, FactStats>, now: number): Fact[];
/** Mastery -> colour band: 0 'unlit' (<0.10), 1 'weak' (<0.35), 2 'learning' (<0.6),
 *  3 'good' (<0.85), 4 'mastered'. */
export function masteryBand(level: number): 0 | 1 | 2 | 3 | 4;
```

All functions are pure and return new objects.

## Scheduler (`core/scheduler.ts`)

```ts
/** Builds the question queue for one wave. Weights: due and seen 4, never seen 3, box 0-1 3,
 *  box 2-3 2, box 4-5 1. No fact appears twice in a row. For 'mix-1' the pool is every fact of
 *  every unlocked planet. Never more than 2 never-seen facts are introduced per wave beyond the
 *  first wave's 4, so new material arrives gradually. */
export function buildWaveQueue(args: {
  planetId: string; count: number; stats: Record<string, FactStats>;
  unlockedPlanetIds: string[]; now: number; rng: Rng; waveIndex: number;
}): Fact[];

/** A planet is in distress when it has >= 3 due facts and planetMastery >= 0.2.
 *  Returns planet ids, most due facts first, at most `max`. */
export function distressCalls(stats: Record<string, FactStats>, unlockedPlanetIds: string[],
                              now: number, max: number): string[];

/** Unlock rule: the first planet of 'typing' is always unlocked. A planet unlocks when the
 *  previous planet in the same system has planetMastery >= 0.4. The first planet of a system
 *  unlocks when the previous system's systemMastery >= 0.4. 'mix-1' unlocks when at least
 *  two other systems have systemMastery >= 0.4. If `unlockAll` is true, everything is unlocked. */
export function unlockedPlanets(stats: Record<string, FactStats>, unlockAll: boolean): string[];
```

## Battle simulation (`core/battle.ts`)

The scene owns a `BattleSim`, calls `update(dtMs)` every frame, forwards input, and renders
`sim.state` plus the events returned by each call. The sim never touches Phaser.

Field: logical 1280x720. Enemies spawn at y = 60 and move straight down to y = 600 (the planet
surface). Six lanes with x centres at 140, 340, 540, 740, 940, 1140. Four domes on the surface
at x = 240, 507, 773, 1040; an enemy damages the dome nearest to its lane x.

```ts
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
  energy: number;
  kills: number;
  wrongAnswers: number;
  ownedUpgrades: Record<string, number>;   // upgradeId -> tier
  missed: Fact[];           // facts that reached the planet (unique, in order)
  explaining: Fact | null;  // set while phase === 'explaining'
  autoTurretCooldownMs: number;
}

export type BattleEvent =
  | { type: 'spawn'; enemy: Enemy }
  | { type: 'kill'; enemy: Enemy; fast: boolean; byTurret: boolean; points: number }
  | { type: 'wrong'; typed: number }
  | { type: 'impact'; enemy: Enemy; domeIndex: number; destroyed: boolean }
  | { type: 'repair'; domeIndex: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'explainStart'; fact: Fact }
  | { type: 'explainEnd' }
  | { type: 'won' } | { type: 'lost' };

/** One recorded answer, applied to mastery by the caller after the mission. */
export interface AnswerRecord { factId: string; outcome: Outcome; responseMs: number; }

export interface BattleConfig {
  planetId: string;
  totalWaves: number;                         // campaign missions: 5
  stats: Record<string, FactStats>;           // read-only snapshot at mission start
  unlockedPlanetIds: string[];
  modules: Record<string, number>;            // station modules owned: moduleId -> tier
  now: number;                                // epoch ms at mission start
  seed: number;
  speedScale: number;                         // 0.5 | 0.75 | 1 | 1.25 from settings.gameSpeed
  density?: number;                           // settings.density, default 1 (see "Settings v7")
}

export class BattleSim {
  constructor(cfg: BattleConfig);
  readonly state: BattleState;
  readonly records: AnswerRecord[];
  update(dtMs: number): BattleEvent[];
  typeDigit(d: number): void;                 // appends; ignored when input is full
  toggleSign(): void;                         // only matters when any live enemy has a negative answer
  backspace(): void;
  submit(): BattleEvent[];                    // empty input: no-op, returns []
  /** Offers for the between-wave shop; valid only in phase 'waveCleared'. */
  offers(): UpgradeOffer[];
  buyUpgrade(upgradeId: string): boolean;     // spends energy; false if unaffordable or not offered
  nextWave(): BattleEvent[];                  // leaves 'waveCleared'
}
```

Rules, all implemented in the sim:

- **Waves**: wave w spawns `6 + 2*w` enemies (8, 10, 12 over a 3-wave mission; raised after
  play-testing because waves ended too soon). Spawn interval `max(1800, 3600 - 250*w) / speedScale` ms.
  Base speed `(20 + 3*w) * speedScale` px/s, with a random factor 0.9–1.1 per enemy.
  `speedScale` comes from `BattleConfig` (the player's game-speed setting: 0.5 / 0.75 slower, 1 normal,
  1.25 fast). At most 4 enemies alive (default density; see "Settings v7");
  spawning pauses while at the cap. Lanes are chosen so two enemies do not overlap (no spawn in a
  lane whose newest enemy is above y = 200).
- **Submit**: if one or more live enemies have `fact.answer === typed value`, destroy the one
  with the greatest y (FR-03). Otherwise it is a wrong answer.
- **Correct**: `fast` per `classify`. Points `10 + (fast ? 5 : 0) + min(streak, 20)`, times the
  score multiplier from upgrades. Streak +1. Energy +1, +1 more if fast. Record outcome.
- **Wrong**: streak = 0, score = max(0, score - 5), `wrongAnswers`+1, input cleared. The wrong
  answer is recorded against the lowest live enemy's fact as `wrong` (once per enemy; an enemy
  that was answered wrongly and later correctly records only `slow`, never `fast`).
- **Impact** (enemy reaches y >= 600): nearest dome with hp > 0 loses 1 hp (if the nearest is
  destroyed, the next nearest standing one). Streak = 0. Fact recorded as `missed` and added to
  `missed`. Phase becomes `explaining` for 2500 ms with `explaining = fact`; during it enemies
  do not move and nothing spawns, input is ignored. Then phase returns to `spawning`.
  If no dome has hp > 0 after the impact, phase = `lost` (skip the explanation).
- **Domes**: 4 domes, maxHp 2, plus the hull module tier added to maxHp.
- **Repair**: every time streak reaches a multiple of 10, the most damaged dome gains 1 hp
  (destroyed domes can be rebuilt this way). Emits `repair`.
- **Wave end**: when all enemies of the wave are spawned and none are alive: if wave ===
  totalWaves, phase = `won`; else phase = `waveCleared`.
- **Auto-turret** (upgrade): every cooldown, destroys the lowest live enemy whose fact is
  mastered in `cfg.stats` (`isMastered`). It never fires on a non-mastered fact. Turret kills
  give 5 points, no energy, no streak change, and are **not** recorded (no mastery credit).
- `input` accepts up to 4 digits; a leading `-` is toggled by `toggleSign`.
- Deterministic: same config and same sequence of calls gives the same result.

## Upgrades (`core/upgrades.ts`) — in-mission, bought with energy

```ts
export interface UpgradeDef { id: string; nameKey: string; descKey: string; maxTier: number; costs: number[]; }
export interface UpgradeOffer { def: UpgradeDef; nextTier: number; cost: number; affordable: boolean; }
export const UPGRADES: UpgradeDef[];
```

| id | Effect per tier | Costs |
| --- | --- | --- |
| `slowField` | enemy speed x0.90 / x0.82 / x0.75 | 6, 10, 15 |
| `autoTurret` | fires every 7 s / 5 s / 3.5 s on mastered facts only | 8, 12, 18 |
| `overcharge` | score x1.25 / x1.5 / x2 | 5, 9, 14 |
| `salvage` | mission credits +20% / +40% / +60% | 5, 9, 14 |
| `repairDrone` | repairs 1 hp on the most damaged dome at each wave start, tier = hp repaired | 7, 11, 16 |
| `collector` | +1 / +2 / +3 energy per wave cleared | 4, 8, 12 |

`offers()` returns 3 distinct upgrades that are not at max tier, chosen by the sim's RNG.
Upgrades last for the mission only.

## Economy (`core/economy.ts`) — between missions, bought with credits

```ts
export interface ModuleDef { id: string; nameKey: string; descKey: string; maxTier: number; costs: number[]; }
export const MODULES: ModuleDef[];
export function missionCredits(args: { score: number; won: boolean; domesStanding: number;
                                       salvageTier: number; }): number;
export function buyModule(save: SaveData, moduleId: string): SaveData | null; // null if unaffordable or maxed
```

`missionCredits` = `round((score/10 + (won ? 30 : 0) + 5*domesStanding) * (1 + 0.2*salvageTier))`.

| id | Effect per tier | Costs |
| --- | --- | --- |
| `hull` | +1 dome hp per tier | 150, 400, 900 |
| `reactor` | start each mission with 3 / 6 / 9 energy | 100, 300, 700 |
| `targeting` | fast-answer threshold +10% / +20% / +30% for scoring only (not for mastery) | 120, 350, 800 |

## Save (`core/save.ts`)

```ts
export interface SaveData {
  version: 1;
  locale: Locale;                 // default 'hr'
  credits: number;
  modules: Record<string, number>;
  stats: Record<string, FactStats>;
  settings: { sfxVolume: number; musicVolume: number; unlockAll: boolean; keypadAlwaysVisible: boolean;
              gameSpeed: 0.5 | 0.75 | 1 | 1.25;
              density: 0.5 | 0.75 | 1 | 1.25; };   // both default 1; loadSave fills them for older saves
  totals: { missions: number; wins: number; bestScore: Record<string, number> }; // bestScore by planetId
}
export interface StorageAdapter { getItem(k: string): string | null; setItem(k: string, v: string): void; }
export const SAVE_KEY = 'mathdestroyer.save.v1';
export function defaultSave(): SaveData;
export function loadSave(storage: StorageAdapter): SaveData;   // tolerant: bad JSON -> defaultSave()
export function writeSave(storage: StorageAdapter, save: SaveData): void;
/** Applies mission results: mastery records, credits, totals. Pure. */
export function applyMission(save: SaveData, args: { planetId: string; records: AnswerRecord[];
  credits: number; score: number; won: boolean; now: number }): SaveData;
```

No personal data. Nothing leaves the device.

## i18n (`core/i18n.ts`)

```ts
export function createI18n(dicts: Record<Locale, Record<string, string>>, locale: Locale): I18n;
export interface I18n { locale: Locale; setLocale(l: Locale): void;
  t(key: string, params?: Record<string, string | number>): string; }
```

Keys are flat dotted strings (`battle.wave`), params as `{name}`. Missing key: return the key
and `console.warn` once. Both locales must have the same key set (a test checks this).
Croatian is the default; the language can be switched in Settings at any time and applies
immediately. Croatian text must be natural, correctly inflected Croatian with diacritics.

## App singleton (`app.ts`)

```ts
export const app: {
  save: SaveData;                    // loaded at boot; call app.persist() after changing
  i18n: I18n;
  sfx: Sfx;
  persist(): void;
  now(): number;                     // Date.now(), the only place it is called
};
```

## Scene flow

```
Boot -> Menu -> StarMap -> Battle <-> Upgrade (overlay between waves)
                  |           '-> Results -> StarMap
                  +-> Station (shop)
                  +-> Mastery (parent view)
        Menu -> Settings
```

Scene keys are the class names without "Scene" (`'Battle'`, `'StarMap'`, …).
`Battle` is started with `{ planetId: string }`. `Results` receives
`{ planetId, won, score, credits, missed: Fact[], accuracy, bestStreak, masteryBefore, masteryAfter }`.
`Upgrade` is launched over `Battle` with `{ sim: BattleSim }` and resumes it by calling
`sim.nextWave()`.

- **StarMap**: eight systems laid out left to right as a route; selecting a system shows its
  planets. Planet colour = `masteryBand`. Locked planets are dim and not selectable. Planets
  returned by `distressCalls` pulse and show a distress marker; a side panel lists distress
  calls. Launch button starts `Battle`.
- **Battle**: renders the sim. Enemy ships carry the problem text in a large, high-contrast
  label. Keyboard: digits, `-`, Backspace, Enter/Space submit, Esc/P pause. On-screen keypad
  (digits, sign, backspace, fire) is shown on touch devices or when the setting is on.
  HUD: wave, score, streak, energy, dome status, current input. Explanation overlay during
  `explaining`: the full fact with its answer, plus a dot array for multiplication when both
  factors are <= 10.
- **Mastery** (parent view): a tab per system. Multiplication and division show a 9x10 grid
  (table x multiplier); other systems show one cell per fact grouped by planet. Cell colour by
  box (0 grey, 1 red, 2 orange, 3 yellow, 4 light green, 5 green); tapping a cell shows attempts,
  accuracy and average time. Colours must also be distinguishable without colour: show the box
  number inside the cell.

## Visual and audio direction (M1 placeholders)

Serious space-sim mood: near-black blue background, thin cyan/amber HUD lines, monospace-like
numerals for problems. All graphics are generated in code (Phaser Graphics -> textures at
boot): starfield with parallax, planet horizon with atmosphere glow, simple angular enemy
ships, laser beam, particle explosion. Sound effects are synthesised with WebAudio. Fonts:
system font stack only in M1 (no network).

Accessibility: problem text at least 28 px logical with a dark backing plate; no information
by colour alone; no full-screen flashes.

## Milestone 2: visual redesign (supersedes "Visual and audio direction" above)

Player feedback on M1: the code-drawn look reads as generic and cartoonish, everything is too
big and too close, there is too much text, and the story is missing. M2 replaces the look and
adds the story layer. Game rules do not change.

### Direction

Realistic hard science fiction space simulator, dark and serious, with an industrial
1979-style retro-futurist interior feel (CRT glow, worn metal). Original designs only: take
the mood, never copy a recognisable ship, logo or interface from an existing game or film.

Three rules drive every screen:

1. **Vastness.** Wide shots. Objects are small against a large, mostly empty space. Nothing
   important is larger than it needs to be to stay legible.
2. **Real images, not line drawings.** Backgrounds, ships, stations, planets and portraits are
   image assets. Code draws only light: beams, glows, particles, thin HUD lines.
3. **Almost no text.** A screen states a thing once, in a few words. No explanatory
   sentences, no hints, no flavour paragraphs outside the Briefing screen. Prefer a number, an
   icon drawn as a simple glyph, a bar or a ring. Budget: battle shows no sentence at all;
   other screens at most one short line (<= 60 characters) outside of labels.

### Assets

Raw generated art lives in `art-src/` (not shipped). `tools/process-art.mjs` (Node + sharp,
dev dependency) turns it into shipped files under `public/assets/`; it is re-runnable and
deterministic. `npm run art` runs it.

| Source (`art-src/*.png`) | Output (`public/assets/`) | Processing |
| --- | --- | --- |
| `bg_battle_ocean`, `bg_battle_desert`, `bg_battle_ice`, `bg_menu`, `bg_starmap`, `bg_bridge`, `bg_ftl`, `station_shop_bg` | `bg/<name>.jpg` | centre-crop to 16:9, resize 1920x1080, JPEG q86 |
| `dash_strip` | `ui/dash.png` | make the pure-black area above the dashboard transparent (threshold + soft edge), trim, width 1920 |
| `ship_enemy_a`, `ship_enemy_b`, `ship_enemy_c`, `ship_player`, `station_orbital` | `ships/<name>.png` | green chroma key to alpha with despill and a 1–2 px feathered edge, trim to content, fit inside 256x256 |
| `planet_1` … `planet_8` | `planets/<name>.png` | detect the disc on black, circular alpha mask with soft edge, trim, 256x256 |
| `portrait_tarrow`, `portrait_kito`, `portrait_abacus` | `portraits/<name>.jpg` | centre-crop square, 384x384, JPEG q86 |

`src/fx/assets.ts` exports `IMG` (texture key constants for every output) and
`preloadAssets(scene)`; `BootScene` preloads them with a thin progress bar. The procedural
textures in `fx/textures.ts` stay only for particles, glow and the laser.

Fonts are bundled, never fetched: `@fontsource/rajdhani` (UI) and
`@fontsource/share-tech-mono` (numerals, CRT text), both SIL Open Font License. `BootScene`
waits for `document.fonts` to be ready before starting the menu.

### Theme v2 (`ui/theme.ts`)

Amber is the primary HUD colour, teal the secondary, off-white for body text, deep
near-black for backing. Mastery band and box colours stay distinguishable and keep their
numbers. Sizes shrink: hero 54, title 30, heading 20, body 16, label 13, small 11, problem
24, input 30. Lines are 1 px. Panels are almost invisible: a faint dark backing and a thin
amber corner bracket, no filled boxes with borders. Buttons are small and flat (default
180x40), text in caps with letter spacing.

### Battle screen v2

- Background: one of `bg_battle_*` chosen by system order (`order % 3`), full screen, with a
  very slow drift. The planet limb at the bottom belongs to the image.
- First-person framing: `ui/dash.png` sits along the bottom (about 120 px tall in logical
  units). The HUD lives on it as small amber readouts: wave, score, streak, energy on the
  side screens, the typed answer on the centre screen. No floating HUD panels at the top.
  A small pause glyph button sits in the top-right corner.
- Stations: the four defended objects are `ships/station_orbital.png`, about 58 px wide, at
  `DOME_X`, y = 548, above the planet limb. hp as tiny pips under each; damage shows as
  flicker, sparks and a darker tint; destroyed = dark wreck tint with drifting debris
  particles.
- Enemies: `ship_enemy_a/b/c` by `enemy.id % 3`, about 34 px wide at spawn growing to about
  52 px at the bottom (scale with y for depth), faint engine glow. The problem is a compact
  tag beside the ship joined by a hairline: numerals at 24 px (never smaller), dark backing,
  thin amber frame. The tag flips side to stay on screen and avoid overlapping its neighbour.
- Lasers: two thin beams from the lower-left and lower-right corners of the view (the ship's
  guns) converging on the target, a small flash, then the explosion and debris. A turret kill
  uses one teal beam from the nearest station.
- **Wrong answer**: the guns still fire, and miss. Both beams converge on a point 40–70 px
  beside the lowest enemy and fade into space; play `sfx.laser()` then `sfx.wrong()`.
  No points text. Scene-only behaviour; the sim is unchanged.
- Banners are one or two words in small caps ("VAL 2", "OBRANJENO"), never a sentence.
- Explanation card: keep the visual explanation, shrink it (about 420x260), solved fact and
  the dot array or number line only; no sentence.

### Meta screens v2

- **Menu**: `bg_menu` full screen, title small in the lower-left, three small buttons under
  it, language toggle top-right. No tagline paragraph.
- **StarMap**: `bg_starmap` full screen. The eight systems are small glowing nodes spread
  across the whole screen along a thin amber route; names in small caps. Selecting one shows
  its planets as `planets/planet_N.png` sprites (about 46 px; planet image chosen by a stable
  hash of the planet id) on thin orbit arcs around it. Mastery is a thin ring around each
  planet plus the percentage; locked planets are dark with a lock glyph. Distress planets
  pulse with an amber ring. One small corner readout for the selected planet (name,
  percentage, mastered/total, due count as numbers with glyphs) and a small LAUNCH button.
  Credits as a number top-left. No explanatory lines; the distress list is at most three
  short rows (planet name + count).
- **Ftl** (new scene, key `'Ftl'`, data `{ planetId }`): the jump animation between StarMap
  and the mission, about 2.6 s, skippable by any key or click. Stars stretch from points into
  radial streaks while `bg_ftl` fades in, rotates slowly and scales up; a brightness swell (no
  white strobe) ends it; then the ship "drops out" onto the battle background. The dashboard
  stays visible at the bottom throughout. Then starts `'Briefing'` if one is due, else `'Battle'`.
- **Briefing** (new scene, key `'Briefing'`, data `{ planetId, storyKey }`): `bg_bridge` full
  screen; the message appears on the centre CRT in the mono font with a typewriter effect and
  a faint scanline overlay, the sender's portrait small beside it with their name. Any key or
  click completes the typing, the next one continues to `'Battle'`. This is the only screen
  where sentences are allowed, and a message is at most two short sentences.
- **Station**: `station_shop_bg` full screen, three compact module cards (name, tier pips,
  cost, BUY), credits as a number. The engineer's portrait small in a corner, no speech line.
- **Results**: battle background dimmed. Outcome in two words, four numbers (score, accuracy,
  streak, credits), mastery ring before -> after, missed facts as a compact grid of solved
  facts, one story line from `story.result.*`, two small buttons.
- **Mastery** (parent view) and **Settings** keep their structure, restyled with the new
  theme. The parent view may keep its legend and labels (it is a report, not the game).

### Rewards v2: one tap, nothing to read (rule change, supersedes "Upgrades" and energy above)

Player feedback: the between-wave shop made the player read descriptions, tiers and prices.
A reward must feel like a gift, not homework.

- **Energy is removed from the game**: no energy state, HUD readout, costs, or
  `affordable`. `BattleState.energy`, `UpgradeDef.costs`, `UpgradeOffer.cost/affordable` and
  `buyUpgrade` go away.
- After each cleared wave the sim offers three upgrades. The player picks **one**, free:
  `sim.pickUpgrade(upgradeId): BattleEvent[]` raises that upgrade one tier and starts the next
  wave (it replaces `buyUpgrade` + `nextWave`; `nextWave()` remains for the case where no
  upgrade can be offered because everything is at max tier).
- Upgrades (max tier 3, effects as before): `slowField`, `autoTurret`, `overcharge`,
  `salvage`, `repairDrone`, and new `shield` (the first impact of each wave is absorbed;
  tier = number of impacts absorbed per wave; an absorbed impact destroys the enemy, costs
  no hp, does not reset the streak, but the fact is still recorded as `missed` and
  explained). `collector` is deleted. `BattleEvent` gains
  `{ type: 'shieldBlock'; enemy: Enemy; domeIndex: number }`.
- Station modules: `hull` and `targeting` as before; `reactor` is replaced by `headStart`
  (start each mission with 1 / 2 / 3 random upgrades at tier 1, chosen by the mission RNG;
  costs 100, 300, 700). `SaveData.modules` entries for `reactor` are dropped by `loadSave`.
- **Upgrade screen**: three cards, each a picture (`icons/<upgradeId>.jpg`), a name of at
  most two words, and tier pips. No description, no price, no buttons: tapping a card (or
  pressing 1, 2, 3) picks it, plays a short "installed" animation on the card (about 500 ms)
  and returns to the battle. Whole interaction: one tap.
- **Station screen**: same card style with a price number; one line of at most six words
  per module is allowed under the name.
- Icon sources in `art-src/`: `icon_slowField`, `icon_autoTurret`, `icon_overcharge`,
  `icon_salvage`, `icon_repairDrone`, `icon_shield`, `icon_hull`, `icon_targeting`,
  `icon_headStart` → `public/assets/icons/<id>.jpg`, centre-crop square, 256x256, JPEG q86.

### Guided star map (supersedes the StarMap, Ftl and Briefing bullets above)

Player feedback: the map must lead, not ask the player to study it. The game proposes the
next mission as an incoming call; the player presses GO.

- `core/story.ts` gains `nextMission(save, now) -> { planetId: string; reason: 'distress' |
  'frontier' | 'review' }`: a planet in distress first (most due facts); otherwise the
  frontier (the furthest unlocked planet, by system order then planet order, whose
  `planetMastery` is below the unlock threshold); otherwise the unlocked planet with the
  lowest mastery.
- `briefingFor` always returns a message for a planet: the system intro if that system has
  not been seen, else a distress line if the planet is in distress, else one of
  `story.next.1..3` (stable hash of planet id). Senders: `story.next.from`.
- **StarMap flow**: on entry the map shows the whole sector for a moment, then the camera
  eases toward the proposed planet (pan + slight zoom, about 1.2 s) while a short radio
  chirp plays (`sfx.alarm()` for distress). A compact **call card** slides in: sender
  portrait (small), sender name, the one message, the planet picture with its mastery ring
  and name, and one large button: **IDI / GO** (Enter or Space also works). If a voice clip
  exists for the message (`public/assets/voice/<lang>/<storyKey>.mp3` or `.wav`, falling
  back to `en`), it plays once; a missing clip is silent, not an error.
  That is the whole screen. The player can still click any unlocked planet on the map to
  retarget the call card to it (the card then shows that planet and its message), but
  nothing asks them to.
- Small corner controls only: credits number, hangar glyph (Station), report glyph
  (Mastery), menu glyph. No lists, no side panels.
- **GO** starts `'Ftl'` with `{ planetId }`, marks a system intro as seen, and `'Ftl'` goes
  straight to `'Battle'`. There is no separate Briefing scene; `bg_bridge` is unused for now.
- After a mission, Results returns to the map, which immediately proposes the next call, so
  the loop is: GO → jump → fight → result → GO.

### Galaxy map v3: free travel, sectors, star systems, planets (supersedes "Content", the unlock rule, and the linear route in "Guided star map")

Player feedback: the eight-node route is too simple and too linear. The player wants a big
galaxy of coloured sectors, each holding many star systems, to fly wherever they like, and to
receive missions and distress calls where they are. Hostile aliens hold territory. The player
showed three reference pictures from other games: a galaxy map of coloured translucent
territories with star points, and two system maps (a sun with labelled planets on orbit
lines, thin HUD framing). Use only those general ideas; shapes, icons, colours, layout,
names and logos must be our own.

**Structure: Skill (8) → Sector (about 27) → System (about 50) → Planet (about 170).**

```ts
export interface PlanetDef { id: string; systemId: string; sectorId: string; name: string;
                             orbit: number;        // 0-based orbit index inside its system
                             angle: number; }      // radians, starting position on the orbit
export interface SystemDef { id: string; sectorId: string; name: string; x: number; y: number;
                             sunHue: number; planets: PlanetDef[]; }
export interface SectorDef { id: string; skill: SkillId; nameKey: string; hue: number; order: number;
                             x: number; y: number; radius: number; systems: SystemDef[]; }
```

- A **planet** holds a small chunk of facts (target 6; chunks of 5–8) and is where a mission
  is fought. `Fact.planetId` keeps its name and meaning. A **system** is a sun with 3–5
  planets. The old `SystemDef` (one per skill) and old planet ids are replaced; fact ids do
  not change, so saved stats stay valid. `bestScore` is keyed by the new planet id; unknown
  keys in old saves are dropped.
- Sectors (id: content), each cut into planet chunks in a fixed deterministic order, then
  grouped into systems of 3–5 planets:
  - typing: `type-1` digits 0–9; `type-2` 10–99 (sample 30); `type-3` 100–999 (sample 30)
  - addition (revised after play-testing: the first version was mostly n+0 and n+1 and felt
    trivial). No fact has a zero operand. Five sectors by sum:
    `add-5` a,b >= 0, sum 1..5 (the only sector where a zero operand is allowed; 0+0 is
    excluded);
    `add-10` a,b >= 2, sum 6..10;
    `add-15` a,b >= 2 and both <= 13, sum 11..15;
    `add-50` sum 16..50, a in 6..44, b in 3..29, fixed sample of 42 with at least half
    needing a carry (units digits sum >= 10);
    `add-100` sum 51..100, a in 12..88, b in 6..59, fixed sample of 42 with at least half
    needing a carry.
    Within a sector the facts are shuffled with a fixed seed before chunking into planets,
    so a planet mixes easier and harder sums instead of grouping all the smallest together.
  - subtraction mirrors addition, no zero operand and no zero result:
    `sub-5` a in 2..5, 1 <= b < a;
    `sub-10` a in 6..10, 2 <= b <= a-2;
    `sub-15` a in 11..15, 2 <= b <= a-2;
    `sub-50` a in 16..50, b in 3..29, b <= a-3, fixed sample of 42 with at least half
    needing a borrow;
    `sub-100` a in 51..100, b in 6..59, fixed sample of 42 with at least half needing a borrow.
    Shuffled before chunking, like addition.
  - **Density rule (overrides the planet and system counts above, including the "one table
    per system with two planets" rule and the single-system exceptions).** The player found
    sectors with one system and one or two planets too empty. Every sector except `core` has
    **at least 3 systems**, and every system has **3 to 5 planets**; large sectors get more
    systems (about one system per 4 planets of unique chunks, never fewer than 3).
    A sector's facts are first cut into unique chunks as before. When those do not fill the
    required planets, the remaining planets are *mix planets*: seeded selections of 5–6 facts
    drawn from the whole sector, weighted toward facts that appear on the fewest planets so
    coverage stays even, never duplicating a fact inside one planet, and no two planets of a
    sector holding the identical set. A fact can therefore belong to several planets.
    `planetFactList(planetId)` is the source of truth for a planet's facts;
    `Fact.planetId` is the fact's primary (first) planet. Mastery, due facts, territory and
    mission pools for a planet all use the planet's fact list. The "at most one trivial fact
    per planet" balance limit applies to mix planets too.
    The world may grow beyond 4800x2700 if needed to keep the spacing and overlap limits.
  - `add-20` and `sub-20` no longer exist.
  - **Balance rule (overrides the "no zero operand", ">= 2" and "no zero result" limits
    above).** Easy facts are allowed in every addition and subtraction sector, but only as a
    small, fixed share, so a sector never feels trivial:
    - *trivial* facts (an operand of 0; for subtraction also a result of 0): at most 20% of
      the facts in `add-5` / `sub-5`, at most 10% in every other sector, and at least one
      where the range allows it;
    - facts with an operand of 1 (subtraction: b = 1, or result 1): at most 15% in every
      sector except `add-5` / `sub-5`, where they are unavoidable and unrestricted;
    - the easy facts are picked by the sector's seeded sample, balanced between left and
      right operand, and spread so that no planet holds more than one trivial fact.
    0+0 and 0−0 never appear.
  - multiplication: `mul-a` tables 2, 5, 10; `mul-b` tables 3, 4; `mul-c` tables 6, 7;
    `mul-d` tables 8, 9. Here a system is one table and has two planets (x1..x5, x6..x10).
  - division: `div-a` … `div-d`, mirroring multiplication
  - negatives: `neg-10`, `neg-20`
  - missing: `miss-add`, `miss-sub`, `miss-mul`, `miss-div`
  - mixed: `core`, one system with one planet that has no facts of its own; a mission there
    draws from every planet whose mastery is at least 0.4.
- **No locks.** Everything can be visited from the start. `unlockedPlanets`, the unlock
  thresholds and the `unlockAll` setting are removed.
- System and planet names are generated, pronounceable and original (seeded syllable
  generator, stable per id, unique across the galaxy); they are not translated. Sector names
  are i18n (`meta.sector.<id>`, e.g. "Zbrajanje do 5").

**Layout (`core/galaxy.ts`, pure, deterministic).** The galaxy is a 4800x2700 world. Sectors
are placed as clusters grouped by skill along a loose spiral, not a line; each sector gets a
centre, a radius that grows with its system count, and a hue (skills use distinct hue
families so neighbours differ). Systems are scattered inside their sector with a minimum
spacing. Same output on every run.

**Territory (`core/galaxy.ts`).**

```ts
export type Hold = 'hostile' | 'contested' | 'secured';
/** planetMastery < 0.2 hostile (held by the Static), < 0.6 contested, else secured. */
export function planetHold(planetId: string, stats: Record<string, FactStats>): Hold;
/** A planet is under attack when it is not hostile and has >= 2 due facts. */
export function underAttack(planetId: string, stats: Record<string, FactStats>, now: number): boolean;
export function systemMastery(systemId: string, stats: Record<string, FactStats>): number;
export function sectorMastery(sectorId: string, stats: Record<string, FactStats>): number;
```

**Calls (`core/story.ts`, replaces `nextMission`).**

```ts
export type CallKind = 'defend' | 'liberate' | 'patrol';
export interface Call { planetId: string; kind: CallKind; storyKey: string; sender: SenderId;
                        params: Record<string, string>; }
/** Up to `max` calls for the sector the player is in: every planet under attack (defend,
 *  most due first), then the next hostile planet in sector order (liberate), then the weakest
 *  non-hostile planet (patrol). The first time the player is in a skill, the first call
 *  carries that skill's intro (`story.system.<skill>.text`). */
export function sectorCalls(sectorId: string, save: SaveData, now: number, max: number): Call[];
/** A call for one specific planet (used when the player clicks a planet). */
export function callFor(planetId: string, save: SaveData, now: number): Call;
```

`SaveData` gains `location: { sectorId: string; systemId: string }` (default: first system of
`add-5` since "Review fixes v5"). Story keys `story.call.defend.1..3`, `story.call.liberate.1..3`,
`story.call.patrol.1..3` (param `{planet}`) replace `story.distress.*` and `story.next.*`.

**Mission pool.** A mission at a planet uses that planet's facts plus up to 4 review facts
from other planets of the same sector (due first, then weakest). Missions have 3 waves.

**Two map views in one scene (`StarMap`), both over `bg_starmap`, both very zoomed out.**

1. **Galaxy view.** The whole galaxy, pannable (drag) and zoomable (wheel, pinch, +/-).
   Each sector is a soft translucent cloud in its hue, made of overlapping blurred blobs
   around its systems so its outline is organic; cloud brightness follows `sectorMastery`.
   Systems are small star points (sun hue), with a thin red ring when any planet is hostile
   and a pulse when any planet is under attack. Sector names in small caps; system names
   only when zoomed in. The player's ship is a small marker at its current system.
   Clicking a system flies there: a short FTL jump (about 1.5 s), `save.location` updates,
   and the view changes to the system view.
2. **System view.** The sun in the centre with its planets on thin orbit ellipses (tilted
   perspective, slowly moving), each planet a small `planets/planet_N.png` sprite with its
   name beside it on a hairline, a thin mastery ring, and a red alien marker while hostile;
   a planet under attack pulses. A thin corner label names the system and sector. A small
   "galaxy" control (or Esc / zoom out) returns to the galaxy view.
   Here calls arrive: one at a time a few seconds apart (radio chirp, a blip on the planet,
   at most 3 pending, from `sectorCalls` filtered to this system first, then the rest of the
   sector). The newest opens as the **call card**: sender portrait, one line, planet picture
   and name, and GO. Other calls stay as blinking markers; clicking a marker or any planet
   opens its card (`callFor`). GO → `'Ftl'` → battle at that planet. A call for a planet in
   another system of the sector makes GO jump there first.

Framing may use thin HUD lines and a few small glyph controls in the corners (credits,
hangar, report, menu), in our own style. No lists of filters, no paragraphs.

**Core implementation notes (binding; updated for "Random problems v4").**

- Ids: sector `add-10`, `mul-c`, `core`; system `<sectorId>.s<n>`; planet `<sectorId>.<n>`
  (1-based within the sector, galaxy order), e.g. `mul-c.5`, `core.1` (`CORE_PLANET_ID`).
- Density (`content.ts`): systems per sector from its size (`sectorSize`: pool size when
  enumerated, possible problems when generated): <= 40 -> 3, <= 150 -> 4, else 5
  (`systemCountFor`); planets per system 3 + stableHash(`planets:<systemId>`) % 3. Result:
  28 sectors, 105 systems, 405 planets.
- Addition / subtraction to 5 / 10 / 15 (`factgen.ts`): the whole ordinary range plus easy facts
  under the balance rule: trivial = floor(share x size) (at least 1; 20% in "to 5", else 10%),
  operand-1 = floor(10% x size) outside "to 5" (cap 15%), picked alternately left / right with
  the sector seeds 101..103 / 111..113 (unchanged, so their ids are too). 0 + 0, 0 − 0 never
  appear. Saved stats for ids no sector holds any more stay in the save and are never asked.
- Layout: the `core` sector sits at the world centre. The first sector of each skill follows an
  archimedean spiral outward; the skill's other sectors pack against the previous one (the
  fitting spot nearest the centre), so each skill is one cluster. Same-skill overlap <= 6%,
  different skills 30 units apart. Radius `80 + 45 * systems`. Systems lie within the disc,
  >= 70 apart galaxy-wide; a sector's scatter is re-seeded (`pos:<id>:<n>`) until a horizontal
  band for its name stays free (`hasNameBand`). The world stays 4800x2700. Hue families 45
  degrees apart (`SKILL_HUE`), 5 degrees between sectors of a skill.
- Calls: `sector order` = planets in system order. Defend calls are sorted by earliest
  `dueAt` (longest overdue first). The patrol call skips planets already called. `callFor`
  also carries the skill intro while the skill is unseen; it throws on an unknown id. Call
  params are `{ planet: <generated planet name> }`; sender `abacus` (`story.call.from`).
- `BattleConfig.unlockedPlanetIds` is removed; `MISSION_WAVES = 3` (battle.ts).
- `SaveData.location`: a known `systemId` wins (its own sector is used); a known `sectorId`
  alone gives its first system; anything else gives the default.

**Enemy faction.** The Static is a hostile alien machine swarm. Hostile planets show its red
marker; liberating a planet (raising its mastery) pushes it back, and neglected planets come
under attack again.

### Random problems v4 (supersedes fixed fact chunks per planet, mix planets, and planet mastery derived from facts)

Player decision: the numbers must not be the same every time on the same planet. Every
mission draws its problems at random from the whole sector's range.

**Planets no longer own facts.** A planet is a place in a sector. `Fact.planetId`,
`planetFactList`, unique chunks and mix planets are removed. Sector structure stays dense
(at least 3 systems per sector, 3–5 planets per system; bigger sectors may have 4–5 systems,
chosen deterministically from the sector's size).

**Two kinds of sector, decided by the size of the problem space:**

- *Enumerated* (120 possible problems or fewer: digits, addition/subtraction to 5, 10, 15,
  every times-table and division sector): the pool is the **full** enumeration of the range
  (no fixed samples), subject to the Balance rule's caps on easy facts. Knowledge is tracked
  per fact, as before (`stats[fact.id]`).
- *Generated* (more than 120 possible problems: `type-2`, `type-3`, addition/subtraction to
  50 and 100, negatives, missing-number sectors): each problem is generated at random at
  spawn time from the sector's range. Knowledge is tracked per **category**, not per
  problem: each generated sector defines 2–4 categories that matter for learning (e.g.
  `add-100`: `carry`, `nocarry`, `easy`; `sub-50`: `borrow`, `noborrow`, `easy`; negatives
  by operation and sign pattern; missing-number by which operand is unknown; typing by
  digit count). `Fact` gains `statId: string` — for enumerated facts it equals `id`, for
  generated ones it is `cat:<sectorId>:<category>`. All mastery bookkeeping
  (`AnswerRecord.factId`, `stats`, `isMastered` for the auto-turret) uses `statId`.
  Generation honours the Balance rule as probabilities (easy at most 10%, at least half
  carry/borrow where that applies) and never repeats the same problem twice in a row or
  shows two identical problems on screen at once.

**Choosing problems in a mission (`scheduler`).** Still adaptive, now over the whole sector:
enumerated sectors weight facts as before (due and weak first, new facts introduced
gradually: 6 in the first wave, then at most 3 new per wave; see "Review fixes v5"); generated sectors pick a
category weighted toward weak/due categories, then random numbers inside it. A mission's
order and content differ every time. The `core` planet draws from every sector the player
has played.

**Planet progress replaces fact-derived planet mastery** (so the territory map still works
when every planet of a sector shares one pool):

```ts
export interface PlanetProgress { level: number; dueAt: number; wins: number; }  // level 0..5
/** SaveData.planets: Record<planetId, PlanetProgress>; missing = level 0, never visited. */
```

- Winning a mission at a planet with accuracy >= 0.8 raises its level by 1 (max 5) if the
  planet is due (`now >= dueAt`, or level 0) and sets `dueAt = now + PLANET_INTERVAL_MS[level]`
  with intervals `[0, 20 min, 1 day, 3 days, 7 days, 21 days]`. A win when not due, or with
  lower accuracy, changes nothing but `wins`. Losing a mission lowers the level by 1 (min 0)
  and makes the planet due now. (Exception for level 0: see "Review fixes v5".)
- `planetMastery(planetId, save) = level / 5`. `planetHold`: level 0 hostile, 1–2 contested,
  3+ secured. `underAttack`: level >= 1 and `now >= dueAt`. `systemMastery` and
  `sectorMastery` are means over planets. Signatures change from `stats` to `save` where
  needed; update all callers.
- The parent view reports real knowledge from `stats` (per fact for enumerated sectors, per
  category for generated ones), independent of planet progress.
- Variety between systems of a sector: system index (0-based, in sector order) is a
  difficulty tier that multiplies enemy speed by `1 + 0.08 * tier` (passed into
  `BattleConfig.speedScale` together with the player's game-speed setting).

**Core implementation notes (v4, binding).**

- `factgen.ts`: `sectorKind(id)` is `'enumerated'` when `possibleProblems(id) <= 120`
  (`ENUMERATION_LIMIT`), else `'generated'`. By that count `type-2` (90), `miss-mul` (90) and
  `miss-div` (90) are enumerated, although the list above names them generated. Enumerated:
  `type-1` 10, `type-2` 90, `add-5` / `sub-5` 12, `add-10` / `sub-10` 29, `add-15` / `sub-15`
  62, `mul-a` / `div-a` 30, other tables 20, `miss-mul` / `miss-div` 90 (666 facts). Generated
  sectors and categories (shares; bounds): `type-3` zero / teen / plain; `add-50`, `add-100`
  carry (0.55, min 0.5) / nocarry (0.37) / easy (0.08, max 0.1); `sub-50`, `sub-100` borrow /
  noborrow / easy (same); `neg-10`, `neg-20` addMixed / addNegNeg / subNeg / subCross (nonzero
  operands; `neg-20` has an operand beyond ±10); `miss-add`, `miss-sub` left (`? op b = c`) /
  right (`a op ? = c`). `generateFact` picks uniformly from the category's enumerated candidates,
  so every draw is inside the range and category. API: `sectorFacts`, `sectorCategories`,
  `categoryDefs`, `generateFact`, `categoryStatId` (`cat:<sectorId>:<category>`); `facts.ts`
  adds `allFacts` / `factById` (enumerated only), `sectorStatIds`, `sectorOfStat`.
- `scheduler.ts`: `createMissionScheduler({ planetId, stats, planets, now, rng })` ->
  `{ wave(waveIndex, count), replacement(waveIndex, exclude) }`. Enumerated: weights
  (`statWeight`) as before; never-seen facts open in a mission order shuffled once at creation
  (4 + 2 * waveIndex). Generated: `pickCategory` uses base share x weight, normalised, then
  clamped to the category bounds (`categoryShares`); then up to 24 draws to avoid excluded ids.
  `missionSectors`: the planet's sector; the core uses `playedSectors` (a stat whose
  `sectorOfStat` is the sector, or a planet of it with wins > 0), fallback `type-1`; with
  several sources each problem picks a sector uniformly.
- `battle.ts`: the queue is built per wave from the scheduler (generated facts are created
  then, with the sim's Rng). At spawn time a queued problem that is alive or was spawned last
  swaps with the first later queued one that fits, else `replacement` draws one; if nothing
  fits, the spawn waits. Records, `stats` and the turret use `fact.statId`; `missed` /
  `explaining` keep the problem. `BattleConfig.planets` is the progress snapshot.
- Planet progress (`mastery.ts`): `PLANET_INTERVAL_MS`, `applyPlanetResult`, `planetProgress`,
  `planetMastery(planetId, save)`; `galaxy.ts`: `planetHold` / `underAttack` / `systemMastery`
  / `sectorMastery` take any `{ planets }` (`ProgressHolder`). `applyMission` takes `accuracy`
  (`sim.accuracy()`); unknown planet ids get no progress. `loadSave` keeps progress of known
  planets only (level clamped 0..5); a save without `planets` loads `{}`.
- Tier: `systemTier(planetId)`, `tierSpeedFactor = 1 + 0.08 * tier` (`content.ts`);
  BattleScene passes `gameSpeed * tierSpeedFactor` as `speedScale`.
- Parent report: `sectorKnowledge` / `galaxyKnowledge` (mean box / 5 over stat ids); enumerated
  facts in rows of ten (tables as grids), generated sectors one cell per category
  (`meta.category.<name>`). Results show the planet level ring (`level / 5`).

### Story layer

Story text lives in `src/locales/{hr,en}/story.json` (keys start with `story.`):
`story.system.<skillId>.from` / `.text` (shown the first time the player launches a mission
in that system), `story.distress.1..3` (one picked by planet when launching a mission to a
planet in distress, `{planet}` param), `story.result.win` / `.lose`, and
`story.sender.<id>` names. `from` is a sender id: `tarrow`, `kito`, `abacus`.

`SaveData` gains `story: { seen: string[] }` (skill ids whose intro has been shown; filled by
`loadSave` for older saves). `core/story.ts`: `sectorCalls`, `callFor` (Galaxy map v3) and
`markSeen(save, skillId) -> SaveData`. Pure and tested. (`briefingFor`, `nextMission` and
`story.distress.*` / `story.next.*` are gone.)

## Quality bar

- `npm run typecheck`, `npm test` and `npm run build` pass with no errors.
- No `any` except where Phaser typings force it. No dead code, no TODO stubs for M1 features.
- Every `core/` module has tests covering its rules above, including determinism of `BattleSim`.

## Review fixes v5 (supersedes the matching rules above)

1. **Variety in enumerated sectors.** `FIRST_WAVE_NEW_FACTS = 6`, `NEW_FACTS_PER_WAVE = 3`; a fact
   not yet asked in the mission weighs `UNASKED_BONUS = 3` times more. Never the same problem
   twice in a row or while an identical one is alive, whenever the pool has an alternative
   (`scheduler.wave` excludes the last pick; `BattleSim.nextFact` excludes alive + last spawned).
   A fresh first mission at `type-1` (30 spawns) shows at least 9 of the 10 digits.
2. **Faster planet progress.** A win with accuracy >= 0.8 at level 0 gives level 2 with
   `dueAt = now + PLANET_INTERVAL_MS[1]` (20 min), so a second good win that session secures it
   (level 3). Every other transition is unchanged. Results shows the real old → new level.
3. **Start in addition.** `defaultLocation()` is the first system of `add-5` (`START_SECTOR`);
   stored valid locations are kept; `CORE_FALLBACK_SECTOR` stays `type-1`.

## Attack and boarding layer v6

Player request: sometimes the aliens shoot back at our ship (visible lasers, camera shake); if
we do not stop them in time we get a boarding party: alien crawlers (scorpion, spider, crab,
beetle machines of the Static) come at us through a damaged hangar and we shoot them with a
laser turret by solving problems. Text budget rules still apply: no sentences on screen.

### Core: armed enemies and hull (`core/battle.ts`)

- `Enemy` gains `armed: boolean` and `charge: number` (0..1). An enemy is armed with chance
  `ARMED_CHANCE` = 0.4 / 0.5 / 0.6 in waves 1 / 2 / 3 (v9; drawn from the sim Rng at spawn);
  the first enemy of a mission is never armed.
- An armed enemy with `y >= FIRE_LINE_Y` (90, v9) charges: `charge += dt / chargeMs(speedScale)`,
  with `chargeMs = CHARGE_MS / speedScale` and `CHARGE_MS = 6000` (v9). At 1 it fires: event
  `{ type: 'shipHit'; enemy; hull }`, `state.hull -= 1`, `charge = 0` (it charges again while
  alive). Charging stops in every phase except `spawning`.
- `BattleState` gains `hull` (starts at `HULL_MAX = 2`, v9), `hullMax`, `boardings` (count).
- When `hull` reaches 0: phase `'boarding'` (new `BattlePhase`), event `{ type: 'breach' }`.
  In `'boarding'` `step` and all input methods do nothing.
- `sim.boardingFacts(n = BOARDING_CRAWLERS): Fact[]` draws problems from the mission
  scheduler with the usual weighting (it consumes the Rng; call once per boarding).
- `sim.resolveBoarding(result: { repelled: boolean; records: AnswerRecord[]; kills: number })`:
  appends the records, adds `BOARDING_KILL_POINTS` (10) per kill to the score and kills;
  repelled → `hull = hullMax`, every enemy `charge = 0`, phase back to `'spawning'`,
  `boardings += 1`; not repelled → phase `'lost'` and event `lost` (returned from the call).
- The shield upgrade and domes are unchanged; ship hits do not touch domes or the streak.

### Core: boarding (`core/boarding.ts`, pure, tested)

```ts
export type CrawlerKind = 'scorpion' | 'spider' | 'crab' | 'beetle';
export const CRAWLER_SPEED: Record<CrawlerKind, number>;  // scorpion 1, spider 1.2, crab 0.85, beetle 1
export const BOARDING_CRAWLERS = 8;      // per boarding
export const BOARDING_MAX_ALIVE = 3;
export const BOARDING_MAX_BITES = 3;
export const APPROACH_MS = 11000;        // z 1 -> 0 at speed factor 1, divided by speedScale
export const BOARDING_SPAWN_MS = 2600;   // divided by speedScale; first spawn after 1200 ms
export interface Crawler { id: number; fact: Fact; kind: CrawlerKind; lane: -1 | 0 | 1;
                           z: number;        // 1 = far door, 0 = at the turret
                           speed: number;    // z per second
                           spawnedAt: number; }
export interface BoardingState { phase: 'fighting' | 'repelled' | 'overrun'; timeMs: number;
                                 crawlers: Crawler[]; input: string; bites: number; maxBites: number;
                                 remaining: number;   // not yet spawned
                                 kills: number; }
export type BoardingEvent =
  | { type: 'spawn'; crawler: Crawler } | { type: 'kill'; crawler: Crawler; fast: boolean }
  | { type: 'wrong'; typed: number } | { type: 'bite'; crawler: Crawler }
  | { type: 'repelled' } | { type: 'overrun' };
export class BoardingSim {
  constructor(cfg: { facts: Fact[]; seed: number; speedScale: number });
  readonly state: BoardingState; readonly records: AnswerRecord[];
  step(dtMs: number): BoardingEvent[];
  // the same input methods and signatures as BattleSim (digit, sign, backspace, submit)
}
```

Rules: a submit kills the nearest (smallest z) crawler whose answer matches, else it is a
`wrong` (the turret fires and misses; nothing else happens). A crawler reaching `z <= 0`
bites: `bites += 1`, the crawler is removed, its fact is recorded as missed. `bites ==
maxBites` → `overrun`. All crawlers spawned and none alive → `repelled`. Lanes avoid placing
two crawlers on the same lane closer than 0.25 in z. Records use the same outcomes and
"fast" rule as BattleSim.

### Presentation

- **Battle (`BattleScene`, `fx/`):** an armed ship shows a red glow at its nose that grows
  with `charge`, plus a hairline red aiming line to the cockpit in the last quarter. On
  `shipHit`: a thick red beam from the ship to the bottom centre, camera shake (about 250 ms),
  a red vignette flash, the dashboard flickers, `Sfx.enemyLaser()` + `Sfx.hullHit()`. Hull is
  shown as `hullMax` small pips on the dashboard (glyph, at most one short label word).
  On `breach`: alarm, long shake, white-red flash, then `scene.pause()` and
  `scene.launch('Boarding', { facts, seed, speedScale, onDone })`; `onDone` calls
  `sim.resolveBoarding` and resumes the battle or ends the mission as lost.
- **Boarding (`BoardingScene`):** `bg_hangar` full screen, one-point perspective. A crawler at
  depth z is drawn between the far door (about y 300, scale 0.08) and the bottom (about y 640,
  scale 1) with a perspective curve (slow growth far away, fast when close), x spread by lane
  growing as it nears, darker tint when far, sorted by z. The stills are animated in code:
  quick leg-skitter (small rotation and squash oscillation, per-crawler phase), bob, zig-zag.
  Each carries the same problem tag as battle ships. `turret` sprite at the bottom centre
  swivels to the target and fires a beam; kills use the explosion fx; a bite makes the crawler
  lunge to fill the screen, red flash, heavy shake. Bites left are three pips. Flickering
  light and a red beacon pulse; a one-word title (`battle.boarding`) for about a second at
  the start. Input: DOM keydown through `ui/keymap.ts`, and the touch `Keypad` as in battle.
- **Audio (`audio/Sfx.ts`):** `enemyLaser, hullHit, breachAlarm, skitter, screech, turretShot,
  bite`; skitter volume follows the nearest crawler.
- **Assets:** `art-src/bg_hangar.png` → `bg/bg_hangar.jpg`; `art-src/crawler_{a..d}.png`
  (green screen; a scorpion, b spider, c crab, d beetle) → `crawlers/<kind>.png` (512 box);
  `art-src/turret_gun.png` (green screen) → `ui/turret.png`. Code-drawn fallbacks when missing.

### v6 core implementation notes

- `BOARDING_CRAWLERS` lives in `battle.ts` and is re-exported by `boarding.ts` (no import cycle:
  `boarding.ts` takes `MAX_INPUT_DIGITS` / `MAX_STEP_MS` / `AnswerRecord` from `battle.ts`).
  Extra exports: `CHARGE_MS`, `ARMED_CHANCE`, `armedChance(w)` (waves beyond 3 use the last value, 0.6 since v9),
  `BoardingResult`; `CRAWLER_KINDS`, `BOARDING_FIRST_SPAWN_MS` (1200, not scaled, like
  `WAVE_START_DELAY_MS`), `LANE_GAP_Z`, `BOARDING_LANES`, `BoardingConfig`.
- Per step: move, impacts, then charge (so an enemy that lands this step never fires); overshoot
  past 1 is dropped. A breach clears the input. `resolveBoarding` outside `'boarding'` is a no-op.
- Boarding kills and records do not change `sim.accuracy()`.
- Crawlers take the facts in the given order; kind is uniform (drawn once, kept while the spawn
  waits). The lane rule holds for the whole approach: a lane is free only if the gap to every
  crawler on it stays >= 0.25 until that one bites (a faster newcomer cannot catch up); with no
  free lane the spawn waits. A wrong answer records `wrong` once per crawler (BattleSim rule).

## Settings v7: slower speed and density

- **Speed:** `GAME_SPEEDS = [0.5, 0.75, 1, 1.25]` (`GameSpeed` type), default 1. Unknown values
  reset to 1 in `migrate`. Passed as before (`gameSpeed * tierSpeedFactor` = `speedScale`).
- **Density** (how crowded a fight is, independent from speed): `settings.density: Density`,
  `DENSITIES = [0.5, 0.75, 1, 1.25]`, default 1; older saves get 1, invalid values reset to 1
  (same rule as `gameSpeed`).
  - `BattleConfig.density` (optional, default 1; non-finite or <= 0 -> 1): spawn interval
    `max(1800, 3600 - 250*w) / speedScale / density`; max alive `maxAlive(density)` =
    `round(4 * density)` -> 2 / 3 / 4 / 5. `MAX_ALIVE` (4) stays the default-density value.
    Enemies per wave unchanged (a sparse wave just lasts longer).
  - `BoardingConfig.density` (optional, default 1): spawn interval `BOARDING_SPAWN_MS /
    speedScale / density`; max alive `boardingMaxAlive(density)` = 2 when density < 1, otherwise
    `BOARDING_MAX_ALIVE` (3).
  - BattleScene passes `save.settings.density` into the BattleSim config and through
    `BoardingSceneData.density` to the BoardingSim.
- **SettingsScene:** speed and density are two rows of four buttons in the same style, labelled
  `×0.5 ×0.75 ×1 ×1.25` (`common.multiplier`, locale decimal separator; the former
  `common.speed.*` words are gone). Row label `common.settings.density` ("Gustoća" / "Density").
  Rows were tightened (52 px apart) so seven rows fit the panel at 1280x720.

## v8: more aliens, foreground guns, hangar ambience

- **Kinds:** `CrawlerKind` adds `stalker` (speed 1.15), `drifter` (0.9), `wraith` (0.8); all seven in
  `CRAWLER_KINDS`, drawn uniformly. Art: `art-src/crawler_{e,f,g}.png` and
  `crawler_frames/{stalker,drifter,wraith}/00..15.png` -> `crawlers/<kind>.png` / `<kind>_walk.png`
  (same keying; drifter and wraith also key backdrop enclosed by tentacles/arms, `HOLE_KINDS`).
  The wraith's black pool is kept (it is opaque creature); cast shadows go as before. Code-drawn
  fallbacks exist for all seven.
- **Gait (`boardingLayout`):** `GaitStyle` gains `lunge` (dash-and-hold zig-zag, stalker), `hover` +
  `bobHz` (drifter floats 0.6 of its height above its floor point, slow bob, soft `TEX.shade` blob
  on the floor) and `glide` (wraith: no bob or squash, slow sway). `CRAWLER_SIZE` scales the drawn
  width per kind (drifter 0.85, wraith 1.25). A crawler's `centre` includes the hover lift.
- **Guns:** `bg_hangar` no longer contains the guns. `npm run art` builds `ui/gun_left.png` /
  `ui/gun_right.png` in background space: alpha from `art-src/hangar_guns_mask.png` (green key,
  eroded 1 px, feathered), colours from `art-src/bg_hangar_guns.png` resized to 1344x760 and aligned
  per gun by edge correlation (offsets about -5,-7 and -11,-8 px), with 110 rows repeated below the
  frame. `GUN_LEFT` / `GUN_RIGHT` record their view position (scale 2/3), pivot and muzzle.
  `fx/HangarGuns` draws them at `DEPTH.enemies + 6.5` (over every crawler body; the crawler's tag
  is a separate container at `+8..9`; the bite lunge stays on top), tracks the nearest crawler
  (idle sway without one), clamps to +-18 deg (`GUN_MAX_ANGLE`), and on every shot (hit or miss)
  snaps to the aim point, recoils (`gunKick`) and returns the rotated muzzle tips (`gunMuzzle`),
  where beams and flashes start. Missing sprites: code-drawn barrels with the same geometry.
  Lamp spots and beacons were re-measured on the new picture (`SPARK_LAMPS`, `BEACONS`).
- **Audio:** `audio/Hangar.ts` (`HangarBed`), started by `Sfx.startHangar()` on the music bus over
  the battle bed (music volume): unstable drone, creaks and hull groans every 4-12 s, distant
  thuds, drips, a rare far screech; everything through one gain, faded by `Sfx.stopHangar(fade)` on
  pause (restarted on resume), repelled, overrun and shutdown. `Sfx.sparkCrackle()` (sfx bus, UI
  priority) on lamp flashes only when `crackleGate` allows: chance 0.22 and never within 1.5 s.

## v9: more frequent attacks

Reason: players almost never got shot at or boarded. Charging began at sim y 330 (~14 s after
spawn at wave-1 speed, longer at game speed 0.5) and took 4 s more, so enemies died first.
Balance only, no new mechanics (constants in `core/battle.ts`):

| Constant | Old | New |
|---|---|---|
| `FIRE_LINE_Y` | 330 | 90 (charging starts ~1.5 s after spawn at y 60) |
| `CHARGE_MS` | 4000 | 6000 (still `/ speedScale` via `chargeMs`) |
| `HULL_MAX` | 3 | 2 (boarded after two hits) |
| `ARMED_CHANCE` | 0.25 / 0.35 / 0.45 | 0.4 / 0.5 / 0.6 (first enemy of a mission still unarmed) |

- Presentation: hull pips are drawn from `hullMax` (now two; red from hull 1). The nose glow of a
  charging ship has a larger floor (scale `0.6 + 1.0 * charge`, alpha `0.5 + 0.45 * charge`) so it
  reads on the small, far ships high on the screen from the first moment; the aiming line still
  shows in the last quarter (1.5 s at speed 1).
- Tests isolate the parked armed enemy (others disarmed each slice), since newly spawned enemies
  now cross the fire line within seconds.
