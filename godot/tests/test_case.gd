class_name TestCase
extends RefCounted
## Base of every test file (res://tests/test_*.gd). Each `func test_*()` is one test; the runner
## (run_tests.gd) calls them in file order. Assertion helpers mirror vitest's expect():
##   eq(a, b)            toBe / toEqual (deep; ints and floats compare by value)
##   ne(a, b)            not.toBe / not.toEqual
##   ok(cond) / no(cond) toBe(true) / toBe(false)
##   close(a, b, digits) toBeCloseTo (default 2 digits: |a - b| < 10^-digits / 2)
##   gt / ge / lt / le   toBeGreaterThan / ...OrEqual / toBeLessThan / ...OrEqual
##   has(container, x)   toContain (Array element, String substring, Dictionary key)
##   is_null / not_null  toBeNull / toBeDefined-ish
##   errors(callable)    toThrow: the callable must report an error (push_error); GDScript has no
##                       exceptions, so ported code that throws in TS calls push_error and returns null.
## Any engine / script error during a test that is not inside errors() fails the test.

const NOW := 1_700_000_000_000
const DAY := 24 * 3600e3

var failures: Array[String] = []
## Set by the runner: returns the number of errors reported so far.
var error_counter: Callable
## Errors expected by errors() in the current test (they do not fail it).
var allowed_errors := 0


func fail(msg: String) -> void:
	failures.append(msg)


## Deep equality; numbers compare by value. `tol` > 0 allows a relative difference (fixture data:
## Godot's JSON parser does not round every decimal to the nearest double).
static func deep_eq(a: Variant, b: Variant, tol: float = 0.0) -> bool:
	var na := a is int or a is float
	var nb := b is int or b is float
	if na or nb:
		if not (na and nb):
			return false
		if is_nan(float(a)) and is_nan(float(b)):
			return true
		if tol > 0.0:
			return absf(float(a) - float(b)) <= tol * maxf(1.0, maxf(absf(float(a)), absf(float(b))))
		return float(a) == float(b)
	if a is String or a is StringName:
		return (b is String or b is StringName) and str(a) == str(b)
	if a is Array:
		if not b is Array or a.size() != b.size():
			return false
		for i in a.size():
			if not deep_eq(a[i], b[i], tol):
				return false
		return true
	if a is Dictionary:
		if not b is Dictionary or a.size() != b.size():
			return false
		for k in a.keys():
			if not b.has(k) or not deep_eq(a[k], b[k], tol):
				return false
		return true
	if typeof(a) != typeof(b):
		return false
	return a == b


static func show(v: Variant) -> String:
	var s := JSON.stringify(v) if (v is Array or v is Dictionary) else var_to_str(v)
	return s if s.length() <= 300 else s.substr(0, 300) + "..."


func eq(actual: Variant, expected: Variant, msg: String = "") -> bool:
	if deep_eq(actual, expected):
		return true
	fail("%sexpected %s, got %s" % [_pre(msg), show(expected), show(actual)])
	return false


## eq() for values read from fixtures: numbers may differ by 1e-12 relative (JSON parse rounding).
func eqf(actual: Variant, expected: Variant, msg: String = "") -> bool:
	if deep_eq(actual, expected, 1e-12):
		return true
	fail("%sexpected %s, got %s" % [_pre(msg), show(expected), show(actual)])
	return false


func ne(actual: Variant, expected: Variant, msg: String = "") -> bool:
	if not deep_eq(actual, expected):
		return true
	fail("%sexpected something other than %s" % [_pre(msg), show(expected)])
	return false


func ok(cond: bool, msg: String = "") -> bool:
	if cond:
		return true
	fail("%sexpected true" % _pre(msg))
	return false


func no(cond: bool, msg: String = "") -> bool:
	if not cond:
		return true
	fail("%sexpected false" % _pre(msg))
	return false


func close(actual: float, expected: float, digits: int = 2, msg: String = "") -> bool:
	if absf(actual - expected) < pow(10.0, -digits) / 2.0:
		return true
	fail("%sexpected %s to be close to %s (%d digits)" % [_pre(msg), actual, expected, digits])
	return false


func gt(a: float, b: float, msg: String = "") -> bool:
	return ok(a > b, "%s%s > %s" % [_pre(msg), a, b])


func ge(a: float, b: float, msg: String = "") -> bool:
	return ok(a >= b, "%s%s >= %s" % [_pre(msg), a, b])


func lt(a: float, b: float, msg: String = "") -> bool:
	return ok(a < b, "%s%s < %s" % [_pre(msg), a, b])


func le(a: float, b: float, msg: String = "") -> bool:
	return ok(a <= b, "%s%s <= %s" % [_pre(msg), a, b])


func has(container: Variant, x: Variant, msg: String = "") -> bool:
	var found := false
	if container is String:
		found = container.contains(str(x))
	elif container is Dictionary:
		found = container.has(x)
	elif container is Array:
		for e in container:
			if deep_eq(e, x):
				found = true
				break
	if found:
		return true
	fail("%sexpected %s to contain %s" % [_pre(msg), show(container), show(x)])
	return false


func is_null(v: Variant, msg: String = "") -> bool:
	if v == null:
		return true
	fail("%sexpected null, got %s" % [_pre(msg), show(v)])
	return false


func not_null(v: Variant, msg: String = "") -> bool:
	if v != null:
		return true
	fail("%sexpected a value, got null" % _pre(msg))
	return false


## The callable must report at least one error (TS: toThrow). Returns its result.
func errors(fn: Callable, msg: String = "") -> Variant:
	var before: int = error_counter.call()
	var result = fn.call()
	var after: int = error_counter.call()
	allowed_errors += after - before
	if after <= before:
		fail("%sexpected an error" % _pre(msg))
	return result


func _pre(msg: String) -> String:
	return "" if msg == "" else msg + ": "


## Reads res://tests/fixtures/<name>.json (reference values produced by the TS game).
static func fixture(name: String) -> Variant:
	var text := FileAccess.get_file_as_string("res://tests/fixtures/%s.json" % name)
	return Save.parse_json(text)


# ---- tests/helpers.ts

## FactStats at a box (attempts 3, correct 2, avg 2000 ms, not due unless due_at is overridden).
static func stat(box: int, over: Dictionary = {}) -> Dictionary:
	var s := {"box": box, "attempts": 3, "correct": 2, "avg_ms": 2000, "last_seen": NOW - DAY, "due_at": NOW + DAY}
	s.merge(over, true)
	return s


## Every stat id of the given sectors at one box.
static func stats_for(sector_ids: Array, box: int, over: Dictionary = {}) -> Dictionary:
	var out := {}
	for id in sector_ids:
		for s in Facts.sector_stat_ids(id):
			out[s] = stat(box, over)
	return out


## Planet progress at a level (not due unless due_at is overridden).
static func progress(level: int, over: Dictionary = {}) -> Dictionary:
	var p := {"level": level, "due_at": NOW + DAY, "wins": level}
	p.merge(over, true)
	return p


## Planet ids of a sector, in sector order.
static func planet_ids(sector_id: String) -> Array:
	var out: Array = []
	for p in Content.planets_of_sector(sector_id):
		out.append(p.id)
	return out


## An enumerated fact by id (fails the lookup loudly when unknown).
static func fact(id: String) -> Dictionary:
	var f = Facts.fact_by_id(id)
	if f == null:
		push_error("unknown fact %s" % id)
		return {}
	return f
