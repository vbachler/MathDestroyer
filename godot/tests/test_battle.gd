extends TestCase
## Port of tests/battle.test.ts

## A planet of the digits sector (type-1: every mission draws from 0..9).
var DIGITS: String = planet_ids("type-1")[1]


# ---------------------------------------------------------------- helpers

func cfg(over: Dictionary = {}) -> Dictionary:
	var c := {
		"planet_id": DIGITS, "total_waves": Battle.MISSION_WAVES, "stats": {}, "planets": {}, "modules": {},
		"now": NOW, "seed": 1, "speed_scale": 1,
	}
	c.merge(over, true)
	return c


## toMatchObject: every key of `partial` (recursively for Dictionaries) equals the actual value.
static func _like(actual: Variant, partial: Variant) -> bool:
	if partial is Dictionary:
		if not actual is Dictionary:
			return false
		for k in partial.keys():
			if not actual.has(k) or not _like(actual[k], partial[k]):
				return false
		return true
	return deep_eq(actual, partial)


func like(actual: Variant, partial: Variant, msg: String = "") -> bool:
	if _like(actual, partial):
		return true
	fail("%sexpected %s to match %s" % ["" if msg == "" else msg + ": ", show(actual), show(partial)])
	return false


func _is_num(v: Variant) -> bool:
	return v is int or v is float


func type_number(sim: BattleSim, n: Variant) -> void:
	for ch in str(absi(int(n))):
		sim.type_digit(int(ch))
	if n < 0:
		sim.toggle_sign()


func answer(sim: BattleSim, n: Variant) -> Array:
	type_number(sim, n)
	return sim.submit()


func lowest_enemy(sim: BattleSim) -> Dictionary:
	return Js.sorted(sim.state.enemies, func(a, b): return b.y - a.y)[0]


## Ends a boarding (if any) as repelled with no kills, so tests about other rules keep running.
func repel(sim: BattleSim) -> Array:
	return sim.resolve_boarding({"repelled": true, "records": [], "kills": 0}) if sim.state.phase == "boarding" else []


## update() that repels any boarding it causes.
func advance(sim: BattleSim, ms: float) -> Array:
	var ev := sim.update(ms)
	return ev + repel(sim)


## Steps until the predicate holds; returns all events. Boardings are repelled.
func run_until(sim: BattleSim, pred: Callable, max_ms: int = 120_000, step: int = 16) -> Array:
	var all: Array = []
	var t := 0
	while t < max_ms:
		var ev := advance(sim, step)
		all.append_array(ev)
		if pred.call(ev):
			return all
		t += step
	fail("condition not reached")
	return all


func _first_of(ev: Array, type: String) -> Variant:
	for x in ev:
		if x.type == type:
			return x
	return null


func first_spawn(sim: BattleSim) -> Dictionary:
	var ev := run_until(sim, func(e): return e.any(func(x): return x.type == "spawn"))
	var spawn = _first_of(ev, "spawn")
	if spawn == null:
		fail("no spawn")
		return {}
	return spawn.enemy


## Answers every enemy as soon as it appears until the wave ends.
func clear_wave(sim: BattleSim) -> Array:
	var all: Array = []
	var i := 0
	while i < 20000 and sim.state.phase == "spawning":
		all.append_array(advance(sim, 16))
		while sim.state.phase == "spawning" and sim.state.enemies.size() > 0:
			all.append_array(answer(sim, lowest_enemy(sim).fact.answer))
		i += 1
	return all


func wrong_digit(sim: BattleSim) -> int:
	var live := {}
	for e in sim.state.enemies:
		live[int(e.fact.answer)] = true
	for d in 10:
		if not live.has(d):
			return d
	fail("no free digit")
	return -1


## A sim (seed searched deterministically) whose first between-wave shop offers `upgrade_id`.
func sim_offering(upgrade_id: String, over: Dictionary = {}, from_seed: int = 1) -> BattleSim:
	for seed in range(from_seed, from_seed + 500):
		var o := over.duplicate()
		o["seed"] = seed
		var sim := BattleSim.new(cfg(o))
		clear_wave(sim)
		if sim.offers().any(func(x): return x.def.id == upgrade_id):
			return sim
	fail("no seed offers %s" % upgrade_id)
	return null


func _type1_stats(box: int) -> Dictionary:
	var out := {}
	for f in Facts.sector_facts("type-1"):
		out[f.id] = stat(box)
	return out


func _nearest_dome(x: float) -> int:
	var order: Array = []
	for i in Battle.DOME_X.size():
		order.append({"i": i, "d": absf(Battle.DOME_X[i] - x)})
	return Js.sorted(order, func(a, b): return a.d - b.d)[0].i


func _matches_re(s: String, pattern: String) -> bool:
	var re := RegEx.new()
	re.compile(pattern)
	return re.search(s) != null


# ---------------------------------------------------------------- BattleSim setup

func test_starts_in_wave_1_with_4_domes_of_2_hp_no_upgrades_and_no_shield() -> void:
	var sim := BattleSim.new(cfg())
	eq(sim.state.phase, "spawning")
	eq(sim.state.wave, 1)
	eq(sim.state.domes, [{"hp": 2, "max_hp": 2}, {"hp": 2, "max_hp": 2}, {"hp": 2, "max_hp": 2}, {"hp": 2, "max_hp": 2}])
	eq(sim.state.owned_upgrades, {})
	eq(sim.state.shield_charges, 0)
	no(sim.state.has("energy"))


func test_applies_the_hull_module() -> void:
	var sim := BattleSim.new(cfg({"modules": {"hull": 2}}))
	ok(sim.state.domes.all(func(d): return d.hp == 4 and d.max_hp == 4))


func test_head_start_gives_1_2_3_distinct_random_upgrades_at_tier_1_chosen_by_the_mission_rng() -> void:
	for tier in [1, 2, 3]:
		var seen := {}
		for seed in range(1, 31):
			var sim := BattleSim.new(cfg({"seed": seed, "modules": {"headStart": tier}}))
			var owned: Dictionary = sim.state.owned_upgrades
			eq(owned.keys().size(), tier)
			ok(owned.values().all(func(t): return t == 1))
			eq(BattleSim.new(cfg({"seed": seed, "modules": {"headStart": tier}})).state.owned_upgrades, owned)
			for id in owned.keys():
				seen[id] = true
		gt(seen.size(), tier)   # varies with the seed


func test_a_head_start_shield_is_charged_in_wave_1_and_a_head_start_turret_starts_on_cooldown() -> void:
	var shield_sim: BattleSim = null
	var turret_sim: BattleSim = null
	var seed := 1
	while seed < 200 and (shield_sim == null or turret_sim == null):
		var sim := BattleSim.new(cfg({"seed": seed, "modules": {"headStart": 1}}))
		if sim.state.owned_upgrades.has("shield") and shield_sim == null:
			shield_sim = sim
		if sim.state.owned_upgrades.has("autoTurret") and turret_sim == null:
			turret_sim = sim
		seed += 1
	if not_null(shield_sim):
		eq(shield_sim.state.shield_charges, 1)
	if not_null(turret_sim):
		eq(turret_sim.state.auto_turret_cooldown_ms, 7000)


func test_spawns_the_first_enemy_after_the_start_delay_at_the_top_of_a_lane_with_wave_speed() -> void:
	var sim := BattleSim.new(cfg())
	eq(sim.update(Battle.WAVE_START_DELAY_MS - 1), [])
	var ev := sim.update(1)
	eq(ev.size(), 1)
	var e: Dictionary = ev[0].enemy
	has(Battle.LANE_X, e.x)
	close(e.y, Battle.SPAWN_Y, 0)
	ge(e.speed, 23 * 0.9)
	le(e.speed, 23 * 1.1)


func test_spawns_6_plus_2w_enemies_per_wave_never_more_than_4_alive_lanes_not_overlapping() -> void:
	var sim := BattleSim.new(cfg({"stats": _type1_stats(2)}))
	var spawns := 0
	var max_alive := 0
	var i := 0
	while i < 10000 and sim.state.phase != "waveCleared":
		var ev := advance(sim, 16)
		for x in ev:
			if x.type != "spawn":
				continue
			spawns += 1
			var others: Array = sim.state.enemies.filter(func(e): return e.lane == x.enemy.lane and e.id != x.enemy.id)
			ok(others.all(func(o): return o.y > 200))
		max_alive = maxi(max_alive, sim.state.enemies.size())
		if sim.state.phase == "explaining":
			sim.update(Battle.EXPLAIN_MS)
		# answer slowly: only when the cap is reached, to exercise it
		if sim.state.enemies.size() >= Battle.MAX_ALIVE:
			answer(sim, lowest_enemy(sim).fact.answer)
		if sim.state.phase == "lost":
			break
		i += 1
	le(max_alive, 4)
	eq(spawns, 8)


# ---------------------------------------------------------------- BattleSim pacing

func test_wave_formulas() -> void:
	# 6 + 2w enemies, interval max(1800, 3600 - 250w) / scale, speed (20 + 3w) * scale
	eq([1, 2, 3].map(func(w): return Battle.enemies_in_wave(w)), [8, 10, 12])
	eq(Battle.spawn_interval_ms(1), 3350)
	eq(Battle.spawn_interval_ms(8), 1800)
	eq(Battle.spawn_interval_ms(1, 1.25), 2680)
	close(Battle.spawn_interval_ms(1, 0.75), 3350 / 0.75)
	eq(Battle.base_speed(1), 23)
	close(Battle.base_speed(2, 0.75), 19.5)
	close(Battle.base_speed(1, 1.25), 28.75)
	eq(Battle.MAX_ALIVE, 4)
	eq(Battle.spawn_interval_ms(1, 0.5), 6700)


func test_density_formulas_interval_over_density_max_alive_2_3_4_5() -> void:
	eq([0.5, 0.75, 1, 1.25].map(func(d): return Battle.max_alive(d)), [2, 3, 4, 5])
	eq(Battle.max_alive(), Battle.MAX_ALIVE)
	eq(Battle.spawn_interval_ms(1, 1, 0.5), 6700)
	eq(Battle.spawn_interval_ms(1, 1, 1.25), 2680)
	eq(Battle.spawn_interval_ms(1, 0.5, 0.5), 13400)
	close(Battle.spawn_interval_ms(8, 1, 0.75), 2400)


func _density_case(density: float) -> void:
	var cap := Battle.max_alive(density)
	var sim := BattleSim.new(cfg({"density": density, "stats": _type1_stats(2)}))
	var spawns: Array = []
	var peak := 0
	var i := 0
	while i < 20000 and sim.state.phase != "waveCleared":
		for x in advance(sim, 10):
			if x.type == "spawn":
				spawns.append(x.enemy)
		if sim.state.enemies.size() > cap:
			le(sim.state.enemies.size(), cap)
		peak = maxi(peak, sim.state.enemies.size())
		if sim.state.phase == "explaining":
			sim.update(Battle.EXPLAIN_MS)
		# answer only at the cap, so the cap is reached and held
		if sim.state.enemies.size() >= cap:
			answer(sim, lowest_enemy(sim).fact.answer)
		if sim.state.phase == "lost":
			break
		i += 1
	eq(peak, cap)
	eq(spawns.size(), Battle.enemies_in_wave(1))
	if spawns.size() < 2:
		return
	var gap: float = spawns[1].spawned_at - spawns[0].spawned_at
	ge(gap, 3350 / density - 1e-6)
	lt(gap, 3350 / density + 10)


func test_density_0_5_spawn_gap_3350_over_density_max_alive_2_8_enemies_per_wave() -> void:
	_density_case(0.5)


func test_density_0_75_spawn_gap_3350_over_density_max_alive_3_8_enemies_per_wave() -> void:
	_density_case(0.75)


func test_density_1_spawn_gap_3350_over_density_max_alive_4_8_enemies_per_wave() -> void:
	_density_case(1)


func test_density_1_25_spawn_gap_3350_over_density_max_alive_5_8_enemies_per_wave() -> void:
	_density_case(1.25)


func test_falls_back_to_density_1_for_an_invalid_value() -> void:
	for density in [NAN, 0, -1]:
		var sim := BattleSim.new(cfg({"density": density}))
		var spawns: Array = []
		var i := 0
		while i < 2000 and spawns.size() < 2:
			for e in sim.update(10):
				if e.type == "spawn":
					spawns.append(e.enemy)
			i += 1
		if eq(spawns.size(), 2, "density %s" % density):
			lt(spawns[1].spawned_at - spawns[0].spawned_at, 3350 + 10)


func _speed_scale_case(scale: float) -> void:
	var sim := BattleSim.new(cfg({"speed_scale": scale}))
	var spawns: Array = []
	var i := 0
	while i < 2000 and spawns.size() < 2:
		for e in sim.update(10):
			if e.type == "spawn":
				spawns.append(e.enemy)
		i += 1
	if not eq(spawns.size(), 2):
		return
	for e in spawns:
		ge(e.speed, 23 * scale * 0.9 - 1e-9)
		le(e.speed, 23 * scale * 1.1 + 1e-9)
	var gap: float = spawns[1].spawned_at - spawns[0].spawned_at
	ge(gap, 3350 / scale - 1e-6)
	lt(gap, 3350 / scale + 10)


func test_speed_scale_0_5_scales_enemy_speed_and_spawn_interval() -> void:
	_speed_scale_case(0.5)


func test_speed_scale_0_75_scales_enemy_speed_and_spawn_interval() -> void:
	_speed_scale_case(0.75)


func test_speed_scale_1_scales_enemy_speed_and_spawn_interval() -> void:
	_speed_scale_case(1)


func test_speed_scale_1_25_scales_enemy_speed_and_spawn_interval() -> void:
	_speed_scale_case(1.25)


func test_pauses_spawning_while_4_enemies_are_alive() -> void:
	var sim := BattleSim.new(cfg({"total_waves": 5}))
	clear_wave(sim)
	sim.next_wave()
	clear_wave(sim)
	sim.next_wave()                       # wave 3: 12 enemies
	eq(sim.remaining_to_spawn(), 12)
	var saw_cap := false
	var i := 0
	while i < 3000 and sim.state.phase == "spawning":
		advance(sim, 16)
		le(sim.state.enemies.size(), Battle.MAX_ALIVE)
		if sim.state.enemies.size() == Battle.MAX_ALIVE:
			saw_cap = true
			var pending := sim.remaining_to_spawn()
			advance(sim, 5000)                # long enough for several intervals
			le(sim.state.enemies.size(), Battle.MAX_ALIVE)
			if sim.state.phase == "spawning" and sim.state.enemies.size() == Battle.MAX_ALIVE:
				eq(sim.remaining_to_spawn(), pending)
			break
		i += 1
	ok(saw_cap)


func test_falls_back_to_speed_scale_1_for_a_missing_or_invalid_value() -> void:
	var sim := BattleSim.new(cfg({"speed_scale": NAN}))
	var e := first_spawn(sim)
	ge(e.speed, 23 * 0.9)
	le(e.speed, 23 * 1.1)


# ---------------------------------------------------------------- BattleSim answers

func test_correct_fast_answer_kill_15_points_streak_recorded_fast() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	var ev := answer(sim, e.fact.answer)
	like(ev[0], {"type": "kill", "fast": true, "by_turret": false, "points": 15})
	like(sim.state, {"score": 15, "streak": 1, "best_streak": 1, "kills": 1, "input": ""})
	if eq(sim.records.size(), 1):
		var r: Dictionary = sim.records[0]
		eq(r.keys().size(), 3)
		eq(r.fact_id, e.fact.id)
		eq(r.outcome, "fast")
		ok(_is_num(r.get("response_ms")))
	eq(sim.state.enemies.size(), 0)


func test_correct_slow_answer_10_points_recorded_slow() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	sim.update(3500)
	var ev := answer(sim, e.fact.answer)
	like(ev[0], {"type": "kill", "fast": false, "points": 10})
	like(sim.records[0], {"fact_id": e.fact.id, "outcome": "slow"})


func test_adds_min_streak_20_to_points_and_multiplies_by_overcharge() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	sim.state.streak = 25
	var ev := answer(sim, e.fact.answer)
	like(ev[0], {"type": "kill", "points": 35})


func test_wrong_answer_streak_reset_minus_5_score_min_0_recorded_once_against_the_lowest_enemy() -> void:
	var sim := BattleSim.new(cfg())
	var first := first_spawn(sim)
	answer(sim, first.fact.answer)       # +15
	var e := first_spawn(sim)
	var ev := answer(sim, wrong_digit(sim))
	like(ev[0], {"type": "wrong"})
	like(sim.state, {"streak": 0, "score": 10, "wrong_answers": 1, "input": ""})
	like(sim.records[1], {"fact_id": e.fact.id, "outcome": "wrong"})
	answer(sim, wrong_digit(sim))
	answer(sim, wrong_digit(sim))
	eq(sim.state.score, 0)
	eq(sim.state.wrong_answers, 3)
	eq(sim.records.size(), 2)


func test_an_enemy_answered_wrongly_and_later_correctly_records_slow_never_fast() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	answer(sim, wrong_digit(sim))
	var ev := answer(sim, e.fact.answer)
	like(ev[0], {"type": "kill", "fast": false, "points": 10})
	eq(sim.records.map(func(r): return r.outcome), ["wrong", "slow"])


func test_fr_03_of_the_enemies_with_an_equal_answer_destroys_the_one_with_the_greatest_y() -> void:
	var sim := BattleSim.new(cfg())
	first_spawn(sim)
	run_until(sim, func(_e): return sim.state.enemies.size() == 2)
	var older: Dictionary = sim.state.enemies[0]
	var newer: Dictionary = sim.state.enemies[1]
	newer.fact = FactGen.make_fact("add", 0, older.fact.answer)   # a different problem with the same answer
	gt(older.y, newer.y)
	var ev := answer(sim, older.fact.answer)
	like(ev[0], {"type": "kill", "enemy": {"id": older.id}})
	# and when the newer one is lower, the newer one goes first
	var sim2 := BattleSim.new(cfg())
	first_spawn(sim2)
	run_until(sim2, func(_e): return sim2.state.enemies.size() == 2)
	var a: Dictionary = sim2.state.enemies[0]
	var b: Dictionary = sim2.state.enemies[1]
	b.fact = FactGen.make_fact("add", 0, a.fact.answer)
	b.y = a.y + 50
	ev = answer(sim2, a.fact.answer)
	like(ev[0], {"type": "kill", "enemy": {"id": b.id}})


func test_targeting_module_makes_more_answers_fast_for_scoring_but_not_for_mastery() -> void:
	var sim := BattleSim.new(cfg({"modules": {"targeting": 1}}))
	var e := first_spawn(sim)
	sim.update(3200)
	var ev := answer(sim, e.fact.answer)
	like(ev[0], {"type": "kill", "fast": true, "points": 15})
	eq(sim.records[0].outcome, "slow")


# ---------------------------------------------------------------- BattleSim input

func test_accepts_up_to_4_digits_backspace_and_ignores_empty_submit() -> void:
	var sim := BattleSim.new(cfg())
	eq(sim.submit(), [])
	for d in [1, 2, 3, 4, 5]:
		sim.type_digit(d)
	eq(sim.state.input, "1234")
	sim.backspace()
	eq(sim.state.input, "123")
	sim.backspace(); sim.backspace(); sim.backspace(); sim.backspace()
	eq(sim.state.input, "")
	sim.type_digit(0)
	sim.type_digit(7)
	eq(sim.state.input, "7")


func test_toggle_sign_only_matters_when_a_live_enemy_has_a_negative_answer() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	sim.type_digit(5)
	sim.toggle_sign()
	eq(sim.state.input, "5")
	var neg := FactGen.make_fact("sub", 3, 7)   # 3 - 7 = -4
	e.fact = neg
	sim.state.enemies[0].fact = neg
	sim.toggle_sign()
	eq(sim.state.input, "-5")
	sim.toggle_sign()
	eq(sim.state.input, "5")
	sim.backspace()
	var ev := answer(sim, neg.answer)
	like(ev[0], {"type": "kill"})


# ---------------------------------------------------------------- BattleSim impacts

func test_impact_damages_the_nearest_dome_resets_streak_records_missed_and_explains() -> void:
	var sim := BattleSim.new(cfg())
	sim.state.streak = 4
	var ev := run_until(sim, func(e): return e.any(func(x): return x.type == "impact"), 60_000, 50)
	var impact = _first_of(ev, "impact")
	if not not_null(impact):
		return
	var nearest := _nearest_dome(impact.enemy.x)
	eq(impact.dome_index, nearest)
	eq(impact.destroyed, false)
	eq(sim.state.domes[nearest].hp, 1)
	eq(sim.state.streak, 0)
	eq(sim.state.missed.map(func(f): return f.id), [impact.enemy.fact.id])
	like(sim.records.back(), {"fact_id": impact.enemy.fact.id, "outcome": "missed"})
	eq(sim.state.phase, "explaining")
	eq(sim.state.explaining.id if sim.state.explaining != null else null, impact.enemy.fact.id)
	ok(ev.any(func(x): return x.type == "explainStart"))
	eq(impact.enemy.y, Battle.IMPACT_Y)

	# frozen during the explanation: no movement, no spawns, no input
	var ys: Array = sim.state.enemies.map(func(e): return e.y)
	var count: int = sim.state.enemies.size()
	sim.type_digit(3)
	eq(sim.state.input, "")
	eq(sim.submit(), [])
	eq(sim.update(Battle.EXPLAIN_MS - 100), [])
	eq(sim.state.enemies.map(func(e): return e.y), ys)
	eq(sim.state.enemies.size(), count)
	var end := sim.update(100)
	has(end, {"type": "explainEnd"})
	eq(sim.state.phase, "spawning")
	is_null(sim.state.explaining)


func test_hits_the_next_nearest_standing_dome_when_the_nearest_is_destroyed() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	var order_d: Array = []
	for i in Battle.DOME_X.size():
		order_d.append({"i": i, "d": absf(Battle.DOME_X[i] - e.x)})
	var order: Array = Js.sorted(order_d, func(a, b): return a.d - b.d).map(func(o): return o.i)
	sim.state.domes[order[0]].hp = 0
	var ev := run_until(sim, func(x): return x.any(func(y): return y.type == "impact" and y.enemy.id == e.id), 60_000, 50)
	var impact = null
	for x in ev:
		if x.type == "impact" and x.enemy.id == e.id:
			impact = x
			break
	like(impact, {"dome_index": order[1]})


func test_loses_when_no_dome_is_standing_after_an_impact_no_explanation() -> void:
	var sim := BattleSim.new(cfg())
	for d in sim.state.domes:
		d.hp = 0
	sim.state.domes[3].hp = 1
	var ev := run_until(sim, func(e): return e.any(func(x): return x.type == "impact"), 60_000, 50)
	has(ev, {"type": "lost"})
	no(ev.any(func(x): return x.type == "explainStart"))
	eq(sim.state.phase, "lost")
	eq(sim.update(1000), [])


func test_shield_absorbs_the_first_impact_of_a_wave_enemy_destroyed_no_hp_lost_streak_kept_still_missed_and_explained() -> void:
	var sim := sim_offering("shield")
	if sim == null:
		return
	eq(sim.pick_upgrade("shield"), [])
	eq(sim.state.shield_charges, 1)
	sim.state.streak = 7
	var hp_before: Array = sim.state.domes.map(func(d): return d.hp)
	var ev := run_until(sim, func(e): return e.any(func(x): return x.type == "shieldBlock"), 120_000, 50)
	var block = _first_of(ev, "shieldBlock")
	if not not_null(block):
		return
	eq(block.dome_index, _nearest_dome(block.enemy.x))
	no(ev.any(func(x): return x.type == "impact"))
	eq(sim.state.domes.map(func(d): return d.hp), hp_before)
	eq(sim.state.streak, 7)
	eq(sim.state.shield_charges, 0)
	no(sim.state.enemies.any(func(e): return e.id == block.enemy.id))
	like(sim.records.back(), {"fact_id": block.enemy.fact.id, "outcome": "missed"})
	has(sim.state.missed.map(func(f): return f.id), block.enemy.fact.id)
	eq(sim.state.phase, "explaining")
	eq(sim.state.explaining.id if sim.state.explaining != null else null, block.enemy.fact.id)
	has(ev, {"type": "explainStart", "fact": block.enemy.fact})

	# The charge is used up: the next impact in this wave does damage.
	var ev2 := run_until(sim, func(e): return e.any(func(x): return x.type == "impact" or x.type == "shieldBlock"), 120_000, 50)
	no(ev2.any(func(x): return x.type == "shieldBlock"))
	eq(sim.state.streak, 0)

	# Refilled at the next wave start.
	var i := 0
	while i < 200 and sim.state.phase != "waveCleared" and sim.state.phase != "lost":
		advance(sim, Battle.EXPLAIN_MS)
		clear_wave(sim)
		i += 1
	if not eq(sim.state.phase, "waveCleared"):
		return
	sim.pick_upgrade(sim.offers()[0].def.id)
	eq(sim.state.shield_charges, sim.state.owned_upgrades.get("shield"))


func test_repairs_the_most_damaged_dome_when_the_streak_reaches_a_multiple_of_10() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	sim.state.domes[1].hp = 1
	sim.state.domes[2].hp = 0
	sim.state.streak = 9
	var ev := answer(sim, e.fact.answer)
	has(ev, {"type": "repair", "dome_index": 2})
	eq(sim.state.domes[2].hp, 1)


# ---------------------------------------------------------------- BattleSim waves and upgrades

func test_clears_a_wave_offers_3_distinct_upgrades_picks_one_for_free_and_continues() -> void:
	var sim := BattleSim.new(cfg())
	var ev := clear_wave(sim)
	eq(ev.filter(func(x): return x.type == "spawn").size(), 8)
	has(ev, {"type": "waveCleared", "wave": 1})
	eq(sim.state.phase, "waveCleared")
	eq(sim.update(5000), [])
	var offers := sim.offers()
	eq(offers.size(), 3)
	var ids := {}
	for o in offers:
		ids[o.def.id] = true
	eq(ids.size(), 3)
	eq(sim.offers(), offers)
	ok(offers.all(func(o): return o.next_tier == 1))

	var not_offered := ""
	for id in ["slowField", "autoTurret", "overcharge", "salvage", "repairDrone", "shield"]:
		if not offers.any(func(o): return o.def.id == id):
			not_offered = id
			break
	eq(sim.pick_upgrade(not_offered), [])
	eq(sim.pick_upgrade("collector"), [])
	eq(sim.state.phase, "waveCleared")
	eq(sim.state.owned_upgrades, {})

	eq(sim.pick_upgrade(offers[0].def.id), [])   # no repair drone: no events
	eq(sim.state.owned_upgrades, {offers[0].def.id: 1})
	eq(sim.state.phase, "spawning")
	eq(sim.state.wave, 2)
	eq(sim.offers(), [])
	eq(sim.pick_upgrade(offers[1].def.id), [])
	eq(sim.state.owned_upgrades, {offers[0].def.id: 1})


func test_pick_upgrade_raises_the_tier_of_an_upgrade_already_owned() -> void:
	for seed in range(1, 300):
		var sim := BattleSim.new(cfg({"seed": seed}))
		clear_wave(sim)
		if not sim.offers().any(func(o): return o.def.id == "overcharge"):
			continue
		sim.pick_upgrade("overcharge")
		clear_wave(sim)
		var again = null
		for o in sim.offers():
			if o.def.id == "overcharge":
				again = o
				break
		if again == null:
			continue
		eq(again.next_tier, 2)
		sim.pick_upgrade("overcharge")
		eq(sim.state.owned_upgrades.get("overcharge"), 2)
		eq(sim.upgrade_effects().score_mult, 1.5)
		return
	fail("no seed offers overcharge twice")


func test_offers_nothing_when_every_upgrade_is_at_max_tier_next_wave_then_continues() -> void:
	var sim := BattleSim.new(cfg())
	clear_wave(sim)
	sim.state.owned_upgrades = {"slowField": 3, "autoTurret": 3, "overcharge": 3, "salvage": 3, "repairDrone": 3, "shield": 3}
	# Offers are computed at wave end; with everything maxed the current ones resolve to nothing.
	eq(sim.offers(), [])
	sim.next_wave()
	eq(sim.state.phase, "spawning")
	eq(sim.state.wave, 2)


func test_wins_after_the_last_wave() -> void:
	var sim := BattleSim.new(cfg({"total_waves": 1}))
	var ev := clear_wave(sim)
	has(ev, {"type": "won"})
	eq(sim.state.phase, "won")


func test_slow_field_slows_enemies_spawned_afterwards() -> void:
	var sim := sim_offering("slowField")
	if sim == null:
		return
	sim.pick_upgrade("slowField")
	var e := first_spawn(sim)
	le(e.speed, 26 * 1.1 * 0.9 + 1e-9)


func test_repair_drone_repairs_at_wave_start() -> void:
	var sim := sim_offering("repairDrone")
	if sim == null:
		return
	sim.state.domes[0].hp = 0
	eq(sim.pick_upgrade("repairDrone"), [{"type": "repair", "dome_index": 0}])
	eq(sim.state.domes[0].hp, 1)
	eq(sim.state.wave, 2)


func test_auto_turret_fires_only_on_mastered_facts_and_its_kills_are_not_recorded() -> void:
	var stats := {}
	for f in Facts.sector_facts("type-1"):
		stats[f.id] = stat(4) if f.a < 8 else stat(1)
	var sim := sim_offering("autoTurret", {"stats": stats})
	if sim == null:
		return
	sim.pick_upgrade("autoTurret")
	eq(sim.state.auto_turret_cooldown_ms, 7000)
	eq(sim.state.wave, 2)
	var records_before := sim.records.size()
	var score_before: int = sim.state.score
	var streak_before: int = sim.state.streak
	var events: Array = []
	var i := 0
	while i < 20000 and (sim.state.phase == "spawning" or sim.state.phase == "explaining"):
		events.append_array(advance(sim, 50))
		i += 1
	var turret_kills := events.filter(func(e): return e.type == "kill" and e.by_turret)
	var impacts := events.filter(func(e): return e.type == "impact")
	gt(turret_kills.size(), 0)
	for k in turret_kills:
		ok(Mastery.is_mastered(stats.get(k.enemy.fact.id)))
		eq(k.points, 5)
	var new_records := sim.records.slice(records_before)
	eq(new_records.size(), impacts.size())
	ok(new_records.all(func(r): return r.outcome == "missed"))
	eq(sim.state.score, score_before + 5 * turret_kills.size())
	eq(sim.state.streak, 0 if impacts.size() > 0 else streak_before)


# ---------------------------------------------------------------- BattleSim determinism

func _script(seed: int, planet_id: String) -> String:
	var stats := {}
	var facts := Facts.sector_facts("mul-c")
	for i in facts.size():
		stats[facts[i].id] = stat(i % 6, {"due_at": NOW - 1 if i % 2 else NOW + 1})
	var sim := BattleSim.new(cfg({"planet_id": planet_id, "stats": stats, "seed": seed, "modules": {"headStart": 2}}))
	var log: Array = []
	for tick in 6000:
		var p: String = sim.state.phase
		if p == "won" or p == "lost":
			break
		if p == "waveCleared":
			var offers := sim.offers()
			log.append_array(sim.pick_upgrade(offers[tick % offers.size()].def.id) if offers.size() > 0 else sim.next_wave())
			continue
		if p == "boarding":
			var board := BoardingSim.new({"facts": sim.boarding_facts(), "seed": seed + tick, "speed_scale": 1})
			for t in 2000:
				if board.state.phase != "fighting":
					break
				board.step(100)
				var crawlers: Array = Js.sorted(board.state.crawlers, func(x, y): return x.z - y.z)
				var target = crawlers[0] if crawlers.size() > 0 else null
				if target != null and t % 7 == 0:
					for ch in str(absi(int(target.fact.answer))):
						board.type_digit(int(ch))
					if target.fact.answer < 0:
						board.toggle_sign()
					board.submit()
			log.append_array(sim.resolve_boarding({
				"repelled": board.state.phase == "repelled", "records": board.records, "kills": board.state.kills,
			}))
			continue
		log.append_array(sim.update(37 + (tick % 5) * 11))
		if sim.state.phase != "spawning" or sim.state.enemies.size() == 0:
			continue
		if tick % 13 == 0:
			type_number(sim, 1)
			log.append_array(sim.submit())
		elif tick % 90 == 0:   # slow play: armed enemies get to fire
			log.append_array(answer(sim, lowest_enemy(sim).fact.answer))
	return JSON.stringify({"state": sim.state, "records": sim.records, "log": log})


func test_same_config_and_calls_give_identical_state_records_and_events() -> void:
	var boardings := 0
	for planet_id in [planet_ids("mul-c")[0], planet_ids("add-100")[3], Content.CORE_PLANET_ID]:
		var a := _script(123, planet_id)
		eq(_script(123, planet_id), a, planet_id)
		ne(_script(124, planet_id), a, planet_id)
		var parsed: Dictionary = JSON.parse_string(a)
		ok(_matches_re(parsed.state.phase, "won|lost"), planet_id)
		boardings += parsed.log.filter(func(e): return e.type == "breach").size()
	gt(boardings, 0)   # the script plays slowly enough to be boarded


func test_fact_by_id_resolves_every_fact_the_sim_can_produce() -> void:
	var sim := BattleSim.new(cfg())
	var e := first_spawn(sim)
	eq(Facts.fact_by_id(e.fact.id), e.fact)


# ---------------------------------------------------------------- BattleSim random problems (v4)

## Plays a whole mission slowly (answers only when 4 enemies are alive, so enemies stay on
## screen together) and checks every spawn: the new problem is not alive already and differs
## from the previous spawn. Returns the spawned problem ids.
func _play_checked(planet_id: String, seed: int, stats: Dictionary = {}) -> Array:
	var sim := BattleSim.new(cfg({"planet_id": planet_id, "seed": seed, "stats": stats, "modules": {"hull": 3}}))
	var spawned: Array = []
	for tick in 40000:
		var p: String = sim.state.phase
		if p == "won" or p == "lost":
			break
		if p == "waveCleared":
			var offers := sim.offers()
			if offers.size() > 0:
				sim.pick_upgrade(offers[0].def.id)
			else:
				sim.next_wave()
			continue
		for e in advance(sim, 40):
			if e.type != "spawn":
				continue
			var ids: Array = sim.state.enemies.map(func(x): return x.fact.id)
			var uniq := {}
			for id in ids:
				uniq[id] = true
			eq(uniq.size(), ids.size(), "%s seed %d: %s" % [planet_id, seed, " ".join(ids)])
			if spawned.size() > 0:
				ne(e.enemy.fact.id, spawned.back())
			spawned.append(e.enemy.fact.id)
		if sim.state.phase == "spawning" and sim.state.enemies.size() >= Battle.MAX_ALIVE:
			answer(sim, lowest_enemy(sim).fact.answer)
	return spawned


func test_never_has_two_identical_problems_alive_nor_the_same_problem_twice_in_a_row_long_missions() -> void:
	var played := {"mul:7x8": stat(2), "cat:add-100:carry": stat(1), "sub:9-4": stat(3)}
	var cases: Array = [
		[planet_ids("type-1")[0], {}], [planet_ids("sub-5")[2], {}], [planet_ids("add-100")[1], {}],
		[planet_ids("miss-sub")[0], {}], [Content.CORE_PLANET_ID, played], [Content.CORE_PLANET_ID, {}],
	]
	for c in cases:
		for seed in range(1, 5):
			var spawned := _play_checked(c[0], seed, c[1])
			ge(spawned.size(), 8, c[0])


func test_a_mission_differs_between_seeds_and_every_planet_of_a_sector_draws_from_the_whole_sector() -> void:
	var a := _play_checked(planet_ids("add-100")[0], 1)
	var b := _play_checked(planet_ids("add-100")[0], 2)
	ne(a, b)
	var uniq := {}
	for id in a:
		uniq[id] = true
	gt(uniq.size(), a.size() * 0.8)
	var pool := {}
	var mul_stats := {}
	for f in Facts.sector_facts("mul-c"):
		pool[f.id] = true
		mul_stats[f.id] = stat(2)
	for pid in planet_ids("mul-c"):
		var ids := _play_checked(pid, 5, mul_stats)
		ok(ids.all(func(id): return pool.has(id)), pid)


func test_records_generated_problems_by_category_stat_id_missed_and_the_explanation_keep_the_actual_problem() -> void:
	var sim := BattleSim.new(cfg({"planet_id": planet_ids("add-100")[0]}))
	var e := first_spawn(sim)
	ok(_matches_re(e.fact.stat_id, "^cat:add-100:(carry|nocarry|easy)$"), e.fact.stat_id)
	answer(sim, e.fact.answer)
	like(sim.records[0], {"fact_id": e.fact.stat_id, "outcome": "fast"})
	var ev := run_until(sim, func(x): return x.any(func(y): return y.type == "impact"), 120_000, 50)
	var impact = _first_of(ev, "impact")
	if not not_null(impact):
		return
	ok(_matches_re(sim.state.missed[0].id, "^add:\\d+\\+\\d+$"), sim.state.missed[0].id)
	eq(sim.state.missed[0], impact.enemy.fact)
	eq(sim.state.explaining, impact.enemy.fact)
	var r: Dictionary = sim.records.back()
	eq(r.keys().size(), 3)
	eq(r.get("fact_id"), impact.enemy.fact.stat_id)
	eq(r.get("outcome"), "missed")
	ok(_is_num(r.get("response_ms")))


func test_the_auto_turret_uses_the_stat_id_it_fires_on_problems_of_a_mastered_category_only() -> void:
	var stats := {"cat:miss-add:left": stat(4), "cat:miss-add:right": stat(1)}
	# Several missions (the weak 'right' category is drawn more often, so one wave may have no 'left').
	var events: Array = []
	for from_seed in range(1, 60, 12):
		var sim := sim_offering("autoTurret", {"planet_id": planet_ids("miss-add")[0], "stats": stats, "modules": {"hull": 3}}, from_seed)
		if sim == null:
			return
		sim.pick_upgrade("autoTurret")
		var i := 0
		while i < 20000 and (sim.state.phase == "spawning" or sim.state.phase == "explaining"):
			events.append_array(advance(sim, 50))
			i += 1
	var kills := events.filter(func(e): return e.type == "kill" and e.by_turret)
	gt(kills.size(), 0)
	for k in kills:
		eq(k.enemy.fact.unknown, "a")


# ---------------------------------------------------------------- BattleSim armed enemies and hull (v6)

## The first enemy, made armed, parked on the fire line (speed 0 so it never lands).
func parked_armed(sim: BattleSim) -> Dictionary:
	var e := first_spawn(sim)
	e.armed = true
	e.y = float(Battle.FIRE_LINE_Y)
	e.speed = 0.0
	return e


func hits_by(ev: Array, id: int) -> Array:
	return ev.filter(func(x): return x.type == "shipHit" and x.enemy.id == id)


## update() in MAX_STEP_MS slices with every enemy but `e` disarmed, so only `e` can hit the
## hull (enemies spawned meanwhile pass the high fire line within a few seconds).
func update_solo(sim: BattleSim, e: Dictionary, ms: float) -> Array:
	var ev: Array = []
	var left := ms
	while left > 0:
		for x in sim.state.enemies:
			if not is_same(x, e):
				x.armed = false
		ev.append_array(sim.update(minf(Battle.MAX_STEP_MS, left)))
		left -= Battle.MAX_STEP_MS
	return ev


## update() without repelling, until the predicate holds.
func run_until_raw(sim: BattleSim, pred: Callable) -> Array:
	var all: Array = []
	var t := 0
	while t < 60_000:
		var ev := sim.update(16)
		all.append_array(ev)
		if pred.call(ev):
			return all
		t += 16
	fail("condition not reached")
	return all


## {sim, armed}
func boarded_sim(seed: int = 1) -> Dictionary:
	var sim := BattleSim.new(cfg({"seed": seed}))
	var armed := parked_armed(sim)
	sim.state.hull = 1
	run_until_raw(sim, func(x): return x.any(func(y): return y.type == "breach"))
	return {"sim": sim, "armed": armed}


func test_constants_and_helpers() -> void:
	# v9 balance: charging starts just below the spawn line, longer charge, two hull points.
	eq(Battle.FIRE_LINE_Y, 90)
	gt(Battle.FIRE_LINE_Y, Battle.SPAWN_Y)
	eq(Battle.HULL_MAX, 2)
	eq(Battle.CHARGE_MS, 6000)
	eq(Battle.BOARDING_KILL_POINTS, 10)
	eq(Boarding.BOARDING_CRAWLERS, 8)
	eq(Battle.ARMED_CHANCE, [0.4, 0.5, 0.6])
	eq([1, 2, 3, 4].map(func(w): return Battle.armed_chance(w)), Battle.ARMED_CHANCE + [Battle.ARMED_CHANCE.back()])
	eq(Battle.charge_ms(1), Battle.CHARGE_MS)
	eq(Battle.charge_ms(1.25), Battle.CHARGE_MS / 1.25)
	eq(Battle.charge_ms(0.5), Battle.CHARGE_MS * 2)
	eq(Battle.charge_ms(), Battle.CHARGE_MS)


func test_starts_with_a_full_hull_no_boardings_and_spawns_enemies_with_charge_0() -> void:
	var sim := BattleSim.new(cfg())
	like(sim.state, {"hull": Battle.HULL_MAX, "hull_max": Battle.HULL_MAX, "boardings": 0})
	var e := first_spawn(sim)
	eq(e.charge, 0)
	eq(e.armed, false)


func test_arms_enemies_with_chance_armed_chance_per_wave_the_first_enemy_of_a_mission_never() -> void:
	var armed := [0, 0, 0]
	var total := [0, 0, 0]
	for seed in range(1, 151):
		var sim := BattleSim.new(cfg({"seed": seed}))
		var first := true
		var guard := 0
		while sim.state.phase != "won":
			guard += 1
			if guard > 100:
				fail("seed %d: mission never won (phase %s)" % [seed, sim.state.phase])
				return
			var wave: int = sim.state.wave
			for x in clear_wave(sim):
				if x.type != "spawn":
					continue
				if first:
					eq(x.enemy.armed, false)
					first = false
					continue
				total[wave - 1] += 1
				if x.enemy.armed:
					armed[wave - 1] += 1
			if sim.state.phase == "waveCleared":
				sim.next_wave()
	eq(total[0], 150 * 7)
	for w in 3:
		lt(absf(float(armed[w]) / total[w] - Battle.ARMED_CHANCE[w]), 0.05, "wave %d" % (w + 1))


func _charge_case(scale: float) -> void:
	var sim := BattleSim.new(cfg({"speed_scale": scale}))
	var e := parked_armed(sim)
	var ms := Battle.charge_ms(scale)
	var ev := update_solo(sim, e, ms - 50)
	eq(hits_by(ev, e.id), [])
	close(e.charge, (ms - 50) / ms, 5)
	ev = update_solo(sim, e, 50)
	eq(hits_by(ev, e.id), [{"type": "shipHit", "enemy": e, "hull": Battle.HULL_MAX - 1}])
	eq(e.charge, 0)
	eq(sim.state.hull, Battle.HULL_MAX - 1)
	# Each further full charge is one more hit; the last one breaches.
	var hull := Battle.HULL_MAX - 2
	while hull >= 0:
		ev = update_solo(sim, e, ms)
		eq(hits_by(ev, e.id), [{"type": "shipHit", "enemy": e, "hull": hull}])
		eq(sim.state.hull, hull)
		eq(sim.state.phase, "spawning" if hull > 0 else "boarding")
		hull -= 1
	ok(ev.any(func(x): return x.type == "breach"))


func test_an_armed_enemy_below_the_fire_line_charges_for_charge_ms_1_and_fires_repeatedly() -> void:
	_charge_case(1)


func test_an_armed_enemy_below_the_fire_line_charges_for_charge_ms_1_25_and_fires_repeatedly() -> void:
	_charge_case(1.25)


func test_does_not_charge_above_the_fire_line_or_when_unarmed() -> void:
	var sim := BattleSim.new(cfg())
	var e := parked_armed(sim)
	e.y = Battle.FIRE_LINE_Y - 1.0
	update_solo(sim, e, Battle.charge_ms() * 1.5)
	eq(e.charge, 0)
	e.y = float(Battle.FIRE_LINE_Y)
	e.armed = false
	update_solo(sim, e, Battle.charge_ms() * 1.5)
	eq(e.charge, 0)
	eq(sim.state.hull, Battle.HULL_MAX)


func test_an_enemy_killed_mid_charge_never_fires() -> void:
	var sim := BattleSim.new(cfg())
	var e := parked_armed(sim)
	update_solo(sim, e, Battle.charge_ms() * 0.9)
	like(answer(sim, e.fact.answer)[0], {"type": "kill", "enemy": {"id": e.id}})
	var ev := update_solo(sim, e, Battle.charge_ms() * 2)
	eq(hits_by(ev, e.id), [])
	eq(sim.state.hull, Battle.HULL_MAX)


func test_charging_is_frozen_while_explaining() -> void:
	var sim := BattleSim.new(cfg())
	var e := parked_armed(sim)
	run_until(sim, func(_x): return sim.state.enemies.size() == 2)
	var other: Dictionary = sim.state.enemies.filter(func(x): return x.id != e.id)[0]
	other.y = Battle.IMPACT_Y - 0.01
	sim.update(16)
	eq(sim.state.phase, "explaining")
	var charge: float = e.charge
	gt(charge, 0)
	no(sim.update(Battle.EXPLAIN_MS - 100).any(func(x): return x.type == "shipHit"))
	eq(e.charge, charge)


func test_ship_hits_leave_domes_and_streak_alone_hull_0_breaches_and_freezes_the_sim_in_boarding() -> void:
	var sim := BattleSim.new(cfg())
	var e := parked_armed(sim)
	sim.state.streak = 5
	sim.state.hull = 1
	var domes := JSON.stringify(sim.state.domes)
	sim.type_digit(1)
	var ev := run_until_raw(sim, func(x): return x.any(func(y): return y.type == "breach"))
	var i := -1
	for k in ev.size():
		if ev[k].type == "shipHit":
			i = k
			break
	eq(ev.slice(i), [{"type": "shipHit", "enemy": e, "hull": 0}, {"type": "breach"}])
	like(sim.state, {"phase": "boarding", "hull": 0, "streak": 5, "input": ""})
	eq(JSON.stringify(sim.state.domes), domes)

	var frozen := JSON.stringify(sim.state)
	eq(sim.update(10_000), [])
	sim.type_digit(3)
	sim.toggle_sign()
	sim.backspace()
	eq(sim.submit(), [])
	eq(sim.next_wave(), [])
	eq(JSON.stringify(sim.state), frozen)


func test_resolve_boarding_repelled_records_and_kill_points_added_hull_refilled_charges_reset_play_resumes() -> void:
	var b := boarded_sim()
	var sim: BattleSim = b.sim
	var armed: Dictionary = b.armed
	var records := [{"fact_id": "type:3", "outcome": "fast", "response_ms": 900}]
	var before := {"score": sim.state.score, "kills": sim.state.kills, "records": sim.records.size()}
	armed.charge = 0.7
	eq(sim.resolve_boarding({"repelled": true, "records": records, "kills": 4}), [])
	like(sim.state, {
		"phase": "spawning", "hull": Battle.HULL_MAX, "boardings": 1, "score": before.score + 40, "kills": before.kills + 4,
	})
	eq(sim.records.slice(before.records), records)
	ok(sim.state.enemies.all(func(x): return x.charge == 0))
	eq(sim.resolve_boarding({"repelled": true, "records": records, "kills": 4}), [])   # not boarding: no-op
	eq(sim.state.boardings, 1)
	eq(sim.state.kills, before.kills + 4)
	# the armed enemy fires again after a full charge
	eq(hits_by(sim.update(Battle.charge_ms()), armed.id).size(), 1)


func test_resolve_boarding_not_repelled_the_mission_is_lost() -> void:
	var sim: BattleSim = boarded_sim().sim
	eq(sim.resolve_boarding({"repelled": false, "records": [], "kills": 2}), [{"type": "lost"}])
	like(sim.state, {"phase": "lost", "boardings": 0, "kills": 2, "score": 20})
	eq(sim.update(1000), [])


func test_boarding_facts_draws_problems_of_the_mission_from_the_scheduler_deterministically() -> void:
	var a: BattleSim = boarded_sim(7).sim
	var b: BattleSim = boarded_sim(7).sim
	var facts := a.boarding_facts()
	eq(facts.size(), Boarding.BOARDING_CRAWLERS)
	ok(facts.all(func(f): return f.op == "type" and f.answer >= 0 and f.answer <= 9))
	eq(b.boarding_facts(), facts)
	eq(a.boarding_facts(3).size(), 3)
