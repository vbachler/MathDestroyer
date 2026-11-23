extends TestCase
## Port of tests/reportLayout.test.ts

const MIN := 60_000
const HOUR := 3_600_000
const DAY_MS := 86_400_000


func test_relative_review_time() -> void:
	var now := 1_700_000_000_000
	eq(ReportLayout.relative_due(now - 5, now), {"unit": "now", "count": 0})
	eq(ReportLayout.relative_due(now, now), {"unit": "now", "count": 0})
	eq(ReportLayout.relative_due(now + 1, now), {"unit": "minutes", "count": 1})
	eq(ReportLayout.relative_due(now + 2 * MIN, now), {"unit": "minutes", "count": 2})
	eq(ReportLayout.relative_due(now + 59 * MIN, now), {"unit": "minutes", "count": 59})
	eq(ReportLayout.relative_due(now + 90 * MIN, now), {"unit": "hours", "count": 2})
	eq(ReportLayout.relative_due(now + 23 * HOUR, now), {"unit": "hours", "count": 23})
	eq(ReportLayout.relative_due(now + 24 * HOUR, now), {"unit": "days", "count": 1})
	eq(ReportLayout.relative_due(now + 3 * DAY_MS, now), {"unit": "days", "count": 3})


func test_cell_width_fits_the_longest_problem_and_stays_within_bounds() -> void:
	eq(ReportLayout.cell_width(1), ReportLayout.CELL_MIN_W)
	gt(ReportLayout.cell_width(6), ReportLayout.cell_width(3))
	eq(ReportLayout.cell_width(40), ReportLayout.CELL_MAX_W)


func test_pages_never_end_on_a_header_and_keep_every_line_once() -> void:
	var heights := [30, 25, 25, 30, 25, 25, 25]
	var headers := [true, false, false, true, false, false, false]
	var pages := ReportLayout.paginate(heights, headers, 110)
	var flat: Array = []
	for page in pages:
		flat.append_array(page)
	eq(flat, [0, 1, 2, 3, 4, 5, 6])
	for page in pages:
		var last: int = page[page.size() - 1]
		no(headers[last] and last < heights.size() - 1)
		var sum := 0
		for i in page:
			sum += heights[i]
		le(sum, 110)
	eq(ReportLayout.paginate([500], [false], 100), [[0]])
