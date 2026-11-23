class_name Keypad
extends Node2D
## Port of src/ui/Keypad.ts: compact, semi-transparent touch keypad in two clusters: a 4x3 digit
## pad (1-4, 5-8, 9 0 ± ⌫) and one tall FIRE key, each in its own rectangle. Keys act on press.
## Positions are absolute. Keypad.new(parent, callbacks, opts):
##   callbacks = {on_digit: Callable(d), on_sign: Callable(), on_backspace: Callable(), on_fire: Callable()}
##   opts = {fire_label: String, digits: Rect, fire: Rect, gap: float = 4}
## Rect = {x, y, w, h} Dictionary (as in the TS layouts) or a Rect2.

const ROWS := [
	[["digit", 1], ["digit", 2], ["digit", 3], ["digit", 4]],
	[["digit", 5], ["digit", 6], ["digit", 7], ["digit", 8]],
	[["digit", 9], ["digit", 0], ["sign", -1], ["backspace", -1]],
]


static func _rect(r: Variant) -> Rect2:
	if r is Rect2:
		return r
	return Rect2(r.x, r.y, r.w, r.h)


func _init(parent: Node, callbacks: Dictionary, opts: Dictionary) -> void:
	var gap: float = opts.get("gap", 4)
	var d := _rect(opts.digits)
	var kw := (d.size.x - 3 * gap) / 4.0
	var kh := (d.size.y - 2 * gap) / 3.0
	for r in ROWS.size():
		for c in ROWS[r].size():
			var spec: Array = ROWS[r][c]
			var kind: String = spec[0]
			var digit: int = spec[1]
			var action: Callable
			if kind == "digit":
				action = func(): callbacks.on_digit.call(digit)
			elif kind == "sign":
				action = func(): callbacks.on_sign.call()
			else:
				action = func(): callbacks.on_backspace.call()
			add_child(_make_key(d.position.x + c * (kw + gap) + kw / 2, d.position.y + r * (kh + gap) + kh / 2, kw, kh,
				kind, digit, opts.get("fire_label", ""), action))
	var f := _rect(opts.fire)
	add_child(_make_key(f.position.x + f.size.x / 2, f.position.y + f.size.y / 2, f.size.x, f.size.y, "fire", -1,
		opts.get("fire_label", ""), func(): callbacks.on_fire.call()))
	if parent != null:
		parent.add_child(self)


func _make_key(x: float, y: float, w: float, h: float, kind: String, digit: int, fire_label: String, action: Callable) -> Node2D:
	var key := Node2D.new()
	key.position = Vector2(x, y)
	var color := UiTheme.DANGER if kind == "fire" else (UiTheme.PRIMARY if kind == "digit" else UiTheme.ACCENT)
	var bg := PGraphics.new()
	var draw := func(pressed: bool) -> void:
		bg.clear()
		bg.fill_style(UiTheme.BG, 0.7 if pressed else 0.42)
		bg.fill_rect(-w / 2, -h / 2, w, h)
		if pressed:
			bg.fill_style(color, 0.3)
			bg.fill_rect(-w / 2, -h / 2, w, h)
		bg.line_style(UiTheme.LINE_WIDTH, color, 1.0 if pressed else 0.55)
		bg.stroke_rect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1)
	draw.call(false)
	key.add_child(bg)

	if kind == "backspace":
		key.add_child(_backspace_icon())
	elif kind == "fire":
		key.add_child(_fire_icon(h))
		var t := PText.new(fire_label.to_upper(), {
			"font_family": UiTheme.FONT_UI, "font_size": UiTheme.SIZES.small, "font_style": 600,
			"color": UiTheme.css(UiTheme.TEXT), "letter_spacing": UiTheme.LETTER_SPACING.caps,
		})
		t.position = Vector2(0, h / 2 - 16)
		t.set_origin(0.5)
		key.add_child(t)
	else:
		var t := PText.new(str(digit) if kind == "digit" else "±", {
			"font_family": UiTheme.FONT_MONO, "font_size": UiTheme.SIZES.heading + 2, "color": UiTheme.css(UiTheme.TEXT),
		})
		t.set_origin(0.5)
		key.add_child(t)

	var hit := HitArea.new(w, h)
	key.add_child(hit)
	hit.down.connect(func():
		draw.call(true)
		key.scale = Vector2.ONE * 0.96
		action.call())
	var release := func() -> void:
		draw.call(false)
		key.scale = Vector2.ONE
	hit.up.connect(func(_inside: bool, _touch: bool): release.call())
	hit.out.connect(release)
	return key


## Crosshair glyph for the fire key.
func _fire_icon(h: float) -> PGraphics:
	var g := PGraphics.new()
	var cy := -8.0
	var r := minf(18.0, h * 0.16)
	g.line_style(UiTheme.LINE_WIDTH + 0.5, UiTheme.TEXT, 0.95)
	g.stroke_circle(0, cy, r)
	g.line_between(-r - 6, cy, -r + 5, cy)
	g.line_between(r - 5, cy, r + 6, cy)
	g.line_between(0, cy - r - 6, 0, cy - r + 5)
	g.line_between(0, cy + r - 5, 0, cy + r + 6)
	g.fill_style(UiTheme.DANGER, 1)
	g.fill_circle(0, cy, 2.5)
	return g


## Left-pointing tag with a cross, drawn so it does not depend on font glyph coverage.
func _backspace_icon() -> PGraphics:
	var g := PGraphics.new()
	g.line_style(1.5, UiTheme.TEXT, 1)
	g.stroke_points([Vector2(-12, 0), Vector2(-4, -8), Vector2(12, -8), Vector2(12, 8), Vector2(-4, 8)], true, true)
	g.line_between(0, -4, 7, 4)
	g.line_between(0, 4, 7, -4)
	return g
