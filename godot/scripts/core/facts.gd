class_name Facts
## Port of src/core/facts.ts: the fact index over every enumerated sector, stat ids per sector and
## problem formatting. The re-exports of factgen.ts are forwarded below.

static var _all: Array = []
static var _index := {}
static var _sector_of_id := {}
static var _built := false


static func _build() -> void:
	_all = []
	_index = {}
	_sector_of_id = {}
	for sector in Content.sectors():
		for f in FactGen.sector_facts(sector.id):
			_all.append(f)
			_sector_of_id[f.id] = sector.id
	for f in _all:
		_index[f.id] = f
	_built = true


## Every fact of every enumerated sector once, in galaxy order. Returns a fresh array.
static func all_facts() -> Array:
	if not _built:
		_build()
	return _all.duplicate()


## An enumerated fact by id, or null (generated problems have no fixed id).
static func fact_by_id(id: String) -> Variant:
	if not _built:
		_build()
	return _index.get(id)


## Stat ids that hold a sector's knowledge: its fact ids (enumerated) or category ids (generated).
static func sector_stat_ids(sector_id: String) -> Array:
	var out: Array = []
	if FactGen.sector_kind(sector_id) == "generated":
		for c in FactGen.sector_categories(sector_id):
			out.append(FactGen.category_stat_id(sector_id, c))
		return out
	for f in FactGen.sector_facts(sector_id):
		out.append(f.stat_id)
	return out


## The sector a stat id belongs to, or null for ids no sector holds (e.g. removed facts).
static func sector_of_stat(stat_id: String) -> Variant:
	var cat = FactGen.parse_category_stat_id(stat_id)
	if cat != null:
		return cat.sector_id if FactGen.sector_categories(cat.sector_id).has(cat.category) else null
	if not _built:
		_build()
	return _sector_of_id.get(stat_id)


## Text shown on the enemy: "7 · 8" (hr) / "7 × 8" (en), "7 · ? = 56", "5 − (−3)".
static func format_problem(fact: Dictionary, locale: String) -> String:
	if fact.op == "type":
		return I18n.format_number(fact.a, locale)
	var left := "?" if fact.unknown == "a" else I18n.format_number(fact.a, locale)
	var right: String
	if fact.unknown == "b":
		right = "?"
	elif fact.b < 0:
		right = "(%s)" % I18n.format_number(fact.b, locale)
	else:
		right = I18n.format_number(fact.b, locale)
	var expr := "%s %s %s" % [left, I18n.op_symbol(fact.op, locale), right]
	return expr if fact.unknown == "result" else "%s = %s" % [expr, I18n.format_number(fact.result, locale)]


## Complete fact with every part filled in, e.g. "7 · 8 = 56" (also for "7 · ? = 56").
static func format_solved(fact: Dictionary, locale: String) -> String:
	if fact.op == "type":
		return I18n.format_number(fact.a, locale)
	var right: String = "(%s)" % I18n.format_number(fact.b, locale) if fact.b < 0 else I18n.format_number(fact.b, locale)
	return "%s %s %s = %s" % [I18n.format_number(fact.a, locale), I18n.op_symbol(fact.op, locale), right,
		I18n.format_number(fact.result, locale)]


# ---- re-exports of factgen.ts (TS: `export { ... } from './factgen'`)

static func category_defs(sector_id: String) -> Array:
	return FactGen.category_defs(sector_id)


static func category_stat_id(sector_id: String, category: String) -> String:
	return FactGen.category_stat_id(sector_id, category)


static func generate_fact(sector_id: String, category: String, rng: Rng) -> Variant:
	return FactGen.generate_fact(sector_id, category, rng)


static func parse_category_stat_id(stat_id: String) -> Variant:
	return FactGen.parse_category_stat_id(stat_id)


static func sector_categories(sector_id: String) -> Array:
	return FactGen.sector_categories(sector_id)


static func sector_facts(sector_id: String) -> Array:
	return FactGen.sector_facts(sector_id)


static func sector_kind(sector_id: String) -> Variant:
	return FactGen.sector_kind(sector_id)
