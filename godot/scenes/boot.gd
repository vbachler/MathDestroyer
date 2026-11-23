extends GameScene
## Port of src/scenes/BootScene.ts: loads the image assets with a thin progress bar, generates the
## procedural textures, wires shared services, then opens the menu (or the --shot scene).
## Main scene of the project (boot.tscn).

const BAR_W := 360
const BAR_Y := UiTheme.GAME_HEIGHT / 2.0

var _track: PGraphics
var _bar: PGraphics
var _done := false


func create(_data: Dictionary) -> void:
	App.adopt_main_scene(self, "boot")
	_track = PGraphics.new()
	_track.fill_style(UiTheme.PRIMARY_DIM, 0.6)
	_track.fill_rect(UiTheme.GAME_WIDTH / 2.0 - BAR_W / 2.0, BAR_Y - 0.5, BAR_W, 1)
	add_child(_track)
	_bar = PGraphics.new()
	add_child(_bar)
	_set_progress(0)
	Assets.request_all()


func _set_progress(p: float) -> void:
	_bar.clear()
	_bar.fill_style(UiTheme.PRIMARY, 1)
	_bar.fill_rect(UiTheme.GAME_WIDTH / 2.0 - BAR_W / 2.0, BAR_Y - 0.5, maxf(1.0, BAR_W * p), 1)


func update(_delta_ms: float) -> void:
	if _done:
		return
	var p := Assets.poll_loading()
	_set_progress(p)
	if p < 1.0:
		return
	_done = true
	_finish()


func _finish() -> void:
	Tex.generate_textures()
	App.i18n.set_locale(App.save.locale)
	if Sfx.has_method("configure"):
		# Ambience follows the music volume live (read from the current save on every poll).
		Sfx.configure(App.save.settings.sfx_volume, func() -> float: return App.save.settings.music_volume)
	else:
		Sfx.set_volume(App.save.settings.sfx_volume)
	UiButton.click_sound = func() -> void: Sfx.click()
	if App.is_shot_run():
		if App.shot_scene != "boot":
			App.goto(App.shot_scene, App.shot_data)
		return
	App.goto("menu")
