extends GameScene
## Port of src/scenes/StarMapScene.ts: the star map: one scene, two views over bg_starmap. The
## galaxy view (sector clouds, star systems, the ship; drag, wheel, pinch, +/-) and the system view
## (sun, planets on orbits) where calls arrive one by one and open the call card; GO jumps to the
## mission (App.goto("ftl", {planet_id})). Opens straight in the system view of save.location.

## Jump across the map, ms.
const TRAVEL_MS := 1500.0
## Galaxy camera eases from the system out to the whole galaxy, ms.
const ZOOM_OUT_MS := 950.0
const FADE_MS := 420.0
const SETTLE_MS := 1000.0
## Zoom of the galaxy camera when it is close to one system (entering / leaving a system).
const CLOSE_ZOOM := 1.15
## Wheel distance (deltaY) of zooming out in the system view that returns to the galaxy.
const SYSTEM_ZOOM_OUT := 260.0
const WHEEL_RATE := 0.0013
## Browser wheel deltaY of one mouse wheel notch (Chrome / Edge on Windows: 100).
const WHEEL_NOTCH := 100.0
const KEY_ZOOM := 1.25
const INERTIA_DECAY := 0.9
const BG_OVERSCAN := 1.14
const BG_SHIFT_X := 70.0
const BG_SHIFT_Y := 40.0
const EDGE_INSET := 46.0
const EDGE_HIT := 44.0
const ANCHOR_CHECK_MS := 300.0
const GLYPH_BTN := 30.0
const HUD_Y := 30.0
## Minimum time between two bursts of alien chatter on the radio, ms.
const CHATTER_COOLDOWN_MS := 6000.0

const VIEW_W := MapLayout.VIEW_W
const VIEW_H := MapLayout.VIEW_H

## "system" | "galaxy" | "busy" | "leaving"
var mode := "system"
var galaxy: GalaxyView
var system_view: SystemView
var card: CallCard
var _bg: PImage = null
var _bg_scale := 1.0
var _bg_x := 0.0
var _bg_y := 0.0
var _toggle: GlyphButton
var _system_name: PText
var _sector_name: PText
var _edge: PGraphics
var _edge_zones: Array[Node2D] = []
var _edge_calls: Array = []
var _fade: FadeNode

var _pending: Array = []
var _delivered := 0
var _call_clock := 0.0
var _card_call = null
var _anchor_clock := 0.0
var _probe := {"x": 0.0, "y": 0.0, "r": 0.0}

var _press := {"active": false, "dragging": false, "start_x": 0.0, "start_y": 0.0, "last_x": 0.0, "last_y": 0.0, "last_t": 0.0}
var _vel_x := 0.0
var _vel_y := 0.0
var _pinch_dist := 0.0
var _touches := {}
var _system_zoom_out := 0.0
var _cam_tween: Tween = null
var _warp: WarpStreaks = null
var _hover_cursor := false
var _last_chatter := -INF


## Phaser camera fade: a black rectangle over everything.
class FadeNode extends Node2D:
	func _draw() -> void:
		draw_rect(Rect2(0, 0, UiTheme.GAME_WIDTH, UiTheme.GAME_HEIGHT), Color.BLACK)


func _now() -> float:
	return float(Time.get_ticks_msec())


func create(_data: Dictionary) -> void:
	mode = "system"
	_create_background()
	galaxy = GalaxyView.new(self)
	galaxy.set_sector_names(func(key: String) -> String: return App.t(key))
	galaxy.root.visible = false
	system_view = SystemView.new(self)
	_edge = PGraphics.new()
	_edge.z_index = UiTheme.DEPTH.hud - 1
	add_child(_edge)
	for i in MapLayout.MAX_PENDING_CALLS:
		var holder := Node2D.new()
		holder.z_index = UiTheme.DEPTH.hud - 1
		holder.visible = false
		add_child(holder)
		var zone := HitArea.new(EDGE_HIT, EDGE_HIT)
		holder.add_child(zone)
		var slot := i
		zone.up.connect(func(inside: bool, _touch: bool):
			var call = _edge_calls[slot]
			if inside and call != null and mode == "system":
				_open_card(call))
		_edge_zones.append(holder)
		_edge_calls.append(null)
	_create_hud()
	card = CallCard.new(self, func():
		if _card_call != null:
			_go(_card_call))

	_fade = FadeNode.new()
	_fade.z_index = 4000
	add_child(_fade)
	PTween.add(_fade, {"alpha": 0}, 350, "Linear")

	Sfx.start_ambience("map")
	_enter_system(_current_system(), true)
	# Dev hook (not in the TS): --data='{"galaxy": true}' opens the galaxy view for screenshots.
	if _data.get("galaxy", false):
		_enter_galaxy()


func shutdown() -> void:
	_set_hover_cursor(false)
	if card != null and is_instance_valid(card):
		card.silence()
	if _warp != null:
		_warp.destroy()
	_warp = null
	_cam_tween = null


func update(delta_ms: float) -> void:
	var time := _now()
	var dt := minf(delta_ms, 100)
	_update_inertia(dt)
	_update_background(time, dt)
	galaxy.update(time, dt)
	system_view.update(time, dt)
	if _warp != null:
		_warp.update(dt)

	if _system_zoom_out > 0:
		_system_zoom_out *= exp(-dt / 500.0)
		if mode == "system":
			var s := 1 - 0.12 * (_system_zoom_out / SYSTEM_ZOOM_OUT)
			system_view.root.scale = Vector2(s, s)

	if mode == "system" and not card.is_open() and _pending.size() < MapLayout.MAX_PENDING_CALLS:
		_call_clock -= dt
		if _call_clock <= 0:
			_deliver_call()
	if card.is_open():
		_anchor_clock -= dt
		if _anchor_clock <= 0:
			_anchor_clock = ANCHOR_CHECK_MS
			_keep_card_clear()
	_draw_edge_markers(time)

# ------------------------------------------------------------------ views

func _current_system() -> Dictionary:
	var s = Content.system_by_id(App.save.location.system_id)
	return s if s != null else Content.systems()[0]


## Shows the system view of `system`; `settle` plays the gentle arrival (scene entry, after a jump).
func _enter_system(system: Dictionary, settle: bool) -> void:
	var now := App.now_ms()
	mode = "system"
	galaxy.set_location(system.id)
	if system_view.system_id() != system.id:
		system_view.show(system, App.save, now)
	else:
		system_view.refresh(App.save, now)
	system_view.set_calls(_pending)
	_toggle.set_glyph(MapGlyphs.draw_galaxy_glyph)
	_set_hover_cursor(false)
	galaxy.set_hover(-1)

	var sector = Content.sector_by_id(system.sector_id)
	_system_name.set_text(str(system.name).to_upper())
	_system_name.visible = true
	_sector_name.set_text(App.t(sector.name_key).to_upper() if sector != null else "")
	_sector_name.visible = true
	_sector_name.set_color(MapPalette.css_color(MapPalette.sector_colors(sector.hue).label) if sector != null else UiTheme.css(UiTheme.TEXT_DIM))

	var root := system_view.root
	root.visible = true
	_system_zoom_out = 0
	if settle:
		root.modulate.a = 0
		root.scale = Vector2(1.07, 1.07)
		PTween.add(root, {"alpha": 1, "scale": 1.0}, SETTLE_MS, "Cubic.easeOut")
	else:
		root.modulate.a = 1
		root.scale = Vector2.ONE
	if galaxy.root.visible:
		PTween.add(galaxy.root, {"alpha": 0}, FADE_MS, "Quad.easeOut", {"on_complete": func():
			if mode == "system":
				galaxy.root.visible = false})
	# The first call of a visit arrives shortly after entering.
	_delivered = 0
	_call_clock = MapLayout.call_delay_ms(0, 0)


## Switches to the galaxy view around the player's system and eases out to the whole galaxy.
func _enter_galaxy(zoom_out: bool = true) -> void:
	if mode != "system":
		return
	_close_card()
	mode = "galaxy"
	var now := App.now_ms()
	var g := galaxy
	g.refresh_territory(App.save, now)
	var i := g.system_index(App.save.location.system_id)
	g.set_view(g.system_x(i), g.system_y(i), CLOSE_ZOOM)
	g.root.visible = true
	g.root.modulate.a = 0
	PTween.kill_tweens_of(g.root)
	PTween.add(g.root, {"alpha": 1}, FADE_MS, "Quad.easeOut")
	var root := system_view.root
	PTween.kill_tweens_of(root)
	PTween.add(root, {"alpha": 0, "scale": 0.86}, FADE_MS, "Quad.easeIn", {"on_complete": func():
		if mode != "system":
			root.visible = false})
	_toggle.set_glyph(MapGlyphs.draw_system_glyph)
	_system_name.visible = false
	_sector_name.visible = false
	if zoom_out:
		_animate_camera(g.fit.cx, g.fit.cy, g.fit.zoom, ZOOM_OUT_MS)


## From the galaxy view back into the player's current system (no jump).
func _return_to_system() -> void:
	if mode != "galaxy":
		return
	var g := galaxy
	var i := g.system_index(App.save.location.system_id)
	mode = "busy"
	_animate_camera(g.system_x(i), g.system_y(i), CLOSE_ZOOM, 520, func(): _enter_system(_current_system(), true))


## Eases the galaxy camera to a centre and zoom; user input on the map cancels it.
func _animate_camera(cx: float, cy: float, zoom: float, duration: float, on_complete: Callable = Callable()) -> void:
	_stop_camera()
	var v := galaxy.view
	var from := {"cx": v.cx, "cy": v.cy, "zoom": v.zoom}
	_cam_tween = create_tween()
	_cam_tween.tween_method(func(p: float):
		var k := MapLayout.smooth(p)
		# Interpolate zoom geometrically so the motion feels even at every scale.
		galaxy.set_view(from.cx + (cx - from.cx) * k, from.cy + (cy - from.cy) * k, from.zoom * pow(zoom / from.zoom, k)),
		0.0, 1.0, duration / 1000.0)
	_cam_tween.finished.connect(func():
		_cam_tween = null
		if on_complete.is_valid():
			on_complete.call())


func _stop_camera() -> void:
	if _cam_tween != null:
		_cam_tween.kill()
		_cam_tween = null


## The jump across the map: the ship turns toward the target, warp streaks swell over the map while
## the camera flies there, then the location is saved and `on_arrive` runs.
func _travel_to(system_index: int, on_arrive: Callable) -> void:
	var g := galaxy
	var target: Dictionary = Content.systems()[system_index]
	mode = "busy"
	_stop_camera()
	_vel_x = 0
	_vel_y = 0
	g.set_hover(-1)
	_set_hover_cursor(false)
	var from_x := g.ship_x
	var from_y := g.ship_y
	var to_x: float = target.x
	var to_y: float = target.y
	var v := g.view
	var start := {"cx": v.cx, "cy": v.cy, "zoom": v.zoom}
	var end_zoom := CLOSE_ZOOM
	var heading := atan2(to_y - from_y, to_x - from_x) + PI / 2
	var start_heading := g.ship_heading
	var turn := fposmod(heading - start_heading + PI, TAU) - PI   # Phaser.Math.Angle.Wrap
	_warp = WarpStreaks.new(self, {"count": 240, "depth": UiTheme.DEPTH.fx, "seed": "map-jump"})
	_warp.set_alpha(0)
	Sfx.ftl_charge(TRAVEL_MS / 1000.0)
	var tw := create_tween()
	tw.tween_method(func(p: float):
		var k := MapLayout.smooth(p)
		var dip := 1 - 0.3 * sin(PI * p)
		g.ship_flight = minf(1, p * 5)
		g.ship_heading = start_heading + turn * MapLayout.smooth(p / 0.18)
		g.ship_x = from_x + (to_x - from_x) * MapLayout.smooth((p - 0.1) / 0.85)
		g.ship_y = from_y + (to_y - from_y) * MapLayout.smooth((p - 0.1) / 0.85)
		g.set_view(start.cx + (to_x - start.cx) * k, start.cy + (to_y - start.cy) * k,
			start.zoom * pow(end_zoom / start.zoom, k) * dip)
		var w := sin(PI * p)
		if _warp != null:
			_warp.set_intensity(0.62 * w * w).set_alpha(minf(1, w * 1.6) * 0.75),
		0.0, 1.0, TRAVEL_MS / 1000.0)
	tw.finished.connect(func():
		if _warp != null:
			_warp.destroy()
		_warp = null
		Sfx.ftl_drop()
		if target.id != App.save.location.system_id:
			var save := App.save.duplicate()
			save.location = {"sector_id": target.sector_id, "system_id": target.id}
			App.save = save
			App.persist()
			_pending = []
			_close_card()
		g.set_location(target.id)
		on_arrive.call())

# ------------------------------------------------------------------ calls

func _deliver_call() -> void:
	_delivered += 1
	_call_clock = MapLayout.call_delay_ms(_delivered, randf())
	var system := _current_system()
	var now := App.now_ms()
	var calls := Story.sector_calls(App.save.location.sector_id, App.save, now, MapLayout.MAX_PENDING_CALLS)
	var ids: Array = []
	for p in system.planets:
		ids.append(p.id)
	var call = MapLayout.pick_call(calls, _pending, ids)
	if call == null:
		return
	# The first call heard in a skill carries its intro, even when it is not the sector's first call.
	var sector = Content.sector_of_planet(call.planet_id)
	var skill = sector.skill if sector != null else null
	var intro_pending := false
	for p in _pending:
		if MapLayout.is_intro_call(p):
			intro_pending = true
	if skill != null and not App.save.story.seen.has(skill) and not MapLayout.is_intro_call(call) and not intro_pending:
		call = Story.call_for(call.planet_id, App.save, now)
	_pending.append(call)
	system_view.set_calls(_pending)
	if call.kind == "defend":
		Sfx.alarm()
	_open_card(call)


func _open_card(call: Dictionary) -> void:
	var planet = Content.planet_by_id(call.planet_id)
	if planet == null:
		return
	var m := Mastery.planet_mastery(planet.id, App.save)
	var x := VIEW_W / 2.0
	var y := VIEW_H / 2.0
	var r := 0.0
	if system_view.planet_screen(planet.id, _probe) or _edge_point(planet.id, _probe):
		x = _probe.x
		y = _probe.y
		r = _probe.r
	_card_call = call
	system_view.set_focus(planet.id)
	Sfx.radio_chirp()
	# Now and then the Static can be heard on the channel of a planet it holds.
	var now_ms := _now()
	if Galaxy.planet_hold(planet.id, App.save) == "hostile" and now_ms - _last_chatter > CHATTER_COOLDOWN_MS and randf() < 0.5:
		_last_chatter = now_ms
		Sfx.alien_chatter(null, 0.4)
	_anchor_clock = ANCHOR_CHECK_MS
	card.open({
		"kind": call.kind,
		"portrait": Assets.portrait_for(call.sender),
		"sender": App.t("story.sender.%s" % call.sender),
		"message": App.t(call.story_key, call.params),
		"planet_texture": Assets.planet_image_for(planet.id),
		"planet_name": planet.name,
		"mastery": m,
		"mastery_text": UiFormat.percent_text(App.i18n, m),
		"mastery_color": UiTheme.BAND_COLORS[Mastery.mastery_band(m)],
		"go_label": App.t("meta.starmap.go"),
		"voice_urls": Assets.voice_url_for(call.story_key, App.i18n.locale),
		"volume": App.save.settings.sfx_volume,
	}, MapLayout.CARD_ANCHORS[MapLayout.anchor_card(x, y, r)])


func _close_card() -> void:
	card.close()
	_card_call = null
	system_view.set_focus(null)


## Moves the open card to another corner when its planet drifts underneath it.
func _keep_card_clear() -> void:
	var rect = card.rect()
	if rect == null or _card_call == null or not system_view.planet_screen(_card_call.planet_id, _probe):
		return
	if MapLayout.circle_hits_rect(rect, _probe.x, _probe.y, _probe.r):
		card.slide_to(MapLayout.CARD_ANCHORS[MapLayout.anchor_card(_probe.x, _probe.y, _probe.r)])


## GO: marks a skill intro as seen, jumps to another system of the sector if needed, then the FTL jump.
func _go(call: Dictionary) -> void:
	if mode != "system":
		return
	var planet = Content.planet_by_id(call.planet_id)
	if planet == null:
		return
	if MapLayout.is_intro_call(call):
		var sector = Content.sector_of_planet(planet.id)
		if sector != null:
			App.save = Story.mark_seen(App.save, sector.skill)
			App.persist()
	_close_card()
	if planet.system_id == App.save.location.system_id:
		_launch(planet.id)
		return
	var target := galaxy.system_index(planet.system_id)
	_enter_galaxy(false)
	mode = "busy"
	PTween.delayed_call(self, FADE_MS * 0.6, func(): _travel_to(target, func(): _launch(planet.id)))


func _launch(planet_id: String) -> void:
	mode = "leaving"
	_close_card()
	PTween.kill_tweens_of(_fade)
	PTween.add(_fade, {"alpha": 1}, 260, "Linear", {"on_complete": func(): App.goto("ftl", {"planet_id": planet_id})})

# ------------------------------------------------------------------ input

## Presses that no widget took (Phaser POINTER_DOWN with nothing interactive under the pointer).
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		var p: Vector2 = make_input_local(event).position
		_on_pointer_down(p.x, p.y)


func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		if event.pressed:
			_handle_key(event)
		return
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		_track_touch(event)
		return
	if event is InputEventMagnifyGesture:
		var p: Vector2 = make_input_local(event).position
		if mode == "galaxy":
			_stop_camera()
			_zoom_galaxy(event.factor, p.x, p.y)
		elif mode == "system" and event.factor < 1:
			_zoom_out_system((1 - event.factor) * 600)
		return
	if event is InputEventMouseMotion:
		var p: Vector2 = make_input_local(event).position
		_on_pointer_move(p.x, p.y, (event.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0)
		return
	if event is InputEventMouseButton:
		var p: Vector2 = make_input_local(event).position
		if event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
			_on_pointer_up(p.x, p.y, get_viewport().gui_get_hovered_control() != null)
		elif event.pressed and (event.button_index == MOUSE_BUTTON_WHEEL_UP or event.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			var notches: float = event.factor if event.factor > 0 else 1.0
			var dy := WHEEL_NOTCH * notches * (1 if event.button_index == MOUSE_BUTTON_WHEEL_DOWN else -1)
			_on_wheel(p.x, p.y, dy)


func _on_pointer_down(x: float, y: float) -> void:
	if mode != "galaxy" and mode != "system":
		return
	# Grabbing the map stops the automatic zoom-out (it has no follow-up action in this mode).
	if mode == "galaxy":
		_stop_camera()
	_vel_x = 0
	_vel_y = 0
	var p := _press
	p.active = true
	p.dragging = false
	p.start_x = x
	p.last_x = x
	p.start_y = y
	p.last_y = y
	p.last_t = _now()


func _on_pointer_move(x: float, y: float, is_down: bool) -> void:
	var p := _press
	if _pinch():
		return
	if not p.active or not is_down:
		if mode == "galaxy":
			var hit := galaxy.hit_system(x, y)
			galaxy.set_hover(hit)
			_set_hover_cursor(hit >= 0)
		elif mode == "system":
			_set_hover_cursor(system_view.planet_at(x, y) != null)
		return
	if not p.dragging and MapLayout.is_drag(x - p.start_x, y - p.start_y):
		p.dragging = true
	if not p.dragging or mode != "galaxy":
		return
	var dx: float = x - p.last_x
	var dy: float = y - p.last_y
	var now := _now()
	var dt := maxf(1, now - p.last_t)
	var v := galaxy.view
	v.cx -= dx / v.zoom
	v.cy -= dy / v.zoom
	_clamp_galaxy()
	# Smoothed release velocity in world units per ms.
	_vel_x = _vel_x * 0.6 + (-dx / v.zoom / dt) * 0.4
	_vel_y = _vel_y * 0.6 + (-dy / v.zoom / dt) * 0.4
	p.last_x = x
	p.last_y = y
	p.last_t = now


func _on_pointer_up(x: float, y: float, over: bool) -> void:
	var p := _press
	var was_press: bool = p.active
	p.active = false
	if _pinch_dist > 0:
		_pinch_dist = 0
		_vel_x = 0
		_vel_y = 0
		return
	if not was_press:
		return
	if p.dragging:
		if _now() - p.last_t > 90:
			_vel_x = 0
			_vel_y = 0
		return
	_vel_x = 0
	_vel_y = 0
	if over:
		return
	if mode == "galaxy":
		var hit := galaxy.hit_system(x, y)
		if hit >= 0:
			_on_system_clicked(hit)
	elif mode == "system":
		var planet_id = system_view.planet_at(x, y)
		if planet_id != null:
			var call = null
			for c in _pending:
				if c.planet_id == planet_id:
					call = c
					break
			_open_card(call if call != null else Story.call_for(planet_id, App.save, App.now_ms()))


func _on_wheel(x: float, y: float, dy: float) -> void:
	if dy == 0:
		return
	if mode == "galaxy":
		_stop_camera()
		_zoom_galaxy(exp(-dy * WHEEL_RATE), x, y)
	elif mode == "system":
		_zoom_out_system(dy)


func _track_touch(event: InputEvent) -> void:
	var p: Vector2 = make_input_local(event).position
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = p
		else:
			_touches.erase(event.index)
	else:
		_touches[event.index] = p
		_pinch()


## Two-finger pinch: zooms the galaxy around the fingers' midpoint, or leaves the system view.
func _pinch() -> bool:
	if _touches.size() < 2:
		return false
	var keys := _touches.keys()
	keys.sort()
	var a: Vector2 = _touches[keys[0]]
	var b: Vector2 = _touches[keys[1]]
	var d := a.distance_to(b)
	_press.dragging = true
	if _pinch_dist > 0 and d > 0:
		var ratio := d / _pinch_dist
		if mode == "galaxy":
			_zoom_galaxy(ratio, (a.x + b.x) / 2, (a.y + b.y) / 2)
		elif mode == "system" and ratio < 1:
			_zoom_out_system((1 - ratio) * 600)
	_pinch_dist = d
	return true


func _zoom_galaxy(factor: float, px: float, py: float) -> void:
	var g := galaxy
	var zoom := MapLayout.clamp_f(g.view.zoom * factor, g.min_zoom, g.max_zoom)
	var next := MapLayout.zoom_at(g.view, zoom, px, py)
	g.set_view(next.cx, next.cy, next.zoom)
	_clamp_galaxy()


func _zoom_out_system(amount: float) -> void:
	_system_zoom_out = maxf(0, _system_zoom_out + amount)
	if _system_zoom_out >= SYSTEM_ZOOM_OUT:
		_enter_galaxy()


func _clamp_galaxy() -> void:
	var g := galaxy
	var b := g.bounds
	g.view.cx = MapLayout.clamp_f(g.view.cx, b.x, b.x + b.w)
	g.view.cy = MapLayout.clamp_f(g.view.cy, b.y, b.y + b.h)
	g.mark_dirty()


func _update_inertia(dt: float) -> void:
	if mode != "galaxy" or _press.active:
		return
	if absf(_vel_x) + absf(_vel_y) < 0.002:
		return
	var v := galaxy.view
	v.cx += _vel_x * dt
	v.cy += _vel_y * dt
	var decay := pow(INERTIA_DECAY, dt / 16.7)
	_vel_x *= decay
	_vel_y *= decay
	_clamp_galaxy()


func _on_system_clicked(index: int) -> void:
	if mode != "galaxy":
		return
	Sfx.click()
	var target: Dictionary = Content.systems()[index]
	if target.id == App.save.location.system_id:
		_return_to_system()
		return
	_travel_to(index, func(): _enter_system(target, true))


func _handle_key(ev: InputEventKey) -> void:
	if ev.ctrl_pressed or ev.meta_pressed or ev.alt_pressed:
		return
	var kc := ev.keycode
	if kc == KEY_ENTER or kc == KEY_KP_ENTER or kc == KEY_SPACE:
		if card.is_open() and mode == "system":
			get_viewport().set_input_as_handled()
			if not ev.echo:
				card.go()
		return
	if kc == KEY_ESCAPE:
		if ev.echo:
			return
		if card.is_open():
			_close_card()
		elif mode == "system":
			_enter_galaxy()
		elif mode == "galaxy":
			_return_to_system()
		return
	var ch := char(ev.unicode) if ev.unicode > 0 else ""
	var zoom_in := ch == "+" or ch == "=" or kc == KEY_KP_ADD
	var zoom_out := ch == "-" or ch == "_" or kc == KEY_KP_SUBTRACT
	if not zoom_in and not zoom_out:
		return
	get_viewport().set_input_as_handled()
	if mode == "galaxy":
		_stop_camera()
		_zoom_galaxy(KEY_ZOOM if zoom_in else 1 / KEY_ZOOM, VIEW_W / 2.0, VIEW_H / 2.0)
	elif mode == "system" and zoom_out and not ev.echo:
		_enter_galaxy()


func _set_hover_cursor(on: bool) -> void:
	if on == _hover_cursor:
		return
	_hover_cursor = on
	Input.set_default_cursor_shape(Input.CURSOR_POINTING_HAND if on else Input.CURSOR_ARROW)

# ------------------------------------------------------------------ backdrop and HUD

func _create_background() -> void:
	_bg = Backdrop.add_backdrop(self, Assets.IMG.bg.starmap, {"overscan": BG_OVERSCAN})
	if _bg != null:
		_bg_scale = _bg.scale.x
		_bg_x = _bg.position.x
		_bg_y = _bg.position.y
	Backdrop.add_shade(self, 0.3)


## Slow parallax: the backdrop follows the galaxy camera a little, and drifts in the system view.
func _update_background(time: float, dt: float) -> void:
	var bg := _bg
	if bg == null:
		return
	var tx := VIEW_W / 2.0 + sin(time / 47000.0) * 8
	var ty := VIEW_H / 2.0 + cos(time / 61000.0) * 5
	var ts := _bg_scale
	if mode != "system":
		var v := galaxy.view
		tx = VIEW_W / 2.0 - ((v.cx - Galaxy.WORLD_W / 2.0) / Galaxy.WORLD_W) * BG_SHIFT_X
		ty = VIEW_H / 2.0 - ((v.cy - Galaxy.WORLD_H / 2.0) / Galaxy.WORLD_H) * BG_SHIFT_Y
		ts = _bg_scale * (1 + 0.03 * MapLayout.clamp_f((v.zoom - galaxy.fit.zoom) / (galaxy.max_zoom - galaxy.fit.zoom), -0.5, 1))
	var k := minf(1, dt * 0.004)
	_bg_x += (tx - _bg_x) * k
	_bg_y += (ty - _bg_y) * k
	bg.position = Vector2(_bg_x, _bg_y)
	var s := bg.scale.x + (ts - bg.scale.x) * k
	bg.scale = Vector2(s, s)


func _create_hud() -> void:
	var g := PGraphics.new()
	g.z_index = UiTheme.DEPTH.hud
	add_child(g)
	HudGlyphs.draw_credit_glyph(g, UiTheme.SPACING.l + 7, HUD_Y, 14)
	var credits := PText.make(self, UiTheme.SPACING.l + 22, HUD_Y, Js.num_str(App.save.credits), TextStyles.numeral({
		"font_size": UiTheme.SIZES.heading, "color": UiTheme.css(UiTheme.PRIMARY),
	}))
	credits.set_origin(0, 0.5)
	credits.z_index = UiTheme.DEPTH.hud
	_system_name = PText.make(self, UiTheme.SPACING.l, HUD_Y + 30, "", TextStyles.caps({
		"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.TEXT), "letter_spacing": UiTheme.LETTER_SPACING.caps + 1,
	}))
	_system_name.set_origin(0, 0.5).set_alpha(0.85)
	_system_name.z_index = UiTheme.DEPTH.hud
	_sector_name = PText.make(self, UiTheme.SPACING.l, HUD_Y + 47, "", TextStyles.caps({
		"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM), "letter_spacing": UiTheme.LETTER_SPACING.caps,
	}))
	_sector_name.set_origin(0, 0.5).set_alpha(0.8)
	_sector_name.z_index = UiTheme.DEPTH.hud

	var step := GLYPH_BTN + 8
	var right := VIEW_W - UiTheme.SPACING.l - GLYPH_BTN / 2
	var button := func(slot: int, draw: Callable, on_click: Callable) -> GlyphButton:
		var b := GlyphButton.new(self, right - slot * step, HUD_Y, GLYPH_BTN, draw, on_click)
		b.z_index = UiTheme.DEPTH.hud
		return b
	button.call(0, MapGlyphs.draw_menu_glyph, func(): _leave_to("menu"))
	button.call(1, MapGlyphs.draw_report_glyph, func(): _leave_to("mastery", {"from": "star_map"}))
	button.call(2, MapGlyphs.draw_hangar_glyph, func(): _leave_to("station"))
	_toggle = button.call(3, MapGlyphs.draw_galaxy_glyph, func():
		if mode == "system":
			_enter_galaxy()
		elif mode == "galaxy":
			_return_to_system())


func _leave_to(key: String, d: Dictionary = {}) -> void:
	if mode == "busy" or mode == "leaving":
		return
	mode = "leaving"
	App.goto(key, d)


## Where the edge marker of a planet in another system of the sector sits; false for this system's planets.
func _edge_point(planet_id: String, out: Dictionary) -> bool:
	var planet = Content.planet_by_id(planet_id)
	var sys = Content.system_by_id(planet.system_id) if planet != null else null
	var here := _current_system()
	if sys == null or sys.id == here.id:
		return false
	var dx: float = sys.x - here.x
	var dy: float = sys.y - here.y
	var len := Js.hypot(dx, dy)
	if len == 0:
		len = 1
	out.x = MapLayout.edge_x(dx / len, dy / len, EDGE_INSET)
	out.y = MapLayout.edge_y(dx / len, dy / len, EDGE_INSET)
	out.r = 48.0
	return true


## Blinking arrows at the screen edge for pending calls in other systems of the sector.
func _draw_edge_markers(time: float) -> void:
	var g := _edge
	g.clear()
	var show := mode == "system"
	var blink := 1.0 if sin(time / 170.0) > -0.2 else 0.3
	var slot := 0
	for call in _pending:
		if not show or slot >= _edge_zones.size():
			break
		if not _edge_point(call.planet_id, _probe):
			continue
		var x: float = _probe.x
		var y: float = _probe.y
		var angle := atan2(y - VIEW_H / 2.0, x - VIEW_W / 2.0)
		var color := MapGlyphs.kind_color(call.kind)
		MapGlyphs.draw_chevron(g, x + cos(angle) * 14, y + sin(angle) * 14, 14, angle, color, blink)
		MapGlyphs.draw_kind_glyph(g, call.kind, x - cos(angle) * 6, y - sin(angle) * 6, 14, color, 0.9)
		var zone := _edge_zones[slot]
		if _edge_calls[slot] != call or not zone.visible:
			zone.position = Vector2(x, y)
			zone.visible = true
			_edge_calls[slot] = call
		slot += 1
	for i in range(slot, _edge_zones.size()):
		if _edge_zones[i].visible:
			_edge_zones[i].visible = false
		_edge_calls[i] = null
