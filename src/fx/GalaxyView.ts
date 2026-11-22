import Phaser from 'phaser';
import { SECTORS, SYSTEMS } from '../core/content';
import { planetHold, sectorMastery, underAttack } from '../core/galaxy';
import type { ProgressHolder } from '../core/types';
import { capsStyle } from '../ui/TextStyles';
import { cssColor, sectorColors, sunColors } from '../ui/mapPalette';
import { drawChevron } from '../ui/mapGlyphs';
import { COLORS, CSS, DEPTH, LETTER_SPACING, SIZES } from '../ui/theme';
import { IMG, hasImage } from './assets';
import {
  VIEW_H, VIEW_W, clamp, discBounds, fitView, nearestPoint, resolveLabels, sectorLabelOffset,
  worldToScreenX, worldToScreenY,
} from './mapLayout';
import type { MapView, Rect } from './mapLayout';
import { bakeSectorCloud } from './SectorClouds';
import type { BakedCloud } from './SectorClouds';
import { TEX } from './textures';

/** Screen margin around the whole galaxy at the opening zoom. */
const FIT_MARGIN = 40;
/** Zoom range relative to the fit zoom. */
const MIN_ZOOM_K = 0.85;
const MAX_ZOOM = 1.6;
/** System names fade in between these zooms (screen px per world unit). */
const SYS_LABEL_FROM = 0.5;
const SYS_LABEL_FULL = 0.62;
/** Click radius around a star, screen px. */
const HIT_RADIUS = 18;
const SHIP_SIZE = 22;
const SECTOR_LABEL_ALPHA = 0.42;
const SYSTEM_LABEL_ALPHA = 0.7;
/** Re-run label collision when the zoom changed by more than this ratio. */
const RELAYOUT_ZOOM = 0.03;

/**
 * The galaxy view: baked sector clouds, star points, territory rings, sector and system names
 * and the player's ship, all drawn in screen space from a `MapView` (no Phaser camera zoom, so
 * lines and text stay crisp at every zoom). Everything is created once; `update` only moves,
 * fades and redraws one Graphics, and allocates nothing.
 */
export class GalaxyView {
  readonly root: Phaser.GameObjects.Container;
  /** The current camera; mutate it and call `markDirty()`, or use `setView`. */
  readonly view: MapView;
  readonly bounds: Rect;
  readonly fit: MapView;
  readonly minZoom: number;
  readonly maxZoom = MAX_ZOOM;

  private readonly clouds: Array<{ img: Phaser.GameObjects.Image; baked: BakedCloud; w: number; h: number }> = [];
  private readonly glows: Phaser.GameObjects.Image[] = [];
  private readonly cores: Phaser.GameObjects.Image[] = [];
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly ship: Phaser.GameObjects.Image | null;
  private readonly shipScale: number;

  /** System data, galaxy order. */
  private readonly n = SYSTEMS.length;
  private readonly sysX = new Float32Array(SYSTEMS.length);
  private readonly sysY = new Float32Array(SYSTEMS.length);
  private readonly scrX = new Float32Array(SYSTEMS.length);
  private readonly scrY = new Float32Array(SYSTEMS.length);
  private readonly hostile = new Uint8Array(SYSTEMS.length);
  private readonly attack = new Uint8Array(SYSTEMS.length);
  private readonly indexById = new Map<string, number>();

  /** Labels: sector names first (index < SECTORS.length), then system names. */
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private readonly labelWX: Float32Array;
  private readonly labelWY: Float32Array;
  private readonly lx: Float32Array;
  private readonly ly: Float32Array;
  private readonly lw: Float32Array;
  private readonly lh: Float32Array;
  private readonly lActive: Uint8Array;
  private readonly lKeep: Uint8Array;
  private readonly lAlpha: Float32Array;
  private readonly lBase: Float32Array;
  private readonly sectorOfSystem = new Int32Array(SYSTEMS.length);
  private readonly lOrder: Int32Array;
  private lastLabelZoom = -1;

  private dirty = true;
  private hover = -1;
  private current = 0;
  private starScale = 1;
  /** Ship position in the world and its heading (radians, 0 = nose up). */
  shipX = 0;
  shipY = 0;
  shipHeading = 0;
  /** 0 = ship parked just above its star, 1 = ship on its exact world position (in flight). */
  shipFlight = 0;

  constructor(scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(DEPTH.world);
    this.bounds = discBounds(SECTORS);
    this.fit = fitView(this.bounds, FIT_MARGIN);
    this.minZoom = this.fit.zoom * MIN_ZOOM_K;
    this.view = { ...this.fit };

    for (const sector of SECTORS) {
      const baked = bakeSectorCloud(scene, sector);
      const img = scene.add.image(0, 0, baked.key).setOrigin(0, 0);
      this.clouds.push({ img, baked, w: img.width, h: img.height });
      this.root.add(img);
    }

    SYSTEMS.forEach((s, i) => {
      this.sysX[i] = s.x;
      this.sysY[i] = s.y;
      this.indexById.set(s.id, i);
      this.sectorOfSystem[i] = SECTORS.findIndex((sector) => sector.id === s.sectorId);
      const { glow, core } = sunColors(s.sunHue);
      const g = scene.add.image(0, 0, TEX.glow).setTint(glow).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.75);
      const c = scene.add.image(0, 0, TEX.glow).setTint(core).setBlendMode(Phaser.BlendModes.ADD);
      this.glows.push(g);
      this.cores.push(c);
      this.root.add([g, c]);
    });

    this.marks = scene.add.graphics();
    this.root.add(this.marks);

    // Labels.
    const total = SECTORS.length + SYSTEMS.length;
    this.labelWX = new Float32Array(total);
    this.labelWY = new Float32Array(total);
    this.lx = new Float32Array(total);
    this.ly = new Float32Array(total);
    this.lw = new Float32Array(total);
    this.lh = new Float32Array(total);
    this.lActive = new Uint8Array(total);
    this.lKeep = new Uint8Array(total);
    this.lAlpha = new Float32Array(total);
    this.lBase = new Float32Array(total).fill(SECTOR_LABEL_ALPHA);
    this.lOrder = new Int32Array(total);
    SECTORS.forEach((sector, i) => {
      const text = scene.add.text(0, 0, '', capsStyle({
        fontSize: `${SIZES.small + 1}px`, color: cssColor(sectorColors(sector.hue).label),
        letterSpacing: LETTER_SPACING.caps + 1,
      })).setOrigin(0.5).setAlpha(0);
      this.labels.push(text);
      this.root.add(text);
      this.labelWX[i] = sector.x;
      this.labelWY[i] = sector.y;
    });
    SYSTEMS.forEach((s, j) => {
      const i = SECTORS.length + j;
      const text = scene.add.text(0, 0, s.name.toUpperCase(), capsStyle({
        fontSize: `${SIZES.small}px`, color: CSS.textDim, letterSpacing: LETTER_SPACING.caps,
      })).setOrigin(0.5, 0).setAlpha(0);
      this.labels.push(text);
      this.root.add(text);
      this.labelWX[i] = s.x;
      this.labelWY[i] = s.y;
    });

    if (hasImage(scene, IMG.ships.player)) {
      this.ship = scene.add.image(0, 0, IMG.ships.player);
      this.shipScale = SHIP_SIZE / Math.max(this.ship.width, this.ship.height);
      this.ship.setScale(this.shipScale);
      this.root.add(this.ship);
    } else {
      this.ship = null;
      this.shipScale = 1;
    }
  }

  /** Sets the sector names (call again after a language change) and places them off the stars. */
  setSectorNames(nameOf: (nameKey: string) => string): void {
    SECTORS.forEach((sector, i) => {
      const text = this.labels[i].setText(nameOf(sector.nameKey).toUpperCase());
      const w = text.width / this.fit.zoom;
      const h = text.height / this.fit.zoom;
      this.labelWY[i] = sector.y + sectorLabelOffset(sector.x, sector.y, sector.radius, w, h, sector.systems, 14 / this.fit.zoom);
    });
    this.lastLabelZoom = -1;
    this.dirty = true;
  }

  /** Territory: rings for hostile and attacked systems, cloud brightness from sector mastery. */
  refreshTerritory(save: ProgressHolder, now: number): void {
    SYSTEMS.forEach((s, i) => {
      this.hostile[i] = s.planets.some((p) => planetHold(p.id, save) === 'hostile') ? 1 : 0;
      this.attack[i] = s.planets.some((p) => underAttack(p.id, save, now)) ? 1 : 0;
    });
    SECTORS.forEach((sector, i) => {
      const m = sectorMastery(sector.id, save);
      this.clouds[i].img.setAlpha(0.42 + 0.58 * m);
      this.lBase[i] = SECTOR_LABEL_ALPHA + 0.35 * m;
    });
  }

  /** The player's system: its ship marker and label priority. */
  setLocation(systemId: string): void {
    const i = this.indexById.get(systemId) ?? 0;
    this.current = i;
    this.shipX = this.sysX[i];
    this.shipY = this.sysY[i];
    this.shipHeading = 0;
    this.shipFlight = 0;
    this.lastLabelZoom = -1;
    this.dirty = true;
  }

  systemIndex(systemId: string): number {
    return this.indexById.get(systemId) ?? -1;
  }

  systemX(i: number): number { return this.sysX[i]; }
  systemY(i: number): number { return this.sysY[i]; }

  setView(cx: number, cy: number, zoom: number): void {
    this.view.cx = cx;
    this.view.cy = cy;
    this.view.zoom = zoom;
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  setHover(index: number): void {
    if (index === this.hover) return;
    this.hover = index;
    this.lastLabelZoom = -1;
  }

  /** Index of the star under the screen point, or -1. Valid after the last `update`. */
  hitSystem(sx: number, sy: number): number {
    return nearestPoint(this.scrX, this.scrY, this.n, sx, sy, HIT_RADIUS);
  }

  update(time: number, dtMs: number): void {
    if (!this.root.visible) return;
    const v = this.view;
    if (this.dirty) {
      this.dirty = false;
      this.layout();
    }
    if (Math.abs(v.zoom / this.lastLabelZoom - 1) > RELAYOUT_ZOOM || this.lastLabelZoom < 0) this.layoutLabels();
    this.placeLabels(dtMs);
    this.placeShip(time);
    this.drawMarks(time);
  }

  private layout(): void {
    const v = this.view;
    const z = v.zoom;
    for (const c of this.clouds) {
      const x = worldToScreenX(v, c.baked.x0);
      const y = worldToScreenY(v, c.baked.y0);
      const s = c.baked.cell * z;
      const visible = x < VIEW_W && y < VIEW_H && x + c.w * s > 0 && y + c.h * s > 0;
      c.img.setVisible(visible);
      if (visible) c.img.setPosition(x, y).setScale(s);
    }
    this.starScale = clamp(Math.sqrt(z / this.fit.zoom), 1, 2.4);
    const glowScale = (13 * this.starScale) / 128;
    const coreScale = (4 * this.starScale) / 128;
    for (let i = 0; i < this.n; i++) {
      const x = worldToScreenX(v, this.sysX[i]);
      const y = worldToScreenY(v, this.sysY[i]);
      this.scrX[i] = x;
      this.scrY[i] = y;
      const visible = x > -20 && x < VIEW_W + 20 && y > -20 && y < VIEW_H + 20;
      this.glows[i].setVisible(visible);
      this.cores[i].setVisible(visible);
      if (visible) {
        this.glows[i].setPosition(x, y).setScale(glowScale);
        this.cores[i].setPosition(x, y).setScale(coreScale);
      }
    }
  }

  /** Collision of every label at the current zoom (positions relative to the view centre). */
  private layoutLabels(): void {
    const v = this.view;
    const z = v.zoom;
    this.lastLabelZoom = z;
    const sectors = SECTORS.length;
    const sysVisible = z >= SYS_LABEL_FROM;
    const total = this.labels.length;
    let k = 0;
    // Priority: the player's sector, the other sectors, the hovered system, the player's system, the rest.
    const currentSector = this.sectorOfSystem[this.current];
    if (currentSector >= 0) this.lOrder[k++] = currentSector;
    for (let i = 0; i < sectors; i++) if (i !== currentSector) this.lOrder[k++] = i;
    if (this.hover >= 0) this.lOrder[k++] = sectors + this.hover;
    if (this.current !== this.hover) this.lOrder[k++] = sectors + this.current;
    for (let j = 0; j < this.n; j++) if (j !== this.hover && j !== this.current) this.lOrder[k++] = sectors + j;
    for (let i = 0; i < total; i++) {
      const t = this.labels[i];
      const sx = worldToScreenX(v, this.labelWX[i]);
      const sy = worldToScreenY(v, this.labelWY[i]);
      this.lw[i] = t.width;
      this.lh[i] = t.height;
      if (i < sectors) {
        this.lx[i] = sx - t.width / 2;
        this.ly[i] = sy - t.height / 2;
        this.lActive[i] = 1;
      } else {
        this.lx[i] = sx - t.width / 2;
        this.ly[i] = sy + 9 * this.starScale;
        this.lActive[i] = sysVisible || i - sectors === this.hover ? 1 : 0;
      }
    }
    resolveLabels(this.lx, this.ly, this.lw, this.lh, this.lActive, this.lOrder, total, this.lKeep, 3);
  }

  private placeLabels(dtMs: number): void {
    const v = this.view;
    const z = v.zoom;
    const sectors = SECTORS.length;
    const sysFade = clamp((z - SYS_LABEL_FROM) / (SYS_LABEL_FULL - SYS_LABEL_FROM), 0, 1);
    const k = Math.min(1, dtMs * 0.008);
    for (let i = 0; i < this.labels.length; i++) {
      const t = this.labels[i];
      const isSector = i < sectors;
      const base = isSector ? this.lBase[i] : SYSTEM_LABEL_ALPHA;
      const hovered = !isSector && i - sectors === this.hover;
      const target = this.lKeep[i] ? base * (isSector || hovered ? 1 : sysFade) : 0;
      this.lAlpha[i] += (target - this.lAlpha[i]) * k;
      const sx = worldToScreenX(v, this.labelWX[i]);
      const sy = isSector ? worldToScreenY(v, this.labelWY[i]) : worldToScreenY(v, this.labelWY[i]) + 9 * this.starScale;
      const onScreen = sx + t.width / 2 > 0 && sx - t.width / 2 < VIEW_W && sy + t.height > 0 && sy - t.height < VIEW_H;
      const visible = onScreen && this.lAlpha[i] > 0.01;
      t.setVisible(visible);
      if (visible) t.setPosition(Math.round(sx), Math.round(sy)).setAlpha(hovered ? 1 : this.lAlpha[i]);
    }
  }

  private placeShip(time: number): void {
    const v = this.view;
    const park = 1 - this.shipFlight;
    const bob = Math.sin(time / 650) * 1.6 * park;
    const x = worldToScreenX(v, this.shipX);
    const y = worldToScreenY(v, this.shipY) - (11 + 5 * this.starScale) * park + bob;
    if (this.ship) this.ship.setPosition(x, y).setRotation(this.shipHeading);
  }

  private drawMarks(time: number): void {
    const g = this.marks;
    g.clear();
    const s = this.starScale;
    const pulse = (time % 1600) / 1600;
    for (let i = 0; i < this.n; i++) {
      const x = this.scrX[i];
      const y = this.scrY[i];
      if (x < -30 || x > VIEW_W + 30 || y < -30 || y > VIEW_H + 30) continue;
      if (this.hostile[i]) {
        g.lineStyle(1, COLORS.danger, 0.38);
        g.strokeCircle(x, y, 4 * s + 2);
      }
      if (this.attack[i]) {
        g.lineStyle(1, COLORS.danger, 0.8 * (1 - pulse));
        g.strokeCircle(x, y, 5 * s + 3 + 12 * pulse);
      }
    }
    // The player's system: a faint amber ring.
    const cx = this.scrX[this.current];
    const cy = this.scrY[this.current];
    g.lineStyle(1, COLORS.primary, 0.45);
    g.strokeCircle(cx, cy, 5 * s + 6);
    if (this.hover >= 0) {
      const hx = this.scrX[this.hover];
      const hy = this.scrY[this.hover];
      const r = 5 * s + 8;
      g.lineStyle(1, COLORS.primary, 0.9);
      for (let q = 0; q < 4; q++) {
        const a = q * Math.PI / 2 + Math.PI / 4;
        g.beginPath();
        g.arc(hx, hy, r, a - 0.35, a + 0.35, false);
        g.strokePath();
      }
      if (this.hover !== this.current && this.shipFlight === 0) {
        g.lineStyle(1, COLORS.primary, 0.28);
        g.lineBetween(cx, cy, hx, hy);
      }
    }
    if (!this.ship) {
      const v = this.view;
      const park = 1 - this.shipFlight;
      drawChevron(g, worldToScreenX(v, this.shipX), worldToScreenY(v, this.shipY) - 16 * park, 12,
        this.shipHeading - Math.PI / 2, COLORS.primary, 1);
    }
  }
}
