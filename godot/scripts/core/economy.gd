class_name Economy
## Port of src/core/economy.ts: station modules and mission credits.
## ModuleDef = {id, name_key, desc_key, max_tier, costs}; ModuleId = "hull" | "headStart" | "targeting".

static var _modules: Array = []


static func _def(id: String, costs: Array) -> Dictionary:
	return {
		"id": id,
		"name_key": "meta.module.%s.name" % id,
		"desc_key": "meta.module.%s.desc" % id,
		"max_tier": costs.size(),
		"costs": costs,
	}


## TS MODULES.
static func modules() -> Array:
	if _modules.is_empty():
		_modules = [
			_def("hull", [150, 400, 900]),
			_def("headStart", [100, 300, 700]),
			_def("targeting", [120, 350, 800]),
		]
	return _modules


static func module_by_id(id: String) -> Variant:
	for m in modules():
		if m.id == id:
			return m
	return null


## Owned tier of a station module (0 if not owned).
static func module_tier(owned: Dictionary, id: String) -> int:
	return owned.get(id, 0)


## hull: +1 dome hp per tier.
static func hull_bonus_hp(tier: int) -> int:
	return tier


## headStart: start each mission with 1 / 2 / 3 random upgrades at tier 1.
static func head_start_upgrade_count(tier: int) -> int:
	return tier


## targeting: fast-answer threshold multiplier for scoring only (1.1 / 1.2 / 1.3).
static func targeting_multiplier(tier: int) -> float:
	return 1.0 + 0.1 * tier


## Price of the next tier, or null when maxed or unknown.
static func next_module_cost(owned: Dictionary, module_id: String) -> Variant:
	var m = module_by_id(module_id)
	if m == null:
		return null
	var tier: int = owned.get(module_id, 0)
	return null if tier >= m.max_tier else m.costs[tier]


## args = {score, won, domes_standing, salvage_tier}
static func mission_credits(args: Dictionary) -> int:
	return Js.round((args.score / 10.0 + (30.0 if args.won else 0.0) + 5.0 * args.domes_standing) * (1.0 + 0.2 * args.salvage_tier))


## Buys the next tier. Returns a new SaveData, or null if unaffordable, maxed or unknown.
static func buy_module(save: Dictionary, module_id: String) -> Variant:
	var cost = next_module_cost(save.modules, module_id)
	if cost == null or save.credits < cost:
		return null
	var out := save.duplicate()
	out.credits = save.credits - cost
	var mods: Dictionary = save.modules.duplicate()
	mods[module_id] = mods.get(module_id, 0) + 1
	out.modules = mods
	return out
