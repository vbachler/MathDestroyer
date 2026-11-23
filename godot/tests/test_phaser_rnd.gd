extends TestCase
## PhaserRnd replays Phaser.Math.RandomDataGenerator (values from node_modules/phaser in Node).


func test_warp_seed_matches_phaser() -> void:
	var r := PhaserRnd.new(["warp"])
	close(r.frac(), 0.30150605126370966, 14)
	close(r.frac(), 0.10052179238186831, 14)
	close(r.frac(), 0.8193389978961206, 14)
	close(r.frac(), 0.4024463059386403, 14)
	close(r.real_in_range(0.6, 1.4), 1.1469514013061035, 13)
	eq(r.between(0, 5), 4)


func test_other_seeds_match_phaser() -> void:
	var r := PhaserRnd.new(["map-jump"])
	close(r.frac(), 0.12941576819261258, 14)
	eq(r.between(0, 5), 1)
	close(r.real_in_range(0, PI * 2), 2.236749277534865, 13)
	var s := PhaserRnd.new(["mathdestroyer-stars"])
	close(s.frac(), 0.31602966831590995, 14)
	close(s.frac(), 0.8309850247993977, 14)


func test_warp_streaks_build_and_update() -> void:
	var w := WarpStreaks.new(null, {"count": 240, "seed": "map-jump"})
	eq(w.count, 240)
	w.set_intensity(2.0)
	eq(w.get_intensity(), 1.0)
	for i in 20:
		w.update(16.7)
	for i in w.count:
		le(w._r[i], w.max_r)
	w.free()
