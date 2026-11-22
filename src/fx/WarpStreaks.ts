import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../ui/theme';

export interface WarpStreaksOptions {
  /** Number of stars. Default 360. */
  count?: number;
  /** Centre of the jump (vanishing point). Default: centre of the view. */
  x?: number;
  y?: number;
  /** Area the stars fill, centred on (x, y). Default: the whole view (1280x720). */
  width?: number;
  height?: number;
  /** Render depth. Default DEPTH.fx. */
  depth?: number;
  /** Star colours, picked per star. Default: off-white with a few teal and amber stars. */
  colors?: readonly number[];
  /** Seed for the star layout, so a jump looks the same every time. Default 'warp'. */
  seed?: string;
}

/** Radial speed in "radii per second": idle drift, plus the full-intensity boost (squared). */
const DRIFT_SPEED = 0.04;
const WARP_SPEED = 5.2;
/** Streak length as a fraction of the star's distance from the centre at full intensity. */
const MAX_TAIL = 0.62;
/** Stars closer than this to the centre are faded in (no bright clump at the vanishing point). */
const FADE_RADIUS = 160;
const MIN_RADIUS = 6;

/**
 * Hyperspace star streaks drawn with one additive Graphics object. At intensity 0 the stars
 * are still points drifting outward very slowly; as intensity rises they accelerate away
 * from the centre and stretch into radial streaks whose length and speed grow with distance.
 * Lowering the intensity collapses the streaks back to points.
 *
 * All per-star state lives in preallocated typed arrays; `update` allocates nothing.
 * Call `update(dtMs)` every frame and `destroy()` on scene shutdown.
 */
export class WarpStreaks {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly count: number;
  private readonly maxR: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly r: Float32Array;
  private readonly speed: Float32Array;
  private readonly bright: Float32Array;
  private readonly colorIdx: Uint8Array;
  private readonly colors: readonly number[];
  private readonly rnd: Phaser.Math.RandomDataGenerator;
  private intensity = 0;
  private destroyed = false;

  constructor(scene: Phaser.Scene, opts: WarpStreaksOptions = {}) {
    this.count = Math.max(1, Math.floor(opts.count ?? 360));
    const w = opts.width ?? GAME_WIDTH;
    const h = opts.height ?? GAME_HEIGHT;
    this.maxR = Math.hypot(w / 2, h / 2) + 20;
    this.colors = opts.colors ?? [COLORS.text, COLORS.text, COLORS.text, COLORS.white, COLORS.accent, COLORS.primary];
    this.rnd = new Phaser.Math.RandomDataGenerator([opts.seed ?? 'warp']);
    this.g = scene.add.graphics({ x: opts.x ?? GAME_WIDTH / 2, y: opts.y ?? GAME_HEIGHT / 2 })
      .setDepth(opts.depth ?? DEPTH.fx)
      .setBlendMode(Phaser.BlendModes.ADD);

    const n = this.count;
    this.cos = new Float32Array(n);
    this.sin = new Float32Array(n);
    this.r = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.bright = new Float32Array(n);
    this.colorIdx = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.rnd.realInRange(0, Math.PI * 2);
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
      // Uniform over the area: r ~ sqrt(u).
      this.r[i] = MIN_RADIUS + Math.sqrt(this.rnd.frac()) * (this.maxR - MIN_RADIUS);
      this.speed[i] = this.rnd.realInRange(0.6, 1.4);
      this.bright[i] = this.rnd.realInRange(0.35, 1);
      this.colorIdx[i] = this.rnd.between(0, this.colors.length - 1);
    }
    this.draw();
  }

  /** 0 = points drifting slowly, 1 = full hyperspace streaks. */
  setIntensity(value: number): this {
    this.intensity = Math.min(1, Math.max(0, value));
    return this;
  }

  getIntensity(): number {
    return this.intensity;
  }

  /** Scales the whole field around its centre (a slight "push" toward the vanishing point). */
  setZoom(zoom: number): this {
    this.g.setScale(zoom);
    return this;
  }

  setAlpha(alpha: number): this {
    this.g.setAlpha(alpha);
    return this;
  }

  setVisible(visible: boolean): this {
    this.g.setVisible(visible);
    return this;
  }

  update(dtMs: number): void {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
    const k = this.intensity;
    const rate = DRIFT_SPEED + WARP_SPEED * k * k;
    const maxR = this.maxR;
    for (let i = 0; i < this.count; i++) {
      // Exponential outward motion: the further from the centre, the faster (perspective).
      let r = this.r[i] * (1 + rate * this.speed[i] * dt) + rate * this.speed[i] * 40 * dt;
      if (r > maxR) {
        // Respawn near the centre during a jump, anywhere when idle (keeps the field even).
        r = k > 0.2
          ? MIN_RADIUS + this.rnd.frac() * maxR * 0.25
          : MIN_RADIUS + Math.sqrt(this.rnd.frac()) * maxR * 0.5;
      }
      this.r[i] = r;
    }
    this.draw();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.g.destroy();
  }

  private draw(): void {
    const g = this.g;
    const k = this.intensity;
    const tail = MAX_TAIL * Math.pow(k, 1.4);
    g.clear();
    for (let i = 0; i < this.count; i++) {
      const r = this.r[i];
      const fade = r < FADE_RADIUS ? r / FADE_RADIUS : 1;
      const alpha = this.bright[i] * fade * (0.55 + 0.45 * k);
      if (alpha < 0.02) continue;
      const color = this.colors[this.colorIdx[i]];
      const c = this.cos[i];
      const s = this.sin[i];
      const len = Math.max(1.4, r * tail * this.speed[i]);
      const width = 1.1 + k * (r / this.maxR) * 1.3;
      const hx = c * r;
      const hy = s * r;
      // Dim long tail, bright short head: reads as a streak fading toward the centre.
      if (len > 3) {
        const tr = Math.max(0, r - len);
        g.lineStyle(width, color, alpha * 0.35);
        g.lineBetween(c * tr, s * tr, hx, hy);
        const hr = Math.max(0, r - len * 0.3);
        g.lineStyle(width, color, alpha);
        g.lineBetween(c * hr, s * hr, hx, hy);
      } else {
        g.fillStyle(color, alpha);
        g.fillRect(hx - width / 2, hy - width / 2, width, width);
      }
    }
  }
}
