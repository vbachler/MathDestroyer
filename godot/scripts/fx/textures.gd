class_name Tex
## Port of src/fx/textures.ts: the procedural textures generated at boot, drawn with the same
## operations on a software canvas (Raster) and registered in Assets under the same keys.
## Tex.generate_textures() makes the small ones at boot; the 256 px crawler fallbacks are generated
## on first use (Assets.texture / has_image call Tex.ensure), since the crawler images normally exist.

const STAR := "tex-star"                       # 4x4 soft white dot
const GLOW := "tex-glow"                       # 128x128 soft radial glow, white (tint it)
const ENEMY := "tex-enemy"                     # 64x64 angular hostile ship, nose pointing down
const ENEMY_ALT := "tex-enemy-alt"             # 64x64 alternative hull
const DOME := "tex-dome"                       # 120x64 intact shield dome
const DOME_DAMAGED := "tex-dome-damaged"
const DOME_RUIN := "tex-dome-ruin"
const PLANET_SMALL := "tex-planet-small"       # 64x64 shaded white sphere (tint it)
const PARTICLE := "tex-particle"               # 16x16 soft white spark
const LASER := "tex-laser"                     # 12x128 vertical beam, white core (tint it)
const VIGNETTE := "tex-vignette"               # 256x256 clear centre, white edges (tint it, stretch)
const SHADE := "tex-shade"                     # 128x128 solid white disc with a long smooth feather
const CRAWLER_SCORPION := "tex-crawler-scorpion"   # 256x256 fallback crawlers, front view, feet at ~88 %
const CRAWLER_SPIDER := "tex-crawler-spider"
const CRAWLER_CRAB := "tex-crawler-crab"
const CRAWLER_BEETLE := "tex-crawler-beetle"
const CRAWLER_STALKER := "tex-crawler-stalker"
const CRAWLER_DRIFTER := "tex-crawler-drifter"
const CRAWLER_WRAITH := "tex-crawler-wraith"

## TS TEX (camelCase names -> keys).
const TEX := {
	"star": STAR, "glow": GLOW, "enemy": ENEMY, "enemyAlt": ENEMY_ALT, "dome": DOME, "domeDamaged": DOME_DAMAGED,
	"domeRuin": DOME_RUIN, "planetSmall": PLANET_SMALL, "particle": PARTICLE, "laser": LASER, "vignette": VIGNETTE,
	"shade": SHADE, "crawlerScorpion": CRAWLER_SCORPION, "crawlerSpider": CRAWLER_SPIDER, "crawlerCrab": CRAWLER_CRAB,
	"crawlerBeetle": CRAWLER_BEETLE, "crawlerStalker": CRAWLER_STALKER, "crawlerDrifter": CRAWLER_DRIFTER,
	"crawlerWraith": CRAWLER_WRAITH,
}

## Fallback texture of each crawler kind (used when crawlers/<kind>.png is missing).
const CRAWLER_FALLBACK := {
	"scorpion": CRAWLER_SCORPION,
	"spider": CRAWLER_SPIDER,
	"crab": CRAWLER_CRAB,
	"beetle": CRAWLER_BEETLE,
	"stalker": CRAWLER_STALKER,
	"drifter": CRAWLER_DRIFTER,
	"wraith": CRAWLER_WRAITH,
}

const SHELL := "#2b2722"
const SHELL_HI := "rgba(190,170,140,0.55)"
const LEG := "#1c1a17"


## True for every key this file can generate.
static func can_generate(key: String) -> bool:
	return TEX.values().has(key)


## Generates `key` if it is a procedural texture not made yet. Returns true when it exists.
static func ensure(key: String) -> bool:
	if Assets._textures.has(key):
		return true
	if not can_generate(key):
		return false
	var tex := _make(key)
	if tex != null:
		Assets.add_texture(key, tex)
	return tex != null


## Creates the boot textures (everything except the crawler fallbacks). Safe to call twice.
static func generate_textures() -> void:
	for key in [STAR, GLOW, PARTICLE, PLANET_SMALL, LASER, VIGNETTE, SHADE, ENEMY, ENEMY_ALT, DOME, DOME_DAMAGED, DOME_RUIN]:
		ensure(key)


static func _radial_fill(size: int, stops: Array) -> ImageTexture:
	var c := Raster.new(size, size)
	var r := size / 2.0
	c.fill_rect(0, 0, size, size, Raster.radial(r, r, 0, r, r, r, stops))
	return c.to_texture()


static func _make(key: String) -> ImageTexture:
	match key:
		STAR:
			return _radial_fill(4, [[0, "rgba(255,255,255,1)"], [0.6, "rgba(255,255,255,0.7)"], [1, "rgba(255,255,255,0)"]])
		GLOW:
			return _radial_fill(128, [[0, "rgba(255,255,255,0.9)"], [0.25, "rgba(255,255,255,0.45)"],
				[0.6, "rgba(255,255,255,0.1)"], [1, "rgba(255,255,255,0)"]])
		PARTICLE:
			return _radial_fill(16, [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]])
		PLANET_SMALL:
			var c := Raster.new(64, 64)
			c.fill_circle(32, 32, 30, Raster.radial(24, 22, 4, 32, 32, 31, [[0, "#ffffff"], [0.55, "#d6d6d6"], [1, "#5c5c5c"]]))
			return c.to_texture()
		LASER:
			var c := Raster.new(12, 128)
			c.fill_rect(0, 0, 12, 128, Raster.linear(0, 0, 12, 0, [[0, "rgba(255,255,255,0)"], [0.35, "rgba(255,255,255,0.55)"],
				[0.5, "rgba(255,255,255,1)"], [0.65, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]))
			return c.to_texture()
		VIGNETTE:
			return _radial_fill(256, [[0, "rgba(255,255,255,0)"], [0.45, "rgba(255,255,255,0)"], [0.8, "rgba(255,255,255,0.55)"],
				[1, "rgba(255,255,255,1)"]])
		SHADE:
			# Solid to 40 %, then a smoothstep falloff to 0 at the rim (many stops: no visible ring).
			var stops: Array = [[0, "rgba(255,255,255,1)"]]
			for i in 13:
				var u := i / 12.0
				var a := 1.0 - u * u * (3.0 - 2.0 * u)
				stops.append([0.4 + 0.6 * u, "rgba(255,255,255,%.3f)" % a])
			return _radial_fill(128, stops)
		ENEMY:
			return _draw_enemy(0x5a2430, UiTheme.DANGER)
		ENEMY_ALT:
			return _draw_enemy_alt(0x4a2a1a, UiTheme.ACCENT)
		DOME:
			return _draw_dome(0)
		DOME_DAMAGED:
			return _draw_dome(1)
		DOME_RUIN:
			return _draw_dome(2)
	for kind in CRAWLER_FALLBACK.keys():
		if CRAWLER_FALLBACK[kind] == key:
			var c := Raster.new(256, 256)
			_draw_crawler(c, kind)
			return c.to_texture()
	return null


static func _pts(flat: Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in range(0, flat.size(), 2):
		out.append(Vector2(flat[i], flat[i + 1]))
	return out


static func _draw_enemy(hull: int, trim: int) -> ImageTexture:
	var c := Raster.new(64, 64)
	# Hull: arrowhead pointing down, swept wings.
	var pts := _pts([32, 62, 44, 34, 62, 14, 46, 18, 38, 4, 26, 4, 18, 18, 2, 14, 20, 34])
	c.fill_polygon(pts, Raster.rgb(hull))
	c.stroke_polyline(pts, 2, Raster.rgb(trim, 0.9), true)
	# Cockpit and engine glow.
	c.fill_polygon(_pts([32, 48, 37, 30, 27, 30]), Raster.rgb(trim))
	c.fill_rect(27, 4, 4, 5, Raster.rgb(0xffd27a, 0.9))
	c.fill_rect(33, 4, 4, 5, Raster.rgb(0xffd27a, 0.9))
	return c.to_texture()


static func _draw_enemy_alt(hull: int, trim: int) -> ImageTexture:
	var c := Raster.new(64, 64)
	# Heavier interceptor: diamond core with forward prongs.
	var pts := _pts([32, 60, 40, 44, 56, 52, 60, 26, 44, 8, 20, 8, 4, 26, 8, 52, 24, 44])
	c.fill_polygon(pts, Raster.rgb(hull))
	c.stroke_polyline(pts, 2, Raster.rgb(trim, 0.9), true)
	c.fill_circle(32, 30, 7, Raster.rgb(trim))
	c.fill_rect(22, 6, 6, 4, Raster.rgb(0xffd27a, 0.9))
	c.fill_rect(36, 6, 6, 4, Raster.rgb(0xffd27a, 0.9))
	return c.to_texture()


static func _draw_dome(state: int) -> ImageTexture:
	var c := Raster.new(120, 64)
	var w := 120
	var base := 56
	# Base platform.
	c.fill_rect(4, base, w - 8, 8, Raster.rgb(0x24344a))
	c.stroke_polyline(_pts([4, base, w - 4, base, w - 4, base + 8, 4, base + 8]), 1, Raster.rgb(UiTheme.PRIMARY_DIM), true)
	if state == 2:
		# Ruin: broken stubs.
		c.fill_polygon(_pts([16, base, 30, base - 18, 40, base]), Raster.rgb(0x3a2f2f))
		c.fill_polygon(_pts([70, base, 84, base - 12, 98, base]), Raster.rgb(0x3a2f2f))
		c.fill_circle(56, base - 3, 3, Raster.rgb(UiTheme.DANGER, 0.6))
		return c.to_texture()
	var shell := UiTheme.PRIMARY if state == 0 else UiTheme.ACCENT
	var wedge := PackedVector2Array([Vector2(w / 2.0, base)])
	wedge.append_array(Raster.arc_points(w / 2.0, base, 50, PI, TAU))
	c.fill_polygon(wedge, Raster.rgb(shell, 0.22 if state == 0 else 0.14))
	c.stroke_polyline(Raster.arc_points(w / 2.0, base, 50, PI, TAU), 2, Raster.rgb(shell, 0.95 if state == 0 else 0.7))
	# Inner structure.
	c.fill_rect(44, base - 18, 32, 18, Raster.rgb(0x9fb4cc))
	c.fill_rect(54, base - 30, 12, 12, Raster.rgb(0xd8e6f5))
	if state == 1:
		c.stroke_polyline(_pts([30, base - 34, 42, base - 24, 36, base - 14]), 2, Raster.rgb(UiTheme.DANGER, 0.9))
		c.stroke_polyline(_pts([82, base - 40, 76, base - 28, 88, base - 20]), 2, Raster.rgb(UiTheme.DANGER, 0.9))
	return c.to_texture()


# ------------------------------------------------------------------ boarding fallbacks

static func _leg_pair(c: Raster, x: float, y: float, reach: float, lift: float, drop: float, lw: float) -> void:
	for dir in [-1, 1]:
		c.stroke_polyline(PackedVector2Array([
			Vector2(128 + dir * x, y), Vector2(128 + dir * (x + reach * 0.55), y - lift), Vector2(128 + dir * (x + reach), y + drop),
		]), lw, Raster.css(LEG))


static func _shell(c: Raster, cx: float, cy: float, rx: float, ry: float) -> void:
	c.fill_ellipse(cx, cy, rx, ry, Raster.radial(cx - rx * 0.3, cy - ry * 0.5, 2, cx, cy, maxf(rx, ry),
		[[0, "#5a5248"], [0.5, SHELL], [1, "#0e0d0b"]]))
	c.stroke_polyline(Raster.ellipse_arc_points(cx, cy, rx - 1, ry - 1, PI * 1.1, PI * 1.9, 32), 1.5, Raster.css(SHELL_HI))


static func _eyes(c: Raster, y: float, spread: float, n: int) -> void:
	for i in n:
		var x := 128 + (i - (n - 1) / 2.0) * spread
		c.fill_rect(x - 7, y - 7, 14, 14, Raster.radial(x, y, 0, x, y, 7,
			[[0, "rgba(255,120,90,1)"], [0.35, "rgba(255,60,40,0.8)"], [1, "rgba(255,40,20,0)"]]))


static func _line(c: Raster, x0: float, y0: float, x1: float, y1: float, lw: float, col: String) -> void:
	c.stroke_polyline(PackedVector2Array([Vector2(x0, y0), Vector2(x1, y1)]), lw, Raster.css(col))


## Code-drawn crawler, front view, dark chitin with red eye lights. Feet near y 226 of 256.
static func _draw_crawler(c: Raster, kind: String) -> void:
	match kind:
		"spider":
			for leg in [[22, 150, 96, 70, 76], [26, 160, 90, 46, 66], [24, 170, 76, 22, 56], [18, 176, 58, 4, 50]]:
				_leg_pair(c, leg[0], leg[1], leg[2], leg[3], leg[4], 5)
			_shell(c, 128, 132, 40, 34)
			_shell(c, 128, 172, 26, 20)
			_eyes(c, 168, 10, 4)
		"crab":
			_leg_pair(c, 52, 170, 60, 20, 56, 7)
			_leg_pair(c, 44, 178, 56, 8, 48, 7)
			# Pincers raised.
			for dir in [-1, 1]:
				_line(c, 128 + dir * 60, 160, 128 + dir * 98, 120, 10, LEG)
				_shell(c, 128 + dir * 104, 104, 18, 24)
			_shell(c, 128, 160, 72, 38)
			_eyes(c, 140, 22, 2)
		"beetle":
			_leg_pair(c, 40, 176, 56, 16, 50, 7)
			_leg_pair(c, 46, 190, 50, 6, 36, 7)
			_shell(c, 128, 150, 62, 58)
			_line(c, 128, 96, 128, 206, 2, "rgba(0,0,0,0.8)")
			_shell(c, 128, 196, 30, 16)
			_eyes(c, 198, 18, 2)
		"stalker":
			# Lean predator on all fours: long arms planted wide, hunched back, red seam down the head.
			_leg_pair(c, 30, 140, 80, 50, 86, 7)
			_leg_pair(c, 22, 186, 30, 6, 40, 9)
			_shell(c, 128, 150, 34, 46)
			_shell(c, 128, 104, 22, 30)
			_line(c, 128, 76, 128, 170, 2, "rgba(255,60,40,0.9)")
		"drifter":
			# Hovering machine jellyfish: a ribbed dome with a red core and hanging tentacles.
			for i in range(-4, 5):
				var p0 := Vector2(128 + i * 12, 120)
				var pts := PackedVector2Array([p0])
				pts.append_array(Raster.quad_points(p0, Vector2(128 + i * 20, 170), Vector2(128 + i * 15 + (i % 2) * 8, 226)))
				c.stroke_polyline(pts, 4, Raster.css(LEG))
			_shell(c, 128, 100, 62, 56)
			c.fill_rect(66, 100, 124, 26, Raster.css("#0e0d0b"))
			c.fill_rect(100, 56, 56, 56, Raster.radial(128, 84, 0, 128, 84, 24,
				[[0, "rgba(255,90,70,1)"], [0.5, "rgba(220,30,20,0.85)"], [1, "rgba(120,0,0,0)"]]))
		"wraith":
			# Tall headless spiked figure of black liquid on its own pool, red glow in the chest.
			c.fill_ellipse(128, 222, 92, 10, Raster.css("#060606"))
			var body := PackedVector2Array([Vector2(96, 222)])
			body.append_array(Raster.quad_points(Vector2(96, 222), Vector2(104, 120), Vector2(100, 70)))
			body.append(Vector2(156, 70))
			body.append_array(Raster.quad_points(Vector2(156, 70), Vector2(152, 120), Vector2(160, 222)))
			c.fill_polygon(body, Raster.css("#060606"))
			for dir in [-1, 1]:
				c.stroke_polyline(PackedVector2Array([Vector2(128 + dir * 26, 78), Vector2(128 + dir * 50, 130),
					Vector2(128 + dir * 48, 176)]), 7, Raster.css("#0b0b0b"))
			for i in range(-5, 6):
				_line(c, 128 + i * 5, 72, 128 + i * 11, 30 + absi(i) * 4, 3, "#0b0b0b")
			c.fill_rect(104, 84, 48, 52, Raster.radial(128, 110, 0, 128, 110, 20,
				[[0, "rgba(230,30,20,0.95)"], [1, "rgba(120,0,0,0)"]]))
		_:
			# scorpion (default)
			_leg_pair(c, 34, 178, 70, 24, 48, 6)
			_leg_pair(c, 30, 188, 60, 10, 38, 6)
			# Tail arching over the body, sting forward.
			var tail := PackedVector2Array([Vector2(128, 170)])
			tail.append_array(Raster.quad_points(Vector2(128, 170), Vector2(128, 40), Vector2(128, 70)))
			c.stroke_polyline(tail, 16, Raster.css(SHELL))
			c.fill_polygon(_pts([120, 64, 136, 64, 128, 96]), Raster.css("#8a2a20"))
			for dir in [-1, 1]:
				_line(c, 128 + dir * 30, 186, 128 + dir * 74, 170, 8, LEG)
				_shell(c, 128 + dir * 84, 172, 16, 12)
			_shell(c, 128, 178, 44, 30)
			_eyes(c, 184, 14, 3)
