class_name HeartBar
extends Control
## Barra de afecto: 5 corazones, cada uno vale 3 puntos.

const HEARTS := 5
const PER_HEART := 3.0

var value := 0


func _init() -> void:
	custom_minimum_size = Vector2(190, 34)


func set_value(v: int) -> void:
	value = v
	queue_redraw()


func _draw() -> void:
	for i in HEARTS:
		var fill := clampf((value - i * PER_HEART) / PER_HEART, 0.0, 1.0)
		var c := Vector2(17 + i * 36, 17)
		_heart(c, 14.0, Color(1, 1, 1, 0.15))
		if fill > 0.0:
			_heart(c, 14.0, Color(1.0, 0.3, 0.45, 0.35 + 0.65 * fill))


func _heart(c: Vector2, r: float, col: Color) -> void:
	draw_circle(c + Vector2(-r * 0.5, -r * 0.2), r * 0.58, col)
	draw_circle(c + Vector2(r * 0.5, -r * 0.2), r * 0.58, col)
	draw_colored_polygon(PackedVector2Array([
		c + Vector2(-r * 1.04, -r * 0.0), c + Vector2(r * 1.04, -r * 0.0), c + Vector2(0, r * 1.05)]), col)
