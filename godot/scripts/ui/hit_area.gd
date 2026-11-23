class_name HitArea
extends Control
## The interactive rectangle behind Phaser `setInteractive()` on a sized container / zone.
## Phaser pointer events -> signals: over, out, down, up(inside, was_touch).
## `HitArea.new(w, h)` is centred on its parent's origin like a Phaser container hit area
## (pass centered = false for a top-left rectangle). Touch arrives as emulated mouse input.

signal over
signal out
signal down
## Release after a press on this area; `inside` = released over it (Phaser POINTER_UP on the object).
signal up(inside: bool, was_touch: bool)

var pressed := false
var hovered := false


func _init(w: float = 0.0, h: float = 0.0, centered: bool = true, hand_cursor: bool = true) -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_area(w, h, centered)
	set_hand_cursor(hand_cursor)
	mouse_entered.connect(_on_entered)
	mouse_exited.connect(_on_exited)


func _on_entered() -> void:
	hovered = true
	over.emit()


func _on_exited() -> void:
	hovered = false
	out.emit()


func set_area(w: float, h: float, centered: bool = true) -> void:
	size = Vector2(w, h)
	position = -size / 2.0 if centered else Vector2.ZERO


func set_hand_cursor(on: bool) -> void:
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if on else Control.CURSOR_ARROW


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			pressed = true
			down.emit()
		elif pressed:
			pressed = false
			var inside := Rect2(Vector2.ZERO, size).has_point(event.position)
			up.emit(inside, event.device == InputEvent.DEVICE_ID_EMULATION)
		accept_event()
