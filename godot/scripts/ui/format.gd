class_name UiFormat
## Port of src/ui/format.ts (pure).


## Whole percent of a 0..1 fraction, with the locale's spacing ("40 %" / "40%").
static func percent_text(i18n: I18n, fraction: float) -> String:
	return i18n.t("common.percent", {"value": Js.round(fraction * 100.0)})


## A setting multiplier with the locale's decimal separator ("×0,75" / "×0.75").
static func multiplier_text(i18n: I18n, v: float) -> String:
	return i18n.t("common.multiplier", {"value": Js.num_str(v).replace(".", i18n.t("common.decimalSeparator"))})


## Milliseconds as seconds with one decimal and the locale's decimal separator ("2,4 s").
static func seconds_text(i18n: I18n, ms: float) -> String:
	var value := ("%.1f" % (ms / 1000.0)).replace(".", i18n.t("common.decimalSeparator"))
	return i18n.t("meta.mastery.seconds", {"value": value})
