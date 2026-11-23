class_name BoardingLayout
## Port of src/fx/boardingLayout.ts: boarding screen geometry (logical 1280x720) and the code
## animation of the crawler stills. Pure: unit tested in tests/test_boarding_layout.gd.
## Points are {x, y} Dictionaries.
##
## One-point perspective onto the hangar floor of `bg/bg_hangar.jpg` (cover-fit): the far door's
## floor line is at y 370, the floor runs to the bottom of the frame. A crawler at depth z
## (1 = far door, 0 = at the guns) stands on the floor at scale s(z) (perspective_scale),
##   y = HORIZON_Y + (NEAR_Y - HORIZON_Y) s,  x = CX + lane LANE_NEAR_DX s.

const VIEW_W := 1280
const VIEW_H := 720
const CX := VIEW_W / 2.0

## Floor line of the far door and of the nearest point (feet at z = 0).
const DOOR_Y := 370.0
const NEAR_Y := 700.0
const FAR_SCALE := 0.08
## Where the floor plane meets the horizon (derived so that s = FAR_SCALE lands on DOOR_Y).
const HORIZON_Y := (DOOR_Y - NEAR_Y * FAR_SCALE) / (1.0 - FAR_SCALE)
## Lane offset from the centre line at scale 1 (lanes -1, 0, 1).
const LANE_NEAR_DX := 300.0
## Crawler width in px at scale 1 (the 512 px frame scaled to it).
const CRAWLER_NEAR_W := 300.0

# ---------------------------------------------------------------- foreground guns

## One of the two foreground guns (ui/gun_left.png, ui/gun_right.png). GunGeom =
## {x, y, w, h, pivot: {x, y}, muzzle: {x, y}}: (x, y) is the sprite's top-left in the view at rest;
## pivot and muzzle in sprite px.
## Background space -> view (1920 -> 1280).
const GUN_SCALE := 2.0 / 3.0
const GUN_LEFT := {"x": 292.0, "y": 530.7, "w": 387, "h": 394, "pivot": {"x": 190, "y": 330}, "muzzle": {"x": 322, "y": 24}}
const GUN_RIGHT := {"x": 755.3, "y": 530.0, "w": 381, "h": 395, "pivot": {"x": 194, "y": 330}, "muzzle": {"x": 62, "y": 24}}
const GUNS := [GUN_LEFT, GUN_RIGHT]
## Largest aim rotation either way from the rest pose (radians, ~18 deg).
const GUN_MAX_ANGLE := (18.0 * PI) / 180.0


## Pivot of a gun in view coordinates (the sprite rotates about it).
static func gun_pivot(g: Dictionary) -> Dictionary:
	return {"x": g.x + g.pivot.x * GUN_SCALE, "y": g.y + g.pivot.y * GUN_SCALE}


## Rest direction of the barrel (pivot -> muzzle), radians in screen coordinates.
static func gun_rest_angle(g: Dictionary) -> float:
	return atan2(float(g.muzzle.y - g.pivot.y), float(g.muzzle.x - g.pivot.x))


static func _wrap_pi(a: float) -> float:
	return atan2(sin(a), cos(a))


## Rotation (from rest, clamped to +-GUN_MAX_ANGLE) that points the barrel at `target`.
static func gun_aim_angle(g: Dictionary, target: Variant) -> float:
	var p := gun_pivot(g)
	var want := _wrap_pi(atan2(target.y - p.y, target.x - p.x) - gun_rest_angle(g))
	return maxf(-GUN_MAX_ANGLE, minf(GUN_MAX_ANGLE, want))


## Muzzle tip in view coordinates for a rotation `angle` and a recoil offset (view px).
static func gun_muzzle(g: Dictionary, angle: float, recoil: Variant = null) -> Dictionary:
	var p := gun_pivot(g)
	var dx: float = (g.muzzle.x - g.pivot.x) * GUN_SCALE
	var dy: float = (g.muzzle.y - g.pivot.y) * GUN_SCALE
	var c := cos(angle)
	var s := sin(angle)
	var rx: float = 0.0 if recoil == null else recoil.x
	var ry: float = 0.0 if recoil == null else recoil.y
	return {"x": p.x + dx * c - dy * s + rx, "y": p.y + dx * s + dy * c + ry}


## Recoil kick at full strength (view px): back along the barrel and a little down.
static func gun_kick(g: Dictionary, angle: float, strength: float) -> Dictionary:
	var a := gun_rest_angle(g) + angle
	return {"x": -cos(a) * 9.0 * strength, "y": -sin(a) * 9.0 * strength + 4.0 * strength}


## Broken strip lights painted into the hangar (with spark bursts), on the cover-fit 1280x720 view.
## SparkLamp = {x, y, rx, ry, tint, size}.
const SPARK_LAMPS := [
	{"x": 257.0, "y": 160.0, "rx": 165.0, "ry": 130.0, "tint": 0x14120e, "size": 1.0},
	{"x": 395.0, "y": 226.0, "rx": 70.0, "ry": 56.0, "tint": 0x131518, "size": 0.5},
	{"x": 901.0, "y": 226.0, "rx": 70.0, "ry": 56.0, "tint": 0x141515, "size": 0.5},
	{"x": 1040.0, "y": 160.0, "rx": 165.0, "ry": 130.0, "tint": 0x14120e, "size": 1.0},
]

## Spark crackle on lamp flashes: only about one flash in 4-5, never two within CRACKLE_GAP_MS.
const CRACKLE_CHANCE := 0.22
const CRACKLE_GAP_MS := 1500


## Whether a lamp flash at `now_ms` gets a crackle (last crackle at `last_ms`, `r01` uniform 0..1).
static func crackle_gate(now_ms: float, last_ms: float, r01: float) -> bool:
	return r01 < CRACKLE_CHANCE and now_ms - last_ms >= CRACKLE_GAP_MS


## Red warning lamps painted on the hangar floor (view coords): their glow pulses.
const BEACONS := [
	{"x": 268.0, "y": 388.0}, {"x": 481.0, "y": 359.0}, {"x": 821.0, "y": 359.0}, {"x": 906.0, "y": 378.0},
	{"x": 1045.0, "y": 388.0},
]

## Typed answer readout and the bite pips, bottom centre between the barrels.
const READOUT := {"x": CX - 80.0, "y": VIEW_H - 50.0, "w": 160.0, "h": 42.0}


static func _clamp01(v: float) -> float:
	return 0.0 if v < 0 else (1.0 if v > 1 else v)


## Perspective scale at depth z (clamped to 0..1): FAR_SCALE at the door, 1 at the guns.
static func perspective_scale(z: float) -> float:
	# Exponential rather than true 1/z perspective: crawlers are readable for most of the approach.
	return pow(FAR_SCALE, _clamp01(z))


## How far along the visible approach a crawler is: 0 at the door, 1 at the guns.
static func approach(z: float) -> float:
	return (perspective_scale(z) - FAR_SCALE) / (1.0 - FAR_SCALE)


## Feet of a crawler on the floor. `sway` is a lateral offset in scale-1 px (zig-zag).
static func floor_point(z: float, lane: float, sway: float = 0.0) -> Dictionary:
	var s := perspective_scale(z)
	return {"x": CX + (lane * LANE_NEAR_DX + sway) * s, "y": HORIZON_Y + (NEAR_Y - HORIZON_Y) * s}


## Light level 0..1 for a crawler's tint: dark in the far gloom, full light close by.
static func brightness(z: float) -> float:
	return 0.28 + 0.72 * pow(approach(z), 0.6)


## Display depth order: nearer crawlers draw on top (larger value).
static func depth_order(z: float) -> float:
	return 1.0 - _clamp01(z)


# ---------------------------------------------------------------- gait

## Per-kind movement character. GaitStyle = {hz, rock, squash, bob, zig, zig_hz, lunge?, hover?,
## bob_hz?, glide?} (TS GaitStyle in snake_case; optional fields absent when undefined).
const GAIT := {
	"scorpion": {"hz": 7.0, "rock": 0.05, "squash": 0.05, "bob": 0.025, "zig": 60.0, "zig_hz": 0.45},
	"spider": {"hz": 10.0, "rock": 0.07, "squash": 0.06, "bob": 0.03, "zig": 90.0, "zig_hz": 0.7},
	"crab": {"hz": 8.0, "rock": 0.06, "squash": 0.04, "bob": 0.02, "zig": 130.0, "zig_hz": 0.55},
	"beetle": {"hz": 6.0, "rock": 0.04, "squash": 0.07, "bob": 0.035, "zig": 45.0, "zig_hz": 0.35},
	"stalker": {"hz": 8.0, "rock": 0.04, "squash": 0.05, "bob": 0.03, "zig": 120.0, "zig_hz": 0.5, "lunge": 4.0},
	"drifter": {"hz": 2.0, "rock": 0.035, "squash": 0.0, "bob": 0.07, "zig": 70.0, "zig_hz": 0.22, "hover": 0.6, "bob_hz": 0.4},
	"wraith": {"hz": 1.5, "rock": 0.03, "squash": 0.0, "bob": 0.0, "zig": 35.0, "zig_hz": 0.18, "glide": true},
}

## Drawn size per kind relative to CRAWLER_NEAR_W (the 512 frame's width).
const CRAWLER_SIZE := {
	"scorpion": 1.0, "spider": 1.0, "crab": 1.0, "beetle": 1.0, "stalker": 0.98, "drifter": 0.85, "wraith": 1.25,
}


## Skitter frequency at depth z: the closer, the faster (x 2.4 at the guns).
static func gait_hz(style: Dictionary, z: float) -> float:
	return style.hz * (1.0 + 1.4 * (1.0 - _clamp01(z)))


## Pose of a still at time `t_ms` (the crawler's own clock): {rotation, scale_x, scale_y, lift, sway}.
## `leg_phase` is the accumulated skitter phase in radians, `seed` a per-crawler phase offset.
## Scuttling comes in bursts: a slow envelope makes the legs work hard, then nearly stall.
static func gait_pose(style: Dictionary, t_ms: float, leg_phase: float, seed: float) -> Dictionary:
	var t := t_ms / 1000.0
	var wave := func(hz: float, ph: float) -> float: return sin(t * PI * 2.0 * hz + ph)
	if style.has("hover") or style.get("glide", false):
		# Flying / gliding: no legs. A slow sway, a gentle drift, and (flying) a slow bob.
		var bob_hz: float = style.get("bob_hz", 0.4)
		return {
			"rotation": style.rock * wave.call(0.31, seed * 2.0),
			"scale_x": 1.0,
			"scale_y": 1.0,
			"lift": style.bob * (0.5 + 0.5 * wave.call(bob_hz, seed)),
			"sway": style.zig * (wave.call(style.zig_hz, seed) + 0.25 * wave.call(style.zig_hz * 2.3, seed * 3.0)),
		}
	var burst := 0.45 + 0.55 * pow(maxf(0.0, sin(t * 2.3 + seed * 1.7)), 0.5)
	var leg := sin(leg_phase + seed)
	var step := absf(sin(leg_phase + seed))
	var sway: float
	if style.get("lunge", 0.0):
		sway = style.zig * lunge_wave(wave.call(style.zig_hz, seed), style.lunge)
	else:
		sway = style.zig * (wave.call(style.zig_hz, seed) + 0.35 * wave.call(style.zig_hz * 2.7, seed * 3.0))
	return {
		"rotation": style.rock * burst * leg,
		"scale_x": 1.0 + style.squash * 0.6 * burst * step,
		"scale_y": 1.0 - style.squash * burst * step,
		"lift": style.bob * burst * (1.0 - step),
		"sway": sway,
	}


## A sine reshaped into dash-and-hold: quick sideways lunges, pauses at either side. In -1..1.
static func lunge_wave(s: float, sharpness: float) -> float:
	return tanh(sharpness * s) / tanh(sharpness)


## Flying kinds: how high the body floats above its floor point, in px, for a drawn height.
static func hover_lift(style: Dictionary, drawn_h: float) -> float:
	return style.get("hover", 0.0) * drawn_h


# ---------------------------------------------------------------- shots

## Where a missed shot goes: beside the nearest crawler (or into the far gloom), `r01` in 0..1.
static func boarding_miss_point(target: Variant, r01: float) -> Dictionary:
	if target == null:
		return {"x": CX + (r01 - 0.5) * 240.0, "y": DOOR_Y - 20.0 - r01 * 40.0}
	var side := -1.0 if r01 < 0.5 else 1.0
	var dist := 50.0 + 40.0 * fmod(r01 * 2.0, 1.0)
	return {"x": target.x + side * dist, "y": target.y - 10.0}
