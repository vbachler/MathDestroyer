import Phaser from 'phaser';
import { app } from '../app';
import { SECTORS, SKILLS, sectorById, sectorsOfSkill } from '../core/content';
import {
  categoryStatId, formatProblem, formatSolved, sectorCategories, sectorFacts, sectorKind, sectorStatIds,
} from '../core/facts';
import { galaxyKnowledge, isMastered, masteryBand, sectorKnowledge } from '../core/mastery';
import type { Fact, FactStats, SectorDef, SkillId } from '../core/types';
import { Button } from '../ui/Button';
import { capsStyle, labelStyle, numeralStyle } from '../ui/TextStyles';
import { percentText, secondsText } from '../ui/format';
import { drawBar } from '../ui/glyphs';
import { addHitZone } from '../ui/hitZone';
import { cssColor, sectorColors } from '../ui/mapPalette';
import { cellWidth, paginate, relativeDue } from '../ui/reportLayout';
import { BAND_COLORS, BOX_COLORS, COLORS, CSS, DEPTH, GAME_WIDTH, LETTER_SPACING, SIZES, SPACING } from '../ui/theme';

export interface MasterySceneData { from?: 'Menu' | 'StarMap'; }

/** One selectable cell of the report: a fact of an enumerated sector, or a category of a
 *  generated one. Both are keyed by their stat id in `SaveData.stats`. */
type Item =
  | { kind: 'fact'; statId: string; fact: Fact }
  | { kind: 'category'; statId: string; category: string };

/** One line of the report; a sector header starts each block. */
type Line =
  | { kind: 'sector'; sector: SectorDef; mastery: number; mastered: number; total: number }
  | { kind: 'cells'; facts: Fact[] }
  | { kind: 'columns' }
  | { kind: 'table'; label: string; facts: Fact[] }
  | { kind: 'categories'; sectorId: string; categories: string[] }
  | { kind: 'note'; text: string };

interface CellRect { item: Item; x: number; y: number; w: number; h: number; }

const LEFT = SPACING.l;
const AREA_W = GAME_WIDTH - 2 * SPACING.l;
const AREA_TOP = 98;
const AREA_H = 512;
const LINE_H: Record<Line['kind'], number> = { sector: 32, cells: 25, columns: 18, table: 25, categories: 52, note: 26 };
const CELL_H = 20;
const CELL_GAP = 3;
/** Fact cells per row of an enumerated sector. */
const ROW_CELLS = 10;
const TABLE_LABEL_W = 120;
/** Category cell of a generated sector. */
const CAT_W = 260;
const CAT_H = 44;
const CAT_GAP = 12;
const TAB_Y = 64;
const DETAIL_Y = 636;
const LEGEND_Y = 682;
const WHEEL_COOLDOWN_MS = 220;
const GRID_SKILLS: readonly SkillId[] = ['multiplication', 'division'];

/**
 * Parent report of real knowledge from `stats`: a tab per skill; inside, a block per sector
 * (name, knowledge bar, mastered / total). Enumerated sectors show their facts as small cells
 * coloured by Leitner box, the box number inside (an empty outline for never seen), in rows of
 * ten; multiplication and division show table grids. Generated sectors show one larger cell per
 * category with its box, attempts, accuracy and average time. Selecting a cell shows one detail
 * line. Pages with the wheel or ‹ ›.
 */
export class MasteryScene extends Phaser.Scene {
  private from: 'Menu' | 'StarMap' = 'Menu';
  private skill: SkillId = 'typing';
  private lines: Line[] = [];
  private pages: number[][] = [];
  private page = 0;
  private cells: CellRect[] = [];
  private selected: Item | null = null;
  private now = 0;
  private lastWheel = 0;
  private cellW = 60;
  private tabs!: Phaser.GameObjects.Container;
  private grid!: Phaser.GameObjects.Container;
  private selection!: Phaser.GameObjects.Graphics;
  private detail!: Phaser.GameObjects.Text;
  private pageText!: Phaser.GameObjects.Text;
  private prevBtn!: Button;
  private nextBtn!: Button;

  constructor() {
    super('Mastery');
  }

  init(data: MasterySceneData): void {
    this.from = data?.from ?? 'Menu';
  }

  create(): void {
    const { t } = app.i18n;
    this.now = app.now();
    this.selected = null;
    this.page = 0;
    this.lastWheel = 0;
    this.cells = [];
    this.skill = sectorById(app.save.location.sectorId)?.skill ?? 'typing';

    this.add.text(LEFT, 28, t('common.menu.mastery').toUpperCase(), capsStyle({ fontSize: `${SIZES.label}px`, color: CSS.text }))
      .setOrigin(0, 0.5);
    new Button(this, GAME_WIDTH - SPACING.l - 50, 28, t('common.back'), () => this.scene.start(this.from),
      { width: 100, height: 30, variant: 'ghost', fontSize: SIZES.small + 1 });

    this.tabs = this.add.container(0, 0);
    this.grid = this.add.container(0, 0).setDepth(DEPTH.world);
    this.selection = this.add.graphics().setDepth(DEPTH.world + 1);
    this.add.zone(LEFT, AREA_TOP, AREA_W, AREA_H).setOrigin(0).setInteractive()
      .on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => this.pickCell(pointer.x, pointer.y));

    const hairline = this.add.graphics();
    hairline.lineStyle(1, COLORS.primary, 0.2);
    hairline.lineBetween(LEFT, DETAIL_Y - 18.5, GAME_WIDTH - SPACING.l, DETAIL_Y - 18.5);
    this.detail = this.add.text(LEFT, DETAIL_Y, '', numeralStyle({ fontSize: `${SIZES.label}px`, color: CSS.text }))
      .setOrigin(0, 0.5);

    const pagerRight = GAME_WIDTH - SPACING.l;
    this.nextBtn = new Button(this, pagerRight - 16, LEGEND_Y, t('common.pageNext'), () => this.goToPage(this.page + 1),
      { width: 32, height: 26, fontSize: SIZES.body });
    this.prevBtn = new Button(this, pagerRight - 112, LEGEND_Y, t('common.pagePrev'), () => this.goToPage(this.page - 1),
      { width: 32, height: 26, fontSize: SIZES.body });
    this.pageText = this.add.text(pagerRight - 64, LEGEND_Y, '', numeralStyle({ fontSize: `${SIZES.small + 1}px`, color: CSS.textDim }))
      .setOrigin(0.5);
    this.drawLegend();

    const onWheel = (_p: Phaser.Input.Pointer, _over: Phaser.GameObjects.GameObject[], _dx: number, dy: number): void => {
      if (dy === 0 || this.time.now - this.lastWheel < WHEEL_COOLDOWN_MS) return;
      this.lastWheel = this.time.now;
      this.goToPage(this.page + (dy > 0 ? 1 : -1));
    };
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, onWheel);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.off(Phaser.Input.Events.POINTER_WHEEL, onWheel));

    this.showSkill(this.skill);
  }

  // ------------------------------------------------------------------ tabs, lines, pages

  private showSkill(skill: SkillId): void {
    this.skill = skill;
    this.selected = null;
    this.page = 0;
    this.lines = this.buildLines(skill);
    this.pages = paginate(this.lines.map((l) => LINE_H[l.kind]), this.lines.map((l) => l.kind === 'sector'), AREA_H);
    this.drawTabs();
    this.drawPage();
    this.drawDetail();
  }

  private drawTabs(): void {
    const { t } = app.i18n;
    this.tabs.removeAll(true);
    const w = AREA_W / SKILLS.length;
    const g = this.add.graphics();
    this.tabs.add(g);
    g.lineStyle(1, COLORS.textDim, 0.25);
    g.lineBetween(LEFT, TAB_Y + 13.5, LEFT + AREA_W, TAB_Y + 13.5);
    SKILLS.forEach((skill, i) => {
      const cx = LEFT + w * i + w / 2;
      const active = skill === this.skill;
      const text = this.add.text(cx, TAB_Y, t(`meta.mastery.tab.${skill}`).toUpperCase(), capsStyle({
        fontSize: `${SIZES.small + 1}px`, color: active ? CSS.primary : CSS.textDim, letterSpacing: LETTER_SPACING.caps,
      })).setOrigin(0.5);
      if (text.width > w - 8) text.setScale((w - 8) / text.width);
      this.tabs.add(text);
      if (active) {
        g.lineStyle(2, COLORS.primary, 1);
        g.lineBetween(cx - text.displayWidth / 2, TAB_Y + 13, cx + text.displayWidth / 2, TAB_Y + 13);
      }
      const zone = addHitZone(this, cx, TAB_Y, w, 30, () => {
        if (skill !== this.skill) this.showSkill(skill);
      });
      zone.on(Phaser.Input.Events.POINTER_OVER, () => { if (skill !== this.skill) text.setColor(CSS.text); });
      zone.on(Phaser.Input.Events.POINTER_OUT, () => { if (skill !== this.skill) text.setColor(CSS.textDim); });
      this.tabs.add(zone);
    });
  }

  private buildLines(skill: SkillId): Line[] {
    const { t } = app.i18n;
    const stats = app.save.stats;
    const locale = app.i18n.locale;
    const lines: Line[] = [];
    const sectors = sectorsOfSkill(skill);
    // The core has no problems of its own; its block reports every sector of the galaxy.
    const header = (sector: SectorDef): Line => {
      const ids = sector.skill === 'mixed' ? SECTORS.flatMap((s) => sectorStatIds(s.id)) : sectorStatIds(sector.id);
      return {
        kind: 'sector', sector, total: ids.length,
        mastered: ids.filter((id) => isMastered(stats[id])).length,
        mastery: sector.skill === 'mixed' ? galaxyKnowledge(stats) : sectorKnowledge(sector.id, stats),
      };
    };

    if (skill === 'mixed') {
      for (const sector of sectors) lines.push(header(sector));
      lines.push({ kind: 'note', text: t('meta.mastery.mixedInfo') });
      return lines;
    }

    const allOfSkill = sectors.flatMap((s) => sectorFacts(s.id));
    this.cellW = cellWidth(Math.max(1, ...allOfSkill.map((f) => formatProblem(f, locale).length)));
    const grid = GRID_SKILLS.includes(skill);
    for (const sector of sectors) {
      lines.push(header(sector));
      if (sectorKind(sector.id) === 'generated') {
        lines.push({ kind: 'categories', sectorId: sector.id, categories: sectorCategories(sector.id) });
        continue;
      }
      const facts = sectorFacts(sector.id);
      if (grid) {
        lines.push({ kind: 'columns' });
        const tableOf = (f: Fact): number => (skill === 'multiplication' ? f.a : f.b);
        for (const n of [...new Set(facts.map(tableOf))]) {
          lines.push({
            kind: 'table', label: t(skill === 'multiplication' ? 'meta.mastery.rowMul' : 'meta.mastery.rowDiv', { n }),
            facts: facts.filter((f) => tableOf(f) === n),
          });
        }
        continue;
      }
      for (let at = 0; at < facts.length; at += ROW_CELLS) lines.push({ kind: 'cells', facts: facts.slice(at, at + ROW_CELLS) });
    }
    return lines;
  }

  private goToPage(page: number): void {
    if (page < 0 || page >= this.pages.length || page === this.page) return;
    this.page = page;
    this.drawPage();
  }

  // ------------------------------------------------------------------ grid

  private drawPage(): void {
    const layer = this.grid;
    layer.removeAll(true);
    this.cells = [];

    const multi = this.pages.length > 1;
    this.prevBtn.setVisible(multi).setEnabled(this.page > 0);
    this.nextBtn.setVisible(multi).setEnabled(this.page < this.pages.length - 1);
    this.pageText.setVisible(multi).setText(`${this.page + 1} / ${this.pages.length}`);

    const g = this.add.graphics();
    layer.add(g);
    const cw = this.cellW;
    let y = AREA_TOP;
    for (const index of this.pages[this.page] ?? []) {
      const line = this.lines[index];
      const h = LINE_H[line.kind];
      switch (line.kind) {
        case 'sector': {
          const color = cssColor(sectorColors(line.sector.hue).label);
          const name = this.add.text(LEFT, y + h - 12, app.i18n.t(line.sector.nameKey).toUpperCase(),
            capsStyle({ fontSize: `${SIZES.small + 1}px`, color, letterSpacing: LETTER_SPACING.caps })).setOrigin(0, 0.5);
          layer.add(name);
          const barX = LEFT + Math.max(240, name.width + 24);
          drawBar(g, barX, y + h - 14, 150, 4, line.mastery, BAND_COLORS[masteryBand(line.mastery)]);
          layer.add(this.add.text(barX + 162, y + h - 12, `${line.mastered} / ${line.total}`,
            numeralStyle({ fontSize: `${SIZES.small + 1}px`, color: CSS.textDim })).setOrigin(0, 0.5));
          layer.add(this.add.text(barX + 236, y + h - 12, percentText(app.i18n, line.mastery),
            numeralStyle({ fontSize: `${SIZES.small + 1}px`, color: CSS.textDim })).setOrigin(0, 0.5));
          break;
        }
        case 'columns': {
          for (let c = 0; c < 10; c++) {
            layer.add(this.add.text(LEFT + TABLE_LABEL_W + c * (cw + CELL_GAP) + cw / 2, y + h / 2, String(c + 1),
              numeralStyle({ fontSize: `${SIZES.small}px`, color: CSS.textDim })).setOrigin(0.5));
          }
          break;
        }
        case 'table': {
          layer.add(this.add.text(LEFT, y + CELL_H / 2, line.label, labelStyle({ fontSize: `${SIZES.small + 1}px` }))
            .setOrigin(0, 0.5));
          line.facts.forEach((fact, c) => this.drawCell(g, fact, LEFT + TABLE_LABEL_W + c * (cw + CELL_GAP), y));
          break;
        }
        case 'cells': {
          line.facts.forEach((fact, c) => this.drawCell(g, fact, LEFT + c * (cw + CELL_GAP), y));
          break;
        }
        case 'categories': {
          line.categories.forEach((category, c) =>
            this.drawCategory(g, line.sectorId, category, LEFT + c * (CAT_W + CAT_GAP), y));
          break;
        }
        case 'note': {
          layer.add(this.add.text(LEFT, y + h / 2, line.text, labelStyle({ color: CSS.textDim })).setOrigin(0, 0.5));
          break;
        }
      }
      y += h;
    }
    this.drawSelection();
  }

  /** Cell background: its box colour when seen, an empty outline when never seen. Returns the ink colour. */
  private drawCellBox(g: Phaser.GameObjects.Graphics, s: FactStats | undefined, x: number, y: number, w: number, h: number): string {
    if (s !== undefined && s.attempts > 0) {
      g.fillStyle(BOX_COLORS[s.box], 0.88);
      g.fillRect(x, y, w, h);
      return s.box <= 1 ? CSS.text : CSS.bg;
    }
    g.lineStyle(1, COLORS.textDim, 0.45);
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    return CSS.textDim;
  }

  /** One fact cell: filled with its box colour and the box number when seen, an empty outline when never seen. */
  private drawCell(g: Phaser.GameObjects.Graphics, fact: Fact, x: number, y: number): void {
    const s = app.save.stats[fact.statId];
    const w = this.cellW;
    const seen = s !== undefined && s.attempts > 0;
    const ink = this.drawCellBox(g, s, x, y, w, CELL_H);
    const problem = this.add.text(x + 5, y + CELL_H / 2, formatProblem(fact, app.i18n.locale), numeralStyle({
      fontSize: `${SIZES.small}px`, color: ink,
    })).setOrigin(0, 0.5);
    const room = w - (seen ? 20 : 10);
    if (problem.width > room) problem.setScale(room / problem.width);
    this.grid.add(problem);
    if (seen) {
      this.grid.add(this.add.text(x + w - 5, y + CELL_H / 2, String(s.box), numeralStyle({
        fontSize: `${SIZES.small + 1}px`, color: ink,
      })).setOrigin(1, 0.5));
    }
    this.cells.push({ item: { kind: 'fact', statId: fact.statId, fact }, x, y, w, h: CELL_H });
  }

  /** One category cell of a generated sector: its name, the box number, and attempts · accuracy · average time. */
  private drawCategory(g: Phaser.GameObjects.Graphics, sectorId: string, category: string, x: number, y: number): void {
    const { t } = app.i18n;
    const statId = categoryStatId(sectorId, category);
    const s = app.save.stats[statId];
    const ink = this.drawCellBox(g, s, x, y, CAT_W, CAT_H);
    const name = this.add.text(x + 8, y + 13, t(`meta.category.${category}`).toUpperCase(), capsStyle({
      fontSize: `${SIZES.small}px`, color: ink, letterSpacing: 1,
    })).setOrigin(0, 0.5);
    if (name.width > CAT_W - 40) name.setScale((CAT_W - 40) / name.width);
    this.grid.add(name);
    if (s !== undefined && s.attempts > 0) {
      this.grid.add(this.add.text(x + CAT_W - 8, y + CAT_H / 2, String(s.box), numeralStyle({
        fontSize: `${SIZES.body}px`, color: ink,
      })).setOrigin(1, 0.5));
      const time = s.correct > 0 ? secondsText(app.i18n, s.avgMs) : t('meta.mastery.noTime');
      this.grid.add(this.add.text(x + 8, y + CAT_H - 12, `${s.attempts} · ${percentText(app.i18n, s.correct / s.attempts)} · ${time}`,
        numeralStyle({ fontSize: `${SIZES.small}px`, color: ink })).setOrigin(0, 0.5));
    }
    this.cells.push({ item: { kind: 'category', statId, category }, x, y, w: CAT_W, h: CAT_H });
  }

  private pickCell(px: number, py: number): void {
    const hit = this.cells.find((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
    if (!hit) return;
    Button.clickSound?.();
    this.selected = hit.item;
    this.drawSelection();
    this.drawDetail();
  }

  private drawSelection(): void {
    const g = this.selection;
    g.clear();
    const cell = this.selected ? this.cells.find((c) => c.item.statId === this.selected?.statId) : undefined;
    if (!cell) return;
    g.lineStyle(2, COLORS.white, 1);
    g.strokeRect(cell.x - 2, cell.y - 2, cell.w + 4, cell.h + 4);
  }

  // ------------------------------------------------------------------ detail and legend

  private drawDetail(): void {
    const { t } = app.i18n;
    const item = this.selected;
    if (!item) {
      this.detail.setText('');
      return;
    }
    const solved = item.kind === 'fact' ? formatSolved(item.fact, app.i18n.locale) : t(`meta.category.${item.category}`);
    const s = app.save.stats[item.statId];
    if (!s || s.attempts === 0) {
      this.detail.setText(t('meta.mastery.notSeen', { fact: solved }));
      return;
    }
    this.detail.setText(t('meta.mastery.detail', {
      fact: solved,
      attempts: s.attempts,
      accuracy: percentText(app.i18n, s.correct / s.attempts),
      time: s.correct > 0 ? secondsText(app.i18n, s.avgMs) : t('meta.mastery.noTime'),
      box: s.box,
      when: this.dueText(s.dueAt),
    }));
  }

  private dueText(dueAt: number): string {
    const { t, tp } = app.i18n;
    const due = relativeDue(dueAt, this.now);
    if (due.unit === 'now') return t('meta.mastery.dueNow');
    const key = due.unit === 'minutes' ? 'meta.mastery.inMinutes' : due.unit === 'hours' ? 'meta.mastery.inHours' : 'meta.mastery.inDays';
    return tp(key, due.count);
  }

  private drawLegend(): void {
    const { t } = app.i18n;
    const y = LEGEND_Y;
    let x = LEFT;
    const title = this.add.text(x, y, t('meta.mastery.legendTitle').toUpperCase(), capsStyle({
      fontSize: `${SIZES.small}px`, color: CSS.textDim,
    })).setOrigin(0, 0.5);
    x += title.width + SPACING.m;
    const g = this.add.graphics();
    const sw = 22;
    const sh = 18;
    const items: Array<{ box: number | null; text: string }> = [
      ...BOX_COLORS.map((_, box) => ({ box, text: t(`meta.mastery.box.${box}`) })),
      { box: null, text: t('meta.mastery.legendNew') },
    ];
    for (const item of items) {
      if (item.box === null) {
        g.lineStyle(1, COLORS.textDim, 0.6);
        g.strokeRect(x + 0.5, y - sh / 2 + 0.5, sw - 1, sh - 1);
      } else {
        g.fillStyle(BOX_COLORS[item.box], 0.88);
        g.fillRect(x, y - sh / 2, sw, sh);
        this.add.text(x + sw / 2, y, String(item.box), numeralStyle({
          fontSize: `${SIZES.small}px`, color: item.box <= 1 ? CSS.text : CSS.bg,
        })).setOrigin(0.5);
      }
      const label = this.add.text(x + sw + 6, y, item.text, labelStyle({ fontSize: `${SIZES.small}px` })).setOrigin(0, 0.5);
      x += sw + 6 + label.width + SPACING.m;
    }
  }
}
