extends TestCase
## Port of tests/facts.test.ts

const ENUMERATED := [
	"type-1", "type-2", "add-5", "add-10", "add-15", "sub-5", "sub-10", "sub-15",
	"mul-a", "mul-b", "mul-c", "mul-d", "div-a", "div-b", "div-c", "div-d", "miss-mul", "miss-div",
]
const GENERATED := ["type-3", "add-50", "add-100", "sub-50", "sub-100", "neg-10", "neg-20", "miss-add", "miss-sub"]


static func _compute(f: Dictionary) -> Variant:
	match f.op:
		"type":
			return f.a
		"add":
			return f.a + f.b
		"sub":
			return f.a - f.b
		"mul":
			return f.a * f.b
		"div":
			return float(f.a) / float(f.b)
	return null


## A fact is consistent: result, answer and integers.
func _consistent(f: Dictionary) -> void:
	eq(_compute(f), f.result, f.id)
	eq(f.answer, f.a if f.unknown == "a" else (f.b if f.unknown == "b" else f.result), f.id)
	ok(Js.is_integer(f.answer) and Js.is_integer(f.result), f.id)
	if f.op == "type":
		eq([f.b, f.unknown], [0, "result"])


## The id describes the actual numbers in the documented formats.
static func _id_of(f: Dictionary) -> String:
	var sym: String = {"type": "", "add": "+", "sub": "-", "mul": "x", "div": "/"}[f.op]
	if f.op == "type":
		return "type:%s" % Js.num_str(f.a)
	if f.unknown == "result":
		return "%s:%s%s%s" % [f.op, Js.num_str(f.a), sym, Js.num_str(f.b)]
	return "miss:%s:%s%s%s=%s" % [f.op, "?" if f.unknown == "a" else Js.num_str(f.a), sym,
		"?" if f.unknown == "b" else Js.num_str(f.b), Js.num_str(f.result)]


static func _ids(list: Array) -> Array:
	return list.map(func(f): return f.id)


# ---------------------------------------------------------------- sector kinds

func test_a_sector_is_enumerated_up_to_120_possible_problems_else_generated() -> void:
	eq(FactGen.ENUMERATION_LIMIT, 120)
	for id in ENUMERATED:
		eq(Facts.sector_kind(id), "enumerated", id)
		le(FactGen.possible_problems(id), 120, id)
		eq(Facts.sector_categories(id), [])
	for id in GENERATED:
		eq(Facts.sector_kind(id), "generated", id)
		gt(FactGen.possible_problems(id), 120, id)
		eq(Facts.sector_facts(id), [])
		ge(Facts.sector_categories(id).size(), 2, id)
		le(Facts.sector_categories(id).size(), 4, id)
	eq(Js.sorted_strings(ENUMERATED + GENERATED + ["core"]), Js.sorted_strings(_ids(Content.sectors())))
	is_null(Facts.sector_kind("core"))
	is_null(Facts.sector_kind("nope"))
	eq(Facts.sector_facts("core"), [])
	eq(Facts.sector_facts("add-20"), [])


func test_categories_of_the_generated_sectors() -> void:
	var got := {}
	for id in GENERATED:
		got[id] = Facts.sector_categories(id)
	eq(got, {
		"type-3": ["zero", "teen", "plain"],
		"add-50": ["carry", "nocarry", "easy"],
		"add-100": ["carry", "nocarry", "easy"],
		"sub-50": ["borrow", "noborrow", "easy"],
		"sub-100": ["borrow", "noborrow", "easy"],
		"neg-10": ["addMixed", "addNegNeg", "subNeg", "subCross"],
		"neg-20": ["addMixed", "addNegNeg", "subNeg", "subCross"],
		"miss-add": ["left", "right"],
		"miss-sub": ["left", "right"],
	})


# ---------------------------------------------------------------- enumerated sectors

func test_pool_sizes_the_full_enumeration_of_each_range() -> void:
	var sizes := {}
	for id in ENUMERATED:
		sizes[id] = Facts.sector_facts(id).size()
	eq(sizes, {
		"type-1": 10, "type-2": 90, "add-5": 12, "add-10": 29, "add-15": 62, "sub-5": 12, "sub-10": 29, "sub-15": 62,
		"mul-a": 30, "mul-b": 20, "mul-c": 20, "mul-d": 20, "div-a": 30, "div-b": 20, "div-c": 20, "div-d": 20,
		"miss-mul": 90, "miss-div": 90,
	})
	eq(Facts.all_facts().size(), 666)


static func _each(a0: int, a1: int, b0: int, b1: int, keep: Callable, id: Callable) -> Array:
	var out: Array = []
	for a in range(a0, a1 + 1):
		for b in range(b0, b1 + 1):
			if keep.call(a, b):
				out.append(id.call(a, b))
	return out


static func _id_set(sector_id: String) -> Dictionary:
	var out := {}
	for f in Facts.sector_facts(sector_id):
		out[f.id] = true
	return out


func _expect_all(sector_id: String, list: Array) -> void:
	var have := _id_set(sector_id)
	for x in list:
		ok(have.has(x), "%s %s" % [sector_id, x])


func test_holds_every_problem_of_the_ordinary_range_not_a_sample() -> void:
	var all := func(_a, _b): return true
	var add := func(a, b): return "add:%d+%d" % [a, b]
	var sub := func(a, b): return "sub:%d-%d" % [a, b]
	eq(Js.sorted_strings(_id_set("type-1").keys()), Js.sorted_strings(_each(0, 9, 0, 0, all, func(a, _b): return "type:%d" % a)))
	eq(Js.sorted_strings(_id_set("type-2").keys()), Js.sorted_strings(_each(10, 99, 0, 0, all, func(a, _b): return "type:%d" % a)))
	_expect_all("add-5", _each(1, 4, 1, 4, func(a, b): return a + b >= 2 and a + b <= 5, add))
	_expect_all("add-10", _each(2, 8, 2, 8, func(a, b): return a + b >= 6 and a + b <= 10, add))
	_expect_all("add-15", _each(2, 13, 2, 13, func(a, b): return a + b >= 11 and a + b <= 15, add))
	_expect_all("sub-5", _each(2, 5, 1, 4, func(a, b): return b < a, sub))
	_expect_all("sub-10", _each(6, 10, 2, 8, func(a, b): return b <= a - 2, sub))
	_expect_all("sub-15", _each(11, 15, 2, 13, func(a, b): return b <= a - 2, sub))
	eq(Js.sorted_strings(_id_set("miss-mul").keys()),
		Js.sorted_strings(_each(2, 10, 1, 10, all, func(a, b): return "miss:mul:%dx?=%d" % [a, a * b])))
	eq(Js.sorted_strings(_id_set("miss-div").keys()),
		Js.sorted_strings(_each(2, 10, 1, 10, all, func(n, k): return "miss:div:%d/?=%d" % [n * k, k])))
	var mul: Array = []
	for id in ["mul-a", "mul-b", "mul-c", "mul-d"]:
		mul.append_array(Facts.sector_facts(id))
	var div: Array = []
	for id in ["div-a", "div-b", "div-c", "div-d"]:
		div.append_array(Facts.sector_facts(id))
	for n in range(2, 11):
		var want_mul: Array = []
		var want_div: Array = []
		for k in 10:
			want_mul.append([n, k + 1])
			want_div.append([n * (k + 1), n, k + 1])
		eq(mul.filter(func(f): return f.a == n).map(func(f): return [f.a, f.b]), want_mul)
		eq(div.filter(func(f): return f.b == n).map(func(f): return [f.a, f.b, f.result]), want_div)


func test_balance_rule_caps_on_trivial_and_operand_1_facts_left_right_balance_ranges_kept_no_0_plus_0() -> void:
	var minuend_or_sum := {
		"add-5": [1, 5], "add-10": [6, 10], "add-15": [11, 15], "sub-5": [2, 5], "sub-10": [6, 10], "sub-15": [11, 15],
	}
	for id in minuend_or_sum:
		var lo: int = minuend_or_sum[id][0]
		var hi: int = minuend_or_sum[id][1]
		var facts := Facts.sector_facts(id)
		var small: bool = id.ends_with("-5")
		var trivial: Array = facts.filter(func(f): return FactGen.is_trivial(f))
		ge(trivial.size(), 1, id)
		le(float(trivial.size()) / facts.size(), FactGen.TRIVIAL_SHARE_SMALL if small else FactGen.TRIVIAL_SHARE, id)
		if not small:
			var ones: Array = facts.filter(func(f): return FactGen.is_operand_one(f))
			ge(ones.size(), 1, id)
			le(float(ones.size()) / facts.size(), FactGen.OPERAND_ONE_SHARE, id)
		var left: int = trivial.filter(func(f): return f.a == 0 if f.op == "add" else f.b == 0).size()
		le(absi(left - (trivial.size() - left)), 1, id)
		for f in facts:
			var v: int = f.result if f.op == "add" else f.a
			ok(v >= lo and v <= hi, f.id)
			ok(f.a >= 0 and f.b >= 0 and f.result >= 0, f.id)
			no(f.a == 0 and f.b == 0, f.id)
	is_null(Facts.fact_by_id("add:0+0"))
	is_null(Facts.fact_by_id("sub:0-0"))


func test_every_fact_is_consistent_uses_its_id_as_stat_id_and_the_documented_id_format() -> void:
	var ids := _ids(Facts.all_facts())
	var uniq := {}
	for id in ids:
		uniq[id] = true
	eq(uniq.size(), ids.size())
	for f in Facts.all_facts():
		_consistent(f)
		eq(f.stat_id, f.id)
		eq(f.id, _id_of(f))
		ok(f.is_read_only(), "%s is frozen" % f.id)


func test_pins_ids_that_saved_stats_are_keyed_by() -> void:
	var pinned := [
		["type:7", 7], ["type:0", 0], ["type:42", 42],
		["add:1+1", 2], ["add:2+3", 5], ["add:6+3", 9], ["add:6+7", 13],
		["sub:5-4", 1], ["sub:9-4", 5], ["sub:15-8", 7],
		["mul:7x8", 56], ["mul:2x1", 2], ["mul:10x10", 100],
		["div:56/7", 8], ["div:100/10", 10], ["div:18/9", 2],
		["miss:mul:3x?=12", 4], ["miss:div:18/?=6", 3],
	]
	for p in pinned:
		var f = Facts.fact_by_id(p[0])
		eq(f.answer if f != null else null, p[1], p[0])


func test_returns_fresh_arrays_callers_cannot_corrupt_the_cache() -> void:
	var a := Facts.sector_facts("mul-b")
	a.pop_back()
	eq(Facts.sector_facts("mul-b").size(), 20)
	var all := Facts.all_facts()
	all.pop_back()
	eq(Facts.all_facts().size(), all.size() + 1)


# ---------------------------------------------------------------- generated sectors

## Independent definition of each generated sector's range and categories.
static func _check(sector_id: String, f: Dictionary, c: String) -> bool:
	match sector_id:
		"type-3":
			var zero := str(f.a).contains("0")
			var teen: bool = f.a % 100 >= 11 and f.a % 100 <= 19
			var in_range: bool = f.op == "type" and f.a >= 100 and f.a <= 999
			return in_range and (zero if c == "zero" else ((not zero and teen) if c == "teen" else (not zero and not teen)))
		"add-50":
			return _add_check(f, c, 6, 44, 3, 29, 16, 50)
		"add-100":
			return _add_check(f, c, 12, 88, 6, 59, 51, 100)
		"sub-50":
			return _sub_check(f, c, 16, 50, 3, 29)
		"sub-100":
			return _sub_check(f, c, 51, 100, 6, 59)
		"neg-10":
			return _neg_check(f, c, 10, 0)
		"neg-20":
			return _neg_check(f, c, 20, 10)
		"miss-add":
			return f.op == "add" and f.a >= 1 and f.b >= 1 and f.result <= 20 and f.unknown == ("a" if c == "left" else "b")
		"miss-sub":
			return f.op == "sub" and f.a <= 20 and f.b >= 1 and f.result >= 0 and f.unknown == ("a" if c == "left" else "b")
	return false


static func _add_check(f: Dictionary, c: String, a0: int, a1: int, b0: int, b1: int, lo: int, hi: int) -> bool:
	if f.op != "add" or f.unknown != "result" or f.result < lo or f.result > hi or f.a > a1 or f.b > b1:
		return false
	var carry: bool = (f.a % 10) + (f.b % 10) >= 10
	if c == "easy":
		return f.a <= 1 or f.b <= 1
	return f.a >= a0 and f.b >= b0 and (carry if c == "carry" else not carry)


static func _sub_check(f: Dictionary, c: String, a0: int, a1: int, b0: int, b1: int) -> bool:
	if f.op != "sub" or f.unknown != "result" or f.a < a0 or f.a > a1 or f.b > b1 or f.result < 0:
		return false
	var borrow: bool = f.a % 10 < f.b % 10
	if c == "easy":
		return f.b == 0 or f.b == 1 or f.result == 0 or f.result == 1
	return f.b >= b0 and f.b <= f.a - 3 and (borrow if c == "borrow" else not borrow)


static func _neg_check(f: Dictionary, c: String, lim: int, inner: int) -> bool:
	var a: int = f.a
	var b: int = f.b
	var r: int = f.result
	var good: bool = f.unknown == "result" and a != 0 and b != 0 and absi(a) <= lim and absi(b) <= lim and absi(r) <= lim \
		and (a < 0 or b < 0 or r < 0) and (absi(a) > inner or absi(b) > inner)
	if not good:
		return false
	match c:
		"addMixed":
			return f.op == "add" and (a < 0) != (b < 0)
		"addNegNeg":
			return f.op == "add" and a < 0 and b < 0
		"subNeg":
			return f.op == "sub" and b < 0
		"subCross":
			return f.op == "sub" and b > 0 and r < 0
	return false


func test_every_draw_lies_inside_the_sector_range_and_its_category_many_seeded_draws() -> void:
	for sector_id in GENERATED:
		for category in Facts.sector_categories(sector_id):
			var rng := Rng.new(1000 + category.length())
			var seen := {}
			for i in 400:
				var f: Dictionary = Facts.generate_fact(sector_id, category, rng)
				ok(_check(sector_id, f, category), "%s/%s: %s" % [sector_id, category, f.id])
				_consistent(f)
				eq(f.id, _id_of(f))
				eq(f.stat_id, "cat:%s:%s" % [sector_id, category])
				seen[f.id] = true
			gt(seen.size(), 20, "%s/%s" % [sector_id, category])   # real variety


func _draw(seed: int) -> Array:
	var rng := Rng.new(seed)
	var out: Array = []
	for i in 20:
		out.append(Facts.generate_fact("add-100", "carry", rng).id)
	return out


func test_is_deterministic_for_a_seed_and_differs_between_seeds() -> void:
	eq(_draw(7), _draw(7))
	ne(_draw(7), _draw(8))


func test_rejects_unknown_sectors_and_categories() -> void:
	var rng := Rng.new(1)
	errors(func(): return Facts.generate_fact("add-100", "borrow", rng))
	errors(func(): return Facts.generate_fact("add-10", "carry", rng))
	errors(func(): return Facts.generate_fact("nope", "x", rng))


func test_category_stat_ids_round_trip_and_map_to_their_sector() -> void:
	eq(Facts.category_stat_id("add-100", "carry"), "cat:add-100:carry")
	eq(Facts.parse_category_stat_id("cat:add-100:carry"), {"sector_id": "add-100", "category": "carry"})
	is_null(Facts.parse_category_stat_id("add:6+7"))
	eq(Facts.sector_stat_ids("sub-50"), ["cat:sub-50:borrow", "cat:sub-50:noborrow", "cat:sub-50:easy"])
	eq(Facts.sector_stat_ids("mul-b"), _ids(Facts.sector_facts("mul-b")))
	eq(Facts.sector_stat_ids("core"), [])
	eq(Facts.sector_of_stat("cat:sub-50:borrow"), "sub-50")
	is_null(Facts.sector_of_stat("cat:sub-50:carry"))
	eq(Facts.sector_of_stat("mul:7x8"), "mul-c")
	eq(Facts.sector_of_stat("type:42"), "type-2")
	is_null(Facts.sector_of_stat("add:86+3"))
	is_null(Facts.sector_of_stat("miss:add:?+7=13"))   # an old sample id: miss-add is generated now


# ---------------------------------------------------------------- formatProblem

## A fact with the given fields (formatProblem tests).
static func _mk(p: Dictionary) -> Dictionary:
	var f := {"id": "x", "stat_id": "x", "op": "add", "a": 0, "b": 0, "result": 0, "unknown": "result", "answer": 0}
	f.merge(p, true)
	return f


func test_formats_multiplication_and_division_per_locale() -> void:
	var mul := fact("mul:7x8")
	eq(Facts.format_problem(mul, "hr"), "7 · 8")
	eq(Facts.format_problem(mul, "en"), "7 × 8")
	var div := fact("div:56/7")
	eq(Facts.format_problem(div, "hr"), "56 : 7")
	eq(Facts.format_problem(div, "en"), "56 ÷ 7")


func test_formats_addition_subtraction_and_typing() -> void:
	eq(Facts.format_problem(fact("add:6+7"), "hr"), "6 + 7")
	eq(Facts.format_problem(fact("sub:9-4"), "en"), "9 − 4")
	eq(Facts.format_problem(fact("type:7"), "hr"), "7")


func test_formats_missing_number_forms_with_question_mark_and_the_result() -> void:
	var miss_mul := _mk({"op": "mul", "a": 7, "b": 8, "result": 56, "unknown": "b", "answer": 8})
	eq(Facts.format_problem(miss_mul, "hr"), "7 · ? = 56")
	eq(Facts.format_problem(miss_mul, "en"), "7 × ? = 56")
	var miss_add := _mk({"op": "add", "a": 6, "b": 7, "result": 13, "unknown": "a", "answer": 6})
	eq(Facts.format_problem(miss_add, "hr"), "? + 7 = 13")
	var miss_div := _mk({"op": "div", "a": 56, "b": 7, "result": 8, "unknown": "b", "answer": 7})
	eq(Facts.format_problem(miss_div, "hr"), "56 : ? = 8")
	eq(Facts.format_problem(miss_div, "en"), "56 ÷ ? = 8")
	var rng := Rng.new(4)
	for i in 50:
		var right: Dictionary = Facts.generate_fact("miss-sub", "right", rng)
		eq(Facts.format_problem(right, "en"), "%s − ? = %s" % [Js.num_str(right.a), Js.num_str(right.result)])
		var left: Dictionary = Facts.generate_fact("miss-sub", "left", rng)
		eq(Facts.format_problem(left, "en"), "? − %s = %s" % [Js.num_str(left.b), Js.num_str(left.result)])


func test_formats_negatives_with_the_real_minus_and_brackets_on_the_right_operand() -> void:
	eq(Facts.format_problem(_mk({"op": "sub", "a": 5, "b": -3, "result": 8, "answer": 8}), "hr"), "5 − (−3)")
	eq(Facts.format_problem(_mk({"op": "add", "a": -4, "b": 6, "result": 2, "answer": 2}), "en"), "−4 + 6")
	eq(Facts.format_problem(_mk({"op": "add", "a": -4, "b": -6, "result": -10, "answer": -10}), "en"), "−4 + (−6)")
	var rng := Rng.new(5)
	for i in 200:
		var f: Dictionary = Facts.generate_fact("neg-20", rng.pick(Facts.sector_categories("neg-20")), rng)
		var s := Facts.format_problem(f, "hr")
		no(s.contains("-"), s)
		if f.b < 0:
			has(s, "(−")


func test_format_solved_shows_the_complete_fact() -> void:
	eq(Facts.format_solved(_mk({"op": "mul", "a": 7, "b": 8, "result": 56, "unknown": "b", "answer": 8}), "hr"), "7 · 8 = 56")
	eq(Facts.format_solved(_mk({"op": "sub", "a": 5, "b": -3, "result": 8, "answer": 8}), "en"), "5 − (−3) = 8")
