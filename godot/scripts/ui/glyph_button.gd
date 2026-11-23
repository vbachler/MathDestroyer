class_name GlyphButton
extends Node2D
## Port of src/ui/GlyphButton.ts: tiny square button that shows only a glyph (no text).
## (x, y) is the centre. `draw` is a GlyphDraw Callable(g: PGraphics, x, y, size, color, alpha),
## e.g. MapGlyphs.draw_galaxy_glyph. GlyphButton.new(parent, x, y, size, draw, on_click).

var g: PGraphics
var hit: HitArea
var size: float
var _draw_glyph: Callable
var _hovered := false
var _pressed := false
var _on_click: Callable


func _init(parent: Node, x: float, y: float, p_size: float, draw: Callable, on_click: Callable) -> void:
	position = Vector2(x, y)
	size = p_size
	_draw_glyph = draw
	_on_click = on_click
	g = PGraphics.new()
	add_child(g)
	hit = HitArea.new(size, size)
	add_child(hit)
	hit.over.connect(func():
		_hovered = true
		_redraw())
	hit.out.connect(func():
		_hovered = false
		_pressed = false
		_redraw())
	hit.down.connect(func():
		_pressed = true
		_redraw())
	hit.up.connect(func(inside: bool, was_touch: bool):
		var fire := _pressed and inside
		_pressed = false
		if was_touch:
			_hovered = false
		_redraw()
		if fire:
			if UiButton.click_sound.is_valid():
				UiButton.click_sound.call()
			_on_click.call())
	_redraw()
	if parent != null:
		parent.add_child(self)


## Replaces the glyph (e.g. galaxy <-> system toggle).
func set_glyph(draw: Callable) -> GlyphButton:
	_draw_glyph = draw
	_redraw()
	return self


func _redraw() -> void:
	var s := size
	var active := _hovered or _pressed
	g.clear()
	g.fill_style(UiTheme.BG, 0.75 if _pressed else 0.45)
	g.fill_rect(-s / 2, -s / 2, s, s)
	UiPanel.draw_brackets(g, -s / 2, -s / 2, s, s, UiTheme.PRIMARY, 0.9 if active else 0.35, 6)
	_draw_glyph.call(g, 0.0, 0.0, s * 0.52, UiTheme.PRIMARY if active else UiTheme.TEXT, 1.0 if active else 0.7)
