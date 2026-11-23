class_name SystemView
extends RefCounted
## Port of src/fx/SystemView.ts: a sun glow with its planets on tilted orbit ellipses, all in one
## root Node2D centred on the sun (scale it for the settle-in and zoom-out feedback). A planet on
## the far half of its orbit is drawn behind the sun. Each planet has a mastery ring, its name on a
## hairline, the Static's sigil while hostile and a pulse while under attack; planets with a
## pending call blink.
##   SystemView.new(parent)  root  system_id()  show(system, save, now)  refresh(save, now)
##   set_calls(calls)  set_focus(planet_id)  has_planet(id)  planet_screen(id, out {x, y, r}) -> bool
##   planet_at(sx, sy) -> id or null  update(time_ms, dt_ms)

## Gap between a planet's rim and its name; the label sits up and to the side on a hairline.
const LABEL_GAP := 18.0
const LABEL_RISE := 12.0
## How often the label sides are re-chosen (ms).
const LABEL_EVERY_MS := 200.0
const MAX_PLANETS := 6
const RIGHT_FIRST := [1, -1]
const LEFT_FIRST := [-1, 1]
## Sun layers: halo, glow, core, white centre (display px) and their alphas.
const SUN_SIZES := [460.0, 170.0, 64.0, 26.0]
const SUN_ALPHAS := [0.16, 0.5, 0.9, 1.0]

var root: Node2D
var _orbits: PGraphics
var _sun_parts: Array[PImage] = []
var _deco: PGraphics
## {id, img, label, size, rx, speed, angle, front, mastery, hostile, attack, side, label_alpha}
var _planets: Array = []
var _calls: Array = []
var _focus_id = null
var _label_clock := 0.0
var _system = null
var _rx0 := PackedFloat32Array()
var _ry0 := PackedFloat32Array()
var _rx1 := PackedFloat32Array()
var _ry1 := PackedFloat32Array()


func _init(parent: Node) -> void:
	root = Node2D.new()
	root.position = Vector2(MapLayout.SUN_X, MapLayout.SUN_Y)
	root.z_index = UiTheme.DEPTH.world + 1
	parent.add_child(root)
	_rx0.resize(MAX_PLANETS)
	_ry0.resize(MAX_PLANETS)
	_rx1.resize(MAX_PLANETS)
	_ry1.resize(MAX_PLANETS)


func system_id() -> Variant:
	return _system.id if _system != null else null


## Builds the view for a system (replaces the previous one).
func show(system: Dictionary, save: Dictionary, now: float) -> void:
	for c in root.get_children():
		root.remove_child(c)
		c.queue_free()
	_system = system
	_calls = []
	_focus_id = null
	_label_clock = 0

	_orbits = PGraphics.new()
	root.add_child(_orbits)
	var count: int = system.planets.size()
	_orbits.line_style(1, UiTheme.TEXT, 0.13)
	for i in count:
		var rx := MapLayout.orbit_radius(i, count)
		_orbits.stroke_ellipse(0, 0, rx * 2, rx * 2 * MapLayout.ORBIT_TILT)

	var cols := MapPalette.sun_colors(system.sun_hue)
	var tints := [cols.glow, cols.glow, cols.core, UiTheme.WHITE]
	_sun_parts = []
	for i in SUN_SIZES.size():
		var img := PImage.make(null, 0, 0, Tex.GLOW).set_tint(tints[i]).set_blend_add().set_alpha(SUN_ALPHAS[i])
		img.scale = Vector2.ONE * (SUN_SIZES[i] / 128.0)
		_sun_parts.append(img)

	_planets = []
	var list: Array = system.planets.slice(0, MAX_PLANETS)
	for i in list.size():
		var p: Dictionary = list[i]
		var rx := MapLayout.orbit_radius(i, count)
		var size := MapLayout.planet_size(Names.stable_hash(p.id))
		var key := Assets.planet_image_for(p.id)
		var x := MapLayout.orbit_x(rx, p.angle)
		var y := MapLayout.orbit_y(rx, p.angle)
		var img: PImage
		if Assets.has_image(key):
			img = PImage.make(null, x, y, key).set_display_size(size, size)
		else:
			img = PImage.make(null, x, y, Tex.PLANET_SMALL).set_display_size(size, size).set_tint(UiTheme.TEXT_DIM)
		var label := PText.make(null, 0, 0, str(p.name).to_upper(), TextStyles.caps({
			"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT), "letter_spacing": UiTheme.LETTER_SPACING.caps,
		}))
		label.set_origin(0, 1).set_alpha(0)
		_planets.append({
			"id": p.id, "img": img, "label": label, "size": size, "rx": rx, "speed": MapLayout.orbit_speed(rx),
			"angle": float(p.angle), "front": MapLayout.in_front(p.angle), "mastery": 0.0, "hostile": false,
			"attack": false, "side": 1, "label_alpha": 0.0,
		})
	# Draw order: orbits, far planets, sun, near planets, decorations and labels.
	for p in _planets:
		if not p.front:
			root.add_child(p.img)
	for s in _sun_parts:
		root.add_child(s)
	for p in _planets:
		if p.front:
			root.add_child(p.img)
	_deco = PGraphics.new()
	root.add_child(_deco)
	for p in _planets:
		root.add_child(p.label)

	refresh(save, now)
	_choose_label_sides()


## Re-reads mastery, hold and attack state of the planets.
func refresh(save: Dictionary, now: float) -> void:
	for p in _planets:
		p.mastery = Mastery.planet_mastery(p.id, save)
		p.hostile = Galaxy.planet_hold(p.id, save) == "hostile"
		p.attack = Galaxy.under_attack(p.id, save, now)


## Planets that carry a pending call (they blink). calls: Array of {planet_id, kind}.
func set_calls(calls: Array) -> void:
	_calls = []
	for c in calls:
		_calls.append({"planet_id": c.planet_id, "kind": c.kind})


## The planet whose card is open (amber brackets), or null.
func set_focus(planet_id: Variant) -> void:
	_focus_id = planet_id


func has_planet(planet_id: String) -> bool:
	for p in _planets:
		if p.id == planet_id:
			return true
	return false


## Screen position and radius (planet plus label reach) of a planet; false if not in this system.
func planet_screen(planet_id: String, out: Dictionary) -> bool:
	for p in _planets:
		if p.id == planet_id:
			var s := root.scale.x
			out.x = root.position.x + p.img.position.x * s
			out.y = root.position.y + p.img.position.y * s
			out.r = (p.size / 2.0 + 26) * s
			return true
	return false


## Id of the planet under a screen point (its disc plus a small margin), front planets first.
func planet_at(sx: float, sy: float) -> Variant:
	var s := root.scale.x
	var best = null
	var best_score := INF
	for p in _planets:
		var dx: float = (sx - root.position.x) / s - p.img.position.x
		var dy: float = (sy - root.position.y) / s - p.img.position.y
		var r: float = p.size / 2.0 + 10
		var d := dx * dx + dy * dy
		# A near planet covers a far one, so it wins whenever both are hit.
		var score := d + (0.0 if p.front else 1e6)
		if d <= r * r and score < best_score:
			best_score = score
			best = p.id
	return best


func update(time: float, dt_ms: float) -> void:
	if _system == null or not root.visible:
		return
	var dt := minf(dt_ms, 100) / 1000.0
	var breathe := 1 + sin(time / 1900.0) * 0.03
	for i in _sun_parts.size():
		var k: float = (SUN_SIZES[i] / 128.0) * (breathe if i < 2 else 1.0)
		_sun_parts[i].scale = Vector2(k, k)
	for p in _planets:
		p.angle = fmod(p.angle + p.speed * dt, PI * 2)
		p.img.position = Vector2(MapLayout.orbit_x(p.rx, p.angle), MapLayout.orbit_y(p.rx, p.angle))
		var front := MapLayout.in_front(p.angle)
		if front != p.front:
			p.front = front
			if front:
				_move_above(p.img, _sun_parts[_sun_parts.size() - 1])
			else:
				_move_below(p.img, _sun_parts[0])
	_label_clock -= dt_ms
	if _label_clock <= 0:
		_label_clock = LABEL_EVERY_MS
		_choose_label_sides()
	_draw_decorations(time, dt_ms)


## Phaser container.moveAbove(child, target): child directly above target.
func _move_above(child: Node, target: Node) -> void:
	var ti := target.get_index()
	root.move_child(child, ti if child.get_index() < ti else ti + 1)


## Phaser container.moveBelow(child, target): child directly below target.
func _move_below(child: Node, target: Node) -> void:
	var ti := target.get_index()
	root.move_child(child, ti - 1 if child.get_index() < ti else ti)


## Puts each label right of its planet, or left when that side is off screen or taken; hides it
## when neither fits.
func _choose_label_sides() -> void:
	var s := root.scale.x
	var right := (MapLayout.VIEW_W - 12 - root.position.x) / s
	var left := (12 - root.position.x) / s
	var kept := 0
	for p in _planets:
		var w: float = p.label.width
		var h: float = p.label.height
		var y1: float = p.img.position.y - p.size / 2.0 - LABEL_RISE + 4
		var y0 := y1 - h
		var placed := 0
		for side in (RIGHT_FIRST if p.side == 1 else LEFT_FIRST):
			var x0: float = p.img.position.x + p.size / 2.0 + LABEL_GAP if side == 1 else p.img.position.x - p.size / 2.0 - LABEL_GAP - w
			var x1 := x0 + w
			if x0 < left or x1 > right:
				continue
			var free := not (x0 < 30 and x1 > -30 and y0 < 30 and y1 > -30)   # keep the sun's core clear
			var k := 0
			while k < kept and free:
				if x0 < _rx1[k] + 4 and _rx0[k] < x1 + 4 and y0 < _ry1[k] + 2 and _ry0[k] < y1 + 2:
					free = false
				k += 1
			if free:
				p.side = side
				placed = 1
				_rx0[kept] = x0
				_ry0[kept] = y0
				_rx1[kept] = x1
				_ry1[kept] = y1
				kept += 1
				break
		p.label_alpha = float(placed)


func _draw_decorations(time: float, dt_ms: float) -> void:
	var g := _deco
	g.clear()
	var pulse := fmod(time, 1400.0) / 1400.0
	var blink := 1.0 if sin(time / 170.0) > -0.2 else 0.25
	var fade := minf(1.0, dt_ms * 0.01)
	for p in _planets:
		var x: float = p.img.position.x
		var y: float = p.img.position.y
		var r: float = p.size / 2.0
		Glyphs.draw_ring(g, x, y, r + 4, p.mastery, UiTheme.BAND_COLORS[Mastery.mastery_band(p.mastery)], 1.5)
		if p.hostile:
			MapGlyphs.draw_static_sigil(g, x - r - 4, y - r - 2, 11, UiTheme.DANGER, 0.95)
		if p.attack:
			g.line_style(1.2, UiTheme.DANGER, 0.85 * (1 - pulse))
			g.stroke_circle(x, y, r + 5 + 16 * pulse)
		if _focus_id != null and p.id == _focus_id:
			UiPanel.draw_brackets(g, x - r - 9, y - r - 9, p.size + 18, p.size + 18, UiTheme.PRIMARY, 0.9, 6)
		for c in _calls:
			if c.planet_id == p.id:
				MapGlyphs.draw_call_blip(g, x, y + r + 14, 11, MapGlyphs.kind_color(c.kind), blink)
		# Name on a hairline: from the rim up to the label, then under it.
		var label: PText = p.label
		var la := label.get_alpha()
		var a: float = la + ((p.label_alpha * 0.8) - la) * fade
		var ly := y - r - LABEL_RISE
		var lx := x + r + LABEL_GAP if p.side == 1 else x - r - LABEL_GAP
		label.set_origin(0 if p.side == 1 else 1, 1)
		label.position = Vector2(Js.round(lx), Js.round(ly))
		label.set_alpha(a)
		if a > 0.02:
			g.line_style(1, UiTheme.TEXT, 0.35 * a)
			g.line_between(x + p.side * r * 0.72, y - r * 0.72, lx - p.side * 4, ly + 3)
			g.line_between(lx - p.side * 4, ly + 3, lx + p.side * label.width, ly + 3)
