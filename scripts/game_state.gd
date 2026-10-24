extends Node
## Estado global de la partida (autoload "GS").

const MAX_DAY := 30
const SLOTS := ["Mañana", "Tarde", "Noche"]
const SAVE_PATH := "user://save.json"
const GIFT_COST := 20
const HEROINES := ["lyra", "seraphine", "mira"]

var player_name := "Kael"
var day := 1
var slot := 0
var gold := 50
var stats := {"valor": 1, "encanto": 1, "magia": 1}
var affection := {"lyra": 0, "seraphine": 0, "mira": 0}
var met := {"lyra": false, "seraphine": false, "mira": false}
var seen := {}
var last_gift := {"lyra": 0, "seraphine": 0, "mira": 0}
var last_chat := {"lyra": 0, "seraphine": 0, "mira": 0}
var chats := {"lyra": 0, "seraphine": 0, "mira": 0}


func reset(new_name: String) -> void:
	player_name = new_name if new_name.strip_edges() != "" else "Kael"
	day = 1
	slot = 0
	gold = 50
	stats = {"valor": 1, "encanto": 1, "magia": 1}
	affection = {"lyra": 0, "seraphine": 0, "mira": 0}
	met = {"lyra": false, "seraphine": false, "mira": false}
	seen = {}
	last_gift = {"lyra": 0, "seraphine": 0, "mira": 0}
	last_chat = {"lyra": 0, "seraphine": 0, "mira": 0}
	chats = {"lyra": 0, "seraphine": 0, "mira": 0}


func advance() -> void:
	slot += 1
	if slot >= SLOTS.size():
		slot = 0
		day += 1


## Si pasas 4 días sin hablar con una heroine que ya conoces, su afecto baja.
func apply_decay() -> Array:
	var lost: Array = []
	for h in HEROINES:
		var gap: int = day - last_chat[h]
		if met[h] and affection[h] > 0 and gap >= 4 and gap % 4 == 0:
			affection[h] -= 1
			lost.append(h)
	return lost


func is_over() -> bool:
	return day > MAX_DAY


func slot_name() -> String:
	return SLOTS[slot]


func add_aff(who: String, amount: int) -> void:
	affection[who] = clampi(affection[who] + amount, 0, 15)


func has_seen(id: String) -> bool:
	return seen.has(id)


func mark_seen(id: String) -> void:
	seen[id] = true


func save_game() -> void:
	var data := {
		"player_name": player_name, "day": day, "slot": slot, "gold": gold,
		"stats": stats, "affection": affection, "met": met, "seen": seen,
		"last_gift": last_gift, "last_chat": last_chat, "chats": chats,
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))


func has_save() -> bool:
	return FileAccess.file_exists(SAVE_PATH)


func load_game() -> bool:
	if not has_save():
		return false
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	var data = JSON.parse_string(f.get_as_text())
	if typeof(data) != TYPE_DICTIONARY:
		return false
	player_name = data.get("player_name", "Kael")
	day = int(data.get("day", 1))
	slot = int(data.get("slot", 0))
	gold = int(data.get("gold", 50))
	for k in stats:
		stats[k] = int(data.get("stats", {}).get(k, 1))
	for h in HEROINES:
		affection[h] = int(data.get("affection", {}).get(h, 0))
		met[h] = bool(data.get("met", {}).get(h, false))
		last_gift[h] = int(data.get("last_gift", {}).get(h, 0))
		last_chat[h] = int(data.get("last_chat", {}).get(h, 0))
		chats[h] = int(data.get("chats", {}).get(h, 0))
	seen = data.get("seen", {})
	return true
