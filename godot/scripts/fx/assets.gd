class_name Assets
## Port of src/fx/assets.ts plus the texture registry (Phaser's texture manager).
## Every IMG value is a texture key. Images listed in res://assets/manifest.json are loaded at boot
## (Assets.request_all / poll_loading, driven by the boot scene); a missing file is skipped with one
## warning. Procedural textures (Tex, textures.gd) register here too. Scenes call
## Assets.has_image(key) and fall back when it is false; Assets.texture(key) returns the Texture2D.

const IMG := {
	"bg": {
		"battleOcean": "bg_battle_ocean",
		"battleDesert": "bg_battle_desert",
		"battleIce": "bg_battle_ice",
		"menu": "bg_menu",
		"starmap": "bg_starmap",
		"bridge": "bg_bridge",
		"ftl": "bg_ftl",
		"station": "station_shop_bg",
		"hangar": "bg_hangar",
	},
	"ui": {
		"dash": "ui_dash",
		"gunLeft": "ui_gun_left",
		"gunRight": "ui_gun_right",
	},
	"crawlers": {
		"scorpion": "crawler_scorpion",
		"spider": "crawler_spider",
		"crab": "crawler_crab",
		"beetle": "crawler_beetle",
		"stalker": "crawler_stalker",
		"drifter": "crawler_drifter",
		"wraith": "crawler_wraith",
	},
	"crawlerWalk": {
		"scorpion": "crawler_scorpion_walk",
		"spider": "crawler_spider_walk",
		"crab": "crawler_crab_walk",
		"beetle": "crawler_beetle_walk",
		"stalker": "crawler_stalker_walk",
		"drifter": "crawler_drifter_walk",
		"wraith": "crawler_wraith_walk",
	},
	"ships": {
		"enemyA": "ship_enemy_a",
		"enemyB": "ship_enemy_b",
		"enemyC": "ship_enemy_c",
		"player": "ship_player",
		"station": "station_orbital",
	},
	"planets": ["planet_1", "planet_2", "planet_3", "planet_4", "planet_5", "planet_6", "planet_7", "planet_8"],
	"portraits": {
		"tarrow": "portrait_tarrow",
		"kito": "portrait_kito",
		"abacus": "portrait_abacus",
	},
	"icons": {
		"slowField": "icon_slowField",
		"autoTurret": "icon_autoTurret",
		"overcharge": "icon_overcharge",
		"salvage": "icon_salvage",
		"repairDrone": "icon_repairDrone",
		"shield": "icon_shield",
		"hull": "icon_hull",
		"targeting": "icon_targeting",
		"headStart": "icon_headStart",
	},
}

## Walk-cycle sheet geometry (tools/process-art.mjs): 4x4 cells of 256 px, 16 frames.
const WALK_FRAMES := 16
const WALK_CELL := 256
const MANIFEST_URL := "assets/manifest.json"

static var _textures := {}
static var _asset_urls := {}
static var _sheet_urls := {}
## Loading state: res path -> key, for the threaded requests made by request_all().
static var _pending := {}
static var _requested := 0


## Texture key -> URL relative to the game root ("assets/bg/bg_menu.jpg"); res path = "res://" + URL.
static func asset_urls() -> Dictionary:
	if _asset_urls.is_empty():
		for k in IMG.bg.values():
			_asset_urls[k] = "assets/bg/%s.jpg" % k
		_asset_urls[IMG.ui.dash] = "assets/ui/dash.png"
		_asset_urls[IMG.ui.gunLeft] = "assets/ui/gun_left.png"
		_asset_urls[IMG.ui.gunRight] = "assets/ui/gun_right.png"
		for kind in IMG.crawlers.keys():
			_asset_urls[IMG.crawlers[kind]] = "assets/crawlers/%s.png" % kind
		for k in IMG.ships.values():
			_asset_urls[k] = "assets/ships/%s.png" % k
		for k in IMG.planets:
			_asset_urls[k] = "assets/planets/%s.png" % k
		for k in IMG.portraits.values():
			_asset_urls[k] = "assets/portraits/%s.jpg" % k
		for id in IMG.icons.keys():
			_asset_urls[IMG.icons[id]] = "assets/icons/%s.jpg" % id
	return _asset_urls


## Spritesheet texture key -> URL (WALK_CELL frames).
static func sheet_urls() -> Dictionary:
	if _sheet_urls.is_empty():
		for kind in IMG.crawlerWalk.keys():
			_sheet_urls[IMG.crawlerWalk[kind]] = "assets/crawlers/%s_walk.png" % kind
	return _sheet_urls


# ---------------------------------------------------------------- texture registry

## True when the texture exists (loaded image or generated texture).
static func has_image(key: String) -> bool:
	return _textures.has(key) or Tex.ensure(key)


## The texture of a key, or null. Procedural keys (Tex) are generated on first use.
static func texture(key: String) -> Texture2D:
	if not _textures.has(key):
		Tex.ensure(key)
	return _textures.get(key)


static func add_texture(key: String, tex: Texture2D) -> void:
	if tex != null:
		_textures[key] = tex


## One frame of a spritesheet (WALK_CELL cells, row-major), or null when the sheet is missing.
static func sheet_frame(key: String, frame: int) -> Texture2D:
	var tex := texture(key)
	if tex == null:
		return null
	var cols := maxi(1, tex.get_width() / WALK_CELL)
	var at := AtlasTexture.new()
	at.atlas = tex
	at.region = Rect2((frame % cols) * WALK_CELL, (frame / cols) * WALK_CELL, WALK_CELL, WALK_CELL)
	return at


## Queues every image listed in the manifest for threaded loading. Returns the number queued.
static func request_all() -> int:
	_pending.clear()
	var url_to_key := {}
	for k in asset_urls().keys():
		url_to_key[asset_urls()[k]] = k
	for k in sheet_urls().keys():
		url_to_key[sheet_urls()[k]] = k
	var manifest = Save.parse_json(FileAccess.get_file_as_string("res://" + MANIFEST_URL))
	var images: Array = manifest.images if manifest is Dictionary and manifest.get("images") is Array else []
	for url in images:
		var key = url_to_key.get(url)
		if key == null or has_image(key):
			continue
		var path: String = "res://" + url
		if not ResourceLoader.exists(path):
			continue
		if ResourceLoader.load_threaded_request(path, "Texture2D") == OK:
			_pending[path] = key
	_requested = _pending.size()
	return _requested


## Advances the threaded loads; returns progress 0..1 (1 = done). Warns once about missing images.
static func poll_loading() -> float:
	if _requested == 0:
		_warn_missing()
		return 1.0
	var done := 0
	var fraction := 0.0
	for path in _pending.keys():
		var progress := []
		var st := ResourceLoader.load_threaded_get_status(path, progress)
		if st == ResourceLoader.THREAD_LOAD_LOADED:
			add_texture(_pending[path], ResourceLoader.load_threaded_get(path))
			_pending.erase(path)
			done += 1
		elif st == ResourceLoader.THREAD_LOAD_FAILED or st == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			_pending.erase(path)
		elif progress.size() > 0:
			fraction += float(progress[0])
	var finished := _requested - _pending.size()
	if _pending.is_empty():
		_requested = 0
		_warn_missing()
		return 1.0
	return (finished + fraction) / float(_requested)


## Loads every listed image synchronously (tools, tests, the screenshot hook when no boot runs).
static func load_all_now() -> void:
	request_all()
	while poll_loading() < 1.0:
		OS.delay_msec(5)


static func _warn_missing() -> void:
	var missing: Array = []
	for k in asset_urls().keys() + sheet_urls().keys():
		if not has_image(k):
			missing.append(k)
	if missing.size() > 0:
		push_warning("[assets] %d image(s) missing, scenes will use fallbacks: %s" % [missing.size(), ", ".join(missing)])


# ---------------------------------------------------------------- helpers (assets.ts)

## One of the eight planet pictures, stable for a planet id.
static func planet_image_for(planet_id: String) -> String:
	return IMG.planets[Names.stable_hash(planet_id) % IMG.planets.size()]


## Battle background for the planet's sector: sector order % 3 (ocean, desert, ice).
static func battle_bg_for(planet_id: String) -> String:
	var bgs := [IMG.bg.battleOcean, IMG.bg.battleDesert, IMG.bg.battleIce]
	var sector = Content.sector_of_planet(planet_id)
	var order: int = sector.order if sector != null else 0
	return bgs[order % bgs.size()]


## Enemy hull by enemy id % 3.
static func enemy_image_for(enemy_id: int) -> String:
	var ships := [IMG.ships.enemyA, IMG.ships.enemyB, IMG.ships.enemyC]
	return ships[((enemy_id % ships.size()) + ships.size()) % ships.size()]


## Image of a boarding crawler kind (check has_image; fall back to Tex.CRAWLER_FALLBACK).
static func crawler_image_for(kind: String) -> String:
	return IMG.crawlers[kind]


## Walk-cycle spritesheet of a crawler kind (check has_image; fall back to the still).
static func crawler_walk_for(kind: String) -> String:
	return IMG.crawlerWalk[kind]


## Card picture for an upgrade or station module id (falls back to the shield icon).
static func icon_for(id: String) -> String:
	return IMG.icons.get(id, IMG.icons.shield)


## Portrait texture key of a story sender.
static func portrait_for(sender: String) -> String:
	return IMG.portraits[sender]


## Candidate URLs of the voice clip for a story message, in fallback order: the locale's .mp3
## then .wav, then English (relative URLs like the TS; prefix "res://" to load).
static func voice_url_for(story_key: String, locale: String) -> Array:
	var langs := ["en"] if locale == "en" else [locale, "en"]
	var out: Array = []
	for l in langs:
		out.append("assets/voice/%s/%s.mp3" % [l, story_key])
		out.append("assets/voice/%s/%s.wav" % [l, story_key])
	return out
