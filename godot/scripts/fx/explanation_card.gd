class_name ExplanationCard
extends Node2D
## Port of src/fx/ExplanationCard.ts: small card shown while the sim explains a fact that reached
## the planet: the solved fact and, for small facts, a dot array or a number-line hop. No words,
## only numbers and shapes. About 420x260 (110 tall when there is no picture). (x, y) is the centre.
## ExplanationCard.new(parent, x, y, fact, i18n).

const CARD_W := 420.0
const CARD_H := 260.0
const CARD_H_PLAIN := 110.0
const DOT_MAX := 10
const LINE_MAX := 20


static func illustration_for(f: Dictionary) -> String:
	var in1to10 := func(n: float) -> bool: return n >= 1 and n <= DOT_MAX
	var in0to20 := func(n: float) -> bool: return n >= 0 and n <= LINE_MAX
	if f.op == "mul" and in1to10.call(f.a) and in1to10.call(f.b):
		return "dots"
	if (f.op == "add" or f.op == "sub") and in0to20.call(f.a) and in0to20.call(f.b) and in0to20.call(f.result):
		return "numberLine"
	return "none"


func _init(parent: Node, x: float, y: float, fact: Dictionary, i18n: I18n) -> void:
	position = Vector2(x, y)
	var kind := illustration_for(fact)
	var h := CARD_H_PLAIN if kind == "none" else CARD_H
	var top := -h / 2.0

	UiPanel.new(self, -CARD_W / 2.0, top, CARD_W, h, {"border_color": UiTheme.ACCENT, "fill_alpha": 0.9})
	var solved := PText.make(self, 0, 0.0 if kind == "none" else top + 34, Facts.format_solved(fact, i18n.locale),
		TextStyles.numeral({"font_size": UiTheme.SIZES.title + 6 if kind == "none" else UiTheme.SIZES.title,
			"color": UiTheme.css(UiTheme.ACCENT)}))
	solved.set_origin(0.5)

	var area_top := top + 66
	var area_h := h - 66 - 14
	if kind == "dots":
		_draw_dots(fact, area_top, area_h, i18n)
	elif kind == "numberLine":
		_draw_number_line(fact, area_top, area_h, i18n)
	if parent != null:
		parent.add_child(self)


## `a` rows of `b` dots; the row and column counts as numbers beside the brackets.
func _draw_dots(f: Dictionary, top: float, height: float, i18n: I18n) -> void:
	var rows: int = f.a
	var cols: int = f.b
	var step := minf(16.0, (height - 22) / maxf(1.0, maxi(rows, cols) - 1 + 0.8))
	var r := maxf(2.0, step * 0.3)
	var grid_w := (cols - 1) * step
	var grid_h := (rows - 1) * step
	var ox := -grid_w / 2.0 + 10
	var oy := top + 18 + (height - 18 - grid_h) / 2.0

	var g := PGraphics.new()
	g.fill_style(UiTheme.PRIMARY, 1)
	for row in rows:
		for col in cols:
			g.fill_circle(ox + col * step, oy + row * step, r)
	g.line_style(UiTheme.LINE_WIDTH, UiTheme.TEXT_DIM, 0.9)
	var bt := oy - r - 7
	g.line_between(ox - r, bt, ox + grid_w + r, bt)
	g.line_between(ox - r, bt, ox - r, bt + 4)
	g.line_between(ox + grid_w + r, bt, ox + grid_w + r, bt + 4)
	var bl := ox - r - 8
	g.line_between(bl, oy - r, bl, oy + grid_h + r)
	g.line_between(bl, oy - r, bl + 4, oy - r)
	g.line_between(bl, oy + grid_h + r, bl + 4, oy + grid_h + r)
	add_child(g)

	var style := TextStyles.numeral({"font_size": UiTheme.SIZES.label + 1, "color": UiTheme.css(UiTheme.TEXT)})
	PText.make(self, ox + grid_w / 2.0, bt - 3, I18n.format_number(cols, i18n.locale), style).set_origin(0.5, 1)
	PText.make(self, bl - 6, oy + grid_h / 2.0, I18n.format_number(rows, i18n.locale), style).set_origin(1, 0.5)


## Number line 0..10 or 0..20 with one hop from a to the result.
func _draw_number_line(f: Dictionary, top: float, height: float, i18n: I18n) -> void:
	var a: float = f.a
	var b: float = f.b
	var result: float = f.result
	var max_n := 10 if maxf(a, result) <= 10 else LINE_MAX
	var line_w := CARD_W - 70
	var x0 := -line_w / 2.0
	var unit := line_w / max_n
	var ly := top + height - 34
	var x_of := func(n: float) -> float: return x0 + n * unit

	var g := PGraphics.new()
	add_child(g)
	var labels: Array = []
	g.line_style(UiTheme.LINE_WIDTH, UiTheme.TEXT_DIM, 1)
	g.line_between(x0 - 6, ly, x0 + line_w + 6, ly)
	for n in max_n + 1:
		var major := n % 5 == 0
		g.line_between(x_of.call(n), ly - (6 if major else 3), x_of.call(n), ly + (6 if major else 3))
		if major and n != a and n != result:
			var t := PText.new(I18n.format_number(n, i18n.locale), TextStyles.label())
			t.position = Vector2(x_of.call(n), ly + 9)
			t.set_origin(0.5, 0)
			labels.append(t)

	var sx: float = x_of.call(a)
	var ex: float = x_of.call(result)
	var arc_h := minf(70.0, 22 + absf(ex - sx) * 0.3)
	if b != 0:
		var pts: Array = []
		var n := 32
		for i in n + 1:
			var t := float(i) / n
			pts.append(Vector2(sx + (ex - sx) * t, ly - sin(PI * t) * arc_h))
		g.line_style(2, UiTheme.ACCENT, 1)
		g.stroke_points(pts, false)
		var dir := signf(ex - sx)
		g.fill_style(UiTheme.ACCENT, 1)
		g.fill_triangle(ex, ly - 2, ex - dir * 10, ly - 12, ex - dir * 2, ly - 15)
		var sign := "+" if f.op == "add" else I18n.MINUS
		var hop := PText.new("%s%s" % [sign, Js.num_str(b)], TextStyles.numeral({"font_size": UiTheme.SIZES.body, "color": UiTheme.css(UiTheme.ACCENT)}))
		hop.position = Vector2((sx + ex) / 2.0, ly - arc_h - 4)
		hop.set_origin(0.5, 1)
		labels.append(hop)

	g.line_style(2, UiTheme.TEXT, 1)
	g.stroke_circle(sx, ly, 6)
	g.fill_style(UiTheme.OK, 1)
	g.fill_circle(ex, ly, 7)
	var la := PText.new(I18n.format_number(a, i18n.locale), TextStyles.numeral({"font_size": UiTheme.SIZES.label}))
	la.position = Vector2(sx, ly + 10)
	la.set_origin(0.5, 0)
	labels.append(la)
	if ex != sx:
		var lr := PText.new(I18n.format_number(result, i18n.locale), TextStyles.numeral({"font_size": UiTheme.SIZES.body, "color": UiTheme.css(UiTheme.OK)}))
		lr.position = Vector2(ex, ly + 10)
		lr.set_origin(0.5, 0)
		labels.append(lr)
	for l in labels:
		add_child(l)
