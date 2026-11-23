class_name UiToggle
extends Node2D
## Port of src/ui/Toggle.ts: on/off switch with a state word next to it (never colour alone).
## (x, y) is the left edge, vertically centred. UiToggle.new(parent, x, y, value, {on, off}, on_change).

const TRACK_W := 64
const TRACK_H := 30

var value: bool
var track: PGraphics
var state_text: PText
var labels: Dictionary


func _init(parent: Node, x: float, y: float, p_value: bool, p_labels: Dictionary, on_change: Callable) -> void:
	position = Vector2(x, y)
	value = p_value
	labels = p_labels
	track = PGraphics.new()
	add_child(track)
	state_text = PText.new("", TextStyles.label({"color": UiTheme.css(UiTheme.TEXT)}))
	state_text.position = Vector2(TRACK_W + 14, 0)
	state_text.set_origin(0, 0.5)
	add_child(state_text)
	var on_w := state_text.set_text(labels.on).width
	var text_w := maxf(on_w, state_text.set_text(labels.off).width)
	var hit_w := TRACK_W + 14 + text_w + 8
	HitZone.add(self, hit_w / 2 - 4, 0, hit_w, TRACK_H + 16, func():
		value = not value
		_redraw()
		on_change.call(value))
	_redraw()
	if parent != null:
		parent.add_child(self)


func _redraw() -> void:
	var g := track
	var on := value
	var c := UiTheme.PRIMARY if on else UiTheme.TEXT_DIM
	g.clear()
	g.fill_style(UiTheme.BG_PANEL_HI, 1)
	g.fill_rounded_rect(0, -TRACK_H / 2.0, TRACK_W, TRACK_H, TRACK_H / 2.0)
	g.fill_style(c, 0.35 if on else 0.12)
	g.fill_rounded_rect(0, -TRACK_H / 2.0, TRACK_W, TRACK_H, TRACK_H / 2.0)
	g.line_style(UiTheme.LINE_WIDTH, c, 0.95)
	g.stroke_rounded_rect(0, -TRACK_H / 2.0, TRACK_W, TRACK_H, TRACK_H / 2.0)
	g.fill_style(UiTheme.PRIMARY if on else UiTheme.TEXT_DIM, 1)
	g.fill_circle(TRACK_W - TRACK_H / 2.0 if on else TRACK_H / 2.0, 0, TRACK_H / 2.0 - 5)
	state_text.set_text(labels.on if on else labels.off)
	state_text.set_color(UiTheme.css(UiTheme.TEXT) if on else UiTheme.css(UiTheme.TEXT_DIM))
