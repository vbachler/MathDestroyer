extends GameScene
## Port of src/scenes/FtlScene.ts: the jump between the star map and the mission (about 2.6 s, any
## key or click skips it): stars as points with a slight push, then radial streaks accelerating
## while bg_ftl fades in, turning and growing, then the streaks collapse to points under a soft
## brightness swell and the ship drops out onto the battle background. The dashboard stays along
## the bottom. Data: {planet_id} (TS FtlSceneData; "planetId" accepted too).

## Phase lengths, ms: charge (points, push), tunnel (streaks), exit (collapse and swell).
const CHARGE_MS := 500.0
const TUNNEL_MS := 1500.0
const EXIT_MS := 600.0
const TOTAL_MS := CHARGE_MS + TUNNEL_MS + EXIT_MS

const STAR_COUNT := 420
## Slight push toward the vanishing point during the charge.
const PUSH_ZOOM := 1.045
## Peak of the brightness swell at the exit (no hard white flash).
const SWELL_PEAK := 0.6
## bg_ftl: starting overscan (hides its letterbox bars), end scale factor and rotation.
const FTL_SCALE_FROM := 1.25
const FTL_SCALE_TO := 1.6
const FTL_ROTATION := 0.22
const FTL_ALPHA := 0.9
## Where the battle screen's darkness under the console begins (see Dashboard).
const DASH_SHADE_TOP := 580.0

var planet_id := ""
var _elapsed := 0.0
var _finished := false
var _exit_sound_played := false
var _streaks: WarpStreaks = null
var _ftl_bg: PImage = null
var _ftl_base_scale := 1.0
var _arrival_bg: PImage = null
var _swell: ColorRect


static func _clamp01(v: float) -> float:
	return 0.0 if v < 0 else (1.0 if v > 1 else v)


static func _smooth(v: float) -> float:
	var x := _clamp01(v)
	return x * x * (3 - 2 * x)


func create(d: Dictionary) -> void:
	planet_id = str(d.get("planet_id", d.get("planetId", "")))
	_elapsed = 0.0
	_finished = false
	_exit_sound_played = false
	RenderingServer.set_default_clear_color(UiTheme.color(UiTheme.BG))

	_ftl_bg = Backdrop.add_backdrop(self, Assets.IMG.bg.ftl, {"overscan": FTL_SCALE_FROM})
	if _ftl_bg != null:
		_ftl_base_scale = _ftl_bg.scale.x / FTL_SCALE_FROM
		_ftl_bg.set_alpha(0)
	_arrival_bg = Backdrop.add_backdrop(self, Assets.battle_bg_for(planet_id), {"depth": UiTheme.DEPTH.background + 1})
	if _arrival_bg != null:
		_arrival_bg.set_alpha(0)

	_streaks = WarpStreaks.new(self, {"count": STAR_COUNT, "depth": UiTheme.DEPTH.fx, "seed": "ftl-jump"})
	_swell = ColorRect.new()
	_swell.size = Vector2(UiTheme.GAME_WIDTH, UiTheme.GAME_HEIGHT)
	_swell.color = UiTheme.color(UiTheme.TEXT, 1)
	_swell.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_swell.z_index = UiTheme.DEPTH.fx + 1
	_swell.material = ParticleBurst.add_material()
	_swell.modulate.a = 0
	add_child(_swell)
	_add_dashboard()

	# Spool-up: the drive charges until the exit; the previous screen's ambience gives way.
	Sfx.stop_ambience(0.6)
	Sfx.ftl_charge((CHARGE_MS + TUNNEL_MS) / 1000.0)
	_render_frame()


func update(delta_ms: float) -> void:
	if _finished:
		return
	_elapsed += minf(delta_ms, 50.0)
	if _elapsed >= TOTAL_MS:
		_finish()
		return
	_render_frame()
	if _streaks != null:
		_streaks.update(delta_ms)


## Any key (not a repeat) or a click / tap skips the jump.
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		_finish()
	elif event is InputEventMouseButton and event.pressed:
		_finish()


## Sets every layer for the current time.
func _render_frame() -> void:
	var t := _elapsed
	var streaks := _streaks
	if streaks == null:
		return
	var intensity: float
	var ftl_alpha := 0.0
	var arrival := 0.0
	var swell := 0.0
	var star_alpha := 1.0

	if t < CHARGE_MS:
		var p := t / CHARGE_MS
		intensity = 0.06 * p
		streaks.set_zoom(1 + (PUSH_ZOOM - 1) * _smooth(p))
	elif t < CHARGE_MS + TUNNEL_MS:
		var p := (t - CHARGE_MS) / TUNNEL_MS
		intensity = 0.06 + 0.94 * p
		ftl_alpha = FTL_ALPHA * _smooth(p / 0.7)
		streaks.set_zoom(PUSH_ZOOM)
	else:
		var q := _clamp01((t - CHARGE_MS - TUNNEL_MS) / EXIT_MS)
		intensity = (1 - q) * (1 - q)
		ftl_alpha = FTL_ALPHA * (1 - _smooth(q / 0.8))
		swell = SWELL_PEAK * sin(PI * q)
		arrival = _smooth((q - 0.35) / 0.65)
		star_alpha = 1 - _smooth((q - 0.5) / 0.5)
		if not _exit_sound_played:
			_exit_sound_played = true
			Sfx.ftl_drop()

	streaks.set_intensity(intensity).set_alpha(star_alpha)
	if _ftl_bg != null:
		var k := _clamp01((t - CHARGE_MS) / (TUNNEL_MS + EXIT_MS))
		_ftl_bg.set_alpha(ftl_alpha)
		_ftl_bg.rotation = FTL_ROTATION * k
		_ftl_bg.scale = Vector2.ONE * (_ftl_base_scale * (FTL_SCALE_FROM + (FTL_SCALE_TO - FTL_SCALE_FROM) * k * k))
	if _arrival_bg != null:
		_arrival_bg.set_alpha(arrival)
	_swell.modulate.a = swell


## The cockpit console exactly where the battle screen draws it (BattleLayout: DASH_X/Y at
## DASH_SCALE), with the same darkness under and beside it, so the drop-out is seamless.
func _add_dashboard() -> void:
	Backdrop.add_shade(self, 0, {"from": DASH_SHADE_TOP, "alpha": 0.85}, UiTheme.DEPTH.hud - 1)
	if not Assets.has_image(Assets.IMG.ui.dash):
		return
	var dash := PImage.make(self, BattleLayout.DASH_X, BattleLayout.DASH_Y, Assets.IMG.ui.dash)
	dash.set_origin(0, 0)
	dash.scale = Vector2.ONE * BattleLayout.DASH_SCALE
	dash.z_index = UiTheme.DEPTH.hud


func _finish() -> void:
	if _finished:
		return
	_finished = true
	# Skipped before the exit: still drop out (this also cuts the charge hum).
	if not _exit_sound_played:
		_exit_sound_played = true
		Sfx.ftl_drop()
	App.goto("battle", {"planet_id": planet_id})


func shutdown() -> void:
	if _streaks != null and is_instance_valid(_streaks):
		_streaks.destroy()
	_streaks = null
	_ftl_bg = null
	_arrival_bg = null
