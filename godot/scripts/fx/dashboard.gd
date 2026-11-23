class_name Dashboard
extends Node2D
## Port of src/fx/Dashboard.ts: first-person console along the bottom of the battle view:
## `ui/dash.png` scaled to DASH_SCALE (see BattleLayout), and the HUD drawn as amber CRT readouts
## inside its five screens: wave (left), score (left inner), typed answer (centre), streak (right
## inner) and station hp (right). Without the image the screens are drawn as plain dark panels.
## Dashboard.new(parent, {wave, score, streak, stations, hull}). Everything it draws is a child of
## this node (z_index 0, children at DEPTH.hud - 2 .. + 2), so flicker() dims the node.

const BOTTOM_SHADE_KEY := "tex-battle-bottom-shade"
const SCANLINE_STEP := 3
## Hull pips: one row on the console hood above the centre screen.
const HULL_ROW_Y := 611.0
const HULL_PIP_W := 14.0
const HULL_PIP_H := 5.0
const HULL_PIP_GAP := 5.0

var _wave_text: PText
var _score_text: PText
var _streak_text: PText
var _input_text: PText
var _caret: PGraphics
var _stations: PGraphics
var _input_home: float
var _hull_label: PText
var _hull_pips: PGraphics
var _station_sig := ""
var _hull_sig := ""
var _flicker_tween: Tween = null


## Amber CRT text: mono numerals with a soft glow.
static func _crt(size: int) -> Dictionary:
	return TextStyles.numeral({
		"font_size": size, "color": UiTheme.css(UiTheme.PRIMARY),
		"shadow": {"x": 0, "y": 0, "color": UiTheme.css(UiTheme.PRIMARY), "blur": 6, "fill": true},
	})


## Vertical gradient texture (transparent -> near black) for the darkness under and beside the console.
static func _ensure_bottom_shade() -> void:
	if Assets.has_image(BOTTOM_SHADE_KEY):
		return
	var c := Raster.new(4, 128)
	c.fill_rect(0, 0, 4, 128, Raster.linear(0, 0, 0, 128,
		[[0, "rgba(0,0,0,0)"], [0.55, "rgba(0,0,0,0.55)"], [1, "rgba(0,0,0,0.9)"]]))
	Assets.add_texture(BOTTOM_SHADE_KEY, c.to_texture())


func _init(parent: Node, labels: Dictionary) -> void:
	var depth: int = UiTheme.DEPTH.hud
	_ensure_bottom_shade()
	if Assets.has_image(BOTTOM_SHADE_KEY):
		# Darkness flanking and under the console (begins just below the stations' pips).
		var shade := PImage.make(self, 0, 580, BOTTOM_SHADE_KEY)
		shade.set_origin(0, 0)
		shade.set_display_size(BattleLayout.VIEW_W, BattleLayout.VIEW_H - 580)
		shade.z_index = depth - 2

	var screens := BattleLayout.dash_screens()
	if Assets.has_image(Assets.IMG.ui.dash):
		var dash := PImage.make(self, BattleLayout.DASH_X, BattleLayout.DASH_Y, Assets.IMG.ui.dash)
		dash.set_origin(0, 0)
		dash.scale = Vector2.ONE * BattleLayout.DASH_SCALE
		dash.z_index = depth - 1
	else:
		var g := PGraphics.new()
		g.z_index = depth - 1
		add_child(g)
		g.fill_style(UiTheme.BG_PANEL, 0.95)
		g.fill_rect(BattleLayout.DASH_X, BattleLayout.DASH_Y + 16, BattleLayout.DASH_W, BattleLayout.DASH_H)
		g.line_style(UiTheme.LINE_WIDTH, UiTheme.PRIMARY_DIM, 0.8)
		g.line_between(BattleLayout.DASH_X, BattleLayout.DASH_Y + 16.5, BattleLayout.DASH_X + BattleLayout.DASH_W, BattleLayout.DASH_Y + 16.5)
		for r in screens.values():
			g.fill_style(UiTheme.PLATE, 1)
			g.fill_rect(r.x, r.y, r.w, r.h)
			g.stroke_rect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3)

	_draw_screen_glass(depth)

	_wave_text = _readout(screens.left, labels.wave, UiTheme.SIZES.heading + 2, depth)
	_score_text = _readout(screens.leftInner, labels.score, UiTheme.SIZES.heading, depth)
	_streak_text = _readout(screens.rightInner, labels.streak, UiTheme.SIZES.heading, depth)
	_label(screens.right, labels.stations, depth)
	_stations = PGraphics.new()
	_stations.z_index = depth + 1
	add_child(_stations)

	var c: Dictionary = screens.centre
	_input_home = c.x + c.w / 2.0
	_input_text = PText.make(self, _input_home, c.y + c.h / 2.0, "", _crt(UiTheme.SIZES.input + 2))
	_input_text.set_origin(0.5)
	_input_text.z_index = depth + 1
	# Phaser rectangle 12x3 with origin (0, 0.5).
	_caret = PGraphics.new()
	_caret.fill_style(UiTheme.PRIMARY, 1)
	_caret.fill_rect(0, -1.5, 12, 3)
	_caret.position = Vector2(_input_home, c.y + c.h / 2.0)
	_caret.z_index = depth + 1
	add_child(_caret)

	_hull_label = PText.make(self, 0, HULL_ROW_Y, labels.hull.to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.small - 1, "color": UiTheme.css(UiTheme.PRIMARY_DIM), "letter_spacing": 1}))
	_hull_label.set_origin(1, 0.5)
	_hull_label.z_index = depth + 1
	_hull_pips = PGraphics.new()
	_hull_pips.z_index = depth + 1
	add_child(_hull_pips)
	if parent != null:
		parent.add_child(self)


## Ship hull as a row of small pips (filled = intact), the label to their left.
func set_hull(hull: int, max_hull: int) -> void:
	var sig := "%d/%d" % [hull, max_hull]
	if sig == _hull_sig:
		return
	_hull_sig = sig
	var n := maxi(0, max_hull)
	var row_w := n * HULL_PIP_W + maxi(0, n - 1) * HULL_PIP_GAP
	var label_w := _hull_label.width + 8
	var x0 := _input_home - (row_w + label_w) / 2.0 + label_w
	_hull_label.position.x = x0 - 8
	var low := hull <= 1
	_hull_label.set_color(UiTheme.css(UiTheme.DANGER if low else UiTheme.PRIMARY_DIM))
	var g := _hull_pips
	g.clear()
	for i in n:
		var x := x0 + i * (HULL_PIP_W + HULL_PIP_GAP)
		var y := HULL_ROW_Y - HULL_PIP_H / 2.0
		if i < hull:
			g.fill_style(UiTheme.DANGER if low else UiTheme.PRIMARY, 0.95)
			g.fill_rect(x, y, HULL_PIP_W, HULL_PIP_H)
		else:
			g.line_style(UiTheme.LINE_WIDTH, UiTheme.DANGER, 0.8)
			g.stroke_rect(x + 0.5, y + 0.5, HULL_PIP_W - 1, HULL_PIP_H - 1)


## Hit: the console's lights stutter for a moment (45 ms steps).
func flicker(duration_ms: float = 420.0) -> void:
	if _flicker_tween != null and _flicker_tween.is_valid():
		_flicker_tween.kill()
	var steps := maxi(2, Js.round(duration_ms / 45.0))
	var state := {"left": steps}
	var step := func() -> void:
		state.left -= 1
		var left: int = state.left
		modulate.a = 1.0 if left == 0 else (0.25 + randf() * 0.3 if randf() < 0.5 else 0.9)
		if left == 0:
			_flicker_tween = null
	_flicker_tween = PTween.every(self, 45, step, steps - 1)


func set_wave(wave: int, total: int) -> void:
	_set_text(_wave_text, "%d/%d" % [wave, total])


func set_score(score: int) -> void:
	_set_text(_score_text, str(score))


func set_streak(streak: int) -> void:
	_set_text(_streak_text, str(streak))


## `shown` uses the display minus already. The caret is a block underline after the text.
func set_input(shown: String, caret_on: bool) -> void:
	_set_text(_input_text, shown)
	var c: Dictionary = BattleLayout.dash_screens().centre
	var baseline: float = c.y + c.h / 2.0 + (UiTheme.SIZES.input + 2) / 2.0 - 1
	_caret.position = Vector2(_input_text.position.x - 6 if shown.length() == 0 else _input_text.position.x + _input_text.width / 2.0 + 3, baseline)
	_caret.visible = caret_on


## Station hp as four columns of pips on the right screen. domes = [{hp, max_hp}].
func set_stations(domes: Array) -> void:
	var parts: Array = []
	for d in domes:
		parts.append("%d/%d" % [d.hp, d.max_hp])
	var sig := ",".join(parts)
	if sig == _station_sig:
		return
	_station_sig = sig
	var r: Dictionary = BattleLayout.dash_screens().right
	var g := _stations
	g.clear()
	var col_w := 12.0
	var gap := 6.0
	var pip_h := 4.0
	var pip_gap := 3.0
	var total_w := domes.size() * col_w + (domes.size() - 1) * gap
	var x0: float = r.x + (r.w - total_w) / 2.0
	var bottom: float = r.y + r.h - 9
	for i in domes.size():
		var d: Dictionary = domes[i]
		var x := x0 + i * (col_w + gap)
		for k in d.max_hp:
			var y: float = bottom - (k + 1) * pip_h - k * pip_gap
			if k < d.hp:
				g.fill_style(UiTheme.PRIMARY, 0.95)
				g.fill_rect(x, y, col_w, pip_h)
			else:
				g.line_style(UiTheme.LINE_WIDTH, UiTheme.PRIMARY_DIM, 0.9)
				g.stroke_rect(x + 0.5, y + 0.5, col_w - 1, pip_h - 1)
		if d.hp <= 0:
			# Destroyed: a cross under the column, so it reads without colour.
			g.line_style(UiTheme.LINE_WIDTH, UiTheme.DANGER, 1)
			g.line_between(x + 2, bottom + 2, x + col_w - 2, bottom + 7)
			g.line_between(x + col_w - 2, bottom + 2, x + 2, bottom + 7)


## Wrong answer: the centre readout shakes briefly.
func shake_input() -> void:
	var t := _input_text
	PTween.kill_tweens_of(t)
	t.position.x = _input_home
	var home := _input_home
	PTween.add(t, {"x": _input_home + 5}, 40, "Sine.easeInOut", {"yoyo": true, "repeat": 3,
		"on_complete": func() -> void: t.position.x = home})


func _set_text(t: PText, value: String) -> void:
	if t.text != value:
		t.set_text(value)


func _label(r: Dictionary, text: String, depth: int) -> void:
	var l := PText.make(self, r.x + r.w / 2.0, r.y + 5, text.to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.small - 1, "color": UiTheme.css(UiTheme.PRIMARY_DIM), "letter_spacing": 1}))
	l.set_origin(0.5, 0)
	l.z_index = depth + 1


func _readout(r: Dictionary, label: String, size: int, depth: int) -> PText:
	_label(r, label, depth)
	var t := PText.make(self, r.x + r.w / 2.0, r.y + 14 + (r.h - 14) / 2.0, "", _crt(size))
	t.set_origin(0.5)
	t.z_index = depth + 1
	return t


## Faint phosphor tint and scanlines over every screen.
func _draw_screen_glass(depth: int) -> void:
	var g := PGraphics.new()
	g.z_index = depth
	add_child(g)
	var lines := PGraphics.new()
	lines.z_index = depth + 2
	add_child(lines)
	for r in BattleLayout.dash_screens().values():
		g.fill_style(UiTheme.PRIMARY, 0.05)
		g.fill_rect(r.x, r.y, r.w, r.h)
		lines.line_style(1, UiTheme.BG, 0.35)
		var y: float = r.y + 1
		while y < r.y + r.h:
			lines.line_between(r.x, y + 0.5, r.x + r.w, y + 0.5)
			y += SCANLINE_STEP
