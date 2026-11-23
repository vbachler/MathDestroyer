class_name MapLayout
## Port of src/fx/mapLayout.ts: pure geometry of the star map: the galaxy camera (world <-> screen,
## zoom toward a point, fit and clamp), system orbits in tilted perspective, label collision, call
## card anchoring, edge markers and call pacing.
## MapView = {cx, cy, zoom} (screen px per world unit); Rect = {x, y, w, h} (Dictionaries).

const VIEW_W := UiTheme.GAME_WIDTH
const VIEW_H := UiTheme.GAME_HEIGHT

# ------------------------------------------------------------------ galaxy camera

static func world_to_screen_x(v: Dictionary, wx: float) -> float:
	return (wx - v.cx) * v.zoom + VIEW_W / 2.0


static func world_to_screen_y(v: Dictionary, wy: float) -> float:
	return (wy - v.cy) * v.zoom + VIEW_H / 2.0


static func screen_to_world_x(v: Dictionary, sx: float) -> float:
	return v.cx + (sx - VIEW_W / 2.0) / v.zoom


static func screen_to_world_y(v: Dictionary, sy: float) -> float:
	return v.cy + (sy - VIEW_H / 2.0) / v.zoom


## The view after zooming to `zoom` while the world point under screen (px, py) stays under it.
static func zoom_at(v: Dictionary, zoom: float, px: float, py: float) -> Dictionary:
	var wx := screen_to_world_x(v, px)
	var wy := screen_to_world_y(v, py)
	return {"cx": wx - (px - VIEW_W / 2.0) / zoom, "cy": wy - (py - VIEW_H / 2.0) / zoom, "zoom": zoom}


## The smallest rectangle holding every disc ({x, y, radius}).
static func disc_bounds(discs: Array) -> Dictionary:
	var x0 := INF
	var y0 := INF
	var x1 := -INF
	var y1 := -INF
	for d in discs:
		x0 = minf(x0, d.x - d.radius)
		y0 = minf(y0, d.y - d.radius)
		x1 = maxf(x1, d.x + d.radius)
		y1 = maxf(y1, d.y + d.radius)
	if is_inf(x0):
		return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
	return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


## The view that shows the whole rectangle with `margin` screen pixels free on every side.
static func fit_view(bounds: Dictionary, margin: float) -> Dictionary:
	var zoom := minf((VIEW_W - 2 * margin) / maxf(1.0, bounds.w), (VIEW_H - 2 * margin) / maxf(1.0, bounds.h))
	return {"cx": bounds.x + bounds.w / 2.0, "cy": bounds.y + bounds.h / 2.0, "zoom": zoom}


static func clamp_f(v: float, lo: float, hi: float) -> float:
	return lo if v < lo else (hi if v > hi else v)


## Pointer travel (screen px) beyond which a press is a drag, not a click.
const DRAG_THRESHOLD := 6.0


static func is_drag(dx: float, dy: float, threshold: float = DRAG_THRESHOLD) -> bool:
	return dx * dx + dy * dy > threshold * threshold


## Index of the point nearest to (x, y) within `max_dist`, or -1.
static func nearest_point(xs: Variant, ys: Variant, n: int, x: float, y: float, max_dist: float) -> int:
	var best := -1
	var best_d := max_dist * max_dist
	for i in n:
		var dx: float = xs[i] - x
		var dy: float = ys[i] - y
		var d := dx * dx + dy * dy
		if d <= best_d:
			best_d = d
			best = i
	return best

# ------------------------------------------------------------------ system view

## Vertical squash of orbit ellipses (tilted perspective): ry = ORBIT_TILT * rx.
const ORBIT_TILT := 0.38
## Screen position of the sun in the system view (centre-left).
const SUN_X := 540.0
const SUN_Y := 376.0
const ORBIT_INNER := 140.0
const ORBIT_OUTER := 480.0
const ORBIT_STEP_MAX := 92.0


## Horizontal radius of orbit `index` (0-based) in a system with `count` planets.
static func orbit_radius(index: int, count: int) -> float:
	if count <= 1:
		return ORBIT_INNER + ORBIT_STEP_MAX
	var step := minf(ORBIT_STEP_MAX, (ORBIT_OUTER - ORBIT_INNER) / (count - 1))
	return ORBIT_INNER + index * step


static func orbit_x(rx: float, angle: float) -> float:
	return cos(angle) * rx


## Positive = toward the viewer.
static func orbit_y(rx: float, angle: float) -> float:
	return sin(angle) * rx * ORBIT_TILT


## True when the point at `angle` is on the near half of the orbit (drawn in front of the sun).
static func in_front(angle: float) -> bool:
	return sin(angle) >= 0


## Angular speed (rad/s) on an orbit of radius rx: slow, outer planets slower (Kepler-like).
static func orbit_speed(rx: float) -> float:
	return 0.045 * pow(ORBIT_INNER / rx, 1.5)


## Planet sprite size, 34..46 px, from a stable hash of its id.
static func planet_size(hash: float) -> int:
	return 34 + (absi(int(hash)) % 13)

# ------------------------------------------------------------------ labels

## Greedy label placement: walks `order` (highest priority first), keeps a label when its rectangle
## (x, y = top-left, w, h, plus `pad`) overlaps no label kept before it; writes 1 / 0 to `out`
## (an Array or packed array of size >= n). Entries with active[i] == 0 are dropped. Returns the count kept.
static func resolve_labels(x: Variant, y: Variant, w: Variant, h: Variant, active: Variant, order: Variant, n: int,
		out: Variant, pad: float = 2.0) -> int:
	for i in n:
		out[i] = 0
	var kept := 0
	for k in n:
		var i: int = order[k]
		if not active[i]:
			continue
		var free := true
		var m := 0
		while m < k and free:
			var j: int = order[m]
			m += 1
			if not out[j]:
				continue
			if x[i] - pad < x[j] + w[j] and x[j] - pad < x[i] + w[i] and y[i] - pad < y[j] + h[j] and y[j] - pad < y[i] + h[i]:
				free = false
		if free:
			out[i] = 1
			kept += 1
	return kept


## Vertical offset (world units) for a sector name so it does not sit on a star: the first of
## 0, -0.35r, +0.35r, -0.6r, +0.6r whose label box keeps `clearance` from every system point.
static func sector_label_offset(cx: float, cy: float, radius: float, label_w: float, label_h: float,
		points: Array, clearance: float) -> float:
	for k in [0.0, -0.35, 0.35, -0.6, 0.6]:
		var dy: float = k * radius
		var top := cy + dy - label_h / 2.0 - clearance
		var bottom := cy + dy + label_h / 2.0 + clearance
		var left := cx - label_w / 2.0 - clearance
		var right := cx + label_w / 2.0 + clearance
		var all_clear := true
		for p in points:
			if not (p.x < left or p.x > right or p.y < top or p.y > bottom):
				all_clear = false
				break
		if all_clear:
			return dy
	return 0.0

# ------------------------------------------------------------------ call card

const CARD_W := 360
const CARD_H := 150
const CARD_MARGIN := 16

## Where the call card may sit, in order of preference: bottom-right, bottom-left, top-right, top-left.
const CARD_ANCHORS := [
	{"x": VIEW_W - CARD_MARGIN - CARD_W, "y": VIEW_H - CARD_MARGIN - CARD_H, "w": CARD_W, "h": CARD_H},
	{"x": CARD_MARGIN, "y": VIEW_H - CARD_MARGIN - CARD_H, "w": CARD_W, "h": CARD_H},
	{"x": VIEW_W - CARD_MARGIN - CARD_W, "y": 64, "w": CARD_W, "h": CARD_H},
	{"x": CARD_MARGIN, "y": 100, "w": CARD_W, "h": CARD_H},
]


## Shortest distance from (x, y) to the rectangle (0 inside).
static func distance_to_rect(r: Variant, x: float, y: float) -> float:
	var rx: float = r.x if r is Dictionary else r.position.x
	var ry: float = r.y if r is Dictionary else r.position.y
	var rw: float = r.w if r is Dictionary else r.size.x
	var rh: float = r.h if r is Dictionary else r.size.y
	var dx := maxf(maxf(rx - x, 0.0), x - (rx + rw))
	var dy := maxf(maxf(ry - y, 0.0), y - (ry + rh))
	return Js.hypot(dx, dy)


## Index of the card anchor that keeps the target circle uncovered: the first anchor at least r
## away; if none is, the one farthest from the target.
static func anchor_card(x: float, y: float, r: float, anchors: Array = CARD_ANCHORS) -> int:
	var far := 0
	var far_d := -1.0
	for i in anchors.size():
		var d := distance_to_rect(anchors[i], x, y)
		if d >= r:
			return i
		if d > far_d:
			far_d = d
			far = i
	return far


## True when the circle (x, y, radius) touches the rectangle.
static func circle_hits_rect(r: Variant, x: float, y: float, radius: float) -> bool:
	return distance_to_rect(r, x, y) < radius

# ------------------------------------------------------------------ edge markers

static func edge_x(dx: float, dy: float, inset: float) -> float:
	return VIEW_W / 2.0 + dx * _edge_scale(dx, dy, inset)


static func edge_y(dx: float, dy: float, inset: float) -> float:
	return VIEW_H / 2.0 + dy * _edge_scale(dx, dy, inset)


static func _edge_scale(dx: float, dy: float, inset: float) -> float:
	var hw := VIEW_W / 2.0 - inset
	var hh := VIEW_H / 2.0 - inset
	var sx := INF if dx == 0 else hw / absf(dx)
	var sy := INF if dy == 0 else hh / absf(dy)
	var s := minf(sx, sy)
	return s if not is_inf(s) else 0.0

# ------------------------------------------------------------------ calls

const FIRST_CALL_MS := 1200.0
const CALL_GAP_MIN_MS := 6000.0
const CALL_GAP_MAX_MS := 9000.0
const MAX_PENDING_CALLS := 3


## Delay before call number `index` (0 = first after entering the system view); random01 in [0, 1).
static func call_delay_ms(index: int, random01: float) -> float:
	if index <= 0:
		return FIRST_CALL_MS
	return CALL_GAP_MIN_MS + (CALL_GAP_MAX_MS - CALL_GAP_MIN_MS) * clamp_f(random01, 0, 1)


static func is_intro_call(call: Dictionary) -> bool:
	return str(call.story_key).begins_with("story.system.")


## The next call to deliver (see mapLayout.ts pickCall); null when nothing new is left.
static func pick_call(calls: Array, pending: Array, system_planet_ids: Array) -> Variant:
	var intro_pending := false
	for p in pending:
		if is_intro_call(p):
			intro_pending = true
	var fresh: Array = []
	for c in calls:
		var taken := false
		for p in pending:
			if p.planet_id == c.planet_id:
				taken = true
		if not taken and not (intro_pending and is_intro_call(c)):
			fresh.append(c)
	for c in fresh:
		if system_planet_ids.has(c.planet_id):
			return c
	return fresh[0] if not fresh.is_empty() else null


## Ease-in-out (smoothstep) of t in [0, 1].
static func smooth(t: float) -> float:
	var x := clamp_f(t, 0, 1)
	return x * x * (3 - 2 * x)
