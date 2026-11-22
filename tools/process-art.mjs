// Turns the raw generated art in art-src/ into the shipped files under public/assets/.
// Re-runnable and deterministic. Usage: npm run art
// Missing sources print a WARNING line and are skipped; the script still exits 0.

import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'art-src');
const OUT = path.join(ROOT, 'public', 'assets');

const BACKGROUNDS = ['bg_battle_ocean', 'bg_battle_desert', 'bg_battle_ice', 'bg_menu', 'bg_starmap', 'bg_bridge',
  'bg_ftl', 'station_shop_bg'];
const SHIPS = ['ship_enemy_a', 'ship_enemy_b', 'ship_enemy_c', 'ship_player', 'station_orbital'];
const PLANETS = ['planet_1', 'planet_2', 'planet_3', 'planet_4', 'planet_5', 'planet_6', 'planet_7', 'planet_8'];
const PORTRAITS = ['portrait_tarrow', 'portrait_kito', 'portrait_abacus'];
const ICONS = ['slowField', 'autoTurret', 'overcharge', 'salvage', 'repairDrone', 'shield', 'hull', 'targeting',
  'headStart'];

const JPEG = { quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' };
const SHIP_BOX = 256;
const PLANET_SIZE = 256;
const DASH_WIDTH = 1920;

let written = 0;
const missing = [];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

async function ensureDir(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

function report(src, out, info) {
  written++;
  console.log(`${rel(src)} -> ${rel(out)} (${info})`);
}

/** Runs `fn(src, out)` when the source exists, else records a warning. */
async function job(name, outRel, fn) {
  const src = path.join(SRC, `${name}.png`);
  const out = path.join(OUT, outRel);
  if (!existsSync(src)) {
    missing.push(name);
    console.log(`WARNING: missing source art-src/${name}.png (expected for ${rel(out)})`);
    return;
  }
  await ensureDir(out);
  try {
    const info = await fn(src, out);
    report(src, out, info);
  } catch (err) {
    console.log(`WARNING: failed to process art-src/${name}.png: ${err instanceof Error ? err.message : err}`);
  }
}

// ------------------------------------------------------------------ helpers on raw RGBA

async function loadRgba(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function median(values) {
  const s = Float64Array.from(values).sort();
  return s.length ? s[s.length >> 1] : 0;
}

/** How much green dominates a pixel. Red is weighted by half so backdrop tinted by a red
 *  light glow (r and g both high, b low) still reads as backdrop, while neutral greys, reds and
 *  blues of the hull read as foreground. */
const greenness = (data, i) => data[i + 1] - Math.max(data[i + 2], data[i] * 0.5);

/** Labels 4-connected components of mask (Uint8Array of 0/1). Returns { labels, sizes }. */
function components(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = sizes.length;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      const push = (q) => {
        if (mask[q] && labels[q] < 0) { labels[q] = id; stack[top++] = q; }
      };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Separable box blur of a Float32 plane, radius r. */
function boxBlur(plane, w, h, r) {
  if (r <= 0) return plane;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0; let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) { s += plane[y * w + xx]; n++; }
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0; let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Distance (in px, chessboard metric, capped) from every pixel to the nearest pixel where `mask` is 1. */
function distanceTo(mask, w, h, cap) {
  const d = new Float32Array(w * h).fill(cap);
  let frontier = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) { d[i] = 0; frontier.push(i); }
  for (let step = 1; step < cap && frontier.length; step++) {
    const next = [];
    for (const p of frontier) {
      const x = p % w; const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (d[q] > step) { d[q] = step; next.push(q); }
        }
      }
    }
    frontier = next;
  }
  return d;
}

/** Bounding box of pixels with alpha > threshold, or null. */
function alphaBounds(data, w, h, threshold) {
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const rawImage = (data, w, h) => sharp(data, { raw: { width: w, height: h, channels: 4 } });

// ------------------------------------------------------------------ processors

async function background(src, out) {
  await sharp(src).resize(1920, 1080, { fit: 'cover', position: 'centre' }).jpeg(JPEG).toFile(out);
  return '1920x1080 jpg';
}

function squareJpeg(size) {
  return async (src, out) => {
    await sharp(src).resize(size, size, { fit: 'cover', position: 'centre' }).jpeg(JPEG).toFile(out);
    return `${size}x${size} jpg`;
  };
}

/**
 * Green-screen key. The background is sampled from the image border; each pixel's
 * "greenness" (g - max(b, r/2)) is compared with the background's, which tolerates
 * brightness gradients in the backdrop. Only greenish pixels connected to the border are
 * keyed, so green-tinted details inside the ship never become holes.
 */
async function chromaKey(src, out) {
  const { data, w, h } = await loadRgba(src);
  const n = w * h;

  // Background greenness from the border ring (4 px).
  const border = [];
  const ring = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      border.push(greenness(data, i));
    }
  }
  const bgKey = Math.max(40, median(border));

  // Normalised greenness: ~1 on the backdrop, <= 0 on neutral / non-green colours.
  const g = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    g[p] = greenness(data, i) / bgKey;
  }

  // Background region: greenish pixels (soft edge included) connected to the border.
  const SOFT_LO = 0.22;   // below: opaque
  const SOFT_HI = 0.62;   // above: fully transparent
  const greenish = new Uint8Array(n);
  for (let p = 0; p < n; p++) greenish[p] = g[p] > SOFT_LO ? 1 : 0;
  const { labels } = components(greenish, w, h);
  const borderLabels = new Set();
  for (let x = 0; x < w; x++) { borderLabels.add(labels[x]); borderLabels.add(labels[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { borderLabels.add(labels[y * w]); borderLabels.add(labels[y * w + w - 1]); }
  borderLabels.delete(-1);

  const alpha = new Float32Array(n);
  const region = new Uint8Array(n);   // every keyed (border-connected greenish) pixel
  for (let p = 0; p < n; p++) {
    if (labels[p] >= 0 && borderLabels.has(labels[p])) {
      region[p] = 1;
      alpha[p] = 1 - smoothstep(SOFT_LO, SOFT_HI, g[p]);
    } else {
      alpha[p] = 1;
    }
  }

  // Remove specks: opaque islands much smaller than the main object.
  const solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) solid[p] = alpha[p] > 0.5 ? 1 : 0;
  const islands = components(solid, w, h);
  const biggest = Math.max(0, ...islands.sizes);
  const minIsland = Math.max(48, biggest * 0.002);
  for (let p = 0; p < n; p++) {
    const l = islands.labels[p];
    if (l >= 0 && islands.sizes[l] < minIsland) alpha[p] = 0;
  }
  // Feather: soften the edge by ~1.5 px without growing the object (blur then pull in slightly).
  const blurred = boxBlur(alpha, w, h, 1);
  for (let p = 0; p < n; p++) alpha[p] = clamp01(Math.min(alpha[p], blurred[p]) * 1.08 - 0.04);

  // Despill: right at the edge clamp green to the mean of red and blue (removes the fringe
  // without the magenta cast that un-mixing gives on thin parts), a few pixels in to the max of
  // red and blue. The art has no intentional green, so reflected spill is clamped everywhere.
  const GLOBAL_SPILL = 6;
  const nearBg = distanceTo(region, w, h, 6);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const a = alpha[p];
    if (a <= 0) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; continue; }
    const r = data[i]; const b = data[i + 2];
    // Elsewhere only a mild global clamp: green screen light reflected on the hull.
    const limit = nearBg[p] < 3 ? (r + b) / 2 : nearBg[p] < 6 ? Math.max(r, b) : Math.max(r, b) + GLOBAL_SPILL;
    if (data[i + 1] > limit) data[i + 1] = Math.round(limit);
    data[i + 3] = Math.round(a * 255);
  }

  const box = alphaBounds(data, w, h, 6);
  if (!box) throw new Error('nothing left after keying');
  await rawImage(data, w, h)
    .extract(box)
    .resize(SHIP_BOX, SHIP_BOX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  return `keyed, trimmed ${box.width}x${box.height}, fit ${SHIP_BOX}x${SHIP_BOX} png`;
}

/** Deterministic PRNG for RANSAC (mulberry32). */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Circle through three points, or null when they are (almost) collinear. */
function circleFrom3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = a[0] * a[0] + a[1] * a[1]; const b2 = b[0] * b[0] + b[1] * b[1]; const c2 = c[0] * c[0] + c[1] * c[1];
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

/**
 * Finds the planet disc. The limb is the longest sharp, circular edge in the image: strong
 * luminance edges are collected and a circle is fitted with RANSAC. Soft features (the
 * atmospheric glow outside the limb, the terminator, sun flares) have weak gradients, and
 * surface detail does not line up on one large circle, so they do not win the vote.
 */
function findDisc(lum, w, h) {
  const L = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = lum(p);
  const B = boxBlur(L, w, h, 1);
  const mag = new Float32Array(w * h);
  const mags = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = B[p + 1] - B[p - 1];
      const gy = B[p + w] - B[p - w];
      mag[p] = Math.hypot(gx, gy);
      if ((x + y) % 7 === 0) mags.push(mag[p]);
    }
  }
  mags.sort((a, b) => a - b);
  const strong = Math.max(6, mags[Math.floor(mags.length * 0.985)] * 0.5);
  const pts = [];
  for (let p = 0; p < w * h; p++) if (mag[p] >= strong) pts.push([p % w + 0.5, ((p / w) | 0) + 0.5]);
  if (pts.length < 50) throw new Error('no disc edge found');
  const rand = prng(12345);
  const sample = pts.length > 6000 ? Array.from({ length: 6000 }, (_, i) => pts[Math.floor((i * pts.length) / 6000)]) : pts;
  const minR = Math.min(w, h) * 0.15;
  const maxR = Math.min(w, h) * 0.55;
  const TOL = 2.5;
  let best = null; let bestScore = -1;
  for (let it = 0; it < 3000; it++) {
    const c = circleFrom3(pts[Math.floor(rand() * pts.length)], pts[Math.floor(rand() * pts.length)],
      pts[Math.floor(rand() * pts.length)]);
    if (!c || c.r < minR || c.r > maxR) continue;
    // Score by angular coverage (distinct 1-degree bins), so a full limb beats a dense texture patch.
    const bins = new Uint8Array(360);
    for (const q of sample) {
      const dx = q[0] - c.x; const dy = q[1] - c.y;
      if (Math.abs(Math.hypot(dx, dy) - c.r) <= TOL) bins[(Math.floor((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360] = 1;
    }
    let score = 0;
    for (const v of bins) score += v;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) throw new Error('no disc found');
  // Refine with an algebraic least-squares fit (Kasa) on the inliers.
  const inl = pts.filter((q) => Math.abs(Math.hypot(q[0] - best.x, q[1] - best.y) - best.r) <= TOL);
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of inl) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  const n = inl.length;
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [A B C]^T = [sxz syz sz]^T, circle x^2+y^2 = A x + B y + C.
  const M = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j];
    }
  }
  const A = M[0][3] / M[0][0]; const Bc = M[1][3] / M[1][1]; const C = M[2][3] / M[2][2];
  const cx = A / 2; const cy = Bc / 2;
  const radius = Math.sqrt(C + cx * cx + cy * cy);
  if (!Number.isFinite(radius) || Math.abs(radius - best.r) > best.r * 0.1) return { cx: best.x, cy: best.y, radius: best.r };
  return { cx, cy, radius };
}

/** Planet on black: find the disc, circular alpha mask with a soft edge just inside it. */
async function planet(src, out) {
  const { data, w, h } = await loadRgba(src);
  const lum = (p) => {
    const i = p * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const { cx, cy, radius } = findDisc(lum, w, h);
  const inner = radius - Math.max(3, radius * 0.015);   // mask edge sits just inside the disc
  const soft = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = clamp01((inner - d) / soft + 0.5);
      data[(y * w + x) * 4 + 3] = Math.round(a * 255);
    }
  }
  const size = Math.ceil(2 * inner + 2);
  let left = Math.round(cx - size / 2);
  let top = Math.round(cy - size / 2);
  // Pad with transparency when the square crop runs past the image edge.
  const padL = Math.max(0, -left); const padT = Math.max(0, -top);
  const padR = Math.max(0, left + size - w); const padB = Math.max(0, top + size - h);
  const padded = rawImage(data, w, h).extend({
    left: padL, top: padT, right: padR, bottom: padB, background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const buf = await padded.raw().toBuffer({ resolveWithObject: true });
  left += padL; top += padT;
  await sharp(buf.data, { raw: { width: buf.info.width, height: buf.info.height, channels: 4 } })
    .extract({ left, top, width: size, height: size })
    .resize(PLANET_SIZE, PLANET_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  return `disc r=${radius.toFixed(0)} at ${cx.toFixed(0)},${cy.toFixed(0)}, ${PLANET_SIZE}x${PLANET_SIZE} png`;
}

/**
 * Dashboard strip: the area above the dashboard is black space. Each column is scanned from
 * the top until pixels stop being near-black; the contour is smoothed; everything above it
 * becomes transparent with a 2 px soft edge. Dark parts of the dashboard itself stay opaque.
 */
async function dashStrip(src, out) {
  const { data, w, h } = await loadRgba(src);
  const NEAR_BLACK = 22;
  const RUN = 3;   // this many consecutive non-black pixels mark the silhouette
  const isDark = (x, y) => {
    const i = (y * w + x) * 4;
    return Math.max(data[i], data[i + 1], data[i + 2]) < NEAR_BLACK;
  };
  const raw = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let y = 0;
    let run = 0;
    for (; y < h; y++) {
      if (isDark(x, y)) { run = 0; continue; }
      run++;
      if (run >= RUN) { y -= RUN - 1; break; }
    }
    raw[x] = Math.min(y, h);
  }
  // Median (kills single-column spikes from stars or noise), then a light moving average.
  const med = new Float32Array(w);
  const MW = 7;
  for (let x = 0; x < w; x++) {
    const win = [];
    for (let k = -MW; k <= MW; k++) win.push(raw[Math.min(w - 1, Math.max(0, x + k))]);
    med[x] = median(win);
  }
  const contour = new Float32Array(w);
  const AW = 2;
  for (let x = 0; x < w; x++) {
    let s = 0; let c = 0;
    for (let k = -AW; k <= AW; k++) { s += med[Math.min(w - 1, Math.max(0, x + k))]; c++; }
    contour[x] = s / c;
  }
  let topRow = h;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const a = clamp01((y + 0.5 - (contour[x] - 1)) / 2);
      data[(y * w + x) * 4 + 3] = Math.round(a * 255);
    }
    topRow = Math.min(topRow, Math.max(0, Math.floor(contour[x] - 2)));
  }
  if (topRow >= h - 1) throw new Error('no dashboard found');
  const trimmedH = h - topRow;
  const outH = Math.round((trimmedH * DASH_WIDTH) / w);
  await rawImage(data, w, h)
    .extract({ left: 0, top: topRow, width: w, height: trimmedH })
    .resize(DASH_WIDTH, outH, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(out);
  return `trimmed ${topRow} rows, ${DASH_WIDTH}x${outH} png`;
}

/** Plain copy of art-src/voice/<lang>/<storyKey>.(wav|mp3|ogg) to public/assets/voice/<lang>/. */
async function copyVoice() {
  const voiceSrc = path.join(SRC, 'voice');
  if (!existsSync(voiceSrc)) {
    console.log('note: no art-src/voice folder, no voice clips copied');
    return;
  }
  let copied = 0;
  for (const lang of (await readdir(voiceSrc)).sort()) {
    const dir = path.join(voiceSrc, lang);
    if (!(await stat(dir)).isDirectory()) continue;
    for (const file of (await readdir(dir)).sort()) {
      if (!/\.(wav|mp3|ogg)$/i.test(file)) continue;
      const out = path.join(OUT, 'voice', lang, file);
      await ensureDir(out);
      await copyFile(path.join(dir, file), out);
      report(path.join(dir, file), out, 'copy');
      copied++;
    }
  }
  if (copied === 0) console.log('note: art-src/voice has no clips');
}

// ------------------------------------------------------------------ run

for (const n of BACKGROUNDS) await job(n, `bg/${n}.jpg`, background);
await job('dash_strip', 'ui/dash.png', dashStrip);
for (const n of SHIPS) await job(n, `ships/${n}.png`, chromaKey);
for (const n of PLANETS) await job(n, `planets/${n}.png`, planet);
for (const n of PORTRAITS) await job(n, `portraits/${n}.jpg`, squareJpeg(384));
for (const id of ICONS) await job(`icon_${id}`, `icons/${id}.jpg`, squareJpeg(256));
await copyVoice();

// public/assets/manifest.json lists every expected image that exists now, so the game requests
// only files that are there (a missing file is one warning, not a failed request each).
const expected = [
  ...BACKGROUNDS.map((n) => `assets/bg/${n}.jpg`),
  'assets/ui/dash.png',
  ...SHIPS.map((n) => `assets/ships/${n}.png`),
  ...PLANETS.map((n) => `assets/planets/${n}.png`),
  ...PORTRAITS.map((n) => `assets/portraits/${n}.jpg`),
  ...ICONS.map((id) => `assets/icons/${id}.jpg`),
];
const present = expected.filter((f) => existsSync(path.join(ROOT, 'public', f)));
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify({ images: present }, null, 2)}
`);
console.log(`public/assets/manifest.json: ${present.length} of ${expected.length} images`);

console.log(`done: ${written} file(s) written, ${missing.length} source(s) missing` +
  (missing.length ? `: ${missing.join(', ')}` : ''));
