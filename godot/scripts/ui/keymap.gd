class_name Keymap
## Port of src/ui/keymap.ts: pure mapping from a key event to a battle input action.
## KeyLike = {key, code, repeat, ctrl_key, meta_key, alt_key} (DOM KeyboardEvent names:
## key "5" / "-" / "Backspace" / "Enter" / " " / "Escape", code "Digit5" / "Numpad5" / "NumpadSubtract" /
## "NumpadEnter" / "Space" / "KeyP"). Keymap.from_event(InputEventKey) builds one from a Godot event.
## KeyAction = {type: "digit", d} | {type: "sign"} | {type: "backspace"} | {type: "submit"} | {type: "pause"}

static var _code_re: RegEx
static var _digit_re: RegEx


static func _base_action(ev: Dictionary) -> Variant:
	if _code_re == null:
		_code_re = RegEx.create_from_string("^(?:Digit|Numpad)([0-9])$")
		_digit_re = RegEx.create_from_string("^[0-9]$")
	var code: String = ev.get("code", "")
	var key: String = ev.get("key", "")
	var m := _code_re.search(code)
	if m != null:
		return {"type": "digit", "d": m.get_string(1).to_int()}
	if _digit_re.search(key) != null:
		return {"type": "digit", "d": key.to_int()}
	if key == "-" or code == "NumpadSubtract":
		return {"type": "sign"}
	if key == "Backspace":
		return {"type": "backspace"}
	if key == "Enter" or code == "NumpadEnter" or code == "Space" or key == " ":
		return {"type": "submit"}
	if key == "Escape" or code == "KeyP":
		return {"type": "pause"}
	return null


static func _has_modifier(ev: Dictionary) -> bool:
	return ev.get("ctrl_key", false) or ev.get("meta_key", false) or ev.get("alt_key", false)


## True when the game consumes this key (repeats included).
static func is_game_key(ev: Dictionary) -> bool:
	return not _has_modifier(ev) and _base_action(ev) != null


## The action for one keydown, or null. Ctrl/Meta/Alt keys are ignored; auto-repeat only repeats Backspace.
static func key_action(ev: Dictionary) -> Variant:
	if _has_modifier(ev):
		return null
	var action = _base_action(ev)
	if action == null:
		return null
	if ev.get("repeat", false) and action.type != "backspace":
		return null
	return action


## KeyLike from a Godot key event (DOM key / code names as above).
static func from_event(e: InputEventKey) -> Dictionary:
	var kc := e.keycode
	var pc := e.physical_keycode
	var code := ""
	if pc >= KEY_0 and pc <= KEY_9:
		code = "Digit%d" % (pc - KEY_0)
	elif pc >= KEY_KP_0 and pc <= KEY_KP_9:
		code = "Numpad%d" % (pc - KEY_KP_0)
	elif pc == KEY_KP_SUBTRACT:
		code = "NumpadSubtract"
	elif pc == KEY_KP_ENTER:
		code = "NumpadEnter"
	elif pc == KEY_SPACE:
		code = "Space"
	elif pc == KEY_P:
		code = "KeyP"
	var key := ""
	match kc:
		KEY_BACKSPACE:
			key = "Backspace"
		KEY_ENTER, KEY_KP_ENTER:
			key = "Enter"
		KEY_ESCAPE:
			key = "Escape"
		KEY_SPACE:
			key = " "
		_:
			key = char(e.unicode) if e.unicode > 0 else OS.get_keycode_string(kc)
	return {
		"key": key, "code": code, "repeat": e.echo,
		"ctrl_key": e.ctrl_pressed, "meta_key": e.meta_pressed, "alt_key": e.alt_pressed,
	}
