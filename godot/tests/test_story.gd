extends TestCase
## Port of tests/story.test.ts


static func _read_json(path: String) -> Dictionary:
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}


## story.json of both locales.
static func _dicts() -> Dictionary:
	return {"hr": _read_json("res://locales/hr/story.json"), "en": _read_json("res://locales/en/story.json")}


## A save where every skill intro has been seen.
static func _seen_all(planets: Dictionary = {}) -> Dictionary:
	var s := Save.default_save()
	for k in Content.skills():
		s = Story.mark_seen(s, k)
	var out := s.duplicate()
	out.planets = planets
	return out


static func _P() -> Array:
	return planet_ids("sub-15")


## Every planet of P at one level, not due.
static func _all(level: int) -> Dictionary:
	var out := {}
	for id in _P():
		out[id] = progress(level)
	return out


static func _pk(calls: Array) -> Array:
	return calls.map(func(c): return [c.planet_id, c.kind])


# ---------------------------------------------------------------- sectorCalls

func test_fresh_sector_liberate_the_first_planet_then_patrol_nothing() -> void:
	var P := _P()
	var calls := Story.sector_calls("sub-15", _seen_all(), NOW, 3)
	eq(_pk(calls), [[P[0], "liberate"]])


func test_defend_longest_overdue_first_then_the_next_hostile_planet_then_the_weakest_non_hostile() -> void:
	var P := _P()
	var planets := {}
	for id in P.slice(0, 6):
		planets[id] = progress(4)
	planets[P[1]] = progress(3, {"due_at": NOW - 10})
	planets[P[4]] = progress(2, {"due_at": NOW - DAY})
	planets[P[2]] = progress(1, {"due_at": NOW - 100})
	planets[P[5]] = progress(2)      # the weakest non-hostile planet that is not under attack
	var calls := Story.sector_calls("sub-15", _seen_all(planets), NOW, 10)
	eq(_pk(calls), [
		[P[4], "defend"], [P[2], "defend"], [P[1], "defend"], [P[6], "liberate"], [P[5], "patrol"],
	])
	eq(Story.sector_calls("sub-15", _seen_all(planets), NOW, 2).map(func(c): return c.planet_id), [P[4], P[2]])
	eq(Story.sector_calls("sub-15", _seen_all(planets), NOW, 0), [])


func test_a_fully_secured_sector_gets_one_patrol_to_its_weakest_planet() -> void:
	var P := _P()
	var planets := _all(5)
	planets[P[P.size() - 1]] = progress(4)
	var calls := Story.sector_calls("sub-15", _seen_all(planets), NOW, 3)
	eq(_pk(calls), [[P[P.size() - 1], "patrol"]])


func test_a_lost_mission_brings_a_defend_call() -> void:
	var P := _P()
	var planets := _all(5)
	planets[P[3]] = {"level": 2, "due_at": NOW, "wins": 4}
	eq(_pk(Story.sector_calls("sub-15", _seen_all(planets), NOW, 1)), [[P[3], "defend"]])


func test_messages_story_call_kind_1_to_3_by_stable_hash_sender_from_story_call_from_planet_name_param() -> void:
	var P := _P()
	var call: Dictionary = Story.sector_calls("sub-15", _seen_all(), NOW, 1)[0]
	eq(call.story_key, "story.call.liberate.%d" % (1 + (Story.stable_hash(P[0]) % 3)))
	eq(call.sender, Story.CALL_SENDER)
	eq(call.params, {"planet": Content.planet_by_id(P[0]).name})
	for d in _dicts().values():
		eq(d.get("story.call.from"), Story.CALL_SENDER)
		for kind in ["defend", "liberate", "patrol"]:
			for v in range(1, 4):
				has(str(d.get("story.call.%s.%d" % [kind, v], "")), "{planet}")


func test_the_first_call_carries_the_skill_intro_until_the_skill_is_seen() -> void:
	var fresh := Save.default_save()
	var calls := Story.sector_calls("mul-c", fresh, NOW, 3)
	eq([calls[0].story_key, calls[0].sender, calls[0].kind], ["story.system.multiplication.text", "tarrow", "liberate"])
	var seen := Story.mark_seen(fresh, "multiplication")
	var key: String = Story.sector_calls("mul-c", seen, NOW, 3)[0].story_key
	ok(RegEx.create_from_string("^story\\.call\\.liberate\\.[123]$").search(key) != null, key)
	eq(Story.sector_calls("nope", fresh, NOW, 3), [])


# ---------------------------------------------------------------- callFor

func test_call_for_picks_the_kind_from_the_planet_state() -> void:
	var P := _P()
	var save := _seen_all({P[3]: progress(2, {"due_at": NOW}), P[6]: progress(3)})
	eq(Story.call_for(P[3], save, NOW).kind, "defend")
	eq(Story.call_for(P[0], save, NOW).kind, "liberate")
	eq(Story.call_for(P[6], save, NOW), {
		"planet_id": P[6], "kind": "patrol", "story_key": "story.call.patrol.%d" % (1 + (Story.stable_hash(P[6]) % 3)),
		"sender": "abacus", "params": {"planet": Content.planet_by_id(P[6]).name},
	})
	errors(func(): return Story.call_for("nowhere", save, NOW))


func test_call_for_carries_the_skill_intro_while_the_skill_is_unseen() -> void:
	var P := _P()
	var planets := Content.planets()
	var core: String = planets[planets.size() - 1].id
	var c: Dictionary = Story.call_for(core, Save.default_save(), NOW)
	eq([c.story_key, c.sender], ["story.system.mixed.text", "tarrow"])
	eq(Story.call_for(P[0], Save.default_save(), NOW).story_key, "story.system.subtraction.text")


func test_every_call_key_exists_in_both_locales() -> void:
	var dicts := _dicts()
	for p in Content.planets():
		for save in [Save.default_save(), _seen_all()]:
			var c: Dictionary = Story.call_for(p.id, save, NOW)
			ok(str(dicts.hr.get(c.story_key, "")) != "", c.story_key)
			ok(str(dicts.en.get(c.story_key, "")) != "", c.story_key)


# ---------------------------------------------------------------- story

func test_mark_seen_is_pure_and_idempotent() -> void:
	var save := Save.default_save()
	var a := Story.mark_seen(save, "typing")
	eq(save.story.seen, [])
	eq(a.story.seen, ["typing"])
	ok(is_same(Story.mark_seen(a, "typing"), a))
	eq(Story.mark_seen(a, "addition").story.seen, ["typing", "addition"])


func test_every_skill_intro_exists_in_both_locales_and_its_sender_matches_the_from_key() -> void:
	for skill in Content.skills():
		for d in _dicts().values():
			ok(str(d.get("story.system.%s.text" % skill, "")) != "", skill)
			eq(d.get("story.system.%s.from" % skill), Story.SYSTEM_SENDERS[skill])
			ok(str(d.get("story.sender.%s" % Story.SYSTEM_SENDERS[skill], "")) != "")


func test_stable_hash_is_deterministic_and_spreads_planet_ids() -> void:
	eq(Story.stable_hash("mul-c.3"), Story.stable_hash("mul-c.3"))
	eq(Story.stable_hash(""), 0x811c9dc5)
	var buckets := {}
	var variants := {}
	for p in Content.planets():
		buckets[Story.stable_hash(p.id) % 8] = true
		variants[Story.stable_hash(p.id) % 3] = true
	eq(buckets.size(), 8)
	eq(variants.size(), 3)
