class_name BattleSim
extends RefCounted
## Port of class BattleSim in src/core/battle.ts (constants and shapes: Battle in battle.gd).
## `BattleSim.new(cfg)`; `state` and `records` are read by the scene; update(dt_ms) returns events.

var state: Dictionary
var records: Array = []
var config: Dictionary

var _rng: Rng
var _targeting_mult: float
var _speed_scale: float
var _density: float
var _max_alive: int
var _effects: Dictionary
var _scheduler: Scheduler.MissionScheduler
var _queue: Array = []
var _queue_index := 0
## Id of the problem spawned last (never spawned twice in a row).
var _last_spawned_id = null
var _spawn_timer_ms: float = Battle.WAVE_START_DELAY_MS
var _next_enemy_id := 1
var _explain_remaining_ms := 0.0
var _last_submit_at := 0.0
var _correct_answers := 0
var _wronged := {}
var _offer_ids: Array = []


## cfg = BattleConfig {planet_id, total_waves, stats, planets, modules, now, seed, speed_scale, density?}
func _init(cfg: Dictionary) -> void:
	config = cfg
	_rng = Rng.new(cfg.seed)
	var ss = cfg.get("speed_scale")
	_speed_scale = ss if Js.is_finite_num(ss) and ss > 0 else 1.0
	var d = cfg.get("density", 1.0)
	_density = d if Js.is_finite_num(d) and d > 0 else 1.0
	_max_alive = Battle.max_alive(_density)
	_targeting_mult = Economy.targeting_multiplier(Economy.module_tier(cfg.modules, "targeting"))
	var max_hp := Battle.BASE_DOME_HP + Economy.hull_bonus_hp(Economy.module_tier(cfg.modules, "hull"))
	var domes: Array = []
	for _x in Battle.DOME_X:
		domes.append({"hp": max_hp, "max_hp": max_hp})
	state = {
		"phase": "spawning",
		"time_ms": 0.0,
		"wave": 1,
		"total_waves": maxi(1, cfg.total_waves),
		"enemies": [],
		"domes": domes,
		"input": "",
		"score": 0,
		"streak": 0,
		"best_streak": 0,
		"kills": 0,
		"wrong_answers": 0,
		"owned_upgrades": Upgrades.head_start_upgrades(
			Economy.head_start_upgrade_count(Economy.module_tier(cfg.modules, "headStart")), _rng),
		"missed": [],
		"explaining": null,
		"auto_turret_cooldown_ms": 0.0,
		"shield_charges": 0,
		"hull": Battle.HULL_MAX,
		"hull_max": Battle.HULL_MAX,
		"boardings": 0,
	}
	_effects = Upgrades.upgrade_effects(state.owned_upgrades)
	if _effects.turret_cooldown_ms != null:
		state.auto_turret_cooldown_ms = float(_effects.turret_cooldown_ms)
	_scheduler = Scheduler.create_mission_scheduler({
		"planet_id": cfg.planet_id, "stats": cfg.stats, "planets": cfg.planets, "now": cfg.now, "rng": _rng,
	})
	_start_wave_queue()


# ---------------------------------------------------------------- queries

## Domes with hp > 0.
func domes_standing() -> int:
	var n := 0
	for d in state.domes:
		if d.hp > 0:
			n += 1
	return n


## Correct player answers / all player answers (1 when nothing was answered). Turret kills excluded.
func accuracy() -> float:
	var total: int = _correct_answers + state.wrong_answers
	return 1.0 if total == 0 else float(_correct_answers) / float(total)


## Combined effects of the upgrades bought this mission (e.g. salvage_tier for mission_credits).
func upgrade_effects() -> Dictionary:
	return _effects.duplicate()


## Enemies of the current wave not yet spawned.
func remaining_to_spawn() -> int:
	return _queue.size() - _queue_index


## "Lowest" enemy = closest to the planet = greatest y (ties: oldest id).
static func _lowest(enemies: Array) -> Variant:
	var best = null
	for e in enemies:
		if best == null or e.y > best.y or (e.y == best.y and e.id < best.id):
			best = e
	return best


# ---------------------------------------------------------------- simulation

func update(dt_ms: float) -> Array:
	var events: Array = []
	var left := maxf(0.0, dt_ms)
	while left > 0:
		var step := minf(Battle.MAX_STEP_MS, left)
		left -= step
		_step(step, events)
	return events


func _step(dt: float, ev: Array) -> void:
	var s := state
	if s.phase == "explaining":
		_explain_remaining_ms -= dt
		if _explain_remaining_ms <= 0:
			_explain_remaining_ms = 0.0
			s.phase = "spawning"
			s.explaining = null
			ev.append({"type": "explainEnd"})
			_check_wave_end(ev)
		return
	if s.phase != "spawning":
		return
	s.time_ms += dt
	_step_turret(dt, ev)
	_step_spawn(dt, ev)
	for e in s.enemies:
		e.y += (e.speed * dt) / 1000.0
	_step_impacts(ev)
	if s.phase == "spawning":
		_step_charge(dt, ev)
	if s.phase == "spawning":
		_check_wave_end(ev)


## Armed enemies below the fire line charge; at 1 they hit the hull. At hull 0: breach.
func _step_charge(dt: float, ev: Array) -> void:
	var s := state
	var rate := dt / Battle.charge_ms(_speed_scale)
	for e in s.enemies:
		if not e.armed or e.y < Battle.FIRE_LINE_Y:
			continue
		e.charge = minf(1.0, e.charge + rate)
		if e.charge < 1.0 - Battle.CHARGE_EPSILON:
			continue
		e.charge = 0.0
		s.hull = maxi(0, s.hull - 1)
		ev.append({"type": "shipHit", "enemy": e, "hull": s.hull})
		if s.hull == 0:
			s.phase = "boarding"
			s.input = ""
			ev.append({"type": "breach"})
			return


func _step_turret(dt: float, ev: Array) -> void:
	var cooldown = _effects.turret_cooldown_ms
	if cooldown == null:
		return
	var s := state
	s.auto_turret_cooldown_ms = maxf(0.0, s.auto_turret_cooldown_ms - dt)
	if s.auto_turret_cooldown_ms > 0:
		return
	var mastered: Array = s.enemies.filter(func(e): return Mastery.is_mastered(config.stats.get(e.fact.stat_id)))
	var target = _lowest(mastered)
	if target == null:
		return   # stays ready until a mastered fact appears
	_remove_enemy(target)
	s.score += Battle.TURRET_POINTS
	s.kills += 1
	_wronged.erase(target.id)
	s.auto_turret_cooldown_ms = float(cooldown)
	ev.append({"type": "kill", "enemy": target, "fast": false, "by_turret": true, "points": Battle.TURRET_POINTS})


func _step_spawn(dt: float, ev: Array) -> void:
	var s := state
	if _queue_index >= _queue.size():
		return
	_spawn_timer_ms = maxf(0.0, _spawn_timer_ms - dt)
	if _spawn_timer_ms > 0 or s.enemies.size() >= _max_alive:
		return
	var free_lanes: Array = []
	for lane in Battle.LANE_X.size():
		var blocked := false
		for e in s.enemies:
			if e.lane == lane and e.y <= Battle.LANE_CLEAR_Y:
				blocked = true
				break
		if not blocked:
			free_lanes.append(lane)
	if free_lanes.is_empty():
		return
	var fact = _next_fact()
	if fact == null:
		return   # every candidate is on screen already: wait for one to go
	var lane: int = _rng.pick(free_lanes)
	var factor := 0.9 + 0.2 * _rng.next()
	# The first enemy of a mission is never armed (and draws nothing for it).
	var armed := _next_enemy_id > 1 and _rng.next() < Battle.armed_chance(s.wave)
	var enemy := {
		"id": _next_enemy_id,
		"fact": fact,
		"lane": lane,
		"x": Battle.LANE_X[lane],
		"y": float(Battle.SPAWN_Y),
		"speed": Battle.base_speed(s.wave, _speed_scale) * factor * _effects.speed_mult,
		"spawned_at": s.time_ms,
		"armed": armed,
		"charge": 0.0,
	}
	_next_enemy_id += 1
	s.enemies.append(enemy)
	_spawn_timer_ms = Battle.spawn_interval_ms(s.wave, _speed_scale, _density)
	ev.append({"type": "spawn", "enemy": enemy})


## The next problem to spawn (see battle.ts nextFact). Null (spawn waits) when nothing fits.
func _next_fact() -> Variant:
	var alive := {}
	for e in state.enemies:
		alive[e.fact.id] = true
	var strict := alive.duplicate()
	if _last_spawned_id != null:
		strict[_last_spawned_id] = true
	var q := _queue
	var j := _queue_index
	while j < q.size() and strict.has(q[j].id):
		j += 1
	if j < q.size():
		var tmp = q[_queue_index]
		q[_queue_index] = q[j]
		q[j] = tmp
	else:
		var wave: int = state.wave - 1
		var replacement = _scheduler.replacement(wave, strict)
		if replacement == null:
			replacement = _scheduler.replacement(wave, alive)
		if replacement == null:
			return null
		q[_queue_index] = replacement
	var fact = q[_queue_index]
	_queue_index += 1
	_last_spawned_id = fact.id
	return fact


func _step_impacts(ev: Array) -> void:
	var s := state
	var hits := Js.sorted(s.enemies.filter(func(e): return e.y >= Battle.IMPACT_Y),
		func(p, q): return (q.y - p.y) if q.y != p.y else (p.id - q.id))
	if hits.is_empty():
		return
	var first = null
	for enemy in hits:
		_remove_enemy(enemy)
		enemy.y = float(Battle.IMPACT_Y)
		var dome_index := _dome_to_hit(enemy.x)
		_wronged.erase(enemy.id)
		records.append({"fact_id": enemy.fact.stat_id, "outcome": "missed", "response_ms": Js.norm_num(s.time_ms - enemy.spawned_at)})
		var known := false
		for f in s.missed:
			if f.id == enemy.fact.id:
				known = true
				break
		if not known:
			s.missed.append(enemy.fact)
		if first == null:
			first = enemy.fact
		if s.shield_charges > 0:
			s.shield_charges -= 1
			ev.append({"type": "shieldBlock", "enemy": enemy, "dome_index": dome_index})
			continue
		var dome: Dictionary = s.domes[dome_index]
		dome.hp = maxi(0, dome.hp - 1)
		s.streak = 0
		ev.append({"type": "impact", "enemy": enemy, "dome_index": dome_index, "destroyed": dome.hp == 0})
		if domes_standing() == 0:
			s.phase = "lost"
			s.input = ""
			ev.append({"type": "lost"})
			return
	s.phase = "explaining"
	s.explaining = first
	s.input = ""
	_explain_remaining_ms = Battle.EXPLAIN_MS
	if first != null:
		ev.append({"type": "explainStart", "fact": first})


## Nearest standing dome to x (the nearest one if it stands, else the next nearest standing).
func _dome_to_hit(x: float) -> int:
	var order: Array = []
	for i in Battle.DOME_X.size():
		order.append({"i": i, "d": absf(Battle.DOME_X[i] - x)})
	order = Js.sorted(order, func(p, q): return (p.d - q.d) if p.d != q.d else (p.i - q.i))
	for o in order:
		if state.domes[o.i].hp > 0:
			return o.i
	return order[0].i


func _check_wave_end(ev: Array) -> void:
	var s := state
	if s.phase != "spawning" or _queue_index < _queue.size() or s.enemies.size() > 0:
		return
	s.input = ""
	if s.wave >= s.total_waves:
		s.phase = "won"
		ev.append({"type": "won"})
		return
	s.phase = "waveCleared"
	_offer_ids = Upgrades.pick_offer_ids(s.owned_upgrades, _rng)
	ev.append({"type": "waveCleared", "wave": s.wave})


func _remove_enemy(enemy: Dictionary) -> void:
	var list: Array = state.enemies
	for i in list.size():
		if list[i].id == enemy.id:
			list.remove_at(i)
			return


## Most damaged dome gains 1 hp (destroyed domes can be rebuilt). Returns its index or -1.
func _repair_most_damaged() -> int:
	var best := -1
	var domes: Array = state.domes
	for i in domes.size():
		var d: Dictionary = domes[i]
		if d.hp >= d.max_hp:
			continue
		if best < 0 or d.hp < domes[best].hp:
			best = i
	if best >= 0:
		domes[best].hp += 1
	return best


func _start_wave_queue() -> void:
	var s := state
	_queue = _scheduler.wave(s.wave - 1, Battle.enemies_in_wave(s.wave))
	_queue_index = 0
	_spawn_timer_ms = Battle.WAVE_START_DELAY_MS
	s.shield_charges = _effects.shield_per_wave


# ---------------------------------------------------------------- input

## d must be an integer 0..9 (anything else is ignored, like Number.isInteger in TS).
func type_digit(dv: Variant) -> void:
	var s := state
	if s.phase != "spawning" or not Js.is_integer(dv) or dv < 0 or dv > 9:
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
	if s.phase != "spawning":
		return
	var any_negative := false
	for e in s.enemies:
		if e.fact.answer < 0:
			any_negative = true
			break
	if not any_negative:
		return
	s.input = s.input.substr(1) if s.input.begins_with("-") else "-" + s.input


func backspace() -> void:
	var s := state
	if s.phase != "spawning":
		return
	s.input = s.input.substr(0, maxi(0, s.input.length() - 1))


func submit() -> Array:
	var s := state
	if s.phase != "spawning":
		return []
	var digits: String = s.input.substr(1) if s.input.begins_with("-") else s.input
	if digits.length() == 0:
		return []
	var typed = Js.norm_num(Js.to_number(s.input))
	var ev: Array = []
	var target = _lowest(s.enemies.filter(func(e): return e.fact.answer == typed))
	if target != null:
		var response_ms = Js.norm_num(s.time_ms - maxf(target.spawned_at, _last_submit_at))
		var was_wrong := _wronged.has(target.id)
		var outcome := "slow" if was_wrong else Mastery.classify(target.fact, true, response_ms)
		var fast: bool = not was_wrong and response_ms <= Mastery.fast_threshold_ms(target.fact, _targeting_mult)
		var points := Js.round((10 + (5 if fast else 0) + mini(s.streak, 20)) * _effects.score_mult)
		_remove_enemy(target)
		_wronged.erase(target.id)
		s.score += points
		s.streak += 1
		s.best_streak = maxi(s.best_streak, s.streak)
		s.kills += 1
		_correct_answers += 1
		records.append({"fact_id": target.fact.stat_id, "outcome": outcome, "response_ms": response_ms})
		ev.append({"type": "kill", "enemy": target, "fast": fast, "by_turret": false, "points": points})
		if s.streak % Battle.REPAIR_STREAK == 0:
			var dome_index := _repair_most_damaged()
			if dome_index >= 0:
				ev.append({"type": "repair", "dome_index": dome_index})
		s.input = ""
		_last_submit_at = s.time_ms
		_check_wave_end(ev)
		return ev
	s.streak = 0
	s.score = maxi(0, s.score - Battle.WRONG_PENALTY)
	s.wrong_answers += 1
	s.input = ""
	var victim = _lowest(s.enemies)
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


# ---------------------------------------------------------------- boarding

## Problems for one boarding, drawn from the mission scheduler. Consumes the sim Rng.
func boarding_facts(n: int = Battle.BOARDING_CRAWLERS) -> Array:
	return _scheduler.wave(state.wave - 1, maxi(0, n))


## Applies the outcome of a boarding (phase "boarding" only; otherwise no-op, []).
## result = {repelled, records, kills}
func resolve_boarding(result: Dictionary) -> Array:
	var s := state
	if s.phase != "boarding":
		return []
	records.append_array(result.records)
	var kills := maxi(0, int(floorf(result.kills)))
	s.score += Battle.BOARDING_KILL_POINTS * kills
	s.kills += kills
	s.input = ""
	if not result.repelled:
		s.phase = "lost"
		return [{"type": "lost"}]
	s.hull = s.hull_max
	for e in s.enemies:
		e.charge = 0.0
	s.boardings += 1
	s.phase = "spawning"
	return []


# ---------------------------------------------------------------- between waves

## The three (or fewer) upgrades offered after a cleared wave; [] outside phase "waveCleared".
func offers() -> Array:
	if state.phase != "waveCleared":
		return []
	var out: Array = []
	for id in _offer_ids:
		var d = Upgrades.upgrade_by_id(id)
		var o = Upgrades.offer_for(d, state.owned_upgrades) if d != null else null
		if o != null:
			out.append(o)
	return out


## Takes one offered upgrade for free and starts the next wave (events of next_wave()).
func pick_upgrade(upgrade_id: String) -> Array:
	var offer = null
	for o in offers():
		if o.def.id == upgrade_id:
			offer = o
			break
	if offer == null:
		return []
	var s := state
	var owned: Dictionary = s.owned_upgrades.duplicate()
	owned[upgrade_id] = offer.next_tier
	s.owned_upgrades = owned
	_effects = Upgrades.upgrade_effects(s.owned_upgrades)
	if upgrade_id == "autoTurret" and _effects.turret_cooldown_ms != null:
		s.auto_turret_cooldown_ms = float(_effects.turret_cooldown_ms)
	return next_wave()


## Leaves "waveCleared" without an upgrade: starts the next wave; repair drone and shield apply.
func next_wave() -> Array:
	var s := state
	if s.phase != "waveCleared":
		return []
	var ev: Array = []
	s.wave += 1
	s.phase = "spawning"
	s.input = ""
	_offer_ids = []
	_start_wave_queue()
	for i in _effects.repair_per_wave:
		var dome_index := _repair_most_damaged()
		if dome_index < 0:
			break
		ev.append({"type": "repair", "dome_index": dome_index})
	return ev
