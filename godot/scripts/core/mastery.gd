class_name Mastery
## Port of src/core/mastery.ts: Leitner boxes per fact / category and planet progress.
## FactStats = {box, attempts, correct, avg_ms, last_seen, due_at}; PlanetProgress = {level, due_at, wins}.
## Outcome = "fast" | "slow" | "wrong" | "missed".

const BOX_INTERVAL_MS: Array[float] = [0.0, 2 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3]
const MASTERED_BOX := 4
const MAX_BOX := 5

const MINUTE := 60e3
const DAY := 24 * 3600e3
## Time until a planet is due again, by its new level.
const PLANET_INTERVAL_MS: Array[float] = [0.0, 20 * MINUTE, DAY, 3 * DAY, 7 * DAY, 21 * DAY]
const MAX_PLANET_LEVEL := 5
## A won mission raises the planet's level only with at least this accuracy.
const LEVEL_UP_ACCURACY := 0.8


static func _digit_count(n: float) -> int:
	return str(absi(int(n))).length()


## Fast threshold: 3000 ms + 700 ms per digit of the answer beyond the first, times `multiplier`.
static func fast_threshold_ms(fact: Dictionary, multiplier: float = 1.0) -> float:
	return (3000.0 + 700.0 * (_digit_count(fact.answer) - 1)) * multiplier


## Correct answers are "fast" (<= threshold) or "slow"; incorrect ones are "wrong".
static func classify(fact: Dictionary, correct: bool, response_ms: float) -> String:
	if not correct:
		return "wrong"
	return "fast" if response_ms <= fast_threshold_ms(fact) else "slow"


static func empty_stats() -> Dictionary:
	return {"box": 0, "attempts": 0, "correct": 0, "avg_ms": 0, "last_seen": 0, "due_at": 0}


## A fact is due when it was never seen (attempts 0) or now >= due_at.
static func is_due(s: Dictionary, now: float) -> bool:
	return s.attempts == 0 or now >= s.due_at


## See mastery.ts applyOutcome: promotion only when due; demotions always apply.
static func apply_outcome(s: Dictionary, o: String, response_ms: float, now: float) -> Dictionary:
	var box: int = s.box
	var due_at = s.due_at
	match o:
		"fast":
			if is_due(s, now):
				box = mini(MAX_BOX, s.box + 1)
				due_at = now + BOX_INTERVAL_MS[box]
		"slow":
			if s.box == 0:
				box = 1
				due_at = now + BOX_INTERVAL_MS[box]
		"wrong":
			box = maxi(0, s.box - 1)
			due_at = now + BOX_INTERVAL_MS[box]
		"missed":
			box = maxi(0, s.box - 2)
			due_at = now + BOX_INTERVAL_MS[box]
	var is_correct := o == "fast" or o == "slow"
	var correct: int = s.correct + (1 if is_correct else 0)
	var avg_ms = s.avg_ms + (response_ms - s.avg_ms) / float(correct) if is_correct else s.avg_ms
	return {
		"box": box, "attempts": s.attempts + 1, "correct": correct, "avg_ms": Js.norm_num(avg_ms),
		"last_seen": now, "due_at": Js.norm_num(due_at),
	}


static func is_mastered(s: Variant) -> bool:
	return s != null and s.box >= MASTERED_BOX


static func fact_level(s: Variant) -> float:
	return float(s.box) / MAX_BOX if s != null else 0.0


## Mean knowledge level (box / 5) of the given stat ids; 0 for an empty list.
static func knowledge(stat_ids: Array, stats: Dictionary) -> float:
	if stat_ids.is_empty():
		return 0.0
	var boxes := 0
	for id in stat_ids:
		var st = stats.get(id)
		boxes += st.box if st != null else 0
	return float(boxes) / float(MAX_BOX * stat_ids.size())


## Real knowledge of a sector from `stats` (per fact or per category), for the parent report.
static func sector_knowledge(sector_id: String, stats: Dictionary) -> float:
	return knowledge(Facts.sector_stat_ids(sector_id), stats)


## Real knowledge over every sector's stat ids (the core's line in the parent report).
static func galaxy_knowledge(stats: Dictionary) -> float:
	var ids: Array = []
	for s in Content.sectors():
		ids.append_array(Facts.sector_stat_ids(s.id))
	return knowledge(ids, stats)


# ---------------------------------------------------------------- planet progress

static func empty_progress() -> Dictionary:
	return {"level": 0, "due_at": 0, "wins": 0}


## Progress of a planet (level 0, never visited, when missing). `save` is any ProgressHolder.
static func planet_progress(save: Dictionary, planet_id: String) -> Dictionary:
	var p = save.planets.get(planet_id)
	return p if p != null else empty_progress()


## A planet is due when it is at level 0 or now >= due_at.
static func is_planet_due(p: Dictionary, now: float) -> bool:
	return p.level == 0 or now >= p.due_at


## Result of one mission at a planet (see mastery.ts applyPlanetResult). r = {won, accuracy, now}.
static func apply_planet_result(p: Dictionary, r: Dictionary) -> Dictionary:
	if not r.won:
		return {"level": maxi(0, p.level - 1), "due_at": r.now, "wins": p.wins}
	if r.accuracy >= LEVEL_UP_ACCURACY and p.level == 0:
		return {"level": 2, "due_at": Js.norm_num(r.now + PLANET_INTERVAL_MS[1]), "wins": p.wins + 1}
	if r.accuracy >= LEVEL_UP_ACCURACY and is_planet_due(p, r.now):
		var level := mini(MAX_PLANET_LEVEL, p.level + 1)
		return {"level": level, "due_at": Js.norm_num(r.now + PLANET_INTERVAL_MS[level]), "wins": p.wins + 1}
	var out := p.duplicate()
	out.wins = p.wins + 1
	return out


## Planet mastery = level / 5 (0 for a never-visited or unknown planet).
static func planet_mastery(planet_id: String, save: Dictionary) -> float:
	return float(planet_progress(save, planet_id).level) / MAX_PLANET_LEVEL


## Mastery -> colour band 0..4: unlit (<0.10), weak (<0.35), learning (<0.6), good (<0.85), mastered.
static func mastery_band(level: float) -> int:
	if level < 0.1:
		return 0
	if level < 0.35:
		return 1
	if level < 0.6:
		return 2
	if level < 0.85:
		return 3
	return 4
