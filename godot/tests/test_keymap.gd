extends TestCase
## Port of tests/keymap.test.ts


## KeyLike with every flag off unless overridden.
static func k(key: String, code: String, extra: Dictionary = {}) -> Dictionary:
	var ev := {"key": key, "code": code, "repeat": false, "ctrl_key": false, "meta_key": false, "alt_key": false}
	ev.merge(extra, true)
	return ev


# ---- keyAction

func test_maps_top_row_digits() -> void:
	for d in 10:
		eq(Keymap.key_action(k(str(d), "Digit%d" % d)), {"type": "digit", "d": d})


func test_maps_top_row_digits_by_code_even_when_the_layout_needs_shift_azerty() -> void:
	eq(Keymap.key_action(k("&", "Digit1")), {"type": "digit", "d": 1})


func test_maps_numpad_digits_also_without_numlock() -> void:
	for d in 10:
		eq(Keymap.key_action(k(str(d), "Numpad%d" % d)), {"type": "digit", "d": d})
	eq(Keymap.key_action(k("End", "Numpad1")), {"type": "digit", "d": 1})


func test_maps_minus_and_numpad_minus_to_sign() -> void:
	eq(Keymap.key_action(k("-", "Slash")), {"type": "sign"})  # Croatian layout
	eq(Keymap.key_action(k("-", "Minus")), {"type": "sign"})
	eq(Keymap.key_action(k("-", "NumpadSubtract")), {"type": "sign"})


func test_maps_enter_numpadenter_and_space_to_submit() -> void:
	eq(Keymap.key_action(k("Enter", "Enter")), {"type": "submit"})
	eq(Keymap.key_action(k("Enter", "NumpadEnter")), {"type": "submit"})
	eq(Keymap.key_action(k(" ", "Space")), {"type": "submit"})


func test_maps_backspace() -> void:
	eq(Keymap.key_action(k("Backspace", "Backspace")), {"type": "backspace"})


func test_maps_escape_and_p_to_pause() -> void:
	eq(Keymap.key_action(k("Escape", "Escape")), {"type": "pause"})
	eq(Keymap.key_action(k("p", "KeyP")), {"type": "pause"})
	eq(Keymap.key_action(k("P", "KeyP")), {"type": "pause"})


func test_ignores_repeats_except_for_backspace() -> void:
	var r := {"repeat": true}
	is_null(Keymap.key_action(k("7", "Digit7", r)))
	is_null(Keymap.key_action(k("7", "Numpad7", r)))
	is_null(Keymap.key_action(k("-", "Minus", r)))
	is_null(Keymap.key_action(k("Enter", "Enter", r)))
	is_null(Keymap.key_action(k(" ", "Space", r)))
	is_null(Keymap.key_action(k("Escape", "Escape", r)))
	is_null(Keymap.key_action(k("p", "KeyP", r)))
	eq(Keymap.key_action(k("Backspace", "Backspace", r)), {"type": "backspace"})


func test_ignores_keys_with_ctrl_meta_or_alt_held() -> void:
	for mod in [{"ctrl_key": true}, {"meta_key": true}, {"alt_key": true}]:
		is_null(Keymap.key_action(k("5", "Digit5", mod)))
		is_null(Keymap.key_action(k("-", "Minus", mod)))
		is_null(Keymap.key_action(k("Backspace", "Backspace", mod)))
		is_null(Keymap.key_action(k("Enter", "Enter", mod)))
		is_null(Keymap.key_action(k("p", "KeyP", mod)))


func test_ignores_unrelated_keys() -> void:
	is_null(Keymap.key_action(k("a", "KeyA")))
	is_null(Keymap.key_action(k("Tab", "Tab")))
	is_null(Keymap.key_action(k("F5", "F5")))


# ---- isGameKey

func test_is_true_for_consumed_keys_repeats_included() -> void:
	ok(Keymap.is_game_key(k("5", "Digit5")))
	ok(Keymap.is_game_key(k(" ", "Space", {"repeat": true})))
	ok(Keymap.is_game_key(k("Escape", "Escape")))


func test_is_false_with_modifiers_and_for_unrelated_keys() -> void:
	no(Keymap.is_game_key(k("r", "KeyR", {"ctrl_key": true})))
	no(Keymap.is_game_key(k("5", "Digit5", {"meta_key": true})))
	no(Keymap.is_game_key(k("a", "KeyA")))
