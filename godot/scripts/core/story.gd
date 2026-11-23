class_name Story
## Port of src/core/story.ts: incoming calls of a sector and the skill intros.
## SenderId = "tarrow" | "kito" | "abacus"; CallKind = "defend" | "liberate" | "patrol".
## Call = {planet_id, kind, story_key, sender, params: {planet: <planet name>}}

## Sender of each skill intro; mirrors story.system.<id>.from in story.json.
const SYSTEM_SENDERS := {
	"typing": "tarrow",
	"addition": "tarrow",
	"subtraction": "kito",
	"multiplication": "tarrow",
	"division": "abacus",
	"negatives": "abacus",
	"missing": "tarrow",
	"mixed": "tarrow",
}
## Sender of ordinary calls; mirrors story.call.from in story.json.
const CALL_SENDER := "abacus"
## Variants per call kind: story.call.<kind>.1..3.
const CALL_VARIANTS := 3


static func stable_hash(text: String) -> int:
	return Names.stable_hash(text)


static func _make_call(planet_id: String, kind: String, save: Dictionary, intro: bool) -> Variant:
	var planet = Content.planet_by_id(planet_id)
	if planet == null:
		push_error("unknown planet %s" % planet_id)
		return null
	var params := {"planet": planet.name}
	var sector = Content.sector_by_id(planet.sector_id)
	var skill = sector.skill if sector != null else null
	if intro and skill != null and not save.story.seen.has(skill):
		return {"planet_id": planet_id, "kind": kind, "story_key": "story.system.%s.text" % skill,
			"sender": SYSTEM_SENDERS[skill], "params": params}
	var variant := 1 + (Names.stable_hash(planet_id) % CALL_VARIANTS)
	return {"planet_id": planet_id, "kind": kind, "story_key": "story.call.%s.%d" % [kind, variant],
		"sender": CALL_SENDER, "params": params}


## defend when under attack, liberate when hostile, else patrol.
static func _kind_of(planet_id: String, save: Dictionary, now: float) -> String:
	if Galaxy.under_attack(planet_id, save, now):
		return "defend"
	return "liberate" if Galaxy.planet_hold(planet_id, save) == "hostile" else "patrol"


## Up to `max_calls` calls for the sector (see story.ts sectorCalls). Unknown sector -> [].
static func sector_calls(sector_id: String, save: Dictionary, now: float, max_calls: int) -> Array:
	var planets: Array = []
	var order := 0
	for p in Content.planets_of_sector(sector_id):
		planets.append({"id": p.id, "order": order})
		order += 1
	var picked: Array = []

	var attacked: Array = []
	for p in planets:
		if Galaxy.under_attack(p.id, save, now):
			attacked.append({"id": p.id, "order": p.order, "due_at": Mastery.planet_progress(save, p.id).due_at})
	for p in Js.sorted(attacked, func(a, b): return (a.due_at - b.due_at) if a.due_at != b.due_at else (a.order - b.order)):
		picked.append({"id": p.id, "kind": "defend"})

	var taken := func(id: String) -> bool:
		for c in picked:
			if c.id == id:
				return true
		return false
	for p in planets:
		if not taken.call(p.id) and Galaxy.planet_hold(p.id, save) == "hostile":
			picked.append({"id": p.id, "kind": "liberate"})
			break

	var patrol: Array = []
	for p in planets:
		if not taken.call(p.id) and Galaxy.planet_hold(p.id, save) != "hostile":
			patrol.append({"id": p.id, "order": p.order, "m": Mastery.planet_mastery(p.id, save)})
	patrol = Js.sorted(patrol, func(a, b): return (a.m - b.m) if a.m != b.m else (a.order - b.order))
	if not patrol.is_empty():
		picked.append({"id": patrol[0].id, "kind": "patrol"})

	var out: Array = []
	var n := mini(picked.size(), maxi(0, max_calls))
	for i in n:
		out.append(_make_call(picked[i].id, picked[i].kind, save, i == 0))
	return out


## A call for one specific planet (defend / liberate / patrol); carries the skill intro while
## the skill is unseen. Unknown planet id: error and null (TS throws).
static func call_for(planet_id: String, save: Dictionary, now: float) -> Variant:
	return _make_call(planet_id, _kind_of(planet_id, save, now), save, true)


## Records that the intro of `skill_id` has been shown. Returns a new SaveData (the same one if seen).
static func mark_seen(save: Dictionary, skill_id: String) -> Dictionary:
	if save.story.seen.has(skill_id):
		return save
	var out := save.duplicate()
	var seen: Array = save.story.seen.duplicate()
	seen.append(skill_id)
	out.story = {"seen": seen}
	return out
