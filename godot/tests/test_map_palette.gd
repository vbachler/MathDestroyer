extends TestCase
## Port of tests/mapVisuals.test.ts ("map palette" describe only).
## The "sector clouds" describe (src/fx/cloudField) is not ported here: cloudField is ported later
## by another agent, and its tests go with that port.


static func lum(c: int) -> float:
	return 0.2126 * (c >> 16) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)


func test_converts_hsl_to_rgb() -> void:
	eq(MapPalette.hsl_to_int(0, 1, 0.5), 0xff0000)
	eq(MapPalette.hsl_to_int(120, 1, 0.5), 0x00ff00)
	eq(MapPalette.hsl_to_int(240, 1, 0.5), 0x0000ff)
	eq(MapPalette.hsl_to_int(60, 1, 0.5), 0xffff00)
	eq(MapPalette.hsl_to_int(-120, 1, 0.5), 0x0000ff)
	eq(MapPalette.hsl_to_int(0, 0, 1), 0xffffff)
	eq(MapPalette.hsl_to_int(0, 0, 0), 0x000000)
	eq(MapPalette.css_color(0x0a0b0c), "#0a0b0c")


func test_keeps_sector_colours_muted_fill_darker_than_rim_label_pale() -> void:
	for s in Content.sectors():
		var c := MapPalette.sector_colors(s.hue)
		lt(lum(c.fill), lum(c.rim), s.id)
		lt(lum(c.rim), lum(c.label) + 40, s.id)
	lt(MapPalette.MAP_HSL.sectorFill.l, 0.45)
	lt(MapPalette.MAP_HSL.sectorFill.s, 0.6)
	var sun := MapPalette.sun_colors(30)
	gt(lum(sun.core), lum(sun.glow))
