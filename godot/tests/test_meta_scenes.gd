extends TestCase
## Smoke tests of the meta scenes (menu, settings, station, mastery, star map, upgrade): they build
## in the tree without engine errors and their main actions change the save like the TS scenes.
## The save is swapped for an in-memory one, so the user's save file is never touched.

var _saved_save: Dictionary
var _saved_storage


func _begin(save: Dictionary = {}) -> void:
	_saved_save = App.save
	_saved_storage = App.storage
	App.storage = Save.MemoryStorage.new()
	App.save = save if not save.is_empty() else Save.default_save()


func _end(node: Node) -> void:
	if node != null and is_instance_valid(node):
		node.get_parent().remove_child(node)
		node.free()
	App.save = _saved_save
	App.storage = _saved_storage


func _scene(name: String, data: Dictionary = {}) -> GameScene:
	var node: GameScene = load("res://scenes/%s.gd" % name).new()
	node.scene_name = name
	node.data = data
	Engine.get_main_loop().root.add_child(node)
	return node


func _find(node: Node, cls: Variant) -> Array:
	var out: Array = []
	for c in node.get_children():
		if is_instance_of(c, cls):
			out.append(c)
		out.append_array(_find(c, cls))
	return out


func test_menu_builds_three_buttons_and_the_language_switch() -> void:
	_begin()
	var s := _scene("menu")
	eq(_find(s, UiButton).size(), 5)
	_end(s)


func test_settings_change_speed_density_and_reset_progress() -> void:
	var save := Save.default_save()
	save.credits = 300
	_begin(save)
	var s = _scene("settings")
	s._update_settings({"game_speed": 0.75, "density": 1.25})
	eq(App.save.settings.game_speed, 0.75)
	eq(App.save.settings.density, 1.25)
	s._build_speed_buttons()
	eq(_find(s._speed_layer, UiButton).size(), 4)
	s._show_reset_confirm()
	eq(_find(s._reset_layer, UiButton).size(), 2)
	_find(s._reset_layer, UiButton)[0].click()
	eq(App.save.credits, 0)
	eq(App.save.settings.game_speed, 0.75)
	_end(s)


func test_station_buys_a_module_and_disables_unaffordable_cards() -> void:
	var save := Save.default_save()
	save.credits = 160
	_begin(save)
	var s = _scene("station")
	eq(s._cards.size(), 3)
	var hull: ImageCard = s._cards[0].card
	ok(hull.is_enabled())
	hull.click()
	eq(App.save.credits, 10)
	eq(App.save.modules.hull, 1)
	for entry in s._cards:
		if entry.card != hull:
			no(entry.card.is_enabled())
	ge(s._card_width(), 176.0)
	_end(s)


func test_mastery_shows_every_skill_and_selects_a_cell() -> void:
	var save := Save.default_save()
	var id: String = Facts.sector_stat_ids("add-5")[0]
	var st := Mastery.empty_stats()
	st.box = 3
	st.attempts = 4
	st.correct = 3
	st.avg_ms = 2500
	save.stats[id] = st
	_begin(save)
	var s = _scene("mastery", {"from": "star_map"})
	for skill in Content.skills():
		s._show_skill(skill)
		gt(s._pages.size(), 0)
	s._show_skill("addition")
	var cell: Dictionary = s._cells[0]
	s._pick_cell(cell.x + 1, cell.y + 1)
	eq(s._selected.stat_id, id)
	ne(s._detail.text, "")
	_end(s)


func test_star_map_opens_in_the_system_view_and_delivers_a_call() -> void:
	_begin()
	var s = _scene("star_map")
	eq(s.mode, "system")
	eq(s.system_view.system_id(), App.save.location.system_id)
	for i in 100:
		s.update(16)
	eq(s._pending.size(), 1)
	ok(s.card.is_open())
	s._enter_galaxy(false)
	eq(s.mode, "galaxy")
	s.galaxy.update(0, 16)
	var here: int = s.galaxy.system_index(App.save.location.system_id)
	eq(s.galaxy.hit_system(s.galaxy._scr_x[here], s.galaxy._scr_y[here]), here)
	var z: float = s.galaxy.view.zoom
	s._zoom_galaxy(1.25, 640, 360)
	close(s.galaxy.view.zoom, minf(z * 1.25, s.galaxy.max_zoom), 6)
	_end(s)


func test_upgrade_overlay_offers_cards_and_hands_events_on() -> void:
	_begin()
	var helper = load("res://tests/test_battle.gd").new()
	var sim := BattleSim.new(helper.cfg())
	helper.clear_wave(sim)
	eq(sim.state.phase, "waveCleared")
	var s = _scene("upgrade", {"sim": sim})
	eq(s._cards.size(), sim.offers().size())
	s._leave(func(): return sim.next_wave())
	eq(sim.state.phase, "spawning")
	_end(s)
