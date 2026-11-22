export type Locale = 'hr' | 'en';
export type SkillId =
  | 'typing' | 'addition' | 'subtraction' | 'multiplication'
  | 'division' | 'negatives' | 'missing' | 'mixed';
export type Op = 'type' | 'add' | 'sub' | 'mul' | 'div';

/** One practisable item. The id is stable forever; it is the key in the save file. */
export interface Fact {
  id: string;            // e.g. "mul:7x8", "add:6+7", "sub:15-8", "div:56/7", "type:42",
                         // "miss:mul:7x?=56", "miss:add:?+7=13"
  planetId: string;
  op: Op;
  a: number;             // left operand (for 'type': the number itself)
  b: number;             // right operand (for 'type': 0)
  result: number;        // value of a op b
  unknown: 'result' | 'a' | 'b';   // which part the player types
  answer: number;        // the number the player must type (may be negative)
}

/** A planet: a small chunk of facts (5..8) where a mission is fought. Never translated. */
export interface PlanetDef {
  id: string;            // "add-10.3", "mul-c.4", "core.1"
  systemId: string;
  sectorId: string;
  name: string;          // generated, e.g. "Velora"
  orbit: number;         // 0-based orbit index inside its system
  angle: number;         // radians, starting position on the orbit
}
/** A star system: a sun with its planets (3..5; a times table has 2). */
export interface SystemDef {
  id: string;            // "add-10.s1"
  sectorId: string;
  name: string;          // generated
  x: number;             // galaxy world position (4800x2700)
  y: number;
  sunHue: number;        // degrees
  planets: PlanetDef[];
}
/** A sector: one fact range of one skill (e.g. addition to 5), a cluster of systems. */
export interface SectorDef {
  id: string;            // "add-5", "mul-c", "core"
  skill: SkillId;
  nameKey: string;       // "meta.sector.<id>"
  hue: number;           // degrees
  order: number;         // 0-based, galaxy order
  x: number;             // centre in the galaxy world
  y: number;
  radius: number;
  systems: SystemDef[];
}

export interface FactStats {
  box: number;           // Leitner box 0..5
  attempts: number;
  correct: number;
  avgMs: number;         // running mean of response time for correct answers
  lastSeen: number;      // epoch ms, 0 = never
  dueAt: number;         // epoch ms
}
