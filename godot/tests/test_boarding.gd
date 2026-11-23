extends TestCase
## Port of tests/boarding.test.ts

## Digits 0..7: eight problems with distinct answers.
var DIGITS: Array = Facts.sector_facts("type-1").slice(0, Boarding.BOARDING_CRAWLERS)


func _make(over: Dictionary = {}) -> BoardingSim:
	var cfg := {"facts": DIGITS, "seed": 1, "speed_scale": 1}
	cfg.merge(over, true)
	return BoardingSim.new(cfg)


func _answer(sim: BoardingSim, n: int) -> Array:
	for ch in str(absi(n)):
		sim.type_digit(int(ch))
	if n < 0:
		sim.toggle_sign()
	return sim.submit()


func _nearest(sim: BoardingSim) -> Dictionary:
	return Js.sorted(sim.state.crawlers, func(a, b): return a.z - b.z)[0]


func _run_until(sim: BoardingSim, pred: Callable, max_ms: int = 120_000, step: int = 16) -> Array:
	var all: Array = []
	var t := 0
	while t < max_ms:
		var ev := sim.step(step)
		all.append_array(ev)
		if pred.call(ev):
			return all
		t += step
	fail("condition not reached")
	return all


static func _has_type(ev: Array, type: String) -> bool:
	return ev.any(func(x): return x.type == type)


static func _find_type(ev: Array, type: String) -> Variant:
	for x in ev:
		if x.type == type:
			return x
	return null


func _first_spawn(sim: BoardingSim) -> Dictionary:
	var ev := _run_until(sim, func(e): return _has_type(e, "spawn"))
	var s = _find_type(ev, "spawn")
	if s == null:
		fail("no spawn")
		return {}
	return s.crawler


func _wrong_digit(sim: BoardingSim) -> int:
	var live := {}
	for c in sim.state.crawlers:
		live[c.fact.answer] = true
	for d in 10:
		if not live.has(d):
			return d
	fail("no free digit")
	return -1


## JSON.stringify (full precision, insertion order).
static func _js(v: Variant) -> String:
	return JSON.stringify(v, "", false, true)


## toMatchObject: every key of `expected` matches (recursively for dictionaries).
static func _matches(actual: Variant, expected: Variant) -> bool:
	if expected is Dictionary:
		if not actual is Dictionary:
			return false
		for k in expected.keys():
			if not actual.has(k) or not _matches(actual[k], expected[k]):
				return false
		return true
	if expected is Array:
		if not actual is Array or actual.size() != expected.size():
			return false
		for i in expected.size():
			if not _matches(actual[i], expected[i]):
				return false
		return true
	return deep_eq(actual, expected)


func match_obj(actual: Variant, expected: Variant, msg: String = "") -> bool:
	if _matches(actual, expected):
		return true
	fail("%sexpected %s to match %s" % [msg + ": " if msg != "" else "", show(actual), show(expected)])
	return false


# ---- BoardingSim setup and pacing

func test_setup_constants() -> void:
	eq(Boarding.CRAWLER_SPEED, {
		"scorpion": 1, "spider": 1.2, "crab": 0.85, "beetle": 1, "stalker": 1.15, "drifter": 0.9, "wraith": 0.8,
	})
	eq([Boarding.BOARDING_CRAWLERS, Boarding.BOARDING_MAX_ALIVE, Boarding.BOARDING_MAX_BITES], [8, 3, 3])
	eq([Boarding.APPROACH_MS, Boarding.BOARDING_SPAWN_MS, Boarding.BOARDING_FIRST_SPAWN_MS], [11000, 2600, 1200])


func test_setup_starts_fighting_with_every_problem_waiting() -> void:
	var sim := _make()
	eq(sim.state, {
		"phase": "fighting", "time_ms": 0, "crawlers": [], "input": "", "bites": 0, "max_bites": 3, "remaining": 8, "kills": 0,
	})
	eq(sim.records, [])


func _first_crawler_case(scale: float) -> void:
	var sim := _make({"speed_scale": scale})
	eq(sim.step(Boarding.BOARDING_FIRST_SPAWN_MS - 1), [])
	var ev := sim.step(1)
	eq(ev.size(), 1)
	if ev.size() != 1:
		return
	var c: Dictionary = ev[0].crawler
	match_obj(c, {"id": 1, "fact": DIGITS[0], "spawned_at": Boarding.BOARDING_FIRST_SPAWN_MS})
	close(c.z, 1 - c.speed / 1000.0, 9)   # spawned at 1, then moved for 1 ms
	has([-1, 0, 1], c.lane)
	close(c.speed, (Boarding.CRAWLER_SPEED[c.kind] * scale * 1000) / Boarding.APPROACH_MS, 9)
	eq(sim.state.remaining, 7)
	var interval := Boarding.BOARDING_SPAWN_MS / scale
	no(_has_type(sim.step(interval - 10), "spawn"))
	var next = _find_type(sim.step(10), "spawn")
	match_obj(next, {"crawler": {"id": 2, "fact": DIGITS[1]}})


func test_setup_first_crawler_after_1200_ms_then_every_2600_over_scale_0_5() -> void:
	_first_crawler_case(0.5)


func test_setup_first_crawler_after_1200_ms_then_every_2600_over_scale_0_75() -> void:
	_first_crawler_case(0.75)


func test_setup_first_crawler_after_1200_ms_then_every_2600_over_scale_1() -> void:
	_first_crawler_case(1)


func test_setup_first_crawler_after_1200_ms_then_every_2600_over_scale_1_25() -> void:
	_first_crawler_case(1.25)


func test_setup_never_more_than_3_alive_spawning_waits_at_the_cap() -> void:
	for seed in range(1, 21):
		var sim := _make({"seed": seed})
		var max_alive := 0
		var spawns := 0
		var i := 0
		while i < 5000 and sim.state.phase == "fighting":
			for e in sim.step(16):
				if e.type == "spawn":
					spawns += 1
			var alive: int = sim.state.crawlers.size()
			max_alive = maxi(max_alive, alive)
			if alive > Boarding.BOARDING_MAX_ALIVE:
				le(alive, Boarding.BOARDING_MAX_ALIVE, "seed %d" % seed)
			if spawns + sim.state.remaining != Boarding.BOARDING_CRAWLERS:
				eq(spawns + sim.state.remaining, Boarding.BOARDING_CRAWLERS, "seed %d" % seed)
			# answer slowly: only at the cap
			if alive == Boarding.BOARDING_MAX_ALIVE:
				_answer(sim, _nearest(sim).fact.answer)
			i += 1
		eq(max_alive, Boarding.BOARDING_MAX_ALIVE)
		eq(spawns, Boarding.BOARDING_CRAWLERS)
		eq(sim.state.phase, "repelled")


func test_setup_density_max_alive_2_below_1_otherwise_3() -> void:
	eq([0.5, 0.75, 1, 1.25].map(func(d): return Boarding.boarding_max_alive(d)), [2, 2, 3, 3])
	eq(Boarding.boarding_max_alive(), Boarding.BOARDING_MAX_ALIVE)


func _density_interval_case(density: float, scale: float) -> void:
	var sim := _make({"density": density, "speed_scale": scale})
	ok(_has_type(sim.step(Boarding.BOARDING_FIRST_SPAWN_MS), "spawn"))
	var interval := Boarding.BOARDING_SPAWN_MS / scale / density
	no(_has_type(sim.step(interval - 10), "spawn"))
	match_obj(_find_type(sim.step(10), "spawn"), {"crawler": {"id": 2}})


func _density_cap_case(density: float) -> void:
	var cap := Boarding.boarding_max_alive(density)
	for seed in range(1, 11):
		var sim := _make({"seed": seed, "density": density})
		var peak := 0
		var spawns := 0
		var i := 0
		while i < 10000 and sim.state.phase == "fighting":
			for e in sim.step(16):
				if e.type == "spawn":
					spawns += 1
			var alive: int = sim.state.crawlers.size()
			if alive > cap:
				le(alive, cap, "seed %d" % seed)
			peak = maxi(peak, alive)
			if alive == cap:
				_answer(sim, _nearest(sim).fact.answer)
			i += 1
		eq(peak, cap)
		eq(spawns, Boarding.BOARDING_CRAWLERS)
		eq(sim.state.phase, "repelled")


func test_setup_density_0_5_speed_0_5_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(0.5, 0.5)


func test_setup_density_0_5_speed_1_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(0.5, 1)


func test_setup_density_0_5_never_more_than_2_alive_all_8_crawlers_come() -> void:
	_density_cap_case(0.5)


func test_setup_density_0_75_speed_0_5_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(0.75, 0.5)


func test_setup_density_0_75_speed_1_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(0.75, 1)


func test_setup_density_0_75_never_more_than_2_alive_all_8_crawlers_come() -> void:
	_density_cap_case(0.75)


func test_setup_density_1_speed_0_5_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(1, 0.5)


func test_setup_density_1_speed_1_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(1, 1)


func test_setup_density_1_never_more_than_3_alive_all_8_crawlers_come() -> void:
	_density_cap_case(1)


func test_setup_density_1_25_speed_0_5_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(1.25, 0.5)


func test_setup_density_1_25_speed_1_spawn_every_2600_over_speed_times_density() -> void:
	_density_interval_case(1.25, 1)


func test_setup_density_1_25_never_more_than_3_alive_all_8_crawlers_come() -> void:
	_density_cap_case(1.25)


func test_setup_density_an_invalid_value_falls_back_to_1() -> void:
	for density in [NAN, 0, -2]:
		var sim := _make({"density": density})
		sim.step(Boarding.BOARDING_FIRST_SPAWN_MS)
		ok(_has_type(sim.step(Boarding.BOARDING_SPAWN_MS), "spawn"), str(density))


func test_setup_uses_every_kind_and_every_lane_over_a_few_seeds() -> void:
	var kinds := {}
	var lanes := {}
	for seed in range(1, 61):
		var sim := _make({"seed": seed})
		var i := 0
		while i < 5000 and sim.state.phase == "fighting":
			for e in sim.step(16):
				if e.type != "spawn":
					continue
				kinds[e.crawler.kind] = kinds.get(e.crawler.kind, 0) + 1
				lanes[e.crawler.lane] = true
			if sim.state.crawlers.size() == Boarding.BOARDING_MAX_ALIVE:
				_answer(sim, _nearest(sim).fact.answer)
			i += 1
	var got := kinds.keys()
	got.sort()
	var want: Array = Boarding.CRAWLER_KINDS.duplicate()
	want.sort()
	eq(got, want)
	eq(lanes.size(), 3)
	# Equally likely: every kind near 1/7 of the spawns.
	var total := 0
	for n in kinds.values():
		total += n
	for n in kinds.values():
		lt(absf(float(n) / total - 1.0 / Boarding.CRAWLER_KINDS.size()), 0.06)


func test_setup_has_seven_kinds() -> void:
	eq(Boarding.CRAWLER_KINDS, ["scorpion", "spider", "crab", "beetle", "stalker", "drifter", "wraith"])


func test_setup_lane_spacing_two_crawlers_on_one_lane_are_never_closer_than_0_25_in_z() -> void:
	for seed in range(1, 41):
		for scale in [0.75, 1.25]:
			# more problems than a boarding has, and nobody answers until the cap, to crowd the lanes
			var sim := _make({"seed": seed, "speed_scale": scale, "facts": DIGITS + DIGITS})
			var i := 0
			while i < 8000 and sim.state.phase == "fighting":
				sim.step(16)
				var cs: Array = sim.state.crawlers
				for a in cs:
					for b in cs:
						if a.id < b.id and a.lane == b.lane and absf(a.z - b.z) < Boarding.LANE_GAP_Z - 1e-9:
							ge(absf(a.z - b.z), Boarding.LANE_GAP_Z - 1e-9, "seed %d scale %s" % [seed, scale])
				if i % 200 == 0 and cs.size() > 0:
					_answer(sim, _nearest(sim).fact.answer)
				i += 1


# ---- BoardingSim answers

func test_answers_a_fast_correct_answer_kills_the_crawler_and_records_fast_by_stat_id() -> void:
	var sim := _make()
	var c := _first_spawn(sim)
	sim.step(500)
	var ev := _answer(sim, c.fact.answer)
	eq(ev, [{"type": "kill", "crawler": c, "fast": true}])
	match_obj(sim.state, {"kills": 1, "crawlers": [], "input": ""})
	eq(sim.records, [{"fact_id": c.fact.stat_id, "outcome": "fast", "response_ms": 500}])


func test_answers_a_slow_correct_answer_is_recorded_slow() -> void:
	var sim := _make()
	var c := _first_spawn(sim)
	sim.step(3500)
	match_obj(_answer(sim, c.fact.answer)[0], {"type": "kill", "fast": false})
	match_obj(sim.records[0], {"outcome": "slow"})


func test_answers_kills_the_nearest_smallest_z_crawler_whose_answer_matches() -> void:
	var sim := _make()
	_first_spawn(sim)
	_run_until(sim, func(_e): return sim.state.crawlers.size() == 2)
	var older: Dictionary = sim.state.crawlers[0]
	var newer: Dictionary = sim.state.crawlers[1]
	newer.fact = FactGen.make_fact("add", 0, older.fact.answer)
	lt(older.z, newer.z)
	match_obj(_answer(sim, older.fact.answer)[0], {"type": "kill", "crawler": {"id": older.id}})

	var sim2 := _make()
	_first_spawn(sim2)
	_run_until(sim2, func(_e): return sim2.state.crawlers.size() == 2)
	var a: Dictionary = sim2.state.crawlers[0]
	var b: Dictionary = sim2.state.crawlers[1]
	b.fact = FactGen.make_fact("add", 0, a.fact.answer)
	b.z = a.z - 0.1
	match_obj(_answer(sim2, a.fact.answer)[0], {"type": "kill", "crawler": {"id": b.id}})


func test_answers_a_wrong_answer_misses_recorded_once_against_the_nearest_a_later_kill_is_slow() -> void:
	var sim := _make()
	var c := _first_spawn(sim)
	var before := _js(sim.state.crawlers)
	var typed := _wrong_digit(sim)
	eq(_answer(sim, typed), [{"type": "wrong", "typed": typed}])
	eq(_js(sim.state.crawlers), before)
	match_obj(sim.state, {"kills": 0, "bites": 0, "input": ""})
	_answer(sim, _wrong_digit(sim))
	eq(sim.records, [{"fact_id": c.fact.stat_id, "outcome": "wrong", "response_ms": 0}])
	match_obj(_answer(sim, c.fact.answer)[0], {"type": "kill", "fast": false})
	eq(sim.records.map(func(r): return r.outcome), ["wrong", "slow"])


func test_answers_input_up_to_4_digits_backspace_empty_submit_noop_sign_only_with_negative_answer() -> void:
	var sim := _make()
	eq(sim.submit(), [])
	for d in [1, 2, 3, 4, 5]:
		sim.type_digit(d)
	eq(sim.state.input, "1234")
	sim.backspace()
	eq(sim.state.input, "123")
	sim.toggle_sign()
	eq(sim.state.input, "123")
	var c := _first_spawn(sim)
	c.fact = FactGen.make_fact("sub", 3, 7)
	sim.toggle_sign()
	eq(sim.state.input, "-123")
	sim.backspace()
	sim.backspace()
	sim.backspace()
	sim.type_digit(4)
	match_obj(sim.submit()[0], {"type": "kill", "crawler": {"id": c.id}})


# ---- BoardingSim bites, overrun and repelled

func test_bites_a_crawler_reaching_the_turret_bites_and_is_recorded_missed_3_bites_overrun() -> void:
	var sim := _make()
	var ev := _run_until(sim, func(e): return _has_type(e, "overrun"))
	var bites := ev.filter(func(x): return x.type == "bite")
	eq(bites.size(), Boarding.BOARDING_MAX_BITES)
	eq(ev.back(), {"type": "overrun"})
	match_obj(sim.state, {"phase": "overrun", "bites": 3})
	for b in bites:
		eq(b.crawler.z, 0)
		no(sim.state.crawlers.any(func(x): return deep_eq(x, b.crawler)))
		var expected_ms: float = Boarding.APPROACH_MS / Boarding.CRAWLER_SPEED[b.crawler.kind]
		var rec = null
		for r in sim.records:
			if r.fact_id == b.crawler.fact.stat_id:
				rec = r
				break
		eq(rec.outcome if rec != null else null, "missed")
		le(absf((rec.response_ms if rec != null else 0) - expected_ms), 16)
	# frozen afterwards
	var frozen := _js(sim.state)
	eq(sim.step(10_000), [])
	sim.type_digit(1)
	eq(sim.submit(), [])
	eq(_js(sim.state), frozen)


func test_bites_one_bite_does_not_end_the_fight() -> void:
	var sim := _make()
	var ev := _run_until(sim, func(e): return _has_type(e, "bite"))
	eq(ev.filter(func(x): return x.type == "bite").size(), 1)
	match_obj(sim.state, {"phase": "fighting", "bites": 1})


func test_bites_every_crawler_destroyed_repelled_from_submit_then_frozen() -> void:
	var sim := _make()
	var all: Array = []
	var i := 0
	while i < 10_000 and sim.state.phase == "fighting":
		all.append_array(sim.step(16))
		while sim.state.phase == "fighting" and sim.state.crawlers.size() > 0:
			all.append_array(_answer(sim, _nearest(sim).fact.answer))
		i += 1
	match_obj(sim.state, {"phase": "repelled", "kills": 8, "bites": 0, "remaining": 0, "crawlers": []})
	eq(all.back(), {"type": "repelled"})
	eq(all.filter(func(x): return x.type == "kill").size(), 8)
	eq(sim.records.map(func(r): return r.fact_id), DIGITS.map(func(f): return f.stat_id))
	ok(sim.records.all(func(r): return r.outcome == "fast"))
	eq(sim.step(5000), [])


func test_bites_repelled_with_bites_below_the_limit() -> void:
	var sim := _make({"facts": DIGITS.slice(0, 2)})
	_run_until(sim, func(e): return _has_type(e, "bite"))
	var i := 0
	while i < 10_000 and sim.state.phase == "fighting":
		sim.step(16)
		if sim.state.crawlers.size() > 0:
			_answer(sim, _nearest(sim).fact.answer)
		i += 1
	match_obj(sim.state, {"phase": "repelled", "bites": 1, "kills": 1})


func test_bites_no_problems_repelled_at_once() -> void:
	var sim := _make({"facts": []})
	eq(sim.step(16), [{"type": "repelled"}])


# ---- BoardingSim determinism

func _script(seed: int, speed_scale: float = 1) -> String:
	var sim := _make({"seed": seed, "speed_scale": speed_scale})
	var log: Array = []
	var tick := 0
	while tick < 4000 and sim.state.phase == "fighting":
		log.append_array(sim.step(23 + (tick % 7) * 9))
		if sim.state.crawlers.size() > 0:
			if tick % 31 == 0:
				log.append_array(_answer(sim, _wrong_digit(sim)))
			elif tick % 47 == 0:
				log.append_array(_answer(sim, _nearest(sim).fact.answer))
		tick += 1
	return _js({"state": sim.state, "records": sim.records, "log": log})


func test_determinism_same_config_and_calls_give_the_same_result_another_seed_differs() -> void:
	for scale in [0.75, 1, 1.25]:
		var a := _script(5, scale)
		eq(_script(5, scale), a)
		ne(_script(6, scale), a)
		var phase: String = JSON.parse_string(a).state.phase
		ok(phase.contains("repelled") or phase.contains("overrun"), phase)


func test_determinism_step_clamps_negative_time_and_sub_steps_long_frames() -> void:
	var a := _make()
	eq(a.step(-500), [])
	eq(a.state.time_ms, 0)
	var b := _make()
	a.step(4000)
	for i in 80:
		b.step(50)
	eq(_js(a.state), _js(b.state))


func test_determinism_falls_back_to_speed_scale_1_for_an_invalid_value() -> void:
	var c := _first_spawn(_make({"speed_scale": NAN}))
	close(c.speed, (Boarding.CRAWLER_SPEED[c.kind] * 1000) / Boarding.APPROACH_MS, 9)
