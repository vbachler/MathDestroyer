class_name Boarding
## Port of the constants and helpers of src/core/boarding.ts (the sim is BoardingSim in boarding_sim.gd).
##   CrawlerKind "scorpion" | "spider" | "crab" | "beetle" | "stalker" | "drifter" | "wraith"
##   Crawler  {id, fact, kind, lane (-1|0|1), z (1 far door .. 0 at the turret), speed (z per s), spawned_at}
##   BoardingState {phase ("fighting"|"repelled"|"overrun"), time_ms, crawlers, input, bites, max_bites,
##                  remaining, kills}
##   BoardingEvent spawn {crawler} | kill {crawler, fast} | wrong {typed} | bite {crawler} | repelled | overrun
##   BoardingConfig {facts, seed, speed_scale, density?}

const BOARDING_CRAWLERS := Battle.BOARDING_CRAWLERS
## Every kind, all equally likely at spawn.
const CRAWLER_KINDS: Array[String] = ["scorpion", "spider", "crab", "beetle", "stalker", "drifter", "wraith"]
## Speed factor per kind (z per second = factor * speed_scale * 1000 / APPROACH_MS).
const CRAWLER_SPEED := {
	"scorpion": 1.0, "spider": 1.2, "crab": 0.85, "beetle": 1.0, "stalker": 1.15, "drifter": 0.9, "wraith": 0.8,
}
const BOARDING_MAX_ALIVE := 3
const BOARDING_MAX_BITES := 3
## Time for z 1 -> 0 at speed factor 1 and speed_scale 1.
const APPROACH_MS := 11000
## Interval between spawns at speed_scale 1 and density 1 (divided by speed_scale and density).
const BOARDING_SPAWN_MS := 2600
## Delay before the first crawler (not scaled).
const BOARDING_FIRST_SPAWN_MS := 1200
## Two crawlers on the same lane are never closer than this in z.
const LANE_GAP_Z := 0.25
const BOARDING_LANES: Array[int] = [-1, 0, 1]


## Crawlers alive at once for a density: 2 below 1, otherwise BOARDING_MAX_ALIVE.
static func boarding_max_alive(density: float = 1.0) -> int:
	return 2 if density < 1 else BOARDING_MAX_ALIVE


## A new crawler (z 1, `speed`) may share a lane with `c` only if the gap stays >= LANE_GAP_Z
## until `c` reaches the turret.
static func lane_clear(c: Dictionary, speed: float) -> bool:
	var limit := 1.0 - LANE_GAP_Z
	return c.z <= limit and speed * c.z <= limit * c.speed
