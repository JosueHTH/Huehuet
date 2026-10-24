class_name Data
extends RefCounted
## Datos estáticos: heroínas, lugares y textos de acciones.

const CHARS := {
	"lyra": {
		"name": "Lyra", "title": "Arquera élfica", "age": "27 en apariencia, 140 años reales",
		"place": "Bosque Susurrante", "likes": "valor", "slots": [0, 1],
		"hair": Color("#6fc2a0"), "skin": Color("#ffe6d5"), "outfit": Color("#3f7d52"),
		"accent": Color("#d9c27a"), "kind": "elf", "bg": Color("#173d2b"),
	},
	"seraphine": {
		"name": "Seraphine", "title": "Sacerdotisa de la Aurora", "age": "26 años",
		"place": "Templo de la Aurora", "likes": "encanto", "slots": [0, 2],
		"hair": Color("#f3d98b"), "skin": Color("#ffe9dc"), "outfit": Color("#f4f1ea"),
		"accent": Color("#e0b44c"), "kind": "priestess", "bg": Color("#3a3358"),
	},
	"mira": {
		"name": "Mira", "title": "Hechicera kitsune", "age": "24 en apariencia, 300 años reales",
		"place": "Mercado de los Faroles", "likes": "magia", "slots": [1, 2],
		"hair": Color("#f08a5d"), "skin": Color("#ffe1cf"), "outfit": Color("#8a3fa8"),
		"accent": Color("#ffd166"), "kind": "kitsune", "bg": Color("#4a1f45"),
	},
}

const HOME_BG := Color("#2b2233")

const STAT_NAMES := {"valor": "Valor", "encanto": "Encanto", "magia": "Magia"}

const TRAIN := {
	"valor": {
		"label": "Entrenar espada (Valor +1)", "place": "Patio de entrenamiento",
		"texts": [
			"Golpeas el muñeco de paja hasta que te tiemblan los brazos.",
			"El maestro de armas asiente. Algo es algo.",
			"Corres diez vueltas alrededor del patio. Tu orgullo sufre más que tus piernas.",
		],
	},
	"encanto": {
		"label": "Practicar etiqueta (Encanto +1)", "place": "Salón de la posada",
		"texts": [
			"Ensayas una reverencia frente al espejo. Casi suena sincera.",
			"Aprendes tres piropos nuevos. Dos son terribles.",
			"Marta te corrige la sonrisa: \"Menos dientes, más ojos\".",
		],
	},
	"magia": {
		"label": "Estudiar magia (Magia +1)", "place": "Biblioteca del gremio",
		"texts": [
			"Tu hechizo de luz parpadea como una vela con hipo, pero mejora.",
			"Un grimorio polvoriento te enseña a no incendiar tus cejas.",
			"Consigues levitar una manzana. La manzana no está de acuerdo.",
		],
	},
}

const WORK_TEXTS := [
	"Cazas ratas gigantes en el sótano del gremio. Huelen peor de lo que muerden.",
	"Escoltas un carro de nabos hasta la aldea vecina. Heroico, a su manera.",
	"Lavas platos en la posada. Marta te paga y te advierte: \"Ni una palabra\".",
]

const GIFT_LINES := {
	"lyra": ["Lyra frunce el ceño al recibir el paquete... y luego esconde una sonrisa.", "\"No necesitaba esto. Pero... gracias, tonto.\""],
	"seraphine": ["Seraphine junta las manos con los ojos brillantes.", "\"¡Qué detalle tan hermoso! La Aurora te bendiga... y yo también.\""],
	"mira": ["Mira olfatea el regalo, mueve las orejas y sonríe de lado.", "\"Mmm, buen gusto. Casi parece que me conoces, humano.\""],
}

const CHATS := {
	"lyra": [
		"Lyra te enseña a leer huellas en el barro. Te llama \"cabeza hueca\" tres veces, pero no se va.",
		"Compartís un trozo de pan de bellota. Ella finge que no se ríe de tu cara al probarlo.",
		"Lyra afina su arco mientras habla de las estrellas del bosque. Es la primera vez que la oyes tan tranquila.",
	],
	"seraphine": [
		"Seraphine te cuenta historias de santos con tanta pasión que se le cae el libro de himnos dos veces.",
		"Os sentáis en las escaleras del templo. Ella tararea una melodía que hace que el tiempo se frene.",
		"Seraphine te ofrece té de flores. Está tan caliente que ambos soplan a la vez y se miran, riendo.",
	],
	"mira": [
		"Mira te vende \"un amuleto de la suerte\". Descubres después que es una tapa de olla. Vuelve a reírse.",
		"Mira te enseña un truco con fuego fatuo y te roba el sombrero mientras miras la llama.",
		"Mira apuesta contigo a quién adivina el próximo cliente del mercado. Pierdes. Te cobra con un beso en el aire.",
	],
}

const ENDINGS := {
	"lyra": {
		"title": "Final de Lyra: El arquero y la flecha",
		"text": "Bajo la Luna de Rosas, Lyra te entrega una flecha con una pluma de su arco: en su pueblo, es una promesa.\n\n\"Un elfo vive siglos. Quiero que cada uno de los tuyos... lo pase a mi lado.\"\n\nEn el Bosque Susurrante, dos siluetas comparten una sola manta. Fundido a negro.",
	},
	"seraphine": {
		"title": "Final de Seraphine: Bendición compartida",
		"text": "Seraphine cuelga su estola de sacerdotisa y te toma de la mano frente a la fuente del templo.\n\n\"La Aurora me enseñó que el amor también es una plegaria. Quiero rezarla contigo, cada mañana.\"\n\nLas campanas suenan. Esa noche, el templo guarda un silencio muy, muy sonrojado. Fundido a negro.",
	},
	"mira": {
		"title": "Final de Mira: El mejor truco",
		"text": "Mira hace aparecer mil faroles flotando sobre el mercado, y entre ellos, uno en forma de corazón.\n\n\"Trescientos años de trucos, y tú eres el único que no vi venir.\"\n\nSus nueve colas te envuelven como una manta cálida. Los faroles se apagan uno a uno. Fundido a negro.",
	},
	"friends": {
		"title": "Final: Amigos para siempre",
		"text": "Las tres te aprecian de verdad y la Luna de Rosas os encuentra en la misma mesa, discutiendo a gritos quién paga la cuenta.\n\nNo hay confesión, pero sí algo que quizá madure con el tiempo. Tal vez el año que viene.",
	},
	"solo": {
		"title": "Final: Aventurero solitario",
		"text": "La Luna de Rosas ilumina la plaza vacía. Brindas con Marta, que te da una palmada en la espalda.\n\n\"Anímate, chico. Aetheria tiene muchos días por delante.\"\n\n¿Y si la próxima vez te animas a hablar con ellas?",
	},
}
