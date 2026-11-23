extends TestCase
## Port of tests/layering.test.ts
## The TS test lists src/core/*.ts; here every TS core module must have its GDScript port in
## res://scripts/core (battle.ts -> battle.gd + battle_sim.gd, boarding.ts -> boarding.gd +
## boarding_sim.gd; the JS-number helper js.gd is the one extra file allowed). vitest makes one
## `it` per source file; here one test checks every file and names the file in each failure.

const CORE_DIR := "res://scripts/core"
const EXTRA_ALLOWED: Array[String] = ["js.gd"]

## Engine APIs the pure core must not use: the app / audio autoloads, the scene tree, the clock,
## the global RNG and input (TS: Phaser, other layers, DOM, Date.now, Math.random, localStorage).
const FORBIDDEN := {
	"App autoload": "\\bApp\\b",
	"Sfx autoload": "\\bSfx\\b",
	"scene tree": "\\bget_tree\\s*\\(|\\badd_child\\s*\\(|\\bget_node\\s*\\(|\\bextends\\s+Node",
	"clock": "\\bTime\\.",
	"OS": "\\bOS\\.",
	"global RNG": "\\b(randi|randf|randi_range|randf_range|randfn|randomize)\\s*\\(|(?<![\\w.])seed\\(",
	"input": "\\bInput\\.",
}


static func _core_files() -> Array:
	var out: Array = []
	for name in DirAccess.get_files_at(CORE_DIR):
		var n := name.trim_suffix(".remap")
		if n.ends_with(".gd"):
			out.append(n)
	out.sort()
	return out


func test_has_every_core_module() -> void:
	var files := _core_files().filter(func(f): return not EXTRA_ALLOWED.has(f))
	eq(Js.sorted_strings(files), [
		"battle.gd", "battle_sim.gd", "boarding.gd", "boarding_sim.gd", "content.gd", "economy.gd", "factgen.gd",
		"facts.gd", "galaxy.gd", "i18n.gd", "layout.gd", "mastery.gd", "names.gd", "rng.gd", "save.gd",
		"scheduler.gd", "story.gd", "types.gd", "upgrades.gd",
	])


func test_core_files_use_no_autoloads_scene_tree_clock_os_global_rng_or_input() -> void:
	var files := _core_files()
	ok(files.size() > 0, "core files found")
	for file in files:
		var src := FileAccess.get_file_as_string("%s/%s" % [CORE_DIR, file])
		ok(src != "", "%s is readable" % file)
		for what in FORBIDDEN:
			var m := RegEx.create_from_string(FORBIDDEN[what]).search(src)
			ok(m == null, "%s uses %s (%s)" % [file, what, m.get_string() if m != null else ""])
