class_name MapGlyphs
## Port of src/ui/mapGlyphs.ts: thin line glyphs of the star map, each centred on (x, y) and about
## `size` px across. A GlyphDraw is a Callable(g: PGraphics, x, y, size, color, alpha), e.g.
## MapGlyphs.draw_galaxy_glyph (static method references are Callables).


## Galaxy: a bright core and two spiral arms.
static func draw_galaxy_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1.2, color, alpha)
	for arm in 2:
		g.begin_path()
		for k in 17:
			var t := k / 16.0
			var a := arm * PI + t * PI * 1.25
			var d := r * (0.18 + 0.82 * t)
			var px := x + cos(a) * d
			var py := y + sin(a) * d * 0.62
			if k == 0:
				g.move_to(px, py)
			else:
				g.line_to(px, py)
		g.stroke_path()
	g.fill_style(color, alpha)
	g.fill_circle(x, y, maxf(1.5, size * 0.1))


## Star system: a sun and one tilted orbit with a planet on it.
static func draw_system_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1, color, alpha * 0.85)
	g.stroke_ellipse(x, y, r * 2, r * 0.8)
	g.fill_style(color, alpha)
	g.fill_circle(x, y, maxf(2.0, size * 0.14))
	g.fill_circle(x + r * 0.72, y + r * 0.28, maxf(1.2, size * 0.07))


## Hangar: a bay door under a low roof.
static func draw_hangar_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1.2, color, alpha)
	g.begin_path()
	g.move_to(x - r, y + r * 0.7)
	g.line_to(x - r, y - r * 0.15)
	g.line_to(x, y - r * 0.7)
	g.line_to(x + r, y - r * 0.15)
	g.line_to(x + r, y + r * 0.7)
	g.stroke_path()
	g.line_style(1, color, alpha * 0.8)
	g.stroke_rect(x - r * 0.5, y + r * 0.05, r, r * 0.65)
	g.line_between(x, y + r * 0.05, x, y + r * 0.7)


## Report: three bars of rising height on a base line.
static func draw_report_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	var bw := size * 0.17
	var base := y + r * 0.7
	g.fill_style(color, alpha)
	var ks := [0.45, 0.8, 1.25]
	for i in ks.size():
		var hk: float = ks[i]
		var bx := x - r * 0.62 + i * size * 0.3
		g.fill_rect(bx, base - r * hk, bw, r * hk)
	g.line_style(1, color, alpha * 0.8)
	g.line_between(x - r, base + 1.5, x + r, base + 1.5)


## Menu: three short lines.
static func draw_menu_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1.4, color, alpha)
	for i in [-1, 0, 1]:
		g.line_between(x - r * 0.8, y + i * r * 0.5, x + r * 0.8, y + i * r * 0.5)


## The Static's marker: an angular three-pronged sigil (three barbed spikes around a hollow core).
static func draw_static_sigil(g: PGraphics, x: float, y: float, size: float, color: int = UiTheme.DANGER, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.fill_style(color, alpha)
	for k in 3:
		var a := -PI / 2 + (k * PI * 2) / 3
		var ca := cos(a)
		var sa := sin(a)
		var px := -sa
		var py := ca
		var bx := x + ca * r * 0.3
		var by := y + sa * r * 0.3
		var tx := x + ca * r
		var ty := y + sa * r
		g.fill_triangle(bx + px * r * 0.26, by + py * r * 0.26, bx - px * r * 0.26, by - py * r * 0.26, tx, ty)
		g.fill_triangle(tx, ty, x + ca * r * 0.62 + px * r * 0.42, y + sa * r * 0.62 + py * r * 0.42,
			x + ca * r * 0.7, y + sa * r * 0.7)
	g.line_style(1, color, alpha)
	g.stroke_circle(x, y, r * 0.2)


## Defend: a shield.
static func draw_defend_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1.3, color, alpha)
	g.begin_path()
	g.move_to(x, y - r)
	g.line_to(x + r * 0.8, y - r * 0.62)
	g.line_to(x + r * 0.66, y + r * 0.25)
	g.line_to(x, y + r)
	g.line_to(x - r * 0.66, y + r * 0.25)
	g.line_to(x - r * 0.8, y - r * 0.62)
	g.close_path()
	g.stroke_path()
	g.line_between(x, y - r * 0.55, x, y + r * 0.55)


## Liberate: a target reticle.
static func draw_liberate_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1.2, color, alpha)
	g.stroke_circle(x, y, r * 0.62)
	g.line_between(x - r, y, x - r * 0.35, y)
	g.line_between(x + r * 0.35, y, x + r, y)
	g.line_between(x, y - r, x, y - r * 0.35)
	g.line_between(x, y + r * 0.35, x, y + r)
	g.fill_style(color, alpha)
	g.fill_circle(x, y, maxf(1.0, size * 0.07))


## Patrol: an orbit with a ship arrow riding it.
static func draw_patrol_glyph(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.line_style(1.2, color, alpha * 0.85)
	g.begin_path()
	g.arc(x, y, r * 0.75, PI * 0.15, PI * 1.75, false)
	g.stroke_path()
	draw_chevron(g, x + r * 0.62, y - r * 0.45, size * 0.42, -PI / 5, color, alpha)


## The glyph of a call kind ("defend" | "liberate" | "patrol").
static func draw_kind_glyph(g: PGraphics, kind: String, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	if kind == "defend":
		draw_defend_glyph(g, x, y, size, color, alpha)
	elif kind == "liberate":
		draw_liberate_glyph(g, x, y, size, color, alpha)
	else:
		draw_patrol_glyph(g, x, y, size, color, alpha)


## Colour of a call kind: defend is urgent (danger), the others amber.
static func kind_color(kind: String) -> int:
	return UiTheme.DANGER if kind == "defend" else UiTheme.PRIMARY


## Filled arrow head pointing along `angle` (radians, 0 = right).
static func draw_chevron(g: PGraphics, x: float, y: float, size: float, angle: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	var c := cos(angle)
	var s := sin(angle)
	var tip_x := x + c * r
	var tip_y := y + s * r
	var back_x := x - c * r * 0.7
	var back_y := y - s * r * 0.7
	g.fill_style(color, alpha)
	g.fill_triangle(tip_x, tip_y, back_x - s * r * 0.75, back_y + c * r * 0.75, x - c * r * 0.25, y - s * r * 0.25)
	g.fill_triangle(tip_x, tip_y, back_x + s * r * 0.75, back_y - c * r * 0.75, x - c * r * 0.25, y - s * r * 0.25)


## Call blip: a small diamond with an outer tick ring.
static func draw_call_blip(g: PGraphics, x: float, y: float, size: float, color: int, alpha: float = 1.0) -> void:
	var r := size / 2.0
	g.fill_style(color, alpha)
	g.fill_triangle(x, y - r * 0.55, x + r * 0.4, y, x - r * 0.4, y)
	g.fill_triangle(x, y + r * 0.55, x + r * 0.4, y, x - r * 0.4, y)
	g.line_style(1, color, alpha * 0.7)
	g.stroke_circle(x, y, r)
