extends GameScene
## Port of src/scenes/BattleScene.ts. Data: {planet_id} (TS BattleSceneData; "planetId" accepted too).
## The Upgrade overlay gets {sim} and hands the events of sim.pick_upgrade() / sim.next_wave() back
## with `App.scene("battle").handle_events(events)` (or the `sim_events` signal, TS SIM_EVENTS),
## then App.resume_scene("battle"); the Boarding overlay gets {facts, seed, speed_scale, density,
## on_done} and calls on_done(result) when it ends.
##
## Dev only (debug builds): dev_force_breach() = TS window.__forceBreach(); data "dev" options drive
## screenshot runs through the same input path as the keyboard (key events pushed into the viewport):
##   {"breach_at_ms": t, "autoplay_ms": t, "wrong_at_ms": t, "impact_at_ms": t, "arm_at_ms": t,
##    "wreck_at_ms": t, "keypad": true, "boarding": {...same for the boarding scene...}}

## TS SIM_EVENTS: emitted by the Upgrade overlay with the events of the sim call that starts the wave.
signal sim_events(events: Array)

const TOTAL_WAVES := 3
const MAX_FRAME_MS := 100.0
const CX := UiTheme.GAME_WIDTH / 2.0
const H := UiTheme.GAME_HEIGHT

# Threat cue thresholds (sim y).
const WARN_Y := Battle.IMPACT_Y - 180
const CRIT_Y := Battle.IMPACT_Y - 85

## Background drift: the image is overscanned by BG_OVERSCAN and wanders slowly inside it.
const BG_OVERSCAN := 1.08
const BG_DRIFT_X := 22.0
const BG_DRIFT_Y := 9.0
const BG_PERIOD_X_MS := 90_000.0
const BG_PERIOD_Y_MS := 130_000.0

const BANNER_Y := 236.0
const WAVE_CLEARED_BANNER_MS := 900.0
const END_BANNER_MS := 1500.0
const WAVE_BANNER_MS := 1100.0
## The wrong-answer stab lands just after the loud part of the missed shot.
const WRONG_SOUND_DELAY_MS := 200.0
## Ship hit: shake, then the hull clang just after the zap.
const HIT_SHAKE_MS := 250.0
const HULL_SOUND_DELAY_MS := 70.0
## Breach: alarm, long shake and flashes, then the boarding scene.
const BREACH_MS := 1500.0

var planet_id := ""
var sim: BattleSim
var _bg: PImage = null
var _starfield: Starfield = null
var _drift_ms := 0.0
## Enemy id -> EnemyShip; ships live in _ship_layer (z DEPTH.enemies), ordered by sim y (TS depth enemies + y / 1000).
var _ships := {}
var _ship_layer: Node2D
var _tag_sides := {}
var _stations: Array = []
var _dash: Dashboard
var _camera: CameraFx

var _explain_dim: ColorRect = null
var _explain_card: ExplanationCard = null
var _pause_overlay: Node2D = null

var _paused := false
var _ending := false
## Between `breach` and the end of the boarding.
var _breaching := false
## Set when resuming from Boarding (no wave banner then).
var _quiet_resume := false
## Set when this scene paused itself for an overlay: the next update() is the Phaser RESUME event.
var _resume_pending := false
var _speed_scale := 1.0
var _breach_fx: Array = []

var _dev: Dictionary = {}
var _dev_ms := 0.0
var _dev_done := {}
var _dev_next_answer := 0.0


static func threat_of(y: float) -> int:
	if y >= CRIT_Y:
		return 2
	if y >= WARN_Y:
		return 1
	return 0


static func _random_from(a: float, b: float) -> float:
	return a + randf() * (b - a)


func create(d: Dictionary) -> void:
	planet_id = str(d.get("planet_id", d.get("planetId", "")))
	if OS.is_debug_build():
		_dev = d.get("dev", {})
	var save := App.save
	var now := App.now_ms()
	# Later systems of a sector are harder: their tier speeds the enemies up.
	_speed_scale = float(save.settings.game_speed) * Content.tier_speed_factor(planet_id)
	sim = BattleSim.new({
		"planet_id": planet_id,
		"total_waves": TOTAL_WAVES,
		"stats": save.stats.duplicate(),
		"planets": save.planets.duplicate(),
		"modules": save.modules.duplicate(),
		"now": now,
		"seed": now % 0x7fffffff,
		"speed_scale": _speed_scale,
		"density": save.settings.density,
	})

	RenderingServer.set_default_clear_color(UiTheme.color(UiTheme.BG))
	_camera = CameraFx.new(self)
	add_child(_camera)
	_build_background()
	for x in Battle.DOME_X:
		_stations.append(Station.new(self, x))
	_ship_layer = Node2D.new()
	_ship_layer.z_index = UiTheme.DEPTH.enemies
	add_child(_ship_layer)
	_dash = Dashboard.new(self, {
		"wave": App.t("battle.hud.wave"), "score": App.t("battle.hud.score"), "streak": App.t("battle.hud.streak"),
		"stations": App.t("battle.hud.stations"), "hull": App.t("battle.hud.hull"),
	})
	_build_pause_glyph()
	_build_keypad()
	sim_events.connect(handle_events)

	Sfx.start_ambience("battle")
	_show_wave_banner()
	_render_state()


## DEV only (TS window.__forceBreach): puts the hull at 1 and makes the lowest enemy an armed ship
## about to fire (moved down to the fire line if needed), so the next step plays the real shipHit,
## breach and Boarding path. Returns false when no enemy is on screen yet.
func dev_force_breach() -> bool:
	if not OS.is_debug_build():
		return false
	var s := sim.state
	var target = null
	for e in s.enemies:
		if target == null or e.y > target.y:
			target = e
	if target == null or s.phase != "spawning":
		return false
	s.hull = 1
	target.armed = true
	target.charge = 0.999
	target.y = maxf(target.y, Battle.FIRE_LINE_Y)
	return true


func update(delta_ms: float) -> void:
	if _resume_pending:
		_resume_pending = false
		_on_resume()
	var dt := minf(delta_ms, MAX_FRAME_MS)
	_drift(dt)
	if not _paused:
		handle_events(sim.update(dt))
	if not _paused:
		for st in _stations:
			st.update(dt)
	for ship in _ships.values():
		ship.tick(dt)
	_render_state()
	Sfx.set_tension(_tension_level())
	if not _dev.is_empty():
		_dev_step(dt)


## Dread for the music: 0 until the lowest enemy passes ~1/3 of the way down, 1 at the impact line.
func _tension_level() -> float:
	var s := sim.state
	if _paused or _ending or s.phase != "spawning" or s.enemies.is_empty():
		return 0.0
	var lowest := -INF
	for e in s.enemies:
		lowest = maxf(lowest, e.y)
	var y_norm := (lowest - Battle.SPAWN_Y) / float(Battle.IMPACT_Y - Battle.SPAWN_Y)
	return clampf((y_norm - 0.35) / 0.65, 0.0, 1.0)


# ---------------------------------------------------------------- scene building

func _build_background() -> void:
	var key := Assets.battle_bg_for(planet_id)
	if Assets.has_image(key):
		var img := PImage.make(self, CX, H / 2.0, key)
		img.z_index = UiTheme.DEPTH.background
		var tw: float = img.texture.get_width()
		var th: float = img.texture.get_height()
		img.scale = Vector2.ONE * (maxf(UiTheme.GAME_WIDTH / tw, H / th) * BG_OVERSCAN)
		_bg = img
	else:
		_starfield = Starfield.new(self, {"speed": 0.15})


## Very slow wander of the background (a few px per second at most).
func _drift(dt: float) -> void:
	_drift_ms += dt
	if _bg != null:
		_bg.position = Vector2(
			CX + BG_DRIFT_X * sin((_drift_ms / BG_PERIOD_X_MS) * PI * 2.0),
			H / 2.0 + BG_DRIFT_Y * sin((_drift_ms / BG_PERIOD_Y_MS) * PI * 2.0))
	if _starfield != null:
		_starfield.update(dt)


func _build_pause_glyph() -> void:
	var r := BattleLayout.PAUSE_RECT
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.hud
	add_child(g)
	g.fill_style(UiTheme.BG, 0.35)
	g.fill_rect(r.x, r.y, r.w, r.h)
	UiPanel.draw_brackets(g, r.x, r.y, r.w, r.h, UiTheme.PRIMARY, 0.75, 7)
	g.fill_style(UiTheme.PRIMARY, 0.9)
	g.fill_rect(r.x + r.w / 2 - 6, r.y + 11, 4, r.h - 22)
	g.fill_rect(r.x + r.w / 2 + 2, r.y + 11, 4, r.h - 22)
	var zone := HitZone.add(self, r.x + r.w / 2, r.y + r.h / 2, r.w + 12, r.h + 12, _toggle_pause)
	zone.get_parent().z_index = UiTheme.DEPTH.hud


func _build_keypad() -> void:
	var show: bool = App.save.settings.keypad_always_visible or DisplayServer.is_touchscreen_available() \
		or _dev.get("keypad", false)
	if not show:
		return
	var pad := Keypad.new(self, {
		"on_digit": _pad_digit, "on_sign": _pad_sign, "on_backspace": _pad_backspace, "on_fire": _fire,
	}, {"fire_label": App.t("battle.keypad.fire"), "digits": BattleLayout.KEYPAD_DIGITS,
		"fire": BattleLayout.KEYPAD_FIRE, "gap": BattleLayout.KEY_GAP})
	# Above the console's bottom shade; ships and tags never reach the corners (battleLayout test).
	pad.z_index = UiTheme.DEPTH.hud


# ---------------------------------------------------------------- input

func _accepts_input() -> bool:
	return not _paused and not _ending and not _breaching


func _pad_digit(d: int) -> void:
	if _accepts_input():
		sim.type_digit(d)


func _pad_sign() -> void:
	if _accepts_input():
		sim.toggle_sign()


func _pad_backspace() -> void:
	if _accepts_input():
		sim.backspace()


func _fire() -> void:
	if not _accepts_input():
		return
	handle_events(sim.submit())


## One sim call per key press (Keymap). Inactive while paused under an overlay.
func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed:
		return
	var kl := Keymap.from_event(event)
	if Keymap.is_game_key(kl):
		get_viewport().set_input_as_handled()
	var action = Keymap.key_action(kl)
	if action == null:
		return
	if action.type == "pause":
		_toggle_pause()
		return
	if not _accepts_input():
		return
	match action.type:
		"digit":
			sim.type_digit(action.d)
		"sign":
			sim.toggle_sign()
		"backspace":
			sim.backspace()
		"submit":
			_fire()


# ---------------------------------------------------------------- events

## Handles sim events (also the TS SIM_EVENTS hand-back from the Upgrade overlay).
func handle_events(events: Array) -> void:
	for ev in events:
		match ev.type:
			"spawn":
				_ensure_ship(ev.enemy)
			"kill":
				_on_kill(ev.enemy, ev.by_turret, ev.points)
			"wrong":
				_on_wrong()
			"impact":
				_on_impact(ev.enemy, ev.dome_index, ev.destroyed)
			"shieldBlock":
				_on_shield_block(ev.enemy, ev.dome_index)
			"repair":
				_on_repair(ev.dome_index)
			"waveCleared":
				_on_wave_cleared()
			"explainStart":
				_show_explanation(ev.fact)
			"explainEnd":
				_hide_explanation()
			"shipHit":
				_on_ship_hit(ev.enemy)
			"breach":
				_on_breach()
			"won":
				_on_mission_end(true)
			"lost":
				_on_mission_end(false)


func _ensure_ship(e: Dictionary) -> EnemyShip:
	var ship: EnemyShip = _ships.get(e.id)
	if ship == null:
		ship = EnemyShip.new(_ship_layer, e.x, BattleLayout.ship_screen_y(e.y), Facts.format_problem(e.fact, App.i18n.locale),
			Assets.enemy_image_for(e.id), BattleLayout.ship_size(e.y))
		ship.set_meta("sim_y", float(e.y))
		ship.play_entry()
		_ships[e.id] = ship
	return ship


func _remove_ship(id: int) -> void:
	var ship: EnemyShip = _ships.get(id)
	if ship != null:
		ship.destroy()
	_ships.erase(id)
	_tag_sides.erase(id)


## Where the enemy is drawn right now (the live ship if it exists).
func _ship_point(e: Dictionary) -> Dictionary:
	var ship: EnemyShip = _ships.get(e.id)
	return {"x": ship.position.x, "y": ship.position.y} if ship != null else {"x": float(e.x), "y": BattleLayout.ship_screen_y(e.y)}


func _ship_size_of(e: Dictionary) -> float:
	var ship: EnemyShip = _ships.get(e.id)
	return ship.ship_size if ship != null else BattleLayout.ship_size(e.y)


func _on_kill(e: Dictionary, by_turret: bool, points: int) -> void:
	var p := _ship_point(e)
	var size := _ship_size_of(e)
	_remove_ship(e.id)
	if by_turret:
		var i := _nearest_station(p.x)
		BattleFx.beam(self, {"x": float(Battle.DOME_X[i]), "y": _stations[i].top}, p, UiTheme.ACCENT, {"width": 0.32})
	else:
		BattleFx.beam(self, BattleLayout.GUN_LEFT, p, UiTheme.PRIMARY)
		BattleFx.beam(self, BattleLayout.GUN_RIGHT, p, UiTheme.PRIMARY)
	BattleFx.ship_explosion(self, p.x, p.y, size, UiTheme.ACCENT if by_turret else UiTheme.PRIMARY)
	_float_number(p.x, p.y - size * 0.6, "+%d" % points)
	Sfx.laser()
	PTween.delayed_call(self, 70, func() -> void: Sfx.hit())


## The guns fire and miss: both beams converge beside the lowest enemy and carry on into space.
func _on_wrong() -> void:
	var lowest = null
	for e in sim.state.enemies:
		if lowest == null or e.y > lowest.y:
			lowest = e
	var aim: Dictionary
	if lowest != null:
		aim = BattleLayout.miss_point(_ship_point(lowest), randf())
	else:
		aim = {"x": CX + _random_from(-220, 220), "y": _random_from(140, 300)}
	BattleFx.beam(self, BattleLayout.GUN_LEFT, aim, UiTheme.PRIMARY, {"fade_into": true})
	BattleFx.beam(self, BattleLayout.GUN_RIGHT, aim, UiTheme.PRIMARY, {"fade_into": true})
	BattleFx.flash(self, aim.x, aim.y, UiTheme.PRIMARY_DIM, 18, 180)
	Sfx.laser_miss()
	PTween.delayed_call(self, WRONG_SOUND_DELAY_MS, func() -> void: Sfx.wrong())
	_dash.shake_input()


## `destroyed`: the station's last hp; it blows up into a debris field (Station.set_hp) with its own sound.
func _on_impact(e: Dictionary, dome_index: int, destroyed: bool) -> void:
	var p := _ship_point(e)
	_remove_ship(e.id)
	var st: Station = _stations[dome_index]
	BattleFx.ship_explosion(self, (p.x + st.x) / 2.0, st.top, 46, UiTheme.DANGER)
	BattleFx.sparks(self, st.x, BattleLayout.STATION_Y, UiTheme.DANGER, 10, 90)
	if destroyed:
		_camera.shake(320, 0.0045)
		Sfx.station_destroyed()
		return
	_camera.shake(200, 0.003)
	Sfx.miss()


## The shield absorbed an impact: a teal hex flashes over the station and the ship bursts against it.
func _on_shield_block(e: Dictionary, dome_index: int) -> void:
	var size := _ship_size_of(e)
	_remove_ship(e.id)
	var st: Station = _stations[dome_index]
	BattleFx.hex_shield(self, st.x, BattleLayout.STATION_Y, 42)
	BattleFx.ship_explosion(self, st.x, BattleLayout.STATION_Y - 40, size, UiTheme.ACCENT)
	Sfx.shield_block()


func _on_repair(dome_index: int) -> void:
	var st: Station = _stations[dome_index]
	BattleFx.flash(self, st.x, BattleLayout.STATION_Y, UiTheme.OK, 70, 600)
	BattleFx.ring(self, st.x, BattleLayout.STATION_Y, 26, UiTheme.OK)
	Sfx.repair()


func _on_wave_cleared() -> void:
	_hide_explanation()
	_show_banner(App.t("battle.banner.waveCleared"), WAVE_CLEARED_BANNER_MS, UiTheme.OK)
	PTween.delayed_call(self, WAVE_CLEARED_BANNER_MS, _after_wave_cleared)


func _after_wave_cleared() -> void:
	if _ending:
		return
	if sim.offers().is_empty() or not ResourceLoader.exists(App.SCENES.upgrade):
		# Everything is at max tier: no reward screen, straight into the next wave.
		# (Also while the Upgrade scene is not there.)
		handle_events(sim.next_wave())
		_show_wave_banner()
		return
	_pause_for_overlay()
	App.launch("upgrade", {"sim": sim})


## Phaser scene.pause() before launching an overlay; the next update after App.resume_scene is the RESUME event.
func _pause_for_overlay() -> void:
	_resume_pending = true
	App.pause_scene(scene_name)


## Back from the Upgrade overlay (sim.pick_upgrade() or sim.next_wave() has been called).
func _on_resume() -> void:
	if _quiet_resume:
		_quiet_resume = false
		return
	_show_wave_banner()


# ---------------------------------------------------------------- attack and boarding

## An armed ship fired: a thick red beam into the cockpit, shake, red vignette, console flicker.
func _on_ship_hit(e: Dictionary) -> void:
	var ship: EnemyShip = _ships.get(e.id)
	var from: Dictionary = ship.nose if ship != null else {"x": float(e.x), "y": BattleLayout.ship_screen_y(e.y) + BattleLayout.ship_size(e.y) * 0.42}
	var to := {"x": BattleLayout.COCKPIT.x + _random_from(-40, 40), "y": BattleLayout.COCKPIT.y}
	BattleFx.beam(self, from, to, UiTheme.DANGER, {"width": 1.6, "duration_ms": 320})
	BattleFx.beam(self, from, to, UiTheme.WHITE, {"width": 0.35, "duration_ms": 200})
	BattleFx.flash(self, from.x, from.y, UiTheme.WHITE, 34, 220)
	var impact := PImage.make(self, to.x, to.y, Tex.GLOW)
	impact.set_tint(UiTheme.DANGER)
	impact.material = ParticleBurst.add_material()
	impact.z_index = UiTheme.DEPTH.hud + 3
	impact.scale = Vector2.ONE * 0.6
	PTween.add(impact, {"scale": 2.2, "alpha": 0.0}, 450, "Cubic.easeOut", {"on_complete": impact.queue_free})
	BattleFx.sparks(self, to.x, to.y - 6, UiTheme.DANGER, 12, 140)
	_camera.shake(HIT_SHAKE_MS, 0.007)
	_vignette(UiTheme.DANGER, 0.65, 520)
	_dash.flicker()
	Sfx.enemy_laser()
	PTween.delayed_call(self, HULL_SOUND_DELAY_MS, func() -> void: Sfx.hull_hit())


## Full-screen edge glow that fades from `peak` alpha.
func _vignette(color: int, peak: float, duration_ms: float) -> void:
	var v := PImage.make(self, CX, H / 2.0, Tex.VIGNETTE)
	v.set_display_size(UiTheme.GAME_WIDTH, H)
	v.set_tint(color)
	v.z_index = UiTheme.DEPTH.overlay - 30
	v.set_alpha(peak)
	PTween.add(v, {"alpha": 0.0}, duration_ms, "Quad.easeIn", {"on_complete": v.queue_free})


## Phaser rectangle over the whole view: `fill_alpha` is the fill, the node alpha (modulate) the object alpha.
func _full_rect(color: int, fill_alpha: float, z: int, interactive: bool = false) -> ColorRect:
	var r := ColorRect.new()
	r.size = Vector2(UiTheme.GAME_WIDTH, H)
	r.color = UiTheme.color(color, fill_alpha)
	r.mouse_filter = Control.MOUSE_FILTER_STOP if interactive else Control.MOUSE_FILTER_IGNORE
	r.z_index = z
	return r


## Hull at 0: alarm, long shake, white-red flash, then the Boarding scene over the paused battle.
func _on_breach() -> void:
	if _breaching or _ending:
		return
	_breaching = true
	_hide_explanation()
	_close_pause()
	Sfx.breach_alarm()
	_camera.shake(BREACH_MS, 0.009)
	var white := _full_rect(UiTheme.WHITE, 0.85, UiTheme.DEPTH.overlay - 4)
	var red := _full_rect(UiTheme.DANGER, 0.0, UiTheme.DEPTH.overlay - 5)
	add_child(white)
	add_child(red)
	var edge := PImage.make(self, CX, H / 2.0, Tex.VIGNETTE)
	edge.set_display_size(UiTheme.GAME_WIDTH, H)
	edge.set_tint(UiTheme.DANGER)
	edge.z_index = UiTheme.DEPTH.overlay - 6
	edge.set_alpha(0)
	_breach_fx = [white, red, edge]
	PTween.add(white, {"alpha": 0.0}, 260, "Quad.easeOut")
	red.modulate.a = 1.0
	PTween.add(red, {"alpha": 0.35}, 300, "Linear", {"yoyo": true, "repeat": 2})
	PTween.add(edge, {"alpha": 1.0}, 500, "Linear")
	_dash.flicker(BREACH_MS)
	PTween.delayed_call(self, BREACH_MS, _launch_boarding)


func _launch_boarding() -> void:
	if _ending or not is_inside_tree():
		return
	for o in _breach_fx:
		if is_instance_valid(o):
			o.queue_free()
	_breach_fx = []
	var s := sim.state
	var d := {
		"facts": sim.boarding_facts(),
		"seed": int(sim.config.seed + 7919 * (s.boardings + 1)) % 0x7fffffff,
		"speed_scale": _speed_scale,
		"density": sim.config.density,
		"on_done": _on_boarding_done,
	}
	if _dev.has("boarding"):
		d.dev = _dev.boarding
	if _dev.get("keypad", false):
		d.dev = d.get("dev", {}).duplicate()
		d.dev.keypad = true
	_pause_for_overlay()
	App.launch("boarding", d)


## Boarding finished: resolve it in the sim, resume, and end the mission if the ship was lost.
func _on_boarding_done(result: Dictionary) -> void:
	_breaching = false
	var events := sim.resolve_boarding(result)
	_quiet_resume = true
	App.resume_scene(scene_name)
	handle_events(events)


func _on_mission_end(won: bool) -> void:
	if _ending:
		return
	_ending = true
	_hide_explanation()
	_close_pause()
	if won:
		Sfx.win()
	else:
		Sfx.lose()
	_show_banner(App.t("battle.banner.won" if won else "battle.banner.lost"), END_BANNER_MS, UiTheme.OK if won else UiTheme.DANGER)
	PTween.delayed_call(self, END_BANNER_MS, func() -> void: _finish_mission(won))


func _finish_mission(won: bool) -> void:
	var s := sim.state
	var credits := Economy.mission_credits({
		"score": s.score, "won": won, "domes_standing": sim.domes_standing(),
		"salvage_tier": sim.upgrade_effects().salvage_tier,
	})
	var mastery_before := Mastery.planet_mastery(planet_id, App.save)
	App.save = Save.apply_mission(App.save, {
		"planet_id": planet_id, "records": sim.records, "credits": credits, "score": s.score, "won": won,
		"accuracy": sim.accuracy(), "now": App.now_ms(),
	})
	App.persist()
	var mastery_after := Mastery.planet_mastery(planet_id, App.save)
	App.goto("results", {
		"planet_id": planet_id,
		"won": won,
		"score": s.score,
		"credits": credits,
		"missed": s.missed.duplicate(),
		"accuracy": sim.accuracy(),
		"best_streak": s.best_streak,
		"mastery_before": mastery_before,
		"mastery_after": mastery_after,
	})


func _nearest_station(x: float) -> int:
	var best := 0
	for i in Battle.DOME_X.size():
		if absf(Battle.DOME_X[i] - x) < absf(Battle.DOME_X[best] - x):
			best = i
	return best


## Small amber number that rises and fades (points for a kill).
func _float_number(x: float, y: float, text: String) -> void:
	var label := PText.make(self, x, y, text, TextStyles.numeral({"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.PRIMARY)}))
	label.set_origin(0.5)
	label.z_index = UiTheme.DEPTH.fx + 1
	PTween.add(label, {"y": y - 26, "alpha": 0.0}, 800, "Cubic.easeOut", {"on_complete": label.queue_free})


# ---------------------------------------------------------------- overlays

func _show_explanation(fact: Dictionary) -> void:
	_hide_explanation()
	_explain_dim = _full_rect(UiTheme.BG, 0.4, UiTheme.DEPTH.overlay - 20)
	_explain_dim.modulate.a = 0
	add_child(_explain_dim)
	PTween.add(_explain_dim, {"alpha": 1.0}, 200, "Linear")
	_explain_card = ExplanationCard.new(self, CX, 300, fact, App.i18n)
	_explain_card.z_index = UiTheme.DEPTH.overlay - 10
	_explain_card.scale = Vector2.ONE * 0.94
	_explain_card.modulate.a = 0
	PTween.add(_explain_card, {"alpha": 1.0, "scale": 1.0}, 200, "Quad.easeOut")


func _hide_explanation() -> void:
	for obj in [_explain_dim, _explain_card]:
		if obj == null or not is_instance_valid(obj):
			continue
		PTween.kill_tweens_of(obj)
		PTween.add(obj, {"alpha": 0.0}, 180, "Linear", {"on_complete": obj.queue_free})
	_explain_dim = null
	_explain_card = null


func _show_wave_banner() -> void:
	# Sometimes the enemy is heard talking as a wave begins.
	if randf() < 0.4:
		PTween.delayed_call(self, _random_from(1200, 2800), func() -> void: Sfx.alien_chatter())
	_show_banner(App.t("battle.banner.wave", {"wave": sim.state.wave}), WAVE_BANNER_MS, UiTheme.PRIMARY)


## One or two words in small caps between two hairlines.
func _show_banner(text: String, duration_ms: float, color: int) -> void:
	var banner := Node2D.new()
	banner.position = Vector2(CX, BANNER_Y)
	banner.z_index = UiTheme.DEPTH.overlay - 5
	banner.modulate.a = 0
	var label := PText.new(text.to_upper(), TextStyles.caps({
		"font_size": UiTheme.SIZES.heading, "color": UiTheme.css(color), "letter_spacing": UiTheme.LETTER_SPACING.wide,
	}))
	label.set_origin(0.5)
	var half := label.width / 2.0 + 18
	var g := PGraphics.new()
	g.line_style(UiTheme.LINE_WIDTH, color, 0.8)
	g.line_between(-half - 70, 0.5, -half, 0.5)
	g.line_between(half, 0.5, half + 70, 0.5)
	banner.add_child(g)
	banner.add_child(label)
	add_child(banner)
	var fade := minf(220.0, duration_ms / 4.0)
	PTween.add(banner, {"alpha": 1.0}, fade, "Linear")
	PTween.add(banner, {"alpha": 0.0}, fade, "Linear", {"delay": duration_ms - fade, "on_complete": banner.queue_free})


func _toggle_pause() -> void:
	if _paused:
		_close_pause()
		return
	var phase: String = sim.state.phase
	if _ending or (phase != "spawning" and phase != "explaining"):
		return
	_paused = true
	var cy := H / 2.0 - 40
	var overlay := Node2D.new()
	overlay.z_index = UiTheme.DEPTH.overlay
	overlay.add_child(_full_rect(UiTheme.BG, 0.7, 0, true))
	var title := PText.make(overlay, CX, cy - 50, App.t("battle.pause.title").to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.heading, "letter_spacing": UiTheme.LETTER_SPACING.wide}))
	title.set_origin(0.5)
	UiButton.new(overlay, CX, cy + 6, App.t("battle.pause.resume"), _close_pause, {"width": 180, "height": 36})
	UiButton.new(overlay, CX, cy + 54, App.t("battle.pause.abandon"), func() -> void: App.goto("star_map"),
		{"width": 180, "height": 36, "variant": "ghost"})
	add_child(overlay)
	_pause_overlay = overlay


func _close_pause() -> void:
	_paused = false
	if _pause_overlay != null and is_instance_valid(_pause_overlay):
		_pause_overlay.queue_free()
	_pause_overlay = null


# ---------------------------------------------------------------- rendering

func _render_state() -> void:
	var s := sim.state

	# Enemies follow the sim, mapped onto the stations and scaled with depth; the lowest draws on top.
	var alive := {}
	var items: Array = []
	for e in s.enemies:
		alive[e.id] = true
		var ship := _ensure_ship(e)
		ship.set_ship_size(BattleLayout.ship_size(e.y))
		ship.position = Vector2(e.x, BattleLayout.ship_screen_y(e.y))
		ship.set_threat(threat_of(e.y))
		ship.set_charge(e.charge if e.armed else null, BattleLayout.COCKPIT)
		ship.set_meta("sim_y", float(e.y))
		items.append({
			"id": e.id, "x": ship.position.x, "y": ship.position.y, "ship_half_w": ship.ship_half_width,
			"ship_half_h": ship.ship_half_height, "tag_w": ship.tag_width, "tag_h": ship.tag_height,
		})
	for id in _ships.keys():
		if not alive.has(id):
			_remove_ship(id)
	_sort_ships()
	_tag_sides = BattleLayout.layout_tags(items, _tag_sides)
	for id in _tag_sides.keys():
		var ship: EnemyShip = _ships.get(id)
		if ship != null:
			ship.set_tag_side(_tag_sides[id])

	for i in s.domes.size():
		_stations[i].set_hp(s.domes[i].hp, s.domes[i].max_hp)

	_dash.set_wave(s.wave, s.total_waves)
	_dash.set_score(s.score)
	_dash.set_streak(s.streak)
	_dash.set_stations(s.domes)
	_dash.set_hull(s.hull, s.hull_max)
	var input: String = s.input
	var shown := I18n.MINUS + input.substr(1) if input.begins_with("-") else input
	var blink_on := int(floorf(Time.get_ticks_msec() / 500.0)) % 2 == 0
	_dash.set_input(shown, blink_on and s.phase == "spawning" and not _paused and not _ending)


## Phaser depth DEPTH.enemies + y / 1000: ships further down draw on top (stable for equal y).
func _sort_ships() -> void:
	var kids := _ship_layer.get_children()
	var sorted := Js.sorted(kids, func(a, b) -> float: return float(a.get_meta("sim_y", 0.0)) - float(b.get_meta("sim_y", 0.0)))
	for i in sorted.size():
		if kids[i] != sorted[i]:
			for j in sorted.size():
				_ship_layer.move_child(sorted[j], j)
			return


# ---------------------------------------------------------------- dev script (debug builds)

## Pushes a key press (and release) into the viewport: the same path as the keyboard.
func _dev_key(keycode: int, unicode: int = 0) -> void:
	for pressed in [true, false]:
		var ev := InputEventKey.new()
		ev.keycode = keycode as Key
		ev.physical_keycode = keycode as Key
		ev.unicode = unicode
		ev.pressed = pressed
		get_viewport().push_input(ev)


func _dev_type(value: int) -> void:
	var text := str(value)
	for ch in text:
		if ch == "-":
			_dev_key(KEY_MINUS, "-".unicode_at(0))
		else:
			_dev_key(KEY_0 + ch.to_int(), ch.unicode_at(0))
	_dev_key(KEY_ENTER)


func _dev_lowest() -> Variant:
	var lowest = null
	for e in sim.state.enemies:
		if lowest == null or e.y > lowest.y:
			lowest = e
	return lowest


func _dev_once(key: String) -> bool:
	if not _dev.has(key) or _dev_done.has(key) or _dev_ms < float(_dev[key]):
		return false
	return true


func _dev_step(dt: float) -> void:
	if _paused or _ending:
		return
	_dev_ms += dt
	var lowest = _dev_lowest()
	if _dev_once("breach_at_ms") and dev_force_breach():
		_dev_done.breach_at_ms = true
	if _dev_once("wrong_at_ms") and lowest != null and _accepts_input():
		_dev_done.wrong_at_ms = true
		_dev_type(lowest.fact.answer + 1)
	if _dev_once("impact_at_ms") and lowest != null and sim.state.phase == "spawning":
		_dev_done.impact_at_ms = true
		lowest.y = Battle.IMPACT_Y - 0.5
	if _dev_once("arm_at_ms") and lowest != null and sim.state.phase == "spawning":
		_dev_done.arm_at_ms = true
		lowest.armed = true
		lowest.charge = maxf(lowest.charge, 0.82)
		lowest.y = maxf(lowest.y, Battle.FIRE_LINE_Y + 40)
	if _dev_once("wreck_at_ms") and lowest != null and sim.state.phase == "spawning":
		_dev_done.wreck_at_ms = true
		var dome: Dictionary = sim.state.domes[sim._dome_to_hit(lowest.x)]
		dome.hp = 1
		lowest.y = Battle.IMPACT_Y - 0.5
	if _dev.has("autoplay_ms") and lowest != null and _accepts_input() and sim.state.phase == "spawning":
		_dev_next_answer -= dt
		if _dev_next_answer <= 0:
			_dev_next_answer = float(_dev.autoplay_ms)
			_dev_type(lowest.fact.answer)


# ---------------------------------------------------------------- teardown

func shutdown() -> void:
	Sfx.stop_ambience(1.5)
	if _starfield != null:
		_starfield.destroy()
	_starfield = null
	_bg = null
	_ships.clear()
	_tag_sides.clear()
	for st in _stations:
		st.destroy()
	_stations = []
	_explain_dim = null
	_explain_card = null
	_pause_overlay = null
	_breach_fx = []
	if App.scene("upgrade") != null:
		App.stop("upgrade")
	if App.scene("boarding") != null:
		App.stop("boarding")
