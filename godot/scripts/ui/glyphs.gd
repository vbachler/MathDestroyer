class_name Glyphs
## Port of src/ui/glyphs.ts: drawing helpers on a PGraphics (HUD glyphs: HudGlyphs).


## Thin progress ring: dim track plus an arc from 12 o'clock covering `fraction` of the circle.
static func draw_ring(g: PGraphics, x: float, y: float, r: float, fraction: float, color: int, width: float = 4.0) -> void:
	g.line_style(width, UiTheme.PRIMARY_DIM, 0.45)
	g.stroke_circle(x, y, r)
	var f := minf(1.0, maxf(0.0, fraction))
	if f <= 0:
		return
	g.line_style(width, color, 1)
	g.begin_path()
	if f >= 1:
		g.arc(x, y, r, 0, PI * 2, false)
	else:
		g.arc(x, y, r, -PI / 2, -PI / 2 + PI * 2 * f, false)
	g.stroke_path()


## Horizontal progress bar with its top-left corner at (x, y).
static func draw_bar(g: PGraphics, x: float, y: float, w: float, h: float, fraction: float, color: int) -> void:
	var f := minf(1.0, maxf(0.0, fraction))
	g.fill_style(UiTheme.BG_PANEL_HI, 1)
	g.fill_rect(x, y, w, h)
	if f > 0:
		g.fill_style(color, 1)
		g.fill_rect(x, y, maxf(2.0, w * f), h)
	g.line_style(1, UiTheme.PRIMARY_DIM, 0.9)
	g.stroke_rect(x, y, w, h)
