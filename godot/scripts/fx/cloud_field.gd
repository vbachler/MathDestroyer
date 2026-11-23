class_name CloudField
## Port of src/fx/cloudField.ts: sector clouds as a density field (pure): soft gaussian blobs around
## a sector's systems plus a few seeded filler blobs, sampled on a coarse grid. The iso line of the
## field is the organic cloud outline; cloud_fill / cloud_rim turn a field value into strengths.
## Blob = {x, y, r, w}. CloudGrid = {x0, y0, cell, w, h, field: PackedFloat32Array (row-major)}.

## Field value of the cloud outline. A lone blob of radius r reaches it at about 0.83 r.
const CLOUD_EDGE := 0.5
## Half-width (in field units) of the bright rim around the outline.
const RIM_WIDTH := 0.07


## Blobs of one sector: one at the centre (half the sector radius), one per system (radius
## 110..140) and five filler blobs scattered inside the disc. Deterministic for a seed.
static func sector_blobs(sector: Dictionary, systems: Array, seed: int) -> Array:
	var rng := Rng.new(seed)
	var blobs: Array = [{"x": sector.x, "y": sector.y, "r": sector.radius * 0.5, "w": 0.9}]
	for s in systems:
		blobs.append({"x": s.x, "y": s.y, "r": 110 + rng.next() * 30, "w": 1.0})
	for i in 5:
		var a := rng.next() * PI * 2
		var d: float = sector.radius * (0.35 + rng.next() * 0.42)
		var r: float = sector.radius * (0.22 + rng.next() * 0.18)
		var w := 0.6 + rng.next() * 0.4
		blobs.append({"x": sector.x + cos(a) * d, "y": sector.y + sin(a) * d, "r": r, "w": w})
	return blobs


## Field value at a world point: sum of w * exp(-d^2 / r^2).
static func field_at(blobs: Array, x: float, y: float) -> float:
	var f := 0.0
	for b in blobs:
		var dx: float = x - b.x
		var dy: float = y - b.y
		f += b.w * exp(-(dx * dx + dy * dy) / (b.r * b.r))
	return f


## Samples the field on a grid covering every blob out to 2.2 r, `cell` world units per texel.
static func cloud_grid(blobs: Array, cell: float) -> Dictionary:
	var x0 := INF
	var y0 := INF
	var x1 := -INF
	var y1 := -INF
	for b in blobs:
		var reach: float = b.r * 2.2
		x0 = minf(x0, b.x - reach)
		y0 = minf(y0, b.y - reach)
		x1 = maxf(x1, b.x + reach)
		y1 = maxf(y1, b.y + reach)
	x0 = floor(x0)
	y0 = floor(y0)
	var w := maxi(1, int(ceil((x1 - x0) / cell)))
	var h := maxi(1, int(ceil((y1 - y0) / cell)))
	var field := PackedFloat32Array()
	field.resize(w * h)
	for j in h:
		var wy := y0 + (j + 0.5) * cell
		for i in w:
			field[j * w + i] = field_at(blobs, x0 + (i + 0.5) * cell, wy)
	return {"x0": x0, "y0": y0, "cell": cell, "w": w, "h": h, "field": field}


## Fill strength 0..1: faint haze outside the outline, the body inside, denser toward the cores.
static func cloud_fill(f: float) -> float:
	var haze := 0.16 * _smoothstep(CLOUD_EDGE - 0.3, CLOUD_EDGE, f)
	var body := _smoothstep(CLOUD_EDGE - 0.08, CLOUD_EDGE + 0.06, f)
	var core := minf(1.0, maxf(0.0, (f - CLOUD_EDGE) / 1.4))
	return minf(1.0, haze + body * (0.5 + 0.5 * core))


## Rim strength 0..1: a thin band on the outline.
static func cloud_rim(f: float) -> float:
	var d := (f - CLOUD_EDGE) / RIM_WIDTH
	return exp(-d * d)


static func _smoothstep(a: float, b: float, x: float) -> float:
	var t := minf(1.0, maxf(0.0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
