class_name WarpStreaks
extends Node2D
## Port of src/fx/WarpStreaks.ts: hyperspace star streaks drawn additively in one node. At
## intensity 0 the stars are points drifting outward very slowly; as intensity rises they
## accelerate away from the centre and stretch into radial streaks. Lowering the intensity
## collapses the streaks back to points.
##   WarpStreaks.new(parent, {count = 360, x, y, width, height, depth = DEPTH.fx, colors, seed = "warp"})
##   set_intensity(v) / get_intensity()   set_zoom(z) (node scale)   set_alpha(a)   visible = bool
##   update(dt_ms) every frame            destroy() on shutdown
## Same seeded layout as the TS (PhaserRnd = Phaser.Math.RandomDataGenerator).

## Radial speed in "radii per second": idle drift, plus the full-intensity boost (squared).
const DRIFT_SPEED := 0.04
const WARP_SPEED := 5.2
## Streak length as a fraction of the star's distance from the centre at full intensity.
const MAX_TAIL := 0.62
## Stars closer than this to the centre are faded in (no bright clump at the vanishing point).
const FADE_RADIUS := 160.0
const MIN_RADIUS := 6.0

var count: int
var max_r: float
var _cos := PackedFloat32Array()
var _sin := PackedFloat32Array()
var _r := PackedFloat32Array()
var _speed := PackedFloat32Array()
var _bright := PackedFloat32Array()
var _color_idx := PackedInt32Array()
var _colors: Array[Color] = []
var _rnd: PhaserRnd
var intensity := 0.0
var _destroyed := false


func _init(parent: Node = null, opts: Dictionary = {}) -> void:
	count = maxi(1, int(floor(float(opts.get("count", 360)))))
	var w := float(opts.get("width", UiTheme.GAME_WIDTH))
	var h := float(opts.get("height", UiTheme.GAME_HEIGHT))
	max_r = Js.hypot(w / 2.0, h / 2.0) + 20.0
	var cols: Array = opts.get("colors", [UiTheme.TEXT, UiTheme.TEXT, UiTheme.TEXT, UiTheme.WHITE, UiTheme.ACCENT, UiTheme.PRIMARY])
	for c in cols:
		_colors.append(UiTheme.color(c))
	_rnd = PhaserRnd.new([opts.get("seed", "warp")])
	position = Vector2(float(opts.get("x", UiTheme.GAME_WIDTH / 2.0)), float(opts.get("y", UiTheme.GAME_HEIGHT / 2.0)))
	z_index = opts.get("depth", UiTheme.DEPTH.fx)
	var m := CanvasItemMaterial.new()
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = m

	_cos.resize(count)
	_sin.resize(count)
	_r.resize(count)
	_speed.resize(count)
	_bright.resize(count)
	_color_idx.resize(count)
	for i in count:
		var a := _rnd.real_in_range(0, PI * 2)
		_cos[i] = cos(a)
		_sin[i] = sin(a)
		# Uniform over the area: r ~ sqrt(u).
		_r[i] = MIN_RADIUS + sqrt(_rnd.frac()) * (max_r - MIN_RADIUS)
		_speed[i] = _rnd.real_in_range(0.6, 1.4)
		_bright[i] = _rnd.real_in_range(0.35, 1)
		_color_idx[i] = _rnd.between(0, _colors.size() - 1)
	queue_redraw()
	if parent != null:
		parent.add_child(self)


## 0 = points drifting slowly, 1 = full hyperspace streaks.
func set_intensity(value: float) -> WarpStreaks:
	intensity = minf(1.0, maxf(0.0, value))
	return self


func get_intensity() -> float:
	return intensity


## Scales the whole field around its centre (a slight "push" toward the vanishing point).
func set_zoom(zoom: float) -> WarpStreaks:
	scale = Vector2(zoom, zoom)
	return self


func set_alpha(alpha: float) -> WarpStreaks:
	modulate.a = alpha
	return self


func update(dt_ms: float) -> void:
	if _destroyed:
		return
	var dt := minf(0.05, maxf(0.0, dt_ms / 1000.0))
	var k := intensity
	var rate := DRIFT_SPEED + WARP_SPEED * k * k
	for i in count:
		# Exponential outward motion: the further from the centre, the faster (perspective).
		var r := _r[i] * (1.0 + rate * _speed[i] * dt) + rate * _speed[i] * 40.0 * dt
		if r > max_r:
			# Respawn near the centre during a jump, anywhere when idle (keeps the field even).
			if k > 0.2:
				r = MIN_RADIUS + _rnd.frac() * max_r * 0.25
			else:
				r = MIN_RADIUS + sqrt(_rnd.frac()) * max_r * 0.5
		_r[i] = r
	queue_redraw()


func destroy() -> void:
	if _destroyed:
		return
	_destroyed = true
	queue_free()


func _draw() -> void:
	var k := intensity
	var tail := MAX_TAIL * pow(k, 1.4)
	for i in count:
		var r := _r[i]
		var fade := r / FADE_RADIUS if r < FADE_RADIUS else 1.0
		var alpha := _bright[i] * fade * (0.55 + 0.45 * k)
		if alpha < 0.02:
			continue
		var col := _colors[_color_idx[i]]
		var c := _cos[i]
		var s := _sin[i]
		var len := maxf(1.4, r * tail * _speed[i])
		var width := 1.1 + k * (r / max_r) * 1.3
		var head := Vector2(c * r, s * r)
		# Dim long tail, bright short head: reads as a streak fading toward the centre.
		if len > 3:
			var tr := maxf(0.0, r - len)
			draw_line(Vector2(c * tr, s * tr), head, Color(col, alpha * 0.35), width)
			var hr := maxf(0.0, r - len * 0.3)
			draw_line(Vector2(c * hr, s * hr), head, Color(col, alpha), width)
		else:
			draw_rect(Rect2(head.x - width / 2.0, head.y - width / 2.0, width, width), Color(col, alpha))
