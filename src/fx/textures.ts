import Phaser from 'phaser';
import { COLORS } from '../ui/theme';

/** Keys of the procedural textures generated at boot. */
export const TEX = {
  star: 'tex-star',               // 4x4 soft white dot
  glow: 'tex-glow',               // 128x128 soft radial glow, white (tint it)
  enemy: 'tex-enemy',             // 64x64 angular hostile ship, nose pointing down
  enemyAlt: 'tex-enemy-alt',      // 64x64 alternative hull
  dome: 'tex-dome',               // 120x64 intact shield dome
  domeDamaged: 'tex-dome-damaged',
  domeRuin: 'tex-dome-ruin',
  planetSmall: 'tex-planet-small', // 64x64 shaded white sphere (tint it)
  particle: 'tex-particle',       // 16x16 soft white spark
  laser: 'tex-laser',             // 12x128 vertical beam, white core (tint it)
} as const;

type GraphicsDraw = (g: Phaser.GameObjects.Graphics) => void;

function fromGraphics(scene: Phaser.Scene, key: string, w: number, h: number, draw: GraphicsDraw): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function fromCanvas(scene: Phaser.Scene, key: string, w: number, h: number,
                    draw: (ctx: CanvasRenderingContext2D) => void): void {
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

function radial(ctx: CanvasRenderingContext2D, size: number, stops: Array<[number, string]>): void {
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

function drawEnemy(g: Phaser.GameObjects.Graphics, hull: number, trim: number): void {
  // Hull: arrowhead pointing down, swept wings.
  g.fillStyle(hull, 1);
  g.fillPoints([
    new Phaser.Math.Vector2(32, 62), new Phaser.Math.Vector2(44, 34), new Phaser.Math.Vector2(62, 14),
    new Phaser.Math.Vector2(46, 18), new Phaser.Math.Vector2(38, 4), new Phaser.Math.Vector2(26, 4),
    new Phaser.Math.Vector2(18, 18), new Phaser.Math.Vector2(2, 14), new Phaser.Math.Vector2(20, 34),
  ], true);
  g.lineStyle(2, trim, 0.9);
  g.strokePoints([
    new Phaser.Math.Vector2(32, 62), new Phaser.Math.Vector2(44, 34), new Phaser.Math.Vector2(62, 14),
    new Phaser.Math.Vector2(46, 18), new Phaser.Math.Vector2(38, 4), new Phaser.Math.Vector2(26, 4),
    new Phaser.Math.Vector2(18, 18), new Phaser.Math.Vector2(2, 14), new Phaser.Math.Vector2(20, 34),
  ], true, true);
  // Cockpit and engine glow.
  g.fillStyle(trim, 1);
  g.fillTriangle(32, 48, 37, 30, 27, 30);
  g.fillStyle(0xffd27a, 0.9);
  g.fillRect(27, 4, 4, 5);
  g.fillRect(33, 4, 4, 5);
}

function drawEnemyAlt(g: Phaser.GameObjects.Graphics, hull: number, trim: number): void {
  // Heavier interceptor: diamond core with forward prongs.
  const pts = [
    new Phaser.Math.Vector2(32, 60), new Phaser.Math.Vector2(40, 44), new Phaser.Math.Vector2(56, 52),
    new Phaser.Math.Vector2(60, 26), new Phaser.Math.Vector2(44, 8), new Phaser.Math.Vector2(20, 8),
    new Phaser.Math.Vector2(4, 26), new Phaser.Math.Vector2(8, 52), new Phaser.Math.Vector2(24, 44),
  ];
  g.fillStyle(hull, 1);
  g.fillPoints(pts, true);
  g.lineStyle(2, trim, 0.9);
  g.strokePoints(pts, true, true);
  g.fillStyle(trim, 1);
  g.fillCircle(32, 30, 7);
  g.fillStyle(0xffd27a, 0.9);
  g.fillRect(22, 6, 6, 4);
  g.fillRect(36, 6, 6, 4);
}

function drawDome(g: Phaser.GameObjects.Graphics, state: 0 | 1 | 2): void {
  const w = 120;
  const base = 56;
  // Base platform.
  g.fillStyle(0x24344a, 1);
  g.fillRect(4, base, w - 8, 8);
  g.lineStyle(1, COLORS.primaryDim, 1);
  g.strokeRect(4, base, w - 8, 8);
  if (state === 2) {
    // Ruin: broken stubs.
    g.fillStyle(0x3a2f2f, 1);
    g.fillTriangle(16, base, 30, base - 18, 40, base);
    g.fillTriangle(70, base, 84, base - 12, 98, base);
    g.fillStyle(COLORS.danger, 0.6);
    g.fillCircle(56, base - 3, 3);
    return;
  }
  const shell = state === 0 ? COLORS.primary : COLORS.accent;
  g.fillStyle(shell, state === 0 ? 0.22 : 0.14);
  g.slice(w / 2, base, 50, Math.PI, 0, false);
  g.fillPath();
  g.lineStyle(2, shell, state === 0 ? 0.95 : 0.7);
  g.beginPath();
  g.arc(w / 2, base, 50, Math.PI, 0, false);
  g.strokePath();
  // Inner structure.
  g.fillStyle(0x9fb4cc, 1);
  g.fillRect(44, base - 18, 32, 18);
  g.fillStyle(0xd8e6f5, 1);
  g.fillRect(54, base - 30, 12, 12);
  if (state === 1) {
    g.lineStyle(2, COLORS.danger, 0.9);
    g.beginPath();
    g.moveTo(30, base - 34); g.lineTo(42, base - 24); g.lineTo(36, base - 14);
    g.moveTo(82, base - 40); g.lineTo(76, base - 28); g.lineTo(88, base - 20);
    g.strokePath();
  }
}

/** Creates every texture in TEX. Safe to call more than once (existing keys are kept). */
export function generateTextures(scene: Phaser.Scene): void {
  const has = (k: string): boolean => scene.textures.exists(k);

  if (!has(TEX.star)) fromCanvas(scene, TEX.star, 4, 4, (ctx) =>
    radial(ctx, 4, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]));

  if (!has(TEX.glow)) fromCanvas(scene, TEX.glow, 128, 128, (ctx) =>
    radial(ctx, 128, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.45)'],
      [0.6, 'rgba(255,255,255,0.1)'], [1, 'rgba(255,255,255,0)']]));

  if (!has(TEX.particle)) fromCanvas(scene, TEX.particle, 16, 16, (ctx) =>
    radial(ctx, 16, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]));

  if (!has(TEX.planetSmall)) fromCanvas(scene, TEX.planetSmall, 64, 64, (ctx) => {
    const grad = ctx.createRadialGradient(24, 22, 4, 32, 32, 31);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#d6d6d6');
    grad.addColorStop(1, '#5c5c5c');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
  });

  if (!has(TEX.laser)) fromCanvas(scene, TEX.laser, 12, 128, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 12, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 12, 128);
  });

  if (!has(TEX.enemy)) fromGraphics(scene, TEX.enemy, 64, 64, (g) => drawEnemy(g, 0x5a2430, COLORS.danger));
  if (!has(TEX.enemyAlt)) fromGraphics(scene, TEX.enemyAlt, 64, 64, (g) => drawEnemyAlt(g, 0x4a2a1a, COLORS.accent));
  if (!has(TEX.dome)) fromGraphics(scene, TEX.dome, 120, 64, (g) => drawDome(g, 0));
  if (!has(TEX.domeDamaged)) fromGraphics(scene, TEX.domeDamaged, 120, 64, (g) => drawDome(g, 1));
  if (!has(TEX.domeRuin)) fromGraphics(scene, TEX.domeRuin, 120, 64, (g) => drawDome(g, 2));
}
