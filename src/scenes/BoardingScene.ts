import Phaser from 'phaser';
import { app } from '../app';
import type { BoardingResult } from '../core/battle';
import { APPROACH_MS, BoardingSim } from '../core/boarding';
import type { BoardingEvent, Crawler as CrawlerState } from '../core/boarding';
import { formatProblem } from '../core/facts';
import { MINUS } from '../core/i18n';
import type { Fact } from '../core/types';
import { hasImage, IMG } from '../fx/assets';
import { beam, flash, shipExplosion, sparks } from '../fx/BattleFx';
import { KEY_GAP, KEYPAD_DIGITS, KEYPAD_FIRE, layoutTags, PAUSE_RECT } from '../fx/battleLayout';
import type { Point, TagItem, TagSide } from '../fx/battleLayout';
import {
  approach, BEACONS, boardingMissPoint, crackleGate, DOOR_Y, HORIZON_Y, READOUT, SPARK_LAMPS,
} from '../fx/boardingLayout';
import { Crawler } from '../fx/Crawler';
import { HangarGuns } from '../fx/HangarGuns';
import { LampFlicker } from '../fx/LampFlicker';
import { TEX } from '../fx/textures';
import { Button } from '../ui/Button';
import { addHitZone } from '../ui/hitZone';
import { Keypad } from '../ui/Keypad';
import { isGameKey, keyAction } from '../ui/keymap';
import { drawBrackets } from '../ui/Panel';
import { capsStyle, numeralStyle } from '../ui/TextStyles';
import { COLORS, CSS, DEPTH, GAME_HEIGHT, GAME_WIDTH, LETTER_SPACING, LINE_WIDTH, SIZES } from '../ui/theme';

export interface BoardingSceneData {
  facts: Fact[];
  seed: number;
  speedScale: number;
  /** settings.density (default 1), forwarded to BoardingSim. */
  density?: number;
  /** Called once when the fight ends (the scene stops itself right after). */
  onDone: (result: BoardingResult) => void;
}

const CX = GAME_WIDTH / 2;
const MAX_FRAME_MS = 100;
const TITLE_Y = 236;
const TITLE_MS = 1100;
const REPELLED_MS = 1400;
const OVERRUN_MS = 1300;
const WRONG_SOUND_DELAY_MS = 200;
const BEACON_PERIOD_MS = 1300;
/** Darkness over the hangar: base level, and the depth of a failing-light dip. */
const DARK_BASE = 0.1;
const DARK_DIP = 0.55;
const PIP_W = 16;
const PIP_H = 5;
const PIP_GAP = 6;

/**
 * Boarding fight, launched over the paused Battle when the hull is breached. Crawlers come
 * out of the far door of the hangar (`bg_hangar`) and scuttle at the player in one-point
 * perspective; a correct answer fires both guns at the nearest matching crawler. A crawler
 * that reaches the guns bites (three bites and the ship is lost). Text: one title word.
 */
export class BoardingScene extends Phaser.Scene {
  private sim!: BoardingSim;
  private onDone: ((r: BoardingResult) => void) | null = null;
  private crawlers = new Map<number, Crawler>();
  private tagSides = new Map<number, TagSide>();
  private dark: Phaser.GameObjects.Rectangle | null = null;
  private wash: Phaser.GameObjects.Rectangle | null = null;
  private beacons: Phaser.GameObjects.Image[] = [];
  private lamps: LampFlicker | null = null;
  private guns: HangarGuns | null = null;
  /** Scene clock of the last lamp crackle (sound rationed by crackleGate). */
  private crackleAt = -Infinity;
  private inputText!: Phaser.GameObjects.Text;
  private caret!: Phaser.GameObjects.Rectangle;
  private pips!: Phaser.GameObjects.Graphics;
  private pipSig = '';
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private paused = false;
  private finished = false;
  private clockMs = 0;
  private dipMs = 0;
  private skitterMs = 0;

  constructor() {
    super('Boarding');
  }

  create(data: BoardingSceneData): void {
    this.sim = new BoardingSim({ facts: data.facts, seed: data.seed, speedScale: data.speedScale, density: data.density });
    this.onDone = data.onDone;
    this.crawlers = new Map();
    this.tagSides = new Map();
    this.beacons = [];
    this.lamps = null;
    this.guns = null;
    this.crackleAt = -Infinity;
    this.pipSig = '';
    this.pauseOverlay = null;
    this.paused = false;
    this.finished = false;
    this.clockMs = 0;
    this.dipMs = 0;
    this.skitterMs = 0;

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.buildHangar();
    this.guns = new HangarGuns(this);
    this.buildLights();
    this.buildReadout();
    this.buildPauseGlyph();
    this.buildKeypad();

    window.removeEventListener('keydown', this.onKeyDown);
    window.addEventListener('keydown', this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);

    this.cameras.main.fadeIn(350, 0, 0, 0);
    app.sfx.screech(0.5);
    app.sfx.startHangar();
    this.showBanner(app.i18n.t('battle.boarding'), TITLE_MS, COLORS.danger);
    this.renderHud();
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, MAX_FRAME_MS);
    const live = !this.paused && !this.finished;
    if (live) this.handleEvents(this.sim.step(dt));
    this.clockMs += dt;
    this.animateLights(dt);
    this.lamps?.update(this.paused ? 0 : dt);
    this.renderCrawlers(live ? dt : 0);
    this.guns?.update(this.paused ? 0 : dt, this.nearestCrawler()?.centre ?? null);
    this.renderHud();
    this.playSkitter(live ? dt : 0);
  }

  // ------------------------------------------------------------------ building

  private buildHangar(): void {
    if (hasImage(this, IMG.bg.hangar)) {
      const img = this.add.image(CX, GAME_HEIGHT / 2, IMG.bg.hangar).setDepth(DEPTH.background);
      img.setScale(Math.max(GAME_WIDTH / img.width, GAME_HEIGHT / img.height));
      // Failing strip lights painted into the picture: just above it, below beacons and crawlers.
      // Only now and then a flash crackles (crackleGate): on every one it would be too much.
      this.lamps = new LampFlicker(this, SPARK_LAMPS, DEPTH.background + 1, (lamp) => {
        if (!crackleGate(this.clockMs, this.crackleAt, Math.random())) return;
        this.crackleAt = this.clockMs;
        app.sfx.sparkCrackle(0.5 + 0.5 * lamp.size);
      });
      return;
    }
    // Fallback: a dark corridor in the same perspective and the door (the guns are HangarGuns).
    const g = this.add.graphics().setDepth(DEPTH.background);
    g.fillStyle(0x07090c, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(0x0d1117, 1);
    g.fillRect(0, DOOR_Y, GAME_WIDTH, GAME_HEIGHT - DOOR_Y);
    g.fillStyle(0x6f8aa6, 0.35);
    g.fillRect(550, 240, 180, DOOR_Y - 240);
    g.lineStyle(LINE_WIDTH, 0x3a4654, 0.8);
    for (let i = -8; i <= 8; i++) g.lineBetween(CX + i * 11, DOOR_Y, CX + i * 160, GAME_HEIGHT);
    for (let k = 1; k <= 8; k++) {
      const y = HORIZON_Y + (GAME_HEIGHT - HORIZON_Y) * (k / 8) ** 2;
      if (y > DOOR_Y) g.lineBetween(0, y, GAME_WIDTH, y);
    }
  }

  private buildLights(): void {
    for (const p of BEACONS) {
      this.beacons.push(this.add.image(p.x, p.y, TEX.glow).setTint(COLORS.danger)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.world).setScale(0.5));
    }
    this.wash = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.danger, 0)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 4);
    this.dark = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, DARK_BASE)
      .setDepth(DEPTH.fx + 5);
  }

  private buildReadout(): void {
    const r = READOUT;
    const g = this.add.graphics().setDepth(DEPTH.hud);
    g.fillStyle(COLORS.plate, 0.78);
    g.fillRect(r.x, r.y, r.w, r.h);
    drawBrackets(g, r.x, r.y, r.w, r.h, COLORS.primary, 0.8, 7);
    this.inputText = this.add.text(CX, r.y + r.h / 2, '', numeralStyle({ fontSize: `${SIZES.input}px`, color: CSS.primary }))
      .setOrigin(0.5).setDepth(DEPTH.hud + 1).setShadow(0, 0, CSS.primary, 6, false, true);
    this.caret = this.add.rectangle(CX, r.y + r.h - 9, 12, 3, COLORS.primary).setOrigin(0, 0.5).setDepth(DEPTH.hud + 1);
    this.pips = this.add.graphics().setDepth(DEPTH.hud + 1);
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
      .setDepth(DEPTH.hud);
  }

  // ------------------------------------------------------------------ input

  private acceptsInput(): boolean {
    return !this.paused && !this.finished;
  }

  private fire(): void {
    if (!this.acceptsInput()) return;
    this.handleEvents(this.sim.submit());
  }

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

  private handleEvents(events: BoardingEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'spawn': this.onSpawn(ev.crawler); break;
        case 'kill': this.onKill(ev.crawler); break;
        case 'wrong': this.onWrong(); break;
        case 'bite': this.onBite(ev.crawler); break;
        case 'repelled': this.onRepelled(); break;
        case 'overrun': this.onOverrun(); break;
      }
    }
  }

  private ensureCrawler(c: CrawlerState): Crawler {
    let v = this.crawlers.get(c.id);
    if (!v) {
      // Walk-cycle rate follows the approach speed (z per second relative to a speed-1 crawler).
      v = new Crawler(this, c.id, c.kind, formatProblem(c.fact, app.i18n.locale), c.speed / (1000 / APPROACH_MS));
      v.follow(0, c.z, c.lane);
      this.crawlers.set(c.id, v);
    }
    return v;
  }

  private onSpawn(c: CrawlerState): void {
    this.ensureCrawler(c);
    if (Math.random() < 0.45) this.time.delayedCall(Phaser.Math.Between(150, 600), () => app.sfx.screech(0.35));
  }

  /** Both barrels snap onto `to`, kick back and fire from their rotated muzzle tips. */
  private fireGuns(to: Point, miss: boolean): void {
    for (const m of this.guns?.fire(to) ?? []) {
      beam(this, m, to, COLORS.primary, { width: 0.6, fadeInto: miss });
      flash(this, m.x, m.y, COLORS.primary, 46, 160);
    }
    app.sfx.turretShot();
  }

  /** The crawler view nearest the guns (smallest z), or null. */
  private nearestCrawler(): Crawler | null {
    let nearest: Crawler | null = null;
    for (const v of this.crawlers.values()) if (!nearest || v.depthZ < nearest.depthZ) nearest = v;
    return nearest;
  }

  private onKill(c: CrawlerState): void {
    const v = this.crawlers.get(c.id);
    const p = v ? v.centre : { x: CX, y: DOOR_Y };
    const size = Math.max(28, (v?.halfWidth ?? 14) * 1.6);
    this.fireGuns(p, false);
    shipExplosion(this, p.x, p.y, size, COLORS.primary);
    sparks(this, p.x, p.y, COLORS.danger, 10, 40 + size);
    v?.destroy();
    this.crawlers.delete(c.id);
    this.tagSides.delete(c.id);
    this.time.delayedCall(60, () => app.sfx.hit());
  }

  private onWrong(): void {
    const nearest = this.nearestCrawler();
    const aim = boardingMissPoint(nearest ? nearest.centre : null, Math.random());
    this.fireGuns(aim, true);
    this.time.delayedCall(WRONG_SOUND_DELAY_MS, () => app.sfx.wrong());
    const t = this.inputText;
    this.tweens.killTweensOf(t);
    t.x = CX;
    this.tweens.add({ targets: t, x: CX + 5, duration: 40, yoyo: true, repeat: 3, onComplete: () => { t.x = CX; } });
  }

  private onBite(c: CrawlerState): void {
    const v = this.crawlers.get(c.id);
    this.crawlers.delete(c.id);
    this.tagSides.delete(c.id);
    app.sfx.bite();
    const hit = (): void => {
      const red = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.danger, 0.75)
        .setDepth(DEPTH.overlay - 5);
      this.tweens.add({ targets: red, alpha: 0, duration: 520, ease: 'Quad.easeIn', onComplete: () => red.destroy() });
      this.vignette(0.95, 900);
      this.cameras.main.shake(450, 0.02);
    };
    if (v) v.lunge(hit);
    else hit();
  }

  private onRepelled(): void {
    app.sfx.stopHangar(REPELLED_MS / 1000);
    this.showBanner(app.i18n.t('battle.banner.waveCleared'), REPELLED_MS, COLORS.ok);
    this.time.delayedCall(REPELLED_MS, () => this.finish(true));
  }

  private onOverrun(): void {
    this.closePause();
    app.sfx.stopHangar(OVERRUN_MS / 1000);
    const black = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0).setDepth(DEPTH.overlay + 5);
    this.tweens.add({ targets: black, alpha: 1, delay: 450, duration: OVERRUN_MS - 450 });
    this.time.delayedCall(OVERRUN_MS, () => this.finish(false));
  }

  private finish(repelled: boolean): void {
    const done = this.onDone;
    if (!done) return;
    this.onDone = null;
    this.finished = true;
    const result: BoardingResult = { repelled, records: [...this.sim.records], kills: this.sim.state.kills };
    this.scene.stop();
    done(result);
  }

  // ------------------------------------------------------------------ rendering

  private renderCrawlers(dt: number): void {
    const alive = new Set<number>();
    const items: TagItem[] = [];
    for (const c of this.sim.state.crawlers) {
      alive.add(c.id);
      const v = this.ensureCrawler(c).follow(dt, c.z, c.lane);
      const ctr = v.centre;
      items.push({
        id: c.id, x: ctr.x, y: ctr.y, shipHalfW: v.halfWidth, shipHalfH: v.halfHeight, tagW: v.tagWidth, tagH: v.tagHeight,
      });
    }
    for (const id of [...this.crawlers.keys()]) {
      if (alive.has(id)) continue;
      this.crawlers.get(id)?.destroy();
      this.crawlers.delete(id);
      this.tagSides.delete(id);
    }
    this.tagSides = layoutTags(items, this.tagSides);
    for (const [id, side] of this.tagSides) this.crawlers.get(id)?.setTagSide(side);
  }

  private renderHud(): void {
    const s = this.sim.state;
    const shown = s.input.startsWith('-') ? `${MINUS}${s.input.slice(1)}` : s.input;
    if (this.inputText.text !== shown) this.inputText.setText(shown);
    const blinkOn = Math.floor(this.time.now / 500) % 2 === 0;
    this.caret.setX(shown.length === 0 ? CX - 6 : this.inputText.x + this.inputText.width / 2 + 3);
    this.caret.setVisible(blinkOn && s.phase === 'fighting' && this.acceptsInput());

    const left = Math.max(0, s.maxBites - s.bites);
    const sig = `${left}/${s.maxBites}`;
    if (sig === this.pipSig) return;
    this.pipSig = sig;
    const g = this.pips;
    g.clear();
    const rowW = s.maxBites * PIP_W + (s.maxBites - 1) * PIP_GAP;
    const x0 = CX - rowW / 2;
    const y = READOUT.y - 12;
    for (let i = 0; i < s.maxBites; i++) {
      const x = x0 + i * (PIP_W + PIP_GAP);
      if (i < left) {
        g.fillStyle(left === 1 ? COLORS.danger : COLORS.primary, 0.95);
        g.fillRect(x, y, PIP_W, PIP_H);
      } else {
        g.lineStyle(LINE_WIDTH, COLORS.danger, 0.85);
        g.strokeRect(x + 0.5, y + 0.5, PIP_W - 1, PIP_H - 1);
      }
    }
  }

  /** Failing lights: a steady gloom with sudden dips, and the red lamps pulsing. */
  private animateLights(dt: number): void {
    if (this.dipMs > 0) {
      this.dipMs -= dt;
    } else if (Math.random() < dt / 2600) {
      this.dipMs = Phaser.Math.Between(40, 160);
    }
    const dip = this.dipMs > 0 ? DARK_DIP * (0.6 + 0.4 * Math.random()) : 0;
    this.dark?.setAlpha(DARK_BASE + dip + 0.03 * Math.sin(this.clockMs * 0.031));
    const pulse = 0.5 + 0.5 * Math.sin((this.clockMs / BEACON_PERIOD_MS) * Math.PI * 2);
    const p3 = pulse ** 3;
    for (const b of this.beacons) b.setAlpha(0.25 + 0.75 * p3).setScale(0.35 + 0.35 * p3);
    this.wash?.setAlpha(0.07 * p3);
  }

  /** Skitter on the deck: louder and denser the closer the nearest crawler. Also drives the dread music. */
  private playSkitter(dt: number): void {
    let nearZ = Infinity;
    for (const c of this.sim.state.crawlers) nearZ = Math.min(nearZ, c.z);
    const level = Number.isFinite(nearZ) ? approach(nearZ) : 0;
    app.sfx.setTension(dt > 0 ? level : 0);
    if (dt <= 0 || level <= 0) return;
    this.skitterMs -= dt;
    if (this.skitterMs > 0) return;
    this.skitterMs = 380 - 240 * level;
    app.sfx.skitter(0.15 + 0.85 * level);
  }

  private vignette(peak: number, durationMs: number): void {
    const v = this.add.image(CX, GAME_HEIGHT / 2, TEX.vignette).setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setTint(COLORS.danger).setDepth(DEPTH.overlay - 6).setAlpha(peak);
    this.tweens.add({ targets: v, alpha: 0, duration: durationMs, ease: 'Quad.easeIn', onComplete: () => v.destroy() });
  }

  /** One word in small caps between two hairlines. */
  private showBanner(text: string, durationMs: number, color: number): void {
    const banner = this.add.container(CX, TITLE_Y).setDepth(DEPTH.overlay - 5).setAlpha(0);
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

  // ------------------------------------------------------------------ pause

  private togglePause(): void {
    if (this.paused) {
      this.closePause();
      return;
    }
    if (this.finished || this.sim.state.phase !== 'fighting') return;
    this.paused = true;
    this.tweens.pauseAll();
    app.sfx.stopHangar(0.5);
    const { t } = app.i18n;
    const cy = GAME_HEIGHT / 2 - 40;
    const overlay = this.add.container(0, 0).setDepth(DEPTH.overlay + 10);
    const dim = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg, 0.7).setInteractive();
    const title = this.add.text(CX, cy - 50, t('battle.pause.title').toUpperCase(),
      capsStyle({ fontSize: `${SIZES.heading}px`, letterSpacing: LETTER_SPACING.wide })).setOrigin(0.5);
    const resume = new Button(this, CX, cy + 6, t('battle.pause.resume'), () => this.closePause(), { width: 180, height: 36 });
    const abandon = new Button(this, CX, cy + 54, t('battle.pause.abandon'), () => this.abandon(), {
      width: 180, height: 36, variant: 'ghost',
    });
    overlay.add([dim, title, resume, abandon]);
    this.pauseOverlay = overlay;
  }

  private closePause(): void {
    if (this.paused) {
      this.tweens.resumeAll();
      if (!this.finished && this.sim.state.phase === 'fighting') app.sfx.startHangar();
    }
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
  }

  /** Abort the mission from the boarding pause menu: same as Battle's abort (back to the map). */
  private abandon(): void {
    this.finished = true;
    this.onDone = null;
    this.scene.stop('Battle');
    this.scene.start('StarMap');
  }

  // ------------------------------------------------------------------ teardown

  private onShutdown(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
    app.sfx.setTension(0);
    app.sfx.stopHangar(0.6);
    this.guns?.destroy();
    this.guns = null;
    this.crawlers.clear();
    this.tagSides.clear();
    this.beacons = [];
    this.lamps?.destroy();
    this.lamps = null;
    this.dark = null;
    this.wash = null;
    this.pauseOverlay = null;
    this.paused = false;
  }
}
