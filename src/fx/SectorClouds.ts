import type Phaser from 'phaser';
import type { SectorDef } from '../core/types';
import { stableHash } from '../core/names';
import { sectorColors } from '../ui/mapPalette';
import { cloudFill, cloudGrid, cloudRim, sectorBlobs } from './cloudField';

/** A baked sector cloud: texture key and where its top-left texel sits in the world. */
export interface BakedCloud { key: string; x0: number; y0: number; cell: number; }

/** World units per texel. The clouds are soft, so a coarse grid scaled up with filtering is enough. */
const CLOUD_CELL = 6;
/** Peak opacity of the fill and of the rim before the mastery factor (kept low: muted, dark map). */
const FILL_ALPHA = 0.36;
const RIM_ALPHA = 0.3;

const baked = new Map<string, BakedCloud>();

/**
 * The sector's cloud texture, baked once per game into a canvas texture (textures outlive
 * scenes, so a restart reuses it). The cloud is drawn at full strength; the scene sets the
 * image alpha from the sector's mastery.
 */
export function bakeSectorCloud(scene: Phaser.Scene, sector: SectorDef): BakedCloud {
  const key = `map-cloud-${sector.id}`;
  const known = baked.get(sector.id);
  if (known && scene.textures.exists(key)) return known;

  const blobs = sectorBlobs(sector, sector.systems, stableHash(`cloud:${sector.id}`));
  const grid = cloudGrid(blobs, CLOUD_CELL);
  const out: BakedCloud = { key, x0: grid.x0, y0: grid.y0, cell: grid.cell };
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, grid.w, grid.h);
  if (!tex) return out;
  const ctx = tex.getContext();
  const img = ctx.createImageData(grid.w, grid.h);
  const { fill, rim } = sectorColors(sector.hue);
  const fr = (fill >> 16) & 255; const fg = (fill >> 8) & 255; const fb = fill & 255;
  const rr = (rim >> 16) & 255; const rg = (rim >> 8) & 255; const rb = rim & 255;
  const data = img.data;
  for (let i = 0; i < grid.field.length; i++) {
    const f = grid.field[i];
    const fa = cloudFill(f) * FILL_ALPHA;
    const ra = cloudRim(f) * RIM_ALPHA * (1 - fa);
    const a = fa + ra;
    const k = i * 4;
    if (a <= 0.002) {
      data[k + 3] = 0;
      continue;
    }
    data[k] = Math.round((fr * fa + rr * ra) / a);
    data[k + 1] = Math.round((fg * fa + rg * ra) / a);
    data[k + 2] = Math.round((fb * fa + rb * ra) / a);
    data[k + 3] = Math.round(Math.min(1, a) * 255);
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  baked.set(sector.id, out);
  return out;
}
