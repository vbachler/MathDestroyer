class_name TextStyles
## Port of src/ui/TextStyles.ts: PText style dictionaries (see PText for the keys).
## Overrides use the same snake_case keys, e.g. TextStyles.caps({"font_size": 11, "color": UiTheme.css(UiTheme.TEXT)}).


static func _with(base: Dictionary, overrides: Dictionary) -> Dictionary:
	var out := base.duplicate()
	out.merge(overrides, true)
	return out


## Heading (Rajdhani semibold, 30 px).
static func title(overrides: Dictionary = {}) -> Dictionary:
	return _with({
		"font_family": UiTheme.FONT_UI, "font_size": UiTheme.SIZES.title, "font_style": 600,
		"color": UiTheme.css(UiTheme.TEXT), "letter_spacing": 1,
	}, overrides)


## Running text (16 px, off-white).
static func body(overrides: Dictionary = {}) -> Dictionary:
	return _with({
		"font_family": UiTheme.FONT_UI, "font_size": UiTheme.SIZES.body, "font_style": 500,
		"color": UiTheme.css(UiTheme.TEXT), "line_spacing": 4,
	}, overrides)


## Small HUD label (13 px, dimmed).
static func label(overrides: Dictionary = {}) -> Dictionary:
	return _with({
		"font_family": UiTheme.FONT_UI, "font_size": UiTheme.SIZES.label, "font_style": 500,
		"color": UiTheme.css(UiTheme.TEXT_DIM),
	}, overrides)


## Small caps-style label with letter spacing (amber). Pass the text already upper-cased.
static func caps(overrides: Dictionary = {}) -> Dictionary:
	return _with({
		"font_family": UiTheme.FONT_UI, "font_size": UiTheme.SIZES.label, "font_style": 600,
		"color": UiTheme.css(UiTheme.PRIMARY), "letter_spacing": UiTheme.LETTER_SPACING.caps,
	}, overrides)


## Monospace numerals (Share Tech Mono): problems, input, counters. Default size 24 px.
static func numeral(overrides: Dictionary = {}) -> Dictionary:
	return _with({
		"font_family": UiTheme.FONT_MONO, "font_size": UiTheme.SIZES.problem, "font_style": "normal",
		"color": UiTheme.css(UiTheme.TEXT),
	}, overrides)
