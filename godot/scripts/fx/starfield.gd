class_name Starfield
extends Node2D
## Port of src/fx/Starfield.ts: three-layer parallax starfield drifting downward.
## Starfield.new(parent, {speed = 1, depth = DEPTH.background}); call update(dt_ms) every frame.
## Seeded like the TS (PhaserRnd = Phaser.Math.RandomDataGenerator, seed "mathdestroyer-stars"),
## so the stars lie exactly where the TS puts them.

const LAYERS := [
	{"count": 90, "speed": 6.0, "scale": [0.35, 0.6], "alpha": [0.25, 0.5]},
	{"count": 50, "speed": 14.0, "scale": [0.6, 0.9], "alpha": [0.45, 0.75]},
	{"count": 22, "speed": 30.0, "scale": [0.9, 1.4], "alpha": [0.7, 1.0]},
]
const TINTS := [0xffffff, 0xcfe8ff, 0xfff1d6, 0xd6f6ff]

var _layers: Array = []
var _speed_scale := 1.0
var _rnd := PhaserRnd.new(["mathdestroyer-stars"])


func _init(parent: Node, opts: Dictionary = {}) -> void:
	_speed_scale = opts.get("speed", 1.0)
	var depth: int = opts.get("depth", UiTheme.DEPTH.background)
	for li in LAYERS.size():
		var cfg: Dictionary = LAYERS[li]
		var stars: Array = []
		for i in cfg.count:
			var star := PImage.make(self, _rnd.between(0, UiTheme.GAME_WIDTH), _rnd.between(0, UiTheme.GAME_HEIGHT), Tex.STAR)
			star.scale = Vector2.ONE * _rnd.real_in_range(cfg.scale[0], cfg.scale[1])
			star.set_alpha(_rnd.real_in_range(cfg.alpha[0], cfg.alpha[1]))
			star.set_tint(_rnd.pick(TINTS))
			star.z_index = depth + li
			stars.append(star)
		_layers.append({"stars": stars, "speed": cfg.speed})
	if parent != null:
		parent.add_child(self)


func set_speed(s: float) -> void:
	_speed_scale = s


func update(dt_ms: float) -> void:
	var dt := dt_ms / 1000.0
	for layer in _layers:
		var dy: float = layer.speed * _speed_scale * dt
		for s in layer.stars:
			s.position.y += dy
			if s.position.y > UiTheme.GAME_HEIGHT + 4:
				s.position.y -= UiTheme.GAME_HEIGHT + 8
				s.position.x = _rnd.between(0, UiTheme.GAME_WIDTH)


func destroy() -> void:
	queue_free()
	_layers.clear()
