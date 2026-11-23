extends Node
## Autoload "App": port of src/app.ts plus the scene manager and the screenshot dev hook.
##
##   App.save                  SaveData (snake_case Dictionary, see Save); call App.persist() after changing it
##   App.i18n                  I18n over the merged locale files; App.t(key, params) / App.tp(key, n, params)
##   App.persist()             writes user://mathdestroyer.save.v1.json (same JSON as the browser game)
##   App.now_ms()              epoch ms (the only clock read; core code takes `now` as a parameter)
##   App.set_locale(l)         switches the language now and stores it in the save
##   App.goto(name, data)      replaces the current scene (Phaser scene.start); overlays are stopped
##   App.launch(name, data)    starts an overlay scene above the current one (Phaser scene.launch)
##   App.stop(name)            stops an overlay (Phaser scene.stop)
##   App.pause_scene(name) / App.resume_scene(name)   Phaser scene.pause / resume
##   App.scene(name)           the running scene node with that name, or null
##
## Screenshot hook (windowed only):  $GODOT --path godot -- --shot=<scene> --out=<png> [--steps=N] [--data=<json>]
## Boot runs as usual, then goes to <scene> (with <data>) instead of the menu, processes N frames
## (default 30) and saves the viewport to <png>, then quits. --shot=boot captures the boot screen.

## Registry: scene name -> script (Phaser scene keys in snake_case).
const SCENES := {
	"boot": "res://scenes/boot.gd",
	"menu": "res://scenes/menu.gd",
	"star_map": "res://scenes/star_map.gd",
	"station": "res://scenes/station.gd",
	"mastery": "res://scenes/mastery.gd",
	"settings": "res://scenes/settings.gd",
	"ftl": "res://scenes/ftl.gd",
	"battle": "res://scenes/battle.gd",
	"upgrade": "res://scenes/upgrade.gd",
	"boarding": "res://scenes/boarding.gd",
	"results": "res://scenes/results.gd",
	# Dev-only gallery of textures and widgets (not in the TS game).
	"dev_widgets": "res://scenes/dev_widgets.gd",
}

var save: Dictionary
var i18n: I18n
var storage: Save.StorageAdapter
## The main scene (replaced by goto) and the overlays launched over it, by name.
var current_scene: GameScene = null
var overlays := {}

var shot_scene := ""
var shot_out := ""
var shot_steps := 30
var shot_data: Dictionary = {}
var _shot_frames := -1


func _init() -> void:
	storage = _make_storage()
	save = Save.load_save(storage)
	i18n = I18n.new(I18n.load_dicts(), save.locale)


func _ready() -> void:
	_parse_args()


## Called by the main scene (boot.tscn) when it starts: it becomes the current scene.
func adopt_main_scene(node: GameScene, name: String) -> void:
	node.scene_name = name
	current_scene = node
	_arm_shot(name)


## user:// when writable, otherwise an in-memory store (like the TS fallback for blocked storage).
func _make_storage() -> Save.StorageAdapter:
	var probe := "user://__mathdestroyer_probe__"
	var f := FileAccess.open(probe, FileAccess.WRITE)
	if f != null:
		f.close()
		DirAccess.remove_absolute(probe)
		return Save.FileStorage.new("user://")
	push_warning("[save] user:// is not writable; progress is kept in memory only")
	return Save.MemoryStorage.new()


func persist() -> void:
	Save.write_save(storage, save)


func now_ms() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)


func t(key: String, params: Dictionary = {}) -> String:
	return i18n.t(key, params)


func tp(key: String, count: float, params: Dictionary = {}) -> String:
	return i18n.tp(key, count, params)


## Switches the language immediately and stores it in the save.
func set_locale(locale: String) -> void:
	i18n.set_locale(locale)
	save = save.duplicate()
	save.locale = locale
	persist()


# ---------------------------------------------------------------- scenes

func _instantiate(name: String, d: Dictionary) -> GameScene:
	var path: String = SCENES.get(name, "")
	if path == "" or not ResourceLoader.exists(path):
		push_error("[App] unknown scene '%s'" % name)
		return null
	var script: Script = load(path)
	var node = script.new() if script != null and script.can_instantiate() else null
	if not node is GameScene:
		push_error("[App] scene '%s' (%s) does not extend GameScene" % [name, path])
		return null
	node.name = name.to_pascal_case()
	node.scene_name = name
	node.data = d
	return node


## Replaces the current scene (and stops every overlay) at the end of this frame. Returns the new
## scene node (not yet in the tree; its create(data) runs when it enters), or null.
func goto(name: String, d: Dictionary = {}) -> GameScene:
	var node := _instantiate(name, d)
	if node == null:
		return null
	_swap_scene.call_deferred(node)
	return node


func _swap_scene(node: GameScene) -> void:
	for o in overlays.values():
		if is_instance_valid(o):
			o.queue_free()
	overlays.clear()
	var old := current_scene if is_instance_valid(current_scene) else get_tree().current_scene
	if old != null and old != node:
		old.get_parent().remove_child(old)
		old.queue_free()
	current_scene = node
	get_tree().root.add_child(node)
	get_tree().current_scene = node
	_arm_shot(node.scene_name)


## Starts an overlay scene above the current one (same data contract as goto). Returns the node.
func launch(name: String, d: Dictionary = {}) -> GameScene:
	stop(name)
	var node := _instantiate(name, d)
	if node == null:
		return null
	overlays[name] = node
	get_tree().root.add_child.call_deferred(node)
	_arm_shot(name)
	return node


## Stops an overlay scene (no-op when it is not running).
func stop(name: String) -> void:
	var o = overlays.get(name)
	overlays.erase(name)
	if o != null and is_instance_valid(o):
		o.queue_free()


## The running scene (current or overlay) with this name, or null.
func scene(name: String) -> GameScene:
	if is_instance_valid(current_scene) and current_scene.scene_name == name:
		return current_scene
	var o = overlays.get(name)
	return o if o != null and is_instance_valid(o) else null


## Phaser scene.pause: no update, no input, still drawn.
func pause_scene(name: String) -> void:
	var s := scene(name)
	if s != null:
		s.process_mode = Node.PROCESS_MODE_DISABLED


func resume_scene(name: String) -> void:
	var s := scene(name)
	if s != null:
		s.process_mode = Node.PROCESS_MODE_INHERIT


# ---------------------------------------------------------------- screenshot hook

func _parse_args() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--shot="):
			shot_scene = arg.substr(7)
		elif arg.begins_with("--out="):
			shot_out = arg.substr(6)
		elif arg.begins_with("--steps="):
			shot_steps = maxi(1, arg.substr(8).to_int())
		elif arg.begins_with("--data="):
			var parsed = Save.parse_json(arg.substr(7))
			if parsed is Dictionary:
				shot_data = parsed
			else:
				push_error("[App] --data is not a JSON object")
	if shot_scene != "" and shot_out == "":
		shot_out = "user://shot_%s.png" % shot_scene


## True while a --shot run is active (boot uses it to pick the target scene).
func is_shot_run() -> bool:
	return shot_scene != ""


func _arm_shot(name: String) -> void:
	if shot_scene != "" and name == shot_scene and _shot_frames < 0:
		_shot_frames = shot_steps


func _process(_delta: float) -> void:
	if _shot_frames < 0:
		return
	_shot_frames -= 1
	if _shot_frames == 0:
		_shot_frames = -2
		_take_shot()


func _take_shot() -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := shot_out
	if not path.begins_with("user://") and not path.begins_with("res://"):
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := img.save_png(path) if img != null else ERR_UNAVAILABLE
	if err == OK:
		print("[shot] saved %s (%dx%d)" % [path, img.get_width(), img.get_height()])
	else:
		push_error("[shot] could not save %s: %s" % [path, error_string(err)])
	get_tree().quit(0 if err == OK else 1)
