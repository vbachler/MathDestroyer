import type { Call } from '../core/story';
import { GAME_HEIGHT, GAME_WIDTH } from '../ui/theme';

/**
 * Pure geometry of the star map (no Phaser): the galaxy camera (world <-> screen, zoom toward a
 * point, fit and clamp), system orbits in tilted perspective, label collision, call card
 * anchoring, edge markers and call pacing. Every function is allocation-free unless it returns
 * an object, and the per-frame ones take and return plain numbers.
 */

export const VIEW_W = GAME_WIDTH;
export const VIEW_H = GAME_HEIGHT;

export interface Rect { x: number; y: number; w: number; h: number; }

/** Galaxy camera: the world point at the centre of the screen and the zoom (screen px per world unit). */
export interface MapView { cx: number; cy: number; zoom: number; }

// ------------------------------------------------------------------ galaxy camera

export function worldToScreenX(v: MapView, wx: number): number {
  return (wx - v.cx) * v.zoom + VIEW_W / 2;
}

export function worldToScreenY(v: MapView, wy: number): number {
  return (wy - v.cy) * v.zoom + VIEW_H / 2;
}

export function screenToWorldX(v: MapView, sx: number): number {
  return v.cx + (sx - VIEW_W / 2) / v.zoom;
}

export function screenToWorldY(v: MapView, sy: number): number {
  return v.cy + (sy - VIEW_H / 2) / v.zoom;
}

/** The view after zooming to `zoom` while the world point under screen (px, py) stays under it. */
export function zoomAt(v: MapView, zoom: number, px: number, py: number): MapView {
  const wx = screenToWorldX(v, px);
  const wy = screenToWorldY(v, py);
  return { cx: wx - (px - VIEW_W / 2) / zoom, cy: wy - (py - VIEW_H / 2) / zoom, zoom };
}

/** The smallest rectangle holding every disc. */
export function discBounds(discs: ReadonlyArray<{ x: number; y: number; radius: number }>): Rect {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const d of discs) {
    x0 = Math.min(x0, d.x - d.radius);
    y0 = Math.min(y0, d.y - d.radius);
    x1 = Math.max(x1, d.x + d.radius);
    y1 = Math.max(y1, d.y + d.radius);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The view that shows the whole rectangle with `margin` screen pixels free on every side. */
export function fitView(bounds: Rect, margin: number): MapView {
  const zoom = Math.min((VIEW_W - 2 * margin) / Math.max(1, bounds.w), (VIEW_H - 2 * margin) / Math.max(1, bounds.h));
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, zoom };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Pointer travel (screen px) beyond which a press is a drag, not a click. */
export const DRAG_THRESHOLD = 6;

export function isDrag(dx: number, dy: number, threshold = DRAG_THRESHOLD): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

/** Index of the point nearest to (x, y) within `maxDist`, or -1. Points are interleaved x, y. */
export function nearestPoint(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, x: number, y: number,
                             maxDist: number): number {
  let best = -1;
  let bestD = maxDist * maxDist;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - x;
    const dy = ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ------------------------------------------------------------------ system view

/** Vertical squash of orbit ellipses (tilted perspective): ry = ORBIT_TILT * rx. */
export const ORBIT_TILT = 0.38;
/** Screen position of the sun in the system view (centre-left). */
export const SUN_X = 540;
export const SUN_Y = 376;
const ORBIT_INNER = 140;
const ORBIT_OUTER = 480;
const ORBIT_STEP_MAX = 92;

/** Horizontal radius of orbit `index` (0-based) in a system with `count` planets. */
export function orbitRadius(index: number, count: number): number {
  if (count <= 1) return ORBIT_INNER + ORBIT_STEP_MAX;
  const step = Math.min(ORBIT_STEP_MAX, (ORBIT_OUTER - ORBIT_INNER) / (count - 1));
  return ORBIT_INNER + index * step;
}

/** x of a point at `angle` on an orbit of horizontal radius rx around (0, 0). */
export function orbitX(rx: number, angle: number): number {
  return Math.cos(angle) * rx;
}

/** y of a point at `angle` on an orbit of horizontal radius rx around (0, 0); positive = toward the viewer. */
export function orbitY(rx: number, angle: number): number {
  return Math.sin(angle) * rx * ORBIT_TILT;
}

/** True when the point at `angle` is on the near half of the orbit (drawn in front of the sun). */
export function inFront(angle: number): boolean {
  return Math.sin(angle) >= 0;
}

/** Angular speed (rad/s) on an orbit of radius rx: slow, outer planets slower (Kepler-like). */
export function orbitSpeed(rx: number): number {
  return 0.045 * Math.pow(ORBIT_INNER / rx, 1.5);
}

/** Planet sprite size, 34..46 px, from a stable hash of its id. */
export function planetSize(hash: number): number {
  return 34 + (Math.abs(Math.trunc(hash)) % 13);
}

// ------------------------------------------------------------------ labels

/**
 * Greedy label placement without allocation: walks `order` (indices, highest priority first),
 * keeps a label when its rectangle (x, y = top-left, w, h, plus `pad`) overlaps no label kept
 * before it, and writes 1 (kept) or 0 (dropped) to `out`. Entries with `active[i] === 0` are
 * skipped and dropped. Returns the number kept.
 */
export function resolveLabels(x: ArrayLike<number>, y: ArrayLike<number>, w: ArrayLike<number>, h: ArrayLike<number>,
                              active: ArrayLike<number>, order: ArrayLike<number>, n: number,
                              out: { [i: number]: number }, pad = 2): number {
  for (let i = 0; i < n; i++) out[i] = 0;
  let kept = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    if (!active[i]) continue;
    let free = true;
    for (let m = 0; m < k && free; m++) {
      const j = order[m];
      if (!out[j]) continue;
      if (x[i] - pad < x[j] + w[j] && x[j] - pad < x[i] + w[i] && y[i] - pad < y[j] + h[j] && y[j] - pad < y[i] + h[i]) {
        free = false;
      }
    }
    if (free) {
      out[i] = 1;
      kept++;
    }
  }
  return kept;
}

/**
 * Vertical offset (world units) for a sector name so it does not sit on a star: the first of
 * 0, -0.35r, +0.35r, -0.6r, +0.6r whose label box (labelW x labelH world units, centred
 * horizontally on the sector) keeps `clearance` from every system point.
 */
export function sectorLabelOffset(cx: number, cy: number, radius: number, labelW: number, labelH: number,
                                  points: ReadonlyArray<{ x: number; y: number }>, clearance: number): number {
  const candidates = [0, -0.35, 0.35, -0.6, 0.6];
  for (const k of candidates) {
    const dy = k * radius;
    const top = cy + dy - labelH / 2 - clearance;
    const bottom = cy + dy + labelH / 2 + clearance;
    const left = cx - labelW / 2 - clearance;
    const right = cx + labelW / 2 + clearance;
    if (points.every((p) => p.x < left || p.x > right || p.y < top || p.y > bottom)) return dy;
  }
  return 0;
}

// ------------------------------------------------------------------ call card

export const CARD_W = 360;
export const CARD_H = 150;
const CARD_MARGIN = 16;

/** Where the call card may sit, in order of preference: bottom-right, bottom-left, top-right, top-left
 *  (the top ones below the corner controls). */
export const CARD_ANCHORS: readonly Rect[] = [
  { x: VIEW_W - CARD_MARGIN - CARD_W, y: VIEW_H - CARD_MARGIN - CARD_H, w: CARD_W, h: CARD_H },
  { x: CARD_MARGIN, y: VIEW_H - CARD_MARGIN - CARD_H, w: CARD_W, h: CARD_H },
  { x: VIEW_W - CARD_MARGIN - CARD_W, y: 64, w: CARD_W, h: CARD_H },
  { x: CARD_MARGIN, y: 100, w: CARD_W, h: CARD_H },
];

/** Shortest distance from (x, y) to the rectangle (0 inside). */
export function distanceToRect(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/**
 * Index of the card anchor that keeps the target (a circle at x, y of radius r, e.g. a planet
 * with its label) uncovered: the first anchor, in preference order, at least r away; if none
 * is, the one farthest from the target.
 */
export function anchorCard(x: number, y: number, r: number, anchors: readonly Rect[] = CARD_ANCHORS): number {
  let far = 0;
  let farD = -1;
  for (let i = 0; i < anchors.length; i++) {
    const d = distanceToRect(anchors[i], x, y);
    if (d >= r) return i;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  return far;
}

/** True when the circle (x, y, r) touches the rectangle. */
export function circleHitsRect(r: Rect, x: number, y: number, radius: number): boolean {
  return distanceToRect(r, x, y) < radius;
}

// ------------------------------------------------------------------ edge markers

/** Screen x of the edge marker for direction (dx, dy) from the screen centre, inset from the edges. */
export function edgeX(dx: number, dy: number, inset: number): number {
  return VIEW_W / 2 + dx * edgeScale(dx, dy, inset);
}

/** Screen y of the edge marker for direction (dx, dy) from the screen centre, inset from the edges. */
export function edgeY(dx: number, dy: number, inset: number): number {
  return VIEW_H / 2 + dy * edgeScale(dx, dy, inset);
}

/** Factor that brings the direction vector from the centre to the inset screen rectangle. */
function edgeScale(dx: number, dy: number, inset: number): number {
  const hw = VIEW_W / 2 - inset;
  const hh = VIEW_H / 2 - inset;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return Number.isFinite(s) ? s : 0;
}

// ------------------------------------------------------------------ calls

export const FIRST_CALL_MS = 1200;
export const CALL_GAP_MIN_MS = 6000;
export const CALL_GAP_MAX_MS = 9000;
export const MAX_PENDING_CALLS = 3;

/** Delay before call number `index` (0 = first after entering the system view); `random01` in [0, 1). */
export function callDelayMs(index: number, random01: number): number {
  if (index <= 0) return FIRST_CALL_MS;
  return CALL_GAP_MIN_MS + (CALL_GAP_MAX_MS - CALL_GAP_MIN_MS) * clamp(random01, 0, 1);
}

export const isIntroCall = (call: Call): boolean => call.storyKey.startsWith('story.system.');

/**
 * The next call to deliver from `calls` (as `sectorCalls` returns them): planets that already
 * have a pending call are skipped; a call for a planet of the current system wins over the
 * others, otherwise sector order is kept. A skill intro is never delivered twice: when an intro
 * is already pending, other intro calls are skipped. null when nothing new is left.
 */
export function pickCall(calls: readonly Call[], pending: readonly Call[], systemPlanetIds: readonly string[]): Call | null {
  const introPending = pending.some(isIntroCall);
  const fresh = calls.filter((c) => !pending.some((p) => p.planetId === c.planetId) && !(introPending && isIntroCall(c)));
  return fresh.find((c) => systemPlanetIds.includes(c.planetId)) ?? fresh[0] ?? null;
}

/** Ease-in-out (smoothstep) of t in [0, 1]. */
export function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
