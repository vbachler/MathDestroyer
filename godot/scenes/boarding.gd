extends GameScene
## Port of src/scenes/BoardingScene.ts: boarding fight, launched over the paused Battle when the
## hull is breached. Crawlers come out of the far door of the hangar (`bg_hangar`) and scuttle at
## the player in one-point perspective; a correct answer fires both guns at the nearest matching
## crawler. A crawler that reaches the guns bites (three bites and the ship is lost).
## Data (TS BoardingSceneData): {facts, seed, speed_scale, density, on_done: Callable(result)};
## on_done runs once when the fight ends (the scene stops itself right before it).
## Everything is drawn in its own CanvasLayer (layer 1) so the overlay's depths sit above Battle's.
## Dev only (debug builds): data "dev" {"autoplay_ms": t, "keypad": true} answers through key events.

const CX := UiTheme.GAME_WIDTH / 2.0
const H := UiTheme.GAME_HEIGHT
const MAX_FRAME_MS := 100.0
const TITLE_Y := 236.0
const TITLE_MS := 1100.0
const REPELLED_MS := 1400.0
const OVERRUN_MS := 1300.0
const WRONG_SOUND_DELAY_MS := 200.0
const BEACON_PERIOD_MS := 1300.0
## Darkness over the hangar: base level, and the depth of a failing-light dip.
const DARK_BASE := 0.1
const DARK_DIP := 0.55
const PIP_W := 16.0
const PIP_H := 5.0
const PIP_GAP := 6.0

var sim: BoardingSim
var _on_done: Callable = Callable()
var _layer: CanvasLayer
## The scene's world (inside the layer): every object of the scene.
var _world: Node2D
var _bodies: Node2D
var _tags: Node2D
var _crawlers := {}
var _tag_sides := {}
var _dark: ColorRect = null
var _wash: ColorRect = null
var _beacons: Array = []
var _lamps: LampFlicker = null
var _guns: HangarGuns = null
var _camera: CameraFx
## Scene clock of the last lamp crackle (sound rationed by crackle_gate).
var _crackle_at := -INF
var _input_text: PText
var _caret: PGraphics
var _pips: PGraphics
var _pip_sig := ""
var _pause_overlay: Node2D = null
var _paused := false
var _finished := false
var _clock_ms := 0.0
var _dip_ms := 0.0
var _skitter_ms := 0.0
var _paused_tweens: Array = []

var _dev: Dictionary = {}
var _dev_next_answer := 0.0


func create(d: Dictionary) -> void:
	sim = BoardingSim.new({"facts": d.facts, "seed": d.seed, "speed_scale": d.speed_scale, "density": d.get("density", 1.0)})
	_on_done = d.get("on_done", Callable())
	if OS.is_debug_build():
		_dev = d.get("dev", {})

	_layer = CanvasLayer.new()
	_layer.layer = 1
	add_child(_layer)
	_world = Node2D.new()
	_layer.add_child(_world)
	_camera = CameraFx.new(_layer)
	add_child(_camera)

	# Camera background (Phaser setBackgroundColor) over the paused battle.
	var bg := _full_rect(UiTheme.BG, 1.0, UiTheme.DEPTH.background - 1)
	_world.add_child(bg)
	_build_hangar()
	_bodies = Node2D.new()
	_bodies.z_index = UiTheme.DEPTH.enemies
	_world.add_child(_bodies)
	_guns = HangarGuns.new(_world)
	_tags = Node2D.new()
	_tags.z_index = UiTheme.DEPTH.enemies + 8
	_world.add_child(_tags)
	_build_lights()
	_build_readout()
	_build_pause_glyph()
	_build_keypad()

	_camera.fade_in(350, Color.BLACK)
	Sfx.screech(0.5)
	Sfx.start_hangar()
	_show_banner(App.t("battle.boarding"), TITLE_MS, UiTheme.DANGER)
	_render_hud()


func update(delta_ms: float) -> void:
	var dt := minf(delta_ms, MAX_FRAME_MS)
	var live := not _paused and not _finished
	if live:
		_handle_events(sim.step(dt))
	_clock_ms += dt
	_animate_lights(dt)
	if _lamps != null:
		_lamps.update(0.0 if _paused else dt)
	_render_crawlers(dt if live else 0.0)
	var nearest := _nearest_crawler()
	if _guns != null:
		_guns.update(0.0 if _paused else dt, nearest.centre if nearest != null else null)
	_render_hud()
	_play_skitter(dt if live else 0.0)
	if not _dev.is_empty() and live:
		_dev_step(dt)


# ---------------------------------------------------------------- building

## Phaser rectangle over the whole view: `fill_alpha` is the fill, the node alpha (modulate) the object alpha.
func _full_rect(color: int, fill_alpha: float, z: int, interactive: bool = false) -> ColorRect:
	var r := ColorRect.new()
	r.size = Vector2(UiTheme.GAME_WIDTH, H)
	r.color = UiTheme.color(color, fill_alpha)
	r.mouse_filter = Control.MOUSE_FILTER_STOP if interactive else Control.MOUSE_FILTER_IGNORE
	r.z_index = z
	return r


func _add_blend(node: CanvasItem) -> void:
	node.material = ParticleBurst.add_material()


func _build_hangar() -> void:
	if Assets.has_image(Assets.IMG.bg.hangar):
		var img := PImage.make(_world, CX, H / 2.0, Assets.IMG.bg.hangar)
		img.z_index = UiTheme.DEPTH.background
		img.scale = Vector2.ONE * maxf(UiTheme.GAME_WIDTH / float(img.texture.get_width()), H / float(img.texture.get_height()))
		# Failing strip lights painted into the picture: just above it, below beacons and crawlers.
		# Only now and then a flash crackles (crackle_gate): on every one it would be too much.
		_lamps = LampFlicker.new(_world, BoardingLayout.SPARK_LAMPS, UiTheme.DEPTH.background + 1, _on_lamp_flash)
		return
	# Fallback: a dark corridor in the same perspective and the door (the guns are HangarGuns).
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.background
	_world.add_child(g)
	g.fill_style(0x07090c, 1)
	g.fill_rect(0, 0, UiTheme.GAME_WIDTH, H)
	g.fill_style(0x0d1117, 1)
	g.fill_rect(0, BoardingLayout.DOOR_Y, UiTheme.GAME_WIDTH, H - BoardingLayout.DOOR_Y)
	g.fill_style(0x6f8aa6, 0.35)
	g.fill_rect(550, 240, 180, BoardingLayout.DOOR_Y - 240)
	g.line_style(UiTheme.LINE_WIDTH, 0x3a4654, 0.8)
	for i in range(-8, 9):
		g.line_between(CX + i * 11, BoardingLayout.DOOR_Y, CX + i * 160, H)
	for k in range(1, 9):
		var y := BoardingLayout.HORIZON_Y + (H - BoardingLayout.HORIZON_Y) * pow(k / 8.0, 2)
		if y > BoardingLayout.DOOR_Y:
			g.line_between(0, y, UiTheme.GAME_WIDTH, y)


func _on_lamp_flash(lamp: Dictionary) -> void:
	if not BoardingLayout.crackle_gate(_clock_ms, _crackle_at, randf()):
		return
	_crackle_at = _clock_ms
	Sfx.spark_crackle(0.5 + 0.5 * lamp.size)


func _build_lights() -> void:
	for p in BoardingLayout.BEACONS:
		var b := PImage.make(_world, p.x, p.y, Tex.GLOW)
		b.set_tint(UiTheme.DANGER)
		_add_blend(b)
		b.z_index = UiTheme.DEPTH.world
		b.scale = Vector2.ONE * 0.5
		_beacons.append(b)
	# (Phaser rectangles: the wash has fill alpha 0, so like the TS it does not show; the darkness
	# is fill 0.1 times the object alpha set every frame.)
	_wash = _full_rect(UiTheme.DANGER, 0.0, UiTheme.DEPTH.fx + 4)
	_add_blend(_wash)
	_world.add_child(_wash)
	_dark = _full_rect(0x000000, DARK_BASE, UiTheme.DEPTH.fx + 5)
	_world.add_child(_dark)


func _build_readout() -> void:
	var r := BoardingLayout.READOUT
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.hud
	_world.add_child(g)
	g.fill_style(UiTheme.PLATE, 0.78)
	g.fill_rect(r.x, r.y, r.w, r.h)
	UiPanel.draw_brackets(g, r.x, r.y, r.w, r.h, UiTheme.PRIMARY, 0.8, 7)
	_input_text = PText.make(_world, CX, r.y + r.h / 2.0, "", TextStyles.numeral({
		"font_size": UiTheme.SIZES.input, "color": UiTheme.css(UiTheme.PRIMARY),
		"shadow": {"x": 0, "y": 0, "color": UiTheme.css(UiTheme.PRIMARY), "blur": 6, "fill": true},
	}))
	_input_text.set_origin(0.5)
	_input_text.z_index = UiTheme.DEPTH.hud + 1
	_caret = PGraphics.new()
	_caret.fill_style(UiTheme.PRIMARY, 1)
	_caret.fill_rect(0, -1.5, 12, 3)
	_caret.position = Vector2(CX, r.y + r.h - 9)
	_caret.z_index = UiTheme.DEPTH.hud + 1
	_world.add_child(_caret)
	_pips = PGraphics.new()
	_pips.z_index = UiTheme.DEPTH.hud + 1
	_world.add_child(_pips)


func _build_pause_glyph() -> void:
	var r := BattleLayout.PAUSE_RECT
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.hud
	_world.add_child(g)
	g.fill_style(UiTheme.BG, 0.35)
	g.fill_rect(r.x, r.y, r.w, r.h)
	UiPanel.draw_brackets(g, r.x, r.y, r.w, r.h, UiTheme.PRIMARY, 0.75, 7)
	g.fill_style(UiTheme.PRIMARY, 0.9)
	g.fill_rect(r.x + r.w / 2 - 6, r.y + 11, 4, r.h - 22)
	g.fill_rect(r.x + r.w / 2 + 2, r.y + 11, 4, r.h - 22)
	var zone := HitZone.add(_world, r.x + r.w / 2, r.y + r.h / 2, r.w + 12, r.h + 12, _toggle_pause)
	zone.get_parent().z_index = UiTheme.DEPTH.hud


func _build_keypad() -> void:
	var show: bool = App.save.settings.keypad_always_visible or DisplayServer.is_touchscreen_available() \
		or _dev.get("keypad", false)
	if not show:
		return
	var pad := Keypad.new(_world, {
		"on_digit": _pad_digit, "on_sign": _pad_sign, "on_backspace": _pad_backspace, "on_fire": _fire,
	}, {"fire_label": App.t("battle.keypad.fire"), "digits": BattleLayout.KEYPAD_DIGITS,
		"fire": BattleLayout.KEYPAD_FIRE, "gap": BattleLayout.KEY_GAP})
	pad.z_index = UiTheme.DEPTH.hud


# ---------------------------------------------------------------- input

func _accepts_input() -> bool:
	return not _paused and not _finished


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
	_handle_events(sim.submit())


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed or _finished:
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

func _handle_events(events: Array) -> void:
	for ev in events:
		match ev.type:
			"spawn":
				_on_spawn(ev.crawler)
			"kill":
				_on_kill(ev.crawler)
			"wrong":
				_on_wrong()
			"bite":
				_on_bite(ev.crawler)
			"repelled":
				_on_repelled()
			"overrun":
				_on_overrun()


func _ensure_crawler(c: Dictionary) -> Crawler:
	var v: Crawler = _crawlers.get(c.id)
	if v == null:
		# Walk-cycle rate follows the approach speed (z per second relative to a speed-1 crawler).
		v = Crawler.new(_bodies, _tags, c.id, c.kind, Facts.format_problem(c.fact, App.i18n.locale),
			c.speed / (1000.0 / Boarding.APPROACH_MS))
		v.follow(0, c.z, c.lane)
		_crawlers[c.id] = v
	return v


func _on_spawn(c: Dictionary) -> void:
	_ensure_crawler(c)
	if randf() < 0.45:
		PTween.delayed_call(self, randi_range(150, 600), func() -> void: Sfx.screech(0.35))


## Both barrels snap onto `to`, kick back and fire from their rotated muzzle tips.
func _fire_guns(to: Dictionary, miss: bool) -> void:
	if _guns != null:
		for m in _guns.fire(to):
			BattleFx.beam(_world, m, to, UiTheme.PRIMARY, {"width": 0.6, "fade_into": miss})
			BattleFx.flash(_world, m.x, m.y, UiTheme.PRIMARY, 46, 160)
	Sfx.turret_shot()


## The crawler view nearest the guns (smallest z), or null.
func _nearest_crawler() -> Crawler:
	var nearest: Crawler = null
	for v in _crawlers.values():
		if nearest == null or v.depth_z < nearest.depth_z:
			nearest = v
	return nearest


func _on_kill(c: Dictionary) -> void:
	var v: Crawler = _crawlers.get(c.id)
	var p: Dictionary = v.centre if v != null else {"x": CX, "y": BoardingLayout.DOOR_Y}
	var size := maxf(28.0, (v.half_width if v != null else 14.0) * 1.6)
	_fire_guns(p, false)
	BattleFx.ship_explosion(_world, p.x, p.y, size, UiTheme.PRIMARY)
	BattleFx.sparks(_world, p.x, p.y, UiTheme.DANGER, 10, 40 + size)
	if v != null:
		v.destroy()
	_crawlers.erase(c.id)
	_tag_sides.erase(c.id)
	PTween.delayed_call(self, 60, func() -> void: Sfx.hit())


func _on_wrong() -> void:
	var nearest := _nearest_crawler()
	var aim := BoardingLayout.boarding_miss_point(nearest.centre if nearest != null else null, randf())
	_fire_guns(aim, true)
	PTween.delayed_call(self, WRONG_SOUND_DELAY_MS, func() -> void: Sfx.wrong())
	var t := _input_text
	PTween.kill_tweens_of(t)
	t.position.x = CX
	PTween.add(t, {"x": CX + 5}, 40, "Linear", {"yoyo": true, "repeat": 3, "on_complete": func() -> void: t.position.x = CX})


func _on_bite(c: Dictionary) -> void:
	var v: Crawler = _crawlers.get(c.id)
	_crawlers.erase(c.id)
	_tag_sides.erase(c.id)
	Sfx.bite()
	if v != null:
		v.lunge(_bite_hit)
	else:
		_bite_hit()


func _bite_hit() -> void:
	var red := _full_rect(UiTheme.DANGER, 0.75, UiTheme.DEPTH.overlay - 5)
	_world.add_child(red)
	PTween.add(red, {"alpha": 0.0}, 520, "Quad.easeIn", {"on_complete": red.queue_free})
	_vignette(0.95, 900)
	_camera.shake(450, 0.02)


func _on_repelled() -> void:
	Sfx.stop_hangar(REPELLED_MS / 1000.0)
	_show_banner(App.t("battle.banner.waveCleared"), REPELLED_MS, UiTheme.OK)
	PTween.delayed_call(self, REPELLED_MS, func() -> void: _finish(true))


func _on_overrun() -> void:
	_close_pause()
	Sfx.stop_hangar(OVERRUN_MS / 1000.0)
	var black := _full_rect(0x000000, 1.0, UiTheme.DEPTH.overlay + 5)
	black.modulate.a = 0
	_world.add_child(black)
	PTween.add(black, {"alpha": 1.0}, OVERRUN_MS - 450, "Linear", {"delay": 450})
	PTween.delayed_call(self, OVERRUN_MS, func() -> void: _finish(false))


func _finish(repelled: bool) -> void:
	var done := _on_done
	if done.is_null():
		return
	_on_done = Callable()
	_finished = true
	var result := {"repelled": repelled, "records": sim.records.duplicate(), "kills": sim.state.kills}
	App.stop(scene_name)
	done.call(result)


# ---------------------------------------------------------------- rendering

func _render_crawlers(dt: float) -> void:
	var alive := {}
	var items: Array = []
	for c in sim.state.crawlers:
		alive[c.id] = true
		var v := _ensure_crawler(c).follow(dt, c.z, c.lane)
		var ctr := v.centre
		items.append({
			"id": c.id, "x": ctr.x, "y": ctr.y, "ship_half_w": v.half_width, "ship_half_h": v.half_height,
			"tag_w": v.tag_width, "tag_h": v.tag_height,
		})
	for id in _crawlers.keys():
		if alive.has(id):
			continue
		_crawlers[id].destroy()
		_crawlers.erase(id)
		_tag_sides.erase(id)
	_sort_layers()
	_tag_sides = BattleLayout.layout_tags(items, _tag_sides)
	for id in _tag_sides.keys():
		var v: Crawler = _crawlers.get(id)
		if v != null:
			v.set_tag_side(_tag_sides[id])


## Phaser depths DEPTH.enemies + depth_order * 5 (bodies) and + 8 + depth_order (tags): nearer on top.
func _sort_layers() -> void:
	var list: Array = []
	for v in _crawlers.values():
		if not v._lunging:
			list.append(v)
	list = Js.sorted(list, func(a, b) -> float: return a.sort_depth - b.sort_depth)
	for i in list.size():
		var v: Crawler = list[i]
		if v.get_index() != i:
			_bodies.move_child(v, i)
		if v.tag_layer.get_index() != i:
			_tags.move_child(v.tag_layer, i)


func _render_hud() -> void:
	var s := sim.state
	var input: String = s.input
	var shown := I18n.MINUS + input.substr(1) if input.begins_with("-") else input
	if _input_text.text != shown:
		_input_text.set_text(shown)
	var blink_on := int(floorf(Time.get_ticks_msec() / 500.0)) % 2 == 0
	_caret.position.x = CX - 6 if shown.length() == 0 else _input_text.position.x + _input_text.width / 2.0 + 3
	_caret.visible = blink_on and s.phase == "fighting" and _accepts_input()

	var left := maxi(0, s.max_bites - s.bites)
	var sig := "%d/%d" % [left, s.max_bites]
	if sig == _pip_sig:
		return
	_pip_sig = sig
	var g := _pips
	g.clear()
	var row_w: float = s.max_bites * PIP_W + (s.max_bites - 1) * PIP_GAP
	var x0 := CX - row_w / 2.0
	var y: float = BoardingLayout.READOUT.y - 12
	for i in s.max_bites:
		var x: float = x0 + i * (PIP_W + PIP_GAP)
		if i < left:
			g.fill_style(UiTheme.DANGER if left == 1 else UiTheme.PRIMARY, 0.95)
			g.fill_rect(x, y, PIP_W, PIP_H)
		else:
			g.line_style(UiTheme.LINE_WIDTH, UiTheme.DANGER, 0.85)
			g.stroke_rect(x + 0.5, y + 0.5, PIP_W - 1, PIP_H - 1)


## Failing lights: a steady gloom with sudden dips, and the red lamps pulsing.
func _animate_lights(dt: float) -> void:
	if _dip_ms > 0:
		_dip_ms -= dt
	elif randf() < dt / 2600.0:
		_dip_ms = randi_range(40, 160)
	var dip := DARK_DIP * (0.6 + 0.4 * randf()) if _dip_ms > 0 else 0.0
	if _dark != null:
		_dark.modulate.a = DARK_BASE + dip + 0.03 * sin(_clock_ms * 0.031)
	var pulse := 0.5 + 0.5 * sin((_clock_ms / BEACON_PERIOD_MS) * PI * 2.0)
	var p3 := pulse * pulse * pulse
	for b in _beacons:
		b.set_alpha(0.25 + 0.75 * p3)
		b.scale = Vector2.ONE * (0.35 + 0.35 * p3)
	if _wash != null:
		_wash.modulate.a = 0.07 * p3


## Skitter on the deck: louder and denser the closer the nearest crawler. Also drives the dread music.
func _play_skitter(dt: float) -> void:
	var near_z := INF
	for c in sim.state.crawlers:
		near_z = minf(near_z, c.z)
	var level := BoardingLayout.approach(near_z) if near_z != INF else 0.0
	Sfx.set_tension(level if dt > 0 else 0.0)
	if dt <= 0 or level <= 0:
		return
	_skitter_ms -= dt
	if _skitter_ms > 0:
		return
	_skitter_ms = 380 - 240 * level
	Sfx.skitter(0.15 + 0.85 * level)


func _vignette(peak: float, duration_ms: float) -> void:
	var v := PImage.make(_world, CX, H / 2.0, Tex.VIGNETTE)
	v.set_display_size(UiTheme.GAME_WIDTH, H)
	v.set_tint(UiTheme.DANGER)
	v.z_index = UiTheme.DEPTH.overlay - 6
	v.set_alpha(peak)
	PTween.add(v, {"alpha": 0.0}, duration_ms, "Quad.easeIn", {"on_complete": v.queue_free})


## One word in small caps between two hairlines.
func _show_banner(text: String, duration_ms: float, color: int) -> void:
	var banner := Node2D.new()
	banner.position = Vector2(CX, TITLE_Y)
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
	_world.add_child(banner)
	var fade := minf(220.0, duration_ms / 4.0)
	PTween.add(banner, {"alpha": 1.0}, fade, "Linear")
	PTween.add(banner, {"alpha": 0.0}, fade, "Linear", {"delay": duration_ms - fade, "on_complete": banner.queue_free})


# ---------------------------------------------------------------- pause

## Phaser tweens.pauseAll / resumeAll: every PTween of this scene's objects (timers keep running).
func _set_tweens_paused(on: bool) -> void:
	if on:
		_paused_tweens = []
		var stack: Array = [_world]
		while not stack.is_empty():
			var n: Node = stack.pop_back()
			for t in n.get_meta("_ptweens", []):
				if is_instance_valid(t) and t.is_valid() and t.is_running():
					t.pause()
					_paused_tweens.append(t)
			stack.append_array(n.get_children())
	else:
		for t in _paused_tweens:
			if is_instance_valid(t) and t.is_valid():
				t.play()
		_paused_tweens = []


func _toggle_pause() -> void:
	if _paused:
		_close_pause()
		return
	if _finished or sim.state.phase != "fighting":
		return
	_paused = true
	_set_tweens_paused(true)
	Sfx.stop_hangar(0.5)
	var cy := H / 2.0 - 40
	var overlay := Node2D.new()
	overlay.z_index = UiTheme.DEPTH.overlay + 10
	overlay.add_child(_full_rect(UiTheme.BG, 0.7, 0, true))
	var title := PText.make(overlay, CX, cy - 50, App.t("battle.pause.title").to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.heading, "letter_spacing": UiTheme.LETTER_SPACING.wide}))
	title.set_origin(0.5)
	UiButton.new(overlay, CX, cy + 6, App.t("battle.pause.resume"), _close_pause, {"width": 180, "height": 36})
	UiButton.new(overlay, CX, cy + 54, App.t("battle.pause.abandon"), _abandon, {"width": 180, "height": 36, "variant": "ghost"})
	_world.add_child(overlay)
	_pause_overlay = overlay


func _close_pause() -> void:
	if _paused:
		_set_tweens_paused(false)
		if not _finished and sim.state.phase == "fighting":
			Sfx.start_hangar()
	_paused = false
	if _pause_overlay != null and is_instance_valid(_pause_overlay):
		_pause_overlay.queue_free()
	_pause_overlay = null


## Abort the mission from the boarding pause menu: same as Battle's abort (back to the map).
func _abandon() -> void:
	_finished = true
	_on_done = Callable()
	App.goto("star_map")


# ---------------------------------------------------------------- dev (debug builds)

func _dev_step(dt: float) -> void:
	if not _dev.has("autoplay_ms") or _paused:
		return
	_dev_next_answer -= dt
	if _dev_next_answer > 0:
		return
	_dev_next_answer = float(_dev.autoplay_ms)
	var nearest = null
	for c in sim.state.crawlers:
		if nearest == null or c.z < nearest.z:
			nearest = c
	if nearest == null:
		return
	for ch in str(nearest.fact.answer):
		var code: int = KEY_MINUS if ch == "-" else KEY_0 + ch.to_int()
		_dev_key(code, ch.unicode_at(0))
	_dev_key(KEY_ENTER)


func _dev_key(keycode: int, unicode: int = 0) -> void:
	for pressed in [true, false]:
		var ev := InputEventKey.new()
		ev.keycode = keycode as Key
		ev.physical_keycode = keycode as Key
		ev.unicode = unicode
		ev.pressed = pressed
		get_viewport().push_input(ev)


# ---------------------------------------------------------------- teardown

func shutdown() -> void:
	Sfx.set_tension(0)
	Sfx.stop_hangar(0.6)
	if _guns != null:
		_guns.destroy()
	_guns = null
	_crawlers.clear()
	_tag_sides.clear()
	_beacons = []
	if _lamps != null and is_instance_valid(_lamps):
		_lamps.destroy()
	_lamps = null
	_dark = null
	_wash = null
	_pause_overlay = null
	_paused = false
