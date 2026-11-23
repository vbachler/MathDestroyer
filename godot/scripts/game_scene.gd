class_name GameScene
extends Node2D
## Base of every game scene (the Phaser Scene equivalent). Scenes are scripts under res://scenes/
## built in code; App.goto(name, data) / App.launch(name, data) create them.
##
## Lifecycle (Phaser -> Godot):
##   init(data) + create(data)  ->  create(data)      called once, after the node entered the tree
##   update(time, delta)        ->  update(delta_ms)  called every frame while the scene is not paused
##   shutdown event             ->  shutdown()        called when the scene is replaced or stopped
##
## `scene_name` is the registry name ("menu", "battle", ...); `data` the Dictionary passed in.

var scene_name := ""
var data: Dictionary = {}
var _created := false


## Override: build the scene (Phaser create()).
func create(_data: Dictionary) -> void:
	pass


## Override: per-frame logic (Phaser update()); delta in milliseconds.
func update(_delta_ms: float) -> void:
	pass


## Override: cleanup when the scene is replaced or stopped (Phaser shutdown).
func shutdown() -> void:
	pass


func _ready() -> void:
	if not _created:
		_created = true
		create(data)


func _process(delta: float) -> void:
	if _created:
		update(delta * 1000.0)


func _exit_tree() -> void:
	shutdown()
