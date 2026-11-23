class_name ReportLayout
## Port of src/ui/reportLayout.ts: pure layout helpers of the parent report (Mastery scene).

## Approximate advance of one monospace character at the cell font size (px).
const CELL_CHAR_W := 6.2
## Room for the box number and padding inside a cell (px).
const CELL_EXTRA := 24
const CELL_MIN_W := 44
const CELL_MAX_W := 96


## When a fact is next due, relative to now: {unit: "now" | "minutes" | "hours" | "days", count}.
static func relative_due(due_at: float, now: float) -> Dictionary:
	var delta := due_at - now
	if delta <= 0:
		return {"unit": "now", "count": 0}
	var minutes := int(ceil(delta / 60000.0))
	if minutes < 60:
		return {"unit": "minutes", "count": minutes}
	var hours := Js.round(delta / 3600000.0)
	if hours < 24:
		return {"unit": "hours", "count": hours}
	return {"unit": "days", "count": maxi(1, Js.round(delta / 86400000.0))}


## Cell width that fits the longest problem text of a skill (in characters) plus the box number.
static func cell_width(max_chars: int) -> float:
	return minf(CELL_MAX_W, maxf(CELL_MIN_W, ceil(max_chars * CELL_CHAR_W + CELL_EXTRA)))


## Splits lines of the given heights into pages of at most `page_height` (see reportLayout.ts).
## Returns the line indices of each page.
static func paginate(heights: Array, headers: Array, page_height: float) -> Array:
	var pages: Array = []
	var page: Array = []
	var used := 0.0
	for i in heights.size():
		var h: float = heights[i]
		var need := h
		if i < headers.size() and headers[i] and i + 1 < heights.size():
			need += heights[i + 1]
		if page.size() > 0 and used + need > page_height:
			pages.append(page)
			page = []
			used = 0.0
		page.append(i)
		used += h
	if page.size() > 0:
		pages.append(page)
	return pages
