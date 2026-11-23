extends GameScene
## Port of src/scenes/MasteryScene.ts: parent report of real knowledge from `stats`: a tab per
## skill; inside, a block per sector (name, knowledge bar, mastered / total). Enumerated sectors show
## their facts as small cells coloured by Leitner box (an empty outline for never seen), in rows of
## ten; multiplication and division show table grids. Generated sectors show one larger cell per
## category. Selecting a cell shows one detail line. Pages with the wheel or < >.
## data: {from: "menu" | "star_map"} (default "menu").
##
## Item = {kind: "fact", stat_id, fact} | {kind: "category", stat_id, category}
## Line = {kind: "sector", sector, mastery, mastered, total} | {kind: "cells", facts} | {kind: "columns"}
##      | {kind: "table", label, facts} | {kind: "categories", sector_id, categories} | {kind: "note", text}

const LEFT := 24.0
const AREA_W := UiTheme.GAME_WIDTH - 2 * 24.0
const AREA_TOP := 98.0
const AREA_H := 512.0
const LINE_H := {"sector": 32.0, "cells": 25.0, "columns": 18.0, "table": 25.0, "categories": 52.0, "note": 26.0}
const CELL_H := 20.0
const CELL_GAP := 3.0
## Fact cells per row of an enumerated sector.
const ROW_CELLS := 10
const TABLE_LABEL_W := 120.0
## Category cell of a generated sector.
const CAT_W := 260.0
const CAT_H := 44.0
const CAT_GAP := 12.0
const TAB_Y := 64.0
const DETAIL_Y := 636.0
const LEGEND_Y := 682.0
const WHEEL_COOLDOWN_MS := 220.0
const GRID_SKILLS := ["multiplication", "division"]

var _from := "menu"
var _skill := "typing"
var _lines: Array = []
var _pages: Array = []
var _page := 0
var _cells: Array = []   # {item, x, y, w, h}
var _selected = null
var _now := 0.0
var _last_wheel := -INF
var _cell_w := 60.0
var _tabs: Node2D
var _grid: Node2D
var _selection: PGraphics
var _detail: PText
var _page_text: PText
var _prev_btn: UiButton
var _next_btn: UiButton
## Last pointer position in scene coordinates (Phaser pointer.x / pointer.y).
var _pointer := Vector2.ZERO


func create(d: Dictionary) -> void:
	_from = d.get("from", "menu")
	_now = App.now_ms()
	_selected = null
	_page = 0
	_last_wheel = -INF
	_cells = []
	var sector = Content.sector_by_id(App.save.location.sector_id)
	_skill = sector.skill if sector != null else "typing"

	PText.make(self, LEFT, 28, App.t("common.menu.mastery").to_upper(), TextStyles.caps({
		"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.TEXT),
	})).set_origin(0, 0.5)
	UiButton.new(self, UiTheme.GAME_WIDTH - UiTheme.SPACING.l - 50, 28, App.t("common.back"), func(): App.goto(_from),
		{"width": 100, "height": 30, "variant": "ghost", "font_size": UiTheme.SIZES.small + 1})

	_tabs = Node2D.new()
	add_child(_tabs)
	_grid = Node2D.new()
	_grid.z_index = UiTheme.DEPTH.world
	add_child(_grid)
	_selection = PGraphics.new()
	_selection.z_index = UiTheme.DEPTH.world + 1
	add_child(_selection)
	var zone_holder := Node2D.new()
	zone_holder.position = Vector2(LEFT, AREA_TOP)
	add_child(zone_holder)
	var zone := HitArea.new(AREA_W, AREA_H, false, false)
	zone_holder.add_child(zone)
	zone.up.connect(func(_inside: bool, _touch: bool): _pick_cell(_pointer.x, _pointer.y))

	var hairline := PGraphics.new()
	add_child(hairline)
	hairline.line_style(1, UiTheme.PRIMARY, 0.2)
	hairline.line_between(LEFT, DETAIL_Y - 18.5, UiTheme.GAME_WIDTH - UiTheme.SPACING.l, DETAIL_Y - 18.5)
	_detail = PText.make(self, LEFT, DETAIL_Y, "", TextStyles.numeral({"font_size": UiTheme.SIZES.label, "color": UiTheme.css(UiTheme.TEXT)}))
	_detail.set_origin(0, 0.5)

	var pager_right := UiTheme.GAME_WIDTH - UiTheme.SPACING.l
	_next_btn = UiButton.new(self, pager_right - 16, LEGEND_Y, App.t("common.pageNext"), func(): _go_to_page(_page + 1),
		{"width": 32, "height": 26, "font_size": UiTheme.SIZES.body})
	_prev_btn = UiButton.new(self, pager_right - 112, LEGEND_Y, App.t("common.pagePrev"), func(): _go_to_page(_page - 1),
		{"width": 32, "height": 26, "font_size": UiTheme.SIZES.body})
	_page_text = PText.make(self, pager_right - 64, LEGEND_Y, "", TextStyles.numeral({
		"font_size": UiTheme.SIZES.small + 1, "color": UiTheme.css(UiTheme.TEXT_DIM),
	}))
	_page_text.set_origin(0.5)
	_draw_legend()

	_show_skill(_skill)


## Tracks the pointer; Phaser POINTER_WHEEL on the scene: pages, with a short cooldown.
func _input(event: InputEvent) -> void:
	if event is InputEventMouse:
		_pointer = make_input_local(event).position
	if not event is InputEventMouseButton or not event.pressed:
		return
	var dy := 0
	if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		dy = 1
	elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
		dy = -1
	if dy == 0:
		return
	var t := Time.get_ticks_msec()
	if t - _last_wheel < WHEEL_COOLDOWN_MS:
		return
	_last_wheel = t
	_go_to_page(_page + dy)

# ------------------------------------------------------------------ tabs, lines, pages

func _show_skill(skill: String) -> void:
	_skill = skill
	_selected = null
	_page = 0
	_lines = _build_lines(skill)
	var heights: Array = []
	var headers: Array = []
	for l in _lines:
		heights.append(LINE_H[l.kind])
		headers.append(l.kind == "sector")
	_pages = ReportLayout.paginate(heights, headers, AREA_H)
	_draw_tabs()
	_draw_page()
	_draw_detail()


func _clear(layer: Node) -> void:
	for c in layer.get_children():
		layer.remove_child(c)
		c.queue_free()


func _draw_tabs() -> void:
	_clear(_tabs)
	var skills := Content.skills()
	var w := AREA_W / skills.size()
	var g := PGraphics.new()
	_tabs.add_child(g)
	g.line_style(1, UiTheme.TEXT_DIM, 0.25)
	g.line_between(LEFT, TAB_Y + 13.5, LEFT + AREA_W, TAB_Y + 13.5)
	for i in skills.size():
		var skill: String = skills[i]
		var cx := LEFT + w * i + w / 2
		var active := skill == _skill
		var text := PText.make(_tabs, cx, TAB_Y, App.t("meta.mastery.tab.%s" % skill).to_upper(), TextStyles.caps({
			"font_size": UiTheme.SIZES.small + 1, "color": UiTheme.css(UiTheme.PRIMARY if active else UiTheme.TEXT_DIM),
			"letter_spacing": UiTheme.LETTER_SPACING.caps,
		}))
		text.set_origin(0.5)
		if text.width > w - 8:
			text.scale = Vector2.ONE * ((w - 8) / text.width)
		if active:
			g.line_style(2, UiTheme.PRIMARY, 1)
			g.line_between(cx - text.display_width / 2, TAB_Y + 13, cx + text.display_width / 2, TAB_Y + 13)
		var zone := HitZone.add(_tabs, cx, TAB_Y, w, 30, func():
			if skill != _skill:
				_show_skill.call_deferred(skill))
		zone.over.connect(func():
			if skill != _skill:
				text.set_color(UiTheme.css(UiTheme.TEXT)))
		zone.out.connect(func():
			if skill != _skill:
				text.set_color(UiTheme.css(UiTheme.TEXT_DIM)))


func _header(sector: Dictionary, stats: Dictionary) -> Dictionary:
	var ids: Array = []
	if sector.skill == "mixed":
		for s in Content.sectors():
			ids.append_array(Facts.sector_stat_ids(s.id))
	else:
		ids = Facts.sector_stat_ids(sector.id)
	var mastered := 0
	for id in ids:
		if Mastery.is_mastered(stats.get(id)):
			mastered += 1
	var mastery := Mastery.galaxy_knowledge(stats) if sector.skill == "mixed" else Mastery.sector_knowledge(sector.id, stats)
	return {"kind": "sector", "sector": sector, "total": ids.size(), "mastered": mastered, "mastery": mastery}


func _build_lines(skill: String) -> Array:
	var stats: Dictionary = App.save.stats
	var locale: String = App.i18n.locale
	var lines: Array = []
	var sectors := Content.sectors_of_skill(skill)
	# The core has no problems of its own; its block reports every sector of the galaxy.
	if skill == "mixed":
		for sector in sectors:
			lines.append(_header(sector, stats))
		lines.append({"kind": "note", "text": App.t("meta.mastery.mixedInfo")})
		return lines

	var longest := 1
	for s in sectors:
		for f in Facts.sector_facts(s.id):
			longest = maxi(longest, Facts.format_problem(f, locale).length())
	_cell_w = ReportLayout.cell_width(longest)
	var grid := GRID_SKILLS.has(skill)
	for sector in sectors:
		lines.append(_header(sector, stats))
		if Facts.sector_kind(sector.id) == "generated":
			lines.append({"kind": "categories", "sector_id": sector.id, "categories": Facts.sector_categories(sector.id)})
			continue
		var facts := Facts.sector_facts(sector.id)
		if grid:
			lines.append({"kind": "columns"})
			var tables: Array = []
			for f in facts:
				var n: int = f.a if skill == "multiplication" else f.b
				if not tables.has(n):
					tables.append(n)
			for n in tables:
				var of_table: Array = facts.filter(func(f): return (f.a if skill == "multiplication" else f.b) == n)
				lines.append({
					"kind": "table",
					"label": App.t("meta.mastery.rowMul" if skill == "multiplication" else "meta.mastery.rowDiv", {"n": n}),
					"facts": of_table,
				})
			continue
		var at := 0
		while at < facts.size():
			lines.append({"kind": "cells", "facts": facts.slice(at, at + ROW_CELLS)})
			at += ROW_CELLS
	return lines


func _go_to_page(page: int) -> void:
	if page < 0 or page >= _pages.size() or page == _page:
		return
	_page = page
	_draw_page()

# ------------------------------------------------------------------ grid

func _draw_page() -> void:
	_clear(_grid)
	_cells = []

	var multi := _pages.size() > 1
	_prev_btn.visible = multi
	_prev_btn.set_enabled(_page > 0)
	_next_btn.visible = multi
	_next_btn.set_enabled(_page < _pages.size() - 1)
	_page_text.visible = multi
	_page_text.set_text("%d / %d" % [_page + 1, _pages.size()])

	var g := PGraphics.new()
	_grid.add_child(g)
	var cw := _cell_w
	var y := AREA_TOP
	var indices: Array = _pages[_page] if _page < _pages.size() else []
	for index in indices:
		var line: Dictionary = _lines[index]
		var h: float = LINE_H[line.kind]
		match line.kind:
			"sector":
				var color := MapPalette.css_color(MapPalette.sector_colors(line.sector.hue).label)
				var name := PText.make(_grid, LEFT, y + h - 12, App.t(line.sector.name_key).to_upper(), TextStyles.caps({
					"font_size": UiTheme.SIZES.small + 1, "color": color, "letter_spacing": UiTheme.LETTER_SPACING.caps,
				}))
				name.set_origin(0, 0.5)
				var bar_x := LEFT + maxf(240, name.width + 24)
				Glyphs.draw_bar(g, bar_x, y + h - 14, 150, 4, line.mastery, UiTheme.BAND_COLORS[Mastery.mastery_band(line.mastery)])
				PText.make(_grid, bar_x + 162, y + h - 12, "%d / %d" % [line.mastered, line.total], TextStyles.numeral({
					"font_size": UiTheme.SIZES.small + 1, "color": UiTheme.css(UiTheme.TEXT_DIM),
				})).set_origin(0, 0.5)
				PText.make(_grid, bar_x + 236, y + h - 12, UiFormat.percent_text(App.i18n, line.mastery), TextStyles.numeral({
					"font_size": UiTheme.SIZES.small + 1, "color": UiTheme.css(UiTheme.TEXT_DIM),
				})).set_origin(0, 0.5)
			"columns":
				for c in 10:
					PText.make(_grid, LEFT + TABLE_LABEL_W + c * (cw + CELL_GAP) + cw / 2, y + h / 2, str(c + 1), TextStyles.numeral({
						"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM),
					})).set_origin(0.5)
			"table":
				PText.make(_grid, LEFT, y + CELL_H / 2, line.label, TextStyles.label({"font_size": UiTheme.SIZES.small + 1})).set_origin(0, 0.5)
				for c in line.facts.size():
					_draw_cell(g, line.facts[c], LEFT + TABLE_LABEL_W + c * (cw + CELL_GAP), y)
			"cells":
				for c in line.facts.size():
					_draw_cell(g, line.facts[c], LEFT + c * (cw + CELL_GAP), y)
			"categories":
				for c in line.categories.size():
					_draw_category(g, line.sector_id, line.categories[c], LEFT + c * (CAT_W + CAT_GAP), y)
			"note":
				PText.make(_grid, LEFT, y + h / 2, line.text, TextStyles.label({"color": UiTheme.css(UiTheme.TEXT_DIM)})).set_origin(0, 0.5)
		y += h
	_draw_selection()


## Cell background: its box colour when seen, an empty outline when never seen. Returns the ink colour.
func _draw_cell_box(g: PGraphics, s: Variant, x: float, y: float, w: float, h: float) -> String:
	if s != null and s.attempts > 0:
		g.fill_style(UiTheme.BOX_COLORS[int(s.box)], 0.88)
		g.fill_rect(x, y, w, h)
		return UiTheme.css(UiTheme.TEXT) if s.box <= 1 else UiTheme.css(UiTheme.BG)
	g.line_style(1, UiTheme.TEXT_DIM, 0.45)
	g.stroke_rect(x + 0.5, y + 0.5, w - 1, h - 1)
	return UiTheme.css(UiTheme.TEXT_DIM)


## One fact cell: filled with its box colour and the box number when seen, an empty outline when never seen.
func _draw_cell(g: PGraphics, fact: Dictionary, x: float, y: float) -> void:
	var s = App.save.stats.get(fact.stat_id)
	var w := _cell_w
	var seen: bool = s != null and s.attempts > 0
	var ink := _draw_cell_box(g, s, x, y, w, CELL_H)
	var problem := PText.make(_grid, x + 5, y + CELL_H / 2, Facts.format_problem(fact, App.i18n.locale), TextStyles.numeral({
		"font_size": UiTheme.SIZES.small, "color": ink,
	}))
	problem.set_origin(0, 0.5)
	var room := w - (20 if seen else 10)
	if problem.width > room:
		problem.scale = Vector2.ONE * (room / problem.width)
	if seen:
		PText.make(_grid, x + w - 5, y + CELL_H / 2, Js.num_str(s.box), TextStyles.numeral({
			"font_size": UiTheme.SIZES.small + 1, "color": ink,
		})).set_origin(1, 0.5)
	_cells.append({"item": {"kind": "fact", "stat_id": fact.stat_id, "fact": fact}, "x": x, "y": y, "w": w, "h": CELL_H})


## One category cell of a generated sector: name, box number, and attempts · accuracy · average time.
func _draw_category(g: PGraphics, sector_id: String, category: String, x: float, y: float) -> void:
	var stat_id := Facts.category_stat_id(sector_id, category)
	var s = App.save.stats.get(stat_id)
	var ink := _draw_cell_box(g, s, x, y, CAT_W, CAT_H)
	var name := PText.make(_grid, x + 8, y + 13, App.t("meta.category.%s" % category).to_upper(), TextStyles.caps({
		"font_size": UiTheme.SIZES.small, "color": ink, "letter_spacing": 1,
	}))
	name.set_origin(0, 0.5)
	if name.width > CAT_W - 40:
		name.scale = Vector2.ONE * ((CAT_W - 40) / name.width)
	if s != null and s.attempts > 0:
		PText.make(_grid, x + CAT_W - 8, y + CAT_H / 2, Js.num_str(s.box), TextStyles.numeral({
			"font_size": UiTheme.SIZES.body, "color": ink,
		})).set_origin(1, 0.5)
		var time := UiFormat.seconds_text(App.i18n, s.avg_ms) if s.correct > 0 else App.t("meta.mastery.noTime")
		var line := "%s · %s · %s" % [Js.num_str(s.attempts), UiFormat.percent_text(App.i18n, float(s.correct) / s.attempts), time]
		PText.make(_grid, x + 8, y + CAT_H - 12, line, TextStyles.numeral({"font_size": UiTheme.SIZES.small, "color": ink})).set_origin(0, 0.5)
	_cells.append({"item": {"kind": "category", "stat_id": stat_id, "category": category}, "x": x, "y": y, "w": CAT_W, "h": CAT_H})


func _pick_cell(px: float, py: float) -> void:
	var hit = null
	for c in _cells:
		if px >= c.x and px <= c.x + c.w and py >= c.y and py <= c.y + c.h:
			hit = c
			break
	if hit == null:
		return
	if UiButton.click_sound.is_valid():
		UiButton.click_sound.call()
	_selected = hit.item
	_draw_selection()
	_draw_detail()


func _draw_selection() -> void:
	var g := _selection
	g.clear()
	if _selected == null:
		return
	for cell in _cells:
		if cell.item.stat_id == _selected.stat_id:
			g.line_style(2, UiTheme.WHITE, 1)
			g.stroke_rect(cell.x - 2, cell.y - 2, cell.w + 4, cell.h + 4)
			return

# ------------------------------------------------------------------ detail and legend

func _draw_detail() -> void:
	var item = _selected
	if item == null:
		_detail.set_text("")
		return
	var solved: String = Facts.format_solved(item.fact, App.i18n.locale) if item.kind == "fact" else App.t("meta.category.%s" % item.category)
	var s = App.save.stats.get(item.stat_id)
	if s == null or s.attempts == 0:
		_detail.set_text(App.t("meta.mastery.notSeen", {"fact": solved}))
		return
	_detail.set_text(App.t("meta.mastery.detail", {
		"fact": solved,
		"attempts": s.attempts,
		"accuracy": UiFormat.percent_text(App.i18n, float(s.correct) / s.attempts),
		"time": UiFormat.seconds_text(App.i18n, s.avg_ms) if s.correct > 0 else App.t("meta.mastery.noTime"),
		"box": s.box,
		"when": _due_text(s.due_at),
	}))


func _due_text(due_at: float) -> String:
	var due := ReportLayout.relative_due(due_at, _now)
	if due.unit == "now":
		return App.t("meta.mastery.dueNow")
	var key := "meta.mastery.inMinutes" if due.unit == "minutes" else ("meta.mastery.inHours" if due.unit == "hours" else "meta.mastery.inDays")
	return App.tp(key, due.count)


func _draw_legend() -> void:
	var y := LEGEND_Y
	var x := LEFT
	var title := PText.make(self, x, y, App.t("meta.mastery.legendTitle").to_upper(), TextStyles.caps({
		"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM),
	}))
	title.set_origin(0, 0.5)
	x += title.width + UiTheme.SPACING.m
	var g := PGraphics.new()
	add_child(g)
	var sw := 22.0
	var sh := 18.0
	var items: Array = []
	for box in UiTheme.BOX_COLORS.size():
		items.append({"box": box, "text": App.t("meta.mastery.box.%d" % box)})
	items.append({"box": null, "text": App.t("meta.mastery.legendNew")})
	for item in items:
		if item.box == null:
			g.line_style(1, UiTheme.TEXT_DIM, 0.6)
			g.stroke_rect(x + 0.5, y - sh / 2 + 0.5, sw - 1, sh - 1)
		else:
			g.fill_style(UiTheme.BOX_COLORS[item.box], 0.88)
			g.fill_rect(x, y - sh / 2, sw, sh)
			PText.make(self, x + sw / 2, y, str(item.box), TextStyles.numeral({
				"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT) if item.box <= 1 else UiTheme.css(UiTheme.BG),
			})).set_origin(0.5)
		var label := PText.make(self, x + sw + 6, y, item.text, TextStyles.label({"font_size": UiTheme.SIZES.small}))
		label.set_origin(0, 0.5)
		x += sw + 6 + label.width + UiTheme.SPACING.m
