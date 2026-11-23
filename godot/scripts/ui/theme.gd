class_name UiTheme
## Port of src/ui/theme.ts: visual constants shared by all scenes, plus the bundled fonts.
## Colours are ints 0xRRGGBB like the TS (Phaser numeric colours); UiTheme.color(c, alpha) makes a
## Godot Color, UiTheme.css(c) the "#rrggbb" string.

const GAME_WIDTH := 1280
const GAME_HEIGHT := 720

## Theme v2: amber primary HUD colour, teal secondary, off-white text, deep near-black backing.
const COLORS := {
	"bg": 0x04070b,
	"bgPanel": 0x070b10,
	"bgPanelHi": 0x111820,
	"primary": 0xffb347,
	"primaryDim": 0x8a5d22,
	"accent": 0x46d6c8,
	"secondary": 0x46d6c8,
	"danger": 0xff5a4f,
	"ok": 0x7fe08a,
	"text": 0xeae6dc,
	"textDim": 0x8e8b82,
	"disabled": 0x3b3a37,
	"plate": 0x020304,
	"white": 0xffffff,
}
# Same colours as constants (UiTheme.PRIMARY etc.) for typed use.
const BG := 0x04070b
const BG_PANEL := 0x070b10
const BG_PANEL_HI := 0x111820
const PRIMARY := 0xffb347
const PRIMARY_DIM := 0x8a5d22
const ACCENT := 0x46d6c8
const SECONDARY := 0x46d6c8
const DANGER := 0xff5a4f
const OK := 0x7fe08a
const TEXT := 0xeae6dc
const TEXT_DIM := 0x8e8b82
const DISABLED := 0x3b3a37
const PLATE := 0x020304
const WHITE := 0xffffff

## Leitner box colours 0..5: grey, red, orange, yellow, light green, green.
const BOX_COLORS: Array[int] = [0x5a6472, 0xe5484d, 0xf28c28, 0xf2d024, 0x9be37a, 0x2fb36a]
## mastery_band colours 0..4: unlit, weak, learning, good, mastered.
const BAND_COLORS: Array[int] = [0x4a5566, 0xe5484d, 0xf28c28, 0xd8e04a, 0x2fd08a]

## Font families (TS FONT_UI / FONT_MONO): "ui" = Rajdhani, "mono" = Share Tech Mono.
const FONT_UI := "ui"
const FONT_MONO := "mono"

## Font sizes in logical pixels (Theme v2).
const SIZES := {
	"hero": 54,
	"title": 30,
	"heading": 20,
	"body": 16,
	"label": 13,
	"small": 11,
	"problem": 24,
	"input": 30,
}
## Letter spacing (px) for caps labels and buttons.
const LETTER_SPACING := {"caps": 2, "wide": 4}
const SPACING := {"xs": 4, "s": 8, "m": 16, "l": 24, "xl": 40}

## Flat look: nearly square corners.
const RADIUS := 2
const LINE_WIDTH := 1
## Length of the corner brackets on panels and cards.
const BRACKET := 10

## Render depths used across scenes (Phaser setDepth -> Godot z_index).
const DEPTH := {
	"background": -100,
	"world": 0,
	"enemies": 10,
	"fx": 20,
	"hud": 50,
	"overlay": 100,
}

static var _fonts := {}


## Godot Color from a 0xRRGGBB int.
static func color(c: int, alpha: float = 1.0) -> Color:
	return Color(((c >> 16) & 0xff) / 255.0, ((c >> 8) & 0xff) / 255.0, (c & 0xff) / 255.0, alpha)


## "#rrggbb" (TS CSS / toCss).
static func css(c: int) -> String:
	return "#%06x" % (c & 0xffffff)


## 0xRRGGBB from "#rrggbb" / "#rgb" / "#rrggbbaa" (alpha ignored).
static func parse_css(s: String) -> int:
	var c := Color.html(s)
	return (int(round(c.r * 255)) << 16) | (int(round(c.g * 255)) << 8) | int(round(c.b * 255))


## The bundled font of a family ("ui" Rajdhani, "mono" Share Tech Mono) at a CSS weight
## (400/500/600/700; "normal" = 400, "bold" = 700), with letter spacing in px.
## Rajdhani = latin + latin-ext files; Share Tech Mono covers Latin-1 only, so Croatian letters
## fall back to a system monospace font (like the CSS stack in theme.ts).
static func font(family: String = FONT_UI, weight: Variant = 500, letter_spacing: float = 0.0) -> Font:
	var w := _weight(weight)
	if family == FONT_MONO:
		w = 400
	var key := "%s|%d|%s" % [family, w, letter_spacing]
	if _fonts.has(key):
		return _fonts[key]
	var base := _base_font(family, w)
	var f: Font = base
	if letter_spacing != 0.0:
		var v := FontVariation.new()
		v.base_font = base
		v.spacing_glyph = int(round(letter_spacing))
		f = v
	_fonts[key] = f
	return f


static func _weight(weight: Variant) -> int:
	if weight is int or weight is float:
		return int(weight)
	var s := str(weight).strip_edges().to_lower()
	if s == "bold":
		return 700
	if s == "normal" or s == "" or s == "italic":
		return 400
	if s.is_valid_int():
		return s.to_int()
	return 400


static func _base_font(family: String, w: int) -> Font:
	var key := "base|%s|%d" % [family, w]
	if _fonts.has(key):
		return _fonts[key]
	var f: Font
	if family == FONT_MONO:
		var mono := _load_font("res://fonts/share-tech-mono-latin-400-normal.woff2")
		var sys := SystemFont.new()
		sys.font_names = PackedStringArray(["Cascadia Mono", "Consolas", "Menlo", "DejaVu Sans Mono", "monospace"])
		if mono != null:
			mono.fallbacks = [sys]
			f = mono
		else:
			f = sys
	else:
		var weights := [400, 500, 600, 700]
		var nearest := 500
		for x in weights:
			if absi(x - w) < absi(nearest - w):
				nearest = x
		var latin := _load_font("res://fonts/rajdhani-latin-%d-normal.woff2" % nearest)
		var ext := _load_font("res://fonts/rajdhani-latin-ext-%d-normal.woff2" % nearest)
		if latin != null:
			if ext != null:
				latin.fallbacks = [ext]
			f = latin
		else:
			var sys := SystemFont.new()
			sys.font_names = PackedStringArray(["Segoe UI", "Roboto", "Arial", "sans-serif"])
			sys.font_weight = nearest
			f = sys
	_fonts[key] = f
	return f


static func _load_font(path: String) -> FontFile:
	if ResourceLoader.exists(path):
		var res = load(path)
		if res is FontFile:
			return res
	if FileAccess.file_exists(path):
		var ff := FontFile.new()
		if ff.load_dynamic_font(path) == OK:
			return ff
	push_warning("[theme] font missing: %s" % path)
	return null
