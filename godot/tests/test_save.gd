extends TestCase
## Port of tests/save.test.ts


## A storage whose every access fails (TS: getItem / setItem throw).
class ThrowingStorage:
	extends Save.StorageAdapter

	func get_item(_key: String) -> Variant:
		push_error("denied")
		return null

	func set_item(_key: String, _value: String) -> void:
		push_error("denied")


func _memory(initial: Variant = null) -> Save.MemoryStorage:
	var m := Save.MemoryStorage.new()
	if initial != null:
		m.items[Save.SAVE_KEY] = initial
	return m


## JSON.stringify like the TS game (full precision, integral numbers without ".0").
static func _js(v: Variant) -> String:
	return JSON.stringify(Save._normalize(v), "", false, true)


## { ...d, ...over } (shallow).
static func _with(d: Dictionary, over: Dictionary) -> Dictionary:
	var out := d.duplicate()
	out.merge(over, true)
	return out


## The default save as the TS game sees it (camelCase JSON data), for building "old" saves.
static func _default_json() -> Dictionary:
	return Save.to_json_data(Save.default_save()).duplicate(true)


static func _matches(actual: Variant, expected: Variant) -> bool:
	if expected is Dictionary:
		if not actual is Dictionary:
			return false
		for k in expected.keys():
			if not actual.has(k) or not _matches(actual[k], expected[k]):
				return false
		return true
	return deep_eq(actual, expected)


func match_obj(actual: Variant, expected: Variant, msg: String = "") -> bool:
	if _matches(actual, expected):
		return true
	fail("%sexpected %s to match %s" % [msg + ": " if msg != "" else "", show(actual), show(expected)])
	return false


func test_default_save_is_croatian_empty_and_version_1() -> void:
	var s := Save.default_save()
	eq(s.version, 1)
	eq(s.locale, "hr")
	eq(s.credits, 0)
	eq(s.stats, {})
	eq(s.planets, {})
	no(s.settings.has("unlock_all"))
	eq(s.location, {"sector_id": "add-5", "system_id": "add-5.s1"})
	eq(s.settings.game_speed, 1)
	eq(s.totals, {"missions": 0, "wins": 0, "best_score": {}})
	eq(s.story, {"seen": []})
	no(is_same(Save.default_save(), Save.default_save()))


func test_load_save_returns_defaults_for_missing_corrupt_wrong_shapes_and_throwing_storage() -> void:
	eq(Save.load_save(_memory()), Save.default_save())
	eq(Save.load_save(_memory("{not json")), Save.default_save())
	eq(Save.load_save(_memory("null")), Save.default_save())
	eq(Save.load_save(_memory("[1,2]")), Save.default_save())
	eq(Save.load_save(_memory("{\"version\":2}")), Save.default_save())
	# The storage itself reports the failure; load_save must still return the defaults.
	var throwing := ThrowingStorage.new()
	eq(errors(func(): return Save.load_save(throwing)), Save.default_save())


func test_write_save_and_load_save_round_trip() -> void:
	var store := _memory()
	var s := _with(Save.default_save(), {"locale": "en", "credits": 42,
		"stats": {"mul:7x8": stat(3), "cat:add-100:carry": stat(2)},
		"planets": {"mul-c.2": progress(3), Content.CORE_PLANET_ID: progress(1, {"wins": 4})}})
	Save.write_save(store, s)
	ok(store.items.has(Save.SAVE_KEY))
	eq(Save.load_save(store), s)


func test_migrate_keeps_valid_fields_and_repairs_invalid_ones() -> void:
	var m := Save.migrate({
		"version": 1,
		"locale": "de",
		"credits": "lots",
		"modules": {"hull": 2, "bad": "x"},
		"stats": {"mul:7x8": {"box": 9, "attempts": 2}, "junk": 5},
		"settings": {"sfxVolume": 3, "unlockAll": true},
	})
	eq(m.locale, "hr")
	eq(m.credits, 0)
	eq(m.modules, {"hull": 2})
	eq(m.stats, {"mul:7x8": {"box": 5, "attempts": 2, "correct": 0, "avg_ms": 0, "last_seen": 0, "due_at": 0}})
	eq(m.settings, {"sfx_volume": 1, "music_volume": 0.6, "keypad_always_visible": false, "game_speed": 1, "density": 1})
	eq(m.totals, {"missions": 0, "wins": 0, "best_score": {}})
	eq(m.planets, {})


func test_planets_old_saves_without_the_key_load_as_empty_unknown_planets_dropped_values_repaired() -> void:
	var old := _default_json()
	old.stats = Save.to_json_data(_with(Save.default_save(), {"stats": {"mul:7x8": stat(3)}})).stats
	old.erase("planets")
	var loaded := Save.load_save(_memory(_js(old)))
	eq(loaded.planets, {})
	eq(loaded.stats, {"mul:7x8": stat(3)})
	var m := Save.migrate({"version": 1, "planets": {
		"add-10.1": {"level": 9, "dueAt": 5, "wins": 2},
		"add-10.2": {"level": 2.4, "dueAt": "x", "wins": -3},
		"add-10.3": {"level": -1},
		"mul-7": {"level": 3, "dueAt": 1, "wins": 1},
		"add-10.4": "bad",
	}})
	eq(m.planets, {
		"add-10.1": {"level": 5, "due_at": 5, "wins": 2},
		"add-10.2": {"level": 2, "due_at": 0, "wins": 0},
		"add-10.3": {"level": 0, "due_at": 0, "wins": 0},
	})
	for bad in [null, "x", [1, 2]]:
		eq(Save.migrate({"version": 1, "planets": bad}).planets, {}, str(bad))


func test_game_speed_filled_for_older_saves_valid_values_kept_others_reset_to_1() -> void:
	var old := _default_json()
	old.settings = {"sfxVolume": 0.5, "musicVolume": 0.5, "unlockAll": false, "keypadAlwaysVisible": true}
	var loaded := Save.load_save(_memory(_js(old)))
	eq(loaded.settings.game_speed, 1)
	eq(loaded.settings.keypad_always_visible, true)
	eq(Save.GAME_SPEEDS, [0.5, 0.75, 1, 1.25])
	for v in Save.GAME_SPEEDS:
		eq(Save.migrate({"version": 1, "settings": {"gameSpeed": v}}).settings.game_speed, v)
	for v in [0.25, 0.6, 2, "1", null, NAN]:
		eq(Save.migrate({"version": 1, "settings": {"gameSpeed": v}}).settings.game_speed, 1, str(v))
	var store := _memory()
	var d := Save.default_save()
	Save.write_save(store, _with(d, {"settings": _with(d.settings, {"game_speed": 0.5})}))
	eq(Save.load_save(store).settings.game_speed, 0.5)


func test_density_default_1_filled_for_older_saves_valid_values_kept_others_reset_to_1() -> void:
	eq(Save.DENSITIES, [0.5, 0.75, 1, 1.25])
	eq(Save.default_save().settings.density, 1)
	var old := _default_json()
	old.settings = {"sfxVolume": 0.5, "musicVolume": 0.5, "keypadAlwaysVisible": true, "gameSpeed": 0.75}
	var loaded := Save.load_save(_memory(_js(old)))
	eq(loaded.settings.density, 1)
	eq(loaded.settings.game_speed, 0.75)
	for v in Save.DENSITIES:
		eq(Save.migrate({"version": 1, "settings": {"density": v}}).settings.density, v)
	for v in [0, 0.25, 1.5, -1, "0.5", null, NAN, INF, {}]:
		eq(Save.migrate({"version": 1, "settings": {"density": v}}).settings.density, 1, str(v))
	# density: undefined (key absent)
	eq(Save.migrate({"version": 1, "settings": {}}).settings.density, 1, "undefined")
	var store := _memory()
	var d := Save.default_save()
	Save.write_save(store, _with(d, {"settings": _with(d.settings, {"density": 0.5, "game_speed": 1.25})}))
	match_obj(Save.load_save(store).settings, {"density": 0.5, "game_speed": 1.25})


func test_drops_the_removed_reactor_module_from_older_saves_and_keeps_the_others() -> void:
	var old := _default_json()
	old.modules = {"hull": 1, "reactor": 3, "targeting": 2}
	eq(Save.load_save(_memory(_js(old))).modules, {"hull": 1, "targeting": 2})


func test_story_seen_filled_for_older_saves_keeps_distinct_strings_repairs_bad_shapes() -> void:
	var old := _default_json()
	old.erase("story")
	eq(Save.load_save(_memory(_js(old))).story, {"seen": []})
	eq(Save.migrate({"version": 1, "story": {"seen": ["typing", "typing", 3, null, "addition"]}}).story,
		{"seen": ["typing", "addition"]})
	for bad in [null, "x", [], {"seen": "typing"}]:
		eq(Save.migrate({"version": 1, "story": bad}).story, {"seen": []}, str(bad))
	var store := _memory()
	Save.write_save(store, _with(Save.default_save(), {"story": {"seen": ["typing"]}}))
	eq(Save.load_save(store).story.seen, ["typing"])


func test_apply_mission_applies_records_credits_and_totals_without_mutating_the_input() -> void:
	var save := _with(Save.default_save(), {"credits": 10, "stats": {"mul:7x8": stat(2)}})
	var frozen := _js(save)
	var after := Save.apply_mission(save, {
		"planet_id": "mul-c.4",
		"accuracy": 0.9,
		"records": [
			{"fact_id": "mul:7x8", "outcome": "fast", "response_ms": 1500},
			{"fact_id": "mul:7x9", "outcome": "wrong", "response_ms": 4000},
			{"fact_id": "mul:7x9", "outcome": "slow", "response_ms": 6000},
			{"fact_id": "mul:7x3", "outcome": "missed", "response_ms": 9000},
		],
		"credits": 55,
		"score": 300,
		"won": true,
		"now": NOW,
	})
	eq(_js(save), frozen)
	eq(after.credits, 65)
	# stat(2) is not due yet, so a fast answer does not promote it
	eq(after.stats["mul:7x8"].box, 2)
	eq(after.stats["mul:7x8"].due_at, save.stats["mul:7x8"].due_at)
	match_obj(after.stats["mul:7x9"], {"box": 1, "attempts": 2, "correct": 1, "avg_ms": 6000})
	eq(after.stats["mul:7x9"].due_at, NOW + Mastery.BOX_INTERVAL_MS[1])
	match_obj(after.stats["mul:7x3"], {"box": 0, "attempts": 1, "correct": 0})
	eq(after.totals, {"missions": 1, "wins": 1, "best_score": {"mul-c.4": 300}})
	eq(after.planets, {"mul-c.4": {"level": 2, "due_at": NOW + Mastery.PLANET_INTERVAL_MS[1], "wins": 1}})
	eq(save.planets, {})
	eq(after.location, save.location)
	no(is_same(after.location, save.location))
	eq(after.story, save.story)
	no(is_same(after.story, save.story))

	var again := Save.apply_mission(after, {"planet_id": "mul-c.4", "records": [], "credits": 0, "score": 100, "won": false,
		"accuracy": 1, "now": NOW})
	eq(again.totals, {"missions": 2, "wins": 1, "best_score": {"mul-c.4": 300}})
	eq(again.planets["mul-c.4"], {"level": 1, "due_at": NOW, "wins": 1})


func test_apply_mission_planet_progress_by_accuracy_and_due_state_generated_records_by_category() -> void:
	var pid: String = planet_ids("add-100")[2]
	var base := _with(Save.default_save(), {"planets": {pid: progress(2, {"due_at": NOW, "wins": 2})}})
	var run := func(won: bool, accuracy: float, save: Dictionary) -> Dictionary:
		return Save.apply_mission(save, {"planet_id": pid,
			"records": [{"fact_id": "cat:add-100:carry", "outcome": "fast", "response_ms": 2000}],
			"credits": 0, "score": 0, "won": won, "accuracy": accuracy, "now": NOW})
	eq(run.call(true, 0.8, base).planets[pid], {"level": 3, "due_at": NOW + Mastery.PLANET_INTERVAL_MS[3], "wins": 3})
	eq(run.call(true, 0.79, base).planets[pid], {"level": 2, "due_at": NOW, "wins": 3})
	eq(run.call(false, 1, base).planets[pid], {"level": 1, "due_at": NOW, "wins": 2})
	var not_due := _with(base, {"planets": {pid: progress(2, {"due_at": NOW + 1, "wins": 2})}})
	eq(run.call(true, 1, not_due).planets[pid], {"level": 2, "due_at": NOW + 1, "wins": 3})
	match_obj(run.call(true, 1, base).stats["cat:add-100:carry"], {"box": 1, "attempts": 1, "correct": 1})
	# An unknown planet id changes no progress.
	eq(Save.apply_mission(base, {"planet_id": "nope", "records": [], "credits": 0, "score": 0, "won": true, "accuracy": 1,
		"now": NOW}).planets, base.planets)


func test_location_default_kept_when_valid_repaired_when_unknown_or_inconsistent() -> void:
	eq(Save.default_location(), {"sector_id": "add-5", "system_id": "add-5.s1"})
	# An existing save keeps its stored location, typing sector included.
	eq(Save.migrate({"version": 1, "location": {"sectorId": "type-1", "systemId": "type-1.s1"}}).location,
		{"sector_id": "type-1", "system_id": "type-1.s1"})
	var sys: Dictionary = Content.sectors()[5].systems[1]
	eq(Save.migrate({"version": 1, "location": {"sectorId": sys.sector_id, "systemId": sys.id}}).location,
		{"sector_id": sys.sector_id, "system_id": sys.id})
	# A known system wins over a wrong sector; a known sector alone gives its first system.
	eq(Save.migrate({"version": 1, "location": {"sectorId": "type-1", "systemId": sys.id}}).location,
		{"sector_id": sys.sector_id, "system_id": sys.id})
	eq(Save.migrate({"version": 1, "location": {"sectorId": "mul-b", "systemId": "nope"}}).location,
		{"sector_id": "mul-b", "system_id": "mul-b.s1"})
	var removed := [{"sectorId": "add-20", "systemId": "add-20.s1"}, {"sectorId": "sub-20", "systemId": "sub-20.s3"}]
	eq(Save.migrate({"version": 1}).location, Save.default_location(), "undefined")
	for bad in [null, "x", {"sectorId": "mul-7", "systemId": "multiplication"}, {"sectorId": 3}] + removed:
		eq(Save.migrate({"version": 1, "location": bad}).location, Save.default_location(), str(bad))
	var store := _memory()
	Save.write_save(store, _with(Save.default_save(), {"location": {"sector_id": sys.sector_id, "system_id": sys.id}}))
	eq(Save.load_save(store).location.system_id, sys.id)


func test_old_saves_unlock_all_ignored_best_score_keys_not_planet_ids_dropped_stats_kept() -> void:
	var planet: String = Content.planets()[3].id
	var old := {
		"version": 1,
		"settings": {"sfxVolume": 0.5, "musicVolume": 0.5, "unlockAll": true, "keypadAlwaysVisible": false, "gameSpeed": 1},
		"stats": {"mul:7x8": {"box": 3, "attempts": 4, "correct": 3, "avgMs": 2000, "lastSeen": 1, "dueAt": 2}},
		"totals": {"missions": 3, "wins": 2, "bestScore": {"mul-7": 120, "mix-1": 80, planet: 50}},
	}
	var loaded := Save.load_save(_memory(_js(old)))
	eq(loaded.settings, {"sfx_volume": 0.5, "music_volume": 0.5, "keypad_always_visible": false, "game_speed": 1, "density": 1})
	eq(loaded.totals.best_score, {planet: 50})
	eq(loaded.stats["mul:7x8"].box, 3)
	eq(loaded.location, Save.default_location())


func test_stats_for_fact_ids_that_no_longer_exist_are_harmless_everywhere() -> void:
	# Ids no sector holds any more (0 + 0, operands below the ranges, old samples of sectors that are generated now).
	var gone := {"add:0+0": stat(5), "add:86+3": stat(2, {"due_at": NOW - 1}), "sub:21-2": stat(1, {"due_at": NOW - 1}),
		"sub:100-2": stat(3, {"due_at": NOW - 1}), "sub:0-0": stat(0, {"due_at": NOW - 1}), "miss:add:?+7=13": stat(4)}
	var raw := _default_json()
	raw.stats = Save.to_json_data(_with(Save.default_save(), {"stats": gone})).stats
	var save := Save.load_save(_memory(_js(raw)))
	var got: Array = save.stats.keys()
	got.sort()
	var want := gone.keys()
	want.sort()
	eq(got, want)
	for sector in Content.sectors():
		eq(Galaxy.sector_mastery(sector.id, save), 0, sector.id)
		eq(Mastery.sector_knowledge(sector.id, save.stats), 0, sector.id)
		gt(Story.sector_calls(sector.id, save, NOW, 3).size(), 0, sector.id)
	for p in Content.planets():
		eq(Mastery.planet_mastery(p.id, save), 0, p.id)
		eq(Galaxy.planet_hold(p.id, save), "hostile", p.id)
		eq(Galaxy.under_attack(p.id, save, NOW), false, p.id)
		var call = Story.call_for(p.id, save, NOW)
		eq(call.planet_id if call != null else null, p.id)
	# Nothing counts as played: the core falls back to the digits.
	eq(Scheduler.mission_sectors(Content.CORE_PLANET_ID, save), ["type-1"])
	var q := Scheduler.create_mission_scheduler({"planet_id": planet_ids("add-5")[0], "stats": save.stats, "planets": save.planets,
		"now": NOW, "rng": Rng.new(1)}).wave(0, 10)
	eq(q.size(), 10)
	ok(q.all(func(f): return not gone.has(f.id)))
	var after := Save.apply_mission(save, {"planet_id": planet_ids("add-5")[0], "credits": 0, "score": 0, "won": false,
		"accuracy": 1, "now": NOW, "records": [{"fact_id": "add:86+3", "outcome": "fast", "response_ms": 900}]})
	eq(after.stats["add:86+3"].attempts, 4)
