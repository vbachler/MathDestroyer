class_name Crawler
extends Node2D
## Port of src/fx/Crawler.ts: one boarding crawler, standing on the hangar floor in one-point
## perspective. With its walk-cycle sheet it plays the 16-frame loop (rate follows its approach
## speed) plus a bob and zig-zag in code; without it, a still animated in code (leg skitter as a
## quick rock and squash, bob, zig-zag). Flying kinds (GAIT hover) float above their floor point
## over a soft shadow blob; gliding kinds only sway. The node origin is the floor point; the body
## pivots there. The problem tag lives in its own node (`tag_layer`) that the scene puts in a layer
## above the foreground guns.
## Crawler.new(body_parent, tag_parent, id, kind, problem, speed_factor).

const TAG_PAD_X := 9.0
const TAG_PAD_Y := 3.0
## Below this z the tag frame turns red: about to bite.
const CLOSE_Z := 0.22
const ENTRY_MS := 700.0

## Opaque extent of each processed image (fractions of the 512 px frame, measured): top, foot, width.
const FRAME := {
	"scorpion": {"top": 0.025, "foot": 0.975},
	"spider": {"top": 0.23, "foot": 0.77},
	"crab": {"top": 0.035, "foot": 0.965},
	"beetle": {"top": 0.0, "foot": 1.0},
	"stalker": {"top": 0.0, "foot": 1.0},
	"drifter": {"top": 0.002, "foot": 1.0, "w": 0.66},
	"wraith": {"top": 0.004, "foot": 1.0, "w": 0.83},
}
## Union of the opaque extent over the 16 walk-cycle cells (fractions of the 256 px cell, measured).
const WALK_FRAME := {
	"scorpion": {"top": 0.023, "foot": 0.973},
	"spider": {"top": 0.23, "foot": 0.766},
	"crab": {"top": 0.059, "foot": 0.938},
	"beetle": {"top": 0.0, "foot": 0.992},
	"stalker": {"top": 0.004, "foot": 0.996, "w": 0.96},
	"drifter": {"top": 0.008, "foot": 0.996, "w": 0.7},
	"wraith": {"top": 0.016, "foot": 0.996, "w": 0.84},
}
## Walk-cycle frame rate at speed factor 1 (the crawler's speed relative to UNIT_SPEED).
const WALK_FPS := 12.0

## The code-drawn fallbacks: body roughly 0.2..0.9 of the 256 px frame (tall kinds start higher).
const FALLBACK_FRAME := {
	"drifter": {"top": 0.17, "foot": 0.9, "w": 0.5},
	"wraith": {"top": 0.1, "foot": 0.9, "w": 0.75},
}
const FALLBACK_DEFAULT := {"top": 0.2, "foot": 0.9}

## Soft floor shadow under a flying crawler: starting alpha (follow() sets it per frame).
const HOVER_SHADOW_ALPHA := 0.5

var id: int
var tag_width: float
var tag_height: float
## The tag (hairline, plate, text): a separate node the scene layers above the guns.
var tag_layer: Node2D

var _kind: String
var _sprite: Sprite2D
var _sheet := ""
var _anim_frame := 0
var _anim_ms := 0.0
var _anim_scale := 1.0
## True when the walk-cycle sheet plays (no fake rock/squash skitter then).
var _walking: bool
var _flying: bool
var _shadow: Node2D
var _shadow_ellipse: PGraphics = null
var _hairline: PGraphics
var _plate: PGraphics
var _text: PText
var _frame: Dictionary
var _frame_scale: float
var _tex_w: float
var _seed := randf() * PI * 2.0
var _clock := 0.0
var _leg_phase := 0.0
var _depth_z := 1.0
var _side := ""
var _close := false
var _drawn_w := 0.0
var _drawn_h := 0.0
## Height of the body's feet above the floor point (flying kinds), px.
var _air_y := 0.0
## Set while the bite lunge runs: the crawler no longer follows the floor.
var _lunging := false
## Sort key for the scene's layer ordering (Phaser depth): DEPTH.enemies + depth_order(z) * 5.
var sort_depth := 0.0


## speed_factor: approach speed relative to the base speed (1 = a speed-1 crawler at game speed 1);
## the walk cycle runs at WALK_FPS times this.
func _init(body_parent: Node, tag_parent: Node, p_id: int, kind: String, problem: String, speed_factor: float = 1.0) -> void:
	id = p_id
	_kind = kind
	_sheet = Assets.crawler_walk_for(kind)
	var image := Assets.crawler_image_for(kind)
	_walking = Assets.has_image(_sheet)
	var real := Assets.has_image(image)
	var key: String = _sheet if _walking else (image if real else Tex.CRAWLER_FALLBACK[kind])
	_frame = WALK_FRAME[kind] if _walking else (FRAME[kind] if real else FALLBACK_FRAME.get(kind, FALLBACK_DEFAULT))
	_flying = BoardingLayout.GAIT[kind].has("hover")

	if _flying:
		var shade := PImage.make(null, 0, 0, Tex.SHADE)
		shade.set_tint(0x000000)
		shade.set_alpha(HOVER_SHADOW_ALPHA)
		_shadow = shade
	else:
		# Phaser ellipse 10x4, black at 0.5 (resized per frame: drawn as a unit ellipse, scaled).
		_shadow = Node2D.new()
		_shadow_ellipse = PGraphics.new()
		_shadow_ellipse.fill_style(0x000000, 0.5)
		_shadow_ellipse.fill_ellipse(0, 0, 1, 1, 48)
		_shadow_ellipse.scale = Vector2(10, 4)
		_shadow.add_child(_shadow_ellipse)
	_sprite = Sprite2D.new()
	_sprite.centered = false
	if _walking:
		_anim_frame = randi() % Assets.WALK_FRAMES
		_sprite.texture = Assets.sheet_frame(_sheet, _anim_frame)
		# Flying / gliding kinds breathe rather than walk: their loop keeps its own pace.
		var glides: bool = _flying or BoardingLayout.GAIT[kind].get("glide", false)
		_anim_scale = 0.8 if glides else maxf(0.3, speed_factor)
	else:
		_sprite.texture = Assets.texture(key)
	_tex_w = _sprite.texture.get_width()
	var tex_h: float = _sprite.texture.get_height()
	_sprite.offset = -Vector2(_tex_w * 0.5, tex_h * _frame.foot)
	_frame_scale = (BoardingLayout.CRAWLER_NEAR_W * BoardingLayout.CRAWLER_SIZE[kind]) / _tex_w

	_text = PText.new(problem, TextStyles.numeral({"font_size": UiTheme.SIZES.problem, "color": UiTheme.css(UiTheme.TEXT)}))
	_text.set_origin(0.5)
	tag_width = ceilf(_text.width) + TAG_PAD_X * 2
	tag_height = ceilf(_text.height) + TAG_PAD_Y * 2
	_hairline = PGraphics.new()
	_plate = PGraphics.new()
	add_child(_shadow)
	add_child(_sprite)
	tag_layer = Node2D.new()
	tag_layer.add_child(_hairline)
	tag_layer.add_child(_plate)
	tag_layer.add_child(_text)

	# Emerges from the gloom of the door.
	_sprite.modulate.a = 0
	for o in [_hairline, _plate, _text]:
		o.modulate.a = 0
	PTween.add(_sprite, {"alpha": 1.0}, ENTRY_MS, "Quad.easeOut")
	for o in [_hairline, _plate, _text]:
		PTween.add(o, {"alpha": 1.0}, 300, "Linear", {"delay": ENTRY_MS * 0.4})
	body_parent.add_child(self)
	tag_parent.add_child(tag_layer)


## Half the drawn body width (for tag layout).
var half_width: float:
	get:
		return _drawn_w / 2.0
var half_height: float:
	get:
		return _drawn_h / 2.0
## Centre of the drawn body in view coordinates (lifted with a flying body).
var centre: Dictionary:
	get:
		return {"x": position.x, "y": position.y - _air_y - _drawn_h / 2.0}
var depth_z: float:
	get:
		return _depth_z


## Follows the sim: depth z and lane. Call every frame with the frame time.
func follow(dt_ms: float, z: float, lane: float) -> Crawler:
	if _lunging:
		return self
	_clock += dt_ms
	_depth_z = z
	if _walking and dt_ms > 0:
		# Our own pause (dt 0) freezes the walk too.
		_anim_ms += dt_ms * _anim_scale
		var step := 1000.0 / WALK_FPS
		if _anim_ms >= step:
			var n := int(floorf(_anim_ms / step))
			_anim_ms -= n * step
			_anim_frame = (_anim_frame + n) % Assets.WALK_FRAMES
			_sprite.texture = Assets.sheet_frame(_sheet, _anim_frame)
	var style: Dictionary = BoardingLayout.GAIT[_kind]
	_leg_phase += (dt_ms / 1000.0) * BoardingLayout.gait_hz(style, z) * PI * 2.0
	var pose := BoardingLayout.gait_pose(style, _clock, _leg_phase, _seed)
	var s := BoardingLayout.perspective_scale(z)
	var feet := BoardingLayout.floor_point(z, lane, pose.sway)
	var width: float = BoardingLayout.CRAWLER_NEAR_W * BoardingLayout.CRAWLER_SIZE[_kind] * s
	_drawn_w = width * _frame.get("w", 1.0)
	_drawn_h = width * (_frame.foot - _frame.top)
	position = Vector2(feet.x, feet.y)

	var k := _frame_scale * s
	var smooth: bool = _flying or style.get("glide", false)
	if smooth:
		# No legs: sway about the feet (or the hovering body), bob only when flying.
		_air_y = BoardingLayout.hover_lift(style, _drawn_h) + pose.lift * _drawn_h
		_sprite.scale = Vector2(k, k)
		_sprite.rotation = pose.rotation
		_sprite.position.y = -_air_y
	elif _walking:
		_air_y = 0.0
		_sprite.scale = Vector2(k, k)
		_sprite.position.y = -pose.lift * 0.5 * _drawn_h
	else:
		_air_y = 0.0
		_sprite.scale = Vector2(k * pose.scale_x, k * pose.scale_y)
		_sprite.rotation = pose.rotation
		_sprite.position.y = -pose.lift * _drawn_h
	var b := BoardingLayout.brightness(z)
	var c := func(f: float) -> float: return roundf(255.0 * minf(1.0, b * f)) / 255.0
	_sprite.self_modulate = Color(c.call(0.92), c.call(0.96), c.call(1.0))
	if _flying:
		# Soft blob on the floor: smaller and fainter the higher the body floats.
		var h_norm := _air_y / maxf(1.0, _drawn_h)
		# (The shade disc is solid only to 40 % of its size, so it is drawn wide.)
		var spread := 1.9 - 0.5 * h_norm
		(_shadow as PImage).set_display_size(_drawn_w * spread, maxf(4.0, _drawn_w * 0.38 * spread))
		_shadow.modulate.a = minf(0.85, (0.35 + 0.5 * b) * (1.15 - 0.3 * h_norm))
	else:
		_shadow_ellipse.scale = Vector2(width * 0.8, maxf(2.0, width * 0.12))
		_shadow.modulate.a = 0.25 + 0.4 * b
		_shadow.scale = Vector2.ONE * (1.0 - 0.25 * pose.lift / maxf(0.001, style.bob))
	sort_depth = UiTheme.DEPTH.enemies + BoardingLayout.depth_order(z) * 5

	var close := z < CLOSE_Z
	if close != _close:
		_close = close
		_draw_tag()
	_sync_tag()
	if _side != "":
		_place_tag()
	return self


func set_tag_side(side: String) -> Crawler:
	if side == _side:
		return self
	_side = side
	_place_tag()
	_draw_tag()
	return self


## The bite: the crawler leaps at the viewer until it fills the screen, then the caller flashes
## and shakes. `on_done` runs when the lunge ends (the crawler is freed after it). The crawler
## leaves its layer ordering (z = DEPTH.overlay - 10).
func lunge(on_done: Callable) -> void:
	_lunging = true
	tag_layer.visible = false
	_shadow.visible = false
	z_as_relative = false
	z_index = UiTheme.DEPTH.overlay - 10
	var target := (3.4 * UiTheme.GAME_WIDTH) / _tex_w
	_sprite.self_modulate = Color.WHITE
	PTween.add(self, {"x": UiTheme.GAME_WIDTH / 2.0, "y": UiTheme.GAME_HEIGHT * 1.55}, 220, "Quad.easeIn")
	var finish := func() -> void:
		on_done.call()
		PTween.add(self, {"alpha": 0.0}, 120, "Linear", {"on_complete": destroy})
	PTween.add(_sprite, {"scale_x": target, "scale_y": target, "y": 0.0, "rotation": _sprite.rotation * 3}, 220, "Quad.easeIn",
		{"on_complete": finish})


func destroy() -> void:
	if is_instance_valid(tag_layer):
		tag_layer.queue_free()
	queue_free()


## The tag follows the body; the scene's tag layer draws above the guns (nearer on top).
func _sync_tag() -> void:
	tag_layer.position = Vector2(position.x, position.y - _air_y)


func _place_tag() -> void:
	if _side == "":
		return
	var dir := 1.0 if _side == "right" else -1.0
	var near := dir * (_drawn_w / 2.0 + BattleLayout.TAG_GAP)
	var cy := -_drawn_h / 2.0
	_text.position = Vector2(near + dir * (tag_width / 2.0), cy)
	_draw_tag()


func _draw_tag() -> void:
	if _side == "":
		return
	var dir := 1.0 if _side == "right" else -1.0
	var w := tag_width
	var h := tag_height
	var cy := -_drawn_h / 2.0
	var near := dir * (_drawn_w / 2.0 + BattleLayout.TAG_GAP)
	var left := near if dir > 0 else near - w
	var frame := UiTheme.DANGER if _close else UiTheme.PRIMARY

	var p := _plate
	p.clear()
	p.fill_style(UiTheme.PLATE, 0.9)
	p.fill_rect(left, cy - h / 2, w, h)
	p.line_style(UiTheme.LINE_WIDTH, frame, 1.0 if _close else 0.8)
	p.stroke_rect(left + 0.5, cy - h / 2 + 0.5, w - 1, h - 1)
	if _close:
		p.fill_style(frame, 1)
		p.fill_rect(left + w - 3 if dir > 0 else left, cy - h / 2, 3, h)
	var g := _hairline
	g.clear()
	g.line_style(UiTheme.LINE_WIDTH, frame, 0.7)
	g.line_between(dir * (_drawn_w * 0.3), cy + 0.5, near, cy + 0.5)
