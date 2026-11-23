extends TestCase
## Port of tests/content.test.ts

const SECTOR_IDS := [
	"type-1", "type-2", "type-3",
	"add-5", "add-10", "add-15", "add-50", "add-100",
	"sub-5", "sub-10", "sub-15", "sub-50", "sub-100",
	"mul-a", "mul-b", "mul-c", "mul-d",
	"div-a", "div-b", "div-c", "div-d",
	"neg-10", "neg-20",
	"miss-add", "miss-sub", "miss-mul", "miss-div",
	"core",
]


## Distinct values of an array, sorted (a JS Set compared with toEqual).
static func _set_of(values: Array) -> Array:
	var d := {}
	for v in values:
		d[v] = true
	var out := d.keys()
	out.sort()
	return out


# ---------------------------------------------------------------- content structure

func test_has_the_sectors_of_architecture_md_in_order_grouped_by_skill() -> void:
	eq(Content.sectors().map(func(s): return s.id), SECTOR_IDS)
	var i := 0
	for s in Content.sectors():
		eq(s.order, i)
		eq(s.name_key, "meta.sector.%s" % s.id)
		i += 1
	eq(Content.skills(), ["typing", "addition", "subtraction", "multiplication", "division", "negatives", "missing", "mixed"])
	eq(Content.sectors_of_skill("multiplication").map(func(s): return s.id), ["mul-a", "mul-b", "mul-c", "mul-d"])


func test_has_the_expected_size_28_sectors_105_systems_405_planets() -> void:
	eq(Content.sectors().size(), 28)
	eq(Content.systems().size(), 105)
	eq(Content.planets().size(), 405)


func test_ids_are_unique_and_parents_match() -> void:
	eq(_set_of(Content.systems().map(func(s): return s.id)).size(), Content.systems().size())
	eq(_set_of(Content.planets().map(func(p): return p.id)).size(), Content.planets().size())
	for sector in Content.sectors():
		var n := 0
		for si in sector.systems.size():
			var system: Dictionary = sector.systems[si]
			eq(system.id, "%s.s%d" % [sector.id, si + 1])
			eq(system.sector_id, sector.id)
			for i in system.planets.size():
				var p: Dictionary = system.planets[i]
				n += 1
				eq(p.id, "%s.%d" % [sector.id, n])
				eq(p.system_id, system.id)
				eq(p.sector_id, sector.id)
				eq(p.orbit, i)
				ge(p.angle, 0)
				lt(p.angle, PI * 2)


func test_density_3_to_5_systems_per_sector_3_to_5_planets_per_system() -> void:
	eq([10, 40, 41, 150, 151, 5000].map(func(x): return Content.system_count_for(x)), [3, 3, 4, 4, 5, 5])
	for sector in Content.sectors():
		if sector.id == "core":
			continue
		eq(sector.systems.size(), Content.system_count_for(Content.sector_size(sector.id)), sector.id)
		ge(sector.systems.size(), Content.MIN_SYSTEMS_PER_SECTOR)
		le(sector.systems.size(), Content.MAX_SYSTEMS_PER_SECTOR)
		for s in sector.systems:
			ge(s.planets.size(), 3, s.id)
			le(s.planets.size(), 5, s.id)
	eq(_set_of(Content.sectors().map(func(s): return s.systems.size())), [1, 3, 4, 5])
	eq(_set_of(Content.systems().filter(func(s): return s.sector_id != "core").map(func(s): return s.planets.size())), [3, 4, 5])


func test_the_core_sector_is_one_system_with_one_planet() -> void:
	var core: Dictionary = Content.sector_by_id("core")
	eq(core.skill, "mixed")
	eq(core.systems.size(), 1)
	eq(core.systems[0].planets.map(func(p): return p.id), [Content.CORE_PLANET_ID])


func test_system_tier_index_of_the_system_in_its_sector_speeding_enemies_up_by_8_percent_per_tier() -> void:
	eq(Content.TIER_SPEED_STEP, 0.08)
	for sector in Content.sectors():
		for tier in sector.systems.size():
			for p in sector.systems[tier].planets:
				eq(Content.system_tier(p.id), tier)
				close(Content.tier_speed_factor(p.id), 1 + 0.08 * tier)
	var last: String = Content.sector_by_id("add-100").systems[4].planets[0].id
	close(Content.tier_speed_factor(last), 1.32)
	eq(Content.tier_speed_factor(Content.CORE_PLANET_ID), 1)
	eq(Content.system_tier("nope"), 0)
	eq(Content.tier_speed_factor("nope"), 1)


func test_lookups_work() -> void:
	var p: Dictionary = Content.planets()[40]
	ok(is_same(Content.planet_by_id(p.id), p))
	var sys = Content.system_of_planet(p.id)
	ok(sys != null and sys.planets.any(func(x): return is_same(x, p)))
	eq(Content.sector_of_planet(p.id).id, p.sector_id)
	eq(Content.system_by_id(p.system_id).id, p.system_id)
	is_null(Content.planet_by_id("mul-7"))
	is_null(Content.sector_of_planet("nope"))
	is_null(Content.system_by_id("nope"))
	is_null(Content.sector_by_id("nope"))
	eq(Content.planets_of_sector("nope"), [])
	ge(Content.planets_of_sector("mul-c").size(), 9)


# ---------------------------------------------------------------- generated names

func test_names_are_pronounceable_2_to_3_syllables_capitalised_unique_and_stable() -> void:
	var names: Array = Content.systems().map(func(s): return s.name) + Content.planets().map(func(p): return p.name)
	eq(_set_of(names).size(), names.size())
	var shape := RegEx.create_from_string("^[A-Z][a-z]{3,8}$")
	var harsh := RegEx.create_from_string("(?i)[aeiouy]{3}|[^aeiouy]{4}")
	for n in names:
		ok(shape.search(n) != null, n)
		ok(harsh.search(n) == null, n)
	var again := Names.create_name_registry()
	eq(again.name_for("system:x"), Names.create_name_registry().name_for("system:x"))
	eq(Names.name_from_seed(42), Names.name_from_seed(42))


func test_names_avoid_a_list_of_well_known_names() -> void:
	var names := {}
	for s in Content.systems():
		names[s.name.to_lower()] = true
	for p in Content.planets():
		names[p.name.to_lower()] = true
	for known in ["vulcan", "tatooine", "arrakis", "hoth", "endor", "vega", "rigel", "sirius", "kobol", "naboo"]:
		no(names.has(known), known)
