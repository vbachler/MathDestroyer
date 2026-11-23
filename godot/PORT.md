# MathDestroyer: Godot port

Port of the Phaser/TypeScript game (repo root) to **Godot 4.7.2, GDScript**. Same rules, same layout,
same images, same sound, same texts, same save shape. The TypeScript game stays the reference and keeps
working; nothing under `src/` changes for the port (except dev-only tooling hooks if unavoidable).

Godot: `C:\Users\Vladimir\AppData\Local\Microsoft\WinGet\Packages\GodotEngine.GodotEngine_Microsoft.Winget.Source_8wekyb3d8bbwe\Godot_v4.7.2-stable_win64_console.exe`
(called `$GODOT` below). Godot docs for 4.7 when unsure; do not rely on Godot 3 API.

## Layout of `godot/`

```
godot/
  project.godot            1280x720, stretch mode canvas_items, aspect keep, bg #<COLORS.bg>
  assets/                  COPY of public/assets (same relative paths) — written by tools/godot-sync.mjs
  assets/audio/            rendered sound (tools/render-audio.mjs), see Audio
  fonts/                   Rajdhani 400/500/600/700, Share Tech Mono 400 (woff2 from node_modules/@fontsource)
  locales/                 COPY of src/locales (hr, en)
  scripts/core/            1:1 port of src/core/*.ts (pure: no Node, no scene tree; RefCounted / static funcs)
  scripts/app.gd           autoload "App": save, i18n, settings, persist(), now_ms()  (port of src/app.ts)
  scripts/audio/sfx.gd     autoload "Sfx": same public API as src/audio/Sfx.ts in snake_case
  scripts/ui/              port of src/ui/* widgets (theme, text styles, Button, Panel, Keypad, CallCard, ...)
  scripts/fx/              port of src/fx/*
  scenes/                  one script per Phaser scene, built in code (Node2D root): boot, menu, star_map,
                           station, mastery, settings, ftl, battle, upgrade, boarding, results
  tests/                   headless test runner: `$GODOT --headless --path godot -s res://tests/run_tests.gd`
                           exit code 0 = all pass
```

## Rules of the port

1. **Same numbers.** Every constant, formula, layout coordinate, colour, font size, tween duration and
   probability is copied from the TS source. 1 Phaser px = 1 Godot px (both 1280x720, origin top-left).
   Phaser origin 0.5 on images = Godot `Sprite2D.centered = true`.
2. **Same randomness.** `src/core/rng.ts` is ported bit-exact (32-bit integer math with `& 0xFFFFFFFF`,
   GDScript ints are 64-bit). A port test checks the first values of a seed against the TS output.
3. **Core is pure.** `scripts/core/` uses only GDScript builtins; time is passed in (ms), never read.
   Data objects are `Dictionary`/small classes; keep the TS field names in snake_case.
4. **Same save.** Same JSON shape and field names as `src/core/save.ts` (camelCase keys stay camelCase in
   the JSON so a save file is interchangeable), written to `user://mathdestroyer.save.v1.json`.
5. **Same texts.** `App.t(key, params)` reads the merged locale JSON exactly like `src/core/i18n.ts`
   (same interpolation and plural rules). Default locale `hr`.
6. **Scenes.** `App.goto(scene_name, data := {})` replaces the current scene (Phaser `scene.start`);
   overlay scenes (Phaser `scene.launch`, e.g. Boarding over Battle) are added as children with the same
   data. Phaser tweens → Godot `Tween` with the same durations and matching easing.
   Phaser Graphics drawing → `_draw()` / `Line2D` / `Polygon2D`; Phaser blend ADD → `CanvasItemMaterial`
   blend add. Procedural textures in `src/fx/textures.ts` → generated `ImageTexture`s at boot (same pixels).
7. **Input.** Same keys (`src/ui/keymap.ts`), same on-screen keypad and pointer/touch behaviour.
8. **Tests.** Port the logic tests of `tests/*.test.ts` that cover `src/core` (and pure layout helpers in
   `src/fx/*Layout.ts`, `src/ui/*` pure files) to `godot/tests/`. Same cases, same expected values.
9. Verification of visuals: run the game windowed with `--` user args, e.g.
   `$GODOT --path godot -- --shot=battle --out=C:/.../shot.png` — a dev hook in `App` that starts the
   named scene, steps it, saves `get_viewport().get_texture().get_image()` to PNG and quits. Compare with
   the Phaser game (dev server `npm run dev`, port 5173) side by side.

## Audio

The TS game synthesises all sound with WebAudio. The port uses **the same synth rendered offline**:
`tools/render-audio.mjs` runs `src/audio/Sfx.ts` in Node with `node-web-audio-api`'s
`OfflineAudioContext` (Sfx already accepts `{ context }`) and writes:

- `assets/audio/sfx/<method>_<n>.wav` — every one-shot method (laser, hit, miss, wrong, ...), several
  variants each because the synth randomises; reverb tail included (rendered through the full fx graph).
  Parameterised methods (`skitter(level)`, `screech(level)`, `alienChatter(dur, level)`, `sparkCrackle`,
  `ftlCharge(durationSec)`) are rendered at the levels/durations the game uses.
- `assets/audio/ambience/<kind>.ogg|wav` — `menu`, `map`, `battle` beds, tension layer(s), hangar bed:
  long seamless loops (crossfaded loop point).
- `assets/audio/manifest.json` — sound name → files, gain, priority (Ui/Normal/Weapon).

`scripts/audio/sfx.gd` (autoload `Sfx`) mirrors the TS API (`laser()`, `hit()`, `start_ambience(kind)`,
`stop_ambience(fade)`, `set_tension(level)`, `start_hangar()`, `spark_crackle(level)`, `set_volume`, ...):
random variant per call, same voice limits (MAX_VOICES 10, HARD_MAX 16, priority), buses `SFX` and
`Music` with the same volume mapping, limiter on Master, same fades.

## Audio (as built)

**Render** (`npm run audio:render`, ~1 min; `-- laser hit` renders only those names, `-- --wav` writes
one-shots as WAV). `tools/render-audio.mjs` (+ `tools/audio-util.mjs`) loads the real `src/audio/*.ts`
in Node (type stripping + a resolve hook for extensionless imports; node-web-audio-api classes exposed as
globals for the synth's `instanceof` checks) and renders each call into a fresh `OfflineAudioContext`
(48 kHz stereo) through the whole `Sfx` graph: dry + 3.2 s hull reverb + limiter (with its make-up gain)
+ 0.85. Timers in the synth are stubbed; events, the volume poll and tension ticks are driven by the
script (tension: `tick()` against a fake clock, all automation scheduled before rendering).
node-web-audio-api has every node the synth uses; nothing needed a workaround.

Output (`godot/assets/audio/`, ~11 MB):
- `sfx/<name>_<n>.ogg` — 202 one-shots (Ogg Vorbis q6, trailing silence below -72 dBFS trimmed, reverb
  tail kept, the 5 ms TS start offset kept). Ogg, not WAV: as 16-bit WAV the set is ~104 MB.
  3-8 variants per sound. Parameterised: `alien_chatter` at 1.0-2.5 s (8 durations), `ftl_charge` at
  1.5 and 2 s (StarMap / FTL), `skitter` at levels 0.15/0.35/0.55/0.75/1 (content changes with level),
  `laser_rapid` (the quieter shot within 0.15 s). `screech`, `spark_crackle`, `alien_chatter` are rendered
  at level 1 and scaled linearly (all far below the limiter). Ambience events as one-shots:
  `amb_chatter|creak|alien_call|sonar` (battle/map beds), `hangar_creak|groan|thud|drip|far_screech`.
- `ambience/*.ogg` (q4) — `bed_menu|map|battle` (~64.5 s), `hangar_bed` (~69 s; drone only, events
  separate), `tension_010 ... tension_100` (constant tension 0.1/0.25/0.4/0.55/0.7/0.85/1, an even number
  of beats, >= 8 s). Steady state (rendered past the fade-in), loop point cross-faded (3 s for beds, at the
  best-correlating length near a whole number of LFO cycles; 0.25 s beat-aligned for tension).
- `manifest.json` — `sounds`: name -> `files`, `params`, `voice_sec` (until the last synth source stops =
  how long the TS counts the voice), `gain`, `priority` (0 Ui / 1 Normal / 2 Weapon), `bus`; `loops`:
  name -> `file`, `gain`, `level` (tension); `render` (sfx volume 0.8, music volume 1),
  `limiter_ceiling_db` (loudest single rendered sound).
- `gain` = a loudness trim to Chrome (`CHROME_TRIM_DB` in the script): the same seeded renders in Chrome
  and in node-web-audio-api differ by -2.6..+0.6 dB RMS (node's sawtooth is a bit louder in the low
  harmonics: `upgrade` -2.6, `laser`/`ftl_charge`/creaks ~-1; compressor make-up ~0.3 dB lower).
  Beds match within 0.3 dB.

**Playback** (`scripts/audio/sfx.gd`, autoload `Sfx`): all TS public methods in snake_case, plus
`configure(volume, music_volume)` = the TS constructor arguments; App must call it with the save, e.g.
`Sfx.configure(save.settings.sfxVolume, func(): return save.settings.musicVolume)` (safe before Sfx is
ready). `alien_chatter(null, 0.4)` = TS `alienChatter(undefined, 0.4)`.
- Buses `SFX` / `Music` created if missing; `AudioEffectHardLimiter` on Master at `limiter_ceiling_db`
  (one sound is already limited in its file; layered sounds are held to the same ceiling).
  SFX bus gain = volume / 0.8 (tau 0.02 s); Music bus gain = music volume, polled every 0.4 s while a bed
  or the hangar plays (tau 0.1 s), read at once when one starts. Volume 0 = no new one-shots (TS).
- Voices: random variant (no immediate repeat), counted for `voice_sec`; >= 10 only Weapon starts,
  >= 16 nothing. Pool of 28 SFX players (tails), 12 Music players (events). `miss()` -> chatter 0.4 s
  later (rnd 1-1.6 s, level 0.45). `ftl_charge` / `ftl_drop` fade the running charge (0.05 / 0.08 s).
- Beds: 3.5 s linear fade-in, 2.5 s cross-fade, `stop_ambience(fade)`; events battle 8-20 s (first
  >= 5.6 s: 1/3 chatter at 0.6-1, 2/9 creak, 2/9 alien call, 2/9 sonar), map 18-35 s sonar; they play on
  the Music bus outside the bed gain, like the TS. Hangar: 2.5 s fade-in, events with the TS intervals
  (hull 4-12 s, 55 % creak else groan; thud 9-22; drip 2.5-7.5; screech 28-55), all under the hangar
  gain so `stop_hangar(fade)` fades them too.
- Tension: level smoothed with tau 0.4 s as in the TS; the two loops around it are cross-faded
  linearly (below 0.1 the 0.1 loop scales with level, silent below 0.04); tension fades with the bed.
- Not done here: `crackle_gate` (rationing of `spark_crackle`) belongs to the boarding scene, as in TS
  (`src/fx/boardingLayout.ts`: chance 0.22, >= 1500 ms apart).

**Differences from the TS** (all small): tension at a level between two rendered levels is two tempos
cross-faded rather than one tempo (audible as a doubled beat only while the level moves); a cut FTL
charge loses its reverb tail (TS keeps the tail already in the reverb); the reverb of bed/tension does
not pass the bed fade-in; timbre of node-web-audio-api's band-limited saw/square differs slightly from
Chrome's (loudness trimmed, not spectrum); `alien_chatter` / `amb_chatter` sound different per call in
both, but are not the same phrases as the browser would make.

**Check:** `$GODOT --headless --path godot --import` (after a render), then
`$GODOT --headless --path godot -s res://tests/audio_check.gd` — loads the manifest and every file, calls
every Sfx method (ambience cross-fade, tension, hangar with forced events, FTL cut, voice priorities);
fails on any engine error or warning. **Export:** `assets/audio/manifest.json` is not a resource; the
export preset's include filter needs `*.json`. On the Web export (sample playback) bus effects do not
apply: the Master limiter would need `playback_type = Stream` on the players.

## Foundation API

**Data sync.** `npm run godot:sync` (tools/godot-sync.mjs) copies `public/assets` -> `assets/` (never touches
`assets/audio`), `src/locales` -> `locales/`, and the Rajdhani 400-700 / Share Tech Mono woff2 files -> `fonts/`.
Run it after changing art or texts. Export presets need `*.json` in the include filter (locales, manifests).

**Core (`scripts/core/`).** One `class_name` per TS module, static functions, TS names in snake_case:
`Rng` (`Rng.new(seed)`, `next()`, `next_int(min, max)` = TS `int`, `pick`, `shuffle`), `Js` (JS number
semantics: `Js.round` = Math.round, `Js.sorted(arr, cmp)` stable sort, `Js.num_str` = String(n), `Js.hypot`,
`Js.imul`), `FactGen`, `Facts`, `Content`, `Layout`, `Names`, `Galaxy`, `Mastery`, `Scheduler`, `Economy`,
`Upgrades`, `Story`, `I18n`, `Save`, `Battle` (constants) + `BattleSim` (class), `Boarding` + `BoardingSim`,
`CoreTypes` (shape docs). Computed TS constants are functions: `Content.sectors()`, `systems()`,
`planets()`, `skills()`, `Economy.modules()`, `Upgrades.upgrades()`, `Assets.asset_urls()`.
Data objects are Dictionaries with snake_case keys (`fact.stat_id`, `enemy.spawned_at`, `event.dome_index`);
string values stay as in TS (phases `"waveCleared"`, events `"shipHit"`, ids `"autoTurret"`). TS
`undefined` -> `null`; TS `throw` -> `push_error` + `null`. Sets are Dictionaries `{id: true}`.
GDScript traps: int/int truncates (core divides with floats), `%` is int-only (`fmod`), `String == int` is
a runtime error, `:=` cannot infer a type from a Dictionary access. `test_port_fixtures.gd` replays the TS
galaxy, pools, scheduler, a battle and a boarding bit for bit (fixtures from
`tools/godot-fixtures.gen.ts.txt`; regenerate them when `src/core` changes).

**Save.** `App.save` is snake_case in memory (`settings.sfx_volume`, `totals.best_score`,
`location.sector_id`, stats `{box, attempts, correct, avg_ms, last_seen, due_at}`); `Save.serialize` /
`Save.migrate` convert to / from the TS camelCase JSON, so `user://mathdestroyer.save.v1.json` holds exactly
the browser game's localStorage value. Change it like the TS (`App.save = Save.apply_mission(App.save, ...)`)
and call `App.persist()`.

**Autoload `App`** (scripts/app.gd, port of src/app.ts): `save`, `i18n` (`I18n` over the merged locale
files), `t(key, params)`, `tp(key, count, params)`, `persist()`, `now_ms()`, `set_locale(l)`.
Scenes: `goto(name, data)` (Phaser `scene.start`: replaces the current scene at the end of the frame, stops
overlays), `launch(name, data)` / `stop(name)` (Phaser `scene.launch` / `stop`: overlay above the current
scene), `pause_scene(name)` / `resume_scene(name)`, `scene(name)`. Names are registered in `App.SCENES`
(boot, menu, star_map, station, mastery, settings, ftl, battle, upgrade, boarding, results, plus
dev_widgets, a gallery of the procedural textures and widgets). **Autoload `Sfx`**: see Audio.

**Writing a scene.** `scenes/<name>.gd` `extends GameScene` (scripts/game_scene.gd, a Node2D): override
`create(data)` (Phaser `create`, runs once in the tree), `update(delta_ms)` (every frame unless paused) and
`shutdown()` (scene replaced / stopped). Build everything in code; 1 Phaser px = 1 px; Phaser `setDepth` ->
`z_index` (`UiTheme.DEPTH`). Input: widgets use `HitArea` (a Control: signals `over`, `out`, `down`,
`up(inside, was_touch)`); scene-wide keys in `_unhandled_input`, mapped with
`Keymap.key_action(Keymap.from_event(event))`. Boot (`scenes/boot.tscn` + `boot.gd`, the main scene) loads
the images with a progress bar, generates the textures, calls `Sfx.configure(...)`, sets
`UiButton.click_sound`, then `App.goto("menu")`. `scenes/menu.gd` is a PLACEHOLDER (title + one button).

**Phaser object equivalents (`scripts/ui/`).**
- `PGraphics` (Node2D) = Graphics: `fill_style`, `line_style`, `fill_rect`, `stroke_rect`, `fill_circle`,
  `stroke_circle`, `fill/stroke_ellipse`, `fill/stroke_triangle`, `fill/stroke_rounded_rect`,
  `line_between`, `fill_points`, `stroke_points`, `begin_path`, `move_to`, `line_to`, `arc`, `close_path`,
  `stroke_path`, `fill_path`, `slice`, `clear`. Colours are 0xRRGGBB ints like Phaser; 2D MSAA 4x is on.
- `PText` (Node2D) = Text: `PText.make(parent, x, y, text, style)`, `set_origin`, `set_text`, `set_color`,
  `set_font_size`, `set_word_wrap_width`, `get_wrapped_text`, `width` / `height`, `set_alpha`, `set_tint`.
  Styles come from `TextStyles.title/body/label/caps/numeral(overrides)` (Phaser style keys in snake_case).
- `PImage` (Sprite2D, centred) = Image: `PImage.make(parent, x, y, key)`, `set_texture_key`,
  `set_display_size`, `set_tint`, `clear_tint`, `set_alpha`, `set_blend_add`, `set_origin`.
- `PTween`: `PTween.add(node, {x, y, alpha, scale, angle, ...}, ms, "Cubic.easeOut", {delay, yoyo, repeat,
  hold, on_complete})`, `kill_tweens_of(node)`, `delayed_call(node, ms, fn)`, `every(node, ms, fn, repeat)`.
- `UiTheme` (colours as constants `UiTheme.PRIMARY` and the `COLORS` dict, SIZES, SPACING, DEPTH,
  `color(c, a)`, `css(c)`, `font(family, weight, letter_spacing)`), `UiFormat` (format.ts), `Glyphs`,
  `HudGlyphs`, `MapGlyphs` (glyphs draw on a PGraphics; static method references are GlyphDraw Callables),
  `MapPalette`, `Keymap`, `ReportLayout`, `HitZone.add(parent, x, y, w, h, on_tap, {sound})`.
- Widgets take the parent first and add themselves to it, then the TS arguments in order:
  `UiButton.new(parent, x, y, label, on_click, {width, height, variant, font_size})` (+ `set_enabled`,
  `set_label`, `click()`), `GlyphButton.new(parent, x, y, size, draw, on_click)`,
  `UiPanel.new(parent, x, y, w, h, {title, border_color, fill_alpha})` (+ `content_top()`,
  `UiPanel.draw_brackets`), `UiToggle.new(parent, x, y, value, {on, off}, on_change)`,
  `LevelControl.new(parent, x, y, value, {decrease, increase, format}, on_change)`,
  `Keypad.new(parent, {on_digit, on_sign, on_backspace, on_fire}, {fire_label, digits, fire, gap})`,
  `ImageCard.new(parent, x, y, {texture, name, subtitle, price, tier, max_tier, highlight_next, hotkey, on_click})`,
  `CallCard.new(parent, on_go)` + `open(content, anchor)`. A Rect is `{x, y, w, h}` (or a Rect2).
  (Godot has Button and Panel classes, hence UiButton / UiPanel / UiToggle.)

**Assets and textures (`scripts/fx/`).** `Assets` = assets.ts + the texture registry: `Assets.IMG` (same
keys), `has_image(key)`, `texture(key)`, `sheet_frame(key, i)` (walk cycles), `planet_image_for`,
`battle_bg_for`, `enemy_image_for`, `crawler_image_for`, `crawler_walk_for`, `icon_for`, `portrait_for`,
`voice_url_for`. `Tex` = textures.ts with the same keys (`Tex.GLOW`, `Tex.CRAWLER_FALLBACK[kind]`, ...),
drawn on the software canvas `Raster` with the canvas gradient math; the crawler fallbacks are generated
on first use. `VoiceLine` (a Node) = VoiceLine.ts.

**Tests.** After adding scripts run `$GODOT --headless --path godot --import` once (class cache), then
`$GODOT --headless --path godot -s res://tests/run_tests.gd [-- --only=<file part>]`. Test files are
`tests/test_*.gd` extending `TestCase` (`eq`, `eqf`, `ne`, `ok`, `no`, `close`, `gt/ge/lt/le`, `has`,
`is_null`, `errors(fn)` for TS `toThrow`, the helpers of tests/helpers.ts). Any engine error during a test
fails it. Exit code 0 = all pass. Run Godot under `timeout`: a script error in `_init` of a `-s` script
hangs it.

**Screenshot hook.** `$GODOT --path godot -- --shot=<scene> --out=<png> [--steps=N] [--data=<json>]`
(windowed, not headless): boot runs, then `<scene>` starts with `<data>`, N frames (default 30) are
processed, the viewport is saved and Godot quits. `--shot=boot` captures the loading screen,
`--shot=dev_widgets` the widget gallery. Add `--fixed-fps 60` before `--` for frame-exact timing.
