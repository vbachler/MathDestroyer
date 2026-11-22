import { createRng } from './rng';
import type { Rng } from './rng';

/**
 * Seeded syllable name generator for star systems and planets. Names are pronounceable
 * (consonant-vowel syllables, a few soft codas), 2..3 syllables, capitalised, never translated.
 * Stability comes from the seed: the same id gives the same name on every run.
 */

const ONSETS = [
  'b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z',
  'br', 'dr', 'kr', 'tr', 'st', 'sk', 'th', 'vr', 'gl', 'pl',
];
/** Single consonants allowed right after a syllable that ends in a consonant. */
const SOFT_ONSETS = ['d', 'k', 'l', 'm', 'n', 'r', 's', 't', 'v'];
const VOWELS = ['a', 'e', 'i', 'o', 'u'];
/** Rarer vowels; at most one of them per name. */
const RARE_VOWELS = ['ai', 'ei', 'ia', 'y'];
const MID_CODAS = ['n', 'r', 'l', 's', 'm'];
const END_CODAS = ['n', 'r', 'l', 's', 'th', 'x', 'm'];

/**
 * Lower-case names (and stems) that belong to well-known fiction or to real stars; a generated
 * name that equals or starts with one of these is rejected. Not exhaustive, a safety net.
 */
const BLOCKED = [
  'vulkan', 'vulcan', 'tatooin', 'naboo', 'endor', 'hoth', 'dagob', 'alder', 'coruscant', 'kamino',
  'mustaf', 'arrakis', 'dune', 'kobol', 'caprica', 'krypton', 'gallifrey', 'skaro', 'trant',
  'terminus', 'solaris', 'pandora', 'reach', 'harvest', 'tuchanka', 'palaven', 'thessia',
  'rannoch', 'eden', 'ziost', 'korriban', 'romul', 'kronos', 'bajor', 'cardass', 'ferenginar',
  'risa', 'betazed', 'andor', 'tellar', 'qonos', 'vega', 'rigel', 'sirius', 'altair', 'deneb',
  'betel', 'antares', 'arcturus', 'polaris', 'castor', 'pollux', 'mira', 'algol', 'spica',
  'capella', 'aldebar', 'procyon', 'canopus', 'achernar', 'hadar', 'acrux', 'mimosa', 'shaula',
  'bellatrix', 'elnath', 'alnilam', 'alnitak', 'mintaka', 'saiph', 'regulus', 'fomalhaut',
  'thuban', 'mizar', 'alcor', 'dubhe', 'merak', 'kochab', 'tauri', 'cygni', 'ceti', 'eridani',
  'lyra', 'sol', 'terra', 'luna', 'mars', 'venus', 'titan', 'europa', 'ganymed', 'callisto',
  'io', 'triton', 'pluto', 'ceres', 'vesta', 'pallas', 'juno', 'hygiea', 'sedna', 'eris',
  'kepler', 'gliese', 'trappist', 'proxima', 'barnard', 'wolf', 'ross', 'lalande', 'luyten',
  'leda', 'dione', 'rhea', 'tethys', 'mimas', 'thebe', 'metis', 'nereid', 'naiad', 'despina',
  'oberon', 'ariel', 'miranda', 'umbriel', 'puck', 'phobos', 'deimos', 'charon', 'nix', 'hydra',
  'kerberos', 'styx', 'thomas', 'lego', 'also', 'live', 'love', 'gore', 'dole', 'pure', 'bure',
  'more', 'mora', 'kosa', 'lisa', 'mama', 'tata', 'baba', 'deda', 'meridian', 'tarel', 'velkar', 'sefira',
];

/** Words that must not appear anywhere inside a name (rude or silly in hr/en). */
const BLOCKED_INSIDE = ['kurac', 'pizd', 'sran', 'jeb', 'fuk', 'fuck', 'shit', 'dick', 'ass', 'kak', 'pis', 'sex'];

function syllables(rng: Rng): string[] {
  const count = rng.next() < 0.6 ? 2 : 3;
  const out: string[] = [];
  let endsInConsonant = false;
  let rareUsed = false;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    // The first syllable may start with a vowel now and then.
    const vowelStart = i === 0 && rng.next() < 0.12;
    const onset = vowelStart ? '' : rng.pick(endsInConsonant ? SOFT_ONSETS : ONSETS);
    let vowel = rng.pick(VOWELS);
    if (!rareUsed && !vowelStart && rng.next() < 0.15) {
      vowel = rng.pick(RARE_VOWELS);
      rareUsed = true;
    }
    const coda = rng.next() < (last ? 0.55 : 0.25) ? rng.pick(last ? END_CODAS : MID_CODAS) : '';
    out.push(onset + vowel + coda);
    endsInConsonant = coda !== '';
  }
  return out;
}

function acceptable(parts: string[]): boolean {
  const lower = parts.join('');
  if (lower.length < 4 || lower.length > 9) return false;
  if (new Set(parts).size < parts.length) return false;     // no repeated syllable
  if (/(.)\1\1/.test(lower)) return false;                  // no triple letters
  if (/[aeiouy]{3}/.test(lower)) return false;              // no vowel pile-ups
  if (BLOCKED.some((b) => lower.startsWith(b) || lower === b)) return false;
  if (BLOCKED_INSIDE.some((b) => lower.includes(b))) return false;
  return true;
}

/** One name from a numeric seed (2..3 syllables, capitalised), or null if it was rejected. */
export function nameFromSeed(seed: number): string | null {
  const parts = syllables(createRng(seed));
  if (!acceptable(parts)) return null;
  const lower = parts.join('');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Stable, platform-independent string hash (FNV-1a, 32 bit). */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Hands out names that are unique within one registry. The name for an id depends only on the
 * id and on the names already taken, so a registry filled in a fixed order is stable.
 */
export function createNameRegistry(): { nameFor(id: string): string; taken: ReadonlySet<string> } {
  const taken = new Set<string>();
  return {
    taken,
    nameFor(id: string): string {
      for (let attempt = 0; ; attempt++) {
        const name = nameFromSeed(stableHash(`${id}#${attempt}`));
        if (name && !taken.has(name)) {
          taken.add(name);
          return name;
        }
      }
    },
  };
}
