class_name PhaserRnd
extends RefCounted
## Bit-exact port of Phaser.Math.RandomDataGenerator (Alea-style), so seeded fx (WarpStreaks
## 'warp' / 'map-jump', Starfield 'mathdestroyer-stars') lay out exactly like the TS game.
##   PhaserRnd.new(["seed"])  frac()  real_in_range(min, max)  between(min, max)  integer_in_range
##   rnd()  integer()  pick(array)  normal()

var c := 1.0
var s0 := 0.0
var s1 := 0.0
var s2 := 0.0
var n := 0.0


func _init(seeds: Array = []) -> void:
	sow(seeds)


## The core generator: a float in [0, 1).
func rnd() -> float:
	var t := 2091639.0 * s0 + c * 2.3283064365386963e-10
	c = float(int(t))
	s0 = s1
	s1 = s2
	s2 = t - c
	return s2


func _hash(data: Variant) -> float:
	var text := str(data)
	var nn := n
	for i in text.length():
		nn += text.unicode_at(i)
		var h := 0.02519603282416938 * nn
		nn = float(int(h) & 0xFFFFFFFF)
		h -= nn
		h *= nn
		nn = float(int(h) & 0xFFFFFFFF)
		h -= nn
		nn += h * 4294967296.0
	n = nn
	return float(int(nn) & 0xFFFFFFFF) * 2.3283064365386963e-10


func sow(seeds: Array) -> void:
	n = float(0xefc8249d)
	s0 = _hash(" ")
	s1 = _hash(" ")
	s2 = _hash(" ")
	c = 1.0
	for seed in seeds:
		if seed == null:
			break
		s0 -= _hash(seed)
		if s0 < 0:
			s0 += 1
		s1 -= _hash(seed)
		if s1 < 0:
			s1 += 1
		s2 -= _hash(seed)
		if s2 < 0:
			s2 += 1


func integer() -> float:
	return rnd() * 4294967296.0


## Float in [0, 1) with 53 bits.
func frac() -> float:
	return rnd() + float(int(rnd() * 2097152.0)) * 1.1102230246251565e-16


func real_in_range(lo: float, hi: float) -> float:
	return frac() * (hi - lo) + lo


func integer_in_range(lo: int, hi: int) -> int:
	return int(floor(real_in_range(0, hi - lo + 1) + lo))


func between(lo: int, hi: int) -> int:
	return int(floor(real_in_range(0, hi - lo + 1) + lo))


func normal() -> float:
	return 1.0 - 2.0 * frac()


func pick(array: Array) -> Variant:
	return array[integer_in_range(0, array.size() - 1)]
