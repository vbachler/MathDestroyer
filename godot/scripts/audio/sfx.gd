extends Node
## Autoload "Sfx": the game's sound, port of src/audio/Sfx.ts (+ Ambience.ts, Tension.ts, Hangar.ts).
##
## The TS game synthesises everything with WebAudio. tools/render-audio.mjs renders that same synth
## offline (full graph: dry + hull reverb + limiter) into res://assets/audio; this node plays the
## files with the TS rules:
## - one random variant per call (never the same one twice in a row),
## - voice limits: above MAX_VOICES only weapon-priority sounds start, above HARD_MAX nothing does;
##   a voice counts until its last synth source ends (manifest voice_sec), not to the end of its tail,
## - buses "SFX" (effects volume) and "Music" (ambience volume, polled from a getter like the TS),
##   created at runtime if missing, and a hard limiter on Master (the TS DynamicsCompressor),
## - ambience beds (menu / map / battle) with a 3.5 s fade-in, 2.5 s cross-fade, their distant events
##   (battle every 8-20 s, map every 18-35 s), the battle tension layer (smoothed level, cross-fade
##   between loops rendered at fixed levels) and the boarding hangar layer with its events.
## Every public method is a safe no-op when the manifest or a file is missing.
##
## Effects are rendered at sfx volume RENDER.sfx_volume (0.8, the default setting): the SFX bus gain
## is volume / 0.8. Music-bus sounds are rendered at music volume 1: the Music bus gain is the volume.

const MANIFEST_PATH := "res://assets/audio/manifest.json"
const AUDIO_ROOT := "res://assets/audio/"

## Simultaneous one-shot voices: above MAX_VOICES only weapons/explosions play; above HARD_MAX nothing.
const MAX_VOICES := 10
const HARD_MAX := 16
## Voice priority: UI ticks are dropped first, weapons and explosions last.
const PRIO_UI := 0
const PRIO_NORMAL := 1
const PRIO_WEAPON := 2

const SFX_BUS := &"SFX"
const MUSIC_BUS := &"Music"
## Players: one-shots keep ringing (reverb tail) after their voice ended, so the pool is larger than HARD_MAX.
const SFX_POOL := 28
const MUSIC_POOL := 12

## Time constants (s) of the TS setTargetAtTime calls: effects volume, music volume.
const VOLUME_TAU := 0.02
const MUSIC_TAU := 0.1
const MUSIC_POLL_SEC := 0.4
## Rapid fire: a laser within 0.15 s of the previous one is the quieter variant.
const RAPID_SEC := 0.15

const BED_FADE_IN := 3.5
const BED_CROSSFADE := 2.5
const HANGAR_FADE_IN := 2.5
## Distant events of a bed, seconds between [min, max] (the first after at least 0.7 * min).
const BED_EVENTS := {"battle": Vector2(8, 20), "map": Vector2(18, 35)}
## Hangar events: [min, max] s, fraction of min for the first one, what plays.
const HANGAR_EVENTS := [
	[Vector2(4, 12), 0.5, "hull"],
	[Vector2(9, 22), 0.6, "hangar_thud"],
	[Vector2(2.5, 7.5), 0.4, "hangar_drip"],
	[Vector2(28, 55), 0.5, "hangar_far_screech"],
]

## Tension: smoothing time constant of the level (s) and the level below which no beats play.
const TENSION_TAU := 0.4
const TENSION_SILENT := 0.04
## Smoothing of the per-loop cross-fade weights (s), so a level jump never clicks.
const WEIGHT_TAU := 0.08

const MIN_DB := -80.0


## A linear gain ramp (the TS linearRampToValueAtTime on a bed / hangar / tension gain).
class Ramp extends RefCounted:
	var from := 0.0
	var to := 0.0
	var t0 := 0.0
	var dur := 0.0

	func _init(value := 0.0) -> void:
		from = value
		to = value

	func value(now: float) -> float:
		if dur <= 0.0 or now >= t0 + dur:
			return to
		if now <= t0:
			return from
		return lerpf(from, to, (now - t0) / dur)

	func go(now: float, target: float, seconds: float) -> void:
		from = value(now)
		to = target
		t0 = now
		dur = seconds


## One counted voice (TS Voice): active until `ends`.
class Voice extends RefCounted:
	var ends := 0.0
	var player: AudioStreamPlayer = null
	var serial := 0


## Battle tension layer: one looping player per rendered level, cross-faded around the smoothed level.
class TensionLayer extends RefCounted:
	var levels: Array[float] = []
	var players: Array[AudioStreamPlayer] = []
	var bases: Array[float] = []
	var weights: Array[float] = []
	var target := 0.0
	var level := 0.0
	var out := Ramp.new(1.0)


## A looping background bed (TS Ambience Bed).
class Bed extends RefCounted:
	var kind := ""
	var player: AudioStreamPlayer = null
	var base := 1.0
	var gain := Ramp.new()
	var tension: TensionLayer = null
	var next_event := INF
	var dead_at := INF


## The boarding hangar layer (TS HangarBed): drone loop and events, all under one gain.
class HangarLayer extends RefCounted:
	var player: AudioStreamPlayer = null
	var base := 1.0
	var gain := Ramp.new()
	var next: Array[float] = []
	var stopped := false
	var dead_at := INF


var _ok := false
var _render_sfx_volume := 0.8
var _ceiling_db := -1.0
## name -> {streams: Array[AudioStream], params: Array, voice_sec: Array, gain: float, priority: int}
var _sounds: Dictionary = {}
## loop name -> {stream: AudioStream, gain: float}
var _loops: Dictionary = {}
var _tension_names: Array[String] = []
var _tension_levels: Array[float] = []
var _last_pick: Dictionary = {}

var _volume := 0.8
var _music_source: Callable = func() -> float: return 0.6
var _sfx_gain := 1.0
var _sfx_target := 1.0
var _music_gain := 0.0
var _music_target := 0.0
var _next_poll := 0.0

var _sfx_players: Array[AudioStreamPlayer] = []
var _music_players: Array[AudioStreamPlayer] = []
var _voices: Array[Voice] = []
var _serial := 0
var _last_laser := -1.0
var _ftl_voice: Voice = null

var _wanted_ambience := ""
var _tension := 0.0
var _wanted_hangar := false
var _bed: Bed = null
var _hangar: HangarLayer = null
## Beds and hangar layers fading out; freed when their fade is over.
var _retired: Array[RefCounted] = []


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_load_manifest()
	_ensure_buses()
	for i in SFX_POOL:
		_sfx_players.append(_new_player(SFX_BUS))
	for i in MUSIC_POOL:
		_music_players.append(_new_player(MUSIC_BUS))
	_sfx_target = _volume / _render_sfx_volume
	_sfx_gain = _sfx_target
	_apply_bus_gains()
	# Anything asked for before the node was ready (another autoload's _ready) starts now.
	_apply_ambience()


# ================================================================== settings


## Same as the TS constructor arguments: effects volume 0..1 and the music volume 0..1 or a getter
## (Callable returning float, polled every 0.4 s while a bed or the hangar plays).
func configure(volume: float = 0.8, music_volume: Variant = 0.6) -> void:
	_volume = clampf(volume, 0.0, 1.0)
	_sfx_target = _volume / _render_sfx_volume
	_sfx_gain = _sfx_target
	if music_volume is Callable:
		_music_source = music_volume
	else:
		set_music_volume(float(music_volume))
	_apply_bus_gains()


func set_volume(v: float) -> void:
	_volume = clampf(v, 0.0, 1.0)
	_sfx_target = _volume / _render_sfx_volume


func get_volume() -> float:
	return _volume


## Sets the ambience (music) volume 0..1; replaces the getter given to configure().
func set_music_volume(v: float) -> void:
	var vol := clampf(v, 0.0, 1.0)
	_music_source = func() -> float: return vol


# ================================================================== ambience


## Starts (or cross-fades to) a looping background bed: "menu", "map" or "battle".
func start_ambience(kind: String) -> void:
	_wanted_ambience = kind
	_apply_ambience()


func stop_ambience(fade_sec: float = 1.5) -> void:
	_wanted_ambience = ""
	_tension = 0.0
	if _bed != null:
		_retire_bed(_bed, maxf(0.05, fade_sec))
		_bed = null


## Battle dread level 0..1 (lowest enemy's approach); smoothed inside. No-op outside the battle bed.
func set_tension(level: float) -> void:
	_tension = level
	if _bed != null and _bed.tension != null:
		_bed.tension.target = clampf(level, 0.0, 1.0) if is_finite(level) else 0.0


## Boarding hangar ambience layered over the current bed on the music bus.
func start_hangar() -> void:
	_wanted_hangar = true
	_apply_ambience()


## Fades the hangar layer out (boarding ended, paused or shut down).
func stop_hangar(fade_sec: float = 1.2) -> void:
	_wanted_hangar = false
	if _hangar != null:
		var h := _hangar
		_hangar = null
		h.stopped = true
		var f := maxf(0.05, fade_sec)
		h.gain.go(_now(), 0.0, f)
		h.dead_at = _now() + f + 0.05
		_retired.append(h)


# ================================================================== one-shots


## A failing strip light crackles (quiet; the boarding scene rations it with crackle_gate).
func spark_crackle(level: float = 1.0) -> void:
	_one_shot("spark_crackle", clampf(level, 0.0, 1.0))


## The ship's main guns; a shot within 0.15 s of the previous one is a little quieter.
func laser() -> void:
	var t := _now()
	var rapid := _last_laser >= 0.0 and t - _last_laser < RAPID_SEC
	var v := _one_shot("laser_rapid" if rapid else "laser")
	if v != null:
		_last_laser = t


func laser_miss() -> void:
	_one_shot("laser_miss")


func wrong() -> void:
	_one_shot("wrong")


func hit() -> void:
	_one_shot("hit")


## An enemy reached a station; their chatter follows 0.4 s later, faintly.
func miss() -> void:
	_one_shot("miss")
	if not _ok or not is_inside_tree():
		return
	get_tree().create_timer(0.4, true).timeout.connect(func() -> void: alien_chatter(randf_range(1.0, 1.6), 0.45))


func shield_block() -> void:
	_one_shot("shield_block")


func station_destroyed() -> void:
	_one_shot("station_destroyed")


func alarm() -> void:
	_one_shot("alarm")


func radio_chirp() -> void:
	_one_shot("radio_chirp")


## Intercepted alien radio chatter. `duration_sec` null (or < 0) = random 1.2-2.5 s; `level` 0..1.
func alien_chatter(duration_sec: Variant = null, level: float = 1.0) -> void:
	var d: float = randf_range(1.2, 2.5) if duration_sec == null or float(duration_sec) < 0.0 else float(duration_sec)
	_one_shot("alien_chatter", clampf(level, 0.0, 1.0), clampf(d, 0.4, 6.0))


func repair() -> void:
	_one_shot("repair")


func upgrade() -> void:
	_one_shot("upgrade")


func click() -> void:
	_one_shot("click")


func win() -> void:
	_one_shot("win")


func lose() -> void:
	_one_shot("lose")


## FTL drive spooling up for `duration_sec` (rendered at 1.5 and 2 s, the game's two uses);
## ftl_drop() cuts it off.
func ftl_charge(duration_sec: float) -> void:
	_release(_ftl_voice, 0.05)
	_ftl_voice = _one_shot("ftl_charge", 1.0, clampf(duration_sec, 0.3, 10.0))


func ftl_drop() -> void:
	_release(_ftl_voice, 0.08)
	_ftl_voice = null
	_one_shot("ftl_drop")


func enemy_laser() -> void:
	_one_shot("enemy_laser")


func hull_hit() -> void:
	_one_shot("hull_hit")


func breach_alarm() -> void:
	_one_shot("breach_alarm")


## Legs on the deck plates; `level` 0..1 follows the nearest crawler (louder, denser, drier).
func skitter(level: float) -> void:
	var lv := clampf(level, 0.0, 1.0)
	if lv < 0.03:
		return
	# Rendered at a few levels: take the nearest and correct its output level (TS: 0.25 + 0.75 * lv).
	var bucket := _nearest_param("skitter", lv)
	var corr := (0.25 + 0.75 * lv) / (0.25 + 0.75 * bucket)
	_one_shot("skitter", corr, bucket)


## A crawler screams (rendered at level 1; `level` scales it).
func screech(level: float = 1.0) -> void:
	_one_shot("screech", clampf(level, 0.0, 1.0))


func turret_shot() -> void:
	_one_shot("turret_shot")


func bite() -> void:
	_one_shot("bite")


# ================================================================== engine: one-shots


func _now() -> float:
	return Time.get_ticks_usec() / 1000000.0


## Opens a counted voice and plays a variant of `name` on the SFX bus, or returns null (no audio,
## muted, or too many voices). `gain` scales the level linearly; `param` picks the nearest rendered
## parameter (duration or level).
func _one_shot(name: String, gain: float = 1.0, param: Variant = null) -> Voice:
	if not _ok or _volume <= 0.0 or not _sounds.has(name):
		return null
	var e: Dictionary = _sounds[name]
	var now := _now()
	_prune_voices(now)
	var prio: int = e.priority
	if _voices.size() >= HARD_MAX or (_voices.size() >= MAX_VOICES and prio < PRIO_WEAPON):
		return null
	var i := _pick(name, param)
	if i < 0:
		return null
	var v := Voice.new()
	_serial += 1
	v.serial = _serial
	v.ends = now + float(e.voice_sec[i])
	v.player = _play(_sfx_players, e.streams[i], float(e.gain) * gain)
	v.player.set_meta(&"voice", v.serial)
	_voices.append(v)
	return v


func _prune_voices(now: float) -> void:
	var i := _voices.size() - 1
	while i >= 0:
		if _voices[i].ends <= now:
			_voices.remove_at(i)
		i -= 1


## Fades a voice out over `fade` s and stops it (TS Voice.release, used to cut the FTL charge).
func _release(v: Voice, fade: float) -> void:
	if v == null or v.player == null:
		return
	var now := _now()
	if v.ends <= now:
		return
	v.ends = minf(v.ends, now + fade + 0.02)
	var p := v.player
	if int(p.get_meta(&"voice", -1)) != v.serial or not p.playing:
		return
	var from := db_to_linear(p.volume_db)
	var serial := v.serial
	var set_gain := func(a: float) -> void:
		if int(p.get_meta(&"voice", -1)) == serial:
			p.volume_db = _db(a)
	var cut := func() -> void:
		if int(p.get_meta(&"voice", -1)) == serial:
			p.stop()
	var tw := create_tween()
	tw.tween_method(set_gain, from, 0.0, fade)
	tw.tween_callback(cut)


## Random variant index of `name` (among the variants rendered nearest to `param`), never the same twice in a row.
func _pick(name: String, param: Variant) -> int:
	var e: Dictionary = _sounds[name]
	var n: int = e.streams.size()
	if n == 0:
		return -1
	var cands: Array[int] = []
	if param == null or e.params.is_empty():
		for i in n:
			cands.append(i)
	else:
		var want := _nearest_param(name, float(param))
		for i in n:
			if is_equal_approx(float(e.params[i]), want):
				cands.append(i)
	if cands.size() > 1 and _last_pick.has(name):
		cands.erase(int(_last_pick[name]))
	var i: int = cands[randi() % cands.size()]
	_last_pick[name] = i
	return i


func _nearest_param(name: String, value: float) -> float:
	if not _sounds.has(name):
		return value
	var best := value
	var dist := INF
	for p in _sounds[name].params:
		var d := absf(float(p) - value)
		if d < dist:
			dist = d
			best = float(p)
	return best


## Plays `stream` on a free player of `pool` (or the one started longest ago).
func _play(pool: Array[AudioStreamPlayer], stream: AudioStream, gain: float, owner: Object = null) -> AudioStreamPlayer:
	var p: AudioStreamPlayer = null
	var oldest: AudioStreamPlayer = null
	var oldest_t := INF
	for q in pool:
		if not q.playing:
			p = q
			break
		var st: float = q.get_meta(&"started", 0.0)
		if st < oldest_t:
			oldest_t = st
			oldest = q
	if p == null:
		p = oldest
	p.stop()
	p.stream = stream
	p.set_meta(&"started", _now())
	p.set_meta(&"gain", gain)
	if owner != null:
		p.set_meta(&"owner", owner)
	elif p.has_meta(&"owner"):
		p.remove_meta(&"owner")
	p.set_meta(&"voice", -1)
	p.volume_db = _db(gain * (_owner_gain(owner, _now()) if owner != null else 1.0))
	p.play()
	return p


func _owner_of(p: AudioStreamPlayer) -> Object:
	return p.get_meta(&"owner") if p.has_meta(&"owner") else null


func _new_player(bus: StringName) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.bus = bus
	p.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(p)
	return p


func _db(linear: float) -> float:
	return MIN_DB if linear <= 0.0001 else maxf(MIN_DB, linear_to_db(linear))


# ================================================================== engine: buses


func _ensure_buses() -> void:
	for bus_name: StringName in [SFX_BUS, MUSIC_BUS]:
		if AudioServer.get_bus_index(bus_name) < 0:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, bus_name)
			AudioServer.set_bus_send(i, &"Master")
	# The TS limiter: one sound alone is already limited in the render; layered sounds are held to
	# the same ceiling (the loudest single rendered sound).
	var m := AudioServer.get_bus_index(&"Master")
	for k in AudioServer.get_bus_effect_count(m):
		if AudioServer.get_bus_effect(m, k) is AudioEffectHardLimiter:
			return
	var lim := AudioEffectHardLimiter.new()
	lim.ceiling_db = _ceiling_db
	lim.pre_gain_db = 0.0
	lim.release = 0.15
	AudioServer.add_bus_effect(m, lim)


func _apply_bus_gains() -> void:
	var s := AudioServer.get_bus_index(SFX_BUS)
	if s >= 0:
		AudioServer.set_bus_volume_db(s, _db(_sfx_gain))
	var m := AudioServer.get_bus_index(MUSIC_BUS)
	if m >= 0:
		AudioServer.set_bus_volume_db(m, _db(_music_gain))


## Reads the music volume now (TS syncVolume(true), when a bed or the hangar starts).
func _sync_music_now() -> void:
	_music_target = clampf(float(_music_source.call()), 0.0, 1.0)
	_music_gain = _music_target
	_next_poll = _now() + MUSIC_POLL_SEC
	_apply_bus_gains()


# ================================================================== engine: ambience


## Brings the ambience in line with what scenes asked for (TS applyAmbience; audio always runs here).
func _apply_ambience() -> void:
	if not _ok:
		return
	if _wanted_ambience != "":
		_start_bed(_wanted_ambience)
		set_tension(_tension)
	elif _bed != null:
		_retire_bed(_bed, 1.5)
		_bed = null
	if _wanted_hangar and _hangar == null:
		_start_hangar_layer()


func _start_bed(kind: String) -> void:
	if _bed != null and _bed.kind == kind:
		return
	var name := "bed_" + kind
	if not _loops.has(name):
		push_warning("Sfx: no ambience '%s'" % kind)
		return
	_sync_music_now()
	if _bed != null:
		_retire_bed(_bed, BED_CROSSFADE)
	var now := _now()
	var b := Bed.new()
	b.kind = kind
	b.base = _loops[name].gain
	b.gain.go(now, 1.0, BED_FADE_IN)
	b.player = _loop_player(_loops[name].stream, 0.0)
	if kind == "battle":
		b.tension = _new_tension()
	if BED_EVENTS.has(kind):
		var r: Vector2 = BED_EVENTS[kind]
		b.next_event = now + randf_range(r.x * 0.7, r.y)
	_bed = b


func _retire_bed(b: Bed, fade: float) -> void:
	var now := _now()
	b.next_event = INF
	b.gain.go(now, 0.0, fade)
	if b.tension != null:
		b.tension.out.go(now, 0.0, fade)
	b.dead_at = now + fade + 0.05
	_retired.append(b)


func _new_tension() -> TensionLayer:
	var t := TensionLayer.new()
	for i in _tension_names.size():
		t.levels.append(_tension_levels[i])
		t.bases.append(_loops[_tension_names[i]].gain)
		t.weights.append(0.0)
		var p := _new_player(MUSIC_BUS)
		p.stream = _loops[_tension_names[i]].stream
		p.volume_db = MIN_DB
		t.players.append(p)
	return t


## Cross-fade weight of each tension loop for the smoothed level (below the first loop's level its
## gain scales linearly, as the TS beat peak does; nothing below TENSION_SILENT).
func _tension_weights(t: TensionLayer, lv: float) -> Array[float]:
	var w: Array[float] = []
	w.resize(t.levels.size())
	w.fill(0.0)
	if lv < TENSION_SILENT or t.levels.is_empty():
		return w
	if lv <= t.levels[0]:
		w[0] = lv / t.levels[0]
		return w
	for i in range(t.levels.size() - 1):
		if lv <= t.levels[i + 1]:
			var a := (lv - t.levels[i]) / (t.levels[i + 1] - t.levels[i])
			w[i] = 1.0 - a
			w[i + 1] = a
			return w
	w[w.size() - 1] = 1.0
	return w


func _update_tension(t: TensionLayer, bed_gain: float, now: float, dt: float) -> void:
	t.level += (t.target - t.level) * (1.0 - exp(-dt / TENSION_TAU))
	var want := _tension_weights(t, t.level)
	var k := 1.0 - exp(-dt / WEIGHT_TAU)
	var out := t.out.value(now) * bed_gain
	for i in t.players.size():
		t.weights[i] += (want[i] - t.weights[i]) * k
		if want[i] == 0.0 and t.weights[i] < 0.0005:
			t.weights[i] = 0.0
		var p := t.players[i]
		var g := t.bases[i] * t.weights[i] * out
		if g > 0.0001:
			if not p.playing:
				p.play()
			p.volume_db = _db(g)
		elif p.playing:
			p.stop()


func _start_hangar_layer() -> void:
	if not _loops.has("hangar_bed"):
		return
	_sync_music_now()
	var now := _now()
	var h := HangarLayer.new()
	h.base = _loops.hangar_bed.gain
	h.gain.go(now, 1.0, HANGAR_FADE_IN)
	h.player = _loop_player(_loops.hangar_bed.stream, 0.0)
	for ev in HANGAR_EVENTS:
		var r: Vector2 = ev[0]
		h.next.append(now + randf_range(r.x * float(ev[1]), r.y))
	_hangar = h


func _loop_player(stream: AudioStream, gain: float) -> AudioStreamPlayer:
	var p := _new_player(MUSIC_BUS)
	p.stream = stream
	p.volume_db = _db(gain)
	p.play()
	return p


func _owner_gain(owner: Object, now: float) -> float:
	if owner is HangarLayer:
		return (owner as HangarLayer).gain.value(now)
	return 1.0


## A distant ambience event on the music bus (not a counted voice).
func _music_event(name: String, gain: float = 1.0, owner: Object = null) -> void:
	if not _sounds.has(name):
		return
	var i := _pick(name, null)
	if i < 0:
		return
	_play(_music_players, _sounds[name].streams[i], float(_sounds[name].gain) * gain, owner)


func _bed_event(kind: String) -> void:
	if kind == "map":
		_music_event("amb_sonar")
		return
	var r := randf()
	if r < 1.0 / 3.0:
		_music_event("amb_chatter", randf_range(0.6, 1.0))
	elif r < 5.0 / 9.0:
		_music_event("amb_creak")
	elif r < 7.0 / 9.0:
		_music_event("amb_alien_call")
	else:
		_music_event("amb_sonar")


func _hangar_event(h: HangarLayer, what: String) -> void:
	if what == "hull":
		what = "hangar_creak" if randf() < 0.55 else "hangar_groan"
	_music_event(what, 1.0, h)


func _process(delta: float) -> void:
	if not _ok:
		return
	var now := _now()
	var dt := minf(delta, 0.25)

	# Volumes: effects follow set_volume (tau 0.02 s); music is polled while something plays (tau 0.1 s).
	_sfx_gain += (_sfx_target - _sfx_gain) * (1.0 - exp(-dt / VOLUME_TAU))
	if (_bed != null or _hangar != null) and now >= _next_poll:
		_next_poll = now + MUSIC_POLL_SEC
		_music_target = clampf(float(_music_source.call()), 0.0, 1.0)
	_music_gain += (_music_target - _music_gain) * (1.0 - exp(-dt / MUSIC_TAU))
	_apply_bus_gains()

	if _bed != null:
		_update_bed(_bed, now, dt)
		if now >= _bed.next_event:
			var r: Vector2 = BED_EVENTS[_bed.kind]
			_bed.next_event = now + randf_range(r.x, r.y)
			_bed_event(_bed.kind)
	if _hangar != null:
		_update_hangar(_hangar, now)
		for i in HANGAR_EVENTS.size():
			if now >= _hangar.next[i]:
				var r: Vector2 = HANGAR_EVENTS[i][0]
				_hangar.next[i] = now + randf_range(r.x, r.y)
				_hangar_event(_hangar, HANGAR_EVENTS[i][2])
	var j := _retired.size() - 1
	while j >= 0:
		var o := _retired[j]
		var dead_at := INF
		if o is Bed:
			_update_bed(o as Bed, now, dt)
			dead_at = (o as Bed).dead_at
		else:
			_update_hangar(o as HangarLayer, now)
			dead_at = (o as HangarLayer).dead_at
		if now >= dead_at:
			_free_layer(o)
			_retired.remove_at(j)
		j -= 1

	# Hangar events fade with their layer.
	for p in _music_players:
		var owner := _owner_of(p)
		if owner != null and p.playing:
			p.volume_db = _db(float(p.get_meta(&"gain", 1.0)) * _owner_gain(owner, now))


func _update_bed(b: Bed, now: float, dt: float) -> void:
	var g := b.gain.value(now)
	b.player.volume_db = _db(b.base * g)
	if b.tension != null:
		_update_tension(b.tension, g, now, dt)


func _update_hangar(h: HangarLayer, now: float) -> void:
	h.player.volume_db = _db(h.base * h.gain.value(now))


func _free_layer(o: RefCounted) -> void:
	if o is Bed:
		var b := o as Bed
		b.player.queue_free()
		if b.tension != null:
			for p in b.tension.players:
				p.queue_free()
	elif o is HangarLayer:
		var h := o as HangarLayer
		h.player.queue_free()
		for p in _music_players:
			if _owner_of(p) == h:
				p.stop()
				p.remove_meta(&"owner")


# ================================================================== engine: loading


func _load_manifest() -> void:
	if not FileAccess.file_exists(MANIFEST_PATH):
		push_warning("Sfx: %s missing (run npm run audio:render); audio disabled" % MANIFEST_PATH)
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST_PATH))
	if not data is Dictionary:
		push_warning("Sfx: bad manifest; audio disabled")
		return
	var render: Dictionary = data.get("render", {})
	_render_sfx_volume = float(render.get("sfx_volume", 0.8))
	_ceiling_db = float(data.get("limiter_ceiling_db", -1.0))
	var sounds: Dictionary = data.get("sounds", {})
	for name: String in sounds:
		var e: Dictionary = sounds[name]
		var streams: Array[AudioStream] = []
		var params: Array = []
		var voice: Array = []
		var files: Array = e.get("files", [])
		for i in files.size():
			var s := _load_stream(files[i])
			if s == null:
				continue
			streams.append(s)
			voice.append(float(e.voice_sec[i]))
			if e.get("params") is Array:
				params.append(e.params[i])
		var prio: Variant = e.get("priority")
		_sounds[name] = {
			"streams": streams, "params": params, "voice_sec": voice, "gain": float(e.get("gain", 1.0)),
			"priority": PRIO_NORMAL if prio == null else int(prio),
		}
	var loops: Dictionary = data.get("loops", {})
	var tension: Array = []
	for name: String in loops:
		var l: Dictionary = loops[name]
		var s := _load_stream(l.file)
		if s == null:
			continue
		if s is AudioStreamOggVorbis:
			(s as AudioStreamOggVorbis).loop = true
			(s as AudioStreamOggVorbis).loop_offset = 0.0
		elif s is AudioStreamWAV:
			(s as AudioStreamWAV).loop_mode = AudioStreamWAV.LOOP_FORWARD
			(s as AudioStreamWAV).loop_begin = 0
			(s as AudioStreamWAV).loop_end = roundi(float(l.length_sec) * (s as AudioStreamWAV).mix_rate)
		_loops[name] = {"stream": s, "gain": float(l.get("gain", 1.0))}
		if l.has("level"):
			tension.append([float(l.level), name])
	tension.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	for t in tension:
		_tension_levels.append(t[0])
		_tension_names.append(t[1])
	_ok = true


func _load_stream(rel: String) -> AudioStream:
	var path := AUDIO_ROOT + rel
	if not ResourceLoader.exists(path):
		push_warning("Sfx: missing %s" % path)
		return null
	return load(path) as AudioStream
