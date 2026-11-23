class_name LevelControl
extends Node2D
## Port of src/ui/LevelControl.ts: stepped 0..1 level in tenths: a "−" button, ten clickable
## segments, a "+" button and the value as text. (x, y) is the left edge, vertically centred.
## Taps make no sound of their own. labels = {decrease, increase, format: Callable(value) -> String}.
## LevelControl.new(parent, x, y, value, labels, on_change).

const STEPS := 10
const BTN := 40
const SEG_W := 22
const SEG_GAP := 4
const SEG_H := 22

var step: int
var bars: PGraphics
var value_text: PText
var labels: Dictionary
var _on_change: Callable


func _init(parent: Node, x: float, y: float, value: float, p_labels: Dictionary, on_change: Callable) -> void:
	position = Vector2(x, y)
	step = Js.round(minf(1.0, maxf(0.0, value)) * STEPS)
	labels = p_labels
	_on_change = on_change
	bars = PGraphics.new()
	add_child(bars)
	var seg_start := BTN + 12
	var plus_x := seg_start + STEPS * (SEG_W + SEG_GAP) + 8
	_add_step_button(0, labels.decrease, func(): _set_step(step - 1))
	_add_step_button(plus_x, labels.increase, func(): _set_step(step + 1))
	for i in STEPS:
		var sx := seg_start + i * (SEG_W + SEG_GAP)
		var target := i + 1
		HitZone.add(self, sx + SEG_W / 2.0, 0, SEG_W + SEG_GAP, BTN, func(): _set_step(target), {"sound": false})
	value_text = PText.new("", TextStyles.numeral({"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.TEXT)}))
	value_text.position = Vector2(plus_x + BTN + 16, 0)
	value_text.set_origin(0, 0.5)
	add_child(value_text)
	_redraw()
	if parent != null:
		parent.add_child(self)


func _add_step_button(left: float, label: String, on_tap: Callable) -> void:
	var g := PGraphics.new()
	g.fill_style(UiTheme.BG_PANEL_HI, 1)
	g.fill_rounded_rect(left, -BTN / 2.0, BTN, BTN, UiTheme.RADIUS)
	g.line_style(UiTheme.LINE_WIDTH, UiTheme.PRIMARY, 0.9)
	g.stroke_rounded_rect(left, -BTN / 2.0, BTN, BTN, UiTheme.RADIUS)
	add_child(g)
	var t := PText.new(label, TextStyles.numeral({"font_size": UiTheme.SIZES.body, "color": UiTheme.css(UiTheme.PRIMARY)}))
	t.position = Vector2(left + BTN / 2.0, 0)
	t.set_origin(0.5)
	add_child(t)
	HitZone.add(self, left + BTN / 2.0, 0, BTN, BTN, on_tap, {"sound": false})


func _set_step(s: int) -> void:
	step = mini(STEPS, maxi(0, s))
	_redraw()
	_on_change.call(float(step) / STEPS)


func _redraw() -> void:
	var g := bars
	g.clear()
	var seg_start := BTN + 12
	for i in STEPS:
		var sx := seg_start + i * (SEG_W + SEG_GAP)
		var lit := i < step
		g.fill_style(UiTheme.PRIMARY if lit else UiTheme.BG_PANEL_HI, 0.9 if lit else 1.0)
		g.fill_rect(sx, -SEG_H / 2.0, SEG_W, SEG_H)
		g.line_style(1, UiTheme.PRIMARY_DIM, 0.9)
		g.stroke_rect(sx, -SEG_H / 2.0, SEG_W, SEG_H)
	value_text.set_text(labels.format.call(float(step) / STEPS))
