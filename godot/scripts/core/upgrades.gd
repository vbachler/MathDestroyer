class_name Upgrades
## Port of src/core/upgrades.ts: free in-mission upgrades picked after each cleared wave.
## UpgradeDef = {id, name_key, max_tier}; UpgradeOffer = {def, next_tier}.
## UpgradeEffects = {speed_mult, turret_cooldown_ms (null = no turret), score_mult, salvage_tier,
##                   repair_per_wave, shield_per_wave}

const UPGRADE_MAX_TIER := 3
const UPGRADE_IDS: Array[String] = ["slowField", "autoTurret", "overcharge", "salvage", "repairDrone", "shield"]

## Effect tables, index = tier - 1.
const SLOW_FIELD_SPEED: Array[float] = [0.9, 0.82, 0.75]
const AUTO_TURRET_COOLDOWN_MS: Array[int] = [7000, 5000, 3500]
const OVERCHARGE_SCORE: Array[float] = [1.25, 1.5, 2.0]
const SALVAGE_CREDIT_BONUS: Array[float] = [0.2, 0.4, 0.6]
const OFFERS_PER_BREAK := 3

static var _upgrades: Array = []


## TS UPGRADES.
static func upgrades() -> Array:
	if _upgrades.is_empty():
		for id in UPGRADE_IDS:
			_upgrades.append({"id": id, "name_key": "battle.upgrade.%s.name" % id, "max_tier": UPGRADE_MAX_TIER})
	return _upgrades


static func upgrade_by_id(id: String) -> Variant:
	for u in upgrades():
		if u.id == id:
			return u
	return null


static func _tier_of(owned: Dictionary, id: String) -> int:
	return owned.get(id, 0)


static func upgrade_effects(owned: Dictionary) -> Dictionary:
	var slow := _tier_of(owned, "slowField")
	var turret := _tier_of(owned, "autoTurret")
	var over := _tier_of(owned, "overcharge")
	return {
		"speed_mult": SLOW_FIELD_SPEED[slow - 1] if slow > 0 else 1.0,
		"turret_cooldown_ms": AUTO_TURRET_COOLDOWN_MS[turret - 1] if turret > 0 else null,
		"score_mult": OVERCHARGE_SCORE[over - 1] if over > 0 else 1.0,
		"salvage_tier": _tier_of(owned, "salvage"),
		"repair_per_wave": _tier_of(owned, "repairDrone"),
		"shield_per_wave": _tier_of(owned, "shield"),
	}


## Offer for the next tier of `d`, or null when it is already at max tier.
static func offer_for(d: Dictionary, owned: Dictionary) -> Variant:
	var tier: int = owned.get(d.id, 0)
	if tier >= d.max_tier:
		return null
	return {"def": d, "next_tier": tier + 1}


## Picks up to `count` distinct upgrade ids that are not at max tier.
static func pick_offer_ids(owned: Dictionary, rng: Rng, count: int = OFFERS_PER_BREAK) -> Array:
	var open: Array = []
	for u in upgrades():
		if owned.get(u.id, 0) < u.max_tier:
			open.append(u.id)
	return rng.shuffle(open).slice(0, count)


## headStart module: `count` distinct random upgrades at tier 1, chosen with the mission RNG.
static func head_start_upgrades(count: int, rng: Rng) -> Dictionary:
	var out := {}
	if count <= 0:
		return out
	var ids: Array = []
	for u in upgrades():
		ids.append(u.id)
	for id in rng.shuffle(ids).slice(0, count):
		out[id] = 1
	return out
