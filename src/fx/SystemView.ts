import Phaser from 'phaser';
import { planetHold, underAttack } from '../core/galaxy';
import { masteryBand, planetMastery } from '../core/mastery';
import { stableHash } from '../core/names';
import type { CallKind } from '../core/story';
import type { ProgressHolder, SystemDef } from '../core/types';
import { capsStyle } from '../ui/TextStyles';
import { drawRing } from '../ui/glyphs';
import { drawCallBlip, drawStaticSigil, kindColor } from '../ui/mapGlyphs';
import { sunColors } from '../ui/mapPalette';
import { drawBrackets } from '../ui/Panel';
import { BAND_COLORS, COLORS, CSS, DEPTH, LETTER_SPACING, SIZES } from '../ui/theme';
import { hasImage, planetImageFor } from './assets';
import { ORBIT_TILT, SUN_X, SUN_Y, VIEW_W, inFront, orbitRadius, orbitSpeed, orbitX, orbitY, planetSize } from './mapLayout';
import { TEX } from './textures';

/** Gap between a planet's rim and its name; the label sits up and to the side on a hairline. */
const LABEL_GAP = 18;
const LABEL_RISE = 12;
/** How often the label sides are re-chosen (ms). */
const LABEL_EVERY_MS = 200;
const MAX_PLANETS = 6;
const RIGHT_FIRST = [1, -1] as const;
const LEFT_FIRST = [-1, 1] as const;
/** Sun layers: halo, glow, core, white centre (display px) and their alphas. */
const SUN_SIZES = [460, 170, 64, 26] as const;
const SUN_ALPHAS = [0.16, 0.5, 0.9, 1] as const;

interface PlanetSprite {
  id: string;
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  size: number;
  rx: number;
  speed: number;
  angle: number;
  front: boolean;
  mastery: number;
  hostile: boolean;
  attack: boolean;
  /** Label side: 1 right, -1 left; label alpha (0 when it has no room). */
  side: number;
  labelAlpha: number;
}

/**
 * The system view: a sun glow with its planets on tilted orbit ellipses. Everything lives in
 * one container centred on the sun (scale it for the settle-in and zoom-out feedback). Planets
 * move slowly; a planet on the far half of its orbit is drawn behind the sun. Each planet has
 * a mastery ring, its name on a hairline, the Static's sigil while hostile and a pulse while
 * under attack; planets with a pending call blink.
 */
export class SystemView {
  readonly root: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private orbits!: Phaser.GameObjects.Graphics;
  private sunParts: Phaser.GameObjects.Image[] = [];
  private deco!: Phaser.GameObjects.Graphics;
  private planets: PlanetSprite[] = [];
  private calls: Array<{ planetId: string; kind: CallKind }> = [];
  private focusId: string | null = null;
  private labelClock = 0;
  private system: SystemDef | null = null;
  /** Label rectangles kept while choosing sides (preallocated). */
  private readonly rx0 = new Float32Array(MAX_PLANETS);
  private readonly ry0 = new Float32Array(MAX_PLANETS);
  private readonly rx1 = new Float32Array(MAX_PLANETS);
  private readonly ry1 = new Float32Array(MAX_PLANETS);

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.root = scene.add.container(SUN_X, SUN_Y).setDepth(DEPTH.world + 1);
  }

  get systemId(): string | null {
    return this.system?.id ?? null;
  }

  /** Builds the view for a system (replaces the previous one). */
  show(system: SystemDef, save: ProgressHolder, now: number): void {
    const scene = this.scene;
    this.root.removeAll(true);
    this.system = system;
    this.calls = [];
    this.focusId = null;
    this.labelClock = 0;

    this.orbits = scene.add.graphics();
    this.root.add(this.orbits);
    const count = system.planets.length;
    this.orbits.lineStyle(1, COLORS.text, 0.13);
    for (let i = 0; i < count; i++) {
      const rx = orbitRadius(i, count);
      this.orbits.strokeEllipse(0, 0, rx * 2, rx * 2 * ORBIT_TILT);
    }

    const { glow, core } = sunColors(system.sunHue);
    const tints = [glow, glow, core, COLORS.white];
    this.sunParts = SUN_SIZES.map((size, i) => scene.add.image(0, 0, TEX.glow).setTint(tints[i])
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(SUN_ALPHAS[i]).setScale(size / 128));

    this.planets = system.planets.slice(0, MAX_PLANETS).map((p, i): PlanetSprite => {
      const rx = orbitRadius(i, count);
      const size = planetSize(stableHash(p.id));
      const key = planetImageFor(p.id);
      const x = orbitX(rx, p.angle);
      const y = orbitY(rx, p.angle);
      const img = hasImage(scene, key)
        ? scene.add.image(x, y, key).setDisplaySize(size, size)
        : scene.add.image(x, y, TEX.planetSmall).setDisplaySize(size, size).setTint(COLORS.textDim);
      const label = scene.add.text(0, 0, p.name.toUpperCase(), capsStyle({
        fontSize: `${SIZES.small}px`, color: CSS.text, letterSpacing: LETTER_SPACING.caps,
      })).setOrigin(0, 1).setAlpha(0);
      return {
        id: p.id, img, label, size, rx, speed: orbitSpeed(rx), angle: p.angle, front: inFront(p.angle),
        mastery: 0, hostile: false, attack: false, side: 1, labelAlpha: 0,
      };
    });
    // Draw order: orbits, far planets, sun, near planets, decorations and labels.
    for (const p of this.planets) if (!p.front) this.root.add(p.img);
    this.root.add(this.sunParts);
    for (const p of this.planets) if (p.front) this.root.add(p.img);
    this.deco = scene.add.graphics();
    this.root.add(this.deco);
    for (const p of this.planets) this.root.add(p.label);

    this.refresh(save, now);
    this.chooseLabelSides();
  }

  /** Re-reads mastery, hold and attack state of the planets. */
  refresh(save: ProgressHolder, now: number): void {
    for (const p of this.planets) {
      p.mastery = planetMastery(p.id, save);
      p.hostile = planetHold(p.id, save) === 'hostile';
      p.attack = underAttack(p.id, save, now);
    }
  }

  /** Planets that carry a pending call (they blink). */
  setCalls(calls: ReadonlyArray<{ planetId: string; kind: CallKind }>): void {
    this.calls = calls.map((c) => ({ planetId: c.planetId, kind: c.kind }));
  }

  /** The planet whose card is open (amber brackets), or null. */
  setFocus(planetId: string | null): void {
    this.focusId = planetId;
  }

  hasPlanet(planetId: string): boolean {
    return this.planets.some((p) => p.id === planetId);
  }

  /** Screen position and radius (planet plus label reach) of a planet; false if it is not in this system. */
  planetScreen(planetId: string, out: { x: number; y: number; r: number }): boolean {
    const p = this.planets.find((q) => q.id === planetId);
    if (!p) return false;
    const s = this.root.scale;
    out.x = this.root.x + p.img.x * s;
    out.y = this.root.y + p.img.y * s;
    out.r = (p.size / 2 + 26) * s;
    return true;
  }

  /** Id of the planet under a screen point (its disc plus a small margin), front planets first. */
  planetAt(sx: number, sy: number): string | null {
    const s = this.root.scale;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const p of this.planets) {
      const dx = (sx - this.root.x) / s - p.img.x;
      const dy = (sy - this.root.y) / s - p.img.y;
      const r = p.size / 2 + 10;
      const d = dx * dx + dy * dy;
      // A near planet covers a far one, so it wins whenever both are hit.
      const score = d + (p.front ? 0 : 1e6);
      if (d <= r * r && score < bestScore) {
        bestScore = score;
        best = p.id;
      }
    }
    return best;
  }

  update(time: number, dtMs: number): void {
    if (!this.system || !this.root.visible) return;
    const dt = Math.min(dtMs, 100) / 1000;
    const breathe = 1 + Math.sin(time / 1900) * 0.03;
    for (let i = 0; i < this.sunParts.length; i++) {
      this.sunParts[i].setScale((SUN_SIZES[i] / 128) * (i < 2 ? breathe : 1));
    }
    for (const p of this.planets) {
      p.angle = (p.angle + p.speed * dt) % (Math.PI * 2);
      p.img.setPosition(orbitX(p.rx, p.angle), orbitY(p.rx, p.angle));
      const front = inFront(p.angle);
      if (front !== p.front) {
        p.front = front;
        if (front) this.root.moveAbove(p.img, this.sunParts[this.sunParts.length - 1]);
        else this.root.moveBelow(p.img, this.sunParts[0]);
      }
    }
    this.labelClock -= dtMs;
    if (this.labelClock <= 0) {
      this.labelClock = LABEL_EVERY_MS;
      this.chooseLabelSides();
    }
    this.drawDecorations(time, dtMs);
  }

  /** Puts each label right of its planet, or left when that side is off screen or taken; hides it when neither fits. */
  private chooseLabelSides(): void {
    const s = this.root.scale;
    const right = (VIEW_W - 12 - this.root.x) / s;
    const left = (12 - this.root.x) / s;
    let kept = 0;
    // Inner planets first: they sit closest to the sun and are the hardest to place.
    for (const p of this.planets) {
      const w = p.label.width;
      const h = p.label.height;
      const y1 = p.img.y - p.size / 2 - LABEL_RISE + 4;
      const y0 = y1 - h;
      let placed = 0;
      for (const side of p.side === 1 ? RIGHT_FIRST : LEFT_FIRST) {
        const x0 = side === 1 ? p.img.x + p.size / 2 + LABEL_GAP : p.img.x - p.size / 2 - LABEL_GAP - w;
        const x1 = x0 + w;
        if (x0 < left || x1 > right) continue;
        let free = !(x0 < 30 && x1 > -30 && y0 < 30 && y1 > -30);   // keep the sun's core clear
        for (let k = 0; k < kept && free; k++) {
          if (x0 < this.rx1[k] + 4 && this.rx0[k] < x1 + 4 && y0 < this.ry1[k] + 2 && this.ry0[k] < y1 + 2) free = false;
        }
        if (free) {
          p.side = side;
          placed = 1;
          this.rx0[kept] = x0; this.ry0[kept] = y0; this.rx1[kept] = x1; this.ry1[kept] = y1;
          kept++;
          break;
        }
      }
      p.labelAlpha = placed;
    }
  }

  private drawDecorations(time: number, dtMs: number): void {
    const g = this.deco;
    g.clear();
    const pulse = (time % 1400) / 1400;
    const blink = Math.sin(time / 170) > -0.2 ? 1 : 0.25;
    const fade = Math.min(1, dtMs * 0.01);
    for (const p of this.planets) {
      const x = p.img.x;
      const y = p.img.y;
      const r = p.size / 2;
      drawRing(g, x, y, r + 4, p.mastery, BAND_COLORS[masteryBand(p.mastery)], 1.5);
      if (p.hostile) drawStaticSigil(g, x - r - 4, y - r - 2, 11, COLORS.danger, 0.95);
      if (p.attack) {
        g.lineStyle(1.2, COLORS.danger, 0.85 * (1 - pulse));
        g.strokeCircle(x, y, r + 5 + 16 * pulse);
      }
      if (p.id === this.focusId) drawBrackets(g, x - r - 9, y - r - 9, p.size + 18, p.size + 18, COLORS.primary, 0.9, 6);
      for (const c of this.calls) {
        if (c.planetId === p.id) drawCallBlip(g, x, y + r + 14, 11, kindColor(c.kind), blink);
      }
      // Name on a hairline: from the rim up to the label, then under it.
      const label = p.label;
      const a = label.alpha + ((p.labelAlpha * 0.8) - label.alpha) * fade;
      const ly = y - r - LABEL_RISE;
      const lx = p.side === 1 ? x + r + LABEL_GAP : x - r - LABEL_GAP;
      label.setOrigin(p.side === 1 ? 0 : 1, 1).setPosition(Math.round(lx), Math.round(ly)).setAlpha(a);
      if (a > 0.02) {
        g.lineStyle(1, COLORS.text, 0.35 * a);
        g.lineBetween(x + p.side * r * 0.72, y - r * 0.72, lx - p.side * 4, ly + 3);
        g.lineBetween(lx - p.side * 4, ly + 3, lx + p.side * label.width, ly + 3);
      }
    }
  }
}
