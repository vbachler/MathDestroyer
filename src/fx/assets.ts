import type Phaser from 'phaser';
import { sectorOfPlanet } from '../core/content';
import { stableHash } from '../core/story';
import type { SenderId } from '../core/story';
import type { Locale } from '../core/types';

/**
 * Image assets produced by `npm run art` under public/assets/. Every value is a Phaser
 * texture key. A file that is missing at runtime is skipped with one console warning; check
 * `hasImage(scene, key)` and fall back (procedural texture or plain colour) when it is false.
 */
export const IMG = {
  bg: {
    battleOcean: 'bg_battle_ocean',
    battleDesert: 'bg_battle_desert',
    battleIce: 'bg_battle_ice',
    menu: 'bg_menu',
    starmap: 'bg_starmap',
    bridge: 'bg_bridge',
    ftl: 'bg_ftl',
    station: 'station_shop_bg',
  },
  ui: {
    dash: 'ui_dash',            // 1920 px wide dashboard strip, transparent above the console
  },
  ships: {
    enemyA: 'ship_enemy_a',
    enemyB: 'ship_enemy_b',
    enemyC: 'ship_enemy_c',
    player: 'ship_player',
    station: 'station_orbital',
  },
  /** planet_1 .. planet_8 (index 0..7), 256x256 with transparent corners. */
  planets: ['planet_1', 'planet_2', 'planet_3', 'planet_4', 'planet_5', 'planet_6', 'planet_7', 'planet_8'],
  portraits: {
    tarrow: 'portrait_tarrow',
    kito: 'portrait_kito',
    abacus: 'portrait_abacus',
  } satisfies Record<SenderId, string>,
  /** 256x256 card pictures by upgrade / station module id. */
  icons: {
    slowField: 'icon_slowField',
    autoTurret: 'icon_autoTurret',
    overcharge: 'icon_overcharge',
    salvage: 'icon_salvage',
    repairDrone: 'icon_repairDrone',
    shield: 'icon_shield',
    hull: 'icon_hull',
    targeting: 'icon_targeting',
    headStart: 'icon_headStart',
  },
} as const;

const BATTLE_BGS = [IMG.bg.battleOcean, IMG.bg.battleDesert, IMG.bg.battleIce] as const;
const ENEMY_SHIPS = [IMG.ships.enemyA, IMG.ships.enemyB, IMG.ships.enemyC] as const;

/** Texture key -> URL (relative to the page; vite `base` is './'). */
export const ASSET_URLS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.values(IMG.bg).map((k) => [k, `assets/bg/${k}.jpg`])),
  [IMG.ui.dash]: 'assets/ui/dash.png',
  ...Object.fromEntries(Object.values(IMG.ships).map((k) => [k, `assets/ships/${k}.png`])),
  ...Object.fromEntries(IMG.planets.map((k) => [k, `assets/planets/${k}.png`])),
  ...Object.fromEntries(Object.values(IMG.portraits).map((k) => [k, `assets/portraits/${k}.jpg`])),
  ...Object.fromEntries(Object.entries(IMG.icons).map(([id, k]) => [k, `assets/icons/${id}.jpg`])),
};

/** Written by `npm run art`: the image files that exist under public/assets/. */
export const MANIFEST_URL = 'assets/manifest.json';
const MANIFEST_KEY = 'asset-manifest';

interface AssetManifest { images: string[]; }
const isManifest = (v: unknown): v is AssetManifest =>
  typeof v === 'object' && v !== null && Array.isArray((v as { images?: unknown }).images);

/**
 * Queues the images on the scene's loader (call from preload()). It first loads the manifest
 * written by `npm run art` and then only the images listed there, so missing art costs no
 * failed requests. Missing files never throw: when loading completes, one console warning
 * lists the textures that are unavailable; scenes check `hasImage()` and fall back.
 */
export function preloadAssets(scene: Phaser.Scene): void {
  const urlToKey = new Map(Object.entries(ASSET_URLS).map(([k, url]) => [url, k]));
  scene.load.json(MANIFEST_KEY, MANIFEST_URL);
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (_key: string, _type: string, data: unknown) => {
    if (!isManifest(data)) return;
    for (const url of data.images) {
      const key = urlToKey.get(url);
      if (key && !scene.textures.exists(key)) scene.load.image(key, url);
    }
  });
  scene.load.once('complete', () => {
    const missing = Object.keys(ASSET_URLS).filter((k) => !scene.textures.exists(k));
    if (missing.length > 0) {
      console.warn(`[assets] ${missing.length} image(s) missing, scenes will use fallbacks: ${missing.join(', ')}`);
    }
    scene.cache.json.remove(MANIFEST_KEY);
  });
}

/** True when the texture loaded (false for a missing or broken file). */
export function hasImage(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

/** One of the eight planet pictures, stable for a planet id. */
export function planetImageFor(planetId: string): string {
  return IMG.planets[stableHash(planetId) % IMG.planets.length];
}

/** Battle background for the planet's sector: sector order % 3 (ocean, desert, ice). */
export function battleBgFor(planetId: string): string {
  const order = sectorOfPlanet(planetId)?.order ?? 0;
  return BATTLE_BGS[order % BATTLE_BGS.length];
}

/** Enemy hull by enemy id % 3. */
export function enemyImageFor(enemyId: number): string {
  return ENEMY_SHIPS[((enemyId % ENEMY_SHIPS.length) + ENEMY_SHIPS.length) % ENEMY_SHIPS.length];
}

/** Card picture for an upgrade or station module id (falls back to the shield icon for unknown ids). */
export function iconFor(id: string): string {
  const icons: Readonly<Record<string, string>> = IMG.icons;
  return icons[id] ?? IMG.icons.shield;
}

/** Portrait texture key of a story sender. */
export function portraitFor(sender: SenderId): string {
  return IMG.portraits[sender];
}

/**
 * Candidate URLs of the voice clip for a story message, in fallback order: the locale's
 * .mp3 then .wav, then English. Clips are optional and loaded lazily by the scene that plays
 * them; a clip that fails to load should simply stay silent.
 */
export function voiceUrlFor(storyKey: string, locale: Locale): string[] {
  const langs: Locale[] = locale === 'en' ? ['en'] : [locale, 'en'];
  return langs.flatMap((l) => [`assets/voice/${l}/${storyKey}.mp3`, `assets/voice/${l}/${storyKey}.wav`]);
}
