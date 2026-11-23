extends TestCase
## Port of tests/scheduler.test.ts


func _scheduler(planet_id: String, stats: Dictionary = {}, seed: int = 1, planets: Dictionary = {}) -> Scheduler.MissionScheduler:
	return Scheduler.create_mission_scheduler({"planet_id": planet_id, "stats": stats, "planets": planets, "now": NOW, "rng": Rng.new(seed)})


## A whole 3-wave mission of 8, 10, 12 problems, flattened.
func _mission(s: Scheduler.MissionScheduler) -> Array:
	var out: Array = []
	for w in 3:
		out.append_array(s.wave(w, 8 + 2 * w))
	return out


func _share(names: Array, name: String) -> float:
	return float(names.filter(func(n): return n == name).size()) / names.size()


func _ids(facts: Array) -> Array:
	return facts.map(func(f): return f.id)


func _id_set(facts: Array) -> Dictionary:
	var out := {}
	for f in facts:
		out[f.id] = true
	return out


func _no_repeats(q: Array, msg: String = "") -> void:
	for i in range(1, q.size()):
		if q[i].id == q[i - 1].id:
			fail("%s%s twice in a row at %d" % [msg, q[i].id, i])


# ---- enumerated sectors

func test_enumerated_draws_from_the_whole_sector_whatever_the_planet() -> void:
	var pool := _id_set(Facts.sector_facts("mul-c"))
	var stats := stats_for(["mul-c"], 2)
	for pid in planet_ids("mul-c"):
		var ids := _id_set(_scheduler(pid, stats, 3).wave(0, 300))
		for id in ids:
			ok(pool.has(id), id)
		eq(ids.size(), pool.size())


func test_enumerated_never_repeats_a_problem_twice_in_a_row_also_across_waves() -> void:
	for seed in range(1, 31):
		var q := _mission(_scheduler(planet_ids("add-10")[0], stats_for(["add-10"], 1), seed))
		_no_repeats(q, "seed %d: " % seed)


func test_enumerated_introduces_at_most_6_new_facts_first_wave_and_3_more_per_later_wave() -> void:
	var first_sets := {}
	for seed in range(1, 21):
		var s := _scheduler(planet_ids("add-15")[0], {}, seed)
		var opened := {}
		for w in 3:
			var ids := _ids(s.wave(w, 30))
			if w == 0:
				var seen := {}
				for id in ids:
					seen[id] = true
				var uniq := seen.keys()
				uniq.sort()
				first_sets[",".join(uniq)] = true
			for id in ids:
				opened[id] = true
			# Everything seen in waves 0..w together: at most 6 + 3w different new facts.
			le(opened.size(), Scheduler.FIRST_WAVE_NEW_FACTS + Scheduler.NEW_FACTS_PER_WAVE * w)
	gt(first_sets.size(), 5)   # not a fixed prefix: different missions start differently


func test_enumerated_first_mission_at_type_1_at_least_9_of_the_10_digits_no_immediate_repeats() -> void:
	eq([Scheduler.FIRST_WAVE_NEW_FACTS, Scheduler.NEW_FACTS_PER_WAVE], [6, 3])
	for seed in range(1, 201):
		var q := _mission(_scheduler(planet_ids("type-1")[0], {}, seed))
		eq(q.size(), 30)
		ge(_id_set(q).size(), 9, "seed %d" % seed)
		_no_repeats(q, "seed %d: " % seed)


func test_enumerated_limits_only_never_seen_facts_seen_facts_are_always_eligible() -> void:
	var stats := stats_for(["add-10"], 2)
	stats.erase(Facts.sector_facts("add-10")[0].id)
	var ids := _id_set(_scheduler(planet_ids("add-10")[1], stats).wave(0, 600))
	eq(ids.size(), Facts.sector_facts("add-10").size())


func test_enumerated_weights_due_facts_above_well_known_ones() -> void:
	var stats := {}
	for f in Facts.sector_facts("mul-c"):
		stats[f.id] = stat(2, {"due_at": NOW - 1}) if f.b <= 5 else stat(5)
	var q := _scheduler(planet_ids("mul-c")[0], stats).wave(0, 4000)
	var due := q.filter(func(f): return f.b <= 5).size()
	gt(float(due) / (q.size() - due), 3)   # weights 4 : 1


# ---- generated sectors

func test_generated_waves_hold_random_problems_of_the_sector_categories_stat_id_per_category() -> void:
	var cats := {}
	for c in Facts.sector_categories("add-100"):
		cats["cat:add-100:%s" % c] = true
	var q := _mission(_scheduler(planet_ids("add-100")[0]))
	eq(q.size(), 30)
	for f in q:
		ok(cats.has(f.stat_id), f.stat_id)
		ok(f.result >= 51 and f.result <= 100, str(f.result))
	gt(_id_set(q).size(), 25)
	_no_repeats(q)


func test_generated_category_shares_honour_the_balance_rule_as_probabilities() -> void:
	var cases := [["add-50", "carry"], ["add-100", "carry"], ["sub-50", "borrow"], ["sub-100", "borrow"]]
	for c in cases:
		var sector_id: String = c[0]
		var hard: String = c[1]
		var soft := "nocarry" if hard == "carry" else "noborrow"
		# Fresh player, and a player whose easy category is weak and due while the hard one is mastered.
		var adverse := {
			"cat:%s:easy" % sector_id: stat(0, {"due_at": NOW - 1}),
			"cat:%s:%s" % [sector_id, soft]: stat(0, {"due_at": NOW - 1}),
			"cat:%s:%s" % [sector_id, hard]: stat(5),
		}
		for stats in [{}, adverse]:
			var rng := Rng.new(17)
			var names: Array = []
			for i in 2000:
				names.append(Scheduler.pick_category(sector_id, stats, NOW, rng))
			le(_share(names, "easy"), 0.12, sector_id)
			ge(_share(names, hard), 0.45, sector_id)
			var p := Scheduler.category_shares(sector_id, stats, NOW)
			var sum := 0.0
			for x in p:
				sum += x.p
			close(sum, 1, 9)
			for x in p:
				if x.name == "easy":
					le(x.p, 0.1 + 1e-9)
				if x.name == hard:
					ge(x.p, 0.5 - 1e-9)
			ok(p.any(func(x): return x.name == "easy"), "easy present")
			ok(p.any(func(x): return x.name == hard), "hard present")


func test_generated_weak_and_due_categories_come_up_more_often() -> void:
	var rng := Rng.new(3)
	var draw := func(stats: Dictionary) -> Array:
		var out: Array = []
		for i in 3000:
			out.append(Scheduler.pick_category("neg-10", stats, NOW, rng))
		return out
	var base := _share(draw.call({}), "subNeg")
	var weak := _share(draw.call({"cat:neg-10:subNeg": stat(0, {"due_at": NOW - 1}), "cat:neg-10:addMixed": stat(5),
		"cat:neg-10:addNegNeg": stat(5), "cat:neg-10:subCross": stat(5)}), "subNeg")
	gt(weak, base * 2)
	var typing: Array = Scheduler.category_shares("type-3", {}, NOW).map(func(x): return x.p)
	eq(typing.size(), 3)
	var want := [0.4, 0.2, 0.4]
	for i in mini(typing.size(), 3):
		close(typing[i], want[i], 9)


# ---- determinism and variety

func test_determinism_the_same_seed_gives_the_same_mission_other_seeds_other_content() -> void:
	for pid in [planet_ids("add-100")[2], planet_ids("sub-50")[0], planet_ids("mul-c")[0], Content.CORE_PLANET_ID]:
		var ids := func(seed: int) -> Array:
			return _ids(_mission(_scheduler(pid, stats_for(["mul-c", "add-10"], 2), seed)))
		eq(ids.call(42), ids.call(42), pid)
		ne(ids.call(42), ids.call(43), pid)


func test_determinism_replacement_avoids_the_excluded_problems() -> void:
	var s := _scheduler(planet_ids("type-1")[0], stats_for(["type-1"], 3))
	var exclude := {}
	for id in ["type:0", "type:1", "type:2", "type:3", "type:4", "type:5", "type:6", "type:7", "type:8"]:
		exclude[id] = true
	for i in 20:
		var r = s.replacement(0, exclude)
		eq(r.id if r != null else null, "type:9")
	var all := _id_set(Facts.sector_facts("type-1"))
	is_null(s.replacement(0, all))
	var g := _scheduler(planet_ids("add-100")[0])
	var first: Dictionary = g.wave(0, 1)[0]
	for i in 50:
		var r = g.replacement(0, {first.id: true})
		ne(r.id if r != null else null, first.id)


# ---- mission sectors and the core pool

func test_mission_sectors_a_planet_draws_from_its_own_sector_an_unknown_planet_from_nothing() -> void:
	eq(Scheduler.mission_sectors(planet_ids("add-100")[3], {"stats": {}, "planets": {}}), ["add-100"])
	eq(Scheduler.mission_sectors("nope", {"stats": {}, "planets": {}}), [])
	eq(_scheduler("nope").wave(0, 5), [])


func test_mission_sectors_core_every_played_sector_else_type_1() -> void:
	eq(Scheduler.CORE_FALLBACK_SECTOR, "type-1")
	eq(Scheduler.mission_sectors(Content.CORE_PLANET_ID, {"stats": {}, "planets": {}}), ["type-1"])
	var stats := {"mul:7x8": stat(1), "cat:neg-20:subNeg": stat(0, {"attempts": 1}), "add:86+3": stat(4), "junk": stat(2)}
	var planets := {planet_ids("sub-15")[2]: progress(0, {"wins": 1}), planet_ids("div-a")[0]: progress(0, {"wins": 0}),
		Content.CORE_PLANET_ID: progress(2)}
	eq(Scheduler.played_sectors({"stats": stats, "planets": planets}), ["sub-15", "mul-c", "neg-20"])
	eq(Scheduler.mission_sectors(Content.CORE_PLANET_ID, {"stats": stats, "planets": planets}), ["sub-15", "mul-c", "neg-20"])
	var q := Scheduler.create_mission_scheduler({"planet_id": Content.CORE_PLANET_ID, "stats": stats, "planets": planets,
		"now": NOW, "rng": Rng.new(5)}).wave(2, 300)
	var from := {}
	for f in q:
		var src := "?"
		if f.stat_id.begins_with("cat:neg-20"):
			src = "neg-20"
		elif f.op == "mul":
			src = "mul-c"
		elif f.op == "sub":
			src = "sub-15"
		from[src] = true
	var keys := from.keys()
	keys.sort()
	eq(keys, ["mul-c", "neg-20", "sub-15"])
	var fallback := _scheduler(Content.CORE_PLANET_ID).wave(0, 40)
	ok(fallback.all(func(f): return f.op == "type" and f.a <= 9))
