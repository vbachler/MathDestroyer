extends GameScene
## Port of src/scenes/StationScene.ts: station shop: three module cards over the hangar, credits
## top-left, the engineer in a corner.

## Card width never below this; it grows only if a name or line would otherwise wrap.
const CARD_MIN_W := 176.0
## ImageCard inner padding on each side (picture inset).
const CARD_PAD := 10.0
const CARD_GAP := 28.0
const CARD_BOTTOM := UiTheme.GAME_HEIGHT - 56.0
const PORTRAIT := 56.0

var _cards: Array = []   # {def, card}
var _credits_text: PText


## Card height for a picture square of (w - 20) plus name, line, pips and price.
static func card_height(w: float) -> float:
	return w + 96


func create(_data: Dictionary) -> void:
	Backdrop.add_backdrop(self, Assets.IMG.bg.station)
	Backdrop.add_shade(self, 0.12, {"from": UiTheme.GAME_HEIGHT * 0.42, "alpha": 0.7})

	_create_credits()
	_create_engineer()
	_create_cards()

	var back := UiButton.new(self, UiTheme.SPACING.l + 55, UiTheme.GAME_HEIGHT - UiTheme.SPACING.l - 15, App.t("common.back"),
		func(): App.goto("star_map"),
		{"width": 110, "height": 30, "variant": "ghost", "font_size": UiTheme.SIZES.small + 1})
	back.z_index = UiTheme.DEPTH.hud


## Credits as a number with a small glyph, top-left.
func _create_credits() -> void:
	var y := UiTheme.SPACING.l + 14.0
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.hud
	add_child(g)
	HudGlyphs.draw_credit_glyph(g, UiTheme.SPACING.l + 8, y, 14)
	_credits_text = PText.make(self, UiTheme.SPACING.l + 22, y, "", TextStyles.numeral({
		"font_size": UiTheme.SIZES.heading, "color": UiTheme.css(UiTheme.PRIMARY),
	}))
	_credits_text.set_origin(0, 0.5)
	_credits_text.z_index = UiTheme.DEPTH.hud


## Kito's portrait, small, top-right, with his name beside it. No speech.
func _create_engineer() -> void:
	var right := UiTheme.GAME_WIDTH - UiTheme.SPACING.l
	var top := float(UiTheme.SPACING.l)
	var cx := right - PORTRAIT / 2
	var cy := top + PORTRAIT / 2
	var key := Assets.portrait_for("kito")
	if Assets.has_image(key):
		var img := PImage.make(self, cx, cy, key).set_display_size(PORTRAIT, PORTRAIT).set_alpha(0.92)
		img.z_index = UiTheme.DEPTH.hud
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.hud
	add_child(g)
	UiPanel.draw_brackets(g, right - PORTRAIT - 3, top - 3, PORTRAIT + 6, PORTRAIT + 6, UiTheme.PRIMARY, 0.85, 8)
	var name := PText.make(self, right - PORTRAIT - UiTheme.SPACING.m, cy, App.t("story.sender.kito").to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM)}))
	name.set_origin(1, 0.5)
	name.z_index = UiTheme.DEPTH.hud


func _create_cards() -> void:
	var modules := Economy.modules()
	var w := _card_width()
	var h := card_height(w)
	var total_w := modules.size() * w + (modules.size() - 1) * CARD_GAP
	var x0 := (UiTheme.GAME_WIDTH - total_w) / 2 + w / 2
	var y := CARD_BOTTOM - h / 2
	_cards = []
	for i in modules.size():
		var def: Dictionary = modules[i]
		var card := ImageCard.new(self, x0 + i * (w + CARD_GAP), y, {
			"texture": Assets.icon_for(def.id),
			"name": App.t(def.name_key),
			"subtitle": App.t(def.desc_key),
			"width": w,
			"height": h,
			"tier": App.save.modules.get(def.id, 0),
			"max_tier": def.max_tier,
			"price": Economy.next_module_cost(App.save.modules, def.id),
		})
		card.z_index = UiTheme.DEPTH.hud
		card.set_on_click(_buy.bind(def, card))
		_cards.append({"def": def, "card": card})
	_refresh()


## Narrowest card width (at least CARD_MIN_W) on which every module name and line fits on one line,
## measured with the card's own text styles, so ImageCard never wraps them.
func _card_width() -> float:
	var name_style := TextStyles.caps({"font_size": UiTheme.SIZES.label + 2, "color": UiTheme.css(UiTheme.TEXT)})
	var line_style := TextStyles.label({"font_size": UiTheme.SIZES.small + 1})
	var widest := 0.0
	for def in Economy.modules():
		widest = maxf(widest, maxf(_measure(App.t(def.name_key).to_upper(), name_style), _measure(App.t(def.desc_key), line_style)))
	return maxf(CARD_MIN_W, ceil(widest) + 2 * CARD_PAD + 8)


static func _measure(text: String, style: Dictionary) -> float:
	var probe := PText.new(text, style)
	var w := probe.width
	probe.free()
	return w


func _buy(def: Dictionary, card: ImageCard) -> void:
	var next = Economy.buy_module(App.save, def.id)
	if next == null:
		return
	App.save = next
	App.persist()
	Sfx.upgrade()
	card.set_price(Economy.next_module_cost(App.save.modules, def.id))
	# Other cards may have become unaffordable; the bought one refreshes after its animation.
	_refresh(card)
	card.play_installed(func(): _refresh())


## Credits, prices, pips and enabled state from the save. `skip` is left alone (animating).
func _refresh(skip: ImageCard = null) -> void:
	_credits_text.set_text(Js.num_str(App.save.credits))
	for entry in _cards:
		var card: ImageCard = entry.card
		if card == skip:
			continue
		var id: String = entry.def.id
		var cost = Economy.next_module_cost(App.save.modules, id)
		var affordable: bool = cost != null and App.save.credits >= cost
		card.set_tier(App.save.modules.get(id, 0), affordable)
		card.set_price(cost)
		card.set_enabled(affordable)
