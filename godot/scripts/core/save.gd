class_name Save
## Port of src/core/save.ts. In memory a SaveData is a Dictionary with snake_case keys:
##   {version: 1, locale, credits, modules: {id: tier}, stats: {stat_id: FactStats}, planets: {planet_id: PlanetProgress},
##    settings: {sfx_volume, music_volume, keypad_always_visible, game_speed, density},
##    totals: {missions, wins, best_score: {planet_id: score}}, story: {seen: [skill ids]},
##    location: {sector_id, system_id}}
## The JSON on disk keeps the TS camelCase field names (serialize / migrate convert), so a save file
## is interchangeable with the browser game's localStorage value.

## Sector a new player starts in (addition, not typing).
const START_SECTOR := "add-5"
## Station modules that no longer exist; load_save drops them.
const REMOVED_MODULES: Array[String] = ["reactor"]
## Game-speed setting (BattleConfig.speed_scale): 0.5 and 0.75 slower, 1 normal, 1.25 fast.
const GAME_SPEEDS := [0.5, 0.75, 1, 1.25]
## Density setting (how crowded a battle is).
const DENSITIES := [0.5, 0.75, 1, 1.25]
const SAVE_KEY := "mathdestroyer.save.v1"


## Where saves live: a key/value store of strings (TS StorageAdapter).
class StorageAdapter:
	extends RefCounted

	## The stored text, or null.
	func get_item(_key: String) -> Variant:
		return null

	func set_item(_key: String, _value: String) -> void:
		pass


## In-memory storage (tests, or when user:// cannot be written).
class MemoryStorage:
	extends StorageAdapter
	var items := {}

	func get_item(key: String) -> Variant:
		return items.get(key)

	func set_item(key: String, value: String) -> void:
		items[key] = value


## One file per key under a directory: user://<key>.json.
class FileStorage:
	extends StorageAdapter
	var dir: String

	func _init(p_dir: String = "user://") -> void:
		dir = p_dir

	func path_for(key: String) -> String:
		return dir.path_join(key + ".json")

	func get_item(key: String) -> Variant:
		var path := path_for(key)
		if not FileAccess.file_exists(path):
			return null
		var f := FileAccess.open(path, FileAccess.READ)
		if f == null:
			return null
		return f.get_as_text()

	func set_item(key: String, value: String) -> void:
		var path := path_for(key)
		var tmp := path + ".tmp"
		var f := FileAccess.open(tmp, FileAccess.WRITE)
		if f == null:
			push_warning("[save] could not write %s (%s)" % [path, error_string(FileAccess.get_open_error())])
			return
		f.store_string(value)
		f.close()
		DirAccess.rename_absolute(tmp, path)


## First system of START_SECTOR.
static func default_location() -> Dictionary:
	var sector = Content.sector_by_id(START_SECTOR)
	if sector == null:
		sector = Content.sectors()[0]
	return {"sector_id": sector.id, "system_id": sector.systems[0].id}


## A valid location from any (camelCase, parsed-JSON) value: a known system wins; a known sector
## alone gives its first system; anything else -> default_location().
static func sanitize_location(v: Variant) -> Dictionary:
	if v is Dictionary:
		var system = Content.system_by_id(v.systemId) if v.get("systemId") is String else null
		if system != null:
			return {"sector_id": system.sector_id, "system_id": system.id}
		var sector = Content.sector_by_id(v.sectorId) if v.get("sectorId") is String else null
		if sector != null:
			return {"sector_id": sector.id, "system_id": sector.systems[0].id}
	return default_location()


static func default_save() -> Dictionary:
	return {
		"version": 1,
		"locale": "hr",
		"credits": 0,
		"modules": {},
		"stats": {},
		"planets": {},
		"settings": {"sfx_volume": 0.8, "music_volume": 0.6, "keypad_always_visible": false, "game_speed": 1, "density": 1},
		"totals": {"missions": 0, "wins": 0, "best_score": {}},
		"story": {"seen": []},
		"location": default_location(),
	}


static func _num(v: Variant, fallback: Variant) -> Variant:
	return Js.norm_num(v) if Js.is_finite_num(v) else fallback


static func _bool(v: Variant, fallback: bool) -> bool:
	return v if v is bool else fallback


static func _pick_number(v: Variant, allowed: Array) -> Variant:
	if Js.is_finite_num(v):
		for g in allowed:
			if g == v:
				return g
	return 1


static func _clamp01(v: float) -> Variant:
	return Js.norm_num(minf(1.0, maxf(0.0, v)))


static func _obj(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


static func _number_record(v: Variant) -> Dictionary:
	var out := {}
	if not v is Dictionary:
		return out
	for k in v.keys():
		if Js.is_finite_num(v[k]):
			out[str(k)] = Js.norm_num(v[k])
	return out


## Drops keys that are not current planet ids (old saves used other planet ids).
static func _current_planets_only(scores: Dictionary) -> Dictionary:
	var out := {}
	for k in scores.keys():
		if Content.planet_by_id(k) != null:
			out[k] = scores[k]
	return out


## Distinct strings of an array, in order; anything else -> [].
static func _string_list(v: Variant) -> Array:
	var out: Array = []
	if not v is Array:
		return out
	for x in v:
		if x is String and not out.has(x):
			out.append(x)
	return out


static func _stats_record(v: Variant) -> Dictionary:
	var out := {}
	if not v is Dictionary:
		return out
	for k in v.keys():
		var x = v[k]
		if not x is Dictionary:
			continue
		var e := Mastery.empty_stats()
		out[str(k)] = {
			"box": mini(5, maxi(0, Js.round(_num(x.get("box"), e.box)))),
			"attempts": _num(x.get("attempts"), e.attempts),
			"correct": _num(x.get("correct"), e.correct),
			"avg_ms": _num(x.get("avgMs"), e.avg_ms),
			"last_seen": _num(x.get("lastSeen"), e.last_seen),
			"due_at": _num(x.get("dueAt"), e.due_at),
		}
	return out


## Planet progress of known planets only; level 0..5, finite numbers.
static func _planets_record(v: Variant) -> Dictionary:
	var out := {}
	if not v is Dictionary:
		return out
	for k in v.keys():
		var x = v[k]
		if not x is Dictionary or Content.planet_by_id(str(k)) == null:
			continue
		var e := Mastery.empty_progress()
		out[str(k)] = {
			"level": mini(Mastery.MAX_PLANET_LEVEL, maxi(0, Js.round(_num(x.get("level"), e.level)))),
			"due_at": _num(x.get("dueAt"), e.due_at),
			"wins": maxi(0, Js.round(_num(x.get("wins"), e.wins))),
		}
	return out


## Brings any parsed (camelCase) value to a valid SaveData, keeping every valid field and
## defaulting the rest. Fields of removed features (settings.unlockAll) are ignored.
static func migrate(raw: Variant) -> Dictionary:
	var d := default_save()
	if not raw is Dictionary or not Js.is_finite_num(raw.get("version")) or raw.version != 1:
		return d
	var settings := _obj(raw.get("settings"))
	var totals := _obj(raw.get("totals"))
	var story := _obj(raw.get("story"))
	var modules := _number_record(raw.get("modules"))
	for id in REMOVED_MODULES:
		modules.erase(id)
	var locale = raw.get("locale")
	return {
		"version": 1,
		"locale": locale if (locale is String and (locale == "en" or locale == "hr")) else d.locale,
		"credits": Js.norm_num(maxf(0.0, _num(raw.get("credits"), d.credits))),
		"modules": modules,
		"stats": _stats_record(raw.get("stats")),
		"planets": _planets_record(raw.get("planets")),
		"settings": {
			"sfx_volume": _clamp01(_num(settings.get("sfxVolume"), d.settings.sfx_volume)),
			"music_volume": _clamp01(_num(settings.get("musicVolume"), d.settings.music_volume)),
			"keypad_always_visible": _bool(settings.get("keypadAlwaysVisible"), d.settings.keypad_always_visible),
			"game_speed": _pick_number(settings.get("gameSpeed"), GAME_SPEEDS),
			"density": _pick_number(settings.get("density"), DENSITIES),
		},
		"totals": {
			"missions": _num(totals.get("missions"), 0),
			"wins": _num(totals.get("wins"), 0),
			"best_score": _current_planets_only(_number_record(totals.get("bestScore"))),
		},
		"story": {"seen": _string_list(story.get("seen"))},
		"location": sanitize_location(raw.get("location")),
	}


static func _stats_json(stats: Dictionary) -> Dictionary:
	var out := {}
	for k in stats.keys():
		var s: Dictionary = stats[k]
		out[k] = {"box": s.box, "attempts": s.attempts, "correct": s.correct, "avgMs": s.avg_ms,
			"lastSeen": s.last_seen, "dueAt": s.due_at}
	return out


static func _planets_json(planets: Dictionary) -> Dictionary:
	var out := {}
	for k in planets.keys():
		var p: Dictionary = planets[k]
		out[k] = {"level": p.level, "dueAt": p.due_at, "wins": p.wins}
	return out


## The save as the TS game stores it (camelCase keys, same field order).
static func to_json_data(save: Dictionary) -> Dictionary:
	return {
		"version": save.version,
		"locale": save.locale,
		"credits": save.credits,
		"modules": save.modules,
		"stats": _stats_json(save.stats),
		"planets": _planets_json(save.planets),
		"settings": {
			"sfxVolume": save.settings.sfx_volume, "musicVolume": save.settings.music_volume,
			"keypadAlwaysVisible": save.settings.keypad_always_visible, "gameSpeed": save.settings.game_speed,
			"density": save.settings.density,
		},
		"totals": {"missions": save.totals.missions, "wins": save.totals.wins, "bestScore": save.totals.best_score},
		"story": {"seen": save.story.seen},
		"location": {"sectorId": save.location.sector_id, "systemId": save.location.system_id},
	}


## JSON text like JSON.stringify(save) in the TS game (keys in insertion order, no spaces).
static func serialize(save: Dictionary) -> String:
	return JSON.stringify(_normalize(to_json_data(save)), "", false, true)


## Integral floats -> ints recursively, so numbers print like JS (2, not 2.0).
static func _normalize(v: Variant) -> Variant:
	if v is Dictionary:
		var out := {}
		for k in v.keys():
			out[k] = _normalize(v[k])
		return out
	if v is Array:
		var out: Array = []
		for x in v:
			out.append(_normalize(x))
		return out
	return Js.norm_num(v)


## Parses JSON text quietly; null for bad JSON. Numbers are normalised (integral floats -> ints).
static func parse_json(text: String) -> Variant:
	var json := JSON.new()
	if json.parse(text) != OK:
		return null
	return _normalize(json.data)


## Tolerant: missing data, bad JSON or an unreadable storage -> default_save().
static func load_save(storage: StorageAdapter) -> Dictionary:
	var text = storage.get_item(SAVE_KEY)
	if not text is String:
		return default_save()
	var parsed = parse_json(text)
	return migrate(parsed) if parsed != null else default_save()


static func write_save(storage: StorageAdapter, save: Dictionary) -> void:
	storage.set_item(SAVE_KEY, serialize(save))


## Applies mission results: mastery records (by stat id), planet progress, credits, totals. Pure.
## args = {planet_id, records: Array[AnswerRecord], credits, score, won, accuracy, now}
## AnswerRecord = {fact_id, outcome, response_ms}
static func apply_mission(save: Dictionary, args: Dictionary) -> Dictionary:
	var stats: Dictionary = save.stats.duplicate()
	for r in args.records:
		var prev = stats.get(r.fact_id)
		stats[r.fact_id] = Mastery.apply_outcome(prev if prev != null else Mastery.empty_stats(), r.outcome, r.response_ms, args.now)
	var planets: Dictionary = save.planets.duplicate()
	if Content.planet_by_id(args.planet_id) != null:
		var prev_p = planets.get(args.planet_id)
		planets[args.planet_id] = Mastery.apply_planet_result(prev_p if prev_p != null else Mastery.empty_progress(),
			{"won": args.won, "accuracy": args.accuracy, "now": args.now})
	var prev_best = save.totals.best_score.get(args.planet_id, 0)
	var best: Dictionary = save.totals.best_score.duplicate()
	best[args.planet_id] = Js.norm_num(maxf(prev_best, args.score))
	var out := save.duplicate()
	out.credits = save.credits + args.credits
	out.stats = stats
	out.planets = planets
	out.settings = save.settings.duplicate()
	out.modules = save.modules.duplicate()
	out.story = {"seen": save.story.seen.duplicate()}
	out.location = save.location.duplicate()
	out.totals = {
		"missions": save.totals.missions + 1,
		"wins": save.totals.wins + (1 if args.won else 0),
		"best_score": best,
	}
	return out
