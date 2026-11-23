class_name VoiceLine
extends Node
## Port of src/fx/VoiceLine.ts: plays one optional voice clip, trying the candidate URLs in order
## (Assets.voice_url_for; "assets/..." or "res://assets/...") and staying silent when none exists.
## Add it as a child of the node that owns it; stop() silences it at once (also when freed).
## Plays on the Master bus at the given 0..1 volume, like an HTMLAudioElement (outside WebAudio).

var _player: AudioStreamPlayer


func _ready() -> void:
	_player = AudioStreamPlayer.new()
	_player.bus = &"Master"
	add_child(_player)


func play(urls: Array, volume: float) -> void:
	stop()
	if volume <= 0 or urls.is_empty():
		return
	for url in urls:
		var path: String = url if str(url).begins_with("res://") else "res://" + str(url)
		if not ResourceLoader.exists(path):
			continue
		var stream = load(path)
		if stream is AudioStream:
			if _player == null:
				_ready()
			_player.stream = stream
			_player.volume_db = linear_to_db(clampf(volume, 0.0, 1.0))
			_player.play()
			return


func stop() -> void:
	if _player != null:
		_player.stop()
		_player.stream = null


func is_playing() -> bool:
	return _player != null and _player.playing


func _exit_tree() -> void:
	stop()
