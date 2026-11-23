class_name LampFlicker
extends Node2D
## Port of src/fx/LampFlicker.ts: failing strip lights in the hangar: a feathered dark patch hides
## each painted lamp and its spark spray; at random it drops out for a short (often stuttering)
## burst, with an additive flash, a warm wash on the wall and a few falling sparks. Driven by
## update(dt) only. LampFlicker.new(parent, lamps, depth, on_flash): `on_flash(lamp)` runs on every
## lit stutter (the scene rations the crackle sound from it).

## Dark between bursts, and the length of one lit stutter / gap.
const DARK_MIN_MS := 600.0
const DARK_MAX_MS := 3500.0
const ON_MIN_MS := 40.0
const ON_MAX_MS := 160.0
const GAP_MIN_MS := 30.0
const GAP_MAX_MS := 90.0
const BURST_MAX_MS := 400.0
const GRAVITY := 700.0
## Patch opacity while the lamp is out (enough to sink the painted tube to the wall's gloom).
const PATCH_ALPHA := 0.94
const MAX_PARTICLES := 80
const FLASH_TINT := 0xffc890
const WASH_TINT := 0xff9a50
const SPARK_TINT := 0xffd9a0

var _spots: Array = []
var _sparks: Array = []
var _gfx: PGraphics
var _on_flash: Callable


static func _rnd(a: float, b: float) -> float:
	return a + randf() * (b - a)


func _init(parent: Node, lamps: Array, depth: int, on_flash: Callable = Callable()) -> void:
	_on_flash = on_flash
	for lamp in lamps:
		var patch := PImage.make(self, lamp.x, lamp.y, Tex.SHADE)
		patch.set_tint(lamp.tint)
		patch.z_index = depth
		patch.set_display_size(lamp.rx * 2, lamp.ry * 2)
		patch.set_alpha(PATCH_ALPHA)
		var wash := PImage.make(self, lamp.x, lamp.y + 40 * lamp.size, Tex.GLOW)
		wash.set_tint(WASH_TINT)
		wash.material = ParticleBurst.add_material()
		wash.z_index = depth + 1
		wash.set_display_size(lamp.rx * 4, lamp.ry * 4)
		wash.set_alpha(0)
		var flash := PImage.make(self, lamp.x, lamp.y, Tex.GLOW)
		flash.set_tint(FLASH_TINT)
		flash.material = ParticleBurst.add_material()
		flash.z_index = depth + 2
		flash.set_display_size(lamp.rx * 1.1, lamp.ry * 1.1)
		flash.set_alpha(0)
		_spots.append({"lamp": lamp, "patch": patch, "flash": flash, "wash": wash, "segs": [],
			"dark_ms": _rnd(300, DARK_MAX_MS), "fresh": false})
	_gfx = PGraphics.new()
	_gfx.material = ParticleBurst.add_material()
	_gfx.z_index = depth + 3
	add_child(_gfx)
	if parent != null:
		parent.add_child(self)


func update(dt: float) -> void:
	if dt <= 0:
		return
	for s in _spots:
		_step_spot(s, dt)
	_step_sparks(dt)


func destroy() -> void:
	queue_free()
	_spots = []
	_sparks = []


func _step_spot(s: Dictionary, dt: float) -> void:
	if s.segs.is_empty():
		s.dark_ms -= dt
		if s.dark_ms > 0:
			_set_lit(s, 0)
			return
		s.segs = _make_burst()
		s.fresh = true
	var seg: Dictionary = s.segs[0]
	if seg.on:
		if s.fresh:
			_emit(s.lamp)
			if _on_flash.is_valid():
				_on_flash.call(s.lamp)
		s.fresh = false
		_set_lit(s, _rnd(0.7, 1))
	else:
		_set_lit(s, 0)
	seg.ms -= dt
	if seg.ms <= 0:
		s.segs.pop_front()
		s.fresh = true
		if s.segs.is_empty():
			s.dark_ms = _rnd(DARK_MIN_MS, DARK_MAX_MS)


## One to three lit stutters with short gaps, total within BURST_MAX_MS.
func _make_burst() -> Array:
	var r := randf()
	var count := 1 if r < 0.35 else (2 if r < 0.75 else 3)
	var segs: Array = []
	var total := 0.0
	for i in count:
		var on := minf(_rnd(ON_MIN_MS, ON_MAX_MS), BURST_MAX_MS - total)
		if on < ON_MIN_MS / 2.0:
			break
		if i > 0:
			segs.append({"on": false, "ms": _rnd(GAP_MIN_MS, GAP_MAX_MS)})
		segs.append({"on": true, "ms": on})
		total += on
	if total < 80:
		segs[segs.size() - 1].ms += 80 - total
	return segs


func _set_lit(s: Dictionary, lit: float) -> void:
	s.patch.set_alpha(0.0 if lit > 0 else PATCH_ALPHA)
	s.flash.set_alpha(lit * _rnd(0.55, 0.9))
	s.wash.set_alpha(lit * 0.16)


func _emit(lamp: Dictionary) -> void:
	var n: int = Js.round(_rnd(4, 9) * (0.5 + lamp.size * 0.5))
	var i := 0
	while i < n and _sparks.size() < MAX_PARTICLES:
		var a := _rnd(-0.15, 1.15) * PI   # screen coords: sideways and down, a few kick up
		var v: float = _rnd(60, 240) * (0.5 + lamp.size * 0.5)
		var life := _rnd(300, 750)
		_sparks.append({
			"x": lamp.x + _rnd(-14, 14) * lamp.size, "y": lamp.y + _rnd(-4, 4) * lamp.size,
			"vx": cos(a) * v, "vy": sin(a) * v - 40, "life": life, "max": life,
		})
		i += 1


func _step_sparks(dt: float) -> void:
	var g := _gfx
	g.clear()
	if _sparks.is_empty():
		return
	var sec := dt / 1000.0
	var alive: Array = []
	for p in _sparks:
		p.life -= dt
		if p.life <= 0:
			continue
		p.vy += GRAVITY * sec
		p.x += p.vx * sec
		p.y += p.vy * sec
		var k: float = p.life / p.max
		g.line_style(1.5, SPARK_TINT, k)
		g.line_between(p.x, p.y, p.x - p.vx * 0.02, p.y - p.vy * 0.02)
		alive.append(p)
	_sparks = alive
