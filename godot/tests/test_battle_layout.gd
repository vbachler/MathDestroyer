extends TestCase
## Port of tests/battleLayout.test.ts

const L = preload("res://scripts/fx/battle_layout.gd")


static func _overlaps(a: Dictionary, b: Dictionary) -> bool:
	return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h


static func _item(id: int, x: float, y: float, tag_w: float = 120) -> Dictionary:
	return {"id": id, "x": x, "y": y, "ship_half_w": 16.0, "ship_half_h": 26.0, "tag_w": tag_w, "tag_h": 34.0}


func test_dashboard_is_centred_scaled_down_and_its_five_screens_are_inside_the_view() -> void:
	close(L.DASH_X + L.DASH_W / 2, L.VIEW_W / 2.0)
	lt(L.DASH_W, L.VIEW_W * 0.7)
	gt(L.DASH_Y + L.DASH_H, L.VIEW_H)
	for r in L.dash_screens().values():
		gt(r.x, L.DASH_X)
		le(r.y + r.h, L.VIEW_H)
		ge(r.w, 80)
		ge(r.h, 54)
	gt(L.dash_screens().centre.w, 140)


func test_stations_their_pips_and_every_ship_stay_above_the_dashboard_hood() -> void:
	for x in Battle.DOME_X:
		var st := L.station_rect(x)
		for px in [st.x, x, st.x + st.w]:
			lt(L.STATION_PIP_Y + L.STATION_PIP_H, L.dash_top_at(px))
	for x in Battle.LANE_X:
		var bottom := L.ship_screen_y(Battle.IMPACT_Y) + L.SHIP_SIZE_NEAR / 2
		lt(bottom, L.dash_top_at(x))


func test_ships_grow_from_34_to_52_px_and_arrive_on_top_of_the_stations() -> void:
	eq(L.ship_size(Battle.SPAWN_Y), 34.0)
	eq(L.ship_size(Battle.IMPACT_Y), 52.0)
	var landing := L.ship_screen_y(Battle.IMPACT_Y) + L.SHIP_SIZE_NEAR / 2
	var st := L.station_rect(Battle.DOME_X[0])
	ge(landing, st.y)
	le(landing, st.y + st.h)


func test_keypad_clusters_cover_neither_stations_dashboard_nor_descending_ships() -> void:
	for pad in [L.KEYPAD_DIGITS, L.KEYPAD_FIRE]:
		ge(pad.x, 0)
		le(pad.x + pad.w, L.VIEW_W)
		le(pad.y + pad.h, L.VIEW_H)
		for x in Battle.DOME_X:
			eq(_overlaps(pad, L.station_rect(x)), false)
		eq(_overlaps(pad, {"x": L.DASH_X, "y": L.DASH_Y, "w": L.DASH_W, "h": L.DASH_H}), false)
		gt(pad.y, L.ship_screen_y(Battle.IMPACT_Y) + L.SHIP_SIZE_NEAR / 2)


func test_pause_glyph_sits_above_the_spawn_row() -> void:
	lt(L.PAUSE_RECT.y + L.PAUSE_RECT.h, L.ship_screen_y(Battle.SPAWN_Y) - 34.0 / 2)


func test_tags_default_outward_in_and_flip_at_the_screen_edge() -> void:
	var sides := L.layout_tags([_item(1, Battle.LANE_X[0], 200), _item(2, Battle.LANE_X[5], 300, 200)])
	eq(sides.get(1), "right")
	eq(sides.get(2), "left")
	# A wide tag at the right lane cannot go right.
	var edge := L.layout_tags([_item(3, Battle.LANE_X[5], 200, 200)], {3: "right"})
	eq(edge.get(3), "left")


func test_the_lower_ship_keeps_its_side_and_the_higher_neighbour_moves() -> void:
	var low := _item(1, Battle.LANE_X[1], 400, 150)
	var high := _item(2, Battle.LANE_X[2], 390, 150)
	var sides := L.layout_tags([high, low], {1: "right", 2: "left"})
	eq(sides.get(1), "right")
	eq(sides.get(2), "right")
	eq(_overlaps(L.tag_rect(low, "right"), L.tag_rect(high, "right")), false)


func test_keeps_the_previous_side_when_it_is_still_free_no_flicker() -> void:
	var a := _item(1, Battle.LANE_X[1], 300)
	eq(L.layout_tags([a], {1: "left"}).get(1), "left")


func test_a_missed_shot_lands_40_70_px_beside_the_target_inside_the_view() -> void:
	for r in [0.0, 0.2, 0.49, 0.5, 0.8, 0.999]:
		for x in [10.0, 640.0, 1270.0]:
			var p := L.miss_point({"x": x, "y": 300.0}, r)
			var d := absf(p.x - x)
			ge(d, 40)
			le(d, 70)
			ge(p.x, 0)
			le(p.x, L.VIEW_W)
