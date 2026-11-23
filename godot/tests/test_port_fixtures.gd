extends TestCase
## Port-only tests: the GDScript core reproduces the TS core exactly. Reference data in
## res://tests/fixtures/*.json was produced by running src/core with vitest (see tools/godot-fixtures.gen.ts.txt).


func _camel(key: String) -> String:
	var parts := key.split("_")
	var out := parts[0]
	for i in range(1, parts.size()):
		out += parts[i].capitalize().replace(" ", "")
	return out


func test_galaxy_layout_and_names_match_ts() -> void:
	var fx: Array = fixture("galaxy")
	var sectors := Content.sectors()
	eq(sectors.size(), fx.size(), "sector count")
	for i in mini(sectors.size(), fx.size()):
		var s: Dictionary = sectors[i]
		var t: Dictionary = fx[i]
		for k in ["id", "skill", "x", "y", "radius", "order"]:
			eq(s[k], t[k], "sector %s.%s" % [s.id, k])
		eq(s.name_key, t.nameKey)
		close(s.hue, t.hue, 9, "hue of %s" % s.id)
		eq(s.systems.size(), t.systems.size(), "systems of %s" % s.id)
		for j in mini(s.systems.size(), t.systems.size()):
			var sy: Dictionary = s.systems[j]
			var ty: Dictionary = t.systems[j]
			for k in ["id", "name", "x", "y"]:
				eq(sy[k], ty[k], "system %s.%s" % [sy.id, k])
			eq(sy.sun_hue, ty.sunHue, "sun hue of %s" % sy.id)
			eq(sy.planets.size(), ty.planets.size(), "planets of %s" % sy.id)
			for p in mini(sy.planets.size(), ty.planets.size()):
				var pp: Dictionary = sy.planets[p]
				var tp: Dictionary = ty.planets[p]
				eq([pp.id, pp.name, pp.orbit, pp.system_id, pp.sector_id], [tp.id, tp.name, tp.orbit, tp.systemId, tp.sectorId])
				eqf(pp.angle, tp.angle, "angle of %s" % pp.id)


func test_sector_pools_and_generated_problems_match_ts() -> void:
	var fx: Dictionary = fixture("facts")
	for s in Content.sectors():
		var kind = FactGen.sector_kind(s.id)
		if kind == "enumerated":
			var ids: Array = FactGen.sector_facts(s.id).map(func(f): return f.id)
			eq(ids, fx[s.id], "pool of %s" % s.id)
		elif kind == "generated":
			var r := Rng.new(99)
			var ids: Array = []
			for c in FactGen.sector_categories(s.id):
				for k in 5:
					ids.append(FactGen.generate_fact(s.id, c, r).id)
			eq(ids, fx[s.id], "generated problems of %s" % s.id)
		else:
			no(fx.has(s.id))


func test_scheduler_waves_match_ts() -> void:
	var fx: Dictionary = fixture("scheduler")
	for planet_id in fx.keys():
		var s := Scheduler.create_mission_scheduler({"planet_id": planet_id, "stats": {}, "planets": {}, "now": NOW, "rng": Rng.new(5)})
		var ids: Array = (s.wave(0, 8) + s.wave(1, 10) + s.wave(2, 12)).map(func(f): return f.id)
		eq(ids, fx[planet_id], "waves of %s" % planet_id)


func test_scripted_battle_matches_ts() -> void:
	var fx: Dictionary = fixture("battle")
	var sim := BattleSim.new({
		"planet_id": "add-10.1", "total_waves": 3, "stats": {}, "planets": {}, "modules": {"headStart": 2, "hull": 1},
		"now": NOW, "seed": 7, "speed_scale": 1.08, "density": 1,
	})
	var log: Array = []
	var i := 0
	while i < 2500 and sim.state.phase != "won" and sim.state.phase != "lost":
		var ev := sim.update(120 if i % 3 == 0 else 33)
		for e in ev:
			var entry := {"step": i, "type": e.type}
			if e.has("enemy"):
				entry["enemy"] = e.enemy.id
				entry["fact"] = e.enemy.fact.id
			log.append(entry)
		if sim.state.phase == "waveCleared":
			var offers := sim.offers()
			var ev2 := sim.pick_upgrade(offers[i % offers.size()].def.id) if offers.size() > 0 else sim.next_wave()
			log.append({"step": i, "type": "picked", "ids": offers.map(func(o): return o.def.id), "n": ev2.size()})
		if sim.state.phase == "boarding":
			var facts := sim.boarding_facts()
			sim.resolve_boarding({"repelled": true, "records": [], "kills": 3})
			log.append({"step": i, "type": "boarded", "facts": facts.map(func(f): return f.id)})
		if i % 7 == 0 and sim.state.enemies.size() > 0:
			var target: Dictionary = Js.sorted(sim.state.enemies, func(a, b): return b.y - a.y)[0]
			for ch in Js.num_str(target.fact.answer):
				if ch == "-":
					sim.toggle_sign()
				else:
					sim.type_digit(int(ch))
			if target.fact.answer < 0 and not sim.state.input.begins_with("-"):
				sim.toggle_sign()
			var ev3 := sim.submit()
			log.append({"step": i, "type": "submit", "events": ev3.map(func(e): return e.type)})
		elif i % 23 == 0:
			sim.type_digit(9)
			sim.type_digit(9)
			sim.type_digit(9)
			log.append({"step": i, "type": "submitWrong", "events": sim.submit().map(func(e): return e.type)})
		i += 1
	var ref_log: Array = fx.log
	eq(log.size(), ref_log.size(), "log length")
	for k in mini(log.size(), ref_log.size()):
		if not eqf(log[k], ref_log[k], "log entry %d" % k):
			break
	var records: Array = sim.records.map(func(r): return {"factId": r.fact_id, "outcome": r.outcome, "responseMs": r.response_ms})
	eqf(records, fx.records, "records")
	var st := sim.state
	var f: Dictionary = fx.final
	eqf([st.phase, st.time_ms, st.wave, st.score, st.streak, st.best_streak, st.kills, st.wrong_answers, st.hull, st.boardings],
		[f.phase, f.timeMs, f.wave, f.score, f.streak, f.bestStreak, f.kills, f.wrongAnswers, f.hull, f.boardings], "final state")
	eq(st.owned_upgrades, f.ownedUpgrades, "owned upgrades")
	eq(st.domes.map(func(d): return {"hp": d.hp, "maxHp": d.max_hp}), f.domes, "domes")
	eq(st.missed.map(func(x): return x.id), f.missed, "missed")
	eqf(sim.accuracy(), f.accuracy, "accuracy")


func test_scripted_boarding_matches_ts() -> void:
	var fx: Dictionary = fixture("boarding")
	var b := BoardingSim.new({"facts": FactGen.sector_facts("mul-c").slice(0, 8), "seed": 11, "speed_scale": 1.25, "density": 0.75})
	var log: Array = []
	var i := 0
	while i < 2000 and b.state.phase == "fighting":
		for e in b.step(70 if i % 2 == 0 else 45):
			var entry := {"step": i, "type": e.type}
			if e.has("crawler"):
				entry.merge({"id": e.crawler.id, "kind": e.crawler.kind, "lane": e.crawler.lane, "z": e.crawler.z})
			log.append(entry)
		if i % 31 == 0 and b.state.crawlers.size() > 0:
			var c: Dictionary = b.state.crawlers[0]
			for ch in Js.num_str(c.fact.answer):
				b.type_digit(int(ch))
			log.append({"step": i, "type": "submit", "events": b.submit().map(func(e): return e.type)})
		elif i % 47 == 0:
			b.type_digit(1)
			log.append({"step": i, "type": "submitWrong", "events": b.submit().map(func(e): return e.type)})
		i += 1
	eqf(log, fx.log, "log")
	eqf(b.records.map(func(r): return {"factId": r.fact_id, "outcome": r.outcome, "responseMs": r.response_ms}), fx.records, "records")
	var st := b.state
	var f: Dictionary = fx.final
	eqf([st.phase, st.time_ms, st.input, st.bites, st.max_bites, st.remaining, st.kills, st.crawlers.map(func(c): return c.id)],
		[f.phase, f.timeMs, f.input, f.bites, f.maxBites, f.remaining, f.kills, f.crawlers], "final state")
