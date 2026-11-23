extends TestCase
## Port of tests/mastery.test.ts


func _due(box: int) -> Dictionary:
	return stat(box, {"due_at": NOW})          # due exactly now


func _not_due(box: int) -> Dictionary:
	return stat(box, {"due_at": NOW + 1})      # due 1 ms later


func _won(accuracy: float, now: float = NOW) -> Dictionary:
	return {"won": true, "accuracy": accuracy, "now": now}


func _lost() -> Dictionary:
	return {"won": false, "accuracy": 1, "now": NOW}


func _with(d: Dictionary, over: Dictionary) -> Dictionary:
	var out := d.duplicate()
	out.merge(over, true)
	return out


# ---- classify

func test_classify_uses_3000_ms_plus_700_ms_per_extra_answer_digit() -> void:
	var one := fact("mul:2x3")      # answer 6
	eq(Mastery.fast_threshold_ms(one), 3000)
	eq(Mastery.classify(one, true, 3000), "fast")
	eq(Mastery.classify(one, true, 3001), "slow")
	var two := fact("mul:7x8")      # answer 56
	eq(Mastery.classify(two, true, 3700), "fast")
	eq(Mastery.classify(two, true, 3701), "slow")
	var three := fact("mul:10x10")  # answer 100
	eq(Mastery.fast_threshold_ms(three), 4400)


func test_classify_ignores_the_sign_when_counting_digits_and_scales_with_a_multiplier() -> void:
	var neg := FactGen.make_fact("add", -15, 3)   # answer -12
	eq(Mastery.fast_threshold_ms(neg), 3700)
	close(Mastery.fast_threshold_ms(fact("mul:2x3"), 1.1), 3300)


func test_classify_returns_wrong_for_incorrect_answers() -> void:
	eq(Mastery.classify(fact("mul:7x8"), false, 100), "wrong")


# ---- applyOutcome

func test_apply_outcome_box_interval_ms_1_is_2_minutes() -> void:
	eq(Mastery.BOX_INTERVAL_MS, [0, 2 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3])


func test_apply_outcome_is_due_never_seen_or_now_ge_due_at() -> void:
	ok(Mastery.is_due(Mastery.empty_stats(), NOW))
	ok(Mastery.is_due(stat(2, {"attempts": 0, "due_at": NOW + 1e9}), NOW))
	ok(Mastery.is_due(_due(2), NOW))
	no(Mastery.is_due(_not_due(2), NOW))


func test_apply_outcome_fast_and_due_box_plus_1_max_5_with_a_new_due_at() -> void:
	var s := Mastery.apply_outcome(_due(2), "fast", 1000, NOW)
	eq(s.box, 3)
	eq(s.due_at, NOW + Mastery.BOX_INTERVAL_MS[3])
	var top := Mastery.apply_outcome(_due(5), "fast", 1000, NOW)
	eq(top.box, 5)
	eq(top.due_at, NOW + Mastery.BOX_INTERVAL_MS[5])


func test_apply_outcome_fast_on_a_never_seen_fact_promotes_to_box_1_due_in_2_minutes() -> void:
	var s := Mastery.apply_outcome(Mastery.empty_stats(), "fast", 1500, NOW)
	eq(s.box, 1)
	eq(s.due_at, NOW + 2 * 60e3)


func test_apply_outcome_fast_and_not_due_box_and_due_at_unchanged_counters_updated() -> void:
	var before := _not_due(2)
	var s := Mastery.apply_outcome(before, "fast", 1000, NOW)
	eq(s.box, 2)
	eq(s.due_at, before.due_at)
	eq(s.attempts, before.attempts + 1)
	eq(s.correct, before.correct + 1)
	eq(s.last_seen, NOW)


func test_apply_outcome_cannot_climb_several_boxes_in_one_sitting() -> void:
	var s := Mastery.empty_stats()
	for i in 10:
		s = Mastery.apply_outcome(s, "fast", 1000, NOW + i * 1000)
	eq(s.box, 1)
	# after the 2-minute interval it may climb once more, then waits a day
	s = Mastery.apply_outcome(s, "fast", 1000, NOW + 2 * 60e3)
	eq(s.box, 2)
	s = Mastery.apply_outcome(s, "fast", 1000, NOW + 3 * 60e3)
	eq(s.box, 2)
	s = Mastery.apply_outcome(s, "fast", 1000, NOW + 2 * 60e3 + 24 * 3600e3)
	eq(s.box, 3)


func test_apply_outcome_slow_box_0_becomes_1_with_a_new_due_at_otherwise_unchanged() -> void:
	var from_zero := Mastery.apply_outcome(_not_due(0), "slow", 5000, NOW)
	eq(from_zero.box, 1)
	eq(from_zero.due_at, NOW + Mastery.BOX_INTERVAL_MS[1])
	for before in [_not_due(3), _due(3)]:
		var s := Mastery.apply_outcome(before, "slow", 5000, NOW)
		eq(s.box, 3)
		eq(s.due_at, before.due_at)
		eq(s.correct, before.correct + 1)


func test_apply_outcome_wrong_box_minus_1_min_0_always_applied_due_at_rescheduled() -> void:
	var s := Mastery.apply_outcome(_not_due(3), "wrong", 1000, NOW)
	eq(s.box, 2)
	eq(s.due_at, NOW + Mastery.BOX_INTERVAL_MS[2])
	var zero := Mastery.apply_outcome(_not_due(0), "wrong", 1000, NOW)
	eq(zero.box, 0)
	eq(zero.due_at, NOW)
	eq(Mastery.apply_outcome(_due(1), "wrong", 1000, NOW).box, 0)


func test_apply_outcome_missed_box_minus_2_min_0_always_applied_due_at_rescheduled() -> void:
	var s := Mastery.apply_outcome(_not_due(4), "missed", 1000, NOW)
	eq(s.box, 2)
	eq(s.due_at, NOW + Mastery.BOX_INTERVAL_MS[2])
	var one := Mastery.apply_outcome(_not_due(1), "missed", 1000, NOW)
	eq(one.box, 0)
	eq(one.due_at, NOW)
	eq(one.correct, _not_due(1).correct)


func test_apply_outcome_counts_attempts_and_correct_answers_and_keeps_a_running_mean() -> void:
	var s := Mastery.empty_stats()
	s = Mastery.apply_outcome(s, "fast", 1000, NOW)
	s = Mastery.apply_outcome(s, "wrong", 9999, NOW)
	s = Mastery.apply_outcome(s, "slow", 3000, NOW)
	eq(s.attempts, 3)
	eq(s.correct, 2)
	eq(s.avg_ms, 2000)


func test_apply_outcome_is_pure() -> void:
	var before := _due(2)
	var copy := before.duplicate(true)
	Mastery.apply_outcome(before, "fast", 1000, NOW)
	eq(before, copy)


# ---- levels

func test_levels_is_mastered_and_fact_level() -> void:
	eq(Mastery.MASTERED_BOX, 4)
	no(Mastery.is_mastered(null))
	no(Mastery.is_mastered(stat(3)))
	ok(Mastery.is_mastered(stat(4)))
	eq(Mastery.fact_level(null), 0)
	eq(Mastery.fact_level(stat(5)), 1)
	close(Mastery.fact_level(stat(2)), 0.4)


func test_levels_mastery_band_boundaries() -> void:
	eq(Mastery.mastery_band(0), 0)
	eq(Mastery.mastery_band(0.0999), 0)
	eq(Mastery.mastery_band(0.1), 1)
	eq(Mastery.mastery_band(0.3499), 1)
	eq(Mastery.mastery_band(0.35), 2)
	eq(Mastery.mastery_band(0.5999), 2)
	eq(Mastery.mastery_band(0.6), 3)
	eq(Mastery.mastery_band(0.8499), 3)
	eq(Mastery.mastery_band(0.85), 4)
	eq(Mastery.mastery_band(1), 4)


func test_levels_knowledge_mean_box_over_5_per_sector_and_over_the_galaxy() -> void:
	eq(Mastery.knowledge([], {}), 0)
	eq(Mastery.knowledge(["a", "b"], {"a": stat(5)}), 0.5)
	eq(Mastery.sector_knowledge("mul-c", {}), 0)
	eq(Mastery.sector_knowledge("mul-c", stats_for(["mul-c"], 5)), 1)
	close(Mastery.sector_knowledge("add-100", {"cat:add-100:carry": stat(5), "cat:add-100:easy": stat(2)}), 7.0 / 15.0)
	eq(Mastery.sector_knowledge("nope", {}), 0)
	var all := 0
	for s in Content.sectors():
		all += Facts.sector_stat_ids(s.id).size()
	close(Mastery.galaxy_knowledge(stats_for(["type-1"], 5)), 10.0 / all)


# ---- planet progress

func test_planet_progress_intervals_0_20_min_1_3_7_21_days() -> void:
	eq(Mastery.PLANET_INTERVAL_MS, [0, 20 * 60e3, DAY, 3 * DAY, 7 * DAY, 21 * DAY])
	eq(Mastery.LEVEL_UP_ACCURACY, 0.8)
	eq(Mastery.MAX_PLANET_LEVEL, 5)


func test_planet_progress_is_planet_due_level_0_always_else_now_ge_due_at() -> void:
	ok(Mastery.is_planet_due(Mastery.empty_progress(), NOW))
	ok(Mastery.is_planet_due(progress(0, {"due_at": NOW + DAY}), NOW))
	ok(Mastery.is_planet_due(progress(2, {"due_at": NOW}), NOW))
	no(Mastery.is_planet_due(progress(2, {"due_at": NOW + 1}), NOW))


func test_planet_progress_a_won_due_mission_with_accuracy_ge_0_8_raises_the_level() -> void:
	# Level 0 jumps to 2, due again in 20 min (Review fixes v5).
	eq(Mastery.apply_planet_result(Mastery.empty_progress(), _won(0.8)),
		{"level": 2, "due_at": NOW + Mastery.PLANET_INTERVAL_MS[1], "wins": 1})
	eq(Mastery.PLANET_INTERVAL_MS[1], 20 * 60e3)
	for level in range(1, 5):
		var p := Mastery.apply_planet_result(progress(level, {"due_at": NOW, "wins": 7}), _won(1))
		eq(p, {"level": level + 1, "due_at": NOW + Mastery.PLANET_INTERVAL_MS[level + 1], "wins": 8})
	eq(Mastery.apply_planet_result(progress(5, {"due_at": NOW - 1}), _won(0.9)), {"level": 5, "due_at": NOW + 21 * DAY, "wins": 6})


func test_planet_progress_a_win_when_not_due_or_with_low_accuracy_changes_only_wins() -> void:
	var not_due := progress(2, {"due_at": NOW + 1, "wins": 3})
	eq(Mastery.apply_planet_result(not_due, _won(1)), _with(not_due, {"wins": 4}))
	var due := progress(2, {"due_at": NOW, "wins": 3})
	eq(Mastery.apply_planet_result(due, _won(0.79)), _with(due, {"wins": 4}))
	eq(Mastery.apply_planet_result(Mastery.empty_progress(), _won(0.5)), {"level": 0, "due_at": 0, "wins": 1})


func test_planet_progress_a_lost_mission_lowers_the_level_by_1_and_makes_the_planet_due_now() -> void:
	eq(Mastery.apply_planet_result(progress(3, {"wins": 4}), _lost()), {"level": 2, "due_at": NOW, "wins": 4})
	eq(Mastery.apply_planet_result(Mastery.empty_progress(), _lost()), {"level": 0, "due_at": NOW, "wins": 0})


func test_planet_progress_a_good_first_win_gives_level_2_a_second_good_win_20_min_later_secures_it() -> void:
	var p := Mastery.empty_progress()
	for i in 5:
		p = Mastery.apply_planet_result(p, _won(1, NOW + i * 60e3))
	eq(p.level, 2)
	p = Mastery.apply_planet_result(p, _won(1, NOW + 20 * 60e3))
	eq(p, {"level": 3, "due_at": NOW + 20 * 60e3 + Mastery.PLANET_INTERVAL_MS[3], "wins": 6})
	p = Mastery.apply_planet_result(p, _won(1, NOW + 21 * 60e3))
	eq(p.level, 3)
	p = Mastery.apply_planet_result(p, _won(1, NOW + 20 * 60e3 + 3 * DAY))
	eq(p.level, 4)


func test_planet_progress_after_a_loss_back_to_level_0_a_good_win_gives_level_2_from_level_1_plus_1() -> void:
	var fell := Mastery.apply_planet_result(progress(1, {"wins": 2}), _lost())
	eq(fell.level, 0)
	eq(Mastery.apply_planet_result(fell, _won(0.9)).level, 2)
	eq(Mastery.apply_planet_result(progress(1, {"due_at": NOW}), _won(0.9)).level, 2)


func test_planet_progress_planet_mastery_is_level_over_5_from_save_planets() -> void:
	var save := {"planets": {"add-10.2": progress(3)}}
	close(Mastery.planet_mastery("add-10.2", save), 0.6)
	eq(Mastery.planet_mastery("add-10.1", save), 0)
	eq(Mastery.planet_mastery("nope", save), 0)
	eq(Mastery.planet_progress(save, "add-10.1"), Mastery.empty_progress())
