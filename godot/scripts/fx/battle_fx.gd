class_name BattleFx
## Port of src/fx/BattleFx.ts: light effects for the battle (thin beams, small flashes, sparks,
## drifting debris, shield hex). Code draws light only. Every function takes the node the effect is
## added to (the scene's world: z_index 0) instead of the Phaser scene; points are {x, y} or Vector2.

const BEAM_MS := 170.0


static func _add_image(parent: Node, x: float, y: float, key: String, color: int, z: int) -> PImage:
	var img := PImage.make(parent, x, y, key)
	img.set_tint(color)
	img.material = ParticleBurst.add_material()
	img.z_index = z
	return img


## Thin beam from `from` to `to` that fades out. opts: {width = 0.42, fade_into, duration_ms}.
## `fade_into` (a missed shot) stretches the beam on past the aim point while it fades.
static func beam(parent: Node, from: Variant, to: Variant, color: int, opts: Dictionary = {}) -> void:
	var dx: float = to.x - from.x
	var dy: float = to.y - from.y
	var dist := Js.hypot(dx, dy)
	var width: float = opts.get("width", 0.42)          # x scale of the 12 px laser texture: about 2 px core
	var dur: float = opts.get("duration_ms", BEAM_MS)
	var fade_into: bool = opts.get("fade_into", false)
	var b := _add_image(parent, from.x, from.y, Tex.LASER, color, UiTheme.DEPTH.fx)
	b.set_origin(0.5, 1)
	b.rotation = atan2(dx, -dy)
	b.scale = Vector2(width, dist / 128.0)
	var props := {"alpha": 0.0, "scale_x": width * 0.3}
	if fade_into:
		props.scale_y = (dist * 1.7) / 128.0
	PTween.add(b, props, dur * 2.2 if fade_into else dur, "Quad.easeOut" if fade_into else "Quad.easeIn",
		{"on_complete": b.queue_free})
	flash(parent, from.x, from.y, color, 10)


## Small soft flash of light, `size` px across at its peak.
static func flash(parent: Node, x: float, y: float, color: int, size: float, duration_ms: float = 220.0) -> void:
	var g := _add_image(parent, x, y, Tex.GLOW, color, UiTheme.DEPTH.fx)
	g.scale = Vector2.ONE * ((size * 0.5) / 128.0)
	g.set_alpha(0.95)
	PTween.add(g, {"scale": size / 128.0, "alpha": 0.0}, duration_ms, "Cubic.easeOut", {"on_complete": g.queue_free})


## Short spark burst (small hot particles).
static func sparks(parent: Node, x: float, y: float, color: int, count: int = 6, speed: float = 60.0) -> void:
	ParticleBurst.explode(parent, x, y, Tex.PARTICLE, count, {
		"speed_min": speed * 0.3, "speed_max": speed,
		"angle_min": 0.0, "angle_max": 360.0,
		"life_min": 180.0, "life_max": 420.0,
		"scale_start": 0.28, "scale_end": 0.0,
		"alpha_start": 1.0, "alpha_end": 0.0,
		"tints": [color, UiTheme.WHITE],
		"add": true,
	}, UiTheme.DEPTH.fx, 500)


## Dark hull fragments that drift slowly outward, tumble and fade.
static func debris(parent: Node, x: float, y: float, count: int = 9, speed: float = 34.0) -> void:
	ParticleBurst.explode(parent, x, y, Tex.STAR, count, {
		"speed_min": speed * 0.25, "speed_max": speed,
		"angle_min": 0.0, "angle_max": 360.0,
		"life_min": 1200.0, "life_max": 2400.0,
		"scale_min": 0.6, "scale_max": 1.3,
		"rotate_start": 0.0, "rotate_end": 360.0,
		"alpha_start": 0.9, "alpha_end": 0.0,
		"tints": [UiTheme.TEXT_DIM, UiTheme.DISABLED, UiTheme.PRIMARY_DIM],
	}, UiTheme.DEPTH.fx - 1, 2500)


## Ship destroyed: a flash about the size of the ship, hot sparks, then debris drifting away.
## `size` is the ship's drawn length.
static func ship_explosion(parent: Node, x: float, y: float, size: float, tint: int = UiTheme.PRIMARY) -> void:
	flash(parent, x, y, UiTheme.WHITE, size * 1.1, 160)
	flash(parent, x, y, tint, size * 2.4, 420)
	sparks(parent, x, y, tint, 14, 120)
	debris(parent, x, y, 10, 40)


## Teal hexagonal shield that flashes over a station and fades.
static func hex_shield(parent: Node, x: float, y: float, radius: float) -> void:
	var g := PGraphics.new()
	g.position = Vector2(x, y)
	g.z_index = UiTheme.DEPTH.fx
	g.material = ParticleBurst.add_material()
	var pts: Array = []
	for i in 6:
		var a := PI / 6.0 + (i * PI) / 3.0
		pts.append(Vector2(cos(a) * radius, sin(a) * radius))
	g.fill_style(UiTheme.ACCENT, 0.14)
	g.fill_points(pts, true)
	g.line_style(1, UiTheme.ACCENT, 0.95)
	g.stroke_points(pts, true, true)
	# Inner cell lines: a faint honeycomb hint.
	g.line_style(1, UiTheme.ACCENT, 0.35)
	for p in pts:
		g.line_between(0, 0, p.x * 0.55, p.y * 0.55)
	g.scale = Vector2.ONE * 0.8
	parent.add_child(g)
	PTween.add(g, {"scale": 1.08}, 160, "Quad.easeOut")
	PTween.add(g, {"alpha": 0.0}, 520, "Quad.easeIn", {"delay": 220, "on_complete": g.queue_free})


## Thin expanding ring (repair pulse, etc.).
static func ring(parent: Node, x: float, y: float, radius: float, color: int) -> void:
	var c := PGraphics.new()
	c.position = Vector2(x, y)
	c.z_index = UiTheme.DEPTH.fx
	c.line_style(1, color, 1)
	c.stroke_circle(0, 0, radius)
	parent.add_child(c)
	PTween.add(c, {"scale": 1.8, "alpha": 0.0}, 650, "Cubic.easeOut", {"on_complete": c.queue_free})
