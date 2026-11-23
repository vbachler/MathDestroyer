import Phaser from 'phaser';
import { app } from '../app';
import { BattleSim, DOME_X, FIRE_LINE_Y, IMPACT_Y, SPAWN_Y } from '../core/battle';
import type { BattleEvent, BoardingResult, Enemy } from '../core/battle';
import { tierSpeedFactor } from '../core/content';
import { missionCredits } from '../core/economy';
import { formatProblem } from '../core/facts';
import { MINUS } from '../core/i18n';
import { planetMastery } from '../core/mastery';
import { applyMission } from '../core/save';
import type { Fact } from '../core/types';
import { battleBgFor, enemyImageFor, hasImage } from '../fx/assets';
import { beam, flash, hexShield, ring, shipExplosion, sparks } from '../fx/BattleFx';
import {
  COCKPIT, GUN_LEFT, GUN_RIGHT, KEY_GAP, KEYPAD_DIGITS, KEYPAD_FIRE, layoutTags, missPoint, PAUSE_RECT, shipScreenY,
  shipSize, STATION_Y,
} from '../fx/battleLayout';
import type { Point, TagItem, TagSide } from '../fx/battleLayout';
import { Dashboard } from '../fx/Dashboard';
import { EnemyShip } from '../fx/EnemyShip';
import type { ThreatLevel } from '../fx/EnemyShip';
import { ExplanationCard } from '../fx/ExplanationCard';
import { Starfield } from '../fx/Starfield';
import { Station } from '../fx/Station';
import { TEX } from '../fx/textures';
import { Button } from '../ui/Button';
import { addHitZone } from '../ui/hitZone';
import { Keypad } from '../ui/Keypad';
import { isGameKey, keyAction } from '../ui/keymap';
import { drawBrackets } from '../ui/Panel';
import { capsStyle, numeralStyle } from '../ui/TextStyles';
import { COLORS, CSS, DEPTH, GAME_HEIGHT, GAME_WIDTH, LETTER_SPACING, LINE_WIDTH, SIZES } from '../ui/theme';
import type { BoardingSceneData } from './BoardingScene';
import type { ResultsSceneData } from './ResultsScene';
import type { UpgradeSceneData } from './UpgradeScene';

export interface BattleSceneData { planetId: string; }

/** Event name UpgradeScene uses to hand the events returned by sim.pickUpgrade() / sim.nextWave() back to Battle. */
export const SIM_EVENTS = 'sim-events';

const TOTAL_WAVES = 3;
const MAX_FRAME_MS = 100;
const CX = GAME_WIDTH / 2;

// Threat cue thresholds (sim y).
const WARN_Y = IMPACT_Y - 180;
const CRIT_Y = IMPACT_Y - 85;

/** Background drift: the image is overscanned by BG_OVERSCAN and wanders slowly inside it. */
const BG_OVERSCAN = 1.08;
const BG_DRIFT_X = 22;
const BG_DRIFT_Y = 9;
const BG_PERIOD_X_MS = 90_000;
const BG_PERIOD_Y_MS = 130_000;

const BANNER_Y = 236;
const WAVE_CLEARED_BANNER_MS = 900;
const END_BANNER_MS = 1500;
const WAVE_BANNER_MS = 1100;
/** The wrong-answer stab lands just after the loud part of the missed shot. */
const WRONG_SOUND_DELAY_MS = 200;
/** Ship hit: shake, then the hull clang just after the zap. */
const HIT_SHAKE_MS = 250;
const HULL_SOUND_DELAY_MS = 70;
/** Breach: alarm, long shake and flashes, then the boarding scene. */
const BREACH_MS = 1500;

function threatOf(y: number): ThreatLevel {
  if (y >= CRIT_Y) return 2;
  if (y >= WARN_Y) return 1;
  return 0;
}

const randomFrom = (a: number, b: number): number => a + Math.random() * (b - a);

export class BattleScene extends Phaser.Scene {
  private planetId = '';
  private sim!: BattleSim;
  private bg: Phaser.GameObjects.Image | null = null;
  private starfield: Starfield | null = null;
  private driftMs = 0;
  private ships = new Map<number, EnemyShip>();
  private tagSides = new Map<number, TagSide>();
  private stations: Station[] = [];
  private dash!: Dashboard;

  private explainDim: Phaser.GameObjects.Rectangle | null = null;
  private explainCard: ExplanationCard | null = null;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;

  private paused = false;
  private ending = false;
  /** Between `breach` and the end of the boarding. */
  private breaching = false;
  /** Set when resuming from Boarding (no wave banner then). */
  private quietResume = false;
  private speedScale = 1;
  private breachFx: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Battle');
  }

  create(data: BattleSceneData): void {
    this.planetId = data.planetId;
    this.bg = null;
    this.starfield = null;
    this.driftMs = 0;
    this.ships = new Map();
    this.tagSides = new Map();
    this.stations = [];
    this.explainDim = null;
    this.explainCard = null;
    this.pauseOverlay = null;
    this.paused = false;
    this.ending = false;
    this.breaching = false;
    this.quietResume = false;
    this.breachFx = [];

    const save = app.save;
    const now = app.now();
    // Later systems of a sector are harder: their tier speeds the enemies up.
    this.speedScale = save.settings.gameSpeed * tierSpeedFactor(this.planetId);
    this.sim = new BattleSim({
      planetId: this.planetId,
      totalWaves: TOTAL_WAVES,
      stats: { ...save.stats },
      planets: { ...save.planets },
      modules: { ...save.modules },
      now,
      seed: now % 0x7fffffff,
      speedScale: this.speedScale,
      density: save.settings.density,
    });

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.buildBackground();
    this.stations = DOME_X.map((x) => new Station(this, x));
    const { t } = app.i18n;
    this.dash = new Dashboard(this, {
      wave: t('battle.hud.wave'), score: t('battle.hud.score'), streak: t('battle.hud.streak'), stations: t('battle.hud.stations'),
      hull: t('battle.hud.hull'),
    });
    this.buildPauseGlyph();
    this.buildKeypad();

    // Plain DOM listener: Phaser's keyboard queue can re-emit earlier events within one frame.
    window.removeEventListener('keydown', this.onKeyDown);
    window.addEventListener('keydown', this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
    this.events.on(SIM_EVENTS, this.handleEvents, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (import.meta.env.DEV) this.installDevHooks();

    app.sfx.startAmbience('battle');
    this.showWaveBanner();
    this.renderState();
  }

  /**
   * DEV only: `window.__forceBreach()` puts the hull at 1 and makes the lowest enemy an armed
   * ship about to fire (moved down to the fire line if needed), so the next step plays the real
   * shipHit, breach and Boarding path. Returns false when no enemy is on screen yet.
   */
  private installDevHooks(): void {
    (window as unknown as { __forceBreach?: () => boolean }).__forceBreach = (): boolean => {
      const s = this.sim.state;
      let target: Enemy | undefined;
      for (const e of s.enemies) if (!target || e.y > target.y) target = e;
      if (!target || s.phase !== 'spawning') return false;
      s.hull = 1;
      target.armed = true;
      target.charge = 0.999;
      target.y = Math.max(target.y, FIRE_LINE_Y);
      return true;
    };
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, MAX_FRAME_MS);
    this.drift(dt);
    if (!this.paused) this.handleEvents(this.sim.update(dt));
    if (!this.paused) for (const st of this.stations) st.update(dt);
    for (const ship of this.ships.values()) ship.tick(dt);
    this.renderState();
    app.sfx.setTension(this.tensionLevel());
  }

  /** Dread for the music: 0 until the lowest enemy passes ~1/3 of the way down, 1 at the impact line. */
  private tensionLevel(): number {
    const s = this.sim.state;
    if (this.paused || this.ending || s.phase !== 'spawning' || s.enemies.length === 0) return 0;
    let lowest = -Infinity;
    for (const e of s.enemies) lowest = Math.max(lowest, e.y);
    const yNorm = (lowest - SPAWN_Y) / (IMPACT_Y - SPAWN_Y);
    return Phaser.Math.Clamp((yNorm - 0.35) / 0.65, 0, 1);
  }

  // ------------------------------------------------------------------ scene building

  private buildBackground(): void {
    const key = battleBgFor(this.planetId);
    if (hasImage(this, key)) {
      const img = this.add.image(CX, GAME_HEIGHT / 2, key).setDepth(DEPTH.background);
      img.setScale(Math.max(GAME_WIDTH / img.width, GAME_HEIGHT / img.height) * BG_OVERSCAN);
      this.bg = img;
    } else {
      this.starfield = new Starfield(this, { speed: 0.15 });
    }
  }

  /** Very slow wander of the background (a few px per second at most). */
  private drift(dt: number): void {
    this.driftMs += dt;
    if (this.bg) {
      this.bg.setPosition(
        CX + BG_DRIFT_X * Math.sin((this.driftMs / BG_PERIOD_X_MS) * Math.PI * 2),
        GAME_HEIGHT / 2 + BG_DRIFT_Y * Math.sin((this.driftMs / BG_PERIOD_Y_MS) * Math.PI * 2),
      );
    }
    this.starfield?.update(dt);
  }

  private buildPauseGlyph(): void {
    const r = PAUSE_RECT;
    const g = this.add.graphics().setDepth(DEPTH.hud);
    g.fillStyle(COLORS.bg, 0.35);
    g.fillRect(r.x, r.y, r.w, r.h);
    drawBrackets(g, r.x, r.y, r.w, r.h, COLORS.primary, 0.75, 7);
    g.fillStyle(COLORS.primary, 0.9);
    g.fillRect(r.x + r.w / 2 - 6, r.y + 11, 4, r.h - 22);
    g.fillRect(r.x + r.w / 2 + 2, r.y + 11, 4, r.h - 22);
    addHitZone(this, r.x + r.w / 2, r.y + r.h / 2, r.w + 12, r.h + 12, () => this.togglePause()).setDepth(DEPTH.hud);
  }

  private buildKeypad(): void {
    const show = app.save.settings.keypadAlwaysVisible || this.sys.game.device.input.touch;
    if (!show) return;
    new Keypad(this, {
      onDigit: (d) => { if (this.acceptsInput()) this.sim.typeDigit(d); },
      onSign: () => { if (this.acceptsInput()) this.sim.toggleSign(); },
      onBackspace: () => { if (this.acceptsInput()) this.sim.backspace(); },
      onFire: () => this.fire(),
    }, { fireLabel: app.i18n.t('battle.keypad.fire'), digits: KEYPAD_DIGITS, fire: KEYPAD_FIRE, gap: KEY_GAP })
      // Above the console's bottom shade; ships and tags never reach the corners (battleLayout test).
      .setDepth(DEPTH.hud);
  }

  // ------------------------------------------------------------------ input

  private acceptsInput(): boolean {
    return !this.paused && !this.ending && !this.breaching;
  }

  private fire(): void {
    if (!this.acceptsInput()) return;
    this.handleEvents(this.sim.submit());
  }

  /** Bound once; exactly one sim call per DOM keydown. Inactive while paused under Upgrade or asleep. */
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.scene.isActive()) return;
    if (isGameKey(ev)) ev.preventDefault();
    const action = keyAction(ev);
    if (!action) return;
    if (action.type === 'pause') {
      this.togglePause();
      return;
    }
    if (!this.acceptsInput()) return;
    switch (action.type) {
      case 'digit': this.sim.typeDigit(action.d); break;
      case 'sign': this.sim.toggleSign(); break;
      case 'backspace': this.sim.backspace(); break;
      case 'submit': this.fire(); break;
    }
  };

  // ------------------------------------------------------------------ events

  private handleEvents(events: BattleEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'spawn': this.ensureShip(ev.enemy); break;
        case 'kill': this.onKill(ev.enemy, ev.byTurret, ev.points); break;
        case 'wrong': this.onWrong(); break;
        case 'impact': this.onImpact(ev.enemy, ev.domeIndex, ev.destroyed); break;
        case 'shieldBlock': this.onShieldBlock(ev.enemy, ev.domeIndex); break;
        case 'repair': this.onRepair(ev.domeIndex); break;
        case 'waveCleared': this.onWaveCleared(); break;
        case 'explainStart': this.showExplanation(ev.fact); break;
        case 'explainEnd': this.hideExplanation(); break;
        case 'shipHit': this.onShipHit(ev.enemy); break;
        case 'breach': this.onBreach(); break;
        case 'won': this.onMissionEnd(true); break;
        case 'lost': this.onMissionEnd(false); break;
      }
    }
  }

  private ensureShip(e: Enemy): EnemyShip {
    let ship = this.ships.get(e.id);
    if (!ship) {
      ship = new EnemyShip(this, e.x, shipScreenY(e.y), formatProblem(e.fact, app.i18n.locale), enemyImageFor(e.id), shipSize(e.y));
      ship.playEntry();
      this.ships.set(e.id, ship);
    }
    return ship;
  }

  private removeShip(id: number): void {
    this.ships.get(id)?.destroy();
    this.ships.delete(id);
    this.tagSides.delete(id);
  }

  /** Where the enemy is drawn right now (the live ship if it exists). */
  private shipPoint(e: Enemy): Point {
    const ship = this.ships.get(e.id);
    return ship ? { x: ship.x, y: ship.y } : { x: e.x, y: shipScreenY(e.y) };
  }

  private onKill(e: Enemy, byTurret: boolean, points: number): void {
    const p = this.shipPoint(e);
    const size = this.ships.get(e.id)?.shipSize ?? shipSize(e.y);
    this.removeShip(e.id);
    if (byTurret) {
      const i = this.nearestStation(p.x);
      beam(this, { x: DOME_X[i], y: this.stations[i].top }, p, COLORS.accent, { width: 0.32 });
    } else {
      beam(this, GUN_LEFT, p, COLORS.primary);
      beam(this, GUN_RIGHT, p, COLORS.primary);
    }
    shipExplosion(this, p.x, p.y, size, byTurret ? COLORS.accent : COLORS.primary);
    this.floatNumber(p.x, p.y - size * 0.6, `+${points}`);
    app.sfx.laser();
    this.time.delayedCall(70, () => app.sfx.hit());
  }

  /** The guns fire and miss: both beams converge beside the lowest enemy and carry on into space. */
  private onWrong(): void {
    let lowest: Enemy | undefined;
    for (const e of this.sim.state.enemies) if (!lowest || e.y > lowest.y) lowest = e;
    const aim = lowest
      ? missPoint(this.shipPoint(lowest), Math.random())
      : { x: CX + randomFrom(-220, 220), y: randomFrom(140, 300) };
    beam(this, GUN_LEFT, aim, COLORS.primary, { fadeInto: true });
    beam(this, GUN_RIGHT, aim, COLORS.primary, { fadeInto: true });
    flash(this, aim.x, aim.y, COLORS.primaryDim, 18, 180);
    app.sfx.laserMiss();
    this.time.delayedCall(WRONG_SOUND_DELAY_MS, () => app.sfx.wrong());
    this.dash.shakeInput();
  }

  /** `destroyed`: the station's last hp; it blows up into a debris field (Station.setHp) with its own sound. */
  private onImpact(e: Enemy, domeIndex: number, destroyed: boolean): void {
    const p = this.shipPoint(e);
    this.removeShip(e.id);
    const st = this.stations[domeIndex];
    shipExplosion(this, (p.x + st.x) / 2, st.top, 46, COLORS.danger);
    sparks(this, st.x, STATION_Y, COLORS.danger, 10, 90);
    if (destroyed) {
      this.cameras.main.shake(320, 0.0045);
      app.sfx.stationDestroyed();
      return;
    }
    this.cameras.main.shake(200, 0.003);
    app.sfx.miss();
  }

  /** The shield absorbed an impact: a teal hex flashes over the station and the ship bursts against it. */
  private onShieldBlock(e: Enemy, domeIndex: number): void {
    const size = this.ships.get(e.id)?.shipSize ?? shipSize(e.y);
    this.removeShip(e.id);
    const st = this.stations[domeIndex];
    hexShield(this, st.x, STATION_Y, 42);
    shipExplosion(this, st.x, STATION_Y - 40, size, COLORS.accent);
    app.sfx.shieldBlock();
  }

  private onRepair(domeIndex: number): void {
    const st = this.stations[domeIndex];
    flash(this, st.x, STATION_Y, COLORS.ok, 70, 600);
    ring(this, st.x, STATION_Y, 26, COLORS.ok);
    app.sfx.repair();
  }

  private onWaveCleared(): void {
    this.hideExplanation();
    this.showBanner(app.i18n.t('battle.banner.waveCleared'), WAVE_CLEARED_BANNER_MS, COLORS.ok);
    this.time.delayedCall(WAVE_CLEARED_BANNER_MS, () => {
      if (this.ending) return;
      if (this.sim.offers().length === 0) {
        // Everything is at max tier: no reward screen, straight into the next wave.
        this.handleEvents(this.sim.nextWave());
        this.showWaveBanner();
        return;
      }
      const data: UpgradeSceneData = { sim: this.sim };
      this.scene.pause();
      this.scene.launch('Upgrade', data);
    });
  }

  /** Back from the Upgrade overlay (sim.pickUpgrade() or sim.nextWave() has been called). */
  private onResume(): void {
    if (this.quietResume) {
      this.quietResume = false;
      return;
    }
    this.showWaveBanner();
  }

  // ------------------------------------------------------------------ attack and boarding

  /** An armed ship fired: a thick red beam into the cockpit, shake, red vignette, console flicker. */
  private onShipHit(e: Enemy): void {
    const ship = this.ships.get(e.id);
    const from = ship ? ship.nose : { x: e.x, y: shipScreenY(e.y) + shipSize(e.y) * 0.42 };
    const to = { x: COCKPIT.x + randomFrom(-40, 40), y: COCKPIT.y };
    beam(this, from, to, COLORS.danger, { width: 1.6, durationMs: 320 });
    beam(this, from, to, COLORS.white, { width: 0.35, durationMs: 200 });
    flash(this, from.x, from.y, COLORS.white, 34, 220);
    const impact = this.add.image(to.x, to.y, TEX.glow).setTint(COLORS.danger).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.hud + 3).setScale(0.6);
    this.tweens.add({ targets: impact, scale: 2.2, alpha: 0, duration: 450, ease: 'Cubic.easeOut', onComplete: () => impact.destroy() });
    sparks(this, to.x, to.y - 6, COLORS.danger, 12, 140);
    this.cameras.main.shake(HIT_SHAKE_MS, 0.007);
    this.vignette(COLORS.danger, 0.65, 520);
    this.dash.flicker();
    app.sfx.enemyLaser();
    this.time.delayedCall(HULL_SOUND_DELAY_MS, () => app.sfx.hullHit());
  }

  /** Full-screen edge glow that fades from `peak` alpha. */
  private vignette(color: number, peak: number, durationMs: number): void {
    const v = this.add.image(CX, GAME_HEIGHT / 2, TEX.vignette).setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setTint(color).setDepth(DEPTH.overlay - 30).setAlpha(peak);
    this.tweens.add({ targets: v, alpha: 0, duration: durationMs, ease: 'Quad.easeIn', onComplete: () => v.destroy() });
  }

  /** Hull at 0: alarm, long shake, white-red flash, then the Boarding scene over the paused battle. */
  private onBreach(): void {
    if (this.breaching || this.ending) return;
    this.breaching = true;
    this.hideExplanation();
    this.closePause();
    app.sfx.breachAlarm();
    this.cameras.main.shake(BREACH_MS, 0.009);
    const white = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.white, 0.85).setDepth(DEPTH.overlay - 4);
    const red = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.danger, 0).setDepth(DEPTH.overlay - 5);
    const edge = this.add.image(CX, GAME_HEIGHT / 2, TEX.vignette).setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setTint(COLORS.danger).setDepth(DEPTH.overlay - 6).setAlpha(0);
    this.breachFx = [white, red, edge];
    this.tweens.add({ targets: white, alpha: 0, duration: 260, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: red, alpha: 0.35, duration: 300, yoyo: true, repeat: 2 });
    this.tweens.add({ targets: edge, alpha: 1, duration: 500 });
    this.dash.flicker(BREACH_MS);
    this.time.delayedCall(BREACH_MS, () => this.launchBoarding());
  }

  private launchBoarding(): void {
    if (this.ending || !this.scene.isActive()) return;
    for (const o of this.breachFx) o.destroy();
    this.breachFx = [];
    const s = this.sim.state;
    const data: BoardingSceneData = {
      facts: this.sim.boardingFacts(),
      seed: (this.sim.config.seed + 7919 * (s.boardings + 1)) % 0x7fffffff,
      speedScale: this.speedScale,
      density: this.sim.config.density,
      onDone: (r) => this.onBoardingDone(r),
    };
    this.scene.pause();
    this.scene.launch('Boarding', data);
  }

  /** Boarding finished: resolve it in the sim, resume, and end the mission if the ship was lost. */
  private onBoardingDone(result: BoardingResult): void {
    this.breaching = false;
    const events = this.sim.resolveBoarding(result);
    this.quietResume = true;
    this.scene.resume();
    this.handleEvents(events);
  }

  private onMissionEnd(won: boolean): void {
    if (this.ending) return;
    this.ending = true;
    this.hideExplanation();
    this.closePause();
    if (won) app.sfx.win();
    else app.sfx.lose();
    this.showBanner(app.i18n.t(won ? 'battle.banner.won' : 'battle.banner.lost'), END_BANNER_MS, won ? COLORS.ok : COLORS.danger);
    this.time.delayedCall(END_BANNER_MS, () => this.finishMission(won));
  }

  private finishMission(won: boolean): void {
    const sim = this.sim;
    const s = sim.state;
    const credits = missionCredits({
      score: s.score, won, domesStanding: sim.domesStanding(), salvageTier: sim.upgradeEffects().salvageTier,
    });
    const masteryBefore = planetMastery(this.planetId, app.save);
    app.save = applyMission(app.save, {
      planetId: this.planetId, records: sim.records, credits, score: s.score, won, accuracy: sim.accuracy(), now: app.now(),
    });
    app.persist();
    const masteryAfter = planetMastery(this.planetId, app.save);
    const results: ResultsSceneData = {
      planetId: this.planetId,
      won,
      score: s.score,
      credits,
      missed: [...s.missed],
      accuracy: sim.accuracy(),
      bestStreak: s.bestStreak,
      masteryBefore,
      masteryAfter,
    };
    this.scene.start('Results', results);
  }

  private nearestStation(x: number): number {
    let best = 0;
    DOME_X.forEach((dx, i) => { if (Math.abs(dx - x) < Math.abs(DOME_X[best] - x)) best = i; });
    return best;
  }

  /** Small amber number that rises and fades (points for a kill). */
  private floatNumber(x: number, y: number, text: string): void {
    const label = this.add.text(x, y, text, numeralStyle({ fontSize: `${SIZES.label}px`, color: CSS.primary }))
      .setOrigin(0.5).setDepth(DEPTH.fx + 1);
    this.tweens.add({ targets: label, y: y - 26, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }

  // ------------------------------------------------------------------ overlays

  private showExplanation(fact: Fact): void {
    this.hideExplanation();
    this.explainDim = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg, 0.4)
      .setDepth(DEPTH.overlay - 20).setAlpha(0);
    this.tweens.add({ targets: this.explainDim, alpha: 1, duration: 200 });
    this.explainCard = new ExplanationCard(this, CX, 300, fact, app.i18n).setDepth(DEPTH.overlay - 10).setScale(0.94).setAlpha(0);
    this.tweens.add({ targets: this.explainCard, alpha: 1, scale: 1, duration: 200, ease: 'Quad.easeOut' });
  }

  private hideExplanation(): void {
    for (const obj of [this.explainDim, this.explainCard]) {
      if (!obj) continue;
      this.tweens.killTweensOf(obj);
      this.tweens.add({ targets: obj, alpha: 0, duration: 180, onComplete: () => obj.destroy() });
    }
    this.explainDim = null;
    this.explainCard = null;
  }

  private showWaveBanner(): void {
    // Sometimes the enemy is heard talking as a wave begins.
    if (Math.random() < 0.4) this.time.delayedCall(randomFrom(1200, 2800), () => app.sfx.alienChatter());
    this.showBanner(app.i18n.t('battle.banner.wave', { wave: this.sim.state.wave }), WAVE_BANNER_MS, COLORS.primary);
  }

  /** One or two words in small caps between two hairlines. */
  private showBanner(text: string, durationMs: number, color: number): void {
    const banner = this.add.container(CX, BANNER_Y).setDepth(DEPTH.overlay - 5).setAlpha(0);
    const label = this.add.text(0, 0, text.toUpperCase(), capsStyle({
      fontSize: `${SIZES.heading}px`, color: `#${color.toString(16).padStart(6, '0')}`, letterSpacing: LETTER_SPACING.wide,
    })).setOrigin(0.5);
    const half = label.width / 2 + 18;
    const g = this.add.graphics();
    g.lineStyle(LINE_WIDTH, color, 0.8);
    g.lineBetween(-half - 70, 0.5, -half, 0.5);
    g.lineBetween(half, 0.5, half + 70, 0.5);
    banner.add([g, label]);
    const fade = Math.min(220, durationMs / 4);
    this.tweens.add({ targets: banner, alpha: 1, duration: fade });
    this.tweens.add({ targets: banner, alpha: 0, delay: durationMs - fade, duration: fade, onComplete: () => banner.destroy() });
  }

  private togglePause(): void {
    if (this.paused) {
      this.closePause();
      return;
    }
    const phase = this.sim.state.phase;
    if (this.ending || (phase !== 'spawning' && phase !== 'explaining')) return;
    this.paused = true;
    const { t } = app.i18n;
    const cy = GAME_HEIGHT / 2 - 40;
    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay);
    const dim = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg, 0.7).setInteractive();
    const title = this.add.text(CX, cy - 50, t('battle.pause.title').toUpperCase(),
      capsStyle({ fontSize: `${SIZES.heading}px`, letterSpacing: LETTER_SPACING.wide })).setOrigin(0.5);
    const resume = new Button(this, CX, cy + 6, t('battle.pause.resume'), () => this.closePause(), { width: 180, height: 36 });
    const abandon = new Button(this, CX, cy + 54, t('battle.pause.abandon'), () => this.scene.start('StarMap'), {
      width: 180, height: 36, variant: 'ghost',
    });
    overlay.add([dim, title, resume, abandon]);
    this.pauseOverlay = overlay;
  }

  private closePause(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
  }

  // ------------------------------------------------------------------ rendering

  private renderState(): void {
    const s = this.sim.state;

    // Enemies follow the sim, mapped onto the stations and scaled with depth; the lowest draws on top.
    const alive = new Set<number>();
    const items: TagItem[] = [];
    for (const e of s.enemies) {
      alive.add(e.id);
      const ship = this.ensureShip(e);
      ship.setShipSize(shipSize(e.y))
        .setPosition(e.x, shipScreenY(e.y))
        .setThreat(threatOf(e.y))
        .setCharge(e.armed ? e.charge : null, COCKPIT)
        .setDepth(DEPTH.enemies + e.y / 1000);
      items.push({
        id: e.id, x: ship.x, y: ship.y, shipHalfW: ship.shipHalfWidth, shipHalfH: ship.shipHalfHeight,
        tagW: ship.tagWidth, tagH: ship.tagHeight,
      });
    }
    for (const id of [...this.ships.keys()]) if (!alive.has(id)) this.removeShip(id);
    this.tagSides = layoutTags(items, this.tagSides);
    for (const [id, side] of this.tagSides) this.ships.get(id)?.setTagSide(side);

    s.domes.forEach((d, i) => this.stations[i].setHp(d.hp, d.maxHp));

    this.dash.setWave(s.wave, s.totalWaves);
    this.dash.setScore(s.score);
    this.dash.setStreak(s.streak);
    this.dash.setStations(s.domes);
    this.dash.setHull(s.hull, s.hullMax);
    const shown = s.input.startsWith('-') ? `${MINUS}${s.input.slice(1)}` : s.input;
    const blinkOn = Math.floor(this.time.now / 500) % 2 === 0;
    this.dash.setInput(shown, blinkOn && s.phase === 'spawning' && !this.paused && !this.ending);
  }

  // ------------------------------------------------------------------ teardown

  private onShutdown(): void {
    app.sfx.stopAmbience(1.5);
    window.removeEventListener('keydown', this.onKeyDown);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.off(SIM_EVENTS, this.handleEvents, this);
    this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.starfield?.destroy();
    this.starfield = null;
    this.bg = null;
    this.ships.clear();
    this.tagSides.clear();
    for (const st of this.stations) st.destroy();
    this.stations = [];
    this.explainDim = null;
    this.explainCard = null;
    this.pauseOverlay = null;
    this.breachFx = [];
    if (import.meta.env.DEV) delete (window as unknown as { __forceBreach?: unknown }).__forceBreach;
    if (this.scene.isActive('Upgrade') || this.scene.isPaused('Upgrade')) this.scene.stop('Upgrade');
    if (this.scene.isActive('Boarding') || this.scene.isPaused('Boarding')) this.scene.stop('Boarding');
  }
}
