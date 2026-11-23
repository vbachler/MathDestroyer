class_name Scheduler
## Port of src/core/scheduler.ts: which problems a mission asks (adaptive selection over the
## whole sector). Pure: randomness comes from the given Rng.

## Never-seen facts allowed in the first wave, and extra per later wave (enumerated sectors).
const FIRST_WAVE_NEW_FACTS := 6
const NEW_FACTS_PER_WAVE := 3
## Weight multiplier of an enumerated fact not yet asked in this mission.
const UNASKED_BONUS := 3
## The core draws from this sector until the player has played any sector.
const CORE_FALLBACK_SECTOR := "type-1"
## Attempts to generate a problem that differs from the excluded ones.
const GENERATE_TRIES := 24


## Weight of a fact or category: due and seen 4, never seen 3, box 0-1 3, box 2-3 2, box 4-5 1.
static func stat_weight(s: Variant, now: float) -> int:
	if s == null or s.attempts == 0:
		return 3
	if s.due_at <= now:
		return 4
	if s.box <= 1:
		return 3
	if s.box <= 3:
		return 2
	return 1


## Probabilities of the categories of a generated sector (see scheduler.ts). Array of {name, p}.
static func category_shares(sector_id: String, stats: Dictionary, now: float) -> Array:
	var defs: Array = FactGen.category_defs(sector_id)
	var raw: Array = []
	for d in defs:
		raw.append(d.share * stat_weight(stats.get(FactGen.category_stat_id(sector_id, d.name)), now))
	var fixed: Array = []
	fixed.resize(defs.size())   # null = free
	var p: Array = []
	for round_i in defs.size() + 1:
		var fixed_mass := 0.0
		for x in fixed:
			fixed_mass += x if x != null else 0.0
		var free_raw := 0.0
		for i in raw.size():
			free_raw += raw[i] if fixed[i] == null else 0.0
		p = []
		for i in defs.size():
			if fixed[i] != null:
				p.append(fixed[i])
			else:
				p.append((raw[i] / free_raw) * (1.0 - fixed_mass) if free_raw > 0 else 0.0)
		var changed := false
		for i in defs.size():
			if fixed[i] != null:
				continue
			var d: Dictionary = defs[i]
			if d.has("max") and p[i] > d.max:
				fixed[i] = d.max
				changed = true
			elif d.has("min") and p[i] < d.min:
				fixed[i] = d.min
				changed = true
		if not changed:
			break
	var out: Array = []
	for i in defs.size():
		out.append({"name": defs[i].name, "p": p[i]})
	return out


## One category of a generated sector, drawn by category_shares.
static func pick_category(sector_id: String, stats: Dictionary, now: float, rng: Rng) -> String:
	var shares := category_shares(sector_id, stats, now)
	var r := rng.next()
	for s in shares:
		r -= s.p
		if r < 0:
			return s.name
	return shares[shares.size() - 1].name


## Sectors the player has played, in galaxy order (any stat present, or any planet won once).
## `save` = {stats, planets}. The core itself never counts.
static func played_sectors(save: Dictionary) -> Array:
	var played := {}
	for id in save.stats.keys():
		var sector = Facts.sector_of_stat(id)
		if sector != null:
			played[sector] = true
	for planet_id in save.planets.keys():
		var planet = Content.planet_by_id(planet_id)
		if planet != null and save.planets[planet_id].wins > 0:
			played[planet.sector_id] = true
	var out: Array = []
	for s in Content.sectors():
		if s.id != Content.CORE_SECTOR_ID and played.has(s.id):
			out.append(s.id)
	return out


## Sectors a mission at the planet draws from: its own sector; for the core every played sector
## (type-1 when none); [] for an unknown planet.
static func mission_sectors(planet_id: String, save: Dictionary) -> Array:
	if planet_id == Content.CORE_PLANET_ID:
		var played := played_sectors(save)
		return played if played.size() > 0 else [CORE_FALLBACK_SECTOR]
	var planet = Content.planet_by_id(planet_id)
	return [planet.sector_id] if planet != null else []


static func _weighted_pick(items: Array, rng: Rng) -> Variant:
	var total := 0.0
	for e in items:
		total += e.w
	if items.is_empty() or total <= 0:
		return null
	var r := rng.next() * total
	for e in items:
		r -= e.w
		if r < 0:
			return e.item
	return items[items.size() - 1].item


## A problem source of one sector: pick(wave_index, exclude) and any(exclude) (exclude = {id: true}).
class Source:
	extends RefCounted

	func pick(_wave_index: int, _exclude: Dictionary) -> Variant:
		return null

	func any(_exclude: Dictionary) -> Variant:
		return null


## Enumerated sector: weighted facts; never-seen facts open up in a mission order drawn once.
class EnumeratedSource:
	extends Source
	var stats: Dictionary
	var now: float
	var rng: Rng
	var pool: Array
	var seen: Array = []
	var fresh: Array
	var asked := {}

	func _init(sector_id: String, p_stats: Dictionary, p_now: float, p_rng: Rng) -> void:
		stats = p_stats
		now = p_now
		rng = p_rng
		pool = FactGen.sector_facts(sector_id)
		var new_facts: Array = []
		for f in pool:
			if _is_new(f):
				new_facts.append(f)
			else:
				seen.append(f)
		fresh = rng.shuffle(new_facts)

	func _is_new(f: Dictionary) -> bool:
		return not stats.has(f.stat_id) or stats[f.stat_id].attempts == 0

	func _mark(f: Variant) -> Variant:
		if f != null:
			asked[f.id] = true
		return f

	func pick(wave_index: int, exclude: Dictionary) -> Variant:
		var budget := FIRST_WAVE_NEW_FACTS + NEW_FACTS_PER_WAVE * maxi(0, wave_index)
		var items: Array = []
		for f in seen + fresh.slice(0, budget):
			if exclude.has(f.id):
				continue
			items.append({"item": f, "w": Scheduler.stat_weight(stats.get(f.stat_id), now) * (1 if asked.has(f.id) else UNASKED_BONUS)})
		return _mark(Scheduler._weighted_pick(items, rng))

	func any(exclude: Dictionary) -> Variant:
		var rest: Array = []
		for f in pool:
			if not exclude.has(f.id):
				rest.append(f)
		return _mark(rng.pick(rest) if rest.size() > 0 else null)


## Generated sector: a weighted category, then random numbers inside it.
class GeneratedSource:
	extends Source
	var sector_id: String
	var stats: Dictionary
	var now: float
	var rng: Rng
	var names: Array

	func _init(p_sector_id: String, p_stats: Dictionary, p_now: float, p_rng: Rng) -> void:
		sector_id = p_sector_id
		stats = p_stats
		now = p_now
		rng = p_rng
		names = FactGen.sector_categories(sector_id)

	func _attempt(category: Callable, exclude: Dictionary) -> Variant:
		for i in GENERATE_TRIES:
			var f = FactGen.generate_fact(sector_id, category.call(), rng)
			if not exclude.has(f.id):
				return f
		return null

	func pick(_wave_index: int, exclude: Dictionary) -> Variant:
		return _attempt(func(): return Scheduler.pick_category(sector_id, stats, now, rng), exclude)

	func any(exclude: Dictionary) -> Variant:
		return _attempt(func(): return rng.pick(names), exclude)


## The problem source of one mission (TS MissionScheduler). Stats are the mission-start snapshot.
## Creating it draws the order in which never-seen facts are introduced (consumes the Rng).
class MissionScheduler:
	extends RefCounted
	## The sectors this mission draws from.
	var sectors: Array
	var _sources: Array = []
	var _rng: Rng
	var _last = null

	func _init(planet_id: String, stats: Dictionary, planets: Dictionary, now: float, rng: Rng) -> void:
		_rng = rng
		sectors = Scheduler.mission_sectors(planet_id, {"stats": stats, "planets": planets})
		for id in sectors:
			if FactGen.sector_kind(id) == "generated":
				_sources.append(GeneratedSource.new(id, stats, now, rng))
			else:
				_sources.append(EnumeratedSource.new(id, stats, now, rng))

	func _source() -> Variant:
		if _sources.size() > 1:
			return _rng.pick(_sources)
		return _sources[0] if _sources.size() > 0 else null

	## Queue of `count` problems for wave `wave_index` (0-based); no problem twice in a row.
	func wave(wave_index: int, count: int) -> Array:
		var queue: Array = []
		for i in count:
			var from = _source()
			if from == null:
				break
			var ex := {}
			if _last != null:
				ex[_last] = true
			var f = from.pick(wave_index, ex)
			if f == null:
				f = from.pick(wave_index, {})
			if f == null:
				f = from.any({})
			if f == null:
				break
			queue.append(f)
			_last = f.id
		return queue

	## A problem whose id is not in `exclude` ({id: true}), or null when none can be found.
	func replacement(wave_index: int, exclude: Dictionary) -> Variant:
		var first = _source()
		if first == null:
			return null
		var f = first.pick(wave_index, exclude)
		if f != null:
			return f
		for s in _sources:
			var g = s.pick(wave_index, exclude)
			if g == null:
				g = s.any(exclude)
			if g != null:
				return g
		return null


## args = {planet_id, stats, planets, now, rng}
static func create_mission_scheduler(args: Dictionary) -> MissionScheduler:
	return MissionScheduler.new(args.planet_id, args.stats, args.planets, args.now, args.rng)
