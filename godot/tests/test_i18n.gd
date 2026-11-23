extends TestCase
## Port of tests/i18n.test.ts

const FILES: Array[String] = ["common", "battle", "meta", "story"]


## Counts warnings that mention `needle` (vi.spyOn(console, 'warn')).
class WarnSpy extends Logger:
	var needle := ""
	var count := 0

	func _log_error(_function: String, _file: String, _line: int, code: String, rationale: String,
			_editor_notify: bool, error_type: int, _script_backtrace: Array[ScriptBacktrace]) -> void:
		if error_type == ERROR_TYPE_WARNING and (code + rationale).contains(needle):
			count += 1


static func _read_json(path: String) -> Dictionary:
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}


## {name: {hr: {...}, en: {...}}} of every locale file.
static func _files() -> Dictionary:
	var out := {}
	for name in FILES:
		out[name] = {
			"hr": _read_json("res://locales/hr/%s.json" % name),
			"en": _read_json("res://locales/en/%s.json" % name),
		}
	return out


## Every file merged per locale (common, battle, meta, story; later files win).
static func _dicts() -> Dictionary:
	var files := _files()
	var out := {"hr": {}, "en": {}}
	for name in FILES:
		out.hr.merge(files[name].hr, true)
		out.en.merge(files[name].en, true)
	return out


static func _truthy(v: Variant) -> bool:
	return v is String and v != ""


# ---------------------------------------------------------------- i18n

func test_translates_and_interpolates_params() -> void:
	var i := I18n.new({"hr": {"a.b": "Val {n} od {total}"}, "en": {"a.b": "Wave {n} of {total}"}}, "hr")
	eq(i.t("a.b", {"n": 2, "total": 5}), "Val 2 od 5")
	i.set_locale("en")
	eq(i.locale, "en")
	eq(i.t("a.b", {"n": 2, "total": 5}), "Wave 2 of 5")
	eq(i.t("a.b", {"n": 1}), "Wave 1 of {total}")


func test_missing_key_returns_the_key_and_warns_once() -> void:
	var spy := WarnSpy.new()
	spy.needle = "nope.key"
	OS.add_logger(spy)
	var i := I18n.new({"hr": {}, "en": {}}, "hr")
	eq(i.t("nope.key"), "nope.key")
	eq(i.t("nope.key"), "nope.key")
	OS.remove_logger(spy)
	eq(spy.count, 1)


func test_croatian_plural_categories() -> void:
	eq([1, 21, 101].map(func(n): return I18n.plural_category("hr", n)), ["one", "one", "one"])
	eq([2, 3, 4, 22, 34].map(func(n): return I18n.plural_category("hr", n)), ["few", "few", "few", "few", "few"])
	eq([0, 5, 11, 12, 14, 15, 111].map(func(n): return I18n.plural_category("hr", n)), ["many", "many", "many", "many", "many", "many", "many"])
	eq([1, 2, 5].map(func(n): return I18n.plural_category("en", n)), ["one", "many", "many"])


func test_tp_picks_the_plural_form_and_passes_count() -> void:
	var i := I18n.new({
		"hr": {"x.ship.one": "{count} brod", "x.ship.few": "{count} broda", "x.ship.many": "{count} brodova"},
		"en": {"x.ship.one": "{count} ship", "x.ship.many": "{count} ships"},
	}, "hr")
	eq([1, 3, 7].map(func(n): return i.tp("x.ship", n)), ["1 brod", "3 broda", "7 brodova"])
	i.set_locale("en")
	eq([1, 3].map(func(n): return i.tp("x.ship", n)), ["1 ship", "3 ships"])


func test_formats_numbers_and_operators_per_locale() -> void:
	eq(I18n.format_number(-7, "hr"), "−7")
	eq(I18n.format_number(12, "en"), "12")
	eq(I18n.op_symbol("mul", "hr"), "·")
	eq(I18n.op_symbol("mul", "en"), "×")
	eq(I18n.op_symbol("div", "hr"), ":")
	eq(I18n.op_symbol("div", "en"), "÷")
	eq(I18n.op_symbol("sub", "en"), "−")


# ---------------------------------------------------------------- locale files

## `<name>.json has identical key sets in hr and en`
func _same_keys(name: String) -> void:
	var f: Dictionary = _files()[name]
	eq(Js.sorted_strings(f.hr.keys()), Js.sorted_strings(f.en.keys()), name)


## `<name>.json keys are prefixed with "<name>." and values are non-empty`
func _prefixed(name: String) -> void:
	var f: Dictionary = _files()[name]
	var both: Dictionary = f.hr.duplicate()
	both.merge(f.en, true)
	for k in both:
		ok(k.begins_with(name + "."), k)
		ok(both[k] is String, k)
		if both[k] is String:
			gt(both[k].strip_edges().length(), 0, k)


func test_common_json_has_identical_key_sets_in_hr_and_en() -> void:
	_same_keys("common")


func test_common_json_keys_are_prefixed_and_values_are_non_empty() -> void:
	_prefixed("common")


func test_battle_json_has_identical_key_sets_in_hr_and_en() -> void:
	_same_keys("battle")


func test_battle_json_keys_are_prefixed_and_values_are_non_empty() -> void:
	_prefixed("battle")


func test_meta_json_has_identical_key_sets_in_hr_and_en() -> void:
	_same_keys("meta")


func test_meta_json_keys_are_prefixed_and_values_are_non_empty() -> void:
	_prefixed("meta")


func test_story_json_has_identical_key_sets_in_hr_and_en() -> void:
	_same_keys("story")


func test_story_json_keys_are_prefixed_and_values_are_non_empty() -> void:
	_prefixed("story")


func test_contains_every_content_upgrade_and_module_key_in_both_locales() -> void:
	var dicts := _dicts()
	var keys: Array = Content.sectors().map(func(s): return s.name_key) + Upgrades.upgrades().map(func(u): return u.name_key)
	for m in Economy.modules():
		keys.append(m.name_key)
		keys.append(m.desc_key)
	for k in keys:
		ok(_truthy(dicts.hr.get(k)), k)
		ok(_truthy(dicts.en.get(k)), k)


func test_upgrade_and_module_names_have_at_most_two_words_module_lines_at_most_six() -> void:
	var ws := RegEx.create_from_string("\\s+")
	var words := func(v: String) -> int: return ws.sub(v.strip_edges(), " ", true).split(" ").size()
	var dicts := _dicts()
	for d in [dicts.hr, dicts.en]:
		for u in Upgrades.upgrades():
			le(words.call(d[u.name_key]), 2, d[u.name_key])
		for m in Economy.modules():
			le(words.call(d[m.name_key]), 2, d[m.name_key])
			le(words.call(d[m.desc_key]), 6, d[m.desc_key])


func test_has_no_keys_of_removed_features() -> void:
	var removed := RegEx.create_from_string("(?i)energy|collector|reactor")
	var upgrade_desc := RegEx.create_from_string("^battle\\.upgrade\\.[^.]+\\.desc$")
	var dicts := _dicts()
	for d in [dicts.hr, dicts.en]:
		var stale: Array = d.keys().filter(func(k): return removed.search(k) != null or upgrade_desc.search(k) != null)
		eq(stale, [])


func test_has_no_keys_of_the_old_content_model() -> void:
	var old := RegEx.create_from_string("^meta\\.(system|planet)\\.")
	var dicts := _dicts()
	for d in [dicts.hr, dicts.en]:
		eq(d.keys().filter(func(k): return old.search(k) != null), [])
		eq(Js.sorted_strings(d.keys().filter(func(k): return k.begins_with("meta.sector."))),
			Js.sorted_strings(Content.sectors().map(func(s): return s.name_key)))


func test_every_category_of_a_generated_sector_has_a_short_name_and_no_other_category_keys_exist() -> void:
	var uniq := {}
	for s in Content.sectors():
		for c in Facts.sector_categories(s.id):
			uniq[c] = true
	var names := Js.sorted_strings(uniq.keys())
	var dicts := _dicts()
	for d in [dicts.hr, dicts.en]:
		var cats: Array = d.keys().filter(func(k): return k.begins_with("meta.category.")) \
			.map(func(k): return k.substr("meta.category.".length()))
		eq(Js.sorted_strings(cats), names)
		for n in names:
			le(str(d.get("meta.category.%s" % n, "")).length(), 32, n)


func test_sector_names_are_short() -> void:
	var dicts := _dicts()
	for d in [dicts.hr, dicts.en]:
		for s in Content.sectors():
			le(str(d[s.name_key]).length(), 24, d[s.name_key])


func test_croatian_text_uses_croatian_diacritics() -> void:
	var text := " ".join(PackedStringArray(_dicts().hr.values().map(func(v): return str(v))))
	ok(RegEx.create_from_string("[čćđšž]").search(text) != null)
