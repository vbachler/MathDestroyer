class_name EnemyShip
extends Node2D
## Port of src/fx/EnemyShip.ts: hostile ship: image sprite (nose down) with a faint engine glow,
## scaled by depth, and its problem on a compact dark tag beside it, joined by a hairline. The node
## origin is the ship centre. The tag keeps its size (numerals SIZES.problem) while the ship grows;
## the scene picks the tag side (set_tag_side) with BattleLayout.layout_tags().
## EnemyShip.new(parent, x, y, problem, texture, size). Threat level: 0 far, 1 approaching, 2 about to hit.

const TAG_PAD_X := 9.0
const TAG_PAD_Y := 3.0
## The aiming line shows in the last quarter of the charge.
const AIM_FROM_CHARGE := 0.75
## Nose of the hull below the centre, as a fraction of the ship size (the nose points down).
const NOSE := 0.42

## Visible hull width as a fraction of the 256 px frame (measured from the alpha of each image).
const HULL_WIDTH := {
	"ship_enemy_a": 0.62,
	"ship_enemy_b": 0.56,
	"ship_enemy_c": 0.41,
}

var tag_width: float
var tag_height: float

var _hull: PImage
var _engine: PImage
var _nose_glow: PImage
var _aim: PGraphics
var _charge = null
var _hairline: PGraphics
var _plate: PGraphics
var _text: PText
var _hull_frac: float
var _size := 0.0
var _side := ""
var _threat := -1
var _glow_phase := randf() * PI * 2.0


## `texture` is Assets.enemy_image_for(enemy.id); a missing image falls back to the procedural hull.
func _init(parent: Node, x: float, y: float, problem: String, texture: String, size: float) -> void:
	position = Vector2(x, y)
	var key := texture if Assets.has_image(texture) else Tex.ENEMY
	_hull_frac = HULL_WIDTH.get(key, 0.9)

	_aim = PGraphics.new()
	_aim.visible = false
	_engine = PImage.make(null, 0, 0, Tex.GLOW)
	_engine.set_tint(UiTheme.DANGER)
	_engine.material = ParticleBurst.add_material()
	_hull = PImage.make(null, 0, 0, key)
	_nose_glow = PImage.make(null, 0, 0, Tex.GLOW)
	_nose_glow.set_tint(UiTheme.DANGER)
	_nose_glow.material = ParticleBurst.add_material()
	_nose_glow.visible = false

	_text = PText.new(problem, TextStyles.numeral({"font_size": UiTheme.SIZES.problem, "color": UiTheme.css(UiTheme.TEXT)}))
	_text.set_origin(0.5)
	tag_width = ceilf(_text.width) + TAG_PAD_X * 2
	tag_height = ceilf(_text.height) + TAG_PAD_Y * 2
	_hairline = PGraphics.new()
	_plate = PGraphics.new()

	for c in [_aim, _engine, _hull, _nose_glow, _hairline, _plate, _text]:
		add_child(c)
	set_ship_size(size)
	set_tag_side("right")
	set_threat(0)
	if parent != null:
		parent.add_child(self)


## Half the visible hull width at the current size.
var ship_half_width: float:
	get:
		return (_size * _hull_frac) / 2.0

var ship_half_height: float:
	get:
		return _size / 2.0

var ship_size: float:
	get:
		return _size


## Ship length in px (the 256 px frame scaled to it).
func set_ship_size(size: float) -> EnemyShip:
	if absf(size - _size) < 0.25:
		return self
	_size = size
	_hull.scale = Vector2.ONE * (size / _hull.texture.get_width())
	# Engines are at the top of the hull (the nose points down).
	_engine.position = Vector2(0, -size * 0.42)
	_engine.scale = Vector2((size * 0.9) / 128.0, (size * 0.55) / 128.0)
	if _side != "":
		_layout_tag(_side, true)
	return self


func set_tag_side(side: String) -> EnemyShip:
	if side == _side:
		return self
	_layout_tag(side, false)
	return self


func set_threat(level: int) -> EnemyShip:
	if level == _threat:
		return self
	_threat = level
	_draw_tag()
	return self


## Nose of the hull in view coordinates (where an armed ship's shot leaves).
var nose: Dictionary:
	get:
		return {"x": position.x, "y": position.y + _size * NOSE}


## Armed ship: `charge` 0..1 (null = unarmed). A red glow at the nose grows with the charge; in the
## last quarter a hairline red aiming line runs to `target` (the cockpit, view coords).
func set_charge(charge: Variant, target: Variant) -> EnemyShip:
	_charge = charge
	if charge == null:
		_nose_glow.visible = false
		_aim.visible = false
		return self
	var c := minf(1.0, maxf(0.0, charge))
	var flicker := 0.85 + 0.15 * sin(_glow_phase * 3.1)
	# Charging starts high on the screen where ships are small: the glow has a visible floor from
	# the first moment and grows over the whole charge.
	_nose_glow.visible = true
	_nose_glow.position = Vector2(0, _size * NOSE)
	_nose_glow.scale = Vector2.ONE * ((_size * (0.6 + 1.0 * c)) / 128.0)
	_nose_glow.set_alpha((0.5 + 0.45 * c) * flicker)
	var g := _aim
	if c < AIM_FROM_CHARGE:
		g.visible = false
		return self
	var k := (c - AIM_FROM_CHARGE) / (1.0 - AIM_FROM_CHARGE)
	g.clear()
	g.visible = true
	g.line_style(UiTheme.LINE_WIDTH, UiTheme.DANGER, (0.25 + 0.55 * k) * flicker)
	g.line_between(0, _size * NOSE, target.x - position.x, target.y - position.y)
	return self


## Engine glow shimmer; call every frame.
func tick(dt_ms: float) -> void:
	_glow_phase += dt_ms * 0.012
	_engine.set_alpha(0.32 + 0.1 * sin(_glow_phase) + 0.05 * sin(_glow_phase * 2.7))
	if _charge != null:
		# A hot white core flickers in once the shot is close.
		var c: float = _charge
		_nose_glow.set_tint(0xffb0a0 if c > 0.85 and sin(_glow_phase * 7) > 0 else UiTheme.DANGER)


## Arrival: fades in while the hull drops into place.
func play_entry(duration_ms: float = 500.0) -> EnemyShip:
	modulate.a = 0
	PTween.add(self, {"alpha": 1.0}, duration_ms, "Quad.easeOut")
	for part in [_hull, _engine]:
		var y: float = part.position.y
		part.position.y = y - 18
		PTween.add(part, {"y": y}, duration_ms, "Cubic.easeOut")
	return self


func destroy() -> void:
	queue_free()


func _layout_tag(side: String, force: bool) -> void:
	if not force and side == _side:
		return
	_side = side
	var dir := 1.0 if side == "right" else -1.0
	var near := dir * (ship_half_width + BattleLayout.TAG_GAP)
	_text.position = Vector2(near + dir * (tag_width / 2.0), 0)
	_draw_tag()


func _draw_tag() -> void:
	if _side == "":
		return
	var dir := 1.0 if _side == "right" else -1.0
	var w := tag_width
	var h := tag_height
	var near := dir * (ship_half_width + BattleLayout.TAG_GAP)
	var left := near if dir > 0 else near - w
	var critical := _threat == 2
	var frame := UiTheme.DANGER if critical else UiTheme.PRIMARY

	var p := _plate
	p.clear()
	# Opaque enough to stay legible over the bright planet.
	p.fill_style(UiTheme.PLATE, 0.9)
	p.fill_rect(left, -h / 2, w, h)
	p.line_style(UiTheme.LINE_WIDTH, frame, 0.75 if _threat == 0 else 1.0)
	p.stroke_rect(left + 0.5, -h / 2 + 0.5, w - 1, h - 1)
	if _threat >= 1:
		# Short bar on the outer edge: a shape cue that does not depend on colour.
		p.fill_style(frame, 1)
		p.fill_rect(left + w - 3 if dir > 0 else left, -h / 2, 3, h)

	var g := _hairline
	g.clear()
	var from := dir * (ship_half_width + 2)
	g.line_style(UiTheme.LINE_WIDTH, frame, 0.7)
	g.line_between(from, 0.5, near, 0.5)
	if critical:
		# Downward chevron on the hairline: about to hit.
		var mx := (from + near) / 2.0
		g.fill_style(frame, 1)
		g.fill_triangle(mx - 4, -3, mx + 4, -3, mx, 3)
