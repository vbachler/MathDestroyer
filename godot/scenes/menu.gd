extends GameScene
## Port of src/scenes/MenuScene.ts: title screen: the menu picture, the game name small in the
## lower left, three buttons, HR / EN.

const LEFT := 64.0
const TITLE_BOTTOM := 492.0
const BUTTON_W := 180.0
const BUTTON_H := 36.0
const BUTTON_STEP := 46.0
const FIRST_BUTTON_Y := 534.0
## One full drift cycle of the background (there and back), ms.
const DRIFT_MS := 60000.0


func create(_data: Dictionary) -> void:
	Sfx.start_ambience("menu")
	_create_background()

	var hud := PGraphics.new()
	hud.z_index = UiTheme.DEPTH.hud
	add_child(hud)
	hud.line_style(UiTheme.LINE_WIDTH, UiTheme.PRIMARY, 0.7)
	var ly := TITLE_BOTTOM - UiTheme.SIZES.hero - 14
	hud.line_between(LEFT, ly, LEFT + 36, ly)

	var title := PText.make(self, LEFT - 2, TITLE_BOTTOM, App.t("common.gameTitle").to_upper(), TextStyles.title({
		"font_size": UiTheme.SIZES.hero, "color": UiTheme.css(UiTheme.TEXT), "letter_spacing": UiTheme.LETTER_SPACING.wide * 2,
	}))
	title.set_origin(0, 1)
	title.z_index = UiTheme.DEPTH.hud

	var buttons := [
		[App.t("common.menu.play"), func(): App.goto("star_map"), "primary"],
		[App.t("common.menu.mastery"), func(): App.goto("mastery", {"from": "menu"}), "ghost"],
		[App.t("common.menu.settings"), func(): App.goto("settings"), "ghost"],
	]
	for i in buttons.size():
		var b: Array = buttons[i]
		var btn := UiButton.new(self, LEFT + BUTTON_W / 2, FIRST_BUTTON_Y + i * BUTTON_STEP, b[0], b[1],
			{"width": BUTTON_W, "height": BUTTON_H, "variant": b[2]})
		btn.z_index = UiTheme.DEPTH.hud

	_create_language_switch()


## bg_menu with a very slow drift and zoom (a few pixels over a minute); a soft shade under the title.
func _create_background() -> void:
	var bg := Backdrop.add_backdrop(self, Assets.IMG.bg.menu, {"overscan": 1.03})
	if bg != null:
		var s := bg.scale.x
		PTween.add(bg, {"x": bg.position.x - 8, "y": bg.position.y - 3, "scale": s * 1.012}, DRIFT_MS / 2,
			"Sine.easeInOut", {"yoyo": true, "repeat": -1})
	Backdrop.add_shade(self, 0, {"from": UiTheme.GAME_HEIGHT * 0.45, "alpha": 0.55})


## HR / EN in the top-right corner; switching restarts the scene in the new language.
func _create_language_switch() -> void:
	var w := 44.0
	var h := 28.0
	var locales: Array = I18n.LOCALES
	for i in locales.size():
		var locale: String = locales[i]
		var active := App.i18n.locale == locale
		var x := UiTheme.GAME_WIDTH - UiTheme.SPACING.l - w / 2 - (locales.size() - 1 - i) * (w + UiTheme.SPACING.xs)
		var btn := UiButton.new(self, x, UiTheme.SPACING.l + h / 2, App.t("common.language.short.%s" % locale),
			_switch_locale.bind(locale), {"width": w, "height": h, "variant": "primary" if active else "ghost", "font_size": UiTheme.SIZES.small + 1})
		btn.z_index = UiTheme.DEPTH.hud


func _switch_locale(locale: String) -> void:
	if App.i18n.locale == locale:
		return
	App.set_locale(locale)
	App.goto("menu")
