import Phaser from 'phaser';
import { COLORS, DEPTH } from '../ui/theme';
import { flash, sparks } from './BattleFx';
import { explode } from './Explosion';
import { STATION_W } from './battleLayout';
import { TEX } from './textures';

/** Hull chunks cut from the station texture, and loose plate shards drawn in code. */
const CHUNKS = 9;
const SHARDS = 5;
const EMBERS = 7;
/** Half-axes (px) of the ellipse the debris settles inside, around the station centre. */
const FIELD_RX = 44;
const FIELD_RY = 22;
/** Per-second decay of the blast velocity toward the slow residual drift. */
const DRAG = 1.5;
/** Inward pull (px/s^2 per px outside) for a piece that wandered past the ellipse. */
const PULL = 0.9;
const SHARD_KEYS = ['tex-wreck-shard-0', 'tex-wreck-shard-1', 'tex-wreck-shard-2', 'tex-wreck-shard-3'];
const SHARD_SIZE = 24;
const CHUNK_FRAMES = 12;
/** Chunk crop areas as fractions of the station frame: the core body, and the flat ring. */
const BODY = { x0: 0.3, x1: 0.7, y0: 0.24, y1: 0.86 };
const RING = { x0: 0.04, x1: 0.96, y0: 0.55, y1: 0.64 };
const CHUNK_TINTS = [0x8a857c, 0x6f6b64, 0x5c5953];
const EMBER_TINTS = [COLORS.primary, 0xffd27a, COLORS.danger];

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const sign = (): number => (Math.random() < 0.5 ? -1 : 1);

interface Piece {
  img: Phaser.GameObjects.Image;
  x: number; y: number;          // offset from the station centre
  vx: number; vy: number;
  rvx: number; rvy: number;      // residual drift it settles into
  spin: number; restSpin: number;
}

interface Ember {
  img: Phaser.GameObjects.Image;
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; phase: number;
}

/** Crop frames on the station texture (once per texture), so chunks rotate about their own centre. */
function chunkFrames(scene: Phaser.Scene, key: string): string[] {
  const tex = scene.textures.get(key);
  // Texture.add() makes the first added frame the default one: keep the whole image the default.
  const first = tex.firstFrame;
  const base = tex.get(first);
  const names: string[] = [];
  for (let k = 0; k < CHUNK_FRAMES; k++) {
    const name = `wreck-chunk-${k}`;
    names.push(name);
    if (tex.has(name)) continue;
    const area = k < 3 ? RING : BODY;
    const w = Math.round(base.width * (k < 3 ? rnd(0.12, 0.2) : rnd(0.1, 0.2)));
    const h = Math.round(base.height * (k < 3 ? rnd(0.05, 0.08) : rnd(0.08, 0.18)));
    const x = Math.round(base.width * rnd(area.x0, area.x1) - w / 2);
    const y = Math.round(base.height * rnd(area.y0, area.y1) - h / 2);
    tex.add(name, base.sourceIndex,
      base.cutX + Phaser.Math.Clamp(x, 0, base.width - w), base.cutY + Phaser.Math.Clamp(y, 0, base.height - h), w, h);
  }
  tex.firstFrame = first;
  return names;
}

/** Small angular dark plates with a faint rim light on the lit edge (generated once). */
function ensureShardTextures(scene: Phaser.Scene): void {
  SHARD_KEYS.forEach((key, k) => {
    if (scene.textures.exists(key)) return;
    const c = SHARD_SIZE / 2;
    const n = 4 + (k % 3);
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.35, 0.35);
      const r = c * rnd(0.45, 0.95) * (i % 2 === 0 ? 1 : 0.7);
      pts.push(new Phaser.Math.Vector2(c + Math.cos(a) * r, c + Math.sin(a) * r * 0.75));
    }
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x24262a, 1);
    g.fillPoints(pts, true);
    // Rim light along the upper edges only (light from above, off the planet).
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      if ((p.y + q.y) / 2 > c) continue;
      g.lineStyle(1, i % 2 === 0 ? 0x9a958a : 0xb07a44, 0.85);
      g.lineBetween(p.x, p.y, q.x, q.y);
    }
    g.generateTexture(key, SHARD_SIZE, SHARD_SIZE);
    g.destroy();
  });
}

/**
 * A destroyed station's debris field: dark hull chunks and plate shards that fly apart, then
 * settle into a very slow drift and tumble inside the station's area; embers that cool over a
 * few seconds, a dying fire glow and an occasional tiny spark. Objects are made once and reused
 * across destroy / repair cycles. Driven only by update(dtMs), so it freezes with the pause menu.
 */
export class StationWreck {
  private readonly scene: Phaser.Scene;
  private readonly cx: number;
  private readonly cy: number;
  private readonly textureKey: string;
  private pieces: Piece[] = [];
  private embers: Ember[] = [];
  private glow: Phaser.GameObjects.Image | null = null;
  private spark: Phaser.GameObjects.Image | null = null;
  private glowMs = 0;
  private sparkMs = 0;
  private nextSparkMs = 0;
  private active = false;

  constructor(scene: Phaser.Scene, cx: number, cy: number, textureKey: string) {
    this.scene = scene;
    this.cx = cx;
    this.cy = cy;
    this.textureKey = textureKey;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Shows the field. `blast` plays the explosion and throws the pieces outward; without it
   * (a station already wrecked when first shown) the pieces start settled.
   */
  show(blast: boolean): void {
    this.build();
    this.active = true;
    const speed = blast ? 1 : 0;
    for (const p of this.pieces) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(22, 62) * speed;
      p.x = rnd(-STATION_W * 0.32, STATION_W * 0.32);
      p.y = rnd(-11, 11);
      p.vx = Math.cos(a) * v + p.x * 0.6 * speed;
      p.vy = Math.sin(a) * v * 0.5;
      const ra = rnd(0, Math.PI * 2);
      const rv = rnd(1.2, 3.5);
      p.rvx = Math.cos(ra) * rv;
      p.rvy = Math.sin(ra) * rv * 0.5;
      p.restSpin = sign() * rnd(0.08, 0.4);
      p.spin = blast ? sign() * rnd(1.5, 5) : p.restSpin;
      if (!blast) {
        p.x *= 1.3;
        p.y *= 1.3;
      }
      p.img.setRotation(rnd(0, Math.PI * 2)).setVisible(true);
      this.place(p.img, p.x, p.y);
    }
    for (const e of this.embers) {
      if (!blast) {
        e.life = 0;
        e.img.setVisible(false);
        continue;
      }
      const a = rnd(0, Math.PI * 2);
      const v = rnd(10, 45);
      e.x = rnd(-14, 14);
      e.y = rnd(-6, 6);
      e.vx = Math.cos(a) * v;
      e.vy = Math.sin(a) * v * 0.5;
      e.maxLife = rnd(2500, 7000);
      e.life = e.maxLife;
      e.size = rnd(0.12, 0.26);
      e.phase = rnd(0, Math.PI * 2);
      e.img.setTint(EMBER_TINTS[Math.floor(Math.random() * EMBER_TINTS.length)]).setVisible(true);
    }
    this.glowMs = blast ? 3800 : 0;
    this.glow?.setVisible(blast).setAlpha(0);
    this.sparkMs = 0;
    this.spark?.setVisible(false);
    this.nextSparkMs = rnd(1500, 3500);
    if (blast) this.blast();
  }

  /** Removes the field (station repaired). */
  hide(): void {
    this.active = false;
    for (const p of this.pieces) p.img.setVisible(false);
    for (const e of this.embers) {
      e.life = 0;
      e.img.setVisible(false);
    }
    this.glow?.setVisible(false);
    this.spark?.setVisible(false);
  }

  update(dtMs: number): void {
    if (!this.active || dtMs <= 0) return;
    const s = dtMs / 1000;
    const damp = Math.exp(-DRAG * s);
    for (const p of this.pieces) {
      p.vx = p.rvx + (p.vx - p.rvx) * damp;
      p.vy = p.rvy + (p.vy - p.rvy) * damp;
      p.spin = p.restSpin + (p.spin - p.restSpin) * damp;
      const ex = p.x / FIELD_RX;
      const ey = p.y / FIELD_RY;
      const d = ex * ex + ey * ey;
      if (d > 1) {
        // Outside the area: pull back in, and turn the residual drift inward.
        p.vx -= p.x * PULL * s;
        p.vy -= p.y * PULL * 2 * s;
        if (p.rvx * p.x + p.rvy * p.y > 0) {
          p.rvx = -p.rvx;
          p.rvy = -p.rvy;
        }
      }
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.img.rotation += p.spin * s;
      this.place(p.img, p.x, p.y);
    }
    for (const e of this.embers) {
      if (e.life <= 0) continue;
      e.life -= dtMs;
      if (e.life <= 0) {
        e.img.setVisible(false);
        continue;
      }
      const ed = Math.exp(-2.2 * s);
      e.vx *= ed;
      e.vy *= ed;
      e.x += e.vx * s;
      e.y += e.vy * s;
      const k = e.life / e.maxLife;
      e.phase += s * 11;
      const flicker = 0.75 + 0.25 * Math.sin(e.phase);
      e.img.setScale(e.size * (0.5 + 0.5 * k)).setAlpha(k * k * flicker);
      this.place(e.img, e.x, e.y);
    }
    if (this.glow && this.glowMs > 0) {
      this.glowMs = Math.max(0, this.glowMs - dtMs);
      const k = this.glowMs / 3800;
      // Rises fast under the blast, then the fire dies down.
      this.glow.setAlpha(Math.min(1, (1 - k) * 12) * k * 0.5);
      if (this.glowMs === 0) this.glow.setVisible(false);
    }
    this.updateSpark(dtMs);
  }

  destroy(): void {
    for (const p of this.pieces) p.img.destroy();
    for (const e of this.embers) e.img.destroy();
    this.glow?.destroy();
    this.spark?.destroy();
    this.pieces = [];
    this.embers = [];
    this.glow = null;
    this.spark = null;
    this.active = false;
  }

  // ------------------------------------------------------------------ internals

  private place(img: Phaser.GameObjects.Image, x: number, y: number): void {
    img.setPosition(this.cx + x, this.cy + y);
  }

  /** Small, punchy blast: white core flash, amber fireball, a scaled particle burst, a thin shockwave ring. */
  private blast(): void {
    const { scene, cx, cy } = this;
    flash(scene, cx, cy, COLORS.white, STATION_W * 0.9, 170);
    flash(scene, cx, cy, COLORS.primary, STATION_W * 2.3, 640);
    explode(scene, cx, cy, COLORS.primary, 0.42);
    sparks(scene, cx, cy, 0xffd27a, 14, 130);
    const ringObj = scene.add.circle(cx, cy, 6).setStrokeStyle(1.5, 0xffd9a0, 0.9)
      .setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: ringObj, radius: STATION_W * 1.25, alpha: 0, duration: 520, ease: 'Cubic.easeOut',
      onComplete: () => ringObj.destroy(),
    });
  }

  private updateSpark(dtMs: number): void {
    const sp = this.spark;
    if (!sp) return;
    if (this.sparkMs > 0) {
      this.sparkMs = Math.max(0, this.sparkMs - dtMs);
      sp.setAlpha(this.sparkMs / 140);
      if (this.sparkMs === 0) sp.setVisible(false);
      return;
    }
    this.nextSparkMs -= dtMs;
    if (this.nextSparkMs > 0 || this.pieces.length === 0) return;
    this.nextSparkMs = rnd(1800, 4500);
    const p = this.pieces[Math.floor(Math.random() * this.pieces.length)];
    this.sparkMs = 140;
    sp.setScale(rnd(0.18, 0.3)).setAlpha(1).setVisible(true);
    this.place(sp, p.x + rnd(-2, 2), p.y + rnd(-2, 2));
  }

  /** Makes the pooled objects on first use. */
  private build(): void {
    if (this.pieces.length > 0) return;
    const scene = this.scene;
    const frames = chunkFrames(scene, this.textureKey);
    const tex = scene.textures.get(this.textureKey);
    const texScale = STATION_W / tex.get(tex.firstFrame).width;
    ensureShardTextures(scene);
    for (let i = 0; i < CHUNKS + SHARDS; i++) {
      let img: Phaser.GameObjects.Image;
      if (i < CHUNKS) {
        img = scene.add.image(0, 0, this.textureKey, frames[(i * 5 + Math.floor(Math.random() * 3)) % frames.length])
          .setScale(texScale * rnd(0.85, 1.15))
          .setTint(CHUNK_TINTS[i % CHUNK_TINTS.length]);
        if (Math.random() < 0.5) img.setFlipX(true);
      } else {
        img = scene.add.image(0, 0, SHARD_KEYS[i % SHARD_KEYS.length]).setScale(rnd(0.3, 0.55));
      }
      img.setDepth(DEPTH.world + 2).setVisible(false);
      this.pieces.push({ img, x: 0, y: 0, vx: 0, vy: 0, rvx: 0, rvy: 0, spin: 0, restSpin: 0 });
    }
    for (let i = 0; i < EMBERS; i++) {
      const img = scene.add.image(0, 0, TEX.particle).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.world + 3).setVisible(false);
      this.embers.push({ img, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 0.2, phase: 0 });
    }
    this.glow = scene.add.image(this.cx, this.cy, TEX.glow).setTint(COLORS.danger)
      .setBlendMode(Phaser.BlendModes.ADD).setScale((STATION_W * 1.3) / 128).setDepth(DEPTH.world + 1).setVisible(false);
    this.spark = scene.add.image(0, 0, TEX.particle).setTint(0xffe6b8)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.world + 3).setVisible(false);
  }
}
