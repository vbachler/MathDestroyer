class_name Js
## JavaScript number semantics the port needs to reproduce the TS game exactly.
## GDScript ints are 64-bit and int / int truncates: core code divides with float() operands and
## uses these helpers wherever JS behaviour differs from GDScript's.

const U32 := 0xFFFFFFFF


## x >>> 0 for any integer (two's complement wrap to 0..2^32-1).
static func u32(x: int) -> int:
	return x & U32


## x | 0: the signed 32-bit value of x.
static func i32(x: int) -> int:
	var u := x & U32
	return u - 0x100000000 if u >= 0x80000000 else u


## Math.imul(a, b) as an unsigned 32-bit result (without 64-bit overflow).
static func imul(a: int, b: int) -> int:
	a &= U32
	b &= U32
	var hi := (((a >> 16) * b) & 0xFFFF) << 16
	return (hi + (a & 0xFFFF) * b) & U32


## Math.round: halves round up (towards +Infinity), unlike GDScript round().
static func round(x: float) -> int:
	var f := floorf(x)
	return int(f) + 1 if x - f >= 0.5 else int(f)


## Math.trunc.
static func trunc(x: float) -> int:
	return int(x)


## JS remainder for numbers (sign of the dividend), like C fmod.
static func mod(a: float, b: float) -> float:
	return fmod(a, b)


## Math.hypot(x, y) exactly as V8 computes it (scaled Kahan sum), so distance thresholds agree.
static func hypot(x: float, y: float) -> float:
	var ax := absf(x)
	var ay := absf(y)
	var m := maxf(ax, ay)
	if m == 0.0:
		return 0.0
	if is_inf(m):
		return INF
	var sum := 0.0
	var compensation := 0.0
	for v in [ax, ay]:
		var n: float = v / m
		var summand: float = n * n - compensation
		var preliminary: float = sum + summand
		compensation = (preliminary - sum) - summand
		sum = preliminary
	return sqrt(sum) * m


## String(n) for a number: integral values without a decimal point (2, -3), others as Godot's
## shortest representation (0.75, 1.25).
static func num_str(n: Variant) -> String:
	if n is int:
		return str(n)
	if n is float:
		var f: float = n
		if is_nan(f):
			return "NaN"
		if is_inf(f):
			return "Infinity" if f > 0 else "-Infinity"
		if f == floorf(f) and absf(f) < 1e15:
			return str(int(f))
		return str(f)
	return str(n)


## Number.isFinite for a Variant: an int, or a finite float.
static func is_finite_num(v: Variant) -> bool:
	if v is int:
		return true
	if v is float:
		return not is_nan(v) and not is_inf(v)
	return false


## Number.isInteger for a Variant.
static func is_integer(v: Variant) -> bool:
	if v is int:
		return true
	return v is float and is_finite_num(v) and v == floorf(v)


## A number from parsed JSON as the TS game sees it: integral floats become ints (so they print
## and serialise without ".0"); other floats stay floats.
static func norm_num(v: Variant) -> Variant:
	if v is float and v == floorf(v) and absf(v) < 9.0e15:
		return int(v)
	return v


## Stable sort like Array.prototype.sort with a comparator returning a number (< 0, 0, > 0).
## Returns a new array; `arr` is not modified.
static func sorted(arr: Array, cmp: Callable) -> Array:
	var a := arr.duplicate()
	if a.size() < 2:
		return a
	var tmp := a.duplicate()
	_merge_sort(a, tmp, 0, a.size(), cmp)
	return a


static func _merge_sort(a: Array, tmp: Array, lo: int, hi: int, cmp: Callable) -> void:
	if hi - lo < 2:
		return
	var mid := (lo + hi) >> 1
	_merge_sort(a, tmp, lo, mid, cmp)
	_merge_sort(a, tmp, mid, hi, cmp)
	var i := lo
	var j := mid
	var k := lo
	while i < mid and j < hi:
		if float(cmp.call(a[j], a[i])) < 0.0:
			tmp[k] = a[j]
			j += 1
		else:
			tmp[k] = a[i]
			i += 1
		k += 1
	while i < mid:
		tmp[k] = a[i]
		i += 1
		k += 1
	while j < hi:
		tmp[k] = a[j]
		j += 1
		k += 1
	for t in range(lo, hi):
		a[t] = tmp[t]


## Default Array.prototype.sort order for strings (UTF-16 code unit order; equal to code point
## order for the BMP text the game uses). Returns a new array.
static func sorted_strings(arr: Array) -> Array:
	return sorted(arr, func(x, y): return -1 if str(x) < str(y) else (1 if str(x) > str(y) else 0))


## Number(text) for an integer-looking input string ("-5" -> -5, "" -> 0, "-" -> NaN).
static func to_number(text: String) -> float:
	var t := text.strip_edges()
	if t == "":
		return 0.0
	if t.is_valid_int():
		return float(t.to_int())
	if t.is_valid_float():
		return t.to_float()
	return NAN
