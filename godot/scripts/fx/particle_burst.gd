class_name ParticleBurst
extends Node2D
## Phaser `scene.add.particles(x, y, key, cfg)` + `emitter.explode(count)` for the port: a one-shot
## burst of textured particles drawn in _draw. Same per-particle rules as the Phaser emitter ops:
##   speed {min, max}, angle {min, max} (degrees), lifespan {min, max} (ms): random per particle;
##   scale {start, end} / alpha {start, end} / rotate {start, end} (degrees): linear over the life;
##   scale {min, max}: random constant; tint: Array of 0xRRGGBB, one picked per particle;
##   blend ADD. No gravity. The node frees itself after `destroy_ms` (Phaser delayedCall destroy).
## As a child of a scene it stops with the scene (Phaser particles pause with their scene).
##   ParticleBurst.explode(parent, x, y, key, count, cfg, z_index, destroy_ms)
## cfg keys: speed_min, speed_max, angle_min, angle_max, life_min, life_max, scale_start, scale_end
## (or scale_min, scale_max), alpha_start, alpha_end, rotate_start, rotate_end, tints, add.

static var _add_material: CanvasItemMaterial

var _tex: Texture2D
var _parts: Array = []
var _age_ms := 0.0
var _destroy_ms := 500.0
var _alpha := Vector2(1, 1)
var _rotate := Vector2(0, 0)


## Shared additive-blend material (Phaser BlendModes.ADD).
static func add_material() -> CanvasItemMaterial:
	if _add_material == null:
		_add_material = CanvasItemMaterial.new()
		_add_material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return _add_material


static func explode(parent: Node, x: float, y: float, key: String, count: int, cfg: Dictionary,
		z: int, destroy_ms: float) -> ParticleBurst:
	var b := ParticleBurst.new()
	b.position = Vector2(x, y)
	b.z_index = z
	b._tex = Assets.texture(key)
	b._destroy_ms = destroy_ms
	var a0: float = cfg.get("alpha_start", 1.0)
	b._alpha = Vector2(a0, cfg.get("alpha_end", a0))
	b._rotate = Vector2(cfg.get("rotate_start", 0.0), cfg.get("rotate_end", 0.0))
	if cfg.get("add", false):
		b.material = add_material()
	var tints: Array = cfg.get("tints", [0xffffff])
	for i in count:
		var speed := randf_range(cfg.get("speed_min", 0.0), cfg.get("speed_max", 0.0))
		var ang := deg_to_rad(randf_range(cfg.get("angle_min", 0.0), cfg.get("angle_max", 360.0)))
		var life := randf_range(cfg.get("life_min", 1000.0), cfg.get("life_max", 1000.0))
		var p := {
			"x": 0.0, "y": 0.0, "vx": cos(ang) * speed, "vy": sin(ang) * speed,
			"life": life, "age": 0.0, "tint": UiTheme.color(tints[randi() % tints.size()]),
		}
		if cfg.has("scale_min"):
			var s := randf_range(cfg.scale_min, cfg.scale_max)
			p.s0 = s
			p.s1 = s
		else:
			p.s0 = float(cfg.get("scale_start", 1.0))
			p.s1 = float(cfg.get("scale_end", p.s0))
		b._parts.append(p)
	parent.add_child(b)
	return b


func _process(delta: float) -> void:
	var dt := delta * 1000.0
	_age_ms += dt
	if _age_ms >= _destroy_ms:
		queue_free()
		return
	var sec := dt / 1000.0
	for p in _parts:
		if p.age >= p.life:
			continue
		p.age += dt
		p.x += p.vx * sec
		p.y += p.vy * sec
	queue_redraw()


func _draw() -> void:
	if _tex == null:
		return
	var size := _tex.get_size()
	for p in _parts:
		if p.age >= p.life:
			continue
		var t: float = p.age / p.life
		var s: float = lerpf(p.s0, p.s1, t)
		var a := lerpf(_alpha.x, _alpha.y, t)
		if s <= 0 or a <= 0:
			continue
		var c: Color = p.tint
		c.a = a
		draw_set_transform(Vector2(p.x, p.y), deg_to_rad(lerpf(_rotate.x, _rotate.y, t)), Vector2(s, s))
		draw_texture(_tex, -size / 2.0, c)
	draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
