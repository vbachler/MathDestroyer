class_name PGraphics
extends Node2D
## Phaser.GameObjects.Graphics for the port: the same immediate drawing API (snake_case), recorded
## as shapes and replayed in _draw(). Port Phaser drawing code line by line:
##   g.fillStyle(c, a)        -> g.fill_style(c, a)         (c = 0xRRGGBB int like Phaser)
##   g.lineStyle(w, c, a)     -> g.line_style(w, c, a)
##   g.fillRect / strokeRect / fillCircle / strokeCircle / fillEllipse / strokeEllipse /
##   fillTriangle / strokeTriangle / fillRoundedRect / strokeRoundedRect / lineBetween /
##   fillPoints / strokePoints / beginPath / moveTo / lineTo / arc / closePath / strokePath /
##   fillPath / slice / clear   -> same names in snake_case, same arguments (angles in radians).
## Shapes keep Phaser's geometry (lines centred on the path). Anti-aliasing comes from the project's
## 2D MSAA like Phaser's WebGL antialias. Each call queues a redraw.
## Use it as a child node: var g := PGraphics.new(); add_child(g)  (Phaser: scene.add.graphics()).

var _items: Array = []
var _fill := Color.WHITE
var _line := Color.WHITE
var _line_w := 1.0
# Current path: Array of subpaths {points: PackedVector2Array, closed: bool}.
var _path: Array = []


func clear() -> PGraphics:
	_items.clear()
	_path.clear()
	queue_redraw()
	return self


func fill_style(c: int, alpha: float = 1.0) -> PGraphics:
	_fill = UiTheme.color(c, alpha)
	return self


func line_style(width: float, c: int, alpha: float = 1.0) -> PGraphics:
	_line_w = width
	_line = UiTheme.color(c, alpha)
	return self


# ---------------------------------------------------------------- shapes

func fill_rect(x: float, y: float, w: float, h: float) -> PGraphics:
	if w == 0 or h == 0:
		return self
	_add_fill(PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)]))
	return self


func stroke_rect(x: float, y: float, w: float, h: float) -> PGraphics:
	_add_stroke(PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)]), true)
	return self


func fill_circle(x: float, y: float, r: float) -> PGraphics:
	if r <= 0:
		return self
	_add_fill(_arc_points(x, y, r, 0.0, TAU, false))
	return self


func stroke_circle(x: float, y: float, r: float) -> PGraphics:
	_add_stroke(_arc_points(x, y, r, 0.0, TAU, false), true)
	return self


## Ellipse centred on (x, y) with full width w and height h (Phaser fillEllipse).
func fill_ellipse(x: float, y: float, w: float, h: float, smoothness: int = 32) -> PGraphics:
	_add_fill(_ellipse_points(x, y, w, h, smoothness))
	return self


func stroke_ellipse(x: float, y: float, w: float, h: float, smoothness: int = 32) -> PGraphics:
	_add_stroke(_ellipse_points(x, y, w, h, smoothness), true)
	return self


func fill_triangle(x0: float, y0: float, x1: float, y1: float, x2: float, y2: float) -> PGraphics:
	_add_fill(PackedVector2Array([Vector2(x0, y0), Vector2(x1, y1), Vector2(x2, y2)]))
	return self


func stroke_triangle(x0: float, y0: float, x1: float, y1: float, x2: float, y2: float) -> PGraphics:
	_add_stroke(PackedVector2Array([Vector2(x0, y0), Vector2(x1, y1), Vector2(x2, y2)]), true)
	return self


func fill_rounded_rect(x: float, y: float, w: float, h: float, radius: float = 20.0) -> PGraphics:
	_add_fill(_rounded_points(x, y, w, h, radius))
	return self


func stroke_rounded_rect(x: float, y: float, w: float, h: float, radius: float = 20.0) -> PGraphics:
	_add_stroke(_rounded_points(x, y, w, h, radius), true)
	return self


func line_between(x1: float, y1: float, x2: float, y2: float) -> PGraphics:
	_add_stroke(PackedVector2Array([Vector2(x1, y1), Vector2(x2, y2)]), false)
	return self


## Phaser fillPoints(points, closeShape): points = Array of Vector2 (or {x, y}).
func fill_points(points: Array, _close_shape: bool = false) -> PGraphics:
	_add_fill(_to_packed(points))
	return self


## Phaser strokePoints(points, closeShape, closePath).
func stroke_points(points: Array, close_shape: bool = false, close_path: bool = false) -> PGraphics:
	_add_stroke(_to_packed(points), close_shape or close_path)
	return self


# ---------------------------------------------------------------- paths

func begin_path() -> PGraphics:
	_path.clear()
	return self


func move_to(x: float, y: float) -> PGraphics:
	_path.append({"points": PackedVector2Array([Vector2(x, y)]), "closed": false})
	return self


func line_to(x: float, y: float) -> PGraphics:
	if _path.is_empty():
		return move_to(x, y)
	_path[-1].points.append(Vector2(x, y))
	return self


## Phaser arc(x, y, radius, startAngle, endAngle, anticlockwise): continues the current subpath.
func arc(x: float, y: float, radius: float, start_angle: float, end_angle: float, anticlockwise: bool = false) -> PGraphics:
	var pts := _arc_points(x, y, radius, start_angle, end_angle, anticlockwise)
	if _path.is_empty():
		_path.append({"points": PackedVector2Array(), "closed": false})
	_path[-1].points.append_array(pts)
	return self


func close_path() -> PGraphics:
	if not _path.is_empty():
		_path[-1].closed = true
	return self


## Phaser slice: a pie wedge path (moveTo centre, arc, closePath). Fill it with fill_path().
func slice(x: float, y: float, radius: float, start_angle: float, end_angle: float, anticlockwise: bool = false) -> PGraphics:
	begin_path()
	move_to(x, y)
	arc(x, y, radius, start_angle, end_angle, anticlockwise)
	close_path()
	return self


func stroke_path() -> PGraphics:
	for sub in _path:
		if sub.points.size() >= 2:
			_add_stroke(sub.points.duplicate(), sub.closed)
	return self


func fill_path() -> PGraphics:
	for sub in _path:
		if sub.points.size() >= 3:
			_add_fill(sub.points.duplicate())
	return self


# ---------------------------------------------------------------- geometry helpers

func _to_packed(points: Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	for p in points:
		out.append(p if p is Vector2 else Vector2(p.x, p.y))
	return out


static func _segments_for(radius: float, sweep: float) -> int:
	return clampi(int(ceil(absf(sweep) * maxf(radius, 1.0) / 2.5)), 6, 160)


## Points along an arc, Phaser angle convention (radians, clockwise on screen when !anticlockwise).
static func _arc_points(x: float, y: float, r: float, start: float, end: float, anticlockwise: bool) -> PackedVector2Array:
	var sweep := end - start
	if anticlockwise:
		if sweep > 0:
			sweep = fmod(sweep, TAU) - TAU if fmod(sweep, TAU) != 0 else -TAU
		elif sweep < -TAU:
			sweep = -TAU
	else:
		if sweep < 0:
			sweep = fmod(sweep, TAU) + TAU if fmod(sweep, TAU) != 0 else TAU
		elif sweep > TAU:
			sweep = TAU
	var n := _segments_for(r, sweep)
	var out := PackedVector2Array()
	for i in n + 1:
		var a := start + sweep * float(i) / float(n)
		out.append(Vector2(x + cos(a) * r, y + sin(a) * r))
	return out


static func _ellipse_points(x: float, y: float, w: float, h: float, smoothness: int) -> PackedVector2Array:
	var out := PackedVector2Array()
	var n := maxi(8, smoothness)
	for i in n:
		var a := TAU * float(i) / float(n)
		out.append(Vector2(x + cos(a) * w / 2.0, y + sin(a) * h / 2.0))
	return out


static func _rounded_points(x: float, y: float, w: float, h: float, radius: float) -> PackedVector2Array:
	var r := minf(radius, minf(w, h) / 2.0)
	if r <= 0:
		return PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)])
	var out := PackedVector2Array()
	out.append_array(_arc_points(x + w - r, y + r, r, -PI / 2, 0, false))
	out.append_array(_arc_points(x + w - r, y + h - r, r, 0, PI / 2, false))
	out.append_array(_arc_points(x + r, y + h - r, r, PI / 2, PI, false))
	out.append_array(_arc_points(x + r, y + r, r, PI, PI * 1.5, false))
	return out


func _add_fill(points: PackedVector2Array) -> void:
	if points.size() < 3 or _fill.a <= 0.0:
		return
	# Self-intersecting / degenerate outlines cannot be triangulated: draw them as a triangle fan.
	_items.append([0, points, _fill, not Geometry2D.triangulate_polygon(points).is_empty()])
	queue_redraw()


func _add_stroke(points: PackedVector2Array, closed: bool) -> void:
	if points.size() < 2 or _line.a <= 0.0 or _line_w <= 0.0:
		return
	if closed and points[0] != points[points.size() - 1]:
		points.append(points[0])
	_items.append([1, points, _line, _line_w])
	queue_redraw()


func _draw() -> void:
	for it in _items:
		if it[0] == 0:
			var pts: PackedVector2Array = it[1]
			if it[3]:
				draw_colored_polygon(pts, it[2])
			else:
				var cols := PackedColorArray([it[2], it[2], it[2]])
				for i in range(1, pts.size() - 1):
					draw_primitive(PackedVector2Array([pts[0], pts[i], pts[i + 1]]), cols, PackedVector2Array())
		else:
			draw_polyline(it[1], it[2], it[3])
