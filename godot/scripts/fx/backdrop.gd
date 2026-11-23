class_name Backdrop
## Port of src/fx/backdrop.ts: full-screen background picture (cover fit) and darkening shade.
##   Backdrop.add_backdrop(parent, key, {overscan = 1.02, depth = DEPTH.background}) -> PImage or null
##   Backdrop.cover_scale(w, h)
##   Backdrop.add_shade(parent, alpha, bottom = {} | {from, alpha}, depth = DEPTH.background + 1) -> Node2D


## Full-screen background image scaled to cover the 1280x720 view (centre crop), centred.
## Returns null when the texture is missing; the caller keeps the plain background colour.
static func add_backdrop(parent: Node, key: String, opts: Dictionary = {}) -> PImage:
	if not Assets.has_image(key):
		return null
	var img := PImage.make(parent, UiTheme.GAME_WIDTH / 2.0, UiTheme.GAME_HEIGHT / 2.0, key)
	img.z_index = opts.get("depth", UiTheme.DEPTH.background)
	var tex := img.texture
	var s := cover_scale(tex.get_width(), tex.get_height()) * float(opts.get("overscan", 1.02))
	img.scale = Vector2(s, s)
	return img


## Scale that makes a w x h picture cover the whole view.
static func cover_scale(w: float, h: float) -> float:
	return maxf(UiTheme.GAME_WIDTH / maxf(1.0, w), UiTheme.GAME_HEIGHT / maxf(1.0, h))


## Darkening overlay: a uniform veil of `alpha`, plus an optional vertical gradient that gets darker
## toward the bottom (from `bottom.from` y to the bottom edge, reaching `bottom.alpha`).
static func add_shade(parent: Node, alpha: float, bottom: Dictionary = {}, depth: int = UiTheme.DEPTH.background + 1) -> Node2D:
	var node := ShadeNode.new()
	node.veil = alpha
	if not bottom.is_empty():
		node.from_y = float(bottom.from)
		node.bottom_alpha = float(bottom.alpha)
	node.z_index = depth
	if parent != null:
		parent.add_child(node)
	return node


class ShadeNode extends Node2D:
	var veil := 0.0
	var from_y := -1.0
	var bottom_alpha := 0.0

	func _draw() -> void:
		var w := float(UiTheme.GAME_WIDTH)
		var h := float(UiTheme.GAME_HEIGHT)
		if veil > 0:
			draw_rect(Rect2(0, 0, w, h), UiTheme.color(UiTheme.BG, veil))
		if from_y >= 0:
			# Phaser fillGradientStyle(bg x4, 0, 0, a, a): transparent top edge, `a` at the bottom.
			var top := UiTheme.color(UiTheme.BG, 0)
			var bot := UiTheme.color(UiTheme.BG, bottom_alpha)
			draw_polygon(PackedVector2Array([Vector2(0, from_y), Vector2(w, from_y), Vector2(w, h), Vector2(0, h)]),
				PackedColorArray([top, top, bot, bot]))
