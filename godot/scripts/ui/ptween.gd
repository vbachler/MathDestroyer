class_name PTween
## Phaser tweens for the port. Phaser `scene.tweens.add({targets, x, alpha, duration, ease, delay,
## yoyo, repeat, hold, onComplete})` -> PTween.add(node, {"x": .., "alpha": ..}, duration_ms, "Cubic.easeOut", opts).
## Properties: x, y, alpha (modulate.a), scale (both axes), scale_x / scale_y (TS scaleX / scaleY),
## angle (rotation_degrees), rotation, or any property path of the node (e.g. "position", "modulate").
## opts: delay (ms), yoyo (bool), repeat (int, -1 = forever), hold (ms, pause before yoyo), on_complete (Callable).
## The tween is bound to the node (dies with it). PTween.kill_tweens_of(node) = tweens.killTweensOf.
## Timers: PTween.delayed_call(node, ms, callable) = scene.time.delayedCall bound to `node`.

const _PROP := {
	"x": "position:x", "y": "position:y", "alpha": "modulate:a", "scale_x": "scale:x", "scale_y": "scale:y",
	"angle": "rotation_degrees", "rotation": "rotation",
}


## Godot transition and ease for a Phaser ease name ("Linear", "Quad.easeOut", "Cubic.easeInOut",
## "Sine.easeIn", "Back.easeOut", "Power2", ...). Returns [Tween.TransitionType, Tween.EaseType].
static func ease_of(name: String) -> Array:
	if name == "" or name == "Linear" or name == "Power0" or name == "Linear.easeNone":
		return [Tween.TRANS_LINEAR, Tween.EASE_IN_OUT]
	var parts := name.split(".")
	var family := parts[0]
	var mode := parts[1] if parts.size() > 1 else "easeOut"
	var trans := Tween.TRANS_LINEAR
	match family:
		"Quad", "Power1":
			trans = Tween.TRANS_QUAD
		"Cubic", "Power2":
			trans = Tween.TRANS_CUBIC
		"Quart", "Power3":
			trans = Tween.TRANS_QUART
		"Quint", "Power4":
			trans = Tween.TRANS_QUINT
		"Sine":
			trans = Tween.TRANS_SINE
		"Expo":
			trans = Tween.TRANS_EXPO
		"Circ":
			trans = Tween.TRANS_CIRC
		"Back":
			trans = Tween.TRANS_BACK
		"Bounce":
			trans = Tween.TRANS_BOUNCE
		"Elastic":
			trans = Tween.TRANS_ELASTIC
	var e := Tween.EASE_OUT
	match mode:
		"easeIn", "in", "In":
			e = Tween.EASE_IN
		"easeInOut", "inOut", "InOut":
			e = Tween.EASE_IN_OUT
	return [trans, e]


static func _path(node: Object, prop: String) -> String:
	return _PROP.get(prop, prop)


static func _value(node: Object, prop: String, v: Variant) -> Variant:
	if prop == "scale" and (v is float or v is int):
		return Vector2(v, v)
	return v


## Starts a tween on `node`; returns the Tween.
static func add(node: Node, props: Dictionary, duration_ms: float, ease: String = "Linear", opts: Dictionary = {}) -> Tween:
	var tw := node.create_tween()
	var tr: Array = ease_of(ease)
	tw.set_trans(tr[0]).set_ease(tr[1])
	var rep: int = opts.get("repeat", 0)
	if rep != 0:
		tw.set_loops(0 if rep < 0 else rep + 1)
	var dur := maxf(0.0001, duration_ms / 1000.0)
	var delay := float(opts.get("delay", 0)) / 1000.0
	var yoyo: bool = opts.get("yoyo", false)
	var start := {}
	for k in props.keys():
		var path := _path(node, k)
		start[path] = node.get_indexed(path)
	tw.set_parallel(true)
	for k in props.keys():
		var t := tw.tween_property(node, _path(node, k), _value(node, k, props[k]), dur)
		if delay > 0:
			t.set_delay(delay)
	if yoyo:
		tw.set_parallel(false)
		var hold := float(opts.get("hold", 0)) / 1000.0
		if hold > 0:
			tw.tween_interval(hold)
		tw.set_parallel(true)
		var chained := false
		for path in start.keys():
			if not chained:
				tw.chain().tween_property(node, path, start[path], dur)
				chained = true
			else:
				tw.tween_property(node, path, start[path], dur)
	var cb = opts.get("on_complete")
	if cb is Callable:
		tw.finished.connect(cb)
	_track(node, tw)
	return tw


static func _track(node: Node, tw: Tween) -> void:
	var list: Array = node.get_meta("_ptweens", [])
	list = list.filter(func(t): return is_instance_valid(t) and t.is_valid())
	list.append(tw)
	node.set_meta("_ptweens", list)


## Stops every tween started on `node` with PTween.add (Phaser tweens.killTweensOf).
static func kill_tweens_of(node: Node) -> void:
	if not is_instance_valid(node) or not node.has_meta("_ptweens"):
		return
	for t in node.get_meta("_ptweens"):
		if is_instance_valid(t) and t.is_valid():
			t.kill()
	node.set_meta("_ptweens", [])


## Calls `fn` after `ms` milliseconds unless `node` is freed first (Phaser time.delayedCall).
## Returns the Tween (kill() it to cancel; Phaser TimerEvent.remove()).
static func delayed_call(node: Node, ms: float, fn: Callable) -> Tween:
	var tw := node.create_tween()
	tw.tween_interval(maxf(0.0001, ms / 1000.0))
	tw.tween_callback(fn)
	return tw


## Repeating timer (Phaser time.addEvent({delay, repeat, loop, callback})): calls `fn` every `ms`,
## `repeat + 1` times in total (repeat -1 = forever). Kill the returned Tween to stop it.
static func every(node: Node, ms: float, fn: Callable, repeat: int = -1) -> Tween:
	var tw := node.create_tween()
	tw.set_loops(0 if repeat < 0 else repeat + 1)
	tw.tween_interval(maxf(0.0001, ms / 1000.0))
	tw.tween_callback(fn)
	return tw
