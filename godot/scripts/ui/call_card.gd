class_name CallCard
extends Node2D
## Port of src/ui/CallCard.ts: the incoming call: sender portrait and name, the one message line
## typed out in the mono font, the planet (picture, name, mastery) with the call kind as a glyph,
## and one GO button. Anchored at a screen corner (mapLayout CARD_ANCHORS), sliding in from its side.
## The scene wires Enter / Space to go() and Esc to close(). The voice clip plays while it is open.
## CallCard.new(parent, on_go). open(content, anchor) with content (TS CallCardContent, snake_case):
##   {kind, portrait (texture key), sender, message, planet_texture, planet_name, mastery (0..1),
##    mastery_text, mastery_color (int), go_label, voice_urls (Array), volume}
## anchor = Rect {x, y, w, h} (Dictionary) or Rect2.

## Same values as src/fx/mapLayout.ts CARD_W / CARD_H / VIEW_W.
const CARD_W := 360
const CARD_H := 150
const VIEW_W := 1280

const PAD := 12
const PORTRAIT := 56
const MSG_X := PAD + PORTRAIT + 12
const MSG_W := CARD_W - MSG_X - PAD
const ROW_Y := 116
const THUMB := 32
const GO_W := 112
const GO_H := 38
const MS_PER_CHAR := 22
const SLIDE := 36

var frame: PGraphics
var portrait: PImage
var sender_text: PText
var msg_text: PText
var thumb: PImage
var thumb_ring: PGraphics
var planet_text: PText
var mastery_text: PText
var go_button: UiButton
var voice: VoiceLine
var _typing: Tween = null
var _typed := 0
var _full_message := ""
var _opened := false
var _anchor = null
var _on_go: Callable


func _init(parent: Node, on_go: Callable) -> void:
	_on_go = on_go
	z_index = UiTheme.DEPTH.overlay
	visible = false
	modulate.a = 0
	# Swallows clicks so the map underneath does not react to taps on the card.
	var blocker := HitArea.new(CARD_W, CARD_H, false, false)
	add_child(blocker)
	frame = PGraphics.new()
	add_child(frame)
	portrait = PImage.make(self, PAD + PORTRAIT / 2.0, PAD + PORTRAIT / 2.0, Tex.GLOW)
	portrait.set_display_size(PORTRAIT, PORTRAIT)
	sender_text = PText.make(self, MSG_X, PAD - 1, "", TextStyles.caps({
		"font_size": UiTheme.SIZES.small, "letter_spacing": UiTheme.LETTER_SPACING.caps,
	}))
	msg_text = PText.make(self, MSG_X, PAD + 17, "", TextStyles.numeral({
		"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.TEXT), "line_spacing": 3,
	}))
	thumb = PImage.make(self, PAD + THUMB / 2.0 + 2, ROW_Y, Tex.PLANET_SMALL)
	thumb.set_display_size(THUMB, THUMB)
	thumb_ring = PGraphics.new()
	add_child(thumb_ring)
	planet_text = PText.make(self, PAD + THUMB + 16, ROW_Y - 8, "", TextStyles.caps({
		"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.TEXT), "letter_spacing": UiTheme.LETTER_SPACING.caps,
	}))
	planet_text.set_origin(0, 0.5)
	mastery_text = PText.make(self, PAD + THUMB + 16, ROW_Y + 9, "", TextStyles.numeral({"font_size": UiTheme.SIZES.small + 1}))
	mastery_text.set_origin(0, 0.5)
	go_button = UiButton.new(self, CARD_W - PAD - GO_W / 2.0, ROW_Y, "", func(): go(),
		{"width": GO_W, "height": GO_H, "font_size": UiTheme.SIZES.body, "variant": "primary"})
	voice = VoiceLine.new()
	add_child(voice)
	if parent != null:
		parent.add_child(self)


func is_open() -> bool:
	return _opened


## The anchor rectangle the card sits in (null while closed).
func rect() -> Variant:
	return _anchor if _opened else null


func set_on_go(on_go: Callable) -> CallCard:
	_on_go = on_go
	return self


static func _r(a: Variant) -> Rect2:
	return a if a is Rect2 else Rect2(a.x, a.y, a.w, a.h)


## Shows the card at `anchor` with the given content (replacing what it showed).
func open(content: Dictionary, anchor: Variant) -> void:
	silence()
	PTween.kill_tweens_of(self)
	_anchor = anchor
	_opened = true
	var a := _r(anchor)
	var from_right := a.position.x + a.size.x / 2 > VIEW_W / 2.0
	position = Vector2(a.position.x + (SLIDE if from_right else -SLIDE), a.position.y)
	visible = true
	modulate.a = 0
	PTween.add(self, {"x": a.position.x, "alpha": 1}, 260, "Cubic.easeOut")

	_draw_frame(content.kind)
	if Assets.has_image(content.portrait):
		portrait.set_texture_key(content.portrait).set_display_size(PORTRAIT, PORTRAIT).clear_tint()
	else:
		portrait.set_texture_key(Tex.GLOW).set_display_size(PORTRAIT, PORTRAIT).set_tint(UiTheme.PRIMARY_DIM)
	portrait.visible = true
	sender_text.set_text(str(content.sender).to_upper())
	# Wrap once on the full line, then type the wrapped text so words never jump between lines.
	msg_text.set_word_wrap_width(MSG_W)
	_full_message = "\n".join(msg_text.get_wrapped_text(content.message))
	msg_text.set_word_wrap_width(0)
	msg_text.set_text("")
	_typed = 0
	var total := _full_message.length()
	var tick := func() -> void:
		_typed = mini(total, _typed + 1)
		msg_text.set_text(_full_message.substr(0, _typed))
	_typing = PTween.every(self, MS_PER_CHAR, tick, maxi(0, total - 1))

	if Assets.has_image(content.planet_texture):
		thumb.set_texture_key(content.planet_texture).set_display_size(THUMB, THUMB).clear_tint()
	else:
		thumb.set_texture_key(Tex.PLANET_SMALL).set_display_size(THUMB, THUMB).set_tint(UiTheme.TEXT_DIM)
	thumb_ring.clear()
	Glyphs.draw_ring(thumb_ring, thumb.position.x, thumb.position.y, THUMB / 2.0 + 3, content.mastery, content.mastery_color, 1.5)
	planet_text.set_text(str(content.planet_name).to_upper())
	mastery_text.set_text(content.mastery_text).set_color(UiTheme.css(UiTheme.TEXT_DIM))
	go_button.set_label(content.go_label)
	voice.play(content.get("voice_urls", []), content.get("volume", 0))


## Slides the open card to another anchor (when its planet drifts under it).
func slide_to(anchor: Variant) -> void:
	if not _opened or anchor == _anchor:
		return
	_anchor = anchor
	var a := _r(anchor)
	PTween.kill_tweens_of(self)
	PTween.add(self, {"x": a.position.x, "y": a.position.y, "alpha": 1}, 320, "Cubic.easeInOut")


## Finishes the typing at once (first key press while typing). Returns false if already complete.
func complete_typing() -> bool:
	if _typing == null or _typed >= _full_message.length():
		return false
	_typing.kill()
	_typing = null
	_typed = _full_message.length()
	msg_text.set_text(_full_message)
	return true


func go() -> void:
	if not _opened:
		return
	_on_go.call()


func close() -> void:
	if not _opened:
		return
	_opened = false
	_anchor = null
	silence()
	PTween.kill_tweens_of(self)
	PTween.add(self, {"alpha": 0}, 180, "Quad.easeIn", {"on_complete": _hide})


func _hide() -> void:
	visible = false


## Stops the typing and the voice clip at once.
func silence() -> void:
	voice.stop()
	if _typing != null:
		_typing.kill()
	_typing = null


func _exit_tree() -> void:
	silence()


func _draw_frame(kind: String) -> void:
	var g := frame
	g.clear()
	g.fill_style(UiTheme.BG, 0.84)
	g.fill_rect(0, 0, CARD_W, CARD_H)
	UiPanel.draw_brackets(g, 0, 0, CARD_W, CARD_H, UiTheme.PRIMARY, 0.85, 12)
	g.line_style(1, UiTheme.PRIMARY, 0.18)
	g.line_between(PAD, ROW_Y - 25.5, CARD_W - PAD, ROW_Y - 25.5)
	# Portrait frame: thin amber line.
	g.line_style(1, UiTheme.PRIMARY, 0.8)
	g.stroke_rect(PAD - 1.5, PAD - 1.5, PORTRAIT + 3, PORTRAIT + 3)
	MapGlyphs.draw_kind_glyph(g, kind, CARD_W - PAD - 7, PAD + 7, 15, MapGlyphs.kind_color(kind), 1)
