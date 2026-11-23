extends TestCase
## Port of tests/economy.test.ts


## {...defaultSave(), ...over}
static func _save(over: Dictionary) -> Dictionary:
	var s := Save.default_save()
	s.merge(over, true)
	return s


func test_defines_the_station_modules_with_the_documented_costs() -> void:
	var costs := {}
	for m in Economy.modules():
		costs[m.id] = m.costs
	eq(costs, {
		"hull": [150, 400, 900],
		"headStart": [100, 300, 700],
		"targeting": [120, 350, 800],
	})
	for m in Economy.modules():
		eq(m.name_key, "meta.module.%s.name" % m.id)
		eq(m.desc_key, "meta.module.%s.desc" % m.id)


func test_module_effects() -> void:
	eq(Economy.hull_bonus_hp(2), 2)
	eq([0, 1, 2, 3].map(func(t): return Economy.head_start_upgrade_count(t)), [0, 1, 2, 3])
	eq(Economy.targeting_multiplier(0), 1)
	close(Economy.targeting_multiplier(3), 1.3)


func test_mission_credits_follows_the_formula() -> void:
	eq(Economy.mission_credits({"score": 0, "won": false, "domes_standing": 0, "salvage_tier": 0}), 0)
	eq(Economy.mission_credits({"score": 250, "won": true, "domes_standing": 4, "salvage_tier": 0}), 75)
	eq(Economy.mission_credits({"score": 250, "won": true, "domes_standing": 4, "salvage_tier": 2}), 105)
	eq(Economy.mission_credits({"score": 123, "won": false, "domes_standing": 1, "salvage_tier": 1}), Js.round((12.3 + 5) * 1.2))
	eq(Economy.mission_credits({"score": 5, "won": false, "domes_standing": 0, "salvage_tier": 0}), 1) # round(0.5)


func test_buy_module_spends_credits_and_raises_the_tier() -> void:
	var save := _save({"credits": 500})
	var after = Economy.buy_module(save, "hull")
	if not not_null(after):
		return
	eq(after.credits, 350)
	eq(after.modules.hull, 1)
	eq(save.credits, 500)
	no(save.modules.has("hull"))
	eq(Economy.next_module_cost(after.modules, "hull"), 400)


func test_buy_module_returns_null_when_unaffordable_maxed_or_unknown() -> void:
	is_null(Economy.buy_module(_save({"credits": 99}), "headStart"))
	not_null(Economy.buy_module(_save({"credits": 100}), "headStart"))
	is_null(Economy.buy_module(_save({"credits": 99999, "modules": {"hull": 3}}), "hull"))
	is_null(Economy.buy_module(_save({"credits": 99999}), "warpDrive"))
	is_null(Economy.buy_module(_save({"credits": 99999}), "reactor"))
