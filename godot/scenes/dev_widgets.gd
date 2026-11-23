extends GameScene
## Dev-only gallery (not in the TS game): every procedural texture and the shared ui widgets, for
## visual checks:  $GODOT --path godot -- --shot=dev_widgets --out=<png>


func create(_data: Dictionary) -> void:
	var keys: Array = Tex.TEX.values()
	for i in keys.size():
		var x := 40 + (i % 10) * 80
		var y := 40 + (i / 10) * 90
		var bg := PGraphics.new()
		bg.fill_style(0x203040, 1).fill_rect(x - 36, y - 36, 72, 72)
		add_child(bg)
		var img := PImage.make(self, x, y, keys[i])
		var t: Texture2D = img.texture
		var s := 64.0 / maxf(t.get_width(), t.get_height()) if t != null else 1.0
		img.scale = Vector2(s, s)
	var i18n := App.i18n
	UiToggle.new(self, 840, 40, true, {"on": i18n.t("common.yes"), "off": i18n.t("common.no")}, func(_v): pass)
	LevelControl.new(self, 840, 100, 0.6, {"decrease": "−", "increase": "+",
		"format": func(v): return UiFormat.percent_text(i18n, v)}, func(_v): pass)
	var gx := 860
	for draw in [MapGlyphs.draw_galaxy_glyph, MapGlyphs.draw_system_glyph, MapGlyphs.draw_hangar_glyph,
			MapGlyphs.draw_report_glyph, MapGlyphs.draw_menu_glyph]:
		GlyphButton.new(self, gx, 170, 36, draw, func(): pass)
		gx += 46
	var g := PGraphics.new()
	add_child(g)
	MapGlyphs.draw_static_sigil(g, 1110, 170, 30)
	MapGlyphs.draw_kind_glyph(g, "defend", 1150, 170, 20, MapGlyphs.kind_color("defend"))
	MapGlyphs.draw_kind_glyph(g, "liberate", 1180, 170, 20, UiTheme.PRIMARY)
	MapGlyphs.draw_kind_glyph(g, "patrol", 1210, 170, 20, UiTheme.PRIMARY)
	MapGlyphs.draw_call_blip(g, 1240, 170, 16, UiTheme.ACCENT)
	HudGlyphs.draw_credit_glyph(g, 860, 220, 16)
	HudGlyphs.draw_enter_glyph(g, 890, 220, 16)
	HudGlyphs.draw_right_arrow(g, 920, 220, 16)
	Glyphs.draw_ring(g, 960, 220, 14, 0.4, UiTheme.BAND_COLORS[2], 3)
	Glyphs.draw_bar(g, 990, 212, 120, 10, 0.65, UiTheme.OK)

	ImageCard.new(self, 140, 470, {"texture": Assets.icon_for("shield"), "name": i18n.t("battle.upgrade.shield.name"),
		"tier": 1, "highlight_next": true, "hotkey": "1"})
	ImageCard.new(self, 360, 480, {"texture": Assets.icon_for("hull"), "name": i18n.t("meta.module.hull.name"),
		"subtitle": i18n.t("meta.module.hull.desc"), "price": 150, "tier": 2}).set_enabled(false)
	Keypad.new(self, {"on_digit": func(_d): pass, "on_sign": func(): pass, "on_backspace": func(): pass,
		"on_fire": func(): pass}, {"fire_label": i18n.t("battle.fire") if i18n.t("battle.fire") != "battle.fire" else "fire",
		"digits": {"x": 500, "y": 560, "w": 240, "h": 140}, "fire": {"x": 1150, "y": 560, "w": 110, "h": 140}})
	var card := CallCard.new(self, func(): pass)
	card.open({"kind": "defend", "portrait": Assets.portrait_for("abacus"), "sender": i18n.t("story.sender.abacus"),
		"message": i18n.t("story.call.defend.1", {"planet": "Velora"}), "planet_texture": Assets.planet_image_for("add-5.1"),
		"planet_name": "Velora", "mastery": 0.4, "mastery_text": UiFormat.percent_text(i18n, 0.4),
		"mastery_color": UiTheme.BAND_COLORS[2], "go_label": i18n.t("common.start"), "voice_urls": [], "volume": 0},
		{"x": 880, "y": 330, "w": 360, "h": 150})
	card.complete_typing()
