import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../src/core/*.ts', { query: '?raw', import: 'default', eager: true });

describe('core layering rule', () => {
  const files = Object.keys(sources).map((p) => p.split('/').pop() ?? p);

  it('has every core module', () => {
    expect(files.sort()).toEqual([
      'battle.ts', 'content.ts', 'economy.ts', 'factgen.ts', 'facts.ts', 'galaxy.ts', 'i18n.ts',
      'layout.ts', 'mastery.ts', 'names.ts', 'rng.ts', 'save.ts', 'scheduler.ts', 'story.ts',
      'types.ts', 'upgrades.ts',
    ]);
  });

  for (const [path, src] of Object.entries(sources)) {
    it(`${path} uses no Phaser, other layers, DOM, clock, Math.random or localStorage`, () => {
      expect(src).not.toMatch(/from ['"]phaser['"]/);
      expect(src).not.toMatch(/from ['"]\.\.\//);
      expect(src).not.toMatch(/Date\.now|Math\.random|localStorage|\bwindow\.|\bdocument\./);
    });
  }
});
