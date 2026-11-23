class_name FactGen
## Port of src/core/factgen.ts: problem sources per sector (enumerated or generated). Pure.
## Pair = [a, b]. Fact = {id, stat_id, op, a, b, result, unknown, answer}.
## CategoryDef = {name, share, min?, max?} (min / max keys are absent when undefined).

## A sector with more possible problems than this is generated, not enumerated.
const ENUMERATION_LIMIT := 120

const ID_OP := {"add": "+", "sub": "-", "mul": "x", "div": "/"}

## Share caps of the balance rule.
const TRIVIAL_SHARE_SMALL := 0.2
const TRIVIAL_SHARE := 0.1
const OPERAND_ONE_SHARE := 0.15
const OPERAND_ONE_TARGET := 0.1

## Easy facts of the generated addition / subtraction sectors: at most 10% of the problems.
const EASY_MAX_SHARE := TRIVIAL_SHARE
## At least half of the problems need a carry / borrow where that applies.
const HARD_MIN_SHARE := 0.5

## Times tables of a multiplication / division sector.
const TABLES := {
	"mul-a": [2, 5, 10], "mul-b": [3, 4], "mul-c": [6, 7], "mul-d": [8, 9],
	"div-a": [2, 5, 10], "div-b": [3, 4], "div-c": [6, 7], "div-d": [8, 9],
}

static var _problem_cache := {}
static var _kind_cache := {}
static var _pool_cache := {}
static var _cat_re: RegEx


## a op b. Division of numbers that do not divide evenly gives a float (like JS).
static func compute(op: String, a: int, b: int) -> Variant:
	match op:
		"type":
			return a
		"add":
			return a + b
		"sub":
			return a - b
		"mul":
			return a * b
		"div":
			return a / b if b != 0 and a % b == 0 else float(a) / float(b)
	return 0


## The id of a problem; it describes the actual numbers (add:6+7, miss:add:?+7=13).
static func fact_id_of(op: String, a: int, b: int, unknown: String = "result") -> String:
	if op == "type":
		return "type:%d" % a
	if unknown == "result":
		return "%s:%d%s%d" % [op, a, ID_OP[op], b]
	var left := "?" if unknown == "a" else str(a)
	var right := "?" if unknown == "b" else str(b)
	return "miss:%s:%s%s%s=%s" % [op, left, ID_OP[op], right, Js.num_str(compute(op, a, b))]


## A fact (read-only, like the frozen TS object). `stat_id` defaults to the id (enumerated facts).
static func make_fact(op: String, a: int, b: int, unknown: String = "result", stat_id: String = "") -> Dictionary:
	var result = compute(op, a, b)
	var id := fact_id_of(op, a, b, unknown)
	var answer = a if unknown == "a" else (b if unknown == "b" else result)
	var f := {
		"id": id, "stat_id": stat_id if stat_id != "" else id, "op": op, "a": a, "b": b,
		"result": result, "unknown": unknown, "answer": answer,
	}
	f.make_read_only()
	return f


## Stat id of a category of a generated sector.
static func category_stat_id(sector_id: String, category: String) -> String:
	return "cat:%s:%s" % [sector_id, category]


## {sector_id, category} of a category stat id, or null for any other id.
static func parse_category_stat_id(stat_id: String) -> Variant:
	if _cat_re == null:
		_cat_re = RegEx.create_from_string("^cat:([^:]+):([^:]+)$")
	var m := _cat_re.search(stat_id)
	if m == null:
		return null
	return {"sector_id": m.get_string(1), "category": m.get_string(2)}


static func _pairs(a_from: int, a_to: int, b_from: int, b_to: int, keep: Callable) -> Array:
	var out: Array = []
	for a in range(a_from, a_to + 1):
		for b in range(b_from, b_to + 1):
			if keep.call(a, b):
				out.append([a, b])
	return out


static func _range(from: int, to: int) -> Array:
	var out: Array = []
	for i in range(from, to + 1):
		out.append(i)
	return out


## Units digits of a + b reach 10.
static func _carries(a: int, b: int) -> bool:
	return (a % 10) + (b % 10) >= 10


## a - b needs a borrow: the units digit of a is smaller than that of b.
static func _borrows(a: int, b: int) -> bool:
	return a % 10 < b % 10


## Trivial addition / subtraction fact: a zero operand, or (subtraction) a zero result.
static func is_trivial(f: Dictionary) -> bool:
	if f.op != "add" and f.op != "sub":
		return false
	return f.a == 0 or f.b == 0 or (f.op == "sub" and f.result == 0)


## Operand-1 fact: addition a or b = 1; subtraction b = 1 or result 1.
static func is_operand_one(f: Dictionary) -> bool:
	if f.op != "add" and f.op != "sub":
		return false
	return (f.b == 1 or f.result == 1) if f.op == "sub" else (f.a == 1 or f.b == 1)


static func _map_pairs(values: Array, fn: Callable) -> Array:
	var out: Array = []
	for v in values:
		out.append(fn.call(v))
	return out


## Easy = {trivial: [left, right], one: [left, right]}.
## 0 + b / a + 0 and 1 + b / a + 1 with the sum in [lo, hi], a <= a_to, b <= b_to.
static func _add_easy(lo: int, hi: int, a_to: int, b_to: int) -> Dictionary:
	return {
		"trivial": [
			_map_pairs(_range(lo, mini(hi, b_to)), func(b): return [0, b]),
			_map_pairs(_range(lo, mini(hi, a_to)), func(a): return [a, 0]),
		],
		"one": [
			_map_pairs(_range(lo - 1, mini(hi - 1, b_to)), func(b): return [1, b]),
			_map_pairs(_range(lo - 1, mini(hi - 1, a_to)), func(a): return [a, 1]),
		],
	}


## a − 0 / a − a and a − 1 / a − (a − 1) for a in [a_from, a_to], b <= b_to.
static func _sub_easy(a_from: int, a_to: int, b_to: int) -> Dictionary:
	return {
		"trivial": [
			_map_pairs(_range(a_from, a_to), func(a): return [a, 0]),
			_map_pairs(_range(a_from, mini(a_to, b_to)), func(a): return [a, a]),
		],
		"one": [
			_map_pairs(_range(a_from, a_to), func(a): return [a, 1]),
			_map_pairs(_range(a_from, mini(a_to, b_to + 1)), func(a): return [a, a - 1]),
		],
	}


# ---------------------------------------------------------------- enumerated sectors

## ArithmeticSpec = {op, normal: Array[Pair], easy: Easy, small: bool, seed: int}
static func _small_arithmetic(id: String) -> Variant:
	match id:
		"add-5":
			var e := _add_easy(1, 5, 5, 5)
			e["one"] = [[], []]
			return {"op": "add", "normal": _pairs(1, 4, 1, 4, func(a, b): return a + b >= 2 and a + b <= 5),
				"easy": e, "small": true, "seed": 101}
		"add-10":
			return {"op": "add", "normal": _pairs(2, 8, 2, 8, func(a, b): return a + b >= 6 and a + b <= 10),
				"easy": _add_easy(6, 10, 10, 10), "small": false, "seed": 102}
		"add-15":
			return {"op": "add", "normal": _pairs(2, 13, 2, 13, func(a, b): return a + b >= 11 and a + b <= 15),
				"easy": _add_easy(11, 15, 13, 13), "small": false, "seed": 103}
		"sub-5":
			var e := _sub_easy(2, 5, 5)
			e["one"] = [[], []]
			return {"op": "sub", "normal": _pairs(2, 5, 1, 4, func(a, b): return b < a),
				"easy": e, "small": true, "seed": 111}
		"sub-10":
			return {"op": "sub", "normal": _pairs(6, 10, 2, 8, func(a, b): return b <= a - 2),
				"easy": _sub_easy(6, 10, 10), "small": false, "seed": 112}
		"sub-15":
			return {"op": "sub", "normal": _pairs(11, 15, 2, 13, func(a, b): return b <= a - 2),
				"easy": _sub_easy(11, 15, 13), "small": false, "seed": 113}
	return null


## n pairs taken alternately left / right from the seeded shuffles of both sides.
static func _balanced_pick(rng: Rng, sides: Array, n: int) -> Array:
	var l := rng.shuffle(sides[0])
	var r := rng.shuffle(sides[1])
	var out: Array = []
	while out.size() < n and (l.size() > 0 or r.size() > 0):
		var from_left: bool = l.size() > 0 if out.size() % 2 == 0 else r.size() == 0
		out.append((l if from_left else r).pop_front())
	return out


## The whole ordinary range plus a few easy facts under the Balance rule.
static func _balanced(spec: Dictionary) -> Array:
	var rng := Rng.new(spec.seed)
	var share := TRIVIAL_SHARE_SMALL if spec.small else TRIVIAL_SHARE
	var min_trivial := 1 if spec.easy.trivial[0].size() + spec.easy.trivial[1].size() > 0 else 0
	var trivial_n := 0
	var one_n := 0
	for guard in 20:
		var total: int = spec.normal.size() + trivial_n + one_n
		var t := maxi(min_trivial, int(floorf(share * total)))
		var o := 0 if spec.small else int(floorf(OPERAND_ONE_TARGET * total))
		if t == trivial_n and o == one_n:
			break
		trivial_n = t
		one_n = o
	var trivial := _balanced_pick(rng, spec.easy.trivial, trivial_n)
	var one := _balanced_pick(rng, spec.easy.one, one_n)
	return spec.normal + trivial + one


## Facts of one times table: n x 1..10 or (n*k) / n for k in 1..10.
static func _table_facts(op: String, n: int) -> Array:
	var out: Array = []
	for i in 10:
		out.append(make_fact("mul", n, i + 1) if op == "mul" else make_fact("div", n * (i + 1), n))
	return out


static func _by_operands(x: Dictionary, y: Dictionary) -> int:
	return (x.a - y.a) if x.a != y.a else (x.b - y.b)


## Full pool of an enumerated sector in content order, or null when the sector is not enumerated.
static func _enumerated_pool(sector_id: String) -> Variant:
	var spec = _small_arithmetic(sector_id)
	if spec != null:
		var facts: Array = []
		for p in _balanced(spec):
			facts.append(make_fact(spec.op, p[0], p[1]))
		return Js.sorted(facts, _by_operands)
	if TABLES.has(sector_id):
		var out: Array = []
		for n in TABLES[sector_id]:
			out.append_array(_table_facts("mul" if sector_id.begins_with("mul") else "div", n))
		return out
	match sector_id:
		"type-1":
			return _map_pairs(_range(0, 9), func(n): return make_fact("type", n, 0))
		"type-2":
			return _map_pairs(_range(10, 99), func(n): return make_fact("type", n, 0))
		"miss-mul":
			return _map_pairs(_pairs(2, 10, 1, 10, func(_a, _b): return true), func(p): return make_fact("mul", p[0], p[1], "b"))
		"miss-div":
			return _map_pairs(_pairs(2, 10, 1, 10, func(_a, _b): return true), func(p): return make_fact("div", p[0] * p[1], p[0], "b"))
	return null


## Every problem of an enumerated sector's range before the Balance caps (for the size rule).
static func _enumerated_range_size(sector_id: String) -> int:
	var spec = _small_arithmetic(sector_id)
	if spec == null:
		var pool = _enumerated_pool(sector_id)
		return 0 if pool == null else pool.size()
	var e: Dictionary = spec.easy
	return spec.normal.size() + e.trivial[0].size() + e.trivial[1].size() + e.one[0].size() + e.one[1].size()


# ---------------------------------------------------------------- generated sectors

## CategorySource = CategoryDef + {op, unknown, problems: Callable -> Array[Pair]}

static func _sides_of(e: Dictionary) -> Array:
	return e.trivial[0] + e.trivial[1] + e.one[0] + e.one[1]


static func _filter(pairs: Array, keep: Callable) -> Array:
	var out: Array = []
	for p in pairs:
		if keep.call(p[0], p[1]):
			out.append(p)
	return out


static func _addition_categories(a_from: int, a_to: int, b_from: int, b_to: int, lo: int, hi: int) -> Array:
	var normal := func() -> Array:
		return _pairs(a_from, a_to, b_from, b_to, func(a, b): return a + b >= lo and a + b <= hi)
	return [
		{"name": "carry", "share": 0.55, "min": HARD_MIN_SHARE, "op": "add", "unknown": "result",
			"problems": func(): return _filter(normal.call(), func(a, b): return _carries(a, b))},
		{"name": "nocarry", "share": 0.37, "op": "add", "unknown": "result",
			"problems": func(): return _filter(normal.call(), func(a, b): return not _carries(a, b))},
		{"name": "easy", "share": 0.08, "max": EASY_MAX_SHARE, "op": "add", "unknown": "result",
			"problems": func(): return _sides_of(_add_easy(lo, hi, a_to, b_to))},
	]


static func _subtraction_categories(a_from: int, a_to: int, b_from: int, b_to: int) -> Array:
	var normal := func() -> Array:
		return _pairs(a_from, a_to, b_from, b_to, func(a, b): return b <= a - 3)
	return [
		{"name": "borrow", "share": 0.55, "min": HARD_MIN_SHARE, "op": "sub", "unknown": "result",
			"problems": func(): return _filter(normal.call(), func(a, b): return _borrows(a, b))},
		{"name": "noborrow", "share": 0.37, "op": "sub", "unknown": "result",
			"problems": func(): return _filter(normal.call(), func(a, b): return not _borrows(a, b))},
		{"name": "easy", "share": 0.08, "max": EASY_MAX_SHARE, "op": "sub", "unknown": "result",
			"problems": func(): return _sides_of(_sub_easy(a_from, a_to, b_to))},
	]


static func _negative_categories(lim: int, inner: int) -> Array:
	var all := func(op: String) -> Array:
		return _pairs(-lim, lim, -lim, lim, func(a, b):
			var r: int = compute(op, a, b)
			return a != 0 and b != 0 and absi(r) <= lim and (a < 0 or b < 0 or r < 0) and (absi(a) > inner or absi(b) > inner))
	return [
		{"name": "addMixed", "share": 0.3, "op": "add", "unknown": "result",
			"problems": func(): return _filter(all.call("add"), func(a, b): return (a < 0) != (b < 0))},
		{"name": "addNegNeg", "share": 0.2, "op": "add", "unknown": "result",
			"problems": func(): return _filter(all.call("add"), func(a, b): return a < 0 and b < 0)},
		{"name": "subNeg", "share": 0.25, "op": "sub", "unknown": "result",
			"problems": func(): return _filter(all.call("sub"), func(_a, b): return b < 0)},
		{"name": "subCross", "share": 0.25, "op": "sub", "unknown": "result",
			"problems": func(): return _filter(all.call("sub"), func(_a, b): return b > 0)},
	]


static func _typed(keep: Callable) -> Callable:
	return func() -> Array:
		var out: Array = []
		for x in range(100, 1000):
			if keep.call(x):
				out.append([x, 0])
		return out


static func _zero(x: int) -> bool:
	return str(x).contains("0")


static func _teen(x: int) -> bool:
	return x % 100 >= 11 and x % 100 <= 19


## The categories of each generated sector, in display order; null for other ids.
static func _generated_spec(sector_id: String) -> Variant:
	match sector_id:
		"type-3":
			return [
				{"name": "zero", "share": 0.4, "op": "type", "unknown": "result", "problems": _typed(func(x): return _zero(x))},
				{"name": "teen", "share": 0.2, "op": "type", "unknown": "result",
					"problems": _typed(func(x): return not _zero(x) and _teen(x))},
				{"name": "plain", "share": 0.4, "op": "type", "unknown": "result",
					"problems": _typed(func(x): return not _zero(x) and not _teen(x))},
			]
		"add-50":
			return _addition_categories(6, 44, 3, 29, 16, 50)
		"add-100":
			return _addition_categories(12, 88, 6, 59, 51, 100)
		"sub-50":
			return _subtraction_categories(16, 50, 3, 29)
		"sub-100":
			return _subtraction_categories(51, 100, 6, 59)
		"neg-10":
			return _negative_categories(10, 0)
		"neg-20":
			return _negative_categories(20, 10)
		"miss-add":
			var list := func(): return _pairs(1, 19, 1, 19, func(a, b): return a + b <= 20)
			return [
				{"name": "left", "share": 0.5, "op": "add", "unknown": "a", "problems": list},
				{"name": "right", "share": 0.5, "op": "add", "unknown": "b", "problems": list},
			]
		"miss-sub":
			var list := func(): return _pairs(2, 20, 1, 20, func(a, b): return b <= a)
			return [
				{"name": "left", "share": 0.5, "op": "sub", "unknown": "a", "problems": list},
				{"name": "right", "share": 0.5, "op": "sub", "unknown": "b", "problems": list},
			]
	return null


static func _category_problems(sector_id: String, source: Dictionary) -> Array:
	var key := "%s:%s" % [sector_id, source.name]
	if not _problem_cache.has(key):
		_problem_cache[key] = source.problems.call()
	return _problem_cache[key]


# ---------------------------------------------------------------- public API

## Number of possible problems of a sector's range (0 for the core and unknown ids).
static func possible_problems(sector_id: String) -> int:
	var gen = _generated_spec(sector_id)
	if gen != null:
		var n := 0
		for c in gen:
			n += _category_problems(sector_id, c).size()
		return n
	return _enumerated_range_size(sector_id)


## "enumerated" for at most ENUMERATION_LIMIT possible problems, else "generated"; null for the
## core and unknown ids.
static func sector_kind(sector_id: String) -> Variant:
	if not _kind_cache.has(sector_id):
		var n := possible_problems(sector_id)
		_kind_cache[sector_id] = null if n == 0 else ("enumerated" if n <= ENUMERATION_LIMIT else "generated")
	return _kind_cache[sector_id]


## Full pool of an enumerated sector (Balance caps applied), in content order; [] otherwise.
## Returns a fresh array (the fact dictionaries are shared: treat them as read-only).
static func sector_facts(sector_id: String) -> Array:
	if sector_kind(sector_id) != "enumerated":
		return []
	if not _pool_cache.has(sector_id):
		var pool = _enumerated_pool(sector_id)
		var frozen: Array = [] if pool == null else pool
		frozen.make_read_only()
		_pool_cache[sector_id] = frozen
	return _pool_cache[sector_id].duplicate()


## Categories of a generated sector in display order, with their shares; [] otherwise.
static func category_defs(sector_id: String) -> Array:
	if sector_kind(sector_id) != "generated":
		return []
	var out: Array = []
	var spec = _generated_spec(sector_id)
	for c in (spec if spec != null else []):
		var d := {"name": c.name, "share": c.share}
		if c.has("min"):
			d["min"] = c.min
		if c.has("max"):
			d["max"] = c.max
		out.append(d)
	return out


## Category names of a generated sector ([] for enumerated sectors and unknown ids).
static func sector_categories(sector_id: String) -> Array:
	var out: Array = []
	for c in category_defs(sector_id):
		out.append(c.name)
	return out


## A random problem of one category of a generated sector, stat_id cat:<sectorId>:<category>.
## Unknown sector or category: error and null (TS throws).
static func generate_fact(sector_id: String, category: String, rng: Rng) -> Variant:
	var source = null
	if sector_kind(sector_id) == "generated":
		for c in _generated_spec(sector_id):
			if c.name == category:
				source = c
				break
	if source == null:
		push_error("no category %s in sector %s" % [category, sector_id])
		return null
	var p: Array = rng.pick(_category_problems(sector_id, source))
	return make_fact(source.op, p[0], p[1], source.unknown, category_stat_id(sector_id, category))
