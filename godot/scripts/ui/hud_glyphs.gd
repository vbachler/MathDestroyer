class_name HudGlyphs
## Port of src/ui/hudGlyphs.ts: HUD glyphs drawn on a PGraphics.

## Credits glyph: a thin hexagonal chip with a filled core, centred on (x, y); `size` is its height.
static func draw_credit_glyph(g: PGraphics, x: float, y: float, size: float, color: int = UiTheme.PRIMARY, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(UiTheme.LINE_WIDTH, color, alpha)
	g.begin_path()
	for i in 7:
		var a := PI / 6 + (i * PI) / 3
		var px := x + cos(a) * r
		var py := y + sin(a) * r
		if i == 0:
			g.move_to(px, py)
		else:
			g.line_to(px, py)
	g.stroke_path()
	g.fill_style(color, alpha)
	g.fill_rect(x - r * 0.28, y - r * 0.28, r * 0.56, r * 0.56)


## Enter (return) glyph: a bent arrow, down then left, centred on (x, y); `size` is its height.
static func draw_enter_glyph(g: PGraphics, x: float, y: float, size: float, color: int = UiTheme.PRIMARY, alpha: float = 1.0) -> void:
	var h := size / 2.0
	var right := x + h * 0.9
	var left := x - h * 0.9
	var low := y + h * 0.45
	var head := h * 0.5
	g.line_style(UiTheme.LINE_WIDTH + 0.5, color, alpha)
	g.line_between(right, y - h, right, low)
	g.line_between(right, low, left, low)
	g.line_between(left, low, left + head, low - head)
	g.line_between(left, low, left + head, low + head)


## Small right-pointing arrow (shaft and head), centred on (x, y); `w` is its length.
static func draw_right_arrow(g: PGraphics, x: float, y: float, w: float, color: int = UiTheme.PRIMARY, alpha: float = 1.0) -> void:
	var head := w * 0.35
	g.line_style(UiTheme.LINE_WIDTH, color, alpha)
	g.line_between(x - w / 2, y, x + w / 2, y)
	g.line_between(x + w / 2, y, x + w / 2 - head, y - head)
	g.line_between(x + w / 2, y, x + w / 2 - head, y + head)
