class_name UiButton
extends Node2D
## Port of src/ui/Button.ts (Godot already has a Button class, hence UiButton).
## Small flat button (Theme v2): faint dark backing, 1 px frame, caps label with letter spacing.
## (x, y) is the centre. The click fires on release over the button after a press that started on it.
##   UiButton.new(parent, x, y, label, on_click, {width, height, variant, font_size})
## variant: "primary" (amber, default) | "accent" (teal) | "danger" | "ghost". Adds itself to `parent`.

## Optional sound played on every click (boot sets it to Sfx.click).
static var click_sound: Callable = Callable()

const VARIANT_COLOR := {
	"primary": UiTheme.PRIMARY,
	"accent": UiTheme.ACCENT,
	"danger": UiTheme.DANGER,
	"ghost": UiTheme.TEXT_DIM,
}

var bg: PGraphics
var label_text: PText
var hit: HitArea
var btn_w: float
var btn_h: float
var color: int
var enabled := true
var _pressed := false
var _hovered := false
var _on_click: Callable


func _init(parent: Node, x: float, y: float, label: String, on_click: Callable, opts: Dictionary = {}) -> void:
	position = Vector2(x, y)
	btn_w = opts.get("width", 180)
	btn_h = opts.get("height", 40)
	color = VARIANT_COLOR[opts.get("variant", "primary")]
	_on_click = on_click
	bg = PGraphics.new()
	add_child(bg)
	label_text = PText.new(label.to_upper(), {
		"font_family": UiTheme.FONT_UI,
		"font_size": opts.get("font_size", UiTheme.SIZES.label + 1),
		"font_style": 600,
		"color": UiTheme.css(UiTheme.TEXT),
		"align": "center",
		"letter_spacing": UiTheme.LETTER_SPACING.caps,
	})
	label_text.set_origin(0.5)
	add_child(label_text)
	hit = HitArea.new(btn_w, btn_h)
	add_child(hit)
	hit.over.connect(func():
		_hovered = true
		_redraw())
	hit.out.connect(func():
		_hovered = false
		_pressed = false
		_redraw())
	hit.down.connect(func():
		if not enabled:
			return
		_pressed = true
		_redraw())
	hit.up.connect(func(inside: bool, was_touch: bool):
		var fire := enabled and _pressed and inside
		_pressed = false
		# Touch has no hover: drop the hover look after release.
		if was_touch:
			_hovered = false
		_redraw()
		if fire:
			if click_sound.is_valid():
				click_sound.call()
			_on_click.call())
	_redraw()
	if parent != null:
		parent.add_child(self)


func set_enabled(on: bool) -> UiButton:
	enabled = on
	if not on:
		_pressed = false
	hit.set_hand_cursor(on)
	_redraw()
	return self


func is_enabled() -> bool:
	return enabled


func set_label(label: String) -> UiButton:
	label_text.set_text(label.to_upper())
	return self


func set_on_click(on_click: Callable) -> UiButton:
	_on_click = on_click
	return self


## Same as a click (keyboard shortcuts): runs on_click when enabled.
func click() -> void:
	if enabled:
		if click_sound.is_valid():
			click_sound.call()
		_on_click.call()


func _visual_state() -> String:
	if not enabled:
		return "disabled"
	if _pressed:
		return "pressed"
	if _hovered:
		return "hover"
	return "idle"


func _redraw() -> void:
	var st := _visual_state()
	var g := bg
	var c := UiTheme.DISABLED if st == "disabled" else color
	var fill_alpha := 0.3 if st == "pressed" else (0.16 if st == "hover" else 0.0)
	var x := -btn_w / 2
	var y := -btn_h / 2
	g.clear()
	g.fill_style(UiTheme.BG, 0.55)
	g.fill_rect(x, y, btn_w, btn_h)
	if fill_alpha > 0:
		g.fill_style(c, fill_alpha)
		g.fill_rect(x, y, btn_w, btn_h)
	g.line_style(UiTheme.LINE_WIDTH, c, 0.5 if st == "disabled" else (0.7 if st == "idle" else 1.0))
	g.stroke_rect(x + 0.5, y + 0.5, btn_w - 1, btn_h - 1)
	# Short solid ticks on the left and right edges give the flat frame a little weight.
	g.fill_style(c, 0.4 if st == "disabled" else 1.0)
	g.fill_rect(x, y + btn_h * 0.3, 2, btn_h * 0.4)
	g.fill_rect(x + btn_w - 2, y + btn_h * 0.3, 2, btn_h * 0.4)
	var text_color := UiTheme.css(UiTheme.TEXT_DIM) if st == "disabled" else (UiTheme.css(UiTheme.TEXT) if st == "idle" else UiTheme.css(c))
	label_text.set_color(text_color)
	scale = Vector2.ONE * (0.98 if st == "pressed" else 1.0)
