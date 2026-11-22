/**
 * Pure layout helpers of the parent report (Mastery scene): relative review time, cell width
 * from the longest problem, flowing planet groups into rows, and paging.
 */

export type DueUnit = 'now' | 'minutes' | 'hours' | 'days';

/** When a fact is next due, relative to now: 'now', or a whole count of minutes / hours / days. */
export function relativeDue(dueAt: number, now: number): { unit: DueUnit; count: number } {
  const delta = dueAt - now;
  if (delta <= 0) return { unit: 'now', count: 0 };
  const minutes = Math.ceil(delta / 60_000);
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.round(delta / 3_600_000);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.max(1, Math.round(delta / 86_400_000)) };
}

/** Approximate advance of one monospace character at the cell font size (px). */
export const CELL_CHAR_W = 6.2;
/** Room for the box number and padding inside a cell (px). */
const CELL_EXTRA = 24;
export const CELL_MIN_W = 44;
export const CELL_MAX_W = 96;

/** Cell width that fits the longest problem text of a skill (in characters) plus the box number. */
export function cellWidth(maxChars: number): number {
  return Math.min(CELL_MAX_W, Math.max(CELL_MIN_W, Math.ceil(maxChars * CELL_CHAR_W + CELL_EXTRA)));
}

/**
 * Flows groups of the given widths into rows no wider than `rowWidth`, keeping their order,
 * with `gap` between groups. A group wider than the row gets a row of its own.
 * Returns the group indices of each row.
 */
export function flowRows(widths: readonly number[], rowWidth: number, gap: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    const need = row.length === 0 ? w : used + gap + w;
    if (row.length > 0 && need > rowWidth) {
      rows.push(row);
      row = [i];
      used = w;
    } else {
      row.push(i);
      used = need;
    }
  });
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * Splits lines of the given heights into pages of at most `pageHeight`. A line marked as a
 * header never ends a page (it moves to the next page with the line after it). A single line
 * taller than the page gets a page of its own. Returns the line indices of each page.
 */
export function paginate(heights: readonly number[], headers: readonly boolean[], pageHeight: number): number[][] {
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    let need = h;
    if (headers[i] && i + 1 < heights.length) need += heights[i + 1];
    if (page.length > 0 && used + need > pageHeight) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(i);
    used += h;
  });
  if (page.length > 0) pages.push(page);
  return pages;
}
