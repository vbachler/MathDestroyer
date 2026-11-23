class_name SectorClouds
## Port of src/fx/SectorClouds.ts: a sector's cloud texture, baked once per game (textures outlive
## scenes, so a restart reuses it) into an ImageTexture registered in Assets under
## "map-cloud-<sector id>". Drawn at full strength; the scene sets the image alpha from mastery.
## bake_sector_cloud(sector) -> {key, x0, y0, cell} (where texel (0, 0)'s top-left sits in the world).

## World units per texel. The clouds are soft, so a coarse grid scaled up with filtering is enough.
const CLOUD_CELL := 6.0
## Peak opacity of the fill and of the rim before the mastery factor (kept low: muted, dark map).
const FILL_ALPHA := 0.36
const RIM_ALPHA := 0.3

static var _baked := {}


static func bake_sector_cloud(sector: Dictionary) -> Dictionary:
	var key := "map-cloud-%s" % sector.id
	if _baked.has(sector.id) and Assets.has_image(key):
		return _baked[sector.id]
	var blobs := CloudField.sector_blobs(sector, sector.systems, Names.stable_hash("cloud:%s" % sector.id))
	var grid := CloudField.cloud_grid(blobs, CLOUD_CELL)
	var out := {"key": key, "x0": grid.x0, "y0": grid.y0, "cell": grid.cell}
	var cols := MapPalette.sector_colors(sector.hue)
	var fill: int = cols.fill
	var rim: int = cols.rim
	var fr := (fill >> 16) & 255
	var fg := (fill >> 8) & 255
	var fb := fill & 255
	var rr := (rim >> 16) & 255
	var rg := (rim >> 8) & 255
	var rb := rim & 255
	var w: int = grid.w
	var h: int = grid.h
	var field: PackedFloat32Array = grid.field
	var data := PackedByteArray()
	data.resize(w * h * 4)
	for i in field.size():
		var f := field[i]
		var fa := CloudField.cloud_fill(f) * FILL_ALPHA
		var ra := CloudField.cloud_rim(f) * RIM_ALPHA * (1 - fa)
		var a := fa + ra
		var k := i * 4
		if a <= 0.002:
			continue
		data[k] = Js.round((fr * fa + rr * ra) / a)
		data[k + 1] = Js.round((fg * fa + rg * ra) / a)
		data[k + 2] = Js.round((fb * fa + rb * ra) / a)
		data[k + 3] = Js.round(minf(1.0, a) * 255)
	var img := Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, data)
	Assets.add_texture(key, ImageTexture.create_from_image(img))
	_baked[sector.id] = out
	return out
