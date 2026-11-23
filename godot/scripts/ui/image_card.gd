class_name ImageCard
extends Node2D
## Port of src/ui/ImageCard.ts: picture card for upgrades and station modules: image, short caps
## name, tier pips and an optional number (price). (x, y) is the CENTRE. Hover / pressed / disabled
## states; the click fires on release over the card after a press that started on it.
## play_installed() plays the ~500 ms "installed" animation.
## ImageCard.new(parent, x, y, opts) with opts (TS ImageCardOptions in snake_case):
##   texture (key), name, width = 200, height = 268 (+18 with subtitle, +22 with price), tier = 0,
##   max_tier = 3, highlight_next = false, subtitle, price (null hides), hotkey, on_click (Callable)

const PAD := 10
const PIP_W := 18
const PIP_H := 4
const PIP_GAP := 5

var card_width: float
var card_height: float
var frame: PGraphics
var picture: PImage = null
var placeholder: PGraphics = null
var flash: PGraphics
var name_text: PText
var subtitle_text: PText = null
var price_text: PText = null
var pips: PGraphics
var hit: HitArea
var pic_size: float
var pic_top: float
var pips_y: float

var tier: int
var max_tier: int
var highlight_next: bool
var enabled := true
var _hovered := false
var _pressed := false
var _busy := false
var _on_click: Callable


func _init(parent: Node, x: float, y: float, opts: Dictionary) -> void:
	position = Vector2(x, y)
	var w: float = opts.get("width", 200)
	var has_price: bool = opts.get("price") != null
	var subtitle: String = opts.get("subtitle", "")
	var extra := (18 if subtitle != "" else 0) + (22 if has_price else 0)
	var h: float = opts.get("height", 268 + extra)
	card_width = w
	card_height = h
	tier = opts.get("tier", 0)
	max_tier = opts.get("max_tier", 3)
	highlight_next = opts.get("highlight_next", false)
	_on_click = opts.get("on_click", Callable())

	var left := -w / 2
	var top := -h / 2
	pic_size = w - PAD * 2
	pic_top = top + PAD

	frame = PGraphics.new()
	add_child(frame)
	var tex_key: String = opts.get("texture", "")
	if Assets.has_image(tex_key):
		picture = PImage.make(self, 0, pic_top + pic_size / 2, tex_key)
		picture.set_display_size(pic_size, pic_size)
	else:
		placeholder = PGraphics.new()
		placeholder.fill_style(UiTheme.BG_PANEL_HI, 0.8)
		placeholder.fill_rect(left + PAD, pic_top, pic_size, pic_size)
		placeholder.line_style(UiTheme.LINE_WIDTH, UiTheme.ACCENT, 0.5)
		placeholder.stroke_circle(0, pic_top + pic_size / 2, pic_size * 0.22)
		add_child(placeholder)
	# Phaser rectangle with BlendModes.ADD.
	flash = PGraphics.new()
	flash.fill_style(UiTheme.PRIMARY, 1)
	flash.fill_rect(-pic_size / 2, pic_top, pic_size, pic_size)
	var add_mat := CanvasItemMaterial.new()
	add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	flash.material = add_mat
	flash.modulate.a = 0
	add_child(flash)

	var hotkey: String = opts.get("hotkey", "")
	if hotkey != "":
		var hk := PText.make(self, left + PAD + 6, pic_top + 4, hotkey, TextStyles.numeral({
			"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.PRIMARY), "background_color": "#000000aa",
			"padding": {"x": 4, "y": 1},
		}))
		hk.set_origin(0, 0)

	var cursor := pic_top + pic_size + 10
	name_text = PText.make(self, 0, cursor, str(opts.get("name", "")).to_upper(), TextStyles.caps({
		"font_size": UiTheme.SIZES.label + 2, "color": UiTheme.css(UiTheme.TEXT), "align": "center", "word_wrap_width": w - PAD * 2,
	}))
	name_text.set_origin(0.5, 0)
	cursor += 22

	if subtitle != "":
		subtitle_text = PText.make(self, 0, cursor, subtitle, TextStyles.label({
			"font_size": UiTheme.SIZES.small + 1, "align": "center", "word_wrap_width": w - PAD * 2,
		}))
		subtitle_text.set_origin(0.5, 0)
		cursor += 18

	pips_y = cursor + 6
	pips = PGraphics.new()
	add_child(pips)
	cursor += 16 if max_tier > 0 else 0

	if has_price:
		price_text = PText.make(self, 0, cursor, Js.num_str(opts.price), TextStyles.numeral({
			"font_size": UiTheme.SIZES.heading, "color": UiTheme.css(UiTheme.PRIMARY),
		}))
		price_text.set_origin(0.5, 0)

	hit = HitArea.new(w, h)
	add_child(hit)
	hit.over.connect(func():
		_hovered = true
		_redraw())
	hit.out.connect(func():
		_hovered = false
		_pressed = false
		_redraw())
	hit.down.connect(func():
		if not enabled or _busy:
			return
		_pressed = true
		_redraw())
	hit.up.connect(func(inside: bool, was_touch: bool):
		var fire := enabled and _pressed and not _busy and inside
		_pressed = false
		if was_touch:
			_hovered = false
		_redraw()
		if fire:
			click())
	_redraw()
	if parent != null:
		parent.add_child(self)


## Same as a tap: runs on_click when enabled (use it for keyboard shortcuts).
func click() -> void:
	if not enabled or _busy or not _on_click.is_valid():
		return
	if UiButton.click_sound.is_valid():
		UiButton.click_sound.call()
	_on_click.call()


func set_on_click(on_click: Callable) -> ImageCard:
	_on_click = on_click
	return self


func set_enabled(on: bool) -> ImageCard:
	enabled = on
	if not on:
		_pressed = false
	hit.set_hand_cursor(on)
	_redraw()
	return self


func is_enabled() -> bool:
	return enabled


func set_tier(t: int, p_highlight_next: Variant = null) -> ImageCard:
	tier = maxi(0, mini(max_tier, t))
	if p_highlight_next != null:
		highlight_next = p_highlight_next
	_redraw()
	return self


## Changes the number; null hides it (only for cards created with a price).
func set_price(price: Variant) -> ImageCard:
	if price_text != null:
		price_text.set_text("" if price == null else Js.num_str(price))
		price_text.visible = price != null
	return self


## "Installed" animation, about 500 ms: the next pip fills, the picture flashes amber, the card pops
## and its brackets glow. Input is ignored while it plays; `on_complete` runs at the end.
func play_installed(on_complete: Callable = Callable()) -> void:
	_busy = true
	_pressed = false
	if tier < max_tier:
		tier += 1
	highlight_next = false
	scale = Vector2.ONE
	_redraw(true)
	var glow := PImage.make(null, 0, pic_top + pic_size / 2, Tex.GLOW)
	glow.set_tint(UiTheme.PRIMARY).set_blend_add().set_alpha(0.8)
	glow.scale = Vector2.ONE * ((pic_size * 1.2) / 128.0)
	add_child(glow)
	move_child(glow, 1)
	flash.modulate.a = 0.55
	PTween.add(flash, {"alpha": 0}, 420, "Quad.easeOut")
	PTween.add(glow, {"alpha": 0, "scale": glow.scale.x * 1.35}, 500, "Cubic.easeOut", {"on_complete": glow.queue_free})
	PTween.add(self, {"scale": 1.06}, 120, "Quad.easeOut", {"yoyo": true})
	PTween.delayed_call(self, 500, func():
		_busy = false
		_redraw()
		if on_complete.is_valid():
			on_complete.call())


func _visual_state() -> String:
	if not enabled:
		return "disabled"
	if _pressed:
		return "pressed"
	if _hovered:
		return "hover"
	return "idle"


func _redraw(installed: bool = false) -> void:
	var st := _visual_state()
	var w := card_width
	var h := card_height
	var g := frame
	g.clear()
	g.fill_style(UiTheme.BG, 0.75 if (st == "hover" or st == "pressed") else 0.55)
	g.fill_rect(-w / 2, -h / 2, w, h)
	var color := UiTheme.DISABLED if st == "disabled" else UiTheme.PRIMARY
	if st == "hover" or st == "pressed" or installed:
		g.line_style(UiTheme.LINE_WIDTH, color, 0.35)
		g.stroke_rect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1)
	UiPanel.draw_brackets(g, -w / 2, -h / 2, w, h, color, 0.7 if st == "idle" else 1.0, 14)

	if picture != null:
		if st == "disabled":
			picture.set_tint(0x555555).set_alpha(0.6)
		else:
			picture.clear_tint().set_alpha(0.88 if st == "idle" else 1.0)
	if placeholder != null:
		placeholder.modulate.a = 0.5 if st == "disabled" else 1.0
	name_text.set_color(UiTheme.css(UiTheme.TEXT_DIM) if st == "disabled" else (UiTheme.css(UiTheme.TEXT) if st == "idle" else UiTheme.css(UiTheme.PRIMARY)))
	if subtitle_text != null:
		subtitle_text.set_alpha(0.6 if st == "disabled" else 1.0)
	if price_text != null:
		price_text.set_color(UiTheme.css(UiTheme.TEXT_DIM) if st == "disabled" else UiTheme.css(UiTheme.PRIMARY))
	if not _busy:
		scale = Vector2.ONE * (0.97 if st == "pressed" else 1.0)
	_draw_pips(st == "disabled")


## Filled = owned tiers; outlined = not owned (shape, not only colour); teal outline = next.
func _draw_pips(disabled: bool) -> void:
	var g := pips
	g.clear()
	if max_tier <= 0:
		return
	var total := max_tier * PIP_W + (max_tier - 1) * PIP_GAP
	var x0 := -total / 2.0
	for k in max_tier:
		var px := x0 + k * (PIP_W + PIP_GAP)
		if k < tier:
			g.fill_style(UiTheme.TEXT_DIM if disabled else UiTheme.PRIMARY, 1)
			g.fill_rect(px, pips_y, PIP_W, PIP_H)
		elif k == tier and highlight_next and not disabled:
			g.fill_style(UiTheme.ACCENT, 0.35)
			g.fill_rect(px, pips_y, PIP_W, PIP_H)
			g.line_style(UiTheme.LINE_WIDTH, UiTheme.ACCENT, 1)
			g.stroke_rect(px + 0.5, pips_y + 0.5, PIP_W - 1, PIP_H - 1)
		else:
			g.line_style(UiTheme.LINE_WIDTH, UiTheme.TEXT_DIM, 0.8)
			g.stroke_rect(px + 0.5, pips_y + 0.5, PIP_W - 1, PIP_H - 1)
