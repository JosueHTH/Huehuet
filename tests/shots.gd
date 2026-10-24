extends SceneTree
## Capturas de pantalla para revisar la UI:
##   xvfb-run -a godot --path . --script tests/shots.gd -- <carpeta_salida>

var main: Control
var gs: Node
var out_dir := "/tmp"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out_dir = args[0]
	gs = root.get_node("GS")
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	_run()


func _shot(name: String) -> void:
	for i in 6:
		await process_frame
	root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out_dir, name])


func _run() -> void:
	await _shot("1_title")
	gs.reset("Kael")
	gs.day = 5
	gs.slot = 1
	gs.met["lyra"] = true
	gs.met["mira"] = true
	gs.affection["lyra"] = 7
	gs.affection["mira"] = 3
	gs.stats = {"valor": 4, "encanto": 2, "magia": 3}
	main.show_hub()
	await _shot("2_hub")
	main._clear_ui()
	main.run_event("lyra2")
	await create_timer(1.2).timeout
	main.type_tween.kill()
	main.text_label.visible_ratio = 1.0
	await _shot("3_dialogo")
	for who in ["lyra", "seraphine", "mira"]:
		main.show_portrait(who)
		for e in ["blush", "shock"]:
			main.portrait.set_expr(e)
			await create_timer(0.6).timeout
			await _shot("p_%s_%s" % [who, e])
	quit()
