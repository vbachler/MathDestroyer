extends TestCase
## Port of tests/mapLayout.test.ts



func _overlaps(a: Dictionary, b: Dictionary) -> bool:
	return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h


# ------------------------------------------------------------------ galaxy camera

func test_maps_the_view_centre_to_the_screen_centre_and_round_trips() -> void:
	var view := {"cx": 2400.0, "cy": 1350.0, "zoom": 0.5}
	eq(MapLayout.world_to_screen_x(view, 2400), MapLayout.VIEW_W / 2.0)
	eq(MapLayout.world_to_screen_y(view, 1350), MapLayout.VIEW_H / 2.0)
	close(MapLayout.screen_to_world_x(view, MapLayout.world_to_screen_x(view, 3111)), 3111)
	close(MapLayout.screen_to_world_y(view, MapLayout.world_to_screen_y(view, 777)), 777)
	eq(MapLayout.world_to_screen_x(view, 2400 + 100), MapLayout.VIEW_W / 2.0 + 50)


func test_zooming_keeps_the_world_point_under_the_pointer_fixed() -> void:
	var view := {"cx": 2400.0, "cy": 1350.0, "zoom": 0.5}
	for c in [[100, 600, 1.2], [1200, 40, 0.3], [640, 360, 2.0]]:
		var wx := MapLayout.screen_to_world_x(view, c[0])
		var wy := MapLayout.screen_to_world_y(view, c[1])
		var next := MapLayout.zoom_at(view, c[2], c[0], c[1])
		eq(next.zoom, c[2])
		close(MapLayout.world_to_screen_x(next, wx), c[0], 6)
		close(MapLayout.world_to_screen_y(next, wy), c[1], 6)


func test_the_opening_view_shows_the_whole_galaxy_with_margin() -> void:
	var bounds := MapLayout.disc_bounds(Content.sectors())
	var fit := MapLayout.fit_view(bounds, 40)
	ge(MapLayout.world_to_screen_x(fit, bounds.x), 40 - 1e-6)
	le(MapLayout.world_to_screen_x(fit, bounds.x + bounds.w), MapLayout.VIEW_W - 40 + 1e-6)
	ge(MapLayout.world_to_screen_y(fit, bounds.y), 40 - 1e-6)
	le(MapLayout.world_to_screen_y(fit, bounds.y + bounds.h), MapLayout.VIEW_H - 40 + 1e-6)
	gt(fit.zoom, 0.2)
	lt(fit.zoom, 0.35)
	var systems := Content.systems()
	for s in systems:
		var x := MapLayout.world_to_screen_x(fit, s.x)
		var y := MapLayout.world_to_screen_y(fit, s.y)
		gt(x, 40)
		lt(x, MapLayout.VIEW_W - 40)
		gt(y, 40)
		lt(y, MapLayout.VIEW_H - 40)
	var min_gap := INF
	for i in systems.size():
		for j in range(i + 1, systems.size()):
			min_gap = minf(min_gap, Js.hypot(systems[i].x - systems[j].x, systems[i].y - systems[j].y) * fit.zoom)
	gt(min_gap, 15)


func test_tells_a_click_from_a_drag_and_finds_the_nearest_star() -> void:
	eq(MapLayout.is_drag(3, 4), false)
	eq(MapLayout.is_drag(5, 5), true)
	var xs := PackedFloat32Array([10, 100, 104])
	var ys := PackedFloat32Array([10, 100, 100])
	eq(MapLayout.nearest_point(xs, ys, 3, 103, 101, 18), 2)
	eq(MapLayout.nearest_point(xs, ys, 3, 300, 300, 18), -1)

# ------------------------------------------------------------------ system view geometry

func test_orbits_grow_outward_fit_the_screen_and_leave_the_top_hud_row_free() -> void:
	for count in [1, 2, 3, 4, 5]:
		var prev := 0.0
		for i in count:
			var rx := MapLayout.orbit_radius(i, count)
			gt(rx, prev + 50)
			prev = rx
			var half := 46 / 2.0 + 6
			gt(MapLayout.SUN_X - rx - half, 0)
			lt(MapLayout.SUN_X + rx + half, MapLayout.VIEW_W)
			gt(MapLayout.SUN_Y - rx * MapLayout.ORBIT_TILT - half, 110)
			lt(MapLayout.SUN_Y + rx * MapLayout.ORBIT_TILT + half, MapLayout.VIEW_H)


func test_puts_points_on_a_tilted_ellipse_the_near_half_is_in_front() -> void:
	var rx := 300.0
	close(MapLayout.orbit_x(rx, 0), 300)
	close(MapLayout.orbit_y(rx, 0), 0)
	close(MapLayout.orbit_y(rx, PI / 2), 300 * MapLayout.ORBIT_TILT)
	eq(MapLayout.in_front(PI / 2), true)
	eq(MapLayout.in_front(-PI / 2), false)
	var a := 0.0
	while a < PI * 2:
		var x := MapLayout.orbit_x(rx, a) / rx
		var y := MapLayout.orbit_y(rx, a) / (rx * MapLayout.ORBIT_TILT)
		close(x * x + y * y, 1, 6)
		a += 0.3


func test_planets_move_slowly_outer_ones_slower_sizes_stay_34_to_46() -> void:
	gt(MapLayout.orbit_speed(MapLayout.orbit_radius(0, 4)), MapLayout.orbit_speed(MapLayout.orbit_radius(3, 4)))
	lt(MapLayout.orbit_speed(MapLayout.orbit_radius(0, 4)), 0.1)
	for s in Content.systems():
		for p in s.planets:
			var size := MapLayout.planet_size(Names.stable_hash(p.id))
			ge(size, 34)
			le(size, 46)

# ------------------------------------------------------------------ labels

func test_keeps_higher_priority_labels_and_drops_the_ones_that_collide() -> void:
	var out := [0, 0, 0, 0]
	var kept := MapLayout.resolve_labels([0, 50, 200, 10], [0, 5, 0, 100], [100, 100, 80, 50], [14, 14, 14, 14],
		[1, 1, 1, 0], [1, 0, 2, 3], 4, out)
	eq(out, [0, 1, 1, 0])
	eq(kept, 2)


func test_places_every_sector_name_off_its_stars_at_the_opening_zoom() -> void:
	var sectors := Content.sectors()
	var fit := MapLayout.fit_view(MapLayout.disc_bounds(sectors), 40)
	var label_w: float = 130 / fit.zoom
	var label_h: float = 14 / fit.zoom
	var clearance: float = 6 / fit.zoom
	var clear := 0
	for s in sectors:
		var dy := MapLayout.sector_label_offset(s.x, s.y, s.radius, label_w, label_h, s.systems, clearance)
		le(absf(dy), 0.6 * s.radius)
		var free := true
		for p in s.systems:
			if not (absf(p.x - s.x) > label_w / 2 + clearance or absf(p.y - (s.y + dy)) > label_h / 2 + clearance):
				free = false
		if free:
			clear += 1
	ge(clear, sectors.size() - 2)

# ------------------------------------------------------------------ call card anchoring

func test_has_four_anchors_of_card_size_inside_the_view_none_overlapping() -> void:
	for a in MapLayout.CARD_ANCHORS:
		eq(a.w, MapLayout.CARD_W)
		eq(a.h, MapLayout.CARD_H)
		ge(a.x, 0)
		ge(a.y, 56)
		le(a.x + a.w, MapLayout.VIEW_W)
		le(a.y + a.h, MapLayout.VIEW_H)
	for i in MapLayout.CARD_ANCHORS.size():
		for j in range(i + 1, MapLayout.CARD_ANCHORS.size()):
			eq(_overlaps(MapLayout.CARD_ANCHORS[i], MapLayout.CARD_ANCHORS[j]), false)


func test_prefers_bottom_right_and_moves_away_from_the_target_planet() -> void:
	eq(MapLayout.anchor_card(300, 300, 50), 0)
	var br: Dictionary = MapLayout.CARD_ANCHORS[0]
	var i := MapLayout.anchor_card(br.x + 100, br.y + 60, 50)
	eq(i, 1)
	eq(MapLayout.circle_hits_rect(MapLayout.CARD_ANCHORS[i], br.x + 100, br.y + 60, 50), false)


func test_never_covers_a_planet_anywhere_on_any_orbit() -> void:
	for count in [2, 3, 4, 5]:
		for o in count:
			var rx := MapLayout.orbit_radius(o, count)
			var a := 0.0
			while a < PI * 2:
				var x := MapLayout.SUN_X + MapLayout.orbit_x(rx, a)
				var y := MapLayout.SUN_Y + MapLayout.orbit_y(rx, a)
				var r := 46 / 2.0 + 26
				var anchor: Dictionary = MapLayout.CARD_ANCHORS[MapLayout.anchor_card(x, y, r)]
				ge(MapLayout.distance_to_rect(anchor, x, y), r)
				a += 0.05

# ------------------------------------------------------------------ edge markers

func test_edge_markers_lie_on_the_inset_screen_rectangle() -> void:
	var inset := 46.0
	var a := 0.0
	while a < PI * 2:
		var dx := cos(a)
		var dy := sin(a)
		var x := MapLayout.edge_x(dx, dy, inset)
		var y := MapLayout.edge_y(dx, dy, inset)
		var on_side := absf(x - inset) < 1e-6 or absf(x - (MapLayout.VIEW_W - inset)) < 1e-6 \
			or absf(y - inset) < 1e-6 or absf(y - (MapLayout.VIEW_H - inset)) < 1e-6
		eq(on_side, true)
		ge(x, inset - 1e-6)
		le(x, MapLayout.VIEW_W - inset + 1e-6)
		eq(signf(x - MapLayout.VIEW_W / 2.0), 0.0 if absf(dx) < 1e-9 else signf(dx))
		a += 0.2

# ------------------------------------------------------------------ calls

func _call(planet_id: String, story_key: String = "story.call.patrol.1") -> Dictionary:
	return {"planet_id": planet_id, "kind": "patrol", "story_key": story_key, "sender": "abacus", "params": {"planet": planet_id}}


func test_first_call_after_1_2_s_later_ones_6_to_9_s_apart() -> void:
	eq(MapLayout.call_delay_ms(0, 0.7), MapLayout.FIRST_CALL_MS)
	eq(MapLayout.call_delay_ms(1, 0), MapLayout.CALL_GAP_MIN_MS)
	le(MapLayout.call_delay_ms(3, 0.999999), MapLayout.CALL_GAP_MAX_MS)
	close(MapLayout.call_delay_ms(2, 0.5), 7500)


func test_prefers_planets_of_the_current_system_and_skips_planets_already_called() -> void:
	var calls := [_call("a.1"), _call("a.2"), _call("a.5")]
	eq(MapLayout.pick_call(calls, [], ["a.5", "a.6"]).planet_id, "a.5")
	eq(MapLayout.pick_call(calls, [calls[2]], ["a.5", "a.6"]).planet_id, "a.1")
	is_null(MapLayout.pick_call(calls, calls, ["a.5"]))


func test_never_delivers_a_second_skill_intro_while_one_is_pending() -> void:
	var intro := _call("a.1", "story.system.typing.text")
	eq(MapLayout.is_intro_call(intro), true)
	var other := _call("a.2", "story.system.typing.text")
	eq(MapLayout.pick_call([other, _call("a.3")], [intro], []).planet_id, "a.3")


func test_smooth_is_an_eased_clamp() -> void:
	eq(MapLayout.smooth(-1), 0.0)
	eq(MapLayout.smooth(0.5), 0.5)
	eq(MapLayout.smooth(2), 1.0)
