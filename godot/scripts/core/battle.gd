class_name Battle
## Port of the constants and helpers of src/core/battle.ts. The simulation class BattleSim is in
## battle_sim.gd (class_name BattleSim).
##
## Shapes (Dictionaries, snake_case):
##   Enemy  {id, fact, lane, x, y, speed, spawned_at, armed, charge}
##   Dome   {hp, max_hp}
##   BattlePhase "spawning" | "waveCleared" | "explaining" | "boarding" | "won" | "lost"
##   BoardingResult {repelled: bool, records: Array[AnswerRecord], kills: int}
##   AnswerRecord {fact_id, outcome, response_ms}   (fact_id holds the problem's stat_id)
##   BattleConfig {planet_id, total_waves, stats, planets, modules, now, seed, speed_scale, density?}
##   BattleState  {phase, time_ms, wave, total_waves, enemies, domes, input, score, streak, best_streak,
##                 kills, wrong_answers, owned_upgrades, missed, explaining, auto_turret_cooldown_ms,
##                 shield_charges, hull, hull_max, boardings}
##   BattleEvent {type: ...} with the TS event names and snake_case fields:
##     spawn {enemy} | kill {enemy, fast, by_turret, points} | wrong {typed} |
##     impact {enemy, dome_index, destroyed} | shieldBlock {enemy, dome_index} | repair {dome_index} |
##     waveCleared {wave} | explainStart {fact} | explainEnd | shipHit {enemy, hull} | breach | won | lost

# ---- Field geometry (logical pixels) ----
## Waves of a campaign mission (callers pass it as BattleConfig.total_waves).
const MISSION_WAVES := 3
const FIELD_WIDTH := 1280
const FIELD_HEIGHT := 720
const SPAWN_Y := 60
const IMPACT_Y := 600
const LANE_X: Array[int] = [140, 340, 540, 740, 940, 1140]
const DOME_X: Array[int] = [240, 507, 773, 1040]
## No spawn in a lane whose newest enemy is still above this y.
const LANE_CLEAR_Y := 200

# ---- Rules ----
## Enemies alive at once at the default density (1).
const MAX_ALIVE := 4
const EXPLAIN_MS := 2500
const BASE_DOME_HP := 2
const MAX_INPUT_DIGITS := 4
## Pause before the first enemy of each wave appears.
const WAVE_START_DELAY_MS := 1000
## update() advances the simulation in sub-steps of at most this length.
const MAX_STEP_MS := 50
const TURRET_POINTS := 5
const WRONG_PENALTY := 5
const REPAIR_STREAK := 10

# ---- Attack and boarding (v6) ----
## An armed enemy charges its laser while its y is at or below this line.
const FIRE_LINE_Y := 90
## Hull points of the player's ship; at 0 the ship is boarded.
const HULL_MAX := 2
## Charge time of an enemy laser at speedScale 1.
const CHARGE_MS := 6000
## Tolerance for the sum of sub-step charge increments (floating point).
const CHARGE_EPSILON := 1e-9
## Points (and kills) per crawler destroyed in a boarding.
const BOARDING_KILL_POINTS := 10
## Crawlers per boarding (also exported by Boarding).
const BOARDING_CRAWLERS := 8
## Chance that an enemy is armed, by wave (index 0 = wave 1); later waves use the last value.
const ARMED_CHANCE: Array[float] = [0.4, 0.5, 0.6]


## Enemies alive at once for a density: 2 / 3 / 4 / 5 for 0.5 / 0.75 / 1 / 1.25.
static func max_alive(density: float = 1.0) -> int:
	return maxi(1, Js.round(MAX_ALIVE * density))


static func enemies_in_wave(w: int) -> int:
	return 6 + 2 * w


static func spawn_interval_ms(w: int, speed_scale: float = 1.0, density: float = 1.0) -> float:
	return maxf(1800.0, 3600.0 - 250.0 * w) / speed_scale / density


static func base_speed(w: int, speed_scale: float = 1.0) -> float:
	return (20.0 + 3.0 * w) * speed_scale


static func armed_chance(w: int) -> float:
	return ARMED_CHANCE[mini(maxi(1, w), ARMED_CHANCE.size()) - 1]


## Time an armed enemy needs from charge 0 to firing.
static func charge_ms(speed_scale: float = 1.0) -> float:
	return CHARGE_MS / speed_scale
