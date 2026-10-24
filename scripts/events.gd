class_name Events
extends RefCounted
## Guion del juego. Cada evento es una lista de pasos:
##   {"w": quién, "t": texto, "e": expresión}  -> línea de diálogo ("" = narrador, "me" = protagonista)
##   {"show": id} / {"hide": true}              -> retrato en pantalla
##   {"fade": "texto"}                          -> corte a negro con leyenda
##   {"aff": id, "n": 2}                        -> afecto
##   {"choices": [ {"t","need":{stat:n},"aff":{id:n},"stat":{stat:n},"gold":n,"r":[pasos]} ]}
## "{n}" se sustituye por el nombre del protagonista.

static func s(w: String, t: String, e: String = "") -> Dictionary:
	return {"w": w, "t": t, "e": e}


static func get_event(id: String) -> Array:
	match id:
		"intro": return intro()
		"lyra0": return lyra0()
		"lyra1": return lyra1()
		"lyra2": return lyra2()
		"lyra3": return lyra3()
		"seraphine0": return seraphine0()
		"seraphine1": return seraphine1()
		"seraphine2": return seraphine2()
		"seraphine3": return seraphine3()
		"mira0": return mira0()
		"mira1": return mira1()
		"mira2": return mira2()
		"mira3": return mira3()
		"festival": return festival()
		"termas": return termas()
	return []


static func intro() -> Array:
	return [
		s("", "Aetheria, la aldea de las mil linternas. Llegas con una espada oxidada, una mochila vacía y una deuda de bienvenida."),
		s("marta", "¡Despierta, {n}! Has dormido tres días seguidos. Tu cuarto no se paga solo."),
		s("me", "Marta... ¿qué día es hoy?"),
		s("marta", "Faltan treinta para la Luna de Rosas, la noche en que la gente de Aetheria se declara. Y tú, muchacho, tienes cara de necesitar compañía."),
		s("marta", "Entrena, trabaja y conoce gente. En el bosque vive una arquera, en el templo una sacerdotisa, y en el mercado una zorra con demasiadas colas. Ninguna muerde... mucho."),
		s("me", "(Treinta días. Tres mujeres. Y cero idea de qué hacer. Bien.)"),
		s("", "CONSEJO: Cada día tiene Mañana, Tarde y Noche. Cada chica solo está disponible en ciertos momentos. Sube tus estadísticas para ganarte su corazón."),
	]


# ---------------- LYRA ----------------
static func lyra0() -> Array:
	return [
		{"show": "lyra"},
		s("", "El Bosque Susurrante huele a resina y a hojas húmedas. De pronto, una flecha se clava a un palmo de tu bota."),
		s("lyra", "¡Quieto, furtivo! Este bosque no se caza sin permiso.", "angry"),
		s("me", "¡No soy cazador! Me llamo {n}, soy nuevo en la aldea."),
		s("lyra", "Lyra Vendaval, guardiana del bosque. Y tienes cara de sospechoso.", "neutral"),
		{"choices": [
			{"t": "Levantar las manos y sonreír", "aff": {"lyra": 1}, "r": [
				s("lyra", "Hmpf... al menos no tienes pinta de furtivo. Tienes pinta de tonto.", "blush"),
			]},
			{"t": "Presumir de espada (Valor 2)", "need": {"valor": 2}, "aff": {"lyra": 2}, "r": [
				s("me", "Soy aventurero. Puedo cuidarme solo."),
				s("lyra", "Esa espada está más oxidada que tu argumento... pero me gusta el descaro.", "smile"),
			]},
			{"t": "Quejarte de la flecha", "aff": {"lyra": 0}, "r": [
				s("lyra", "Fue un aviso. La próxima te pica en otro sitio.", "angry"),
			]},
		]},
		s("lyra", "Por la mañana o por la tarde me encontrarás por aquí. No te pierdas, ni me estorbes.", "neutral"),
	]


static func lyra1() -> Array:
	return [
		{"show": "lyra"},
		s("lyra", "¿Has venido a aprender a disparar, o solo a estorbar?", "neutral"),
		s("me", "A aprender. Enséñame."),
		s("lyra", "Postura firme. Pies separados. No... así no, ¡mira!", "angry"),
		s("", "Lyra se coloca detrás de ti, te corrige los hombros, los codos, la cadera. Su cuerpo queda tan cerca que sientes su aliento en la nuca."),
		s("lyra", "Ahora tensa... suelta.", "neutral"),
		s("", "La flecha vuela y da en el árbol equivocado. Lyra se sobresalta, tropieza con una raíz y ambos caéis. Ella queda sobre ti."),
		s("lyra", "¡¿Qué haces ahí tumbado?! ¡Quita esa cara!", "shock"),
		{"choices": [
			{"t": "\"Tú has caído encima de mí...\"", "aff": {"lyra": 1}, "r": [
				s("lyra", "¡C-cállate! ¡Ya me levanto!", "blush"),
			]},
			{"t": "Quedarte quieto, sin mirar (Valor 3)", "need": {"valor": 3}, "aff": {"lyra": 2}, "r": [
				s("lyra", "...No mirar es lo correcto. Buen chico.", "blush"),
			]},
			{"t": "Soltar una carcajada", "aff": {"lyra": 1}, "r": [
				s("lyra", "¡No te rías! ...Aunque la flecha estaba bonita.", "smile"),
			]},
		]},
		s("", "Se aparta, roja hasta las orejas puntiagudas, y se coloca de espaldas. Pero sigue sin irse."),
	]


static func lyra2() -> Array:
	return [
		{"show": "lyra"},
		s("", "Entre unas zarzas, Lyra se agacha a recoger una pluma rara. Se oye un ¡CRAC!"),
		s("lyra", "¡No, no, no! ¡Mi chaleco!", "shock"),
		s("", "Una espina rasgó la tela de cuero. Lyra se abraza el torso para no enseñar de más, con la cara encendida."),
		s("lyra", "No mires. ¡No mires! Si miras te clavo a un árbol.", "angry"),
		{"choices": [
			{"t": "Cubrirla con tu capa", "aff": {"lyra": 2}, "r": [
				s("me", "Toma. Te la quedas hasta que lo arregles."),
				s("lyra", "...Huele a tabaco barato. Pero está caliente. Gracias.", "blush"),
			]},
			{"t": "Bloquear el camino de otros caminantes (Valor 4)", "need": {"valor": 4}, "aff": {"lyra": 3}, "r": [
				s("me", "Cámbiate tranquila, yo vigilo el sendero."),
				s("lyra", "¿Harías de guardián... para mí? Eres más sólido de lo que parecías.", "smile"),
			]},
			{"t": "Intentar mirar de reojo", "aff": {"lyra": -1}, "r": [
				s("", "Una flecha pasa rozándote la oreja."),
				s("lyra", "¡Te dije que no! Sinvergüenza.", "angry"),
			]},
		]},
		{"fade": "Esa tarde, el chaleco fue remendado con hilo verde. Lyra no volvió a mencionar el tema."},
	]


static func lyra3() -> Array:
	return [
		{"show": "lyra"},
		s("", "Una hoguera chisporrotea en un claro. Lyra mira las estrellas, con el arco apoyado en las rodillas."),
		s("lyra", "Soy longeva, {n}. He visto morir a cuatro generaciones de humanos que conocí.", "neutral"),
		s("lyra", "Por eso no suelo acercarme. Duele despedirse.", "neutral"),
		{"choices": [
			{"t": "\"No pienso irme tan pronto.\"", "aff": {"lyra": 2}, "r": [
				s("lyra", "Eso dicen todos... pero tú sonríes cuando lo dices.", "smile"),
			]},
			{"t": "Tomarle la mano (Encanto 3)", "need": {"encanto": 3}, "aff": {"lyra": 3}, "r": [
				s("lyra", "¡Eh! ...No la quites. Está bien así.", "blush"),
			]},
			{"t": "Quedarte en silencio a su lado", "aff": {"lyra": 2}, "r": [
				s("lyra", "Eso sí que sabes hacerlo. Quédate un rato.", "smile"),
			]},
		]},
		s("", "Poco a poco, Lyra apoya la cabeza en tu hombro. Cuando amanece, sigue dormida, sonriendo."),
	]


# ---------------- SERAPHINE ----------------
static func seraphine0() -> Array:
	return [
		{"show": "seraphine"},
		s("", "El Templo de la Aurora huele a incienso y a miel. Una mujer de túnica blanca te recibe con los brazos abiertos."),
		s("seraphine", "¡Bienvenido, hijo de la luz! ¿Vienes a confesarte, a rezar o a compartir el té?", "smile"),
		s("me", "Solo paseaba... Soy {n}."),
		s("seraphine", "Seraphine, sacerdotisa de la Aurora. Un placer. Tienes... una energía interesante.", "smile"),
		{"choices": [
			{"t": "\"Tú también tienes una presencia muy amable.\"", "aff": {"seraphine": 2}, "r": [
				s("seraphine", "Oh, qué dulce. Ven, te daré una bendición de bienvenida.", "blush"),
			]},
			{"t": "\"Vengo a por té y consejo.\"", "aff": {"seraphine": 1}, "r": [
				s("seraphine", "Perfecto. Siéntate, que el té se enfría y los problemas también.", "smile"),
			]},
			{"t": "Bromear sobre rezar por tu cartera", "aff": {"seraphine": 1}, "r": [
				s("seraphine", "Ja, ja, ja... La Aurora tiene paciencia con los pobres. Y con los graciosos.", "smile"),
			]},
		]},
		s("seraphine", "Estaré aquí por las mañanas y por las noches. Pasa cuando quieras.", "smile"),
	]


static func seraphine1() -> Array:
	return [
		{"show": "seraphine"},
		s("seraphine", "¿Podrías ayudarme a llenar la fuente? Los acólitos andan de viaje.", "smile"),
		s("", "Entre los dos acarreáis cubos de agua. Al subir los escalones, Seraphine tropieza y el cubo le cae encima entero."),
		s("seraphine", "¡Aaah! ¡Está fría!", "shock"),
		s("", "Su túnica blanca, empapada, se le pega al cuerpo. Seraphine se cruza de brazos, con las mejillas incendiadas."),
		s("seraphine", "{n}... ¿podrías no mirar? Por favor...", "blush"),
		{"choices": [
			{"t": "Girarte y ofrecerle una manta", "aff": {"seraphine": 2}, "r": [
				s("seraphine", "Eres un caballero. Gracias, de verdad.", "smile"),
			]},
			{"t": "Quitarte la chaqueta y envolverla (Encanto 3)", "need": {"encanto": 3}, "aff": {"seraphine": 3}, "r": [
				s("seraphine", "Oh... qué cálido. Y qué atento. Gracias.", "blush"),
			]},
			{"t": "Quedarte hipnotizado", "aff": {"seraphine": 0}, "r": [
				s("seraphine", "{n}... ¡los ojos arriba, por favor!", "shock"),
			]},
		]},
		{"fade": "Esa tarde, Seraphine se cambió de ropa, y tú fingiste no haber visto nada. Casi lo conseguiste."},
	]


static func seraphine2() -> Array:
	return [
		{"show": "seraphine"},
		s("seraphine", "He abierto el confesionario hoy. ¿Quieres practicar, {n}? Prometo no juzgar.", "smile"),
		s("", "Os sentáis a ambos lados de la celosía. La voz de Seraphine suena más cerca de lo que esperabas."),
		s("seraphine", "Dime, ¿has tenido... pensamientos impuros últimamente?", "neutral"),
		{"choices": [
			{"t": "\"Alguno, sobre una sacerdotisa.\" (Encanto 4)", "need": {"encanto": 4}, "aff": {"seraphine": 3}, "r": [
				s("seraphine", "...Oh. Oh, vaya. Mi penitencia para ti será... quedarte conmigo una hora.", "blush"),
			]},
			{"t": "\"Solo sobre pan caliente.\"", "aff": {"seraphine": 1}, "r": [
				s("seraphine", "Ja, ja, ja... Ese pecado lo comparto.", "smile"),
			]},
			{"t": "Quedarte callado, sonrojado", "aff": {"seraphine": 2}, "r": [
				s("seraphine", "Tu silencio es muy elocuente, {n}.", "blush"),
			]},
		]},
		s("", "Seraphine se abanica con la mano. Hace calor, a pesar del mármol del templo."),
	]


static func seraphine3() -> Array:
	return [
		{"show": "seraphine"},
		s("", "En la terraza del templo, las estrellas parecen al alcance de la mano. Seraphine reza en silencio."),
		s("seraphine", "A veces me pregunto si la Aurora me perdonaría querer algo para mí misma.", "neutral"),
		s("seraphine", "No para el templo. Para mí. Una vida, una compañía.", "neutral"),
		{"choices": [
			{"t": "\"Te lo mereces. Más que nadie.\"", "aff": {"seraphine": 2}, "r": [
				s("seraphine", "Gracias... necesitaba oír eso.", "smile"),
			]},
			{"t": "\"Yo puedo ser esa compañía.\" (Encanto 5)", "need": {"encanto": 5}, "aff": {"seraphine": 3}, "r": [
				s("seraphine", "{n}... mi corazón late tan fuerte que seguro lo oyes.", "blush"),
			]},
			{"t": "Rezar a su lado en silencio", "aff": {"seraphine": 2}, "r": [
				s("seraphine", "Es la mejor plegaria que he compartido nunca.", "smile"),
			]},
		]},
	]


# ---------------- MIRA ----------------
static func mira0() -> Array:
	return [
		{"show": "mira"},
		s("", "El Mercado de los Faroles está lleno de olores y colores. Una mujer con orejas de zorro te agarra de la manga."),
		s("mira", "¡Cliente nuevo! Lo huelo a distancia. Soy Mira, hechicera y vendedora de maravillas.", "smile"),
		s("me", "¿Maravillas?"),
		s("mira", "Pociones de amor, amuletos, secretos de la aldea... Todo a buen precio. Para ti, a precio especial.", "smile"),
		{"choices": [
			{"t": "Seguirle el juego", "aff": {"mira": 2}, "r": [
				s("mira", "¡Oh, me gusta este! No se asusta de una zorra vieja.", "smile"),
			]},
			{"t": "Exigir un descuento (Magia 2)", "need": {"magia": 2}, "aff": {"mira": 2}, "r": [
				s("mira", "Conoces el regateo arcano. Tienes madera, humano.", "smile"),
			]},
			{"t": "Desconfiar", "aff": {"mira": 0}, "r": [
				s("mira", "Sabio. Pero eso no evitará que te sonría.", "smile"),
			]},
		]},
		s("mira", "Me encontrarás por las tardes y noches. Luego no digas que no te avisé.", "smile"),
	]


static func mira1() -> Array:
	return [
		{"show": "mira"},
		s("mira", "Prueba esto, {n}. Poción de sinceridad. Totalmente inofensiva.", "smile"),
		s("", "La bebes de un trago. Sabe a frambuesa y a mala idea."),
		s("me", "Mira, tienes unos ojos preciosos y una sonrisa de zorra encantadora..."),
		s("mira", "¿Q-qué?", "shock"),
		s("me", "...y creo que eres la mujer más hermosa del mercado."),
		s("mira", "¡E-ese no era el efecto! ¡Se suponía que solo ibas a hablar de tus defectos!", "blush"),
		{"choices": [
			{"t": "\"Lo dije en serio.\"", "aff": {"mira": 2}, "r": [
				s("mira", "Basta, basta. Mis colas se me van a erizar.", "blush"),
			]},
			{"t": "Cubrirte la boca, avergonzado", "aff": {"mira": 1}, "r": [
				s("mira", "Ja, ja. Qué adorable eres cuando te sonrojas.", "smile"),
			]},
			{"t": "Contraatacar con ingenio (Magia 3)", "need": {"magia": 3}, "aff": {"mira": 3}, "r": [
				s("me", "Mira, tú no me vendiste la poción. Me la regalaste. ¿Será que querías oírme?"),
				s("mira", "...Touché.", "blush"),
			]},
		]},
	]


static func mira2() -> Array:
	return [
		{"show": "mira"},
		s("mira", "{n}, necesito un favor. Mis colas se enredan con el viento y yo no llego a todas.", "smile"),
		s("", "Mira se sienta frente a ti con un peine. Sus nueve colas se despliegan como un abanico de pelaje suave."),
		s("me", "¿De verdad quieres que yo...?"),
		s("mira", "Con cuidado. Son muy sensibles. Si lo haces mal, hago ruidos extraños. Si lo haces bien... también.", "smile"),
		s("", "Cepillas despacio. Mira se estremece, ahoga un suspiro y esconde la cara entre las manos."),
		{"choices": [
			{"t": "Seguir con delicadeza (Magia 4)", "need": {"magia": 4}, "aff": {"mira": 3}, "r": [
				s("mira", "Mmm... ahí... no, no pares... ¡digo, vale ya, que me delatas!", "blush"),
			]},
			{"t": "Pararte, rojo como un tomate", "aff": {"mira": 1}, "r": [
				s("mira", "¿Ya? Qué cobarde. Pero adorable.", "smile"),
			]},
			{"t": "Bromear con la reacción", "aff": {"mira": 2}, "r": [
				s("mira", "Calla, o te convierto en rana.", "angry"),
			]},
		]},
		{"fade": "La sesión de cepillado terminó con Mira dormida entre cojines, ronroneando bajito. No le dijiste que te dio ternura."},
	]


static func mira3() -> Array:
	return [
		{"show": "mira"},
		s("", "En lo alto de un tejado, el mercado parece un mar de luces. Mira balancea las piernas con las colas relajadas."),
		s("mira", "Trescientos años, {n}. He engañado a reyes, brujos y hasta a un dragón. Pero contigo no sé qué hacer.", "neutral"),
		s("mira", "Me haces sentir como una cachorra con los pies fríos.", "blush"),
		{"choices": [
			{"t": "\"No hace falta que hagas nada.\"", "aff": {"mira": 2}, "r": [
				s("mira", "Qué fácil lo haces sonar...", "smile"),
			]},
			{"t": "Besarle la mano (Encanto 3)", "need": {"encanto": 3}, "aff": {"mira": 3}, "r": [
				s("mira", "¡Ah! ...Eso no estaba en mi guion. Me gusta.", "blush"),
			]},
			{"t": "Sacarle un truco de magia (Magia 5)", "need": {"magia": 5}, "aff": {"mira": 3}, "r": [
				s("", "Haces aparecer una flor de luz. Mira abre mucho los ojos."),
				s("mira", "Eso... lo hizo mi maestra. Gracias por recordármelo.", "smile"),
			]},
		]},
	]


# ---------------- EVENTOS GENERALES ----------------
static func festival() -> Array:
	return [
		{"hide": true},
		s("", "Día 10: el Festival de las Linternas ilumina Aetheria. Faroles de papel suben al cielo y la plaza huele a canela."),
		s("marta", "Venga, {n}. Hoy el que no invita a alguien, se queda mirando linternas solo."),
		{"choices": [
			{"t": "Invitar a Lyra", "who": "lyra"},
			{"t": "Invitar a Seraphine", "who": "seraphine"},
			{"t": "Invitar a Mira", "who": "mira"},
			{"t": "Ir solo y disfrutar", "r": [
				s("", "Compartes dulces con niños, miras las linternas y descubres que la noche no es tan mala."),
				s("", "(Ganas 20 de oro vendiendo dulces por error.)"),
			], "gold": 20},
		]},
	]


static func festival_date(who: String) -> Array:
	var lines := {
		"lyra": [
			{"show": "lyra"},
			s("lyra", "¿Un festival? Odio las multitudes... Pero vale. No me sueltes del brazo, que me pierdo entre tanta gente.", "blush"),
			s("", "Camináis entre puestos y luces. Lyra dispara a un blanco de feria y gana un peluche de conejo."),
			s("lyra", "Es para ti. Que no se te olvide quién te lo dio.", "smile"),
		],
		"seraphine": [
			{"show": "seraphine"},
			s("seraphine", "¡Con gusto! Hace años que no voy al festival sin ser parte de la ceremonia.", "smile"),
			s("", "Seraphine suelta una linterna de papel y pide un deseo en voz baja. No quiere decirte cuál."),
			s("seraphine", "Si lo cuento, no se cumple. Pero te daré una pista: sales en él.", "blush"),
		],
		"mira": [
			{"show": "mira"},
			s("mira", "Vaya, vaya, ¿una cita? Te dejaré pagarme un anticucho. Pero solo uno.", "smile"),
			s("", "Mira te enseña los mejores puestos y te roba un bocado de cada uno. Al final, enciende una linterna con fuego fatuo."),
			s("mira", "No cuentes esto a nadie. Me estás convirtiendo en una zorra tierna.", "blush"),
		],
	}
	return lines[who]


static func termas() -> Array:
	return [
		{"hide": true},
		s("", "Día 20: las Termas de Aetheria están abiertas. Marta te pasa una toalla con una sonrisa maliciosa."),
		s("marta", "Hay entrada separada para hombres y mujeres. Lee bien los carteles."),
		s("", "Entras en el vestuario, con la neblina del vapor llenándolo todo. Cruzas una puerta de bambú... y escuchas voces."),
		{"show": "lyra"},
		s("lyra", "¡¿Tú?! ¡¿Qué haces aquí?!", "shock"),
		s("", "Las tres están en las aguas termales envueltas en toallas, medio ocultas por el vapor. Te quedas paralizado."),
		{"choices": [
			{"t": "Retirarte con los ojos cerrados (Valor 3)", "need": {"valor": 3}, "aff": {"lyra": 2, "seraphine": 2, "mira": 1}, "r": [
				s("seraphine", "Por favor, vuelve a salir con cuidado. Gracias por respetar la intimidad.", "blush"),
				s("lyra", "Al menos tiene vergüenza. Eso suma.", "angry"),
			]},
			{"t": "Pedir perdón con una reverencia", "aff": {"seraphine": 1, "lyra": 1}, "r": [
				s("mira", "¡Ja, ja, ja! Qué humano más educado. Anda, sal antes de que Lyra te flechee.", "smile"),
			]},
			{"t": "Quedarte mirando", "aff": {"lyra": -2, "seraphine": -1, "mira": 1}, "r": [
				s("lyra", "¡FUERA!", "angry"),
				s("", "Una flecha de entrenamiento con ventosa te da en la frente. Sales volando por la puerta de bambú."),
				s("mira", "Valió la pena el espectáculo, ¡aunque sea a tu costa!", "smile"),
			]},
		]},
		{"fade": "Después de aquello, el comentario del día fue el cartel de las termas, que ahora tiene letras diez veces más grandes."},
	]
