extends TestCase
## Port of the "sector clouds" part of tests/mapVisuals.test.ts (the palette part is test_map_palette.gd).


func _blobs_of(i: int) -> Array:
	var s: Dictionary = Content.sectors()[i]
	return CloudField.sector_blobs(s, s.systems, Names.stable_hash("cloud:%s" % s.id))


func test_are_deterministic_and_hold_every_system_inside_the_outline() -> void:
	var sectors := Content.sectors()
	for i in sectors.size():
		var blobs := _blobs_of(i)
		eq(blobs, _blobs_of(i))
		eq(blobs.size(), 1 + sectors[i].systems.size() + 5)
		for s in sectors[i].systems:
			gt(CloudField.field_at(blobs, s.x, s.y), CloudField.CLOUD_EDGE + 0.2)


func test_fade_out_well_beyond_the_sector_disc_and_are_not_plain_circles() -> void:
	var sectors := Content.sectors()
	for i in sectors.size():
		var s: Dictionary = sectors[i]
		var blobs := _blobs_of(i)
		var reach: Array = []
		for k in 24:
			var a := float(k) / 24.0 * PI * 2
			var d := 0.0
			while d < s.radius * 2 and CloudField.field_at(blobs, s.x + cos(a) * d, s.y + sin(a) * d) >= CloudField.CLOUD_EDGE:
				d += 4
			reach.append(d)
		lt(reach.max(), s.radius * 1.35)
		gt(reach.min(), s.radius * 0.3)
		gt(reach.max() - reach.min(), s.radius * 0.1)


func test_bake_into_a_small_grid_that_covers_the_whole_cloud() -> void:
	var grid := CloudField.cloud_grid(_blobs_of(4), 6)
	eq(grid.field.size(), grid.w * grid.h)
	lt(grid.w * grid.h, 200 * 200)
	for i in grid.w:
		lt(grid.field[i], CloudField.CLOUD_EDGE * 0.2)
		lt(grid.field[(grid.h - 1) * grid.w + i], CloudField.CLOUD_EDGE * 0.2)


func test_fill_is_zero_outside_strong_inside_the_rim_peaks_on_the_outline() -> void:
	eq(CloudField.cloud_fill(0.1), 0.0)
	gt(CloudField.cloud_fill(CloudField.CLOUD_EDGE + 0.3), 0.5)
	close(CloudField.cloud_rim(CloudField.CLOUD_EDGE), 1)
	lt(CloudField.cloud_rim(CloudField.CLOUD_EDGE + 0.3), 0.01)
	lt(CloudField.cloud_rim(CloudField.CLOUD_EDGE - 0.3), 0.01)


func test_bakes_a_cloud_texture_once() -> void:
	var s: Dictionary = Content.sectors()[0]
	var baked := SectorClouds.bake_sector_cloud(s)
	ok(Assets.has_image(baked.key))
	eq(SectorClouds.bake_sector_cloud(s), baked)
	gt(Assets.texture(baked.key).get_width(), 10)
