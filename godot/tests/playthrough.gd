extends SceneTree
## Scripted play-through of one mission (not part of run_tests: it plays ~3 minutes of game time).
##   $GODOT --headless --path godot --fixed-fps 60 -s res://tests/playthrough.gd [-- --planet=add-10.1]
## Starts Battle on a fresh in-memory save (the real save file is not touched) and plays it through
## the same input path as the keyboard (key events pushed into the root viewport): answers the
## lowest enemy, now and then a wrong answer, lets one enemy reach the stations (explanation), picks
## the first upgrade card between waves, forces one breach (the dev hook) and fights the boarding
## (letting one crawler bite), until Results; then Enter goes on to the star map. Exit 0 when the
## mission reached Results with every step seen and no engine / script error.

const MAX_FRAMES := 60 * 60 * 8

class ErrorCounter extends Logger:
	var count := 0
	var last := ""

	func _log_error(function: String, file: String, line: int, code: String, rationale: String,
			_editor_notify: bool, error_type: int, _script_backtrace: Array[ScriptBacktrace]) -> void:
		if error_type == ERROR_TYPE_WARNING:
			return
		count += 1
		last = "%s (%s:%d %s)" % [rationale if rationale != "" else code, file.get_file(), line, function]
		printerr("[playthrough] engine error: ", last)

	func _log_message(_message: String, _error: bool) -> void:
		pass


var _errors := ErrorCounter.new()
var _frame := 0
var _cooldown := 0
var _answers := 0
var _sim: BattleSim = null
var _seen := {}
var _breach_forced := false
var _results_seen_at := -1
var _planet := "add-10.1"
var _quit_at := 0


func _init() -> void:
	OS.add_logger(_errors)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--planet="):
			_planet = arg.substr(9)
		elif arg.begins_with("--quit-at="):
			_quit_at = arg.substr(10).to_int()
	_start.call_deferred()


func _start() -> void:
	var app: Node = root.get_node("App")
	app.storage = Save.MemoryStorage.new()
	app.save = Save.default_save()
	Tex.generate_textures()
	Assets.load_all_now()
	var sfx: Node = root.get_node("Sfx")
	sfx.configure(0.8, 0.6)
	# A method Callable, not a lambda: a lambda of this -s script left in the static var crashes at exit.
	UiButton.click_sound = Callable(sfx, "click")
	app.goto("battle", {"planet_id": _planet})
	process_frame.connect(_tick)


func _key(keycode: int, unicode: int = 0) -> void:
	for pressed in [true, false]:
		var ev := InputEventKey.new()
		ev.keycode = keycode as Key
		ev.physical_keycode = keycode as Key
		ev.unicode = unicode
		ev.pressed = pressed
		root.push_input(ev)


func _type(value: int) -> void:
	for ch in str(value):
		if ch == "-":
			_key(KEY_MINUS, "-".unicode_at(0))
		else:
			_key(KEY_0 + ch.to_int(), ch.unicode_at(0))
	_key(KEY_ENTER)


func _note(what: String) -> void:
	if not _seen.has(what):
		_seen[what] = _frame
		print("[playthrough] frame %d: %s" % [_frame, what])


func _tick() -> void:
	_frame += 1
	if _quit_at > 0 and _frame >= _quit_at:
		quit(0)
		return
	if _frame > MAX_FRAMES:
		_done(false, "timed out")
		return
	var app: Node = root.get_node("App")
	var battle = app.scene("battle")
	var boarding = app.scene("boarding")
	var upgrade = app.scene("upgrade")
	var current = app.current_scene
	if _results_seen_at < 0 and current != null and current.scene_name == "results":
		_note("results")
		_results_seen_at = _frame
	if _results_seen_at >= 0:
		if _frame == _results_seen_at + 120:
			_key(KEY_ENTER)
		elif _frame > _results_seen_at + 180:
			var now_name: String = app.current_scene.scene_name if app.current_scene != null else ""
			_done(now_name == "star_map", "after Enter the scene is '%s'" % now_name)
		return
	if battle == null or battle.sim == null:
		return
	_sim = battle.sim
	var s: Dictionary = battle.sim.state
	if s.hull < s.hull_max:
		_note("ship hit")
	if not s.missed.is_empty():
		_note("enemy reached a station")
	if s.phase == "explaining":
		_note("explanation card")
	_cooldown -= 1
	if _cooldown > 0:
		return
	if upgrade != null:
		_note("upgrade overlay (wave %d cleared)" % s.wave)
		_key(KEY_1, "1".unicode_at(0))
		_cooldown = 90
		return
	if boarding != null:
		_note("boarding")
		_play_boarding(boarding)
		return
	if s.phase != "spawning" or s.enemies.is_empty() or not battle._accepts_input():
		return
	var lowest = null
	for e in s.enemies:
		if lowest == null or e.y > lowest.y:
			lowest = e
	# Wave 1: let the first enemy reach the stations (explanation), then answer.
	if s.wave == 1 and s.missed.is_empty() and s.kills >= 2:
		return
	# Wave 2: force one breach through the dev hook (the real shipHit / breach / Boarding path).
	if s.wave == 2 and not _breach_forced and s.kills >= 1:
		if battle.dev_force_breach():
			_breach_forced = true
			_note("breach forced")
		return
	_answers += 1
	if _answers % 6 == 0:
		_note("wrong answer")
		_type(lowest.fact.answer + 1)
	else:
		_type(lowest.fact.answer)
	_cooldown = 45


func _play_boarding(boarding: Node) -> void:
	var st: Dictionary = boarding.sim.state
	if st.phase != "fighting" or st.crawlers.is_empty():
		return
	# Let one crawler bite first.
	if st.bites == 0:
		return
	_note("crawler bite")
	var nearest = null
	for c in st.crawlers:
		if nearest == null or c.z < nearest.z:
			nearest = c
	_type(nearest.fact.answer)
	_cooldown = 25


func _done(ok: bool, why: String) -> void:
	process_frame.disconnect(_tick)
	var need := ["ship hit", "breach forced", "boarding", "crawler bite", "upgrade overlay (wave 1 cleared)",
		"enemy reached a station", "explanation card", "wrong answer", "results"]
	var missing: Array = []
	for n in need:
		if not _seen.has(n):
			missing.append(n)
	if _sim != null:
		var s := _sim.state
		print("[playthrough] phase %s, wave %d/%d, score %d, kills %d, wrong %d, boardings %d, records %d, accuracy %.2f" % [
			s.phase, s.wave, s.total_waves, s.score, s.kills, s.wrong_answers, s.boardings, _sim.records.size(), _sim.accuracy()])
	var passed := ok and missing.is_empty() and _errors.count == 0
	if not ok:
		print("[playthrough] FAIL: ", why)
	if not missing.is_empty():
		print("[playthrough] FAIL: not seen: ", ", ".join(missing))
	if _errors.count > 0:
		print("[playthrough] FAIL: %d engine error(s), last: %s" % [_errors.count, _errors.last])
	print("[playthrough] %s in %d frames" % ["PASS" if passed else "FAIL", _frame])
	OS.remove_logger(_errors)
	quit(0 if passed else 1)
