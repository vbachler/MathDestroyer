import Phaser from 'phaser';
import { app } from '../app';
import { CORE_PLANET_ID, SKILLS, planetsOfSector, sectorById, sectorsOfSkill } from '../core/content';
import { sectorMastery } from '../core/galaxy';
import { allFacts, factsForPlanet, formatProblem, formatSolved } from '../core/facts';
import { isMastered, masteryBand, planetMastery } from '../core/mastery';
import type { Fact, SectorDef, SkillId } from '../core/types';
import { Button } from '../ui/Button';
import { capsStyle, labelStyle, numeralStyle } from '../ui/TextStyles';
import { percentText, secondsText } from '../ui/format';
import { drawBar } from '../ui/glyphs';
import { addHitZone } from '../ui/hitZone';
import { cssColor, sectorColors } from '../ui/mapPalette';
import { cellWidth, flowRows, paginate, relativeDue } from '../ui/reportLayout';
import { BAND_COLORS, BOX_COLORS, COLORS, CSS, DEPTH, GAME_WIDTH, LETTER_SPACING, SIZES, SPACING } from '../ui/theme';

export interface MasterySceneData { from?: 'Menu' | 'StarMap'; }

/** One line of the report; a sector header starts each block. */
type Line =
  | { kind: 'sector'; sector: SectorDef; mastery: number; mastered: number; total: number }
  | { kind: 'groups'; groups: Array<{ name: string; facts: Fact[] }> }
  | { kind: 'columns' }
  | { kind: 'table'; label: string; facts: Fact[] }
  | { kind: 'note'; text: string };

interface CellRect { fact: Fact; x: number; y: number; w: number; h: number; }

const LEFT = SPACING.l;
const AREA_W = GAME_WIDTH - 2 * SPACING.l;
const AREA_TOP = 98;
const AREA_H = 512;
const LINE_H: Record<Line['kind'], number> = { sector: 32, groups: 25, columns: 18, table: 25, note: 26 };
const CELL_H = 20;
const CELL_GAP = 3;
const GROUP_GAP = 22;
const NAME_W = 86;
const TABLE_LABEL_W = 120;
const TAB_Y = 64;
const DETAIL_Y = 636;
const LEGEND_Y = 682;
const WHEEL_COOLDOWN_MS = 220;
const GRID_SKILLS: readonly SkillId[] = ['multiplication', 'division'];

/**
 * Parent report: a tab per skill; inside, a block per sector (name, mastery bar, mastered /
 * total) with its facts as small cells coloured by Leitner box, the box number inside (an
 * empty outline for never seen). Multiplication and division show table grids. Selecting a
 * cell shows one detail line. Pages with the wheel or ‹ ›.
 */
export class MasteryScene extends Phaser.Scene {
  private from: 'Menu' | 'StarMap' = 'Menu';
  private skill: SkillId = 'typing';
  private lines: Line[] = [];
  private pages: number[][] = [];
  private page = 0;
  private cells: CellRect[] = [];
  private selected: Fact | null = null;
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
    // The core has no facts of its own; its block reports every fact of the galaxy.
    const factsOf = (sector: SectorDef): Fact[] =>
      sector.skill === 'mixed' ? allFacts() : planetsOfSector(sector.id).flatMap((p) => factsForPlanet(p.id));
    const header = (sector: SectorDef): Line => {
      const facts = factsOf(sector);
      return {
        kind: 'sector', sector, total: facts.length,
        mastered: facts.filter((f) => isMastered(stats[f.id])).length,
        mastery: sector.skill === 'mixed' ? planetMastery(CORE_PLANET_ID, stats) : sectorMastery(sector.id, stats),
      };
    };

    if (skill === 'mixed') {
      for (const sector of sectors) lines.push(header(sector));
      lines.push({ kind: 'note', text: t('meta.mastery.mixedInfo') });
      return lines;
    }

    const allOfSkill = sectors.flatMap(factsOf);
    this.cellW = cellWidth(Math.max(1, ...allOfSkill.map((f) => formatProblem(f, locale).length)));
    const grid = GRID_SKILLS.includes(skill);
    for (const sector of sectors) {
      lines.push(header(sector));
      if (grid) {
        lines.push({ kind: 'columns' });
        for (const system of sector.systems) {
          const facts = system.planets.flatMap((p) => factsForPlanet(p.id));
          const n = skill === 'multiplication' ? facts[0].a : facts[0].b;
          lines.push({ kind: 'table', label: t(skill === 'multiplication' ? 'meta.mastery.rowMul' : 'meta.mastery.rowDiv', { n }), facts });
        }
        continue;
      }
      const groups = planetsOfSector(sector.id).map((p) => ({ name: p.name, facts: factsForPlanet(p.id) }));
      const widths = groups.map((gr) => NAME_W + gr.facts.length * (this.cellW + CELL_GAP));
      for (const row of flowRows(widths, AREA_W, GROUP_GAP)) lines.push({ kind: 'groups', groups: row.map((i) => groups[i]) });
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
        case 'groups': {
          let x = LEFT;
          for (const group of line.groups) {
            const name = this.add.text(x, y + CELL_H / 2, group.name.toUpperCase(), capsStyle({
              fontSize: `${SIZES.small - 1}px`, color: CSS.textDim, letterSpacing: 1,
            })).setOrigin(0, 0.5);
            if (name.width > NAME_W - 8) name.setScale((NAME_W - 8) / name.width);
            layer.add(name);
            group.facts.forEach((fact, c) => this.drawCell(g, fact, x + NAME_W + c * (cw + CELL_GAP), y));
            x += NAME_W + group.facts.length * (cw + CELL_GAP) + GROUP_GAP;
          }
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

  /** One fact cell: filled with its box colour and the box number when seen, an empty outline when never seen. */
  private drawCell(g: Phaser.GameObjects.Graphics, fact: Fact, x: number, y: number): void {
    const s = app.save.stats[fact.id];
    const w = this.cellW;
    const seen = s !== undefined && s.attempts > 0;
    if (seen) {
      g.fillStyle(BOX_COLORS[s.box], 0.88);
      g.fillRect(x, y, w, CELL_H);
    } else {
      g.lineStyle(1, COLORS.textDim, 0.45);
      g.strokeRect(x + 0.5, y + 0.5, w - 1, CELL_H - 1);
    }
    const ink = !seen ? CSS.textDim : s.box <= 1 ? CSS.text : CSS.bg;
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
    this.cells.push({ fact, x, y, w, h: CELL_H });
  }

  private pickCell(px: number, py: number): void {
    const hit = this.cells.find((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
    if (!hit) return;
    Button.clickSound?.();
    this.selected = hit.fact;
    this.drawSelection();
    this.drawDetail();
  }

  private drawSelection(): void {
    const g = this.selection;
    g.clear();
    const cell = this.selected ? this.cells.find((c) => c.fact.id === this.selected?.id) : undefined;
    if (!cell) return;
    g.lineStyle(2, COLORS.white, 1);
    g.strokeRect(cell.x - 2, cell.y - 2, cell.w + 4, cell.h + 4);
  }

  // ------------------------------------------------------------------ detail and legend

  private drawDetail(): void {
    const { t } = app.i18n;
    const fact = this.selected;
    if (!fact) {
      this.detail.setText('');
      return;
    }
    const solved = formatSolved(fact, app.i18n.locale);
    const s = app.save.stats[fact.id];
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
