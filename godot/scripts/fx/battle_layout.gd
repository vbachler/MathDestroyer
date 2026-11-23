class_name BattleLayout
## Port of src/fx/battleLayout.ts: battle screen geometry (logical 1280x720). Pure: unit tested in
## tests/test_battle_layout.gd. Rects are {x, y, w, h} Dictionaries, points {x, y} (or Vector2).
##
## Dashboard: `ui/dash.png` is 1920x403 with five black screens, drawn at DASH_SCALE = 0.42
## (806 px wide, centred) with its top at y = 576 and its bottom frame cropped by the view edge.

const VIEW_W := 1280
const VIEW_H := 720

# ---------------------------------------------------------------- dashboard

const DASH_SRC_W := 1920
const DASH_SRC_H := 403
const DASH_SCALE := 0.42
const DASH_W := DASH_SRC_W * DASH_SCALE            # 806.4
const DASH_H := DASH_SRC_H * DASH_SCALE            # 169.3
const DASH_X := (VIEW_W - DASH_W) / 2.0            # 236.8 (left edge)
const DASH_Y := 576.0                              # top edge

## Black screen interiors measured in the source image (pixels inside the amber bezels).
const DASH_SCREENS_SRC := {
	"left": {"x": 124, "y": 148, "w": 203, "h": 178},
	"leftInner": {"x": 410, "y": 195, "w": 194, "h": 131},
	"centre": {"x": 793, "y": 116, "w": 344, "h": 210},
	"rightInner": {"x": 1326, "y": 195, "w": 193, "h": 131},
	"right": {"x": 1603, "y": 148, "w": 198, "h": 178},
}
## Screen order (TS object key order).
const DASH_SCREEN_NAMES := ["left", "leftInner", "centre", "rightInner", "right"]

## First opaque row of the dashboard image at source column x (measured; linear in between).
const DASH_TOP_PROFILE := [
	[0, 403], [29, 403], [30, 98], [100, 73], [300, 46], [500, 25], [700, 10], [960, 2],
	[1200, 9], [1500, 32], [1800, 70], [1890, 96], [1918, 96], [1919, 403],
]

static var _screens := {}


## Source-image rectangle -> logical view rectangle.
static func dash_to_view(r: Dictionary) -> Dictionary:
	return {"x": DASH_X + r.x * DASH_SCALE, "y": DASH_Y + r.y * DASH_SCALE, "w": r.w * DASH_SCALE, "h": r.h * DASH_SCALE}


## Screens in view coordinates (left: wave, leftInner: score, centre: typed answer,
## rightInner: streak, right: station hp).
static func dash_screens() -> Dictionary:
	if _screens.is_empty():
		for k in DASH_SCREEN_NAMES:
			_screens[k] = dash_to_view(DASH_SCREENS_SRC[k])
	return _screens


## Top edge of the drawn dashboard at view x (VIEW_H where the dashboard is absent).
static func dash_top_at(view_x: float) -> float:
	var sx := (view_x - DASH_X) / DASH_SCALE
	if sx < 0 or sx > DASH_SRC_W - 1:
		return VIEW_H
	for i in range(1, DASH_TOP_PROFILE.size()):
		var x1: float = DASH_TOP_PROFILE[i][0]
		var y1: float = DASH_TOP_PROFILE[i][1]
		if sx <= x1:
			var x0: float = DASH_TOP_PROFILE[i - 1][0]
			var y0: float = DASH_TOP_PROFILE[i - 1][1]
			var t := 0.0 if x1 == x0 else (sx - x0) / (x1 - x0)
			var src_y := y0 + (y1 - y0) * t
			return VIEW_H if src_y >= DASH_SRC_H else DASH_Y + src_y * DASH_SCALE
	return VIEW_H


# ---------------------------------------------------------------- field

## Sim field: enemies spawn at y 60 and hit at y 600 (core/battle).
const SIM_SPAWN_Y := 60.0
const SIM_IMPACT_Y := 600.0
## Drawn ship centre at spawn and at impact: the sim's descent is mapped onto the stations.
const SHIP_SPAWN_Y := 64.0
const SHIP_IMPACT_Y := 510.0
## Ship length (the 256 px sprite frame) at spawn and at impact: grows with depth.
const SHIP_SIZE_FAR := 34.0
const SHIP_SIZE_NEAR := 52.0


static func _progress(sim_y: float) -> float:
	return minf(1.0, maxf(0.0, (sim_y - SIM_SPAWN_Y) / (SIM_IMPACT_Y - SIM_SPAWN_Y)))


static func ship_screen_y(sim_y: float) -> float:
	return SHIP_SPAWN_Y + (SHIP_IMPACT_Y - SHIP_SPAWN_Y) * _progress(sim_y)


static func ship_size(sim_y: float) -> float:
	return SHIP_SIZE_FAR + (SHIP_SIZE_NEAR - SHIP_SIZE_FAR) * _progress(sim_y)


## Stations (the defended objects) at DOME_X, this y; sprite 58 px wide, content 58x43.
const STATION_Y := 548.0
const STATION_W := 58.0
const STATION_H := 44.0
## hp pips under each station.
const STATION_PIP_Y := STATION_Y + STATION_H / 2.0 + 4.0   # 574
const STATION_PIP_H := 3.0


static func station_rect(x: float) -> Dictionary:
	return {"x": x - STATION_W / 2.0, "y": STATION_Y - STATION_H / 2.0, "w": STATION_W, "h": STATION_H}


## The ship's guns: lower-left and lower-right corners of the view (beams pass behind the dashboard).
const GUN_LEFT := {"x": 18.0, "y": VIEW_H - 14.0}
const GUN_RIGHT := {"x": VIEW_W - 18.0, "y": VIEW_H - 14.0}

## Where enemy shots hit us: the cockpit glass just above the centre of the console hood.
const COCKPIT := {"x": VIEW_W / 2.0, "y": 596.0}

## Small pause glyph button, top-right.
const PAUSE_RECT := {"x": VIEW_W - 44.0, "y": 8.0, "w": 36.0, "h": 36.0}

# ---------------------------------------------------------------- touch keypad

const KEY_SIZE := 48.0
const KEY_GAP := 4.0
## Digits + sign + backspace: 4 x 3 keys in the bottom-left corner, left of the dashboard.
const KEYPAD_DIGITS := {
	"x": 4.0,
	"y": VIEW_H - 8.0 - (3 * KEY_SIZE + 2 * KEY_GAP),
	"w": 4 * KEY_SIZE + 3 * KEY_GAP,
	"h": 3 * KEY_SIZE + 2 * KEY_GAP,
}
## One tall fire key in the bottom-right corner, right of the dashboard.
const KEYPAD_FIRE := {
	"x": VIEW_W - 8.0 - 100.0,
	"y": VIEW_H - 8.0 - (3 * KEY_SIZE + 2 * KEY_GAP),
	"w": 100.0,
	"h": 3 * KEY_SIZE + 2 * KEY_GAP,
}

# ---------------------------------------------------------------- problem tags

## Horizontal gap (hairline) between the ship's edge and its tag.
const TAG_GAP := 12.0
const TAG_MARGIN := 6.0


## item = TagItem {id, x, y, ship_half_w, ship_half_h, tag_w, tag_h}; side "left" | "right".
static func tag_rect(item: Dictionary, side: String) -> Dictionary:
	var x: float = item.x + item.ship_half_w + TAG_GAP if side == "right" else item.x - item.ship_half_w - TAG_GAP - item.tag_w
	return {"x": x, "y": item.y - item.tag_h / 2.0, "w": item.tag_w, "h": item.tag_h}


static func _overlap_area(a: Dictionary, b: Dictionary) -> float:
	var w := minf(a.x + a.w, b.x + b.w) - maxf(a.x, b.x)
	var h := minf(a.y + a.h, b.y + b.h) - maxf(a.y, b.y)
	return w * h if w > 0 and h > 0 else 0.0


static func _in_view(r: Dictionary) -> bool:
	return r.x >= TAG_MARGIN and r.x + r.w <= VIEW_W - TAG_MARGIN


## Picks the side of each ship's problem tag. Lower ships (greater y) choose first, so the enemy
## about to hit keeps its tag where it is and the higher neighbour moves. A side is valid when the
## tag stays on screen and overlaps no tag placed already and no other ship. Preference: the side
## used last frame (no flicker), else outward-in (ships left of centre put the tag on the right).
## When neither side is valid, the side with less overlap wins. Returns {id: side}.
static func layout_tags(items: Array, previous: Dictionary = {}) -> Dictionary:
	var out := {}
	var sorted := Js.sorted(items, func(a, b) -> float:
		var d: float = b.y - a.y
		return d if d != 0 else float(a.id - b.id))
	var placed: Array = []
	for item in sorted:
		var preferred: String = previous.get(item.id, "right" if item.x < VIEW_W / 2.0 else "left")
		var order: Array = ["right", "left"] if preferred == "right" else ["left", "right"]
		var obstacles: Array = placed.duplicate()
		for o in items:
			if o.id != item.id:
				obstacles.append({"x": o.x - o.ship_half_w, "y": o.y - o.ship_half_h, "w": o.ship_half_w * 2, "h": o.ship_half_h * 2})
		var best: String = order[0]
		var best_cost := INF
		for side in order:
			var r := tag_rect(item, side)
			var cost := 0.0 if _in_view(r) else 1e9
			for o in obstacles:
				cost += _overlap_area(r, o)
			if cost < best_cost:
				best = side
				best_cost = cost
			if cost == 0:
				break
		out[item.id] = best
		placed.append(tag_rect(item, best))
	return out


## Where a missed shot goes: 40..70 px beside the target (`r01` in 0..1 picks distance and side).
static func miss_point(target: Variant, r01: float) -> Dictionary:
	var side := -1.0 if r01 < 0.5 else 1.0
	var dist := 40.0 + 30.0 * fmod(r01 * 2.0, 1.0)
	var x: float = target.x + side * dist
	if x < TAG_MARGIN or x > VIEW_W - TAG_MARGIN:
		x = target.x - side * dist
	return {"x": x, "y": target.y - 6.0}
