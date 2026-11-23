class_name UiPanel
extends Node2D
## Port of src/ui/Panel.ts (Godot already has Panel, hence UiPanel).
## Almost invisible HUD panel: faint dark backing, thin corner brackets, optional small caps title.
## (x, y) is the TOP-LEFT corner; add children in panel-local coordinates (content_top() is below
## the title). UiPanel.new(parent, x, y, w, h, {title, border_color, fill_alpha}). Adds itself to `parent`.

const TITLE_HEIGHT := 24

var frame: PGraphics
var title_text: PText
var panel_width: float
var panel_height: float
var border_color: int
var fill_alpha: float


func _init(parent: Node, x: float, y: float, width: float, height: float, opts: Dictionary = {}) -> void:
	position = Vector2(x, y)
	panel_width = width
	panel_height = height
	border_color = opts.get("border_color", UiTheme.PRIMARY)
	fill_alpha = opts.get("fill_alpha", 0.35)
	frame = PGraphics.new()
	add_child(frame)
	title_text = PText.new("", {
		"font_family": UiTheme.FONT_UI,
		"font_size": UiTheme.SIZES.small + 1,
		"font_style": 600,
		"color": UiTheme.css(UiTheme.PRIMARY),
		"letter_spacing": UiTheme.LETTER_SPACING.caps,
	})
	title_text.position = Vector2(UiTheme.SPACING.m, TITLE_HEIGHT / 2.0 + 1)
	title_text.set_origin(0, 0.5)
	add_child(title_text)
	set_title(opts.get("title", ""))
	if parent != null:
		parent.add_child(self)


## Local y where content should start (below the title bar if there is a title).
func content_top() -> float:
	return TITLE_HEIGHT + UiTheme.SPACING.s if title_text.text != "" else UiTheme.SPACING.m


func set_title(title: String) -> UiPanel:
	title_text.set_text(title.to_upper())
	_redraw()
	return self


func resize(width: float, height: float) -> UiPanel:
	panel_width = width
	panel_height = height
	_redraw()
	return self


func _redraw() -> void:
	var g := frame
	var w := panel_width
	var h := panel_height
	g.clear()
	g.fill_style(UiTheme.BG_PANEL, fill_alpha)
	g.fill_rect(0, 0, w, h)
	if title_text.text != "":
		g.line_style(UiTheme.LINE_WIDTH, border_color, 0.25)
		g.line_between(UiTheme.SPACING.s, TITLE_HEIGHT + 0.5, w - UiTheme.SPACING.s, TITLE_HEIGHT + 0.5)
	draw_brackets(g, 0, 0, w, h, border_color, 0.85)


## Thin corner brackets around the rectangle (x, y, w, h), 1 px lines. Shared with ImageCard.
static func draw_brackets(g: PGraphics, x: float, y: float, w: float, h: float, color: int,
		alpha: float = 0.85, size: float = UiTheme.BRACKET) -> void:
	var c := minf(size, minf(w / 3.0, h / 3.0))
	var l := x + 0.5
	var t := y + 0.5
	var r := x + w - 0.5
	var b := y + h - 0.5
	g.line_style(UiTheme.LINE_WIDTH, color, alpha)
	g.begin_path()
	g.move_to(l, t + c)
	g.line_to(l, t)
	g.line_to(l + c, t)
	g.move_to(r - c, t)
	g.line_to(r, t)
	g.line_to(r, t + c)
	g.move_to(r, b - c)
	g.line_to(r, b)
	g.line_to(r - c, b)
	g.move_to(l + c, b)
	g.line_to(l, b)
	g.line_to(l, b - c)
	g.stroke_path()
