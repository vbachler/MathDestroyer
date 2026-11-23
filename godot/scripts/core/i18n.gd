class_name I18n
extends RefCounted
## Port of src/core/i18n.ts. `I18n.new(dicts, locale)` where dicts = {"hr": {key: text}, "en": {...}}.
##   t(key, params := {})            flat dotted key, params as {name}; missing key -> the key (warns once)
##   tp(key, count, params := {})    reads "<key>.<one|few|many>" and passes `count` as a param
## Static helpers: plural_category, format_number, op_symbol, load_dicts (reads res://locales).

const LOCALES: Array[String] = ["hr", "en"]
const DEFAULT_LOCALE := "hr"
## The real minus sign used for display.
const MINUS := "−"
## Locale files merged per locale, in this order (later files win), like DICTS in src/app.ts.
const LOCALE_FILES: Array[String] = ["common", "battle", "meta", "story"]

var locale: String
var _dicts: Dictionary
var _warned := {}
static var _param_re: RegEx


func _init(dicts: Dictionary = {}, initial_locale: String = DEFAULT_LOCALE) -> void:
	_dicts = dicts
	locale = initial_locale


func set_locale(l: String) -> void:
	locale = l


func t(key: String, params: Dictionary = {}) -> String:
	var dict: Dictionary = _dicts.get(locale, {})
	if not dict.has(key):
		var tag := "%s:%s" % [locale, key]
		if not _warned.has(tag):
			_warned[tag] = true
			push_warning('[i18n] missing key "%s" for locale "%s"' % [key, locale])
		return key
	return interpolate(str(dict[key]), params)


func tp(key: String, count: float, params: Dictionary = {}) -> String:
	var p := params.duplicate()
	p["count"] = count
	return t("%s.%s" % [key, plural_category(locale, count)], p)


## `{name}` -> String(params[name]) for every name present in params; others stay as they are.
static func interpolate(text: String, params: Dictionary) -> String:
	if params.is_empty():
		return text
	if _param_re == null:
		_param_re = RegEx.create_from_string("\\{(\\w+)\\}")
	var out := ""
	var pos := 0
	for m in _param_re.search_all(text):
		out += text.substr(pos, m.get_start() - pos)
		var name := m.get_string(1)
		out += Js.num_str(params[name]) if params.has(name) else m.get_string()
		pos = m.get_end()
	return out + text.substr(pos)


## Croatian: 1, 21, 31... one; 2-4, 22-24... few; everything else many. English: 1 one, else many.
static func plural_category(l: String, n: float) -> String:
	var a: int = absi(int(n))
	if l == "en":
		return "one" if a == 1 else "many"
	var m10 := a % 10
	var m100 := a % 100
	if m10 == 1 and m100 != 11:
		return "one"
	if m10 >= 2 and m10 <= 4 and (m100 < 12 or m100 > 14):
		return "few"
	return "many"


## Integer formatting for display: real minus sign, no grouping.
static func format_number(n: float, _locale: String = DEFAULT_LOCALE) -> String:
	return MINUS + Js.num_str(absf(n)) if n < 0 else Js.num_str(n)


## Operator glyph per locale: hr uses · and :, en uses × and ÷.
static func op_symbol(op: String, l: String) -> String:
	match op:
		"add":
			return "+"
		"sub":
			return MINUS
		"mul":
			return "·" if l == "hr" else "×"
		"div":
			return ":" if l == "hr" else "÷"
	return ""


## All locale strings from res://locales/<l>/<file>.json, merged per locale like DICTS in app.ts.
static func load_dicts(base: String = "res://locales") -> Dictionary:
	var out := {}
	for l in LOCALES:
		var merged := {}
		for f in LOCALE_FILES:
			var path := "%s/%s/%s.json" % [base, l, f]
			var text := FileAccess.get_file_as_string(path)
			var parsed = JSON.parse_string(text) if text != "" else null
			if parsed is Dictionary:
				merged.merge(parsed, true)
			else:
				push_warning("[i18n] could not read %s" % path)
		out[l] = merged
	return out
