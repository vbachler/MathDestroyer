extends GameScene
## Port of src/scenes/UpgradeScene.ts: reward overlay launched over the paused (dimmed) Battle
## between waves: three free upgrade cards (picture, short name, tier pips). Tapping one or pressing
## 1, 2, 3 plays its "installed" animation, calls sim.pick_upgrade(), hands the events to Battle and
## resumes it. If it is reached with no offers it calls sim.next_wave() and closes at once.
## data: {sim: BattleSim}. Battle receives the events like the TS SIM_EVENTS event: through its
## signal `sim_events(events)` if it has one, else its method `handle_events(events)`.

## Wide enough for a two-word caps name on one line (ImageCard wraps at CARD_W - 20).
const CARD_W := 184.0
## ImageCard stack: 10 pad + picture (CARD_W - 20) + 10 + name 22 + pip row 10 + 12 pad.
const CARD_H := CARD_W + 44
const CARD_GAP := 28.0
const CARD_Y := 340.0
const TITLE_Y := 198.0

var _sim: BattleSim
var _picked := false
var _left := false
var _cards: Array[ImageCard] = []


func create(d: Dictionary) -> void:
	_sim = d.get("sim")
	# Dev hook (not in the TS): --shot=upgrade --data='{"dev_sim": true}' builds a sim after wave 1.
	if _sim == null and d.get("dev_sim", false):
		var helper = load("res://tests/test_battle.gd").new()
		_sim = BattleSim.new(helper.cfg())
		helper.clear_wave(_sim)
	_picked = false
	_left = false
	var cx := UiTheme.GAME_WIDTH / 2.0

	var offers: Array = _sim.offers()
	if offers.is_empty():
		_leave(func(): return _sim.next_wave())
		return

	# Dim rectangle that swallows input (Phaser rectangle.setInteractive()).
	var dim := PGraphics.new()
	dim.z_index = UiTheme.DEPTH.overlay - 1
	dim.fill_style(UiTheme.BG, 0.62)
	dim.fill_rect(0, 0, UiTheme.GAME_WIDTH, UiTheme.GAME_HEIGHT)
	add_child(dim)
	dim.add_child(HitArea.new(UiTheme.GAME_WIDTH, UiTheme.GAME_HEIGHT, false, false))
	var title := PText.make(self, cx, TITLE_Y, App.t("battle.upgrades.title").to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.heading, "letter_spacing": UiTheme.LETTER_SPACING.wide}))
	title.set_origin(0.5)
	title.z_index = UiTheme.DEPTH.overlay

	var total_w := offers.size() * CARD_W + (offers.size() - 1) * CARD_GAP
	var x0 := (UiTheme.GAME_WIDTH - total_w) / 2 + CARD_W / 2
	_cards = []
	for i in offers.size():
		var o: Dictionary = offers[i]
		var card := ImageCard.new(self, x0 + i * (CARD_W + CARD_GAP), CARD_Y, {
			"texture": Assets.icon_for(o.def.id),
			"name": App.t(o.def.name_key),
			"width": CARD_W,
			"height": CARD_H,
			"tier": o.next_tier - 1,
			"max_tier": o.def.max_tier,
			"highlight_next": true,
			"hotkey": str(i + 1),
		})
		card.z_index = UiTheme.DEPTH.overlay
		card.set_on_click(_pick.bind(card, o.def.id))
		card.modulate.a = 0
		card.position.y = CARD_Y + 12
		PTween.add(card, {"alpha": 1, "y": CARD_Y}, 220, "Quad.easeOut", {"delay": 60 * i})
		_cards.append(card)


## Keys 1, 2, 3 (and the numpad digits) pick a card.
func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	var k: int = event.keycode
	var i := -1
	if k >= KEY_1 and k <= KEY_3:
		i = k - KEY_1
	elif k >= KEY_KP_1 and k <= KEY_KP_3:
		i = k - KEY_KP_1
	if i >= 0 and i < _cards.size():
		_cards[i].click()


func _pick(card: ImageCard, upgrade_id: String) -> void:
	if _picked:
		return
	_picked = true
	Sfx.upgrade()
	card.play_installed(func(): _leave(func(): return _sim.pick_upgrade(upgrade_id)))


## Runs the sim call that starts the next wave, hands its events to Battle and closes.
func _leave(start_wave: Callable) -> void:
	if _left:
		return
	_left = true
	var events: Array = start_wave.call()
	var battle := App.scene("battle")
	if battle != null:
		if battle.has_signal("sim_events"):
			battle.emit_signal("sim_events", events)
		elif battle.has_method("handle_events"):
			battle.call("handle_events", events)
	App.resume_scene("battle")
	App.stop("upgrade")
