class_name Content
## Port of src/core/content.ts: galaxy content Skill -> Sector -> System -> Planet. Built once on
## first use, deterministic. TS constants SECTORS / SYSTEMS / PLANETS / SKILLS are the functions
## sectors() / systems() / planets() / skills() here (the arrays are shared: do not modify).

## Sectors in galaxy order, grouped by skill.
const SECTOR_LIST := [
	["type-1", "typing"], ["type-2", "typing"], ["type-3", "typing"],
	["add-5", "addition"], ["add-10", "addition"], ["add-15", "addition"], ["add-50", "addition"], ["add-100", "addition"],
	["sub-5", "subtraction"], ["sub-10", "subtraction"], ["sub-15", "subtraction"], ["sub-50", "subtraction"],
	["sub-100", "subtraction"],
	["mul-a", "multiplication"], ["mul-b", "multiplication"], ["mul-c", "multiplication"], ["mul-d", "multiplication"],
	["div-a", "division"], ["div-b", "division"], ["div-c", "division"], ["div-d", "division"],
	["neg-10", "negatives"], ["neg-20", "negatives"],
	["miss-add", "missing"], ["miss-sub", "missing"], ["miss-mul", "missing"], ["miss-div", "missing"],
	["core", "mixed"],
]

const CORE_SECTOR_ID := "core"
const CORE_PLANET_ID := "core.1"

const MIN_SYSTEMS_PER_SECTOR := 3
const MAX_SYSTEMS_PER_SECTOR := 5
const MIN_PLANETS_PER_SYSTEM := 3
const MAX_PLANETS_PER_SYSTEM := 5
## Enemy speed grows by this much per system tier (system index in its sector, 0-based).
const TIER_SPEED_STEP := 0.08
## Attempts at scattering a sector's systems so that a band for its name stays free.
const NAME_BAND_TRIES := 40

static var _sectors: Array = []
static var _systems: Array = []
static var _planets: Array = []
static var _skills: Array = []
static var _sector_index := {}
static var _system_index := {}
static var _planet_index := {}
static var _built := false


## Size of a sector's problem space.
static func sector_size(sector_id: String) -> int:
	return FactGen.sector_facts(sector_id).size() if FactGen.sector_kind(sector_id) == "enumerated" \
		else FactGen.possible_problems(sector_id)


## Systems of a sector from its size: 3 up to 40 problems, 4 up to 150, else 5.
static func system_count_for(size: int) -> int:
	if size <= 40:
		return MIN_SYSTEMS_PER_SECTOR
	if size <= 150:
		return 4
	return MAX_SYSTEMS_PER_SECTOR


## Planets of a system, 3..5, stable per system id.
static func _planet_count_for(system_id: String) -> int:
	return MIN_PLANETS_PER_SYSTEM + (Names.stable_hash("planets:" + system_id) % (MAX_PLANETS_PER_SYSTEM - MIN_PLANETS_PER_SYSTEM + 1))


static func _shape_of(sector_id: String, skill: String) -> Dictionary:
	if sector_id == CORE_SECTOR_ID:
		return {"sector_id": sector_id, "skill": skill, "planets_per_system": [1]}
	var n := system_count_for(sector_size(sector_id))
	var pps: Array = []
	for i in n:
		pps.append(_planet_count_for("%s.s%d" % [sector_id, i + 1]))
	return {"sector_id": sector_id, "skill": skill, "planets_per_system": pps}


static func _place_systems(shape: Dictionary, disc: Dictionary, others: Array) -> Array:
	var points: Array = []
	for attempt in NAME_BAND_TRIES:
		var key: String = "pos:" + shape.sector_id if attempt == 0 else "pos:%s:%d" % [shape.sector_id, attempt]
		var placed = Layout.scatter_systems(disc, shape.planets_per_system.size(), others, Names.stable_hash(key))
		points = placed if placed != null else []
		if Layout.has_name_band(disc, points):
			break
	return points


static func _build_galaxy() -> Array:
	var shapes: Array = []
	for entry in SECTOR_LIST:
		shapes.append(_shape_of(entry[0], entry[1]))
	# The core sits at the centre of the galaxy; the skills spiral outward around it.
	var place_order: Array = []
	for s in shapes:
		if s.sector_id == CORE_SECTOR_ID:
			place_order.append(s)
	for s in shapes:
		if s.sector_id != CORE_SECTOR_ID:
			place_order.append(s)
	var slots: Array = []
	for s in place_order:
		slots.append({"radius": Layout.sector_radius(s.planets_per_system.size()), "group": s.skill})
	var placed_discs: Array = Layout.place_sectors(slots)
	var discs: Array = []
	for s in shapes:
		discs.append(placed_discs[place_order.find(s)])
	var names := Names.create_name_registry()
	var all_points: Array = []
	var skill_count := {}
	for s in shapes:
		skill_count[s.skill] = skill_count.get(s.skill, 0) + 1
	var skill_index := {}

	var out: Array = []
	for order in shapes.size():
		var shape: Dictionary = shapes[order]
		var disc: Dictionary = discs[order]
		var idx: int = skill_index.get(shape.skill, 0)
		skill_index[shape.skill] = idx + 1
		var points := _place_systems(shape, disc, all_points)
		all_points.append_array(points)
		var planet_no := 0
		var systems: Array = []
		for si in shape.planets_per_system.size():
			var count: int = shape.planets_per_system[si]
			var system_id := "%s.s%d" % [shape.sector_id, si + 1]
			var planets: Array = []
			for orbit in count:
				planet_no += 1
				var id := "%s.%d" % [shape.sector_id, planet_no]
				planets.append({
					"id": id, "system_id": system_id, "sector_id": shape.sector_id, "name": names.name_for("planet:" + id),
					"orbit": orbit, "angle": Layout.planet_angle_for(Names.stable_hash("angle:" + id)),
				})
			systems.append({
				"id": system_id, "sector_id": shape.sector_id, "name": names.name_for("system:" + system_id),
				"x": points[si].x, "y": points[si].y, "sun_hue": Layout.sun_hue_for(Names.stable_hash("sun:" + system_id)),
				"planets": planets,
			})
		out.append({
			"id": shape.sector_id, "skill": shape.skill, "name_key": "meta.sector." + shape.sector_id,
			"hue": Layout.sector_hue(shape.skill, idx, skill_count[shape.skill]), "order": order,
			"x": disc.x, "y": disc.y, "radius": disc.radius, "systems": systems,
		})
	return out


static func _ensure() -> void:
	if _built:
		return
	_built = true
	_sectors = _build_galaxy()
	for s in _sectors:
		_sector_index[s.id] = s
		if not _skills.has(s.skill):
			_skills.append(s.skill)
		for sys in s.systems:
			_systems.append(sys)
			_system_index[sys.id] = sys
			for p in sys.planets:
				_planets.append(p)
				_planet_index[p.id] = p


## Every sector in galaxy order.
static func sectors() -> Array:
	_ensure()
	return _sectors


## Every star system, in galaxy order.
static func systems() -> Array:
	_ensure()
	return _systems


## Every planet, in galaxy order.
static func planets() -> Array:
	_ensure()
	return _planets


## The skills in galaxy order.
static func skills() -> Array:
	_ensure()
	return _skills


static func sector_by_id(sector_id: String) -> Variant:
	_ensure()
	return _sector_index.get(sector_id)


static func system_by_id(system_id: String) -> Variant:
	_ensure()
	return _system_index.get(system_id)


static func planet_by_id(planet_id: String) -> Variant:
	_ensure()
	return _planet_index.get(planet_id)


## Sector that owns the planet, or null for an unknown planet id.
static func sector_of_planet(planet_id: String) -> Variant:
	var p = planet_by_id(planet_id)
	return sector_by_id(p.sector_id) if p != null else null


## System that owns the planet, or null for an unknown planet id.
static func system_of_planet(planet_id: String) -> Variant:
	var p = planet_by_id(planet_id)
	return system_by_id(p.system_id) if p != null else null


## Planets of a sector in sector order ([] for an unknown id).
static func planets_of_sector(sector_id: String) -> Array:
	var s = sector_by_id(sector_id)
	var out: Array = []
	if s == null:
		return out
	for sys in s.systems:
		out.append_array(sys.planets)
	return out


## Sectors of one skill, in galaxy order.
static func sectors_of_skill(skill: String) -> Array:
	return sectors().filter(func(s): return s.skill == skill)


## Difficulty tier of a planet: the index of its system in its sector (0-based; 0 for unknown ids).
static func system_tier(planet_id: String) -> int:
	var p = planet_by_id(planet_id)
	var sector = sector_by_id(p.sector_id) if p != null else null
	if sector == null:
		return 0
	for i in sector.systems.size():
		if sector.systems[i].id == p.system_id:
			return i
	return 0


## Enemy speed factor of a planet's tier: 1 + 0.08 * tier.
static func tier_speed_factor(planet_id: String) -> float:
	return 1.0 + TIER_SPEED_STEP * system_tier(planet_id)
