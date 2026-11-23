class_name HitZone
## Port of src/ui/hitZone.ts: invisible tappable rectangle centred on (x, y). Fires on release over
## it after a press that started on it, like UiButton.


## Adds the zone to `parent` and returns it. opts: {sound: bool (default true: UiButton.click_sound)}.
static func add(parent: Node, x: float, y: float, w: float, h: float, on_tap: Callable, opts: Dictionary = {}) -> HitArea:
	var holder := Node2D.new()
	holder.position = Vector2(x, y)
	var zone := HitArea.new(w, h)
	holder.add_child(zone)
	var state := {"pressed": false}
	zone.down.connect(func(): state.pressed = true)
	zone.out.connect(func(): state.pressed = false)
	zone.up.connect(func(inside: bool, _touch: bool):
		var fire: bool = state.pressed and inside
		state.pressed = false
		if not fire:
			return
		if opts.get("sound", true) and UiButton.click_sound.is_valid():
			UiButton.click_sound.call()
		on_tap.call())
	if parent != null:
		parent.add_child(holder)
	return zone
