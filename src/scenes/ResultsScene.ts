import Phaser from 'phaser';
import { app } from '../app';
import { formatSolved } from '../core/facts';
import { MAX_PLANET_LEVEL, masteryBand } from '../core/mastery';
import type { Fact } from '../core/types';
import { battleBgFor, hasImage } from '../fx/assets';
import { Starfield } from '../fx/Starfield';
import { Button } from '../ui/Button';
import { percentText } from '../ui/format';
import { drawRing } from '../ui/glyphs';
import { bodyStyle, capsStyle, numeralStyle } from '../ui/TextStyles';
import { BAND_COLORS, COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, LETTER_SPACING, LINE_WIDTH, SIZES } from '../ui/theme';

export interface ResultsSceneData {
  planetId: string;
  won: boolean;
  score: number;
  credits: number;
  missed: Fact[];
  accuracy: number;
  bestStreak: number;
  /** Planet mastery (level / 5) before and after the mission. */
  masteryBefore: number;
  masteryAfter: number;
}

/** Planet level as "level / 5" for a mastery fraction. */
const levelText = (mastery: number): string => `${Math.round(mastery * MAX_PLANET_LEVEL)} / ${MAX_PLANET_LEVEL}`;

const CX = GAME_WIDTH / 2;
const OUTCOME_Y = 118;
const STATS_Y = 214;
const STAT_SPACING = 180;
const RING_Y = 352;
const RING_R = 44;
const GRID_Y = 448;
const CELL_W = 150;
const CELL_H = 30;
const CELL_GAP = 8;
const GRID_COLS = 5;
const GRID_MAX = 10;
const STORY_Y = 572;
const BUTTONS_Y = 640;

/**
 * Mission result over the dimmed battle background: outcome in two words, four numbers,
 * the planet's level ring animating before -> after, missed facts as a compact grid of
 * solved facts, one story line and two small buttons (retry, map). Enter or Space = map.
 */
export class ResultsScene extends Phaser.Scene {
  private starfield: Starfield | null = null;

  constructor() {
    super('Results');
  }

  create(data: ResultsSceneData): void {
    const { t } = app.i18n;
    app.sfx.startAmbience('map');
    this.starfield = null;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const bgKey = battleBgFor(data.planetId);
    if (hasImage(this, bgKey)) {
      const img = this.add.image(CX, GAME_HEIGHT / 2, bgKey);
      img.setScale(Math.max(GAME_WIDTH / img.width, GAME_HEIGHT / img.height) * 1.08);
    } else {
      this.starfield = new Starfield(this, { speed: 0.1 });
    }
    this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg, 0.72);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.starfield?.destroy();
      this.starfield = null;
    });

    const outcome = data.won ? COLORS.ok : COLORS.danger;
    this.add.text(CX, OUTCOME_Y, t(data.won ? 'battle.results.victory' : 'battle.results.defeat').toUpperCase(),
      capsStyle({ fontSize: `${SIZES.title}px`, color: data.won ? CSS.ok : CSS.danger, letterSpacing: LETTER_SPACING.wide }))
      .setOrigin(0.5);
    const rule = this.add.graphics();
    rule.lineStyle(LINE_WIDTH, outcome, 0.5);
    rule.lineBetween(CX - 160, OUTCOME_Y + 30.5, CX + 160, OUTCOME_Y + 30.5);

    this.buildStats(data);
    this.buildMastery(data);
    this.buildMissed(data.missed);

    this.add.text(CX, STORY_Y, t(data.won ? 'story.result.win' : 'story.result.lose'),
      bodyStyle({ color: CSS.textDim, fontStyle: 'italic', align: 'center' })).setOrigin(0.5);

    const retry = (): void => { this.scene.start('Battle', { planetId: data.planetId }); };
    const toMap = (): void => { this.scene.start('StarMap'); };
    new Button(this, CX - 92, BUTTONS_Y, t('battle.results.retry'), retry, { width: 160, height: 36, variant: 'ghost' });
    new Button(this, CX + 92, BUTTONS_Y, t('battle.results.starMap'), toMap, { width: 160, height: 36 });
    this.input.keyboard?.once('keydown-ENTER', toMap);
    this.input.keyboard?.once('keydown-SPACE', toMap);
  }

  update(_time: number, delta: number): void {
    this.starfield?.update(delta);
  }

  private buildStats(data: ResultsSceneData): void {
    const { t } = app.i18n;
    const stats: Array<[string, string, string]> = [
      [t('battle.results.score'), String(data.score), CSS.text],
      [t('battle.results.accuracy'), percentText(app.i18n, data.accuracy), CSS.text],
      [t('battle.results.bestStreak'), String(data.bestStreak), CSS.text],
      [t('battle.results.credits'), `+${data.credits}`, CSS.primary],
    ];
    const x0 = CX - (STAT_SPACING * (stats.length - 1)) / 2;
    stats.forEach(([label, value, color], i) => {
      const x = x0 + i * STAT_SPACING;
      this.add.text(x, STATS_Y, value, numeralStyle({ fontSize: `${SIZES.title}px`, color })).setOrigin(0.5);
      this.add.text(x, STATS_Y + 30, label.toUpperCase(),
        capsStyle({ fontSize: `${SIZES.small}px`, color: CSS.textDim })).setOrigin(0.5, 0);
    });
  }

  /** Planet level ring from before to after (animated), a tick where it stood before, and the two levels. */
  private buildMastery(data: ResultsSceneData): void {
    const { t } = app.i18n;
    const g = this.add.graphics();
    const tick = this.add.graphics();
    const angle = -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0, data.masteryBefore));
    tick.lineStyle(2, COLORS.text, 1);
    tick.lineBetween(CX + Math.cos(angle) * (RING_R - 7), RING_Y + Math.sin(angle) * (RING_R - 7),
      CX + Math.cos(angle) * (RING_R + 7), RING_Y + Math.sin(angle) * (RING_R + 7));
    const value = this.add.text(CX, RING_Y, '', numeralStyle({ fontSize: `${SIZES.heading}px` })).setOrigin(0.5);
    // "before ->" left of the ring; the ring and its centre number animate to "after".
    this.add.text(CX - RING_R - 40, RING_Y, levelText(data.masteryBefore),
      numeralStyle({ fontSize: `${SIZES.body}px`, color: CSS.textDim })).setOrigin(1, 0.5);
    this.add.text(CX - RING_R - 22, RING_Y, '→', numeralStyle({ fontSize: `${SIZES.body}px`, color: CSS.textDim }))
      .setOrigin(0.5);
    this.add.text(CX, RING_Y + RING_R + 14, t('battle.results.level').toUpperCase(),
      capsStyle({ fontSize: `${SIZES.small}px`, color: CSS.textDim })).setOrigin(0.5, 0);

    const draw = (v: number): void => {
      g.clear();
      drawRing(g, CX, RING_Y, RING_R, v, BAND_COLORS[masteryBand(v)], 3);
      value.setText(levelText(v));
    };
    draw(data.masteryBefore);
    const counter = { v: data.masteryBefore };
    this.tweens.add({
      targets: counter,
      v: data.masteryAfter,
      delay: 500,
      duration: 1400,
      ease: 'Cubic.easeInOut',
      onUpdate: () => draw(counter.v),
      onComplete: () => draw(data.masteryAfter),
    });
  }

  /** Up to ten solved facts in a 5-column grid; more are summarised as "+N"; none -> one check glyph. */
  private buildMissed(missed: Fact[]): void {
    if (missed.length === 0) {
      const g = this.add.graphics();
      g.lineStyle(2, COLORS.ok, 0.9);
      g.beginPath();
      g.moveTo(CX - 12, GRID_Y + 18);
      g.lineTo(CX - 3, GRID_Y + 27);
      g.lineTo(CX + 14, GRID_Y + 8);
      g.strokePath();
      return;
    }
    const overflow = missed.length > GRID_MAX;
    const shown = overflow ? missed.slice(0, GRID_MAX - 1) : missed;
    const cells = shown.length + (overflow ? 1 : 0);
    const cols = Math.min(GRID_COLS, cells);
    const gridW = cols * CELL_W + (cols - 1) * CELL_GAP;
    const x0 = CX - gridW / 2;
    const cell = (i: number, text: string, color: string): void => {
      const x = x0 + (i % GRID_COLS) * (CELL_W + CELL_GAP);
      const y = GRID_Y + Math.floor(i / GRID_COLS) * (CELL_H + CELL_GAP);
      this.add.rectangle(x, y, CELL_W, CELL_H, COLORS.plate, 0.75).setOrigin(0, 0)
        .setStrokeStyle(LINE_WIDTH, COLORS.primaryDim, 0.8);
      this.add.text(x + CELL_W / 2, y + CELL_H / 2, text, numeralStyle({ fontSize: `${SIZES.body}px`, color }))
        .setOrigin(0.5);
    };
    shown.forEach((f, i) => cell(i, formatSolved(f, app.i18n.locale), CSS.text));
    if (overflow) cell(shown.length, `+${missed.length - shown.length}`, CSS.textDim);
  }
}
