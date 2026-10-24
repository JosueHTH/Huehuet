extends Control
## Interfaz y bucle principal de "Corazones de Aetheria".
## Toda la UI se construye por código para que el proyecto sea autocontenido.

signal advanced
signal choice_made(idx: int)
signal hub_action(action: Dictionary)
signal ending_done

const STAT_CAP := 10

var autoplay := false
var waiting_click := false
var current_char := ""
var type_tween: Tween
var bg_tween: Tween

var bg: ColorRect
var petals: CPUParticles2D
var portrait: Portrait
var ui: Control
var dlg: Control
var box: PanelContainer
var name_label: Label
var text_label: RichTextLabel
var choice_box: VBoxContainer
var fade_rect: ColorRect
var fade_label: Label
var toast: Label


func _ready() -> void:
	autoplay = "--autoplay" in OS.get_cmdline_user_args()
	theme = _make_theme()
	_build_layers()
	if autoplay:
		GS.reset("Auto")
		await game_loop()
		_print_summary()
		get_tree().quit()
	else:
		show_title()


# ------------------------------------------------------------------ construcción de UI

func _sb(col: Color, border: Color = Color(1, 1, 1, 0.0), radius: int = 12, bw: int = 0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.border_color = border
	sb.set_border_width_all(bw)
	sb.set_corner_radius_all(radius)
	sb.content_margin_left = 16
	sb.content_margin_right = 16
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	return sb


func _make_theme() -> Theme:
	var t := Theme.new()
	t.set_default_font_size(22)
	t.set_stylebox("normal", "Button", _sb(Color("#3b2a52"), Color("#c58bd6"), 12, 2))
	t.set_stylebox("hover", "Button", _sb(Color("#5a3f7c"), Color("#ffb3e6"), 12, 2))
	t.set_stylebox("pressed", "Button", _sb(Color("#2a1d3b"), Color("#ffb3e6"), 12, 2))
	t.set_stylebox("disabled", "Button", _sb(Color("#2a2433", 0.8), Color("#554a63"), 12, 1))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", Color("#fff4fb"))
	t.set_color("font_disabled_color", "Button", Color("#8a8095"))
	t.set_stylebox("panel", "PanelContainer", _sb(Color("#1b1326", 0.88), Color("#c58bd6"), 16, 2))
	t.set_stylebox("normal", "LineEdit", _sb(Color("#21172d"), Color("#c58bd6"), 10, 2))
	t.set_color("font_color", "Label", Color("#fff4fb"))
	t.set_color("default_color", "RichTextLabel", Color("#fff4fb"))
	return t


func _full(c: Control) -> void:
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func _build_layers() -> void:
	bg = ColorRect.new()
	bg.color = Data.HOME_BG
	add_child(bg)
	_full(bg)

	petals = CPUParticles2D.new()
	petals.position = Vector2(640, -20)
	petals.amount = 28
	petals.lifetime = 9.0
	petals.preprocess = 9.0
	petals.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	petals.emission_rect_extents = Vector2(700, 4)
	petals.direction = Vector2(0.2, 1)
	petals.spread = 12.0
	petals.gravity = Vector2(12, 30)
	petals.initial_velocity_min = 25.0
	petals.initial_velocity_max = 55.0
	petals.scale_amount_min = 3.0
	petals.scale_amount_max = 6.0
	petals.color = Color(1, 0.7, 0.85, 0.55)
	add_child(petals)

	portrait = Portrait.new()
	portrait.size = Vector2(440, 640)
	portrait.position = Vector2(420, 40)
	portrait.mouse_filter = Control.MOUSE_FILTER_IGNORE
	portrait.visible = false
	add_child(portrait)

	ui = Control.new()
	add_child(ui)
	_full(ui)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE

	dlg = Control.new()
	dlg.visible = false
	dlg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dlg)
	_full(dlg)

	box = PanelContainer.new()
	box.anchor_left = 0.0
	box.anchor_right = 1.0
	box.anchor_top = 1.0
	box.anchor_bottom = 1.0
	box.offset_left = 50
	box.offset_right = -50
	box.offset_top = -230
	box.offset_bottom = -28
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dlg.add_child(box)
	var vb := VBoxContainer.new()
	vb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(vb)
	name_label = Label.new()
	name_label.add_theme_font_size_override("font_size", 28)
	name_label.add_theme_color_override("font_color", Color("#ffb3e6"))
	vb.add_child(name_label)
	text_label = RichTextLabel.new()
	text_label.bbcode_enabled = true
	text_label.custom_minimum_size = Vector2(0, 120)
	text_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	text_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	text_label.add_theme_font_size_override("normal_font_size", 25)
	vb.add_child(text_label)

	choice_box = VBoxContainer.new()
	choice_box.anchor_left = 0.2
	choice_box.anchor_right = 0.8
	choice_box.anchor_top = 0.08
	choice_box.anchor_bottom = 0.62
	choice_box.alignment = BoxContainer.ALIGNMENT_CENTER
	choice_box.add_theme_constant_override("separation", 12)
	choice_box.visible = false
	dlg.add_child(choice_box)

	toast = Label.new()
	toast.anchor_left = 0.0
	toast.anchor_right = 1.0
	toast.offset_top = 82
	toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast.add_theme_font_size_override("font_size", 28)
	toast.add_theme_color_override("font_color", Color("#ffd6f2"))
	toast.add_theme_color_override("font_outline_color", Color.BLACK)
	toast.add_theme_constant_override("outline_size", 8)
	toast.modulate.a = 0.0
	toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(toast)

	fade_rect = ColorRect.new()
	fade_rect.color = Color.BLACK
	fade_rect.modulate.a = 0.0
	fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(fade_rect)
	_full(fade_rect)
	fade_label = Label.new()
	fade_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	fade_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	fade_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	fade_label.add_theme_font_size_override("font_size", 30)
	fade_label.anchor_left = 0.15
	fade_label.anchor_right = 0.85
	fade_label.anchor_top = 0.0
	fade_label.anchor_bottom = 1.0
	fade_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fade_rect.add_child(fade_label)


func _clear_ui() -> void:
	for c in ui.get_children():
		c.queue_free()


func _label(text: String, size: int = 22, col: Color = Color("#fff4fb")) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	return l


func _button(text: String, callback: Callable, disabled: bool = false) -> Button:
	var b := Button.new()
	b.text = text
	b.disabled = disabled
	b.pressed.connect(callback)
	return b


func set_bg(col: Color) -> void:
	if bg_tween and bg_tween.is_valid():
		bg_tween.kill()
	bg_tween = create_tween()
	bg_tween.tween_property(bg, "color", col, 0.6)


func show_toast(msg: String) -> void:
	toast.text = msg
	toast.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_interval(1.6)
	tw.tween_property(toast, "modulate:a", 0.0, 0.6)


# ------------------------------------------------------------------ input

func _input(event: InputEvent) -> void:
	var pressed := false
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		pressed = true
	elif event.is_action_pressed("ui_accept") or event.is_action_pressed("ui_select"):
		pressed = true
	if not pressed:
		return
	if type_tween and type_tween.is_valid() and type_tween.is_running():
		type_tween.kill()
		text_label.visible_ratio = 1.0
		get_viewport().set_input_as_handled()
	elif waiting_click:
		waiting_click = false
		advanced.emit()
		get_viewport().set_input_as_handled()


# ------------------------------------------------------------------ pantalla de título

func show_title() -> void:
	_clear_ui()
	dlg.visible = false
	portrait.visible = false
	current_char = ""
	set_bg(Color("#2a1840"))
	var col := VBoxContainer.new()
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 16)
	ui.add_child(col)
	col.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	col.custom_minimum_size = Vector2(520, 0)
	col.position = Vector2(380, 130)

	var title := _label("Corazones de Aetheria", 64, Color("#ffd6f2"))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_color_override("font_outline_color", Color("#7a2d8c"))
	title.add_theme_constant_override("outline_size", 14)
	col.add_child(title)
	var sub := _label("Una novela de citas de fantasía\nContenido sugerente (ecchi) · Solo para mayores de edad", 20, Color("#d9b8e6"))
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sub)
	col.add_child(Control.new())

	var name_edit := LineEdit.new()
	name_edit.placeholder_text = "Tu nombre (Kael por defecto)"
	name_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_edit.custom_minimum_size = Vector2(0, 52)
	name_edit.max_length = 14
	col.add_child(name_edit)
	col.add_child(_button("Nueva partida", _on_new_game.bind(name_edit)))
	col.add_child(_button("Continuar", _on_continue, not GS.has_save()))
	col.add_child(_button("Salir", func(): get_tree().quit()))


func _on_new_game(name_edit: LineEdit) -> void:
	GS.reset(name_edit.text)
	await _run_new_game()


func _on_continue() -> void:
	if GS.load_game():
		await _continue_game()


func _run_new_game() -> void:
	_clear_ui()
	dlg.visible = true
	await run_event("intro")
	end_dialogue()
	await game_loop()


func _continue_game() -> void:
	_clear_ui()
	await game_loop()


# ------------------------------------------------------------------ motor de diálogo

func _speaker_name(w: String) -> String:
	if w == "":
		return ""
	if w == "me":
		return GS.player_name
	if w == "marta":
		return "Marta"
	if Data.CHARS.has(w):
		return Data.CHARS[w].name
	return w


func show_portrait(who: String) -> void:
	if who == current_char and portrait.visible:
		return
	current_char = who
	portrait.setup(Data.CHARS[who])
	portrait.visible = true
	portrait.modulate.a = 0.0
	create_tween().tween_property(portrait, "modulate:a", 1.0, 0.35)
	set_bg(Data.CHARS[who].bg)


func hide_portrait() -> void:
	portrait.visible = false
	current_char = ""


func end_dialogue() -> void:
	dlg.visible = false
	choice_box.visible = false
	waiting_click = false
	hide_portrait()


func run_event(id: String) -> void:
	dlg.visible = true
	await run_steps(Events.get_event(id))


func run_steps(steps: Array) -> void:
	for step in steps:
		if step.has("show"):
			show_portrait(step.show)
		elif step.has("hide"):
			hide_portrait()
		elif step.has("fade"):
			await fade_caption(step.fade)
		elif step.has("aff"):
			GS.add_aff(step.aff, int(step.n))
		elif step.has("choices"):
			await run_choices(step.choices)
		elif step.has("t"):
			await say(step)


func say(step: Dictionary) -> void:
	var w: String = step.w
	dlg.visible = true
	box.visible = true
	var nm := _speaker_name(w)
	name_label.text = nm
	name_label.visible = nm != ""
	if Data.CHARS.has(w):
		show_portrait(w)
	var e: String = step.get("e", "")
	if portrait.visible:
		portrait.set_expr(e)
	var msg: String = step.t.replace("{n}", GS.player_name)
	if w == "":
		msg = "[i]%s[/i]" % msg
	text_label.text = msg
	if autoplay:
		text_label.visible_ratio = 1.0
		return
	text_label.visible_ratio = 0.0
	type_tween = create_tween()
	type_tween.tween_property(text_label, "visible_ratio", 1.0, maxf(0.35, msg.length() * 0.018))
	waiting_click = true
	await advanced


func ask(prompt: String, options: Array, keep_box: bool = true) -> int:
	dlg.visible = true
	box.visible = keep_box
	for c in choice_box.get_children():
		c.queue_free()
	if prompt != "":
		var pl := _label(prompt, 26, Color("#ffd6f2"))
		pl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		pl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		choice_box.add_child(pl)
	var idx := 0
	if autoplay:
		var ok: Array = []
		for i in options.size():
			if not options[i].get("disabled", false):
				ok.append(i)
		idx = ok.pick_random()
	else:
		for i in options.size():
			var b := _button(options[i].t, func(): choice_made.emit(i), options[i].get("disabled", false))
			b.custom_minimum_size = Vector2(0, 54)
			choice_box.add_child(b)
		choice_box.visible = true
		waiting_click = false
		idx = await choice_made
	choice_box.visible = false
	for c in choice_box.get_children():
		c.queue_free()
	return idx


func _need_text(need: Dictionary) -> String:
	var parts: Array = []
	for k in need:
		parts.append("%s %d" % [Data.STAT_NAMES[k], need[k]])
	return ", ".join(parts)


func _meets(need: Dictionary) -> bool:
	for k in need:
		if GS.stats[k] < int(need[k]):
			return false
	return true


func run_choices(choices: Array) -> void:
	var opts: Array = []
	for c in choices:
		var ok := true
		var label: String = c.t
		if c.has("need") and not _meets(c.need):
			ok = false
			label += "   [requiere %s]" % _need_text(c.need)
		opts.append({"t": label, "disabled": not ok})
	var idx := await ask("", opts)
	await _apply_choice(choices[idx])


func _apply_choice(c: Dictionary) -> void:
	if c.has("who"):
		await _festival_date(c.who)
		return
	for k in c.get("aff", {}):
		var n := int(c.aff[k])
		if n != 0:
			GS.add_aff(k, n)
			show_toast("%s %s%d" % [Data.CHARS[k].name, "+" if n > 0 else "", n])
	for k in c.get("stat", {}):
		GS.stats[k] = mini(GS.stats[k] + int(c.stat[k]), STAT_CAP)
	GS.gold += int(c.get("gold", 0))
	await run_steps(c.get("r", []))


func _festival_date(who: String) -> void:
	var nm: String = Data.CHARS[who].name
	if GS.affection[who] < 2:
		await run_steps([
			Events.s("", "%s tenía otros planes. Pasas la noche mirando linternas con Marta, que no deja de reírse de ti." % nm),
		])
		return
	await run_steps(Events.festival_date(who))
	GS.add_aff(who, 3)
	show_toast("%s +3" % nm)


func fade_caption(text: String) -> void:
	dlg.visible = true
	box.visible = false
	choice_box.visible = false
	fade_label.text = text
	fade_label.modulate.a = 0.0
	if autoplay:
		return
	var tw := create_tween()
	tw.tween_property(fade_rect, "modulate:a", 1.0, 0.6)
	tw.tween_property(fade_label, "modulate:a", 1.0, 0.4)
	await tw.finished
	waiting_click = true
	await advanced
	var tw2 := create_tween()
	tw2.tween_property(fade_label, "modulate:a", 0.0, 0.3)
	tw2.tween_property(fade_rect, "modulate:a", 0.0, 0.6)
	await tw2.finished


func banner(text: String) -> void:
	if autoplay:
		return
	fade_label.text = text
	fade_label.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_property(fade_rect, "modulate:a", 1.0, 0.4)
	tw.tween_interval(0.9)
	tw.tween_property(fade_rect, "modulate:a", 0.0, 0.5)
	await tw.finished
	fade_label.modulate.a = 0.0


# ------------------------------------------------------------------ bucle de juego

func game_loop() -> void:
	while not GS.is_over():
		if GS.slot == 0:
			GS.save_game()
		if GS.day == 10 and GS.slot == 2 and not GS.has_seen("festival"):
			GS.mark_seen("festival")
			await run_event("festival")
			end_dialogue()
			await _end_slot()
			continue
		if GS.day == 20 and GS.slot == 0 and not GS.has_seen("termas"):
			GS.mark_seen("termas")
			await run_event("termas")
			end_dialogue()
			await _end_slot()
			continue
		var action: Dictionary = await show_hub()
		if action.type == "quit":
			GS.save_game()
			show_title()
			return
		await handle_action(action)
	await show_ending()


func _end_slot() -> void:
	GS.advance()
	if GS.slot == 0 and not GS.is_over():
		var lost := GS.apply_decay()
		var caption := "Día %d" % GS.day
		for h in lost:
			caption += "\n%s te echa de menos (-1)" % Data.CHARS[h].name
		await banner(caption)


func handle_action(a: Dictionary) -> void:
	match a.type:
		"train":
			var stat: String = a.stat
			var info: Dictionary = Data.TRAIN[stat]
			_clear_ui()
			set_bg(Color("#2c3a4a"))
			await run_steps([Events.s("", info.texts.pick_random())])
			if GS.stats[stat] < STAT_CAP:
				GS.stats[stat] += 1
				show_toast("%s +1" % Data.STAT_NAMES[stat])
			else:
				show_toast("%s al máximo" % Data.STAT_NAMES[stat])
			end_dialogue()
			await _end_slot()
		"work":
			_clear_ui()
			set_bg(Color("#3a3326"))
			await run_steps([Events.s("", Data.WORK_TEXTS.pick_random())])
			GS.gold += 25
			show_toast("+25 de oro")
			end_dialogue()
			await _end_slot()
		"visit":
			await do_visit(a.who)


func do_visit(who: String) -> void:
	_clear_ui()
	dlg.visible = true
	show_portrait(who)
	var nm: String = Data.CHARS[who].name
	if not GS.met[who]:
		GS.met[who] = true
		await run_steps(Events.get_event(who + "0"))
		end_dialogue()
		await _end_slot()
		return
	while true:
		var gifted: bool = GS.last_gift[who] == GS.day
		var talked: bool = GS.last_chat[who] == GS.day
		var opts := [
			{"t": "Charlar (consume el momento)%s" % ("  [ya hablasteis hoy]" if talked else ""), "disabled": talked},
			{"t": "Hacer un regalo (%d de oro)%s" % [GS.GIFT_COST, "  [ya le diste algo hoy]" if gifted else ""],
				"disabled": gifted or GS.gold < GS.GIFT_COST},
			{"t": "Marcharte"},
		]
		var idx := await ask("%s · Oro: %d" % [nm, GS.gold], opts, false)
		if idx == 2:
			end_dialogue()
			return
		if idx == 1:
			GS.gold -= GS.GIFT_COST
			GS.last_gift[who] = GS.day
			GS.add_aff(who, 2)
			show_toast("%s +2" % nm)
			var gl: Array = Data.GIFT_LINES[who]
			await run_steps([Events.s("", gl[0]), Events.s(who, gl[1], "blush")])
			continue
		# Charlar
		GS.last_chat[who] = GS.day
		GS.chats[who] += 1
		var stage := 0
		while stage < 3 and GS.has_seen("%s%d" % [who, stage + 1]):
			stage += 1
		var thresholds := [4, 8, 12]
		if stage < 3 and GS.affection[who] >= thresholds[stage]:
			var id := "%s%d" % [who, stage + 1]
			GS.mark_seen(id)
			await run_event(id)
		else:
			var gain := mini(1 + int(GS.stats[Data.CHARS[who].likes] / 5), 3)
			var chat: String = Data.CHATS[who].pick_random()
			await run_steps([Events.s("", chat)])
			GS.add_aff(who, gain)
			show_toast("%s +%d" % [nm, gain])
		end_dialogue()
		await _end_slot()
		return


# ------------------------------------------------------------------ pantalla principal (hub)

func show_hub() -> Dictionary:
	_clear_ui()
	dlg.visible = false
	hide_portrait()
	set_bg([Color("#4a3a5c"), Color("#5c4636"), Color("#1d1b3a")][GS.slot])

	var top := PanelContainer.new()
	ui.add_child(top)
	top.anchor_right = 1.0
	top.offset_left = 20
	top.offset_right = -20
	top.offset_top = 14
	top.offset_bottom = 74
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 40)
	top.add_child(hb)
	hb.add_child(_label("Día %d / %d  ·  %s" % [GS.day, GS.MAX_DAY, GS.slot_name()], 26, Color("#ffd6f2")))
	hb.add_child(_label("Oro: %d" % GS.gold, 24, Color("#ffe58a")))
	for k in ["valor", "encanto", "magia"]:
		hb.add_child(_label("%s: %d" % [Data.STAT_NAMES[k], GS.stats[k]], 24))

	var left := VBoxContainer.new()
	ui.add_child(left)
	left.position = Vector2(30, 100)
	left.custom_minimum_size = Vector2(420, 0)
	left.add_theme_constant_override("separation", 10)
	left.add_child(_label("¿Qué haces ahora?", 28, Color("#ffd6f2")))
	for stat in ["valor", "encanto", "magia"]:
		var st: String = stat
		left.add_child(_button(Data.TRAIN[st].label, func(): hub_action.emit({"type": "train", "stat": st})))
	left.add_child(_button("Trabajar en el gremio (+25 de oro)", func(): hub_action.emit({"type": "work"})))
	left.add_child(Control.new())
	left.add_child(_button("Guardar y volver al título", func(): hub_action.emit({"type": "quit"})))

	var right := VBoxContainer.new()
	ui.add_child(right)
	right.position = Vector2(480, 100)
	right.custom_minimum_size = Vector2(770, 0)
	right.add_theme_constant_override("separation", 14)
	right.add_child(_label("Habitantes de Aetheria", 28, Color("#ffd6f2")))
	for who in GS.HEROINES:
		right.add_child(_heroine_card(who))

	if autoplay:
		return _autoplay_action()
	return await hub_action


func _heroine_card(who: String) -> Control:
	var c: Dictionary = Data.CHARS[who]
	var card := PanelContainer.new()
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 20)
	card.add_child(hb)

	var swatch := ColorRect.new()
	swatch.color = c.hair
	swatch.custom_minimum_size = Vector2(14, 0)
	hb.add_child(swatch)

	var info := VBoxContainer.new()
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hb.add_child(info)
	var known: bool = GS.met[who]
	info.add_child(_label(c.name if known else "???", 26, c.hair.lightened(0.25)))
	info.add_child(_label(("%s · %s" % [c.title, c.place]) if known else "Aún no la conoces", 18, Color("#d9b8e6")))
	var avail: bool = GS.slot in c.slots
	if avail:
		info.add_child(_label("Disponible ahora", 18, Color("#9be8a8")))
	else:
		info.add_child(_label("No está ahora (viene: %s)" % ", ".join(c.slots.map(func(i): return GS.SLOTS[i])), 18, Color("#c9a2a2")))

	var side := VBoxContainer.new()
	hb.add_child(side)
	if known:
		var hearts := HeartBar.new()
		hearts.set_value(GS.affection[who])
		side.add_child(hearts)
	var btn := _button("Visitar" if known else "Buscar", func(): hub_action.emit({"type": "visit", "who": who}), not avail)
	btn.custom_minimum_size = Vector2(190, 46)
	side.add_child(btn)
	return card


func _autoplay_action() -> Dictionary:
	var pool: Array = []
	for who in GS.HEROINES:
		if GS.slot in Data.CHARS[who].slots:
			for _i in 4:
				pool.append({"type": "visit", "who": who})
	for stat in ["valor", "encanto", "magia"]:
		pool.append({"type": "train", "stat": stat})
	pool.append({"type": "work"})
	return pool.pick_random()


# ------------------------------------------------------------------ finales

func compute_ending() -> String:
	var best := ""
	var best_score := -1
	for h in GS.HEROINES:
		# El afecto manda; si empatan, gana a quien más has dedicado tiempo.
		var score: int = GS.affection[h] * 1000 + GS.chats[h]
		if GS.affection[h] >= 12 and GS.has_seen(h + "3") and score > best_score:
			best = h
			best_score = score
	if best != "":
		return best
	for h in GS.HEROINES:
		if GS.affection[h] >= 5:
			return "friends"
	return "solo"


func show_ending() -> void:
	end_dialogue()
	_clear_ui()
	set_bg(Color("#120a1c"))
	var key := compute_ending()
	var e: Dictionary = Data.ENDINGS[key]
	var col := VBoxContainer.new()
	ui.add_child(col)
	col.position = Vector2(180, 90)
	col.custom_minimum_size = Vector2(920, 0)
	col.add_theme_constant_override("separation", 22)
	var t := _label(e.title, 42, Color("#ffd6f2"))
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(t)
	var rt := RichTextLabel.new()
	rt.fit_content = true
	rt.bbcode_enabled = true
	rt.text = e.text.replace("{n}", GS.player_name)
	rt.add_theme_font_size_override("normal_font_size", 26)
	col.add_child(rt)
	var summary := "Afecto final:  "
	for h in GS.HEROINES:
		summary += "%s %d     " % [Data.CHARS[h].name, GS.affection[h]]
	col.add_child(_label(summary, 22, Color("#d9b8e6")))
	if autoplay:
		return
	col.add_child(_button("Volver al título", func(): ending_done.emit()))
	await ending_done
	show_title()


func _print_summary() -> void:
	print("FIN day=%d gold=%d stats=%s aff=%s ending=%s seen=%s" % [
		GS.day, GS.gold, GS.stats, GS.affection, compute_ending(), GS.seen.keys()])
