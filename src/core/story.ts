import { planetById, planetsOfSector, sectorById } from './content';
import { planetHold, underAttack } from './galaxy';
import { dueFacts, planetMastery } from './mastery';
import { stableHash } from './names';
import type { SaveData } from './save';
import type { SkillId } from './types';

export { stableHash } from './names';

/** Story senders; `story.sender.<id>` holds the display name. */
export type SenderId = 'tarrow' | 'kito' | 'abacus';

/** Sender of each skill intro; mirrors `story.system.<id>.from` in story.json (a test checks this). */
export const SYSTEM_SENDERS: Record<SkillId, SenderId> = {
  typing: 'tarrow',
  addition: 'tarrow',
  subtraction: 'kito',
  multiplication: 'tarrow',
  division: 'abacus',
  negatives: 'abacus',
  missing: 'tarrow',
  mixed: 'tarrow',
};

/** Sender of ordinary calls; mirrors `story.call.from` in story.json (a test checks this). */
export const CALL_SENDER: SenderId = 'abacus';
/** Variants per call kind: `story.call.<kind>.1..3`. */
export const CALL_VARIANTS = 3;

export type CallKind = 'defend' | 'liberate' | 'patrol';

export interface Call {
  planetId: string;
  kind: CallKind;
  storyKey: string;                  // i18n key of the message (in story.json)
  sender: SenderId;
  params: Record<string, string>;    // i18n params of the message: { planet: <planet name> }
}

function makeCall(planetId: string, kind: CallKind, save: SaveData, intro: boolean): Call {
  const planet = planetById(planetId);
  if (!planet) throw new Error(`unknown planet ${planetId}`);
  const params = { planet: planet.name };
  const skill = sectorById(planet.sectorId)?.skill;
  if (intro && skill && !save.story.seen.includes(skill)) {
    return { planetId, kind, storyKey: `story.system.${skill}.text`, sender: SYSTEM_SENDERS[skill], params };
  }
  const variant = 1 + (stableHash(planetId) % CALL_VARIANTS);
  return { planetId, kind, storyKey: `story.call.${kind}.${variant}`, sender: CALL_SENDER, params };
}

/** defend when under attack, liberate when hostile, else patrol. */
function kindOf(planetId: string, save: SaveData, now: number): CallKind {
  if (underAttack(planetId, save.stats, now)) return 'defend';
  return planetHold(planetId, save.stats) === 'hostile' ? 'liberate' : 'patrol';
}

/**
 * Up to `max` calls for the sector the player is in: every planet under attack (defend, most
 * due facts first), then the next hostile planet in sector order (liberate), then the weakest
 * non-hostile planet not called yet (patrol). Ties keep sector order. While the sector's skill
 * is not in `save.story.seen`, the first call carries that skill's intro
 * (`story.system.<skill>.text`, its own sender) instead of its usual line.
 * Unknown sector -> [].
 */
export function sectorCalls(sectorId: string, save: SaveData, now: number, max: number): Call[] {
  const planets = planetsOfSector(sectorId).map((p, order) => ({ id: p.id, order }));
  const stats = save.stats;
  const picked: Array<{ id: string; kind: CallKind }> = [];

  planets
    .filter((p) => underAttack(p.id, stats, now))
    .map((p) => ({ ...p, due: dueFacts(p.id, stats, now).length }))
    .sort((a, b) => b.due - a.due || a.order - b.order)
    .forEach((p) => picked.push({ id: p.id, kind: 'defend' }));

  const taken = (id: string): boolean => picked.some((c) => c.id === id);
  const hostile = planets.find((p) => !taken(p.id) && planetHold(p.id, stats) === 'hostile');
  if (hostile) picked.push({ id: hostile.id, kind: 'liberate' });

  const patrol = planets
    .filter((p) => !taken(p.id) && planetHold(p.id, stats) !== 'hostile')
    .map((p) => ({ ...p, m: planetMastery(p.id, stats) }))
    .sort((a, b) => a.m - b.m || a.order - b.order)[0];
  if (patrol) picked.push({ id: patrol.id, kind: 'patrol' });

  return picked.slice(0, Math.max(0, max)).map((c, i) => makeCall(c.id, c.kind, save, i === 0));
}

/** A call for one specific planet (used when the player clicks a planet): defend if under
 *  attack, liberate if hostile, else patrol; carries the skill intro while the skill is unseen.
 *  Throws for an unknown planet id. */
export function callFor(planetId: string, save: SaveData, now: number): Call {
  return makeCall(planetId, kindOf(planetId, save, now), save, true);
}

/** Records that the intro of `skillId` has been shown. Returns a new SaveData (the same one if already seen). */
export function markSeen(save: SaveData, skillId: SkillId): SaveData {
  if (save.story.seen.includes(skillId)) return save;
  return { ...save, story: { seen: [...save.story.seen, skillId] } };
}
