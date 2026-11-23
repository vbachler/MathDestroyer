class_name BoardingSim
extends RefCounted
## Port of class BoardingSim in src/core/boarding.ts (constants and shapes: Boarding in boarding.gd).
## `BoardingSim.new(cfg)`; step(dt_ms) returns events.

var state: Dictionary
var records: Array = []

var _rng: Rng
var _speed_scale: float
var _density: float
var _max_alive: int
var _facts: Array
var _spawn_timer_ms: float = Boarding.BOARDING_FIRST_SPAWN_MS
var _next_id := 1
## Kind of the next crawler, drawn once and kept while the spawn waits for a free lane.
var _pending_kind = null
var _last_submit_at := 0.0
var _wronged := {}


## cfg = {facts, seed, speed_scale, density?}
func _init(cfg: Dictionary) -> void:
	_rng = Rng.new(cfg.seed)
	var ss = cfg.get("speed_scale")
	_speed_scale = ss if Js.is_finite_num(ss) and ss > 0 else 1.0
	var d = cfg.get("density", 1.0)
	_density = d if Js.is_finite_num(d) and d > 0 else 1.0
	_max_alive = Boarding.boarding_max_alive(_density)
	_facts = cfg.facts.duplicate()
	state = {
		"phase": "fighting",
		"time_ms": 0.0,
		"crawlers": [],
		"input": "",
		"bites": 0,
		"max_bites": Boarding.BOARDING_MAX_BITES,
		"remaining": _facts.size(),
		"kills": 0,
	}


## Nearest crawler = smallest z (ties: oldest id).
static func _nearest(crawlers: Array) -> Variant:
	var best = null
	for c in crawlers:
		if best == null or c.z < best.z or (c.z == best.z and c.id < best.id):
			best = c
	return best


# ---------------------------------------------------------------- simulation

func step(dt_ms: float) -> Array:
	var events: Array = []
	var left := maxf(0.0, dt_ms)
	while left > 0:
		var dt := minf(Battle.MAX_STEP_MS, left)
		left -= dt
		_tick(dt, events)
	return events


func _tick(dt: float, ev: Array) -> void:
	var s := state
	if s.phase != "fighting":
		return
	s.time_ms += dt
	_step_spawn(dt, ev)
	for c in s.crawlers:
		c.z -= (c.speed * dt) / 1000.0
	_step_bites(ev)
	_check_repelled(ev)


func _step_spawn(dt: float, ev: Array) -> void:
	var s := state
	if s.remaining <= 0:
		return
	_spawn_timer_ms = maxf(0.0, _spawn_timer_ms - dt)
	if _spawn_timer_ms > 0 or s.crawlers.size() >= _max_alive:
		return
	if _pending_kind == null:
		_pending_kind = _rng.pick(Boarding.CRAWLER_KINDS)
	var kind: String = _pending_kind
	var speed: float = (Boarding.CRAWLER_SPEED[kind] * _speed_scale * 1000.0) / Boarding.APPROACH_MS
	var free_lanes: Array = []
	for lane in Boarding.BOARDING_LANES:
		var ok := true
		for c in s.crawlers:
			if not (c.lane != lane or Boarding.lane_clear(c, speed)):
				ok = false
				break
		if ok:
			free_lanes.append(lane)
	if free_lanes.is_empty():
		return
	var crawler := {
		"id": _next_id,
		"fact": _facts[_facts.size() - s.remaining],
		"kind": kind,
		"lane": _rng.pick(free_lanes),
		"z": 1.0,
		"speed": speed,
		"spawned_at": s.time_ms,
	}
	_next_id += 1
	_pending_kind = null
	s.remaining -= 1
	s.crawlers.append(crawler)
	_spawn_timer_ms = float(Boarding.BOARDING_SPAWN_MS) / _speed_scale / _density
	ev.append({"type": "spawn", "crawler": crawler})


func _step_bites(ev: Array) -> void:
	var s := state
	var biters := Js.sorted(s.crawlers.filter(func(c): return c.z <= 0),
		func(p, q): return (p.z - q.z) if p.z != q.z else (p.id - q.id))
	for c in biters:
		_remove(c)
		c.z = 0.0
		_wronged.erase(c.id)
		s.bites += 1
		records.append({"fact_id": c.fact.stat_id, "outcome": "missed", "response_ms": Js.norm_num(s.time_ms - c.spawned_at)})
		ev.append({"type": "bite", "crawler": c})
		if s.bites >= s.max_bites:
			s.phase = "overrun"
			s.input = ""
			ev.append({"type": "overrun"})
			return


func _check_repelled(ev: Array) -> void:
	var s := state
	if s.phase != "fighting" or s.remaining > 0 or s.crawlers.size() > 0:
		return
	s.phase = "repelled"
	s.input = ""
	ev.append({"type": "repelled"})


func _remove(c: Dictionary) -> void:
	var list: Array = state.crawlers
	for i in list.size():
		if list[i].id == c.id:
			list.remove_at(i)
			return


# ---------------------------------------------------------------- input (as BattleSim)

func type_digit(dv: Variant) -> void:
	var s := state
	if s.phase != "fighting" or not Js.is_integer(dv) or dv < 0 or dv > 9:
		return
	var d := int(dv)
	var negative: bool = s.input.begins_with("-")
	var digits: String = s.input.substr(1) if negative else s.input
	if digits.length() >= Battle.MAX_INPUT_DIGITS:
		return
	var next_digits := str(d) if digits == "0" else digits + str(d)
	s.input = ("-" if negative else "") + next_digits


func toggle_sign() -> void:
	var s := state
	if s.phase != "fighting":
		return
	var any_negative := false
	for c in s.crawlers:
		if c.fact.answer < 0:
			any_negative = true
			break
	if not any_negative:
		return
	s.input = s.input.substr(1) if s.input.begins_with("-") else "-" + s.input


func backspace() -> void:
	var s := state
	if s.phase != "fighting":
		return
	s.input = s.input.substr(0, maxi(0, s.input.length() - 1))


func submit() -> Array:
	var s := state
	if s.phase != "fighting":
		return []
	var digits: String = s.input.substr(1) if s.input.begins_with("-") else s.input
	if digits.length() == 0:
		return []
	var typed = Js.norm_num(Js.to_number(s.input))
	var ev: Array = []
	s.input = ""
	var target = _nearest(s.crawlers.filter(func(c): return c.fact.answer == typed))
	if target != null:
		var response_ms = Js.norm_num(s.time_ms - maxf(target.spawned_at, _last_submit_at))
		var was_wrong := _wronged.has(target.id)
		var outcome := "slow" if was_wrong else Mastery.classify(target.fact, true, response_ms)
		var fast: bool = not was_wrong and response_ms <= Mastery.fast_threshold_ms(target.fact)
		_remove(target)
		_wronged.erase(target.id)
		s.kills += 1
		records.append({"fact_id": target.fact.stat_id, "outcome": outcome, "response_ms": response_ms})
		ev.append({"type": "kill", "crawler": target, "fast": fast})
		_last_submit_at = s.time_ms
		_check_repelled(ev)
		return ev
	var victim = _nearest(s.crawlers)
	if victim != null and not _wronged.has(victim.id):
		_wronged[victim.id] = true
		records.append({
			"fact_id": victim.fact.stat_id,
			"outcome": "wrong",
			"response_ms": Js.norm_num(s.time_ms - maxf(victim.spawned_at, _last_submit_at)),
		})
	_last_submit_at = s.time_ms
	ev.append({"type": "wrong", "typed": typed})
	return ev
