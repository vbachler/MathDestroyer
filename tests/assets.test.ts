import { describe, expect, it } from 'vitest';
import { PLANETS, SECTORS } from '../src/core/content';
import { UPGRADES } from '../src/core/upgrades';
import { MODULES } from '../src/core/economy';
import {
  ASSET_URLS, IMG, SHEET_URLS, battleBgFor, crawlerImageFor, crawlerWalkFor, enemyImageFor, iconFor, planetImageFor, voiceUrlFor,
} from '../src/fx/assets';

describe('asset helpers', () => {
  it('every texture key has a URL under assets/', () => {
    const keys = [
      ...Object.values(IMG.bg), IMG.ui.dash, ...Object.values(IMG.crawlers), ...Object.values(IMG.ships), ...IMG.planets,
      ...Object.values(IMG.portraits), ...Object.values(IMG.icons),
    ];
    expect(Object.keys(ASSET_URLS).sort()).toEqual([...keys].sort());
    expect(ASSET_URLS[IMG.icons.headStart]).toBe('assets/icons/headStart.jpg');
    expect(ASSET_URLS[IMG.ui.dash]).toBe('assets/ui/dash.png');
    expect(ASSET_URLS[IMG.bg.hangar]).toBe('assets/bg/bg_hangar.jpg');
    expect(ASSET_URLS[crawlerImageFor('spider')]).toBe('assets/crawlers/spider.png');
    expect(SHEET_URLS[crawlerWalkFor('crab')]).toBe('assets/crawlers/crab_walk.png');
    expect(Object.keys(SHEET_URLS).sort()).toEqual(Object.values(IMG.crawlerWalk).sort());
  });

  it('planetImageFor is stable and uses one of the eight pictures', () => {
    for (const p of PLANETS) {
      expect(IMG.planets).toContain(planetImageFor(p.id));
      expect(planetImageFor(p.id)).toBe(planetImageFor(p.id));
    }
    expect(new Set(PLANETS.map((p) => planetImageFor(p.id))).size).toBeGreaterThanOrEqual(6);
  });

  it('battleBgFor follows sector order % 3', () => {
    const bgs = [IMG.bg.battleOcean, IMG.bg.battleDesert, IMG.bg.battleIce];
    for (const s of SECTORS) {
      for (const p of s.systems.flatMap((y) => y.planets)) expect(battleBgFor(p.id)).toBe(bgs[s.order % 3]);
    }
    expect(battleBgFor('type-1.1')).toBe(IMG.bg.battleOcean);
    expect(battleBgFor('type-2.1')).toBe(IMG.bg.battleDesert);
    expect(battleBgFor('nope')).toBe(IMG.bg.battleOcean);
  });

  it('enemyImageFor cycles by id; iconFor covers every upgrade and module', () => {
    expect([1, 2, 3, 4].map(enemyImageFor)).toEqual([IMG.ships.enemyB, IMG.ships.enemyC, IMG.ships.enemyA, IMG.ships.enemyB]);
    for (const id of [...UPGRADES.map((u) => u.id), ...MODULES.map((m) => m.id)]) {
      expect(iconFor(id)).toBe(`icon_${id}`);
    }
  });

  it('voiceUrlFor lists the locale first, then English', () => {
    expect(voiceUrlFor('story.system.typing.text', 'hr')).toEqual([
      'assets/voice/hr/story.system.typing.text.mp3', 'assets/voice/hr/story.system.typing.text.wav',
      'assets/voice/en/story.system.typing.text.mp3', 'assets/voice/en/story.system.typing.text.wav',
    ]);
    expect(voiceUrlFor('k', 'en')).toEqual(['assets/voice/en/k.mp3', 'assets/voice/en/k.wav']);
  });
});
