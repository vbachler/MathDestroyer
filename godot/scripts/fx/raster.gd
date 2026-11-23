class_name Raster
extends RefCounted
## A tiny software 2D canvas used to generate the procedural textures of src/fx/textures.ts with
## the same drawing operations as the TS (HTML canvas / Phaser Graphics.generateTexture):
## source-over compositing, canvas radial/linear gradient math (two-circle radial gradients),
## anti-aliased fills and strokes from signed distances. Gradient pixels match the canvas formula;
## shape edges are anti-aliased with a 1 px ramp (the browser's rasteriser differs in the last bits).
##
## Paint: a Color, or {"radial": [x0, y0, r0, x1, y1, r1], "stops": [[t, Color], ...]} or
## {"linear": [x0, y0, x1, y1], "stops": [...]}. Points are Vector2; paths are PackedVector2Array.

var w: int
var h: int
## Premultiplied RGBA floats, row-major.
var buf: PackedFloat32Array


func _init(width: int, height: int) -> void:
	w = width
	h = height
	buf = PackedFloat32Array()
	buf.resize(w * h * 4)


func to_image() -> Image:
	var bytes := PackedByteArray()
	bytes.resize(w * h * 4)
	for i in w * h:
		var a := buf[i * 4 + 3]
		var o := i * 4
		if a <= 0.0:
			bytes[o] = 0
			bytes[o + 1] = 0
			bytes[o + 2] = 0
			bytes[o + 3] = 0
			continue
		bytes[o] = clampi(int(round(buf[o] / a * 255.0)), 0, 255)
		bytes[o + 1] = clampi(int(round(buf[o + 1] / a * 255.0)), 0, 255)
		bytes[o + 2] = clampi(int(round(buf[o + 2] / a * 255.0)), 0, 255)
		bytes[o + 3] = clampi(int(round(a * 255.0)), 0, 255)
	return Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, bytes)


func to_texture() -> ImageTexture:
	return ImageTexture.create_from_image(to_image())


# ---------------------------------------------------------------- colours and paints

## CSS colour: "#rgb", "#rrggbb", "rgba(r,g,b,a)", "rgb(r,g,b)".
static func css(s: String) -> Color:
	s = s.strip_edges()
	if s.begins_with("rgb"):
		var inner := s.substr(s.find("(") + 1).trim_suffix(")")
		var p := inner.split(",")
		var a := 1.0 if p.size() < 4 else p[3].strip_edges().to_float()
		return Color(p[0].to_float() / 255.0, p[1].to_float() / 255.0, p[2].to_float() / 255.0, a)
	return Color.html(s)


## A 0xRRGGBB int with alpha.
static func rgb(c: int, alpha: float = 1.0) -> Color:
	return Color(((c >> 16) & 0xff) / 255.0, ((c >> 8) & 0xff) / 255.0, (c & 0xff) / 255.0, alpha)


static func radial(x0: float, y0: float, r0: float, x1: float, y1: float, r1: float, stops: Array) -> Dictionary:
	return {"radial": [x0, y0, r0, x1, y1, r1], "stops": _norm_stops(stops)}


static func linear(x0: float, y0: float, x1: float, y1: float, stops: Array) -> Dictionary:
	return {"linear": [x0, y0, x1, y1], "stops": _norm_stops(stops)}


static func _norm_stops(stops: Array) -> Array:
	var out: Array = []
	for s in stops:
		out.append([float(s[0]), s[1] if s[1] is Color else css(str(s[1]))])
	return out


static func _stop_color(stops: Array, t: float) -> Color:
	if t <= stops[0][0]:
		return stops[0][1]
	for i in range(1, stops.size()):
		if t <= stops[i][0]:
			var t0: float = stops[i - 1][0]
			var t1: float = stops[i][0]
			if t1 <= t0:
				return stops[i][1]
			return (stops[i - 1][1] as Color).lerp(stops[i][1], (t - t0) / (t1 - t0))
	return stops[stops.size() - 1][1]


## Unpremultiplied colour of a paint at pixel centre (px, py); alpha 0 where a radial gradient is undefined.
static func paint_at(paint: Variant, px: float, py: float) -> Color:
	if paint is Color:
		return paint
	var stops: Array = paint.stops
	if paint.has("linear"):
		var l: Array = paint.linear
		var dx: float = l[2] - l[0]
		var dy: float = l[3] - l[1]
		var len2 := dx * dx + dy * dy
		var t: float = 0.0 if len2 == 0 else ((px - l[0]) * dx + (py - l[1]) * dy) / len2
		return _stop_color(stops, t)
	var g: Array = paint.radial
	var cdx: float = g[3] - g[0]
	var cdy: float = g[4] - g[1]
	var r0: float = g[2]
	var dr: float = g[5] - g[2]
	var pdx: float = px - g[0]
	var pdy: float = py - g[1]
	var a := cdx * cdx + cdy * cdy - dr * dr
	var b := pdx * cdx + pdy * cdy + r0 * dr
	var c := pdx * pdx + pdy * pdy - r0 * r0
	var omega := 0.0
	if absf(a) < 1e-12:
		if b == 0:
			return Color(0, 0, 0, 0)
		omega = c / (2.0 * b)
		if r0 + omega * dr < 0:
			return Color(0, 0, 0, 0)
	else:
		var disc := b * b - a * c
		if disc < 0:
			return Color(0, 0, 0, 0)
		var sq := sqrt(disc)
		var w1 := (b + sq) / a
		var w2 := (b - sq) / a
		var hi := maxf(w1, w2)
		var lo := minf(w1, w2)
		if r0 + hi * dr >= 0:
			omega = hi
		elif r0 + lo * dr >= 0:
			omega = lo
		else:
			return Color(0, 0, 0, 0)
	return _stop_color(stops, omega)


# ---------------------------------------------------------------- compositing

func _blend(x: int, y: int, col: Color, coverage: float) -> void:
	var a := col.a * coverage
	if a <= 0.0:
		return
	var o := (y * w + x) * 4
	var k := 1.0 - a
	buf[o] = col.r * a + buf[o] * k
	buf[o + 1] = col.g * a + buf[o + 1] * k
	buf[o + 2] = col.b * a + buf[o + 2] * k
	buf[o + 3] = a + buf[o + 3] * k


## Fills every pixel of `rect` whose coverage (Callable(px, py) -> 0..1 at the pixel centre) is > 0.
func fill_coverage(rect: Rect2, coverage: Callable, paint: Variant) -> void:
	var x0 := maxi(0, int(floor(rect.position.x)))
	var y0 := maxi(0, int(floor(rect.position.y)))
	var x1 := mini(w, int(ceil(rect.end.x)))
	var y1 := mini(h, int(ceil(rect.end.y)))
	var solid := paint is Color
	for y in range(y0, y1):
		for x in range(x0, x1):
			var cov: float = coverage.call(x + 0.5, y + 0.5)
			if cov <= 0.0:
				continue
			_blend(x, y, paint if solid else paint_at(paint, x + 0.5, y + 0.5), minf(cov, 1.0))


# ---------------------------------------------------------------- shapes

## Canvas fillRect (axis-aligned; exact pixel coverage).
func fill_rect(x: float, y: float, rw: float, rh: float, paint: Variant) -> void:
	var rect := Rect2(x, y, rw, rh).abs()
	var cov := func(px: float, py: float) -> float:
		var cx := clampf(minf(px + 0.5, rect.end.x) - maxf(px - 0.5, rect.position.x), 0.0, 1.0)
		var cy := clampf(minf(py + 0.5, rect.end.y) - maxf(py - 0.5, rect.position.y), 0.0, 1.0)
		return cx * cy
	fill_coverage(rect.grow(1), cov, paint)


## Polygon fill (nonzero winding), anti-aliased edges.
func fill_polygon(points: PackedVector2Array, paint: Variant) -> void:
	if points.size() < 3:
		return
	var bounds := Rect2(points[0], Vector2.ZERO)
	for p in points:
		bounds = bounds.expand(p)
	var cov := func(px: float, py: float) -> float:
		var p := Vector2(px, py)
		var d := INF
		var winding := 0
		var n := points.size()
		for i in n:
			var a := points[i]
			var b := points[(i + 1) % n]
			d = minf(d, _seg_dist(p, a, b))
			if a.y <= py:
				if b.y > py and _cross(a, b, p) > 0:
					winding += 1
			elif b.y <= py and _cross(a, b, p) < 0:
				winding -= 1
		var sd := -d if winding != 0 else d
		return clampf(0.5 - sd, 0.0, 1.0)
	fill_coverage(bounds.grow(1), cov, paint)


## Full ellipse fill centred on (cx, cy) with radii (rx, ry).
func fill_ellipse(cx: float, cy: float, rx: float, ry: float, paint: Variant) -> void:
	if rx <= 0 or ry <= 0:
		return
	var cov := func(px: float, py: float) -> float:
		var qx := (px - cx) / rx
		var qy := (py - cy) / ry
		var ql := sqrt(qx * qx + qy * qy)
		if ql < 1e-9:
			return 1.0
		var gl := sqrt((qx / rx) * (qx / rx) + (qy / ry) * (qy / ry))
		var sd := (ql - 1.0) * ql / gl
		return clampf(0.5 - sd, 0.0, 1.0)
	fill_coverage(Rect2(cx - rx - 1, cy - ry - 1, 2 * rx + 2, 2 * ry + 2), cov, paint)


func fill_circle(cx: float, cy: float, r: float, paint: Variant) -> void:
	fill_ellipse(cx, cy, r, r, paint)


## Stroke along a polyline (closed: back to the first point); round caps and joins.
func stroke_polyline(points: PackedVector2Array, width: float, paint: Variant, closed: bool = false) -> void:
	if points.size() < 2:
		return
	var pts := points.duplicate()
	if closed:
		pts.append(points[0])
	var half := width / 2.0
	var bounds := Rect2(pts[0], Vector2.ZERO)
	for p in pts:
		bounds = bounds.expand(p)
	var cov := func(px: float, py: float) -> float:
		var p := Vector2(px, py)
		var d := INF
		for i in pts.size() - 1:
			d = minf(d, _seg_dist(p, pts[i], pts[i + 1]))
		# Lines thinner than a pixel cover proportionally less (like the browser).
		return clampf(minf(half + 0.5 - d, width), 0.0, 1.0)
	fill_coverage(bounds.grow(half + 1), cov, paint)


# ---------------------------------------------------------------- path helpers

## Points of an arc (radians, canvas convention), `n` segments.
static func arc_points(cx: float, cy: float, r: float, a0: float, a1: float, n: int = 48) -> PackedVector2Array:
	return ellipse_arc_points(cx, cy, r, r, a0, a1, n)


static func ellipse_arc_points(cx: float, cy: float, rx: float, ry: float, a0: float, a1: float, n: int = 48) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in n + 1:
		var a := a0 + (a1 - a0) * float(i) / float(n)
		out.append(Vector2(cx + cos(a) * rx, cy + sin(a) * ry))
	return out


## Quadratic Bézier from p0 via control c to p1 (without p0), `n` segments.
static func quad_points(p0: Vector2, c: Vector2, p1: Vector2, n: int = 24) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in range(1, n + 1):
		var t := float(i) / float(n)
		var u := 1.0 - t
		out.append(p0 * (u * u) + c * (2.0 * u * t) + p1 * (t * t))
	return out


static func _cross(a: Vector2, b: Vector2, p: Vector2) -> float:
	return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)


static func _seg_dist(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var l2 := ab.length_squared()
	var t := 0.0 if l2 == 0 else clampf((p - a).dot(ab) / l2, 0.0, 1.0)
	return p.distance_to(a + ab * t)
