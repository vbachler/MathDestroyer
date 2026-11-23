class_name PImage
extends Sprite2D
## Phaser.GameObjects.Image for the port: a centred Sprite2D (Phaser origin 0.5) addressed by
## texture key (Assets registry), with Phaser-style helpers:
##   PImage.make(parent, x, y, key)   set_texture_key(key)   set_display_size(w, h)
##   set_tint(0xRRGGBB) / clear_tint()  set_alpha(a)  set_blend_add(on)  set_origin(ox, oy)
## Tint lives in self_modulate (rgb); alpha in modulate.a (what PTween "alpha" animates).

var texture_key := ""
var _display := Vector2(-1, -1)


static func make(parent: Node, x: float, y: float, key: String) -> PImage:
	var img := PImage.new()
	img.position = Vector2(x, y)
	img.set_texture_key(key)
	if parent != null:
		parent.add_child(img)
	return img


func set_texture_key(key: String) -> PImage:
	texture_key = key
	texture = Assets.texture(key)
	if _display.x >= 0:
		set_display_size(_display.x, _display.y)
	return self


func set_display_size(w: float, h: float) -> PImage:
	_display = Vector2(w, h)
	if texture != null and texture.get_width() > 0 and texture.get_height() > 0:
		scale = Vector2(w / texture.get_width(), h / texture.get_height())
	return self


## Phaser setOrigin: 0.5 = centred (default), 0 = top-left.
func set_origin(ox: float, oy: float = NAN) -> PImage:
	var oy2 := ox if is_nan(oy) else oy
	centered = false
	if texture != null:
		offset = -Vector2(texture.get_width() * ox, texture.get_height() * oy2)
	return self


func set_tint(c: int) -> PImage:
	self_modulate = UiTheme.color(c)
	return self


func clear_tint() -> PImage:
	self_modulate = Color.WHITE
	return self


func set_alpha(a: float) -> PImage:
	modulate.a = a
	return self


## Phaser BlendModes.ADD.
func set_blend_add(on: bool = true) -> PImage:
	if on:
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		material = m
	else:
		material = null
	return self
