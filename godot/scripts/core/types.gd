class_name CoreTypes
## Port of src/core/types.ts. GDScript has no structural types, so the shapes live here as
## documentation and small constructors. Every data object is a Dictionary with the TS field
## names in snake_case. (The save JSON keeps camelCase; Save.serialize / Save.migrate convert.)
##
## Locale   "hr" | "en"
## SkillId  "typing" | "addition" | "subtraction" | "multiplication" | "division" | "negatives" | "missing" | "mixed"
## Op       "type" | "add" | "sub" | "mul" | "div"
##
## Fact        {id, stat_id, op, a, b, result, unknown ("result"|"a"|"b"), answer}
## PlanetDef   {id, system_id, sector_id, name, orbit, angle}
## SystemDef   {id, sector_id, name, x, y, sun_hue, planets: Array[PlanetDef]}
## SectorDef   {id, skill, name_key, hue, order, x, y, radius, systems: Array[SystemDef]}
## FactStats   {box, attempts, correct, avg_ms, last_seen, due_at}
## PlanetProgress {level, due_at, wins}
## ProgressHolder: any Dictionary with "planets": {planet_id: PlanetProgress} (SaveData is one).

const SKILL_IDS: Array[String] = [
	"typing", "addition", "subtraction", "multiplication", "division", "negatives", "missing", "mixed",
]
