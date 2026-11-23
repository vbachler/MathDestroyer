extends SceneTree
## Headless test runner:
##   $GODOT --headless --path godot -s res://tests/run_tests.gd [-- --only=<file substring>]
## Runs every `func test_*()` of every res://tests/test_*.gd (extends TestCase). A test fails on a
## failed assertion or on any engine / script error it reports (except inside TestCase.errors()).
## Exit code 0 when everything passes, 1 otherwise.


class ErrorCounter extends Logger:
	var count := 0
	var last := ""

	func _log_error(function: String, file: String, line: int, code: String, rationale: String,
			_editor_notify: bool, error_type: int, _script_backtrace: Array[ScriptBacktrace]) -> void:
		if error_type == ERROR_TYPE_WARNING:
			return
		count += 1
		last = "%s (%s:%d %s)" % [rationale if rationale != "" else code, file.get_file(), line, function]

	func _log_message(_message: String, _error: bool) -> void:
		pass


var _counter := ErrorCounter.new()


func _init() -> void:
	OS.add_logger(_counter)
	_run.call_deferred()


func _test_files() -> Array[String]:
	var out: Array[String] = []
	for name in DirAccess.get_files_at("res://tests"):
		var n := name.trim_suffix(".remap")
		if n.begins_with("test_") and n.ends_with(".gd") and n != "test_case.gd":
			out.append(n)
	out.sort()
	return out


func _run() -> void:
	var only := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--only="):
			only = arg.substr(7)
	var passed := 0
	var failed := 0
	var failed_names: Array[String] = []
	var t0 := Time.get_ticks_msec()
	for file in _test_files():
		if only != "" and not file.contains(only):
			continue
		var script: Script = load("res://tests/" + file)
		if script == null or not script.can_instantiate():
			print("FAIL %s: could not load (parse error?)" % file)
			failed += 1
			failed_names.append(file)
			continue
		var tc = script.new()
		if not tc is TestCase:
			continue
		tc.error_counter = func() -> int: return _counter.count
		var file_pass := 0
		var file_fail := 0
		for m in script.get_script_method_list():
			var mname: String = m.name
			if not mname.begins_with("test_"):
				continue
			tc.failures.clear()
			tc.allowed_errors = 0
			var errors_before := _counter.count
			tc.call(mname)
			var unexpected: int = _counter.count - errors_before - tc.allowed_errors
			if unexpected > 0:
				tc.failures.append("%d unexpected error(s), last: %s" % [unexpected, _counter.last])
			if tc.failures.is_empty():
				file_pass += 1
			else:
				file_fail += 1
				failed_names.append("%s::%s" % [file, mname])
				print("  FAIL %s::%s" % [file, mname])
				for f in tc.failures.slice(0, 8):
					print("      " + f)
				if tc.failures.size() > 8:
					print("      ... %d more" % (tc.failures.size() - 8))
		print("%s %s  %d passed%s" % ["ok  " if file_fail == 0 else "FAIL", file, file_pass,
			"" if file_fail == 0 else ", %d failed" % file_fail])
		passed += file_pass
		failed += file_fail
	print("")
	print("%d passed, %d failed (%d ms)" % [passed, failed, Time.get_ticks_msec() - t0])
	OS.remove_logger(_counter)
	quit(0 if failed == 0 and passed > 0 else 1)
