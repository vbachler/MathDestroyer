class_name HangarGuns
extends RefCounted
## Port of src/fx/HangarGuns.ts: the two foreground guns of the boarding hangar. Each pivots near
## its grip: both barrels track a target smoothly (idle sway without one), limited to
## +-GUN_MAX_ANGLE; `fire` snaps them onto the aim point, kicks them back and returns the rotated
## muzzle tips for the beams. With the gun sprites missing, code-drawn barrels with the same
## geometry stand in. HangarGuns.new(parent): the views are added to `parent` at GUN_DEPTH.

## Display depth: above every crawler body (DEPTH.enemies .. +5), below their tags (+8).
## (TS: DEPTH.enemies + 6.5; Godot z_index is an int.)
const GUN_DEPTH := UiTheme.DEPTH.enemies + 6
## How fast the barrels follow their target (1/s, exponential approach).
const TRACK_RATE := 7.0
## Idle sway with no target: amplitude (radians).
const IDLE_AMP := 0.05
const RECOIL_MS := 150.0

var _guns: Array = []
var _clock := 0.0


func _init(parent: Node) -> void:
	var keys := [Assets.IMG.ui.gunLeft, Assets.IMG.ui.gunRight]
	var geoms := [BoardingLayout.GUN_LEFT, BoardingLayout.GUN_RIGHT]
	for i in 2:
		var geom: Dictionary = geoms[i]
		var key: String = keys[i]
		var p := BoardingLayout.gun_pivot(geom)
		var view: Node2D
		if Assets.has_image(key):
			var img := PImage.make(null, p.x, p.y, key)
			img.set_origin(float(geom.pivot.x) / geom.w, float(geom.pivot.y) / geom.h)
			img.scale = Vector2.ONE * BoardingLayout.GUN_SCALE
			view = img
		else:
			view = _draw_fallback(geom)
		view.z_index = GUN_DEPTH
		parent.add_child(view)
		_guns.append({"geom": geom, "view": view, "angle": 0.0, "kick": 0.0, "phase": i * 1.7})


## Smoothly aims both barrels at `target` (or sways idly when null). `dt` 0 freezes them.
func update(dt: float, target: Variant) -> void:
	if dt <= 0:
		return
	_clock += dt
	var k := 1.0 - exp((-TRACK_RATE * dt) / 1000.0)
	for g in _guns:
		var want: float
		if target != null:
			want = BoardingLayout.gun_aim_angle(g.geom, target)
		else:
			want = IDLE_AMP * sin(_clock / 1900.0 + g.phase) + 0.4 * IDLE_AMP * sin(_clock / 730.0 + g.phase * 2)
		g.angle += (want - g.angle) * k
		g.kick = maxf(0.0, g.kick - dt / RECOIL_MS)
		_place(g)


## Snaps both barrels onto `to`, starts the recoil and returns the muzzle tips at that instant.
func fire(to: Variant) -> Array:
	var out: Array = []
	for g in _guns:
		g.angle = BoardingLayout.gun_aim_angle(g.geom, to)
		g.kick = 1.0
		_place(g)
		out.append(BoardingLayout.gun_muzzle(g.geom, g.angle))
	return out


func destroy() -> void:
	for g in _guns:
		if is_instance_valid(g.view):
			g.view.queue_free()
	_guns = []


func _place(g: Dictionary) -> void:
	# Ease-out recoil: a sharp kick, a smooth return.
	var s: float = g.kick * g.kick
	var off := BoardingLayout.gun_kick(g.geom, g.angle, s)
	var p := BoardingLayout.gun_pivot(g.geom)
	g.view.position = Vector2(p.x + off.x, p.y + off.y)
	g.view.rotation = g.angle


## Code-drawn barrel in the gun's geometry: a dark tapered body from the grip to the muzzle.
static func _draw_fallback(geom: Dictionary) -> PGraphics:
	var p := BoardingLayout.gun_pivot(geom)
	var m := BoardingLayout.gun_muzzle(geom, 0)
	var length := Js.hypot(m.x - p.x, m.y - p.y)
	var a := BoardingLayout.gun_rest_angle(geom)
	var g := PGraphics.new()
	g.position = Vector2(p.x, p.y)
	# Local frame: barrel along the rest direction.
	var ux := cos(a)
	var uy := sin(a)
	var nx := -uy
	var ny := ux
	var pt := func(along: float, across: float) -> Vector2: return Vector2(ux * along + nx * across, uy * along + ny * across)
	g.fill_style(0x0b0c0e, 1)
	g.fill_points([pt.call(-40, -70), pt.call(-40, 70), pt.call(length * 0.55, 34), pt.call(length * 0.55, -34)], true)
	g.fill_style(0x15171b, 1)
	g.fill_points([pt.call(length * 0.5, -16), pt.call(length * 0.5, 16), pt.call(length, 11), pt.call(length, -11)], true)
	g.line_style(2, 0x3a4250, 0.8)
	var a0: Vector2 = pt.call(length * 0.5, -16)
	var a1: Vector2 = pt.call(length, -11)
	g.line_between(a0.x, a0.y, a1.x, a1.y)
	g.fill_style(0x050506, 1)
	var tip: Vector2 = pt.call(length, 0)
	g.fill_circle(tip.x, tip.y, 8)
	return g
