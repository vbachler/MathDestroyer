/**
 * Battle screen geometry (logical 1280x720). Pure: no Phaser, so it is unit tested
 * (tests/battleLayout.test.ts checks that nothing here overlaps).
 *
 * Dashboard: `ui/dash.png` is 1920x403 with five black screens. Shown full width (scale 2/3)
 * it would be 269 px tall and its screens would cover the stations, so it is drawn at
 * DASH_SCALE = 0.42 (806 px wide, centred, flanked by darkness) with its top at y = 576 and
 * its bottom frame cropped by the view edge (it ends at y = 745). The screens then sit at
 * y 625..713 and the hood of the console stays below the stations (bottom at y 570).
 */

export const VIEW_W = 1280;
export const VIEW_H = 720;

export interface Rect { x: number; y: number; w: number; h: number; }
export interface Point { x: number; y: number; }

// ---------------------------------------------------------------- dashboard

export const DASH_SRC_W = 1920;
export const DASH_SRC_H = 403;
export const DASH_SCALE = 0.42;
export const DASH_W = DASH_SRC_W * DASH_SCALE;          // 806.4
export const DASH_H = DASH_SRC_H * DASH_SCALE;          // 169.3
export const DASH_X = (VIEW_W - DASH_W) / 2;            // 236.8 (left edge)
export const DASH_Y = 576;                              // top edge

/**
 * Black screen interiors measured in the source image (pixels inside the amber bezels).
 * Rows 150/200/250/300 and columns through each screen were scanned for near-black runs.
 */
export const DASH_SCREENS_SRC = {
  left: { x: 124, y: 148, w: 203, h: 178 },
  leftInner: { x: 410, y: 195, w: 194, h: 131 },
  centre: { x: 793, y: 116, w: 344, h: 210 },
  rightInner: { x: 1326, y: 195, w: 193, h: 131 },
  right: { x: 1603, y: 148, w: 198, h: 178 },
} as const satisfies Record<string, Rect>;

export type DashScreen = keyof typeof DASH_SCREENS_SRC;

/** Source-image rectangle -> logical view rectangle. */
export function dashToView(r: Rect): Rect {
  return { x: DASH_X + r.x * DASH_SCALE, y: DASH_Y + r.y * DASH_SCALE, w: r.w * DASH_SCALE, h: r.h * DASH_SCALE };
}

/**
 * Screens in view coordinates:
 * left       x 288.9..374.2  y 638.2..713.0  (85 x 75)   wave
 * leftInner  x 409.0..490.5  y 657.9..713.0  (81 x 55)   score
 * centre     x 569.9..714.4  y 624.7..712.9  (144 x 88)  typed answer
 * rightInner x 793.7..874.8  y 657.9..713.0  (81 x 55)   streak
 * right      x 910.1..993.3  y 638.2..713.0  (83 x 75)   station hp
 */
export const DASH_SCREENS: Record<DashScreen, Rect> = {
  left: dashToView(DASH_SCREENS_SRC.left),
  leftInner: dashToView(DASH_SCREENS_SRC.leftInner),
  centre: dashToView(DASH_SCREENS_SRC.centre),
  rightInner: dashToView(DASH_SCREENS_SRC.rightInner),
  right: dashToView(DASH_SCREENS_SRC.right),
};

/** First opaque row of the dashboard image at source column x (measured; linear in between). */
const DASH_TOP_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 403], [29, 403], [30, 98], [100, 73], [300, 46], [500, 25], [700, 10], [960, 2],
  [1200, 9], [1500, 32], [1800, 70], [1890, 96], [1918, 96], [1919, 403],
];

/** Top edge of the drawn dashboard at view x (VIEW_H where the dashboard is absent). */
export function dashTopAt(viewX: number): number {
  const sx = (viewX - DASH_X) / DASH_SCALE;
  if (sx < 0 || sx > DASH_SRC_W - 1) return VIEW_H;
  for (let i = 1; i < DASH_TOP_PROFILE.length; i++) {
    const [x1, y1] = DASH_TOP_PROFILE[i];
    if (sx <= x1) {
      const [x0, y0] = DASH_TOP_PROFILE[i - 1];
      const t = x1 === x0 ? 0 : (sx - x0) / (x1 - x0);
      const srcY = y0 + (y1 - y0) * t;
      return srcY >= DASH_SRC_H ? VIEW_H : DASH_Y + srcY * DASH_SCALE;
    }
  }
  return VIEW_H;
}

// ---------------------------------------------------------------- field

/** Sim field: enemies spawn at y 60 and hit at y 600 (core/battle.ts). */
export const SIM_SPAWN_Y = 60;
export const SIM_IMPACT_Y = 600;
/** Drawn ship centre at spawn and at impact: the sim's descent is mapped onto the stations. */
export const SHIP_SPAWN_Y = 64;
export const SHIP_IMPACT_Y = 510;
/** Ship length (the 256 px sprite frame) at spawn and at impact: grows with depth. */
export const SHIP_SIZE_FAR = 34;
export const SHIP_SIZE_NEAR = 52;

const progress = (simY: number): number =>
  Math.min(1, Math.max(0, (simY - SIM_SPAWN_Y) / (SIM_IMPACT_Y - SIM_SPAWN_Y)));

export function shipScreenY(simY: number): number {
  return SHIP_SPAWN_Y + (SHIP_IMPACT_Y - SHIP_SPAWN_Y) * progress(simY);
}

export function shipSize(simY: number): number {
  return SHIP_SIZE_FAR + (SHIP_SIZE_NEAR - SHIP_SIZE_FAR) * progress(simY);
}

/** Stations (the defended objects) at DOME_X, this y; sprite 58 px wide, content 58x43. */
export const STATION_Y = 548;
export const STATION_W = 58;
export const STATION_H = 44;
/** hp pips under each station. */
export const STATION_PIP_Y = STATION_Y + STATION_H / 2 + 4;   // 574
export const STATION_PIP_H = 3;

export function stationRect(x: number): Rect {
  return { x: x - STATION_W / 2, y: STATION_Y - STATION_H / 2, w: STATION_W, h: STATION_H };
}

/** The ship's guns: lower-left and lower-right corners of the view (beams pass behind the dashboard). */
export const GUN_LEFT: Point = { x: 18, y: VIEW_H - 14 };
export const GUN_RIGHT: Point = { x: VIEW_W - 18, y: VIEW_H - 14 };

/** Small pause glyph button, top-right. */
export const PAUSE_RECT: Rect = { x: VIEW_W - 44, y: 8, w: 36, h: 36 };

// ---------------------------------------------------------------- touch keypad

export const KEY_SIZE = 48;
export const KEY_GAP = 4;
/** Digits + sign + backspace: 4 x 3 keys in the bottom-left corner, left of the dashboard. */
export const KEYPAD_DIGITS: Rect = {
  x: 4,
  y: VIEW_H - 8 - (3 * KEY_SIZE + 2 * KEY_GAP),
  w: 4 * KEY_SIZE + 3 * KEY_GAP,
  h: 3 * KEY_SIZE + 2 * KEY_GAP,
};
/** One tall fire key in the bottom-right corner, right of the dashboard. */
export const KEYPAD_FIRE: Rect = {
  x: VIEW_W - 8 - 100,
  y: KEYPAD_DIGITS.y,
  w: 100,
  h: KEYPAD_DIGITS.h,
};

// ---------------------------------------------------------------- problem tags

export type TagSide = 'left' | 'right';

/** Horizontal gap (hairline) between the ship's edge and its tag. */
export const TAG_GAP = 12;
export const TAG_MARGIN = 6;

export interface TagItem {
  id: number;
  x: number;              // ship centre (view)
  y: number;
  shipHalfW: number;
  shipHalfH: number;
  tagW: number;
  tagH: number;
}

export function tagRect(item: TagItem, side: TagSide): Rect {
  const x = side === 'right'
    ? item.x + item.shipHalfW + TAG_GAP
    : item.x - item.shipHalfW - TAG_GAP - item.tagW;
  return { x, y: item.y - item.tagH / 2, w: item.tagW, h: item.tagH };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const inView = (r: Rect): boolean => r.x >= TAG_MARGIN && r.x + r.w <= VIEW_W - TAG_MARGIN;

/**
 * Picks the side of each ship's problem tag. Lower ships (greater y) choose first, so the
 * enemy about to hit keeps its tag where it is and the higher neighbour moves. A side is
 * valid when the tag stays on screen and overlaps no tag placed already and no other ship.
 * Preference: the side used last frame (no flicker), else outward-in (ships left of centre
 * put the tag on the right). When neither side is valid, the side with less overlap wins.
 */
export function layoutTags(items: readonly TagItem[], previous: ReadonlyMap<number, TagSide> = new Map()): Map<number, TagSide> {
  const out = new Map<number, TagSide>();
  const sorted = [...items].sort((a, b) => b.y - a.y || a.id - b.id);
  const placed: Rect[] = [];
  for (const item of sorted) {
    const preferred: TagSide = previous.get(item.id) ?? (item.x < VIEW_W / 2 ? 'right' : 'left');
    const order: TagSide[] = preferred === 'right' ? ['right', 'left'] : ['left', 'right'];
    const obstacles = [
      ...placed,
      ...items.filter((o) => o.id !== item.id)
        .map((o) => ({ x: o.x - o.shipHalfW, y: o.y - o.shipHalfH, w: o.shipHalfW * 2, h: o.shipHalfH * 2 })),
    ];
    let best: TagSide = order[0];
    let bestCost = Infinity;
    for (const side of order) {
      const r = tagRect(item, side);
      const cost = (inView(r) ? 0 : 1e9) + obstacles.reduce((sum, o) => sum + overlapArea(r, o), 0);
      if (cost < bestCost) {
        best = side;
        bestCost = cost;
      }
      if (cost === 0) break;
    }
    out.set(item.id, best);
    placed.push(tagRect(item, best));
  }
  return out;
}

/** Where a missed shot goes: 40..70 px beside the target (`r01` in 0..1 picks distance and side). */
export function missPoint(target: Point, r01: number): Point {
  const side = r01 < 0.5 ? -1 : 1;
  const dist = 40 + 30 * ((r01 * 2) % 1);
  let x = target.x + side * dist;
  if (x < TAG_MARGIN || x > VIEW_W - TAG_MARGIN) x = target.x - side * dist;
  return { x, y: target.y - 6 };
}
