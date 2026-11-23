extends TestCase
## Port of tests/galaxy.test.ts


# ---------------------------------------------------------------- galaxy layout

func test_is_deterministic() -> void:
	var sectors := Content.sectors()
	var slots: Array = sectors.map(func(s): return {"radius": s.radius, "group": s.skill})
	eq(Layout.place_sectors(slots), Layout.place_sectors(slots))
	var disc := {"x": 1000, "y": 1000, "radius": 300}
	eq(Layout.scatter_systems(disc, 4, [], 7), Layout.scatter_systems(disc, 4, [], 7))
	# The content uses exactly this placement (core first, then galaxy order).
	var order: Array = [sectors[sectors.size() - 1]] + sectors.slice(0, -1)
	var placed: Array = Layout.place_sectors(order.map(func(s): return {"radius": s.radius, "group": s.skill}))
	for i in order.size():
		eq([order[i].x, order[i].y], [placed[i].x, placed[i].y])


func test_keeps_every_sector_disc_and_system_inside_the_4800x2700_world() -> void:
	eq([Galaxy.WORLD_W, Galaxy.WORLD_H], [4800, 2700])
	for s in Content.sectors():
		ge(s.x - s.radius, 0)
		le(s.x + s.radius, Galaxy.WORLD_W)
		ge(s.y - s.radius, 0)
		le(s.y + s.radius, Galaxy.WORLD_H)
	for y in Content.systems():
		ge(y.x, 0)
		le(y.x, Galaxy.WORLD_W)
		ge(y.y, 0)
		le(y.y, Galaxy.WORLD_H)


func test_radius_grows_with_the_system_count() -> void:
	gt(Galaxy.sector_radius(2), Galaxy.sector_radius(1))
	for s in Content.sectors():
		eq(s.radius, Galaxy.sector_radius(s.systems.size()))


func test_no_two_sector_discs_overlap_by_more_than_15_percent() -> void:
	var sectors := Content.sectors()
	for i in sectors.size():
		for j in range(i + 1, sectors.size()):
			le(Galaxy.disc_overlap(sectors[i], sectors[j]), Galaxy.MAX_SECTOR_OVERLAP, "%s / %s" % [sectors[i].id, sectors[j].id])
	eq(Galaxy.disc_overlap({"x": 0, "y": 0, "radius": 10}, {"x": 100, "y": 0, "radius": 10}), 0)
	eq(Galaxy.disc_overlap({"x": 0, "y": 0, "radius": 10}, {"x": 0, "y": 0, "radius": 10}), 1)


func test_systems_are_at_least_70_units_apart_and_lie_inside_their_sector() -> void:
	eq(Galaxy.MIN_SYSTEM_SPACING, 70)
	var systems := Content.systems()
	for i in systems.size():
		for j in range(i + 1, systems.size()):
			var d := Js.hypot(systems[i].x - systems[j].x, systems[i].y - systems[j].y)
			ge(d, Galaxy.MIN_SYSTEM_SPACING, "%s / %s" % [systems[i].id, systems[j].id])
	for y in systems:
		var s: Dictionary = Content.sector_by_id(y.sector_id)
		le(Js.hypot(y.x - s.x, y.y - s.y), s.radius)


func test_every_sector_keeps_a_band_free_for_its_name() -> void:
	for s in Content.sectors():
		ok(Layout.has_name_band(s, s.systems), s.id)
	var points: Array = [-0.6, -0.35, 0, 0.35, 0.6].map(func(k): return {"x": 0, "y": k * 300})
	no(Layout.has_name_band({"x": 0, "y": 0, "radius": 300}, points))


func test_the_core_sits_at_the_centre_and_the_skills_spiral_around_it() -> void:
	var core: Dictionary = Content.sector_by_id("core")
	eq([core.x, core.y], [Galaxy.WORLD_W / 2.0, Galaxy.WORLD_H / 2.0])
	# Sectors of one skill stay together: each one's nearest other sector of the same skill is close.
	var sectors := Content.sectors()
	for s in sectors:
		var same: Array = sectors.filter(func(o): return o.skill == s.skill and not is_same(o, s))
		if same.is_empty():
			continue
		var nearest := INF
		var widest := -INF
		for o in same:
			nearest = minf(nearest, Js.hypot(o.x - s.x, o.y - s.y))
			widest = maxf(widest, o.radius)
		le(nearest, s.radius + widest + 200, s.id)


func test_hues_one_family_per_skill_different_skills_clearly_apart() -> void:
	var sectors := Content.sectors()
	for a in sectors:
		for b in sectors:
			if is_same(a, b):
				continue
			if a.skill == b.skill:
				le(Galaxy.hue_distance(a.hue, b.hue), 20)
				gt(Galaxy.hue_distance(a.hue, b.hue), 0)
			else:
				ge(Galaxy.hue_distance(a.hue, b.hue), 25, "%s / %s" % [a.id, b.id])
	for y in Content.systems():
		ge(y.sun_hue, 0)
		lt(y.sun_hue, 360)
	eq(Galaxy.hue_distance(350, 10), 20)


# ---------------------------------------------------------------- territory (planet progress)

func _p(i: int) -> String:
	return planet_ids("add-5")[i]


func test_planet_hold_level_0_hostile_1_to_2_contested_3_plus_secured() -> void:
	var p1 := _p(0)
	var hold := func(level: int) -> String: return Galaxy.planet_hold(p1, {"planets": {p1: progress(level)}})
	eq(Galaxy.planet_hold(p1, {"planets": {}}), "hostile")
	eq([0, 1, 2, 3, 4, 5].map(hold), ["hostile", "contested", "contested", "secured", "secured", "secured"])
	eq(Galaxy.planet_hold("nope", {"planets": {}}), "hostile")


func test_under_attack_level_1_plus_and_now_at_or_after_due_at() -> void:
	var p1 := _p(0)
	var at := func(level: int, due_at: float) -> bool:
		return Galaxy.under_attack(p1, {"planets": {p1: progress(level, {"due_at": due_at})}}, NOW)
	eq(at.call(0, NOW - 1), false)
	eq(at.call(1, NOW + 1), false)
	eq(at.call(1, NOW), true)
	eq(at.call(5, NOW - DAY), true)
	eq(Galaxy.under_attack(p1, {"planets": {}}, NOW), false)


func test_system_mastery_and_sector_mastery_are_means_of_planet_mastery_over_their_planets() -> void:
	var p1 := _p(0)
	var p2 := _p(1)
	var p3 := _p(2)
	var system: Dictionary = Content.sector_by_id("add-5").systems[0]
	var n: int = system.planets.size()
	var save := {"planets": {p1: progress(5), p2: progress(2)}}
	eq(system.planets.map(func(p): return p.id).slice(0, 2), [p1, p2])
	close(Galaxy.system_mastery(system.id, save), (1 + 0.4) / n)
	eq(Galaxy.system_mastery(system.id, {"planets": {}}), 0)
	eq(Galaxy.system_mastery("nope", save), 0)
	var all := planet_ids("add-5")
	close(Galaxy.sector_mastery("add-5", save), 1.4 / all.size())
	var full := {}
	for id in all:
		full[id] = progress(5)
	eq(Galaxy.sector_mastery("add-5", {"planets": full}), 1)
	eq(Galaxy.sector_mastery("nope", save), 0)
	not_null(p3)
