extends GameScene
## Port of src/scenes/SettingsScene.ts: language, volumes, game speed, density, keypad and progress
## reset. Labels only; every change is saved at once.

## Compact centred column: labels on the left, controls from CONTROL_X.
const COLUMN := {"x": 290.0, "y": 166.0, "w": 700.0, "h": 414.0}
const LABEL_X := 290.0 + 32
const CONTROL_X := 290.0 + 272
const ROW_Y := {"language": 206.0, "sfx": 258.0, "music": 310.0, "speed": 362.0, "density": 414.0, "keypad": 466.0, "reset": 532.0}
const SMALL_BTN_H := 30.0
## Four-choice rows (speed, density): button width and step.
const CHOICE_W := 88.0
const CHOICE_STEP := 96.0
## How long the "erased" mark stays before the reset row returns to its first step.
const RESET_DONE_MS := 1600.0

var _reset_layer: Node2D
var _speed_layer: Node2D
var _density_layer: Node2D
var _reset_timer: Tween = null


func create(_data: Dictionary) -> void:
	_reset_timer = null
	Backdrop.add_backdrop(self, Assets.IMG.bg.starmap)
	Backdrop.add_shade(self, 0.55)

	var title := PText.make(self, COLUMN.x, COLUMN.y - 22, App.t("common.settings.title").to_upper(), TextStyles.caps())
	title.set_origin(0, 0.5)
	title.z_index = UiTheme.DEPTH.hud
	var panel := UiPanel.new(self, COLUMN.x, COLUMN.y, COLUMN.w, COLUMN.h, {"fill_alpha": 0.45})
	panel.z_index = UiTheme.DEPTH.hud
	var ui := _layer()

	# Language.
	ui.add_child(_row_label(ROW_Y.language, App.t("common.settings.language")))
	for i in I18n.LOCALES.size():
		var locale: String = I18n.LOCALES[i]
		var active := App.i18n.locale == locale
		UiButton.new(ui, CONTROL_X + 60 + i * 128, ROW_Y.language, App.t("common.language.%s" % locale),
			_switch_locale.bind(locale),
			{"width": 120, "height": SMALL_BTN_H, "variant": "primary" if active else "ghost", "font_size": UiTheme.SIZES.small + 1})

	# Volumes.
	var fmt := func(v: float) -> String: return UiFormat.percent_text(App.i18n, v)
	var step_labels := {"decrease": App.t("common.decrease"), "increase": App.t("common.increase"), "format": fmt}
	ui.add_child(_row_label(ROW_Y.sfx, App.t("common.settings.sfxVolume")))
	LevelControl.new(ui, CONTROL_X, ROW_Y.sfx, App.save.settings.sfx_volume, step_labels, func(v: float):
		_update_settings({"sfx_volume": v})
		Sfx.set_volume(v)
		Sfx.click())
	ui.add_child(_row_label(ROW_Y.music, App.t("common.settings.musicVolume")))
	LevelControl.new(ui, CONTROL_X, ROW_Y.music, App.save.settings.music_volume, step_labels, func(v: float):
		_update_settings({"music_volume": v})
		Sfx.click())

	# Game speed.
	ui.add_child(_row_label(ROW_Y.speed, App.t("common.settings.gameSpeed")))
	_speed_layer = _layer()
	_build_speed_buttons()

	# Density.
	ui.add_child(_row_label(ROW_Y.density, App.t("common.settings.density")))
	_density_layer = _layer()
	_build_density_buttons()

	# Keypad.
	ui.add_child(_row_label(ROW_Y.keypad, App.t("common.settings.keypadAlwaysVisible")))
	UiToggle.new(ui, CONTROL_X, ROW_Y.keypad, App.save.settings.keypad_always_visible,
		{"on": App.t("common.on"), "off": App.t("common.off")}, func(v: bool): _update_settings({"keypad_always_visible": v}))

	# Reset progress (two steps).
	ui.add_child(_row_label(ROW_Y.reset, App.t("common.settings.resetProgress")))
	_reset_layer = _layer()
	_show_reset_idle()

	var back := UiButton.new(self, UiTheme.SPACING.l + 55, UiTheme.GAME_HEIGHT - UiTheme.SPACING.l - 15, App.t("common.back"),
		func(): App.goto("menu"),
		{"width": 110, "height": SMALL_BTN_H, "variant": "ghost", "font_size": UiTheme.SIZES.small + 1})
	back.z_index = UiTheme.DEPTH.hud


## A container at depth hud + 1 (Phaser this.add.container(0, 0).setDepth(DEPTH.hud + 1)).
func _layer() -> Node2D:
	var n := Node2D.new()
	n.z_index = UiTheme.DEPTH.hud + 1
	add_child(n)
	return n


func _clear(layer: Node) -> void:
	for c in layer.get_children():
		layer.remove_child(c)
		c.queue_free()


func _switch_locale(locale: String) -> void:
	if App.i18n.locale == locale:
		return
	App.set_locale(locale)
	App.goto("settings")


func _row_label(y: float, text: String) -> PText:
	var t := PText.new(text.to_upper(), TextStyles.caps({
		"color": UiTheme.css(UiTheme.TEXT), "word_wrap_width": CONTROL_X - LABEL_X - 16,
	}))
	t.position = Vector2(LABEL_X, y)
	t.set_origin(0, 0.5)
	return t


## Four speed choices (x0.5 ... x1.25); the active one is highlighted. Rebuilt after every change.
func _build_speed_buttons() -> void:
	_build_choices(_speed_layer, ROW_Y.speed, Save.GAME_SPEEDS, func(): return App.save.settings.game_speed,
		func(v): _update_settings({"game_speed": v}), _build_speed_buttons)


## Four density choices, same control as the speed row.
func _build_density_buttons() -> void:
	_build_choices(_density_layer, ROW_Y.density, Save.DENSITIES, func(): return App.save.settings.density,
		func(v): _update_settings({"density": v}), _build_density_buttons)


func _build_choices(layer: Node2D, y: float, values: Array, current: Callable, set_value: Callable, rebuild: Callable) -> void:
	_clear(layer)
	for i in values.size():
		var v = values[i]
		var active: bool = float(current.call()) == float(v)
		UiButton.new(layer, CONTROL_X + CHOICE_W / 2 + i * CHOICE_STEP, y, UiFormat.multiplier_text(App.i18n, v), func():
			if float(current.call()) == float(v):
				return
			set_value.call(v)
			# Rebuild on the next tick, not inside the tapped button's own input handler.
			rebuild.call_deferred(),
			{"width": CHOICE_W, "height": SMALL_BTN_H, "variant": "primary" if active else "ghost", "font_size": UiTheme.SIZES.small + 1})


func _update_settings(patch: Dictionary) -> void:
	var save := App.save.duplicate()
	var settings: Dictionary = save.settings.duplicate()
	settings.merge(patch, true)
	save.settings = settings
	App.save = save
	App.persist()


## First step: one danger button.
func _show_reset_idle() -> void:
	_clear(_reset_layer)
	UiButton.new(_reset_layer, CONTROL_X + 60, ROW_Y.reset, App.t("common.settings.resetErase"),
		func(): _show_reset_confirm.call_deferred(),
		{"width": 120, "height": SMALL_BTN_H, "variant": "danger", "font_size": UiTheme.SIZES.small + 1})


## Second step: confirm (danger) or cancel.
func _show_reset_confirm() -> void:
	_clear(_reset_layer)
	UiButton.new(_reset_layer, CONTROL_X + 70, ROW_Y.reset, App.t("common.settings.resetConfirmYes"), func():
		var locale: String = App.save.locale
		var settings: Dictionary = App.save.settings.duplicate()
		var fresh := Save.default_save()
		fresh.locale = locale
		fresh.settings = settings
		App.save = fresh
		App.persist()
		_show_reset_done.call_deferred(),
		{"width": 140, "height": SMALL_BTN_H, "variant": "danger", "font_size": UiTheme.SIZES.small + 1})
	UiButton.new(_reset_layer, CONTROL_X + 70 + 140 + UiTheme.SPACING.s, ROW_Y.reset, App.t("common.cancel"),
		func(): _show_reset_idle.call_deferred(),
		{"width": 120, "height": SMALL_BTN_H, "variant": "ghost", "font_size": UiTheme.SIZES.small + 1})


## Short "erased" mark, then back to the first step.
func _show_reset_done() -> void:
	_clear(_reset_layer)
	var t := PText.make(_reset_layer, CONTROL_X, ROW_Y.reset, App.t("common.settings.resetDone").to_upper(),
		TextStyles.caps({"color": UiTheme.css(UiTheme.OK)}))
	t.set_origin(0, 0.5)
	if _reset_timer != null and _reset_timer.is_valid():
		_reset_timer.kill()
	_reset_timer = PTween.delayed_call(self, RESET_DONE_MS, func():
		_reset_timer = null
		_show_reset_idle())
