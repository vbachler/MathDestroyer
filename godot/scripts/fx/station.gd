class_name Station
extends RefCounted
## Port of src/fx/Station.ts: one defended orbital station: the station image (fallback: the
## procedural dome), tiny hp pips under it, and its condition. Damaged: darker tint, flicker and
## occasional sparks. Destroyed: the station blows up and is replaced by a drifting debris field
## (StationWreck); a repair brings it back. Call update(dt_ms) every frame (skip it while paused).
## Station.new(parent, x): adds its objects to `parent` (the scene's world, z_index 0).

const PIP_W := 8.0
const PIP_GAP := 3.0

var x: float
var y := BattleLayout.STATION_Y
var _parent: Node
var _sprite: PImage
var _pips: PGraphics
var _wreck: StationWreck
var _condition := "intact"
var _signature := ""
var _next_flicker_ms := 0.0
var _flicker_left_ms := 0.0


func _init(parent: Node, px: float) -> void:
	_parent = parent
	x = px
	var key: String = Assets.IMG.ships.station if Assets.has_image(Assets.IMG.ships.station) else Tex.DOME
	_sprite = PImage.make(parent, px, BattleLayout.STATION_Y, key)
	_sprite.z_index = UiTheme.DEPTH.world + 2
	_sprite.scale = Vector2.ONE * (BattleLayout.STATION_W / _sprite.texture.get_width())
	_pips = PGraphics.new()
	_pips.z_index = UiTheme.DEPTH.world + 3
	parent.add_child(_pips)
	_wreck = StationWreck.new(parent, px, BattleLayout.STATION_Y, key)
	_next_flicker_ms = 800 + randf() * 2000


## Top of the station's visible body (where a descending ship meets it).
var top: float:
	get:
		return BattleLayout.STATION_Y - _sprite.texture.get_height() * _sprite.scale.y * 0.4


## The debris field (for dev checks).
var wreck: StationWreck:
	get:
		return _wreck


func set_hp(hp: int, max_hp: int) -> void:
	var sig := "%d/%d" % [hp, max_hp]
	if sig == _signature:
		return
	var first := _signature == ""
	_signature = sig
	_draw_pips(hp, max_hp)
	var next := "wreck" if hp <= 0 else ("damaged" if hp < max_hp else "intact")
	if next == _condition:
		return
	_condition = next
	_sprite.set_alpha(1)
	if next == "intact":
		_sprite.clear_tint()
	elif next == "damaged":
		_sprite.set_tint(UiTheme.TEXT_DIM)
	else:
		_sprite.set_tint(UiTheme.DISABLED)
	_sprite.visible = next != "wreck"
	if next == "wreck":
		_wreck.show(not first)
	else:
		_wreck.hide()


func update(dt_ms: float) -> void:
	_wreck.update(dt_ms)
	if _condition != "damaged":
		return
	if _flicker_left_ms > 0:
		_flicker_left_ms -= dt_ms
		# Two quick dips while the flicker lasts.
		_sprite.set_alpha(0.55 if int(floorf(_flicker_left_ms / 60.0)) % 2 == 0 else 1.0)
		if _flicker_left_ms <= 0:
			_sprite.set_alpha(1)
		return
	_next_flicker_ms -= dt_ms
	if _next_flicker_ms > 0:
		return
	_next_flicker_ms = 1400 + randf() * 2400
	_flicker_left_ms = 240
	var ox := (randf() - 0.5) * BattleLayout.STATION_W * 0.7
	var oy := (randf() - 0.5) * 16
	BattleFx.sparks(_parent, x + ox, BattleLayout.STATION_Y + oy, UiTheme.PRIMARY, 5, 40)


func _draw_pips(hp: int, max_hp: int) -> void:
	var g := _pips
	g.clear()
	var total := max_hp * PIP_W + (max_hp - 1) * PIP_GAP
	var x0 := x - total / 2.0
	for k in max_hp:
		var px := x0 + k * (PIP_W + PIP_GAP)
		if k < hp:
			g.fill_style(UiTheme.OK, 0.95)
			g.fill_rect(px, BattleLayout.STATION_PIP_Y, PIP_W, BattleLayout.STATION_PIP_H)
		else:
			g.line_style(UiTheme.LINE_WIDTH, UiTheme.TEXT_DIM, 0.8)
			g.stroke_rect(px + 0.5, BattleLayout.STATION_PIP_Y + 0.5, PIP_W - 1, BattleLayout.STATION_PIP_H - 1)


## Frees the debris field objects (scene shutdown).
func destroy() -> void:
	_wreck.destroy()
