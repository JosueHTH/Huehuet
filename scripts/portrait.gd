class_name Portrait
extends Control
## Retrato estilizado dibujado por código (sin imágenes externas).
## Sustituible por arte propio más adelante.

var hair := Color("#7fbf9e")
var skin := Color("#ffe3d1")
var outfit := Color("#4c8f5a")
var accent := Color("#f2d58a")
var kind := "elf"  # elf | priestess | kitsune
var expr := "neutral"  # neutral | smile | blush | shock | angry
var _t := 0.0


func setup(c: Dictionary) -> void:
	hair = c.hair
	skin = c.skin
	outfit = c.outfit
	accent = c.accent
	kind = c.kind
	expr = "neutral"
	queue_redraw()


func set_expr(e: String) -> void:
	if e == "":
		e = "neutral"
	expr = e
	queue_redraw()


func _process(delta: float) -> void:
	_t += delta
	queue_redraw()


func _draw() -> void:
	var s := minf(size.x / 400.0, size.y / 620.0)
	var c := Vector2(size.x * 0.5, size.y)
	var bob := sin(_t * 1.6) * 3.0 * s
	var o := c + Vector2(0, bob)

	# Cola de kitsune (detrás)
	if kind == "kitsune":
		var sway := sin(_t * 1.2) * 14.0 * s
		var tail := PackedVector2Array()
		for i in 13:
			var a := float(i) / 12.0
			var w := sin(a * PI) * 55.0 * s
			tail.append(o + Vector2(70 * s + a * 120 * s + sway * a, -150 * s - a * 130 * s) + Vector2(-w * 0.3, -w))
		for i in 13:
			var a2 := 1.0 - float(i) / 12.0
			var w2 := sin(a2 * PI) * 55.0 * s
			tail.append(o + Vector2(70 * s + a2 * 120 * s + sway * a2, -150 * s - a2 * 130 * s) + Vector2(w2 * 0.3, w2))
		draw_colored_polygon(tail, hair.lightened(0.1))

	# Pelo trasero
	draw_circle(o + Vector2(0, -430 * s), 118 * s, hair)
	draw_rect(Rect2(o + Vector2(-118 * s, -430 * s), Vector2(236 * s, 190 * s)), hair)

	# Cuerpo
	var body := PackedVector2Array([
		o + Vector2(-120 * s, 0), o + Vector2(-95 * s, -250 * s),
		o + Vector2(-40 * s, -310 * s), o + Vector2(40 * s, -310 * s),
		o + Vector2(95 * s, -250 * s), o + Vector2(120 * s, 0),
	])
	draw_colored_polygon(body, outfit)
	# Escote / adornos
	var trim := PackedVector2Array([
		o + Vector2(-40 * s, -310 * s), o + Vector2(0, -250 * s), o + Vector2(40 * s, -310 * s),
		o + Vector2(24 * s, -310 * s), o + Vector2(0, -276 * s), o + Vector2(-24 * s, -310 * s),
	])
	draw_colored_polygon(trim, accent)
	draw_rect(Rect2(o + Vector2(-100 * s, -120 * s), Vector2(200 * s, 14 * s)), accent)
	# Cuello
	draw_rect(Rect2(o + Vector2(-20 * s, -340 * s), Vector2(40 * s, 40 * s)), skin.darkened(0.04))

	# Orejas
	var head := o + Vector2(0, -410 * s)
	if kind == "elf":
		for sx in [-1, 1]:
			draw_colored_polygon(PackedVector2Array([
				head + Vector2(sx * 78 * s, -10 * s), head + Vector2(sx * 160 * s, -45 * s), head + Vector2(sx * 80 * s, 28 * s)]), skin)
	elif kind == "kitsune":
		for sx in [-1, 1]:
			draw_colored_polygon(PackedVector2Array([
				head + Vector2(sx * 40 * s, -80 * s), head + Vector2(sx * 85 * s, -200 * s), head + Vector2(sx * 110 * s, -60 * s)]), hair)
			draw_colored_polygon(PackedVector2Array([
				head + Vector2(sx * 55 * s, -85 * s), head + Vector2(sx * 85 * s, -170 * s), head + Vector2(sx * 98 * s, -70 * s)]), Color("#ffb7c8"))

	# Cabeza
	draw_circle(head, 84 * s, skin)

	# Flequillo
	var fringe := PackedVector2Array([
		head + Vector2(-92 * s, -10 * s), head + Vector2(-80 * s, -90 * s),
		head + Vector2(0, -112 * s), head + Vector2(80 * s, -90 * s),
		head + Vector2(92 * s, -10 * s), head + Vector2(58 * s, -48 * s),
		head + Vector2(20 * s, -30 * s), head + Vector2(-10 * s, -58 * s),
		head + Vector2(-50 * s, -30 * s),
	])
	draw_colored_polygon(fringe, hair)

	# Aureola de sacerdotisa
	if kind == "priestess":
		draw_arc(head + Vector2(0, -135 * s), 60 * s, 0, TAU, 40, accent, 6 * s)

	_draw_face(head, s)


func _draw_face(head: Vector2, s: float) -> void:
	var ey := head + Vector2(0, 8 * s)
	var eye_col := Color("#3b2f4a")
	for sx in [-1, 1]:
		var p: Vector2 = ey + Vector2(sx * 34 * s, 0)
		match expr:
			"smile", "blush":
				draw_arc(p, 14 * s, PI * 1.1, PI * 1.9, 12, eye_col, 4 * s)
			"angry":
				draw_circle(p, 11 * s, eye_col)
				draw_line(p + Vector2(-sx * 16 * s, -14 * s), p + Vector2(sx * 14 * s, -22 * s), eye_col, 4 * s)
			"shock":
				draw_circle(p, 15 * s, Color.WHITE)
				draw_circle(p, 5 * s, eye_col)
			_:
				draw_circle(p, 12 * s, eye_col)
				draw_circle(p + Vector2(3 * s, -4 * s), 4 * s, Color.WHITE)
	var mouth := head + Vector2(0, 52 * s)
	match expr:
		"smile":
			draw_arc(mouth + Vector2(0, -8 * s), 20 * s, PI * 0.15, PI * 0.85, 12, Color("#a33b4f"), 4 * s)
		"blush":
			draw_arc(mouth + Vector2(0, -4 * s), 12 * s, PI * 0.15, PI * 0.85, 12, Color("#a33b4f"), 4 * s)
		"shock":
			draw_circle(mouth, 10 * s, Color("#a33b4f"))
		"angry":
			draw_arc(mouth + Vector2(0, 10 * s), 16 * s, PI * 1.15, PI * 1.85, 12, Color("#a33b4f"), 4 * s)
		_:
			draw_line(mouth + Vector2(-12 * s, 0), mouth + Vector2(12 * s, 0), Color("#a33b4f"), 4 * s)
	if expr == "blush" or expr == "angry":
		for sx in [-1, 1]:
			draw_circle(head + Vector2(sx * 52 * s, 36 * s), 20 * s, Color(1, 0.35, 0.45, 0.45))
	if expr == "shock":
		var d := head + Vector2(80 * s, -30 * s)
		draw_colored_polygon(PackedVector2Array([d + Vector2(0, -22 * s), d + Vector2(-12 * s, 6 * s), d + Vector2(12 * s, 6 * s)]), Color("#8fd3ff"))
		draw_circle(d + Vector2(0, 6 * s), 12 * s, Color("#8fd3ff"))
