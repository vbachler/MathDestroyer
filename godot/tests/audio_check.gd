extends SceneTree
## Headless audio check (exit code 0 = ok):
##   $GODOT --headless --path godot --import            (once, after npm run audio:render)
##   $GODOT --headless --path godot -s res://tests/audio_check.gd
## Loads the manifest and every file it lists, then calls every public Sfx method (ambience, tension,
## hangar, FTL cut, voice limits) over ~3 s of real time. Any engine/script error or warning fails it.

const SFX_SCRIPT := "res://scripts/audio/sfx.gd"
const MANIFEST := "res://assets/audio/manifest.json"


class ErrorCounter extends Logger:
	var errors: Array[String] = []
	var _lock := Mutex.new()

	func _log_error(function: String, file: String, line: int, code: String, rationale: String,
			_editor_notify: bool, error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
		_lock.lock()
		errors.append("[%d] %s %s (%s:%d %s)" % [error_type, code, rationale, file, line, function])
		_lock.unlock()

	func _log_message(_message: String, _error: bool) -> void:
		pass


var _log := ErrorCounter.new()
var _fails: Array[String] = []
var _sfx: Node
var _t0 := 0.0
var _step := 0


func _initialize() -> void:
	OS.add_logger(_log)
	_check_files()
	_sfx = root.get_node_or_null(^"Sfx")
	if _sfx == null or _sfx.get_script() == null or _sfx.get_script().resource_path != SFX_SCRIPT:
		_sfx = load(SFX_SCRIPT).new()
		root.add_child(_sfx)
	_t0 = Time.get_ticks_msec() / 1000.0


func _check_files() -> void:
	if not FileAccess.file_exists(MANIFEST):
		_fail("manifest missing: " + MANIFEST)
		return
	var m: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
	if not m is Dictionary:
		_fail("manifest is not a JSON object")
		return
	var n := 0
	for name: String in m.sounds:
		var e: Dictionary = m.sounds[name]
		if e.files.is_empty():
			_fail("no files for " + name)
		for f: String in e.files:
			n += _check_stream("res://assets/audio/" + f)
	for name: String in m.loops:
		n += _check_stream("res://assets/audio/" + String(m.loops[name].file))
	print("audio_check: %d files loaded (%d sounds, %d loops)" % [n, m.sounds.size(), m.loops.size()])


func _check_stream(path: String) -> int:
	var s := load(path) as AudioStream
	if s == null:
		_fail("cannot load " + path)
		return 0
	if s.get_length() <= 0.0:
		_fail("empty stream " + path)
		return 0
	return 1


func _fail(msg: String) -> void:
	_fails.append(msg)
	printerr("FAIL: " + msg)


func _expect(cond: bool, msg: String) -> void:
	if not cond:
		_fail(msg)


func _process(_delta: float) -> bool:
	var t := Time.get_ticks_msec() / 1000.0 - _t0
	match _step:
		0:
			_sfx.configure(0.8, func() -> float: return 0.6)
			_sfx.set_volume(1.0)
			_expect(is_equal_approx(_sfx.get_volume(), 1.0), "get_volume")
			_sfx.set_music_volume(0.5)
			for m: String in ["laser", "laser", "laser_miss", "wrong", "hit", "miss", "shield_block",
					"station_destroyed", "alarm", "radio_chirp", "repair", "upgrade", "click", "win", "lose",
					"ftl_drop", "enemy_laser", "hull_hit", "breach_alarm", "turret_shot", "bite"]:
				_sfx.call(m)
			_sfx.alien_chatter()
			_sfx.alien_chatter(null, 0.4)
			_sfx.alien_chatter(1.3, 0.45)
			_sfx.skitter(0.0)
			_sfx.skitter(0.15)
			_sfx.skitter(0.62)
			_sfx.skitter(1.0)
			_sfx.screech(0.5)
			_sfx.spark_crackle(0.75)
			_expect(_sfx._voices.size() == Sfx_HARD_MAX(), "voices after a burst: %d (want %d)" % [_sfx._voices.size(), Sfx_HARD_MAX()])
			_sfx.start_ambience("battle")
			_sfx.set_tension(0.8)
			_sfx.start_hangar()
			_sfx.start_hangar()
			_expect(_sfx._bed != null and _sfx._bed.kind == "battle", "battle bed")
			_expect(_sfx._hangar != null, "hangar layer")
			# Force the generative events now.
			_sfx._bed.next_event = 0.0
			for i in _sfx._hangar.next.size():
				_sfx._hangar.next[i] = 0.0
			_step = 1
		1:
			if t < 1.2:
				return false
			var tn = _sfx._bed.tension
			var on := 0
			for w: float in _sfx._tension_weights(tn, tn.level):
				on += 1 if w > 0.0 else 0
			var sum := 0.0
			var playing := 0
			for i in tn.weights.size():
				sum += tn.weights[i]
				playing += 1 if tn.players[i].playing else 0
			_expect(tn.level > 0.5 and on >= 1 and on <= 2 and sum > 0.8 and playing >= 1,
				"tension cross-fade (level %.2f, %d target loops, weight %.2f, %d playing)" % [tn.level, on, sum, playing])
			_expect(_sfx._bed.player.playing and _sfx._hangar.player.playing, "loops playing")
			var events := 0
			for p: AudioStreamPlayer in _sfx._music_players:
				events += 1 if p.playing else 0
			_expect(events >= 2, "ambience + hangar events playing (%d)" % events)
			_sfx.start_ambience("menu")
			_sfx.set_tension(0.0)
			_sfx.stop_hangar(0.3)
			_expect(_sfx._bed.kind == "menu" and _sfx._retired.size() == 2, "cross-fade to menu, hangar fading")
			_sfx.ftl_charge(2.0)
			_step = 2
		2:
			if t < 1.8:
				return false
			var ftl = _sfx._ftl_voice
			_sfx.ftl_drop()
			_expect(ftl != null and ftl.ends <= Time.get_ticks_usec() / 1000000.0 + 0.11, "ftl_drop cuts the charge")
			_sfx.stop_ambience(0.2)
			_sfx.start_ambience("map")
			_sfx.stop_ambience()
			_sfx.set_volume(0.0)
			_sfx.laser()
			_sfx.set_volume(0.8)
			_step = 3
		3:
			if t < 4.6:
				return false
			_expect(_sfx._retired.is_empty(), "retired layers freed (%d left)" % _sfx._retired.size())
			_expect(_sfx._bed == null and _sfx._hangar == null, "ambience stopped")
			# Priorities: at MAX_VOICES only weapons start.
			for i in 10:
				_sfx.wrong()
			var n: int = _sfx._voices.size()
			_sfx.click()
			_expect(_sfx._voices.size() == n, "UI voice dropped at MAX_VOICES")
			_sfx.hit()
			_expect(_sfx._voices.size() == mini(n + 1, Sfx_HARD_MAX()), "weapon voice above MAX_VOICES")
			# Stop everything and let the audio server drop its playbacks before quitting (no leaks).
			for p in _sfx.get_children():
				if p is AudioStreamPlayer:
					p.stop()
			_step = 4
		4:
			if t < 4.9:
				return false
			for e in _log.errors:
				_fail("engine error: " + e)
			if _fails.is_empty():
				print("audio_check: OK")
			OS.remove_logger(_log)
			quit(0 if _fails.is_empty() else 1)
			_step = 5
	return false


func Sfx_HARD_MAX() -> int:
	return _sfx.HARD_MAX
