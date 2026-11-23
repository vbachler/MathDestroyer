extends TestCase
## Port of tests/boardingLayout.test.ts

const B = preload("res://scripts/fx/boarding_layout.gd")


# ---------------------------------------------------------------- boarding perspective

func test_maps_the_far_door_to_small_scale_at_the_door_line_and_z0_to_full_scale_at_the_bottom() -> void:
	close(B.perspective_scale(1), B.FAR_SCALE)
	close(B.perspective_scale(0), 1)
	close(B.floor_point(1, 0).y, B.DOOR_Y)
	close(B.floor_point(0, 0).y, B.NEAR_Y)
	close(B.approach(1), 0)
	close(B.approach(0), 1)
	close(B.perspective_scale(-1), 1)
	close(B.perspective_scale(2), B.FAR_SCALE)


func test_grows_slowly_far_away_and_fast_up_close() -> void:
	var prev := B.perspective_scale(1)
	var z := 0.95
	while z >= 0:
		var s := B.perspective_scale(z)
		gt(s, prev)
		prev = s
		z -= 0.05
	var far := B.perspective_scale(0.9) - B.perspective_scale(1)
	var near := B.perspective_scale(0) - B.perspective_scale(0.1)
	gt(near, far * 5)


func test_spreads_lanes_as_crawlers_near_inside_the_door_far_away_and_on_screen_near() -> void:
	var door_l := B.floor_point(1, -1)
	var door_r := B.floor_point(1, 1)
	gt(door_l.x, 550)
	lt(door_r.x, 730)
	var near_l := B.floor_point(0, -1)
	var near_r := B.floor_point(0, 1)
	gt(near_r.x - near_l.x, (door_r.x - door_l.x) * 10)
	gt(near_l.x, 0)
	lt(near_r.x, B.VIEW_W)
	close(B.floor_point(0.5, 0).x, B.CX)


func test_nearer_crawlers_are_brighter_and_draw_on_top() -> void:
	gt(B.brightness(0), B.brightness(0.5))
	gt(B.brightness(0.5), B.brightness(1))
	gt(B.depth_order(0.1), B.depth_order(0.7))


# ---------------------------------------------------------------- crawler gait

func test_skitters_faster_the_closer_it_is() -> void:
	for style in B.GAIT.values():
		gt(B.gait_hz(style, 0), B.gait_hz(style, 0.5))
		gt(B.gait_hz(style, 0.5), B.gait_hz(style, 1))


func test_keeps_the_pose_small_rock_squash_and_bob_stay_within_their_amplitudes() -> void:
	for style in B.GAIT.values():
		var t := 0
		while t < 5000:
			var p := B.gait_pose(style, t, t * 0.05, 1.3)
			le(absf(p.rotation), style.rock + 1e-9)
			le(p.scale_y, 1)
			ge(p.scale_y, 1 - style.squash - 1e-9)
			ge(p.lift, 0)
			le(absf(p.sway), style.zig * 1.35 + 1e-9)
			t += 37


func test_the_drifter_flies_with_a_slow_bob_the_wraith_glides_without_bob_the_stalker_lunges() -> void:
	var d: Dictionary = B.GAIT.drifter
	close(d.hover, 0.6)
	close(B.hover_lift(d, 100), 60)
	eq(B.hover_lift(B.GAIT.scorpion, 100), 0.0)
	var lifts: Array = []
	for i in 50:
		lifts.append(B.gait_pose(d, i * 100, 0, 0).lift)
	gt(lifts.max() - lifts.min(), d.bob * 0.8)
	var t := 0
	while t < 5000:
		var w := B.gait_pose(B.GAIT.wraith, t, t * 0.01, 0.4)
		eq(w.lift, 0.0)
		eq(w.scale_y, 1.0)
		t += 50
	# Lunge: the side-to-side spends more time near the extremes than a sine.
	gt(B.lunge_wave(0.5, B.GAIT.stalker.get("lunge", 0.0)), 0.9)
	close(B.lunge_wave(1, 4), 1)
	gt(B.CRAWLER_SIZE.wraith, B.CRAWLER_SIZE.scorpion)
	lt(B.CRAWLER_SIZE.drifter, B.CRAWLER_SIZE.scorpion)


func test_misses_land_beside_the_target() -> void:
	var p := B.boarding_miss_point({"x": 600.0, "y": 500.0}, 0.2)
	ge(absf(p.x - 600), 50)
	lt(B.boarding_miss_point(null, 0.5).y, B.DOOR_Y)


# ---------------------------------------------------------------- lamp crackle

func test_crackles_on_about_one_flash_in_four_or_five_never_twice_within_1_5_s() -> void:
	var last := -INF
	var n := 0
	var flashes := 0
	var times: Array = []
	var state := {"seed": 7}
	var rand := func() -> float:
		state.seed = (state.seed * 16807) % 2147483647
		return float(state.seed) / 2147483647.0
	var t := 0.0
	while t < 600_000:
		flashes += 1
		if B.crackle_gate(t, last, rand.call()):
			n += 1
			last = t
			times.append(t)
		t += 900 + rand.call() * 1200
	gt(float(n) / flashes, 0.12)
	lt(float(n) / flashes, 0.26)
	for i in range(1, times.size()):
		ge(times[i] - times[i - 1], B.CRACKLE_GAP_MS)
	eq(B.crackle_gate(1000, 0, 0), false)
	eq(B.crackle_gate(1600, 0, 0), true)
	eq(B.crackle_gate(1600, 0, 0.5), false)


# ---------------------------------------------------------------- foreground guns

func test_muzzles_at_rest_sit_where_the_painted_guns_had_them_either_side_of_the_centre() -> void:
	var l := B.gun_muzzle(B.GUN_LEFT, 0)
	var r := B.gun_muzzle(B.GUN_RIGHT, 0)
	gt(l.x, 480)
	lt(l.x, B.CX)
	gt(r.x, B.CX)
	lt(r.x, 820)
	for m in [l, r]:
		gt(m.y, 520)
		lt(m.y, 570)
	for g in B.GUNS:
		gt(B.gun_pivot(g).y, B.VIEW_H - 10)


func test_aims_at_the_target_within_the_limit_and_the_rotated_muzzle_lies_on_the_line_to_it() -> void:
	for g in B.GUNS:
		var target := {"x": B.CX, "y": B.DOOR_Y}
		var a := B.gun_aim_angle(g, target)
		lt(absf(a), B.GUN_MAX_ANGLE)
		var p := B.gun_pivot(g)
		var m := B.gun_muzzle(g, a)
		var cross: float = (m.x - p.x) * (target.y - p.y) - (m.y - p.y) * (target.x - p.x)
		lt(absf(cross) / Js.hypot(target.x - p.x, target.y - p.y), 1e-6 * 1000)
		# Far to the side: clamped.
		close(absf(B.gun_aim_angle(g, {"x": -2000.0 if g == B.GUN_LEFT else 4000.0, "y": 500.0})), B.GUN_MAX_ANGLE)
		# Recoil pushes the muzzle back toward the pivot.
		var kicked := B.gun_muzzle(g, 0, B.gun_kick(g, 0, 1))
		var rest := B.gun_muzzle(g, 0)
		lt(Js.hypot(kicked.x - p.x, kicked.y - p.y), Js.hypot(rest.x - p.x, rest.y - p.y))
