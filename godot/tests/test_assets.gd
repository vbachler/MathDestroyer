extends TestCase
## Port of tests/assets.test.ts


func test_every_texture_key_has_a_url_under_assets() -> void:
	var img := Assets.IMG
	var keys: Array = []
	keys.append_array(img.bg.values())
	keys.append_array(img.ui.values())
	keys.append_array(img.crawlers.values())
	keys.append_array(img.ships.values())
	keys.append_array(img.planets)
	keys.append_array(img.portraits.values())
	keys.append_array(img.icons.values())
	var urls := Assets.asset_urls()
	var sheets := Assets.sheet_urls()
	eq(Js.sorted_strings(urls.keys()), Js.sorted_strings(keys))
	eq(urls[img.icons.headStart], "assets/icons/headStart.jpg")
	eq(urls[img.ui.dash], "assets/ui/dash.png")
	eq(urls[img.bg.hangar], "assets/bg/bg_hangar.jpg")
	eq(urls[Assets.crawler_image_for("spider")], "assets/crawlers/spider.png")
	eq(sheets[Assets.crawler_walk_for("crab")], "assets/crawlers/crab_walk.png")
	eq(Js.sorted_strings(sheets.keys()), Js.sorted_strings(img.crawlerWalk.values()))
	eq(urls[img.ui.gunLeft], "assets/ui/gun_left.png")
	eq(urls[img.ui.gunRight], "assets/ui/gun_right.png")


func test_every_boarding_crawler_kind_has_a_still_and_a_walk_sheet() -> void:
	for kind in Boarding.CRAWLER_KINDS:
		eq(Assets.asset_urls()[Assets.crawler_image_for(kind)], "assets/crawlers/%s.png" % kind)
		eq(Assets.sheet_urls()[Assets.crawler_walk_for(kind)], "assets/crawlers/%s_walk.png" % kind)
	eq(Js.sorted_strings(Assets.IMG.crawlers.keys()), Js.sorted_strings(Array(Boarding.CRAWLER_KINDS)))


func test_planet_image_for_is_stable_and_uses_one_of_the_eight_pictures() -> void:
	var seen := {}
	for p in Content.planets():
		has(Assets.IMG.planets, Assets.planet_image_for(p.id))
		eq(Assets.planet_image_for(p.id), Assets.planet_image_for(p.id))
		seen[Assets.planet_image_for(p.id)] = true
	ge(seen.size(), 6)


func test_battle_bg_for_follows_sector_order_mod_3() -> void:
	var img := Assets.IMG
	var bgs := [img.bg.battleOcean, img.bg.battleDesert, img.bg.battleIce]
	for s in Content.sectors():
		var order: int = s.order
		for y in s.systems:
			for p in y.planets:
				eq(Assets.battle_bg_for(p.id), bgs[order % 3], p.id)
	eq(Assets.battle_bg_for("type-1.1"), img.bg.battleOcean)
	eq(Assets.battle_bg_for("type-2.1"), img.bg.battleDesert)
	eq(Assets.battle_bg_for("nope"), img.bg.battleOcean)


func test_enemy_image_for_cycles_by_id_icon_for_covers_every_upgrade_and_module() -> void:
	var ships: Dictionary = Assets.IMG.ships
	eq([1, 2, 3, 4].map(func(id): return Assets.enemy_image_for(id)),
		[ships.enemyB, ships.enemyC, ships.enemyA, ships.enemyB])
	var ids: Array = []
	for u in Upgrades.upgrades():
		ids.append(u.id)
	for m in Economy.modules():
		ids.append(m.id)
	for id in ids:
		eq(Assets.icon_for(id), "icon_%s" % id)


func test_voice_url_for_lists_the_locale_first_then_english() -> void:
	eq(Assets.voice_url_for("story.system.typing.text", "hr"), [
		"assets/voice/hr/story.system.typing.text.mp3", "assets/voice/hr/story.system.typing.text.wav",
		"assets/voice/en/story.system.typing.text.mp3", "assets/voice/en/story.system.typing.text.wav",
	])
	eq(Assets.voice_url_for("k", "en"), ["assets/voice/en/k.mp3", "assets/voice/en/k.wav"])
