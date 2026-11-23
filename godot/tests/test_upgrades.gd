extends TestCase
## Port of tests/upgrades.test.ts


func test_defines_the_six_free_upgrades_max_tier_3_no_costs_or_descriptions() -> void:
	eq(Upgrades.upgrades().map(func(u): return u.id), ["slowField", "autoTurret", "overcharge", "salvage", "repairDrone", "shield"])
	for u in Upgrades.upgrades():
		eq(u, {"id": u.id, "name_key": "battle.upgrade.%s.name" % u.id, "max_tier": 3})
	is_null(Upgrades.upgrade_by_id("collector"))


## toMatchObject: every key of `subset` equals the same key of `actual`.
func _match(actual: Dictionary, subset: Dictionary) -> void:
	for k in subset:
		ok(actual.has(k), k)
		eq(actual.get(k), subset[k], k)


func test_upgrade_effects_maps_tiers_to_effects() -> void:
	eq(Upgrades.upgrade_effects({}), {
		"speed_mult": 1, "turret_cooldown_ms": null, "score_mult": 1, "salvage_tier": 0, "repair_per_wave": 0, "shield_per_wave": 0,
	})
	eq(Upgrades.upgrade_effects({"slowField": 1, "autoTurret": 1, "overcharge": 1, "salvage": 1, "repairDrone": 1, "shield": 1}), {
		"speed_mult": 0.9, "turret_cooldown_ms": 7000, "score_mult": 1.25, "salvage_tier": 1, "repair_per_wave": 1, "shield_per_wave": 1,
	})
	_match(Upgrades.upgrade_effects({"slowField": 2, "autoTurret": 2, "overcharge": 2, "shield": 2}), {
		"speed_mult": 0.82, "turret_cooldown_ms": 5000, "score_mult": 1.5, "shield_per_wave": 2,
	})
	_match(Upgrades.upgrade_effects({"slowField": 3, "autoTurret": 3, "overcharge": 3, "shield": 3, "repairDrone": 3}), {
		"speed_mult": 0.75, "turret_cooldown_ms": 3500, "score_mult": 2, "shield_per_wave": 3, "repair_per_wave": 3,
	})


func test_offer_for_gives_the_next_tier_null_at_max() -> void:
	var slow: Dictionary = Upgrades.upgrade_by_id("slowField")
	eq(Upgrades.offer_for(slow, {}), {"def": slow, "next_tier": 1})
	eq(Upgrades.offer_for(slow, {"slowField": 1}), {"def": slow, "next_tier": 2})
	is_null(Upgrades.offer_for(slow, {"slowField": 3}))


func test_pick_offer_ids_returns_3_distinct_upgrades_not_at_max_tier() -> void:
	for seed in range(1, 50):
		var ids := Upgrades.pick_offer_ids({"overcharge": 3, "salvage": 3}, Rng.new(seed))
		eq(ids.size(), 3)
		var uniq := {}
		for id in ids:
			uniq[id] = true
		eq(uniq.size(), 3)
		no(ids.has("overcharge"))
		no(ids.has("salvage"))
	var almost_all := {"slowField": 3, "autoTurret": 3, "overcharge": 3, "salvage": 3, "repairDrone": 3}
	eq(Upgrades.pick_offer_ids(almost_all, Rng.new(1)), ["shield"])
	var all := almost_all.duplicate()
	all["shield"] = 3
	eq(Upgrades.pick_offer_ids(all, Rng.new(1)), [])


func test_head_start_upgrades_picks_count_distinct_upgrades_at_tier_1_deterministic_per_seed() -> void:
	eq(Upgrades.head_start_upgrades(0, Rng.new(1)), {})
	for count in [1, 2, 3]:
		var a := Upgrades.head_start_upgrades(count, Rng.new(42))
		eq(a.keys().size(), count)
		ok(a.values().all(func(t): return t == 1))
		ok(a.keys().all(func(id): return Upgrades.upgrade_by_id(id) != null))
		eq(Upgrades.head_start_upgrades(count, Rng.new(42)), a)
