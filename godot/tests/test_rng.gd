extends TestCase
## tests/rng.test.ts + bit-exactness against the TS rng (fixtures/rng.json, made with the TS source).


func test_is_deterministic_for_a_seed() -> void:
	var a := Rng.new(42)
	var b := Rng.new(42)
	for i in 100:
		eq(a.next(), b.next())


func test_differs_between_seeds() -> void:
	ne(Rng.new(1).next(), Rng.new(2).next())


func test_next_is_in_0_1_and_int_is_inclusive() -> void:
	var r := Rng.new(7)
	var seen := {}
	for i in 2000:
		var x := r.next()
		ge(x, 0)
		lt(x, 1)
		var n := r.next_int(3, 6)
		ge(n, 3)
		le(n, 6)
		seen[n] = true
	var keys := seen.keys()
	keys.sort()
	eq(keys, [3, 4, 5, 6])


func test_shuffle_returns_a_permutation_and_leaves_the_input_alone() -> void:
	var input := [1, 2, 3, 4, 5, 6, 7, 8]
	var out := Rng.new(3).shuffle(input)
	eq(input, [1, 2, 3, 4, 5, 6, 7, 8])
	var sorted_out := out.duplicate()
	sorted_out.sort()
	eq(sorted_out, input)


func test_pick_returns_an_element_and_errors_on_empty() -> void:
	var r := Rng.new(5)
	has(["a", "b"], r.pick(["a", "b"]))
	errors(func(): return r.pick([]))


func test_matches_the_ts_rng_bit_for_bit() -> void:
	var fx: Dictionary = fixture("rng")
	for seed in [42, 2718, 0, 4294967295]:
		# next() is u32 / 2^32: compare the exact 32-bit outputs (immune to JSON float parsing).
		var r := Rng.new(seed)
		var got: Array = []
		var want: Array = []
		for i in 10:
			got.append(int(r.next() * 4294967296.0))
			want.append(Js.round(fx[str(seed)][i] * 4294967296.0))
		eq(got, want, "next() seed %d" % seed)
		var r2 := Rng.new(seed)
		var ints: Array = []
		for i in 10:
			ints.append(r2.next_int(-5, 20))
		eq(ints, fx["%d_int" % seed], "int() seed %d" % seed)
		eq(Rng.new(seed).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), fx["%d_shuffle" % seed], "shuffle seed %d" % seed)


func test_stable_hash_matches_ts() -> void:
	var fx: Dictionary = fixture("rng").hashes
	for text in fx.keys():
		eq(Names.stable_hash(text), fx[text], "hash of '%s'" % text)
