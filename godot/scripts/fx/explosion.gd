class_name Explosion
## Port of src/fx/Explosion.ts.


## Particle burst with a short soft glow at (x, y). Cleans itself up. `size` scales the burst
## (particle speed, particle size and glow); 1 is the full-size burst.
static func explode(parent: Node, x: float, y: float, tint: int = UiTheme.ACCENT, size: float = 1.0) -> void:
	ParticleBurst.explode(parent, x, y, Tex.PARTICLE, maxi(10, Js.round(28 * sqrt(size))), {
		"speed_min": 60 * size, "speed_max": 280 * size,
		"angle_min": 0.0, "angle_max": 360.0,
		"life_min": 350.0, "life_max": 750.0,
		"scale_start": 0.9 * sqrt(size), "scale_end": 0.0,
		"alpha_start": 1.0, "alpha_end": 0.0,
		"tints": [tint, UiTheme.WHITE, tint],
		"add": true,
	}, UiTheme.DEPTH.fx, 900)
	var glow := PImage.make(parent, x, y, Tex.GLOW)
	glow.set_tint(tint)
	glow.material = ParticleBurst.add_material()
	glow.z_index = UiTheme.DEPTH.fx
	glow.scale = Vector2.ONE * (0.3 * size)
	glow.set_alpha(0.9)
	PTween.add(glow, {"scale": 1.1 * size, "alpha": 0.0}, 420, "Cubic.easeOut", {"on_complete": glow.queue_free})
