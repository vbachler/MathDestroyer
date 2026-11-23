class_name CameraFx
extends Node
## The per-scene Phaser camera effects the gameplay scenes use: `cameras.main.shake(ms, intensity)`
## and `cameras.main.fadeIn(ms, r, g, b)`. Add it as a child of the scene (it stops with the scene,
## like a paused Phaser scene's camera). `target` is what moves: the scene's Node2D (position) or a
## CanvasLayer (offset).
## Shake (Phaser Shake effect): every frame the view is offset by a random amount within
## +-intensity * view size; a shake started while one runs is ignored (Phaser without `force`).

var target: Object
var _shake_ms := 0.0
var _shake_left := 0.0
var _intensity := 0.0
var _fade: ColorRect = null
var _fade_ms := 0.0
var _fade_left := 0.0


func _init(p_target: Object) -> void:
	target = p_target


var is_shaking: bool:
	get:
		return _shake_left > 0


func shake(duration_ms: float, intensity: float) -> void:
	if _shake_left > 0:
		return
	_shake_ms = duration_ms
	_shake_left = duration_ms
	_intensity = intensity


## Fades in from `color` (Phaser fadeIn): a full-view rectangle over everything, alpha 1 -> 0.
func fade_in(duration_ms: float, color: Color = Color.BLACK) -> void:
	if _fade == null:
		_fade = ColorRect.new()
		_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_fade.size = Vector2(UiTheme.GAME_WIDTH, UiTheme.GAME_HEIGHT)
		_fade.z_index = RenderingServer.CANVAS_ITEM_Z_MAX
		_fade.z_as_relative = false
		(target if target is Node else get_parent()).add_child(_fade)
	_fade.color = color
	_fade.visible = true
	_fade_ms = duration_ms
	_fade_left = duration_ms


func _process(delta: float) -> void:
	var dt := delta * 1000.0
	if _shake_left > 0:
		_shake_left -= dt
		var off := Vector2.ZERO
		if _shake_left > 0:
			off = Vector2((randf() * 2.0 - 1.0) * _intensity * UiTheme.GAME_WIDTH,
				(randf() * 2.0 - 1.0) * _intensity * UiTheme.GAME_HEIGHT)
		_apply(off)
	if _fade != null and _fade_left > 0:
		_fade_left = maxf(0.0, _fade_left - dt)
		_fade.color.a = _fade_left / maxf(1.0, _fade_ms)
		if _fade_left == 0:
			_fade.visible = false


func _apply(off: Vector2) -> void:
	if target is CanvasLayer:
		target.offset = off
	elif target is Node2D:
		target.position = off
