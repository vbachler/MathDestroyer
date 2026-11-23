class_name GalaxyView
extends RefCounted
## Port of src/fx/GalaxyView.ts: the galaxy view: baked sector clouds, star points, territory rings,
## sector and system names and the player's ship, all drawn in screen space from a MapView (no
## camera zoom, so lines and text stay crisp at every zoom). Everything is created once; update()
## only moves, fades and redraws one PGraphics.
##   GalaxyView.new(parent)  root (Node2D)  view {cx, cy, zoom}  bounds  fit  min_zoom  max_zoom
##   set_sector_names(name_of: Callable)  refresh_territory(save, now)  set_location(system_id)
##   system_index(id)  system_x(i) / system_y(i)  set_view(cx, cy, zoom)  mark_dirty()  set_hover(i)
##   hit_system(sx, sy)  update(time_ms, dt_ms)  ship_x / ship_y / ship_heading / ship_flight

## Screen margin around the whole galaxy at the opening zoom.
const FIT_MARGIN := 40.0
## Zoom range relative to the fit zoom.
const MIN_ZOOM_K := 0.85
const MAX_ZOOM := 1.6
## System names fade in between these zooms (screen px per world unit).
const SYS_LABEL_FROM := 0.5
const SYS_LABEL_FULL := 0.62
## Click radius around a star, screen px.
const HIT_RADIUS := 18.0
const SHIP_SIZE := 22.0
const SECTOR_LABEL_ALPHA := 0.42
const SYSTEM_LABEL_ALPHA := 0.7
## Re-run label collision when the zoom changed by more than this ratio.
const RELAYOUT_ZOOM := 0.03

const VIEW_W := MapLayout.VIEW_W
const VIEW_H := MapLayout.VIEW_H

var root: Node2D
## The current camera; mutate it and call mark_dirty(), or use set_view.
var view: Dictionary
var bounds: Dictionary
var fit: Dictionary
var min_zoom: float
var max_zoom := MAX_ZOOM

var _sectors: Array
var _systems: Array
var _clouds: Array = []   # {img, baked, w, h}
var _glows: Array[PImage] = []
var _cores: Array[PImage] = []
var _marks: PGraphics
var _ship: PImage = null
var _ship_scale := 1.0

var n: int
var _sys_x := PackedFloat32Array()
var _sys_y := PackedFloat32Array()
var _scr_x := PackedFloat32Array()
var _scr_y := PackedFloat32Array()
var _hostile := PackedByteArray()
var _attack := PackedByteArray()
var _index_by_id := {}

## Labels: sector names first (index < sectors), then system names.
var _labels: Array[PText] = []
var _label_wx := PackedFloat32Array()
var _label_wy := PackedFloat32Array()
var _lx := PackedFloat32Array()
var _ly := PackedFloat32Array()
var _lw := PackedFloat32Array()
var _lh := PackedFloat32Array()
var _l_active := PackedByteArray()
var _l_keep := PackedByteArray()
var _l_alpha := PackedFloat32Array()
var _l_base := PackedFloat32Array()
var _sector_of_system := PackedInt32Array()
var _l_order := PackedInt32Array()
var _last_label_zoom := -1.0

var _dirty := true
var _hover := -1
var _current := 0
var _star_scale := 1.0
## Ship position in the world and its heading (radians, 0 = nose up).
var ship_x := 0.0
var ship_y := 0.0
var ship_heading := 0.0
## 0 = ship parked just above its star, 1 = ship on its exact world position (in flight).
var ship_flight := 0.0


func _init(parent: Node) -> void:
	root = Node2D.new()
	root.z_index = UiTheme.DEPTH.world
	parent.add_child(root)
	_sectors = Content.sectors()
	_systems = Content.systems()
	n = _systems.size()
	bounds = MapLayout.disc_bounds(_sectors)
	fit = MapLayout.fit_view(bounds, FIT_MARGIN)
	min_zoom = fit.zoom * MIN_ZOOM_K
	view = fit.duplicate()

	for sector in _sectors:
		var baked := SectorClouds.bake_sector_cloud(sector)
		var img := PImage.make(root, 0, 0, baked.key)
		img.set_origin(0, 0)
		_clouds.append({"img": img, "baked": baked, "w": img.texture.get_width(), "h": img.texture.get_height()})

	_sys_x.resize(n)
	_sys_y.resize(n)
	_scr_x.resize(n)
	_scr_y.resize(n)
	_hostile.resize(n)
	_attack.resize(n)
	_sector_of_system.resize(n)
	for i in n:
		var s: Dictionary = _systems[i]
		_sys_x[i] = s.x
		_sys_y[i] = s.y
		_index_by_id[s.id] = i
		var si := -1
		for k in _sectors.size():
			if _sectors[k].id == s.sector_id:
				si = k
				break
		_sector_of_system[i] = si
		var cols := MapPalette.sun_colors(s.sun_hue)
		var g := PImage.make(root, 0, 0, Tex.GLOW).set_tint(cols.glow).set_blend_add().set_alpha(0.75)
		var c := PImage.make(root, 0, 0, Tex.GLOW).set_tint(cols.core).set_blend_add()
		_glows.append(g)
		_cores.append(c)

	_marks = PGraphics.new()
	root.add_child(_marks)

	var total := _sectors.size() + n
	_label_wx.resize(total)
	_label_wy.resize(total)
	_lx.resize(total)
	_ly.resize(total)
	_lw.resize(total)
	_lh.resize(total)
	_l_alpha.resize(total)
	_l_base.resize(total)
	_l_active.resize(total)
	_l_keep.resize(total)
	_l_order.resize(total)
	_l_base.fill(SECTOR_LABEL_ALPHA)
	for i in _sectors.size():
		var sector: Dictionary = _sectors[i]
		var text := PText.make(root, 0, 0, "", TextStyles.caps({
			"font_size": UiTheme.SIZES.small + 1, "color": MapPalette.css_color(MapPalette.sector_colors(sector.hue).label),
			"letter_spacing": UiTheme.LETTER_SPACING.caps + 1,
		}))
		text.set_origin(0.5).set_alpha(0)
		_labels.append(text)
		_label_wx[i] = sector.x
		_label_wy[i] = sector.y
	for j in n:
		var s: Dictionary = _systems[j]
		var i := _sectors.size() + j
		var text := PText.make(root, 0, 0, str(s.name).to_upper(), TextStyles.caps({
			"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM), "letter_spacing": UiTheme.LETTER_SPACING.caps,
		}))
		text.set_origin(0.5, 0).set_alpha(0)
		_labels.append(text)
		_label_wx[i] = s.x
		_label_wy[i] = s.y

	if Assets.has_image(Assets.IMG.ships.player):
		_ship = PImage.make(root, 0, 0, Assets.IMG.ships.player)
		_ship_scale = SHIP_SIZE / maxf(_ship.texture.get_width(), _ship.texture.get_height())
		_ship.scale = Vector2(_ship_scale, _ship_scale)


## Sets the sector names (call again after a language change) and places them off the stars.
func set_sector_names(name_of: Callable) -> void:
	for i in _sectors.size():
		var sector: Dictionary = _sectors[i]
		var text := _labels[i].set_text(str(name_of.call(sector.name_key)).to_upper())
		var w: float = text.width / fit.zoom
		var h: float = text.height / fit.zoom
		_label_wy[i] = sector.y + MapLayout.sector_label_offset(sector.x, sector.y, sector.radius, w, h, sector.systems, 14 / fit.zoom)
	_last_label_zoom = -1
	_dirty = true


## Territory: rings for hostile and attacked systems, cloud brightness from sector mastery.
func refresh_territory(save: Dictionary, now: float) -> void:
	for i in n:
		var hostile := 0
		var attack := 0
		for p in _systems[i].planets:
			if Galaxy.planet_hold(p.id, save) == "hostile":
				hostile = 1
			if Galaxy.under_attack(p.id, save, now):
				attack = 1
		_hostile[i] = hostile
		_attack[i] = attack
	for i in _sectors.size():
		var m := Galaxy.sector_mastery(_sectors[i].id, save)
		_clouds[i].img.set_alpha(0.42 + 0.58 * m)
		_l_base[i] = SECTOR_LABEL_ALPHA + 0.35 * m


## The player's system: its ship marker and label priority.
func set_location(system_id: String) -> void:
	var i: int = _index_by_id.get(system_id, 0)
	_current = i
	ship_x = _sys_x[i]
	ship_y = _sys_y[i]
	ship_heading = 0
	ship_flight = 0
	_last_label_zoom = -1
	_dirty = true


func system_index(system_id: String) -> int:
	return _index_by_id.get(system_id, -1)


func system_x(i: int) -> float:
	return _sys_x[i]


func system_y(i: int) -> float:
	return _sys_y[i]


func set_view(cx: float, cy: float, zoom: float) -> void:
	view.cx = cx
	view.cy = cy
	view.zoom = zoom
	_dirty = true


func mark_dirty() -> void:
	_dirty = true


func set_hover(index: int) -> void:
	if index == _hover:
		return
	_hover = index
	_last_label_zoom = -1


## Index of the star under the screen point, or -1. Valid after the last update.
func hit_system(sx: float, sy: float) -> int:
	return MapLayout.nearest_point(_scr_x, _scr_y, n, sx, sy, HIT_RADIUS)


func update(time: float, dt_ms: float) -> void:
	if not root.visible:
		return
	if _dirty:
		_dirty = false
		_layout()
	if _last_label_zoom < 0 or absf(view.zoom / _last_label_zoom - 1) > RELAYOUT_ZOOM:
		_layout_labels()
	_place_labels(dt_ms)
	_place_ship(time)
	_draw_marks(time)


func _layout() -> void:
	var v := view
	var z: float = v.zoom
	for c in _clouds:
		var x := MapLayout.world_to_screen_x(v, c.baked.x0)
		var y := MapLayout.world_to_screen_y(v, c.baked.y0)
		var s: float = c.baked.cell * z
		var visible: bool = x < VIEW_W and y < VIEW_H and x + c.w * s > 0 and y + c.h * s > 0
		c.img.visible = visible
		if visible:
			c.img.position = Vector2(x, y)
			c.img.scale = Vector2(s, s)
	_star_scale = MapLayout.clamp_f(sqrt(z / fit.zoom), 1, 2.4)
	var glow_scale := (13 * _star_scale) / 128.0
	var core_scale := (4 * _star_scale) / 128.0
	for i in n:
		var x := MapLayout.world_to_screen_x(v, _sys_x[i])
		var y := MapLayout.world_to_screen_y(v, _sys_y[i])
		_scr_x[i] = x
		_scr_y[i] = y
		var visible := x > -20 and x < VIEW_W + 20 and y > -20 and y < VIEW_H + 20
		_glows[i].visible = visible
		_cores[i].visible = visible
		if visible:
			_glows[i].position = Vector2(x, y)
			_glows[i].scale = Vector2(glow_scale, glow_scale)
			_cores[i].position = Vector2(x, y)
			_cores[i].scale = Vector2(core_scale, core_scale)


## Collision of every label at the current zoom.
func _layout_labels() -> void:
	var v := view
	var z: float = v.zoom
	_last_label_zoom = z
	var sectors := _sectors.size()
	var sys_visible := z >= SYS_LABEL_FROM
	var total := _labels.size()
	var k := 0
	# Priority: the player's sector, the other sectors, the hovered system, the player's system, the rest.
	var current_sector := _sector_of_system[_current]
	if current_sector >= 0:
		_l_order[k] = current_sector
		k += 1
	for i in sectors:
		if i != current_sector:
			_l_order[k] = i
			k += 1
	if _hover >= 0:
		_l_order[k] = sectors + _hover
		k += 1
	if _current != _hover:
		_l_order[k] = sectors + _current
		k += 1
	for j in n:
		if j != _hover and j != _current:
			_l_order[k] = sectors + j
			k += 1
	for i in total:
		var t := _labels[i]
		var sx := MapLayout.world_to_screen_x(v, _label_wx[i])
		var sy := MapLayout.world_to_screen_y(v, _label_wy[i])
		_lw[i] = t.width
		_lh[i] = t.height
		if i < sectors:
			_lx[i] = sx - t.width / 2
			_ly[i] = sy - t.height / 2
			_l_active[i] = 1
		else:
			_lx[i] = sx - t.width / 2
			_ly[i] = sy + 9 * _star_scale
			_l_active[i] = 1 if (sys_visible or i - sectors == _hover) else 0
	MapLayout.resolve_labels(_lx, _ly, _lw, _lh, _l_active, _l_order, total, _l_keep, 3)


func _place_labels(dt_ms: float) -> void:
	var v := view
	var z: float = v.zoom
	var sectors := _sectors.size()
	var sys_fade := MapLayout.clamp_f((z - SYS_LABEL_FROM) / (SYS_LABEL_FULL - SYS_LABEL_FROM), 0, 1)
	var k := minf(1.0, dt_ms * 0.008)
	for i in _labels.size():
		var t := _labels[i]
		var is_sector := i < sectors
		var base := _l_base[i] if is_sector else SYSTEM_LABEL_ALPHA
		var hovered := not is_sector and i - sectors == _hover
		var target := 0.0
		if _l_keep[i]:
			target = base * (1.0 if (is_sector or hovered) else sys_fade)
		_l_alpha[i] += (target - _l_alpha[i]) * k
		var sx := MapLayout.world_to_screen_x(v, _label_wx[i])
		var sy := MapLayout.world_to_screen_y(v, _label_wy[i])
		if not is_sector:
			sy += 9 * _star_scale
		var on_screen := sx + t.width / 2 > 0 and sx - t.width / 2 < VIEW_W and sy + t.height > 0 and sy - t.height < VIEW_H
		var visible := on_screen and _l_alpha[i] > 0.01
		t.visible = visible
		if visible:
			t.position = Vector2(Js.round(sx), Js.round(sy))
			t.set_alpha(1.0 if hovered else _l_alpha[i])


func _place_ship(time: float) -> void:
	var v := view
	var park := 1.0 - ship_flight
	var bob := sin(time / 650.0) * 1.6 * park
	var x := MapLayout.world_to_screen_x(v, ship_x)
	var y := MapLayout.world_to_screen_y(v, ship_y) - (11 + 5 * _star_scale) * park + bob
	if _ship != null:
		_ship.position = Vector2(x, y)
		_ship.rotation = ship_heading


func _draw_marks(time: float) -> void:
	var g := _marks
	g.clear()
	var s := _star_scale
	var pulse := fmod(time, 1600.0) / 1600.0
	for i in n:
		var x := _scr_x[i]
		var y := _scr_y[i]
		if x < -30 or x > VIEW_W + 30 or y < -30 or y > VIEW_H + 30:
			continue
		if _hostile[i]:
			g.line_style(1, UiTheme.DANGER, 0.38)
			g.stroke_circle(x, y, 4 * s + 2)
		if _attack[i]:
			g.line_style(1, UiTheme.DANGER, 0.8 * (1 - pulse))
			g.stroke_circle(x, y, 5 * s + 3 + 12 * pulse)
	# The player's system: a faint amber ring.
	var cx := _scr_x[_current]
	var cy := _scr_y[_current]
	g.line_style(1, UiTheme.PRIMARY, 0.45)
	g.stroke_circle(cx, cy, 5 * s + 6)
	if _hover >= 0:
		var hx := _scr_x[_hover]
		var hy := _scr_y[_hover]
		var r := 5 * s + 8
		g.line_style(1, UiTheme.PRIMARY, 0.9)
		for q in 4:
			var a := q * PI / 2 + PI / 4
			g.begin_path()
			g.arc(hx, hy, r, a - 0.35, a + 0.35, false)
			g.stroke_path()
		if _hover != _current and ship_flight == 0:
			g.line_style(1, UiTheme.PRIMARY, 0.28)
			g.line_between(cx, cy, hx, hy)
	if _ship == null:
		var park := 1.0 - ship_flight
		MapGlyphs.draw_chevron(g, MapLayout.world_to_screen_x(view, ship_x), MapLayout.world_to_screen_y(view, ship_y) - 16 * park, 12,
			ship_heading - PI / 2, UiTheme.PRIMARY, 1)
