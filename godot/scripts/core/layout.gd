class_name Layout
## Port of src/core/layout.ts: galaxy layout math (pure, deterministic).
## Disc = {x, y, radius}; Point = {x, y}; SectorSlot = {radius, group}.

const WORLD_W := 4800
const WORLD_H := 2700
## Sector discs keep this far from the world edge.
const WORLD_MARGIN := 60
## Minimum distance between any two star systems.
const MIN_SYSTEM_SPACING := 70
## Largest allowed overlap of two sector discs (see disc_overlap).
const MAX_SECTOR_OVERLAP := 0.15

## Base hue of each skill's colour family (degrees).
const SKILL_HUE := {
	"typing": 180,
	"addition": 135,
	"subtraction": 90,
	"multiplication": 270,
	"division": 315,
	"negatives": 225,
	"missing": 0,
	"mixed": 45,
}
## Hue step between sectors of the same skill.
const SECTOR_HUE_STEP := 5

## Allowed overlap of sectors of the same skill while placing (below the tested limit).
const PLACE_OVERLAP := 0.06
## Extra empty space between sectors of different skills.
const SKILL_GAP := 30

const NAME_BAND_HALF_W := 300
const NAME_BAND_HALF_H := 56
const NAME_BAND_OFFSETS: Array[float] = [0.0, -0.35, 0.35, -0.6, 0.6]

## Sun hues look like stars: warm reds and golds, or blue-white.
const SUN_HUES: Array[int] = [12, 24, 36, 44, 52, 205, 215]


## Sector hue: the skill's base hue, offset symmetrically by the sector's index in the skill.
static func sector_hue(skill: String, index_in_skill: int, count_in_skill: int) -> float:
	var offset := (float(index_in_skill) - float(count_in_skill - 1) / 2.0) * SECTOR_HUE_STEP
	return fmod(fmod(float(SKILL_HUE[skill]) + offset, 360.0) + 360.0, 360.0)


## Shortest distance between two hues on the colour wheel (0..180).
static func hue_distance(a: float, b: float) -> float:
	var d := fmod(absf(a - b), 360.0)
	return 360.0 - d if d > 180.0 else d


## Sector disc radius: grows with the number of systems.
static func sector_radius(system_count: int) -> int:
	return 80 + 45 * maxi(1, system_count)


## How much two discs overlap: penetration depth divided by the smaller diameter (0 = apart).
static func disc_overlap(a: Dictionary, b: Dictionary) -> float:
	var d := Js.hypot(a.x - b.x, a.y - b.y)
	var depth := maxf(0.0, a.radius + b.radius - d)
	return depth / (2.0 * minf(a.radius, b.radius))


## Sector discs grouped by skill along a loose spiral around the world centre (see layout.ts).
## Returns Array of {x, y, radius}; null (with an error) when a sector finds no room (TS throws).
static func place_sectors(slots: Array, seed: int = 2718) -> Variant:
	var rng := Rng.new(seed)
	var cx := WORLD_W / 2.0
	var cy := WORLD_H / 2.0
	var sx := sqrt(float(WORLD_W) / float(WORLD_H))
	var placed: Array = []
	var t := 0.0
	for slot in slots:
		var radius: float = slot.radius
		var group: String = slot.group
		if placed.is_empty():
			placed.append({"x": cx, "y": cy, "radius": radius, "group": group})
			continue
		var wobble := 1.0 + (rng.next() - 0.5) * 0.25
		var fits := func(c: Dictionary) -> bool:
			if not (c.x - radius >= WORLD_MARGIN and c.x + radius <= WORLD_W - WORLD_MARGIN
					and c.y - radius >= WORLD_MARGIN and c.y + radius <= WORLD_H - WORLD_MARGIN):
				return false
			for p in placed:
				if p.group == group:
					if disc_overlap(p, c) > PLACE_OVERLAP:
						return false
				elif Js.hypot(p.x - c.x, p.y - c.y) < p.radius + c.radius + SKILL_GAP:
					return false
			return true
		var prev: Dictionary = placed[placed.size() - 1]
		var found = null
		if prev.group == group:
			var best_d := INF
			for extra in [0, 40, 90, 160]:
				var dist: float = prev.radius + radius + extra
				for k in 96:
					var a := (float(k) / 96.0) * PI * 2.0
					var cand := {"x": Js.round(prev.x + cos(a) * dist), "y": Js.round(prev.y + sin(a) * dist), "radius": radius}
					var d := Js.hypot(cand.x - cx, cand.y - cy)
					if d < best_d and fits.call(cand):
						best_d = d
						found = cand
				if found != null:
					break
		if found == null:
			t = maxf(0.0, t - 1.2)
			var guard := 0
			while guard < 40000 and found == null:
				t += 0.005
				var r := 100.0 * t * wobble
				var cand := {"x": Js.round(cx + cos(t) * r * sx), "y": Js.round(cy + sin(t) * r / sx), "radius": radius}
				if fits.call(cand):
					found = cand
				guard += 1
		if found == null:
			push_error("galaxy layout: no room for sector %d (%s)" % [placed.size(), group])
			return null
		placed.append({"x": found.x, "y": found.y, "radius": radius, "group": group})
	var out: Array = []
	for p in placed:
		out.append({"x": p.x, "y": p.y, "radius": p.radius})
	return out


## `count` system positions inside a sector disc (see layout.ts). Array of {x, y}; null on failure.
static func scatter_systems(sector: Dictionary, count: int, others: Array, seed: int) -> Variant:
	var rng := Rng.new(seed)
	var out: Array = []
	var spread: float = sector.radius * 0.7
	for i in count:
		var point = null
		var attempt := 0
		while attempt < 500 and point == null:
			var reach: float = spread * 0.25 if (count == 1 and attempt < 50) else spread * minf(1.4, 1.0 + attempt / 400.0)
			var a := rng.next() * PI * 2.0
			var r := sqrt(rng.next()) * reach
			var cand := {"x": Js.round(sector.x + cos(a) * r), "y": Js.round(sector.y + sin(a) * r)}
			var ok := true
			for o in others:
				if Js.hypot(o.x - cand.x, o.y - cand.y) < MIN_SYSTEM_SPACING:
					ok = false
					break
			if ok:
				for o in out:
					if Js.hypot(o.x - cand.x, o.y - cand.y) < MIN_SYSTEM_SPACING:
						ok = false
						break
			if ok:
				point = cand
			attempt += 1
		if point == null:
			push_error("galaxy layout: no room for a system")
			return null
		out.append(point)
	return out


## True when one of the name bands of the sector is free of the given systems.
static func has_name_band(sector: Dictionary, points: Array) -> bool:
	for k in NAME_BAND_OFFSETS:
		var free := true
		for p in points:
			if not (absf(p.x - sector.x) > NAME_BAND_HALF_W or absf(p.y - (sector.y + k * sector.radius)) > NAME_BAND_HALF_H):
				free = false
				break
		if free:
			return true
	return false


static func sun_hue_for(seed: int) -> int:
	return Rng.new(seed).pick(SUN_HUES)


## Starting angle of a planet on its orbit, radians in [0, 2π).
static func planet_angle_for(seed: int) -> float:
	return Rng.new(seed).next() * PI * 2.0
