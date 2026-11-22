import Phaser from 'phaser';
import { app } from '../app';
import { IMG, battleBgFor, hasImage } from '../fx/assets';
import { addBackdrop, addShade } from '../fx/backdrop';
import { DASH_SCALE, DASH_X, DASH_Y } from '../fx/battleLayout';
import { WarpStreaks } from '../fx/WarpStreaks';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../ui/theme';

export interface FtlSceneData { planetId: string; }

/** Phase lengths, ms: charge (points, push), tunnel (streaks), exit (collapse and swell). */
const CHARGE_MS = 500;
const TUNNEL_MS = 1500;
const EXIT_MS = 600;
const TOTAL_MS = CHARGE_MS + TUNNEL_MS + EXIT_MS;

const STAR_COUNT = 420;
/** Slight push toward the vanishing point during the charge. */
const PUSH_ZOOM = 1.045;
/** Peak of the brightness swell at the exit (no hard white flash). */
const SWELL_PEAK = 0.6;
/** bg_ftl: starting overscan (hides its letterbox bars), end scale factor and rotation. */
const FTL_SCALE_FROM = 1.25;
const FTL_SCALE_TO = 1.6;
const FTL_ROTATION = 0.22;
const FTL_ALPHA = 0.9;
/** Where the battle screen's darkness under the console begins (see Dashboard). */
const DASH_SHADE_TOP = 580;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => { const x = clamp01(v); return x * x * (3 - 2 * x); };

/**
 * The jump between the star map and the mission (about 2.6 s, any key or click skips it):
 * stars as points with a slight push, then radial streaks accelerating while bg_ftl fades in,
 * turning and growing, then the streaks collapse to points under a soft brightness swell and
 * the ship drops out onto the battle background. The dashboard stays along the bottom.
 */
export class FtlScene extends Phaser.Scene {
  private planetId = '';
  private elapsed = 0;
  private finished = false;
  private exitSoundPlayed = false;
  private streaks: WarpStreaks | null = null;
  private ftlBg: Phaser.GameObjects.Image | null = null;
  private ftlBaseScale = 1;
  private arrivalBg: Phaser.GameObjects.Image | null = null;
  private swell!: Phaser.GameObjects.Rectangle;
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    this.finish();
  };

  constructor() {
    super('Ftl');
  }

  create(data: FtlSceneData): void {
    this.planetId = data.planetId;
    this.elapsed = 0;
    this.finished = false;
    this.exitSoundPlayed = false;

    this.ftlBg = addBackdrop(this, IMG.bg.ftl, { overscan: FTL_SCALE_FROM });
    if (this.ftlBg) {
      this.ftlBaseScale = this.ftlBg.scale / FTL_SCALE_FROM;
      this.ftlBg.setAlpha(0);
    }
    this.arrivalBg = addBackdrop(this, battleBgFor(this.planetId), { depth: DEPTH.background + 1 });
    this.arrivalBg?.setAlpha(0);

    this.streaks = new WarpStreaks(this, { count: STAR_COUNT, depth: DEPTH.fx, seed: 'ftl-jump' });
    this.swell = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.text, 1)
      .setDepth(DEPTH.fx + 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.addDashboard();

    window.addEventListener('keydown', this.onKeyDown);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => this.finish());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onKeyDown);
      this.streaks?.destroy();
      this.streaks = null;
      this.ftlBg = null;
      this.arrivalBg = null;
    });

    // Spool-up: the drive charges until the exit; the previous screen's ambience gives way.
    app.sfx.stopAmbience(0.6);
    app.sfx.ftlCharge((CHARGE_MS + TUNNEL_MS) / 1000);
    this.renderFrame();
  }

  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.elapsed += Math.min(delta, 50);
    if (this.elapsed >= TOTAL_MS) {
      this.finish();
      return;
    }
    this.renderFrame();
    this.streaks?.update(delta);
  }

  /** Sets every layer for the current time. Pure arithmetic, no allocation. */
  private renderFrame(): void {
    const t = this.elapsed;
    const streaks = this.streaks;
    if (!streaks) return;
    let intensity: number;
    let ftlAlpha = 0;
    let arrival = 0;
    let swell = 0;
    let starAlpha = 1;

    if (t < CHARGE_MS) {
      const p = t / CHARGE_MS;
      intensity = 0.06 * p;
      streaks.setZoom(1 + (PUSH_ZOOM - 1) * smooth(p));
    } else if (t < CHARGE_MS + TUNNEL_MS) {
      const p = (t - CHARGE_MS) / TUNNEL_MS;
      intensity = 0.06 + 0.94 * p;
      ftlAlpha = FTL_ALPHA * smooth(p / 0.7);
      streaks.setZoom(PUSH_ZOOM);
    } else {
      const q = clamp01((t - CHARGE_MS - TUNNEL_MS) / EXIT_MS);
      intensity = (1 - q) * (1 - q);
      ftlAlpha = FTL_ALPHA * (1 - smooth(q / 0.8));
      swell = SWELL_PEAK * Math.sin(Math.PI * q);
      arrival = smooth((q - 0.35) / 0.65);
      starAlpha = 1 - smooth((q - 0.5) / 0.5);
      if (!this.exitSoundPlayed) {
        this.exitSoundPlayed = true;
        app.sfx.ftlDrop();
      }
    }

    streaks.setIntensity(intensity).setAlpha(starAlpha);
    if (this.ftlBg) {
      const k = clamp01((t - CHARGE_MS) / (TUNNEL_MS + EXIT_MS));
      this.ftlBg.setAlpha(ftlAlpha)
        .setRotation(FTL_ROTATION * k)
        .setScale(this.ftlBaseScale * (FTL_SCALE_FROM + (FTL_SCALE_TO - FTL_SCALE_FROM) * k * k));
    }
    this.arrivalBg?.setAlpha(arrival);
    this.swell.setAlpha(swell);
  }

  /**
   * The cockpit console exactly where the battle screen draws it (battleLayout: DASH_X/Y at
   * DASH_SCALE), with the same darkness under and beside it, so the drop-out is seamless.
   */
  private addDashboard(): void {
    addShade(this, 0, { from: DASH_SHADE_TOP, alpha: 0.85 }, DEPTH.hud - 1);
    if (!hasImage(this, IMG.ui.dash)) return;
    this.add.image(DASH_X, DASH_Y, IMG.ui.dash).setOrigin(0, 0).setScale(DASH_SCALE).setDepth(DEPTH.hud);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    // Skipped before the exit: still drop out (this also cuts the charge hum).
    if (!this.exitSoundPlayed) {
      this.exitSoundPlayed = true;
      app.sfx.ftlDrop();
    }
    this.scene.start('Battle', { planetId: this.planetId });
  }
}
