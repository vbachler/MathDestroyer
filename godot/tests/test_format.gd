extends TestCase
## Tests of godot/scripts/ui/format.gd (port of src/ui/format.ts; no vitest file of its own).
## Expected strings derived from src/ui/format.ts and src/locales/*/common.json + meta.json:
##   common.percent  hr "{value} %"  en "{value}%"
##   common.multiplier "×{value}", common.decimalSeparator hr "," en "."
##   meta.mastery.seconds "{value} s"


func _i18n(locale: String) -> I18n:
	return I18n.new(I18n.load_dicts(), locale)


func test_percent_text_rounds_to_a_whole_percent_with_the_locale_spacing() -> void:
	var hr := _i18n("hr")
	var en := _i18n("en")
	eq(UiFormat.percent_text(hr, 0.4), "40 %")
	eq(UiFormat.percent_text(en, 0.4), "40%")
	eq(UiFormat.percent_text(hr, 0.07), "7 %")
	eq(UiFormat.percent_text(en, 0.125), "13%")  # Math.round(12.5) = 13
	eq(UiFormat.percent_text(en, 0), "0%")
	eq(UiFormat.percent_text(hr, 1), "100 %")


func test_multiplier_text_uses_the_locale_decimal_separator() -> void:
	var hr := _i18n("hr")
	var en := _i18n("en")
	eq(UiFormat.multiplier_text(hr, 0.75), "×0,75")
	eq(UiFormat.multiplier_text(en, 0.75), "×0.75")
	eq(UiFormat.multiplier_text(hr, 1), "×1")  # String(1) = "1"
	eq(UiFormat.multiplier_text(hr, 1.5), "×1,5")
	eq(UiFormat.multiplier_text(en, 1.25), "×1.25")


func test_seconds_text_has_one_decimal_and_the_locale_separator() -> void:
	var hr := _i18n("hr")
	var en := _i18n("en")
	eq(UiFormat.seconds_text(hr, 2400), "2,4 s")
	eq(UiFormat.seconds_text(en, 2400), "2.4 s")
	eq(UiFormat.seconds_text(hr, 1000), "1,0 s")
	eq(UiFormat.seconds_text(en, 0), "0.0 s")
	eq(UiFormat.seconds_text(en, 1250), "1.3 s")  # (1.25).toFixed(1) = "1.3"
	eq(UiFormat.seconds_text(hr, 12345), "12,3 s")
