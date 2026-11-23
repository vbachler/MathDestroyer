extends GameScene
## Port of src/scenes/ResultsScene.ts: mission result over the dimmed battle background: outcome in
## two words, four numbers, the planet's level ring animating before -> after, missed facts as a
## compact grid of solved facts, one story line and two small buttons (retry, map). Enter or
## Space = map. Data (TS ResultsSceneData, snake_case): {planet_id, won, score, credits, missed,
## accuracy, best_streak, mastery_before, mastery_after}.

const CX := UiTheme.GAME_WIDTH / 2.0
const H := UiTheme.GAME_HEIGHT
const OUTCOME_Y := 118.0
const STATS_Y := 214.0
const STAT_SPACING := 180.0
const RING_Y := 352.0
const RING_R := 44.0
const GRID_Y := 448.0
const CELL_W := 150.0
const CELL_H := 30.0
const CELL_GAP := 8.0
const GRID_COLS := 5
const GRID_MAX := 10
const STORY_Y := 572.0
const BUTTONS_Y := 640.0

var _starfield: Starfield = null
var _to_map_done := false


## Planet level as "level / 5" for a mastery fraction.
static func level_text(mastery: float) -> String:
	return "%d / %d" % [Js.round(mastery * Mastery.MAX_PLANET_LEVEL), Mastery.MAX_PLANET_LEVEL]


func create(d: Dictionary) -> void:
	Sfx.start_ambience("map")
	RenderingServer.set_default_clear_color(UiTheme.color(UiTheme.BG))
	var planet_id := str(d.get("planet_id", d.get("planetId", "")))
	var won: bool = d.get("won", false)
	var bg_key := Assets.battle_bg_for(planet_id)
	if Assets.has_image(bg_key):
		var img := PImage.make(self, CX, H / 2.0, bg_key)
		img.scale = Vector2.ONE * (maxf(UiTheme.GAME_WIDTH / float(img.texture.get_width()), H / float(img.texture.get_height())) * 1.08)
	else:
		_starfield = Starfield.new(self, {"speed": 0.1})
	var dim := ColorRect.new()
	dim.size = Vector2(UiTheme.GAME_WIDTH, H)
	dim.color = UiTheme.color(UiTheme.BG, 0.72)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)

	var outcome := UiTheme.OK if won else UiTheme.DANGER
	PText.make(self, CX, OUTCOME_Y, App.t("battle.results.victory" if won else "battle.results.defeat").to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.title, "color": UiTheme.css(outcome),
			"letter_spacing": UiTheme.LETTER_SPACING.wide})).set_origin(0.5)
	var rule := PGraphics.new()
	add_child(rule)
	rule.line_style(UiTheme.LINE_WIDTH, outcome, 0.5)
	rule.line_between(CX - 160, OUTCOME_Y + 30.5, CX + 160, OUTCOME_Y + 30.5)

	_build_stats(d)
	_build_mastery(d)
	_build_missed(d.get("missed", []))

	var story := PText.make(self, CX, STORY_Y, App.t("story.result.win" if won else "story.result.lose"),
		TextStyles.body({"color": UiTheme.css(UiTheme.TEXT_DIM), "font_style": "italic", "align": "center"}))
	story.set_origin(0.5)
	# Rajdhani has no italic face: the browser slants it (synthetic oblique, x skew 1/4); same here.
	story.skew = atan(0.25)

	var retry := func() -> void: App.goto("battle", {"planet_id": planet_id})
	UiButton.new(self, CX - 92, BUTTONS_Y, App.t("battle.results.retry"), retry, {"width": 160, "height": 36, "variant": "ghost"})
	UiButton.new(self, CX + 92, BUTTONS_Y, App.t("battle.results.starMap"), _to_map, {"width": 160, "height": 36})


func update(delta_ms: float) -> void:
	if _starfield != null:
		_starfield.update(delta_ms)


## Enter or Space: to the map (once, like Phaser keyboard.once).
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo \
			and (event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER or event.keycode == KEY_SPACE):
		get_viewport().set_input_as_handled()
		_to_map()


func _to_map() -> void:
	if _to_map_done:
		return
	_to_map_done = true
	App.goto("star_map")


func _build_stats(d: Dictionary) -> void:
	var stats := [
		[App.t("battle.results.score"), str(d.get("score", 0)), UiTheme.css(UiTheme.TEXT)],
		[App.t("battle.results.accuracy"), UiFormat.percent_text(App.i18n, d.get("accuracy", 1.0)), UiTheme.css(UiTheme.TEXT)],
		[App.t("battle.results.bestStreak"), str(d.get("best_streak", 0)), UiTheme.css(UiTheme.TEXT)],
		[App.t("battle.results.credits"), "+%s" % str(d.get("credits", 0)), UiTheme.css(UiTheme.PRIMARY)],
	]
	var x0 := CX - (STAT_SPACING * (stats.size() - 1)) / 2.0
	for i in stats.size():
		var x := x0 + i * STAT_SPACING
		PText.make(self, x, STATS_Y, stats[i][1], TextStyles.numeral({"font_size": UiTheme.SIZES.title, "color": stats[i][2]})).set_origin(0.5)
		PText.make(self, x, STATS_Y + 30, stats[i][0].to_upper(),
			TextStyles.caps({"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM)})).set_origin(0.5, 0)


## Planet level ring from before to after (animated), a tick where it stood before, and the two levels.
func _build_mastery(d: Dictionary) -> void:
	var before: float = d.get("mastery_before", 0.0)
	var after: float = d.get("mastery_after", 0.0)
	var g := PGraphics.new()
	add_child(g)
	var tick := PGraphics.new()
	add_child(tick)
	var angle := -PI / 2 + PI * 2 * minf(1.0, maxf(0.0, before))
	tick.line_style(2, UiTheme.TEXT, 1)
	tick.line_between(CX + cos(angle) * (RING_R - 7), RING_Y + sin(angle) * (RING_R - 7),
		CX + cos(angle) * (RING_R + 7), RING_Y + sin(angle) * (RING_R + 7))
	var value := PText.make(self, CX, RING_Y, "", TextStyles.numeral({"font_size": UiTheme.SIZES.heading}))
	value.set_origin(0.5)
	# "before ->" left of the ring; the ring and its centre number animate to "after".
	PText.make(self, CX - RING_R - 40, RING_Y, level_text(before),
		TextStyles.numeral({"font_size": UiTheme.SIZES.body, "color": UiTheme.css(UiTheme.TEXT_DIM)})).set_origin(1, 0.5)
	PText.make(self, CX - RING_R - 22, RING_Y, "→",
		TextStyles.numeral({"font_size": UiTheme.SIZES.body, "color": UiTheme.css(UiTheme.TEXT_DIM)})).set_origin(0.5)
	PText.make(self, CX, RING_Y + RING_R + 14, App.t("battle.results.level").to_upper(),
		TextStyles.caps({"font_size": UiTheme.SIZES.small, "color": UiTheme.css(UiTheme.TEXT_DIM)})).set_origin(0.5, 0)

	var draw := func(v: float) -> void:
		g.clear()
		Glyphs.draw_ring(g, CX, RING_Y, RING_R, v, UiTheme.BAND_COLORS[Mastery.mastery_band(v)], 3)
		value.set_text(level_text(v))
	draw.call(before)
	var tw := create_tween()
	tw.tween_interval(0.5)
	tw.tween_method(draw, before, after, 1.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tw.tween_callback(func() -> void: draw.call(after))


## Up to ten solved facts in a 5-column grid; more are summarised as "+N"; none -> one check glyph.
func _build_missed(missed: Array) -> void:
	if missed.is_empty():
		var g := PGraphics.new()
		add_child(g)
		g.line_style(2, UiTheme.OK, 0.9)
		g.begin_path()
		g.move_to(CX - 12, GRID_Y + 18)
		g.line_to(CX - 3, GRID_Y + 27)
		g.line_to(CX + 14, GRID_Y + 8)
		g.stroke_path()
		return
	var overflow := missed.size() > GRID_MAX
	var shown: Array = missed.slice(0, GRID_MAX - 1) if overflow else missed
	var cells := shown.size() + (1 if overflow else 0)
	var cols := mini(GRID_COLS, cells)
	var grid_w := cols * CELL_W + (cols - 1) * CELL_GAP
	var x0 := CX - grid_w / 2.0
	for i in shown.size():
		_cell(x0, i, Facts.format_solved(shown[i], App.i18n.locale), UiTheme.css(UiTheme.TEXT))
	if overflow:
		_cell(x0, shown.size(), "+%d" % (missed.size() - shown.size()), UiTheme.css(UiTheme.TEXT_DIM))


func _cell(x0: float, i: int, text: String, color: String) -> void:
	var x := x0 + (i % GRID_COLS) * (CELL_W + CELL_GAP)
	var y := GRID_Y + (i / GRID_COLS) * (CELL_H + CELL_GAP)
	var g := PGraphics.new()
	add_child(g)
	g.fill_style(UiTheme.PLATE, 0.75)
	g.fill_rect(x, y, CELL_W, CELL_H)
	g.line_style(UiTheme.LINE_WIDTH, UiTheme.PRIMARY_DIM, 0.8)
	g.stroke_rect(x, y, CELL_W, CELL_H)
	PText.make(self, x + CELL_W / 2.0, y + CELL_H / 2.0, text, TextStyles.numeral({"font_size": UiTheme.SIZES.body, "color": color})).set_origin(0.5)


func shutdown() -> void:
	if _starfield != null:
		_starfield.destroy()
	_starfield = null
