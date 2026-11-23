class_name Rng
extends RefCounted
## Seeded pseudo-random generator (mulberry32), bit-exact port of src/core/rng.ts.
## Deterministic for a seed. `Rng.new(seed)`.
##   next()            float in [0, 1)
##   next_int(min, max) integer in [min, max], both inclusive   (TS: int)
##   pick(arr)         random element of a non-empty array (null + error on empty; TS throws)
##   shuffle(arr)      new array in random order (Fisher-Yates); the input is not modified

var _s: int


func _init(seed: int = 0) -> void:
	_s = seed & Js.U32


func next() -> float:
	_s = (_s + 0x6D2B79F5) & Js.U32
	var t := _s
	t = Js.imul(t ^ (t >> 15), t | 1)
	t ^= (t + Js.imul(t ^ (t >> 7), t | 61)) & Js.U32
	t &= Js.U32
	return float((t ^ (t >> 14)) & Js.U32) / 4294967296.0


func next_int(min_v: int, max_v: int) -> int:
	return min_v + int(floorf(next() * float(max_v - min_v + 1)))


func pick(arr: Array) -> Variant:
	if arr.is_empty():
		push_error("pick from empty array")
		return null
	return arr[next_int(0, arr.size() - 1)]


func shuffle(arr: Array) -> Array:
	var out := arr.duplicate()
	var i := out.size() - 1
	while i > 0:
		var j := next_int(0, i)
		var tmp = out[i]
		out[i] = out[j]
		out[j] = tmp
		i -= 1
	return out
