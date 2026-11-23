class_name StationWreck
extends RefCounted
## Port of src/fx/StationWreck.ts: a destroyed station's debris field. Dark hull chunks and plate
## shards fly apart, then settle into a very slow drift and tumble inside the station's area;
## embers cool over a few seconds, a dying fire glow, an occasional tiny spark. Objects are made
## once and reused across destroy / repair cycles. Driven only by update(dt_ms), so it freezes
## with the pause menu. StationWreck.new(parent, cx, cy, texture_key).

## Hull chunks cut from the station texture, and loose plate shards drawn in code.
const CHUNKS := 9
const SHARDS := 5
const EMBERS := 7
## Half-axes (px) of the ellipse the debris settles inside, around the station centre.
const FIELD_RX := 44.0
const FIELD_RY := 22.0
## Per-second decay of the blast velocity toward the slow residual drift.
const DRAG := 1.5
## Inward pull (px/s^2 per px outside) for a piece that wandered past the ellipse.
const PULL := 0.9
const SHARD_KEYS := ["tex-wreck-shard-0", "tex-wreck-shard-1", "tex-wreck-shard-2", "tex-wreck-shard-3"]
const SHARD_SIZE := 24
const CHUNK_FRAMES := 12
## Chunk crop areas as fractions of the station frame: the core body, and the flat ring.
const BODY := {"x0": 0.3, "x1": 0.7, "y0": 0.24, "y1": 0.86}
const RING := {"x0": 0.04, "x1": 0.96, "y0": 0.55, "y1": 0.64}
const CHUNK_TINTS := [0x8a857c, 0x6f6b64, 0x5c5953]
const EMBER_TINTS := [UiTheme.PRIMARY, 0xffd27a, UiTheme.DANGER]

## Crop frames per texture key (made once, like the Phaser texture frames).
static var _chunk_frames := {}

var _parent: Node
var _cx: float
var _cy: float
var _texture_key: String
var _pieces: Array = []
var _embers: Array = []
var _glow: PImage = null
var _spark: PImage = null
var _glow_ms := 0.0
var _spark_ms := 0.0
var _next_spark_ms := 0.0
var _active := false


static func _rnd(a: float, b: float) -> float:
	return a + randf() * (b - a)


static func _sign() -> float:
	return -1.0 if randf() < 0.5 else 1.0


## Crop frames on the station texture (once per texture), so chunks rotate about their own centre.
static func _frames_for(key: String) -> Array:
	if _chunk_frames.has(key):
		return _chunk_frames[key]
	var tex := Assets.texture(key)
	var bw := tex.get_width()
	var bh := tex.get_height()
	var out: Array = []
	for k in CHUNK_FRAMES:
		var area: Dictionary = RING if k < 3 else BODY
		var w := Js.round(bw * (_rnd(0.12, 0.2) if k < 3 else _rnd(0.1, 0.2)))
		var h := Js.round(bh * (_rnd(0.05, 0.08) if k < 3 else _rnd(0.08, 0.18)))
		var x := Js.round(bw * _rnd(area.x0, area.x1) - w / 2.0)
		var y := Js.round(bh * _rnd(area.y0, area.y1) - h / 2.0)
		var at := AtlasTexture.new()
		at.atlas = tex
		at.region = Rect2(clampi(x, 0, bw - w), clampi(y, 0, bh - h), w, h)
		out.append(at)
	_chunk_frames[key] = out
	return out


## Small angular dark plates with a faint rim light on the lit edge (generated once).
static func _ensure_shard_textures() -> void:
	for k in SHARD_KEYS.size():
		var key: String = SHARD_KEYS[k]
		if Assets.has_image(key):
			continue
		var c := SHARD_SIZE / 2.0
		var n := 4 + (k % 3)
		var pts := PackedVector2Array()
		for i in n:
			var a := (float(i) / n) * PI * 2.0 + _rnd(-0.35, 0.35)
			var r := c * _rnd(0.45, 0.95) * (1.0 if i % 2 == 0 else 0.7)
			pts.append(Vector2(c + cos(a) * r, c + sin(a) * r * 0.75))
		var g := Raster.new(SHARD_SIZE, SHARD_SIZE)
		g.fill_polygon(pts, Raster.rgb(0x24262a, 1))
		# Rim light along the upper edges only (light from above, off the planet).
		for i in n:
			var p := pts[i]
			var q := pts[(i + 1) % n]
			if (p.y + q.y) / 2.0 > c:
				continue
			g.stroke_polyline(PackedVector2Array([p, q]), 1, Raster.rgb(0x9a958a if i % 2 == 0 else 0xb07a44, 0.85))
		Assets.add_texture(key, g.to_texture())


func _init(parent: Node, cx: float, cy: float, texture_key: String) -> void:
	_parent = parent
	_cx = cx
	_cy = cy
	_texture_key = texture_key


var is_active: bool:
	get:
		return _active


## Shows the field. `blast` plays the explosion and throws the pieces outward; without it
## (a station already wrecked when first shown) the pieces start settled.
func show(blast: bool) -> void:
	_build()
	_active = true
	var speed := 1.0 if blast else 0.0
	for p in _pieces:
		var a := _rnd(0, PI * 2)
		var v := _rnd(22, 62) * speed
		p.x = _rnd(-BattleLayout.STATION_W * 0.32, BattleLayout.STATION_W * 0.32)
		p.y = _rnd(-11, 11)
		p.vx = cos(a) * v + p.x * 0.6 * speed
		p.vy = sin(a) * v * 0.5
		var ra := _rnd(0, PI * 2)
		var rv := _rnd(1.2, 3.5)
		p.rvx = cos(ra) * rv
		p.rvy = sin(ra) * rv * 0.5
		p.rest_spin = _sign() * _rnd(0.08, 0.4)
		p.spin = _sign() * _rnd(1.5, 5) if blast else p.rest_spin
		if not blast:
			p.x *= 1.3
			p.y *= 1.3
		p.img.rotation = _rnd(0, PI * 2)
		p.img.visible = true
		_place(p.img, p.x, p.y)
	for e in _embers:
		if not blast:
			e.life = 0.0
			e.img.visible = false
			continue
		var a := _rnd(0, PI * 2)
		var v := _rnd(10, 45)
		e.x = _rnd(-14, 14)
		e.y = _rnd(-6, 6)
		e.vx = cos(a) * v
		e.vy = sin(a) * v * 0.5
		e.max_life = _rnd(2500, 7000)
		e.life = e.max_life
		e.size = _rnd(0.12, 0.26)
		e.phase = _rnd(0, PI * 2)
		e.img.set_tint(EMBER_TINTS[randi() % EMBER_TINTS.size()])
		e.img.visible = true
	_glow_ms = 3800.0 if blast else 0.0
	if _glow != null:
		_glow.visible = blast
		_glow.set_alpha(0)
	_spark_ms = 0.0
	if _spark != null:
		_spark.visible = false
	_next_spark_ms = _rnd(1500, 3500)
	if blast:
		_blast()


## Removes the field (station repaired).
func hide() -> void:
	_active = false
	for p in _pieces:
		p.img.visible = false
	for e in _embers:
		e.life = 0.0
		e.img.visible = false
	if _glow != null:
		_glow.visible = false
	if _spark != null:
		_spark.visible = false


func update(dt_ms: float) -> void:
	if not _active or dt_ms <= 0:
		return
	var s := dt_ms / 1000.0
	var damp := exp(-DRAG * s)
	for p in _pieces:
		p.vx = p.rvx + (p.vx - p.rvx) * damp
		p.vy = p.rvy + (p.vy - p.rvy) * damp
		p.spin = p.rest_spin + (p.spin - p.rest_spin) * damp
		var ex: float = p.x / FIELD_RX
		var ey: float = p.y / FIELD_RY
		var d := ex * ex + ey * ey
		if d > 1:
			# Outside the area: pull back in, and turn the residual drift inward.
			p.vx -= p.x * PULL * s
			p.vy -= p.y * PULL * 2 * s
			if p.rvx * p.x + p.rvy * p.y > 0:
				p.rvx = -p.rvx
				p.rvy = -p.rvy
		p.x += p.vx * s
		p.y += p.vy * s
		p.img.rotation += p.spin * s
		_place(p.img, p.x, p.y)
	for e in _embers:
		if e.life <= 0:
			continue
		e.life -= dt_ms
		if e.life <= 0:
			e.img.visible = false
			continue
		var ed := exp(-2.2 * s)
		e.vx *= ed
		e.vy *= ed
		e.x += e.vx * s
		e.y += e.vy * s
		var k: float = e.life / e.max_life
		e.phase += s * 11
		var flicker := 0.75 + 0.25 * sin(e.phase)
		e.img.scale = Vector2.ONE * (e.size * (0.5 + 0.5 * k))
		e.img.set_alpha(k * k * flicker)
		_place(e.img, e.x, e.y)
	if _glow != null and _glow_ms > 0:
		_glow_ms = maxf(0.0, _glow_ms - dt_ms)
		var k := _glow_ms / 3800.0
		# Rises fast under the blast, then the fire dies down.
		_glow.set_alpha(minf(1.0, (1.0 - k) * 12.0) * k * 0.5)
		if _glow_ms == 0:
			_glow.visible = false
	_update_spark(dt_ms)


func destroy() -> void:
	for p in _pieces:
		if is_instance_valid(p.img):
			p.img.queue_free()
	for e in _embers:
		if is_instance_valid(e.img):
			e.img.queue_free()
	for o in [_glow, _spark]:
		if o != null and is_instance_valid(o):
			o.queue_free()
	_pieces = []
	_embers = []
	_glow = null
	_spark = null
	_active = false


# ---------------------------------------------------------------- internals

func _place(img: Node2D, x: float, y: float) -> void:
	img.position = Vector2(_cx + x, _cy + y)


## Small, punchy blast: white core flash, amber fireball, a scaled particle burst, a thin shockwave ring.
func _blast() -> void:
	var sw := BattleLayout.STATION_W
	BattleFx.flash(_parent, _cx, _cy, UiTheme.WHITE, sw * 0.9, 170)
	BattleFx.flash(_parent, _cx, _cy, UiTheme.PRIMARY, sw * 2.3, 640)
	Explosion.explode(_parent, _cx, _cy, UiTheme.PRIMARY, 0.42)
	BattleFx.sparks(_parent, _cx, _cy, 0xffd27a, 14, 130)
	var ring := RingShape.new()
	ring.position = Vector2(_cx, _cy)
	ring.radius = 6.0
	ring.line_width = 1.5
	ring.color = UiTheme.color(0xffd9a0, 0.9)
	ring.z_index = UiTheme.DEPTH.fx
	ring.material = ParticleBurst.add_material()
	_parent.add_child(ring)
	PTween.add(ring, {"radius": sw * 1.25, "alpha": 0.0}, 520, "Cubic.easeOut", {"on_complete": ring.queue_free})


func _update_spark(dt_ms: float) -> void:
	var sp := _spark
	if sp == null:
		return
	if _spark_ms > 0:
		_spark_ms = maxf(0.0, _spark_ms - dt_ms)
		sp.set_alpha(_spark_ms / 140.0)
		if _spark_ms == 0:
			sp.visible = false
		return
	_next_spark_ms -= dt_ms
	if _next_spark_ms > 0 or _pieces.is_empty():
		return
	_next_spark_ms = _rnd(1800, 4500)
	var p: Dictionary = _pieces[randi() % _pieces.size()]
	_spark_ms = 140.0
	sp.scale = Vector2.ONE * _rnd(0.18, 0.3)
	sp.set_alpha(1)
	sp.visible = true
	_place(sp, p.x + _rnd(-2, 2), p.y + _rnd(-2, 2))


## Makes the pooled objects on first use.
func _build() -> void:
	if not _pieces.is_empty():
		return
	var frames := _frames_for(_texture_key)
	var tex := Assets.texture(_texture_key)
	var tex_scale := BattleLayout.STATION_W / tex.get_width()
	_ensure_shard_textures()
	for i in CHUNKS + SHARDS:
		var img: Sprite2D
		if i < CHUNKS:
			img = Sprite2D.new()
			img.texture = frames[(i * 5 + randi() % 3) % frames.size()]
			img.scale = Vector2.ONE * (tex_scale * _rnd(0.85, 1.15))
			img.self_modulate = UiTheme.color(CHUNK_TINTS[i % CHUNK_TINTS.size()])
			if randf() < 0.5:
				img.flip_h = true
		else:
			img = PImage.make(null, 0, 0, SHARD_KEYS[i % SHARD_KEYS.size()])
			img.scale = Vector2.ONE * _rnd(0.3, 0.55)
		img.z_index = UiTheme.DEPTH.world + 2
		img.visible = false
		_parent.add_child(img)
		_pieces.append({"img": img, "x": 0.0, "y": 0.0, "vx": 0.0, "vy": 0.0, "rvx": 0.0, "rvy": 0.0, "spin": 0.0, "rest_spin": 0.0})
	for i in EMBERS:
		var img := PImage.make(_parent, 0, 0, Tex.PARTICLE)
		img.material = ParticleBurst.add_material()
		img.z_index = UiTheme.DEPTH.world + 3
		img.visible = false
		_embers.append({"img": img, "x": 0.0, "y": 0.0, "vx": 0.0, "vy": 0.0, "life": 0.0, "max_life": 1.0, "size": 0.2, "phase": 0.0})
	_glow = PImage.make(_parent, _cx, _cy, Tex.GLOW)
	_glow.set_tint(UiTheme.DANGER)
	_glow.material = ParticleBurst.add_material()
	_glow.scale = Vector2.ONE * ((BattleLayout.STATION_W * 1.3) / 128.0)
	_glow.z_index = UiTheme.DEPTH.world + 1
	_glow.visible = false
	_spark = PImage.make(_parent, 0, 0, Tex.PARTICLE)
	_spark.set_tint(0xffe6b8)
	_spark.material = ParticleBurst.add_material()
	_spark.z_index = UiTheme.DEPTH.world + 3
	_spark.visible = false


## Phaser Arc shape with only a stroke and a tweenable `radius` (the blast shockwave).
class RingShape extends Node2D:
	var line_width := 1.0
	var color := Color.WHITE
	var radius := 1.0:
		set(v):
			radius = v
			queue_redraw()

	func _draw() -> void:
		draw_arc(Vector2.ZERO, radius, 0, TAU, maxi(24, int(radius)), color, line_width, true)
