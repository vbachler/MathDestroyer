import { describe, expect, it } from 'vitest';
import { CELL_MAX_W, CELL_MIN_W, cellWidth, flowRows, paginate, relativeDue } from '../src/ui/reportLayout';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('report layout', () => {
  it('relative review time', () => {
    const now = 1_700_000_000_000;
    expect(relativeDue(now - 5, now)).toEqual({ unit: 'now', count: 0 });
    expect(relativeDue(now, now)).toEqual({ unit: 'now', count: 0 });
    expect(relativeDue(now + 1, now)).toEqual({ unit: 'minutes', count: 1 });
    expect(relativeDue(now + 2 * MIN, now)).toEqual({ unit: 'minutes', count: 2 });
    expect(relativeDue(now + 59 * MIN, now)).toEqual({ unit: 'minutes', count: 59 });
    expect(relativeDue(now + 90 * MIN, now)).toEqual({ unit: 'hours', count: 2 });
    expect(relativeDue(now + 23 * HOUR, now)).toEqual({ unit: 'hours', count: 23 });
    expect(relativeDue(now + 24 * HOUR, now)).toEqual({ unit: 'days', count: 1 });
    expect(relativeDue(now + 3 * DAY, now)).toEqual({ unit: 'days', count: 3 });
  });

  it('cell width fits the longest problem and stays within bounds', () => {
    expect(cellWidth(1)).toBe(CELL_MIN_W);
    expect(cellWidth(6)).toBeGreaterThan(cellWidth(3));
    expect(cellWidth(40)).toBe(CELL_MAX_W);
  });

  it('flows groups into rows in order', () => {
    expect(flowRows([100, 100, 100], 250, 10)).toEqual([[0, 1], [2]]);
    expect(flowRows([100, 100, 100], 320, 10)).toEqual([[0, 1, 2]]);
    expect(flowRows([400, 50], 300, 10)).toEqual([[0], [1]]);
    expect(flowRows([], 300, 10)).toEqual([]);
  });

  it('pages never end on a header and keep every line once', () => {
    const heights = [30, 25, 25, 30, 25, 25, 25];
    const headers = [true, false, false, true, false, false, false];
    const pages = paginate(heights, headers, 110);
    expect(pages.flat()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const page of pages) {
      expect(headers[page[page.length - 1]] && page[page.length - 1] < heights.length - 1).toBe(false);
      expect(page.reduce((sum, i) => sum + heights[i], 0)).toBeLessThanOrEqual(110);
    }
    expect(paginate([500], [false], 100)).toEqual([[0]]);
  });
});
