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
  vignette: 'tex-vignette',       // 256x256 clear centre, white edges (tint it, stretch to the screen)
  shade: 'tex-shade',             // 128x128 solid white disc with a long smooth feather (tint dark to hide a spot)
  crawlerScorpion: 'tex-crawler-scorpion', // 256x256 fallback crawlers, front view, feet at ~88 %
  crawlerSpider: 'tex-crawler-spider',
  crawlerCrab: 'tex-crawler-crab',
  crawlerBeetle: 'tex-crawler-beetle',
  crawlerStalker: 'tex-crawler-stalker',
  crawlerDrifter: 'tex-crawler-drifter',
  crawlerWraith: 'tex-crawler-wraith',
} as const;

/** Fallback texture of each crawler kind (used when crawlers/<kind>.png is missing). */
export const CRAWLER_FALLBACK = {
  scorpion: TEX.crawlerScorpion,
  spider: TEX.crawlerSpider,
  crab: TEX.crawlerCrab,
  beetle: TEX.crawlerBeetle,
  stalker: TEX.crawlerStalker,
  drifter: TEX.crawlerDrifter,
  wraith: TEX.crawlerWraith,
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

// ------------------------------------------------------------------ boarding fallbacks

type CrawlerShape = keyof typeof CRAWLER_FALLBACK;

const SHELL = '#2b2722';
const SHELL_HI = 'rgba(190,170,140,0.55)';
const LEG = '#1c1a17';

function legPair(ctx: CanvasRenderingContext2D, x: number, y: number, reach: number, lift: number, drop: number, w: number): void {
  ctx.strokeStyle = LEG;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128 + dir * x, y);
    ctx.lineTo(128 + dir * (x + reach * 0.55), y - lift);
    ctx.lineTo(128 + dir * (x + reach), y + drop);
    ctx.stroke();
  }
}

function shell(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  const grad = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.5, 2, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0, '#5a5248');
  grad.addColorStop(0.5, SHELL);
  grad.addColorStop(1, '#0e0d0b');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = SHELL_HI;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
}

function eyes(ctx: CanvasRenderingContext2D, y: number, spread: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = 128 + (i - (n - 1) / 2) * spread;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
    g.addColorStop(0, 'rgba(255,120,90,1)');
    g.addColorStop(0.35, 'rgba(255,60,40,0.8)');
    g.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 7, y - 7, 14, 14);
  }
}

/** Code-drawn crawler, front view, dark chitin with red eye lights. Feet near y 226 of 256. */
function drawCrawler(ctx: CanvasRenderingContext2D, kind: CrawlerShape): void {
  switch (kind) {
    case 'spider':
      for (const [x, y, reach, lift, drop] of [[22, 150, 96, 70, 76], [26, 160, 90, 46, 66], [24, 170, 76, 22, 56], [18, 176, 58, 4, 50]]) {
        legPair(ctx, x, y, reach, lift, drop, 5);
      }
      shell(ctx, 128, 132, 40, 34);
      shell(ctx, 128, 172, 26, 20);
      eyes(ctx, 168, 10, 4);
      break;
    case 'crab':
      legPair(ctx, 52, 170, 60, 20, 56, 7);
      legPair(ctx, 44, 178, 56, 8, 48, 7);
      // Pincers raised.
      for (const dir of [-1, 1]) {
        ctx.strokeStyle = LEG; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(128 + dir * 60, 160); ctx.lineTo(128 + dir * 98, 120); ctx.stroke();
        shell(ctx, 128 + dir * 104, 104, 18, 24);
      }
      shell(ctx, 128, 160, 72, 38);
      eyes(ctx, 140, 22, 2);
      break;
    case 'beetle':
      legPair(ctx, 40, 176, 56, 16, 50, 7);
      legPair(ctx, 46, 190, 50, 6, 36, 7);
      shell(ctx, 128, 150, 62, 58);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(128, 96); ctx.lineTo(128, 206); ctx.stroke();
      shell(ctx, 128, 196, 30, 16);
      eyes(ctx, 198, 18, 2);
      break;
    case 'stalker':
      // Lean predator on all fours: long arms planted wide, hunched back, red seam down the head.
      legPair(ctx, 30, 140, 80, 50, 86, 7);
      legPair(ctx, 22, 186, 30, 6, 40, 9);
      shell(ctx, 128, 150, 34, 46);
      shell(ctx, 128, 104, 22, 30);
      ctx.strokeStyle = 'rgba(255,60,40,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(128, 76); ctx.lineTo(128, 170); ctx.stroke();
      break;
    case 'drifter': {
      // Hovering machine jellyfish: a ribbed dome with a red core and hanging tentacles.
      ctx.strokeStyle = LEG; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(128 + i * 12, 120);
        ctx.quadraticCurveTo(128 + i * 20, 170, 128 + i * 15 + (i % 2) * 8, 226);
        ctx.stroke();
      }
      shell(ctx, 128, 100, 62, 56);
      ctx.fillStyle = '#0e0d0b';
      ctx.fillRect(66, 100, 124, 26);
      const core = ctx.createRadialGradient(128, 84, 0, 128, 84, 24);
      core.addColorStop(0, 'rgba(255,90,70,1)');
      core.addColorStop(0.5, 'rgba(220,30,20,0.85)');
      core.addColorStop(1, 'rgba(120,0,0,0)');
      ctx.fillStyle = core;
      ctx.fillRect(100, 56, 56, 56);
      break;
    }
    case 'wraith': {
      // Tall headless spiked figure of black liquid on its own pool, red glow in the chest.
      ctx.fillStyle = '#060606';
      ctx.beginPath(); ctx.ellipse(128, 222, 92, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(96, 222); ctx.quadraticCurveTo(104, 120, 100, 70); ctx.lineTo(156, 70);
      ctx.quadraticCurveTo(152, 120, 160, 222); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      for (const dir of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(128 + dir * 26, 78); ctx.lineTo(128 + dir * 50, 130); ctx.lineTo(128 + dir * 48, 176); ctx.stroke();
      }
      ctx.lineWidth = 3;
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(128 + i * 5, 72); ctx.lineTo(128 + i * 11, 30 + Math.abs(i) * 4); ctx.stroke();
      }
      const chest = ctx.createRadialGradient(128, 110, 0, 128, 110, 20);
      chest.addColorStop(0, 'rgba(230,30,20,0.95)');
      chest.addColorStop(1, 'rgba(120,0,0,0)');
      ctx.fillStyle = chest;
      ctx.fillRect(104, 84, 48, 52);
      break;
    }
    case 'scorpion':
    default:
      legPair(ctx, 34, 178, 70, 24, 48, 6);
      legPair(ctx, 30, 188, 60, 10, 38, 6);
      // Tail arching over the body, sting forward.
      ctx.strokeStyle = SHELL; ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(128, 170); ctx.quadraticCurveTo(128, 40, 128, 70); ctx.stroke();
      ctx.fillStyle = '#8a2a20';
      ctx.beginPath(); ctx.moveTo(120, 64); ctx.lineTo(136, 64); ctx.lineTo(128, 96); ctx.closePath(); ctx.fill();
      for (const dir of [-1, 1]) {
        ctx.strokeStyle = LEG; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(128 + dir * 30, 186); ctx.lineTo(128 + dir * 74, 170); ctx.stroke();
        shell(ctx, 128 + dir * 84, 172, 16, 12);
      }
      shell(ctx, 128, 178, 44, 30);
      eyes(ctx, 184, 14, 3);
      break;
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

  if (!has(TEX.vignette)) fromCanvas(scene, TEX.vignette, 256, 256, (ctx) =>
    radial(ctx, 256, [[0, 'rgba(255,255,255,0)'], [0.45, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,0.55)'],
      [1, 'rgba(255,255,255,1)']]));

  if (!has(TEX.shade)) fromCanvas(scene, TEX.shade, 128, 128, (ctx) => {
    // Solid to 40 %, then a smoothstep falloff to 0 at the rim (many stops: no visible ring).
    const stops: Array<[number, string]> = [[0, 'rgba(255,255,255,1)']];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const a = 1 - u * u * (3 - 2 * u);
      stops.push([0.4 + 0.6 * u, `rgba(255,255,255,${a.toFixed(3)})`]);
    }
    radial(ctx, 128, stops);
  });

  for (const [kind, key] of Object.entries(CRAWLER_FALLBACK) as Array<[CrawlerShape, string]>) {
    if (!has(key)) fromCanvas(scene, key, 256, 256, (ctx) => drawCrawler(ctx, kind));
  }

  if (!has(TEX.enemy)) fromGraphics(scene, TEX.enemy, 64, 64, (g) => drawEnemy(g, 0x5a2430, COLORS.danger));
  if (!has(TEX.enemyAlt)) fromGraphics(scene, TEX.enemyAlt, 64, 64, (g) => drawEnemyAlt(g, 0x4a2a1a, COLORS.accent));
  if (!has(TEX.dome)) fromGraphics(scene, TEX.dome, 120, 64, (g) => drawDome(g, 0));
  if (!has(TEX.domeDamaged)) fromGraphics(scene, TEX.domeDamaged, 120, 64, (g) => drawDome(g, 1));
  if (!has(TEX.domeRuin)) fromGraphics(scene, TEX.domeRuin, 120, 64, (g) => drawDome(g, 2));
}
