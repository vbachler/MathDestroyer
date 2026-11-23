class_name MapPalette
## Port of src/ui/mapPalette.ts: star map colours derived from a hue (pure).

const MAP_HSL := {
	"sectorFill": {"s": 0.42, "l": 0.36},
	"sectorRim": {"s": 0.48, "l": 0.6},
	"sectorLabel": {"s": 0.28, "l": 0.74},
	"sunGlow": {"s": 0.85, "l": 0.62},
	"sunCore": {"s": 0.6, "l": 0.9},
}


## HSL (h in degrees, s and l in 0..1) -> 0xRRGGBB.
static func hsl_to_int(h: float, s: float, l: float) -> int:
	var hue := fmod(fmod(h, 360.0) + 360.0, 360.0)
	var c := (1.0 - absf(2.0 * l - 1.0)) * s
	var x := c * (1.0 - absf(fmod(hue / 60.0, 2.0) - 1.0))
	var m := l - c / 2.0
	var r := 0.0
	var g := 0.0
	var b := 0.0
	if hue < 60:
		r = c
		g = x
	elif hue < 120:
		r = x
		g = c
	elif hue < 180:
		g = c
		b = x
	elif hue < 240:
		g = x
		b = c
	elif hue < 300:
		r = x
		b = c
	else:
		r = c
		b = x
	return (_to(r + m) << 16) | (_to(g + m) << 8) | _to(b + m)


static func _to(v: float) -> int:
	return Js.round(minf(1.0, maxf(0.0, v)) * 255.0)


## choice = {s, l}
static func hue_color(hue: float, choice: Dictionary) -> int:
	return hsl_to_int(hue, choice.s, choice.l)


## "#rrggbb" for text styles.
static func css_color(c: int) -> String:
	return "#%06x" % (c & 0xffffff)


## {fill, rim, label}
static func sector_colors(hue: float) -> Dictionary:
	return {
		"fill": hue_color(hue, MAP_HSL.sectorFill),
		"rim": hue_color(hue, MAP_HSL.sectorRim),
		"label": hue_color(hue, MAP_HSL.sectorLabel),
	}


## {glow, core}
static func sun_colors(hue: float) -> Dictionary:
	return {"glow": hue_color(hue, MAP_HSL.sunGlow), "core": hue_color(hue, MAP_HSL.sunCore)}
