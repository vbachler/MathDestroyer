class_name Galaxy
## Port of src/core/galaxy.ts: territory from planet progress. Layout constants live in Layout
## (TS re-exports them here; use Layout.WORLD_W etc.). Hold = "hostile" | "contested" | "secured".

## Lowest planet level that counts as secured (levels 1..2 are contested, 0 hostile).
const SECURED_LEVEL := 3

const WORLD_W := Layout.WORLD_W
const WORLD_H := Layout.WORLD_H
const WORLD_MARGIN := Layout.WORLD_MARGIN
const MIN_SYSTEM_SPACING := Layout.MIN_SYSTEM_SPACING
const MAX_SECTOR_OVERLAP := Layout.MAX_SECTOR_OVERLAP
const SKILL_HUE := Layout.SKILL_HUE


## Level 0 hostile (held by the Static), 1..2 contested, 3+ secured.
static func planet_hold(planet_id: String, save: Dictionary) -> String:
	var level: int = Mastery.planet_progress(save, planet_id).level
	if level == 0:
		return "hostile"
	return "contested" if level < SECURED_LEVEL else "secured"


## A planet is under attack when its level is >= 1 and it is due (now >= due_at).
static func under_attack(planet_id: String, save: Dictionary, now: float) -> bool:
	var p := Mastery.planet_progress(save, planet_id)
	return p.level >= 1 and now >= p.due_at


static func _mean_mastery(planets: Array, save: Dictionary) -> float:
	if planets.is_empty():
		return 0.0
	var levels := 0.0
	for p in planets:
		levels += Mastery.planet_mastery(p.id, save) * Mastery.MAX_PLANET_LEVEL
	return levels / (Mastery.MAX_PLANET_LEVEL * planets.size())


## Mean planet mastery over the system's planets (0 for an unknown id).
static func system_mastery(system_id: String, save: Dictionary) -> float:
	var sys = Content.system_by_id(system_id)
	return _mean_mastery(sys.planets if sys != null else [], save)


## Mean planet mastery over the sector's planets (0 for an unknown id).
static func sector_mastery(sector_id: String, save: Dictionary) -> float:
	return _mean_mastery(Content.planets_of_sector(sector_id), save)


static func disc_overlap(a: Dictionary, b: Dictionary) -> float:
	return Layout.disc_overlap(a, b)


static func hue_distance(a: float, b: float) -> float:
	return Layout.hue_distance(a, b)


static func sector_radius(system_count: int) -> int:
	return Layout.sector_radius(system_count)
