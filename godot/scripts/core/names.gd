class_name Names
## Port of src/core/names.ts: seeded syllable names for systems and planets, and stableHash.

const ONSETS: Array[String] = [
	"b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z",
	"br", "dr", "kr", "tr", "st", "sk", "th", "vr", "gl", "pl",
]
## Single consonants allowed right after a syllable that ends in a consonant.
const SOFT_ONSETS: Array[String] = ["d", "k", "l", "m", "n", "r", "s", "t", "v"]
const VOWELS: Array[String] = ["a", "e", "i", "o", "u"]
## Rarer vowels; at most one of them per name.
const RARE_VOWELS: Array[String] = ["ai", "ei", "ia", "y"]
const MID_CODAS: Array[String] = ["n", "r", "l", "s", "m"]
const END_CODAS: Array[String] = ["n", "r", "l", "s", "th", "x", "m"]

## Names (and stems) of well-known fiction or real stars; a name equal to / starting with one is rejected.
const BLOCKED: Array[String] = [
	"vulkan", "vulcan", "tatooin", "naboo", "endor", "hoth", "dagob", "alder", "coruscant", "kamino",
	"mustaf", "arrakis", "dune", "kobol", "caprica", "krypton", "gallifrey", "skaro", "trant",
	"terminus", "solaris", "pandora", "reach", "harvest", "tuchanka", "palaven", "thessia",
	"rannoch", "eden", "ziost", "korriban", "romul", "kronos", "bajor", "cardass", "ferenginar",
	"risa", "betazed", "andor", "tellar", "qonos", "vega", "rigel", "sirius", "altair", "deneb",
	"betel", "antares", "arcturus", "polaris", "castor", "pollux", "mira", "algol", "spica",
	"capella", "aldebar", "procyon", "canopus", "achernar", "hadar", "acrux", "mimosa", "shaula",
	"bellatrix", "elnath", "alnilam", "alnitak", "mintaka", "saiph", "regulus", "fomalhaut",
	"thuban", "mizar", "alcor", "dubhe", "merak", "kochab", "tauri", "cygni", "ceti", "eridani",
	"lyra", "sol", "terra", "luna", "mars", "venus", "titan", "europa", "ganymed", "callisto",
	"io", "triton", "pluto", "ceres", "vesta", "pallas", "juno", "hygiea", "sedna", "eris",
	"kepler", "gliese", "trappist", "proxima", "barnard", "wolf", "ross", "lalande", "luyten",
	"leda", "dione", "rhea", "tethys", "mimas", "thebe", "metis", "nereid", "naiad", "despina",
	"oberon", "ariel", "miranda", "umbriel", "puck", "phobos", "deimos", "charon", "nix", "hydra",
	"kerberos", "styx", "thomas", "lego", "also", "live", "love", "gore", "dole", "pure", "bure",
	"more", "mora", "kosa", "lisa", "mama", "tata", "baba", "deda", "meridian", "tarel", "velkar", "sefira",
]

## Words that must not appear anywhere inside a name (rude or silly in hr/en).
const BLOCKED_INSIDE: Array[String] = ["kurac", "pizd", "sran", "jeb", "fuk", "fuck", "shit", "dick", "ass", "kak", "pis", "sex"]

static var _triple_re: RegEx
static var _vowels_re: RegEx


static func _syllables(rng: Rng) -> Array[String]:
	var count := 2 if rng.next() < 0.6 else 3
	var out: Array[String] = []
	var ends_in_consonant := false
	var rare_used := false
	for i in count:
		var last := i == count - 1
		var vowel_start := i == 0 and rng.next() < 0.12
		var onset: String = "" if vowel_start else rng.pick(SOFT_ONSETS if ends_in_consonant else ONSETS)
		var vowel: String = rng.pick(VOWELS)
		if not rare_used and not vowel_start and rng.next() < 0.15:
			vowel = rng.pick(RARE_VOWELS)
			rare_used = true
		var coda: String = ""
		if rng.next() < (0.55 if last else 0.25):
			coda = rng.pick(END_CODAS if last else MID_CODAS)
		out.append(onset + vowel + coda)
		ends_in_consonant = coda != ""
	return out


static func _acceptable(parts: Array[String]) -> bool:
	var lower := "".join(parts)
	if lower.length() < 4 or lower.length() > 9:
		return false
	var uniq := {}
	for p in parts:
		uniq[p] = true
	if uniq.size() < parts.size():
		return false
	if _triple_re == null:
		_triple_re = RegEx.create_from_string("(.)\\1\\1")
		_vowels_re = RegEx.create_from_string("[aeiouy]{3}")
	if _triple_re.search(lower) != null:
		return false
	if _vowels_re.search(lower) != null:
		return false
	for b in BLOCKED:
		if lower.begins_with(b) or lower == b:
			return false
	for b in BLOCKED_INSIDE:
		if lower.contains(b):
			return false
	return true


## One name from a numeric seed (2..3 syllables, capitalised), or null if it was rejected.
static func name_from_seed(seed: int) -> Variant:
	var parts := _syllables(Rng.new(seed))
	if not _acceptable(parts):
		return null
	var lower := "".join(parts)
	return lower.substr(0, 1).to_upper() + lower.substr(1)


## Stable, platform-independent string hash (FNV-1a, 32 bit).
static func stable_hash(text: String) -> int:
	var h := 0x811C9DC5
	for i in text.length():
		h ^= text.unicode_at(i)
		h = Js.imul(h, 0x01000193)
	return h & Js.U32


## Hands out names unique within one registry (name depends on the id and the names taken).
class NameRegistry:
	extends RefCounted
	var taken := {}

	func name_for(id: String) -> String:
		var attempt := 0
		while true:
			var n = Names.name_from_seed(Names.stable_hash("%s#%d" % [id, attempt]))
			if n != null and not taken.has(n):
				taken[n] = true
				return n
			attempt += 1
		return ""


static func create_name_registry() -> NameRegistry:
	return NameRegistry.new()
