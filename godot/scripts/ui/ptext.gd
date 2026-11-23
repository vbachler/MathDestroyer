class_name PText
extends Node2D
## Phaser.GameObjects.Text for the port: drawn in _draw with the bundled fonts, measured like
## Phaser (box = widest line x line heights + padding) and placed by an origin (default 0, 0 =
## top-left; set_origin(0.5) centres the box on the node position like Phaser setOrigin(0.5)).
##
## Style: a Dictionary with Phaser TextStyle fields in snake_case (TextStyles builds them):
##   font_family "ui" | "mono"           font_size int px (or "24px")   font_style weight 400..700 / "normal" / "bold"
##   color "#rrggbb" or 0xRRGGBB         letter_spacing px              line_spacing px
##   align "left" | "center" | "right"   word_wrap_width px (0 = none)  stroke colour + stroke_thickness px
##   background_color "#rrggbbaa"        padding {x, y} or {left, right, top, bottom}
##   shadow {x, y, color, blur, fill}    (blur is drawn as a soft outline glow)
## Phaser setTint -> modulate (rgb), setAlpha -> set_alpha (modulate.a).

var text: String = "":
	set(v):
		if v != text:
			text = v
			_dirty = true
			queue_redraw()
var style: Dictionary = {}
var origin := Vector2.ZERO

var _lines: PackedStringArray = []
var _size := Vector2.ZERO
var _font: Font
var _font_size := 16
var _dirty := true


func _init(p_text: String = "", p_style: Dictionary = {}) -> void:
	style = p_style.duplicate()
	text = p_text


## Phaser: scene.add.text(x, y, text, style). Adds the node to `parent` when given.
static func make(parent: Node, x: float, y: float, p_text: String, p_style: Dictionary = {}) -> PText:
	var t := PText.new(p_text, p_style)
	t.position = Vector2(x, y)
	if parent != null:
		parent.add_child(t)
	return t


func set_text(v: Variant) -> PText:
	text = str(v)
	return self


func set_style(p_style: Dictionary) -> PText:
	style.merge(p_style, true)
	_dirty = true
	queue_redraw()
	return self


func set_color(c: Variant) -> PText:
	return set_style({"color": c})


func set_font_size(px: Variant) -> PText:
	return set_style({"font_size": px})


func set_align(a: String) -> PText:
	return set_style({"align": a})


## Phaser setWordWrapWidth(width); 0 / null removes wrapping.
func set_word_wrap_width(w: Variant) -> PText:
	return set_style({"word_wrap_width": 0.0 if w == null else float(w)})


func set_origin(x: float, y: float = NAN) -> PText:
	origin = Vector2(x, x if is_nan(y) else y)
	queue_redraw()
	return self


func set_alpha(a: float) -> PText:
	modulate.a = a
	return self


func get_alpha() -> float:
	return modulate.a


## Phaser setTint: multiplies the colour (white = none).
func set_tint(c: int) -> PText:
	var col := UiTheme.color(c, modulate.a)
	modulate = col
	return self


func clear_tint() -> PText:
	modulate = Color(1, 1, 1, modulate.a)
	return self


## Phaser text.width / text.height: the unscaled box (with padding).
var width: float:
	get:
		_layout()
		return _size.x
var height: float:
	get:
		_layout()
		return _size.y
## Phaser displayWidth / displayHeight (scaled).
var display_width: float:
	get:
		return width * absf(scale.x)
var display_height: float:
	get:
		return height * absf(scale.y)


## The lines `t` wraps into with the current style (Phaser getWrappedText).
func get_wrapped_text(t: String = "") -> PackedStringArray:
	_resolve_font()
	return _wrap(t if t != "" else text)


## The box in local coordinates (origin applied, before scale).
func get_bounds() -> Rect2:
	_layout()
	return Rect2(-origin * _size, _size)


# ---------------------------------------------------------------- layout and drawing

func _style_num(key: String, fallback: float) -> float:
	var v = style.get(key)
	if v == null:
		return fallback
	if v is String:
		return float(v.trim_suffix("px").to_float())
	return float(v)


func _padding() -> Rect2:
	# x = left, y = top, w = right, h = bottom
	var p = style.get("padding")
	if p is Dictionary:
		var px := float(p.get("x", 0))
		var py := float(p.get("y", 0))
		return Rect2(float(p.get("left", px)), float(p.get("top", py)), float(p.get("right", px)), float(p.get("bottom", py)))
	return Rect2()


func _resolve_font() -> void:
	_font_size = int(round(_style_num("font_size", 16)))
	_font = UiTheme.font(str(style.get("font_family", UiTheme.FONT_UI)), style.get("font_style", 400),
		_style_num("letter_spacing", 0))


func _line_width(s: String) -> float:
	return _font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, _font_size).x


func _wrap(t: String) -> PackedStringArray:
	var out := PackedStringArray()
	var wrap := _style_num("word_wrap_width", 0)
	for para in t.split("\n"):
		if wrap <= 0:
			out.append(para)
			continue
		var line := ""
		for word in para.split(" ", false):
			var candidate := word if line == "" else line + " " + word
			if line != "" and _line_width(candidate) > wrap:
				out.append(line)
				line = word
			else:
				line = candidate
		out.append(line)
	return out


func _layout() -> void:
	if not _dirty:
		return
	_dirty = false
	_resolve_font()
	_lines = _wrap(text)
	var w := 0.0
	for l in _lines:
		w = maxf(w, _line_width(l))
	var line_h := _font.get_height(_font_size)
	var spacing := _style_num("line_spacing", 0)
	var h := line_h * _lines.size() + spacing * maxi(0, _lines.size() - 1)
	var stroke_t := _style_num("stroke_thickness", 0)
	var pad := _padding()
	_size = Vector2(w + stroke_t + pad.position.x + pad.size.x, h + stroke_t + pad.position.y + pad.size.y)


func _color_of(v: Variant, fallback: Color) -> Color:
	if v == null:
		return fallback
	if v is Color:
		return v
	if v is int:
		return UiTheme.color(v)
	return Color.html(str(v))


func _draw() -> void:
	_layout()
	var top_left := -origin * _size
	var bg = style.get("background_color")
	if bg != null:
		draw_rect(Rect2(top_left, _size), _color_of(bg, Color.TRANSPARENT))
	var pad := _padding()
	var stroke_t := _style_num("stroke_thickness", 0)
	var inner_w := _size.x - stroke_t - pad.position.x - pad.size.x
	var line_h := _font.get_height(_font_size)
	var spacing := _style_num("line_spacing", 0)
	var ascent := _font.get_ascent(_font_size)
	var fill := _color_of(style.get("color"), Color.WHITE)
	var align := str(style.get("align", "left"))
	var shadow = style.get("shadow")
	for i in _lines.size():
		var l: String = _lines[i]
		var lw := _line_width(l)
		var x := top_left.x + pad.position.x + stroke_t / 2.0
		if align == "center":
			x += (inner_w - lw) / 2.0
		elif align == "right":
			x += inner_w - lw
		var y := top_left.y + pad.position.y + stroke_t / 2.0 + i * (line_h + spacing) + ascent
		var pos := Vector2(x, y)
		if shadow is Dictionary:
			var sc := _color_of(shadow.get("color"), Color(0, 0, 0, 0.5))
			var off := Vector2(float(shadow.get("x", 0)), float(shadow.get("y", 0)))
			var blur := float(shadow.get("blur", 0))
			if blur > 0:
				for k in 3:
					var c := sc
					c.a *= 0.22
					draw_string_outline(_font, pos + off, l, HORIZONTAL_ALIGNMENT_LEFT, -1, _font_size,
						int(blur * (k + 1) / 1.5), c)
			if shadow.get("fill", true):
				draw_string(_font, pos + off, l, HORIZONTAL_ALIGNMENT_LEFT, -1, _font_size, sc)
		if stroke_t > 0 and style.get("stroke") != null:
			draw_string_outline(_font, pos, l, HORIZONTAL_ALIGNMENT_LEFT, -1, _font_size, int(round(stroke_t)),
				_color_of(style.get("stroke"), Color.BLACK))
		draw_string(_font, pos, l, HORIZONTAL_ALIGNMENT_LEFT, -1, _font_size, fill)
