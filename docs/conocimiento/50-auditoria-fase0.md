# Auditoría posterior a la Fase 0

> Siete auditores, dos escépticos adversariales. 27-jul-2026.

Cada hallazgo de abajo pasó por dos rondas: un auditor lo levantó, un escéptico con contexto
fresco intentó tumbarlo. Lo que quedó son 24 defectos con archivo, línea y escenario. Los
arreglos propuestos por los auditores fueron corregidos donde el escéptico demostró que el
arreglo metía un error nuevo — esos casos están marcados y explicados, porque la trampa de esta
auditoría no es encontrar bugs sino "arreglarlos" en la dirección equivocada.

---

## Veredicto en una página

**Sí se puede demostrar el 6-ago, pero no con las cifras de estímulo fiscal en pesos como
están hoy.** Esa es la única condición dura.

Lo que sostiene el sí:

- El motor de cuadre es determinístico, puro y bien probado. 248 tests en verde y, más
  importante, los comentarios del repo documentan *por qué* cada regla es como es, con la
  medición detrás. La disciplina de las tres cubetas (deducible / no deducible / por
  confirmar) y el rechazo explícito de la sobrecorrección (`ieps_no_desglosado` fuera de
  REVISAR, `sobre_politica` fuera de NO_DEDUCIBLE_ISR) son juicio fiscal correcto, no
  casualidad.
- El backstop del LLM existe y funciona en el camino que importa: si el modelo llamó
  `cuadrar_viaje`, su texto se reemplaza íntegro por el resumen determinístico. Fail-closed
  si no se puede calcular. Eso es lo que se vende y eso es lo que hace.
- Ningún hallazgo es un crash. El sistema no se cae; cuenta mal en casos acotados.

Lo que obliga a la condición:

- **`iepsAcreditable` no calcula el estímulo del art. 20 apartado A fr. IV de la LIF.** Lee el
  IEPS trasladado del CFDI y lo imprime en verde, en pesos, en el PDF archivable, citando esa
  norma. La norma verificada dice explícitamente que la base es *litros × cuota disminuida
  vigente a la fecha de adquisición*, publicada cada viernes. El motor nunca captura litros ni
  consulta cuota. El error resultante es de **magnitud desconocida** — puede ser cero, puede
  ser grande — y "desconocida" ya es razón suficiente para no imprimirla como cifra
  recuperable en un documento que el contralor archiva.
- **El PDF no cuadra consigo mismo cuando hay un duplicado.** Los renglones impresos suman
  más que el "Total comprobado" de abajo, por exactamente el monto del duplicado. El mismo
  descuadre está en el panel del contralor. Un contralor con calculadora lo ve en la primera
  liquidación con un ticket reenviado — que es el escenario de fraude #1 que el producto dice
  atrapar.
- **Los estímulos del apartado A son ingreso acumulable para ISR** y el PDF los pinta como
  beneficio neto. Aun con el cálculo correcto, promete ~30% más de lo que el cliente se queda.

Lo que **no** cabe antes del demo y hay que decir en voz alta: cerrar la ficha `liva-5.yaml`
transcribiendo la ley, transcribir la LFPDPPP vigente (DOF 20-mar-2025) para el aviso de
privacidad, construir el motor de cuotas semanales de IEPS, y rediseñar el cierre de
liquidación para meter confirmación humana. Ese último en particular: la ficha que lo
justificaría (`lfpdppp-26-II.yaml`) está `sin_verificar` y dice literal "el texto NO se
transcribió". Meter un estado de espera en el camino del cierre a diez días del demo, apoyado
en un artículo que nadie ha leído, sería exactamente el error que este repo declara perseguir.

---

## Bugs confirmados, por daño

Esfuerzo: XS = una línea o dos · S = medio día · M = uno o dos días · L = más, o depende de
leer una norma.

| id | qué rompe | archivo:línea | sev | esf |
|----|-----------|---------------|-----|-----|
| B1 | El PDF y el dashboard imprimen el monto íntegro del duplicado; el total ya lo excluyó. Los renglones no suman el total | `liquidacion/pdf.ts:143-157`, `:216`; `omitidos.ts:29-39`; `dashboard/[id]/page.tsx:92` | crítica | S |
| B2 | `iepsAcreditable` = IEPS trasladado del CFDI, no cuota disminuida × litros; se imprime en pesos citando la norma que dice que esa no es la base | `cuadre/engine.ts:270-272`; `pdf.ts:199`; `dashboard/page.tsx:97` | crítica | S (dejar de imprimir) / L (motor de cuotas) |
| B3 | Los estímulos del apartado A son ingreso acumulable para ISR; el PDF los pinta como beneficio neto | `pdf.ts:186-202`; `dashboard/[id]/page.tsx:56-65` | alta | XS |
| B4 | XML + foto del mismo ticket crean DOS gastos: duplica el comprobado, la deducción y el IVA/IEPS del mismo UUID | `processor.ts:238-272`; `repo.ts:73-112`; ninguna migración pone unique sobre `gasto.cfdi_uuid` | crítica | M |
| B5 | La discrepancia OCR-vs-código se detecta, se guarda y nadie la lee: no genera Diferencia | `intake/ocr.ts:219,298-301` → ausente en `engine.ts` | alta | S |
| B6 | `combustible_efectivo` está en `SIN_ACREDITAMIENTO`, que mata IEPS **e IVA**. La RFA 2026 regla 2.9 conserva la deducción para ISR ⇒ el IVA sí acredita | `cuadre/engine.ts:252` | alta | XS |
| B7 | El IVA se acredita completo sobre el excedente de alimentación que el mismo motor ya restó de deducible | `engine.ts:262` vs `:402-404` | alta | S (tras cerrar `liva-5`) |
| B8 | LIVA 5 fr. III nunca se verifica: no se mira `MetodoPago`, un CFDI PPD acredita antes de estar pagado | `engine.ts:262` | alta | M |
| B9 | El IVA de viáticos timbrados al RFC del operador se suma en silencio; el RLISR 57 salva la deducción, no el traslado | `engine.ts:173-174,262` | alta | S |
| B10 | Falta la leyenda de descargo CFF 89/90 en los dos dashboards y en /demo | `dashboard/page.tsx:97-99`; `dashboard/[id]/page.tsx:56-65`; `demo/page.tsx:53-58` | alta | XS |
| B11 | `guardiaCifras` deja pasar cifras libres si el modelo llamó `consultar_politica` sin cuadrar | `cuadre/guardia.ts:31-34` | alta | M |
| B12 | La gracia anti-carrera de la barrera de intake es 0 ms por defecto; si vence así, es el único camino que **no** avisa al operador | `conv.ts:171`; `processor.ts:287,377-384` | alta | XS |
| B13 | `enriquecerGastoConCodigo` hace UPDATE plano: dos acercamientos concurrentes del mismo monto se pisan el folio | `processor.ts:182-195`; `repo.ts:158-175` | media | S |
| B14 | `normalizarFecha` acepta 31/04; `Date.UTC` desborda en silencio y corre el plazo hasta un mes | `intake/fecha.ts:8-13`; `facturacion/caducidad.ts:34-37` | media | S |
| B15 | El resumen de WhatsApp trunca las observaciones a 6 sin avisar que hay más | `cuadre/resumen.ts:51-53` | media | XS |
| B16 | La diferencia de anticipo se imprime dos veces (Totales + Diferencias) en PDF y dashboard | `pdf.ts:205-220`; `dashboard/[id]/page.tsx:68-80` | media | XS |
| B17 | `kv()` no acota ninguno de sus cuatro valores; **Ruta** desborda el margen derecho con datos reales | `pdf.ts:114-122` | media | XS |
| B18 | `factura_por_vencer` vencido cae al default y suma 100% a `totalDeducible` | `engine.ts:294-304,388-389`; `config.ts:66-74` | media | M |
| B19 | No existe aviso de privacidad en ningún punto del flujo de WhatsApp | todo `processor.ts`; grep de "privacidad" en `src/` = 0 | alta (legal) | M |
| B20 | El análisis de subencargados no cubre a OpenRouter (contraparte directa) ni a Google/Gemini (100% de las fotos) | `llm/models.ts:27` vs `docs/conocimiento/11-datos-personales.md §7-8` | media (legal) | M |
| B21 | `generateStructured` no acumula el costo de los intentos fallidos previos al exitoso | `llm/openrouter.ts:261-293`; `ocr.ts:311-316` | media | XS |
| B22 | El mutex del viaje no bloquea: si la RPC falla, `acquireViajeLock` devuelve `true` y se procede creyendo tener lock | `conv.ts:124-131`; `processor.ts:291-292` | baja | S |
| B23 | `generateWithTools` precifica tokens pre-fallback al precio del modelo post-fallback | `openrouter.ts:377-387` | baja | XS |
| B24 | El prompt del OCR no tiene cláusula anti-instrucción (el del agente sí) | `intake/ocr.ts:47-71` vs `agents/prompts.ts:29-33` | baja | XS |

---

## Los que hay que arreglar ANTES del demo

### B1 — El documento archivable no cuadra consigo mismo

**Escenario.** Viaje con tres comprobantes: caseta $500 con UUID `ABC`, la misma foto reenviada
por error (mismo `ABC`, el motor la marca duplicado) y otra caseta $50. `engine.ts` calcula
`totalComprobado = $550`, correcto. Pero `pdf.ts:150` hace `right(mxn(g.monto), …)` para **todo**
gasto de `liq.gastos`, incluidos los duplicados: la fila sale en rojo con "● revisar" pero con
**$500 impresos**. Y `engine.ts:224` mete `monto: g.monto` en la Diferencia de duplicado, que
`pdf.ts:216` vuelve a dibujar. **Los $500 aparecen tres veces en la hoja** contra un total de
$550. El mismo descuadre existe en `dashboard/[id]/page.tsx:92`, que imprime `mxn(g.monto)` de
todos los gastos bajo una tarjeta "Comprobado" que ya los excluyó.

**Daño.** Cualquier liquidación con un duplicado entrega un PDF que se autocontradice por el
monto exacto del duplicado, en el canal donde el contralor lo revisa con calculadora. Destruye
la credibilidad que `omitidos.ts` fue escrito para proteger.

**Arreglo.** En `pdf.ts`, imprimir `$0.00` (o tachado) en la fila cuya Diferencia sea tipo
`duplicado`, excluirla de la suma de `resumenOmitidos`, y no reimprimirla en DIFERENCIAS con
monto. Mismo trato en el dashboard de detalle. **Añadir** un test —hoy no existe ninguno de PDF
en `npm test`— que asserte `suma_de_renglones_impresos + omitidos.monto === liq.totalComprobado`.
(El auditor original dijo "corregir el test": no hay test que corregir, hay que crearlo.)

### B2 — Dejar de imprimir el IEPS de diésel en pesos

**Escenario.** CFDI de diésel con `iepsTraslado = 900` (caso real de `engine.test.ts:249`) →
`engine.ts:271` pone `iepsAcreditable = 900` → `pdf.ts:199` imprime en verde, en el PDF
archivado: *"IEPS de diésel acreditable vs ISR (LIF 2026 Art. 20): $900.00"*.

**Qué está mal, con precisión.** El estímulo es litros × **cuota disminuida** vigente **a la
fecha de adquisición** del diésel, publicada cada viernes por la SHCP (varió de $7.3634 a
$2.09/L durante 2026, y llegó a $0 varias semanas en 2022). El motor no captura litros y no
consulta cuota. Ahora bien —y aquí el escéptico corrigió al auditor— el camino está doblemente
acotado (`xmlVerificado === true` **y** `claveProdServ === '15101505'`), y un CFDI de gasolinera
que sí desglosa IEPS normalmente traslada el IEPS efectivamente causado, que ya viene neteado
de estímulos. Puede coincidir con la base correcta o no. **El repo no lo sabe porque nunca lo
midió.** La cifra de ~$1M/mes que circula en las fichas corresponde al escenario de cuota fija
constante, no a este. El enunciado defendible es: *se imprime como estímulo del art. 20 ap. A
fr. IV citando esa norma, pero se calcula con una base que la norma dice que no es la base
legal, y el error es de magnitud desconocida.*

**Daño.** Cifra "recuperable" en pesos que el contralor puede llevar a su declaración. Expone a
Likida vía CFF 89/90 (el criterio no vinculativo 1/LIF/NV del Anexo 3 no sanciona por sí mismo,
pero es el que califica la práctica como indebida; su alcance a "quien preste servicios en la
implementación" es la cláusula estándar de los criterios y aquí está **supuesta**, no leída).

**Arreglo pre-demo (S).** No imprimir la cifra en pesos: mostrar litros + cuota fechada + rango,
o marcarla como estimación pendiente de verificación. Quitarla de `/demo` (el $408.62 que enseña
hoy es precisamente el número que la propia empresa reconoce que no puede defender; ponerle una
leyenda no cura un número indefendible — hay que quitar el número).
**Arreglo real (L).** Motor de cuotas semanales fechado contra `g.fecha`, no contra `hoy`.
Ya está en el roadmap como M3.1.
**Bonus gratis en la misma línea.** `pdf.ts:201` y `dashboard/page.tsx:99` citan *"LIF 2026,
Art. 20-A"* para el peaje. **No existe un artículo 20-A**: es el artículo 20, apartado A. Es una
cita muerta impresa en un documento fiscal.

### B3 — Los estímulos son ingreso acumulable y el PDF no lo dice

El párrafo final del apartado A de la LIF establece que los estímulos ahí concedidos son
**ingreso acumulable para ISR** en el momento en que se acreditan. El PDF los agrupa bajo
"ACREDITABLE / RECUPERABLE" en verde y el dashboard bajo "Acreditable / recuperable", sin
matiz. Aun con B2 resuelto, eso le promete al contralor ~30% más beneficio neto del que existe.
Arreglo: una línea de pie en la sección de acreditables. XS.

### B4 — XML y foto del mismo ticket: dos gastos por una compra

**Escenario.** El operador manda la foto del ticket de diésel y segundos después reenvía el XML
que le llegó por correo — el flujo que este código existe para soportar. Ninguno de los dos
mensajes toma el mutex del viaje (solo "listo" lo toma). El handler de documento hace
`getGastos()` y busca `match` **solo por `cfdiUuid` exacto** (`processor.ts:239`); si no lo
encuentra, crea un gasto nuevo con `randomUUID()`. En un ticket de gasolinera el QR que la foto
alcanza a leer es un URL de portal, no el UUID del CFDI: **el gasto de la foto queda con
`cfdiUuid = undefined` y `match` nunca lo encuentra**, con o sin carrera. El gasto nuevo tampoco
lleva `folio`, así que el dedup en memoria de `engine.ts:79-94` (que agrupa por `cfdiUuid` o por
`folio+concepto+monto`) tampoco los junta.

**Daño.** El monto se cuenta dos veces en `totalComprobado` — puede voltear una liquidación de
"debe" a "le deben". Y el daño fiscal que el auditor no vio: contar dos veces el **mismo UUID**
duplica la deducción para ISR y duplica el IVA/IEPS acreditable de ese CFDI en la cifra que el
contralor lleva a su declaración. Un UUID repetido es exactamente lo que el SAT cruza contra
sus propios registros: el error es visible desde afuera.

**Arreglo — ojo aquí.** `unique(tenant_id, viaje_id, cfdi_uuid)` **no resuelve el escenario
principal**: en Postgres los NULL no colisionan en un índice único, y el gasto de la foto tiene
`cfdi_uuid` NULL. Ese constraint solo cubre la carrera estrecha en que ambos traen el mismo
UUID (y ni eso es gratis: `enriquecerGastoConCodigo` también escribe `cfdi_uuid`, `repo.ts:168`).
Lo que cierra el caso es: **antes de insertar desde el XML, buscar un gasto sin `cfdiUuid` que
empate por monto+fecha y hacer UPDATE**, reusando la disciplina de `emparejar.ts` — candidato
único o no se toca nada.

### B5 — La discrepancia OCR-vs-código no llega a nadie

**Escenario** (acotado por el escéptico). Ticket **legible** —el OCR sí leyó un monto, si no
el flujo cae en `soloCodigo` y ni siquiera se da de alta el gasto— cuyo QR o código de barras
decodifica **otro** total: el propio comentario de `ocr.ts` prevé el caso "foto de otro ticket".
La regla "el código manda" (`ocr.ts:219`) sobreescribe `monto` sin condición.
`montoDiscrepante = true` se guarda en `ocrExtra` (`:298-301`) y **nada fuera de `ocr.ts` lo lee**:
`engine.ts` nunca lo consulta, no se genera Diferencia, el PDF y el WhatsApp muestran el monto
del código sin bandera.

**Daño.** Un gasto queda contabilizado por encima o por debajo de lo real sin señal para nadie.
Contradice el comentario del propio código ("eso lo tiene que ver una persona, no taparse"): la
función sí lo tapa.

**Arreglo.** En `engine.ts`, cuando `g.ocrExtra?.montoDiscrepante === true`, emitir una
Diferencia de categoría revisar — igual que `folio_verificar` u `ocr_baja_confianza`. **La nota
debe distinguir el origen del código**: si es el QR fiscal del CFDI, el total es dato timbrado y
el sospechoso es la foto; si el monto viene de `portal.totalPortal` —una liga de autofacturación
de un comercio, sin autoridad fiscal alguna— el sospechoso puede ser el portal.

### B6 — El IVA del diésel en efectivo se está tirando a la basura

`SIN_ACREDITAMIENTO` (`engine.ts:252`) incluye `combustible_efectivo`, y esa lista corta **IEPS
e IVA** en el mismo `continue`. El comentario del código lo justifica: *"la facilidad salva un
beneficio, no los dos"*. Eso es **correcto para el IEPS y falso para el IVA**. La RFA 2026
regla 2.9 —ficha verificada en fuente primaria— conserva la **deducción para ISR** hasta el 15%
del combustible del ejercicio; si el gasto es deducible para ISR, LIVA 5 fr. I lo tiene por
estrictamente indispensable y su IVA acredita. Hoy el motor le quita al cliente el IVA de todo
el diésel pagado en efectivo. Es el mismo patrón de los tres errores históricos del repo, en
sentido inverso. Arreglo: separar la lista que mata IEPS de la que mata IVA. XS.

### B10 — La leyenda de descargo llega a 2 de 4 canales

`docs/conocimiento/21-guardarrailes.md` la lista como acción #1 antes del demo, para
WhatsApp + dashboard + PDF. Hoy cubre WhatsApp y PDF. Faltan **tres** superficies:
`dashboard/page.tsx:97-99` (la tarjeta de estímulos del listado, con las tres cifras y sus
citas), `dashboard/[id]/page.tsx:56-65` (el detalle) y `/demo`. Matiz de prioridad: el dashboard
**sí** es un canal donde la protección del CFF 89 aplica —es una opinión entregada a un cliente
identificado—; `/demo` **no** lo es (marketing público con datos semilla, sin contribuyente ni
asesoría), ahí el riesgo es publicidad engañosa, y la acción correcta no es agregar leyenda sino
quitar el número (ver B2).

### B11 — La garantía de `guardiaCifras` tiene un hueco conocido

**Escenario.** El operador pregunta "¿cuánto llevo del anticipo?". El modelo llama
`consultar_politica` pero no `cuadrar_viaje`, y narra de memoria: *"llevas comprobados como
$8,400 de tus $10,600"*. En `guardia.ts:34`, `cuadro=false` y `consultoPolitica=true` → se
devuelve el texto íntegro sin verificar que esas cifras salgan de ningún lado.

**Calibración** (el escéptico bajó esto de crítica a alta, con razón). No es un hueco
desconocido: `guardia.ts:12-13` lo documenta como decisión deliberada. Y el prompt instruye a
llamar `consultar_politica` y `cuadrar_viaje` en el mismo turno, así que este estado exige que
el modelo se desvíe. **La garantía del encabezado ("el LLM NUNCA reporta cifras que no vengan
de una tool en ese mismo turno") sigue siendo más fuerte de lo que el código sostiene**, y eso
importa porque es una promesa comercial.

**Arreglo — solo uno de los dos que se propusieron.** Parsear los números de `reply` y
contrastarlos 1:1 contra `politica` **no debe implementarse**: produciría falsos positivos sobre
cualquier cifra legítima derivada ("te quedan $350 de los $750 del día"), que son justo las que
el operador necesita. La opción válida es responder los topes con **plantilla fija construida en
código** a partir de `politica`, igual que `resumenCuadre` hace con el cuadre.

### B12 — La barrera de intake protege 0 ms por defecto

`conv.ts:171`: `const grace = Number(process.env.CUADRA_INTAKE_GRACE_MS) || 0`. Meta puede
entregar varias fotos y el "listo" en el mismo POST. Si el contador arranca en 0 porque la RPC
`intake_delta(+1)` de la foto no ha hecho su round-trip, `esperarIntake` devuelve `true` de
inmediato (lo prueba `barrera.test.ts:27-32`) y el "listo" cuadra sin ese comprobante.

**Lo que refuerza el hallazgo:** `processor.ts:377-384` **sí** avisa al operador cuando la
barrera vence por timeout — pero aquí `esperarIntake` devolvió `true` (creyó que se vació), así
que `intakeOk` es true y **no se manda ningún aviso**. El modo de falla del default 0 es
exactamente el único que queda mudo.

**Arreglo.** Subir el default seguro al código (1500-2000 ms), no depender de que cada entorno
ponga la env var. `REPORTE_NOCHE.md` deja explícitamente pendiente replicarla en Vercel.

### B15, B16, B17 — Tres arreglos de media hora en el entregable

- **B15.** `resumen.ts:53` hace `obs.slice(0, 6)` sin avisar. El PDF sí anuncia los que no
  cupieron; WhatsApp —el canal primario— no. **Cuidado al redactarlo:** `:51-52` ya filtró antes
  las de tipo `anticipo` y, para el operador, los nueve tipos `SOLO_CONTRALOR`. El contador debe
  ir sobre `obs` **después** de filtrar, o le prometería al operador observaciones que
  deliberadamente no se le muestran.
- **B16.** La diferencia de anticipo sale en Totales (bold, 13pt) y otra vez como bullet en
  DIFERENCIAS DETECTADAS, en PDF y dashboard; `resumen.ts` sí la filtra. **Cuidado con el caso
  vacío:** en una liquidación que cuadra salvo por el anticipo, esa puede ser la única
  diferencia, y filtrarla dejaría el encabezado con una sección vacía. La condición debe ser
  sobre la lista ya filtrada (`if (filtradas.length)`), no sobre `liq.diferencias.length` como
  está hoy en `pdf.ts:205` y `dashboard/[id]:68`.
- **B17.** `kv()` (`pdf.ts:114-122`) no pasa ningún valor por `cortar()`. El auditor eligió el
  caso menos probable (nombre del operador: 272pt ≈ 49 caracteres, un nombre mexicano rara vez
  llega). **El que revienta con datos reales es RUTA**: de col2=320 al margen 547 son 227pt ≈ 41
  caracteres, y el valor es `origen → destino` — "Ciudad de México → Nuevo Laredo, Tamaulipas"
  ya se pasa, y el síntoma es desbordar el margen derecho, no encimarse. Arreglo idéntico: pasar
  `value` por `cortar()` con el ancho de cada columna.

---

## Los que pueden esperar

**B7 / B8 / B9 — los tres huecos reales contra LIVA art. 5.** Esperan porque el arreglo depende
de leer la ley, y `normas/liva-5.yaml` está `sin_verificar`. Nótese que el inventario del auditor
estaba mal armado: **no** falta el requisito de "trasladado expresamente y por separado"
(`engine.ts:262` solo acredita con `xmlVerificado`, y `ivaTraslado` sale del nodo de traslados
del XML). Los huecos reales son:
- **B7 (prorrateo).** Alimentación de $2,000 con IVA $275.86 y tope diario $750: el motor resta
  $1,250 de `totalDeducible` (correcto) y acredita el IVA **completo**. Se contradice a sí mismo.
  **El arreglo que NO debe hacerse** es meter `viatico_excede_fiscal` a `SIN_ACREDITAMIENTO`:
  `engine.ts:362-364` cuelga el excedente del *último* comprobante del día, así que una comida de
  $200 usada de ancla perdería el 100% de su IVA por un exceso ajeno — el mismo error que el
  repo ya corrigió en `:399-404`. El único arreglo correcto es prorratear:
  `g.ivaTraslado × (monto − excedente) / monto`.
- **B8 (fracción III).** El motor nunca mira `MetodoPago`: un CFDI PPD acredita IVA que todavía
  no se ha pagado.
- **B9 (viáticos al RFC del operador).** El RLISR 57 salva la **deducción** para ISR, pero ese
  IVA no fue trasladado al contribuyente que lo acredita. El motor no emite ninguna diferencia
  (`engine.ts:173-174`): lo suma en silencio. Es el que más se parece a los tres errores
  históricos del repo — una facilidad que salva un beneficio y no el otro.

Mientras la ficha no se cierre, la acción pre-demo es **visual**: marcar la cifra como pendiente
en `pdf.ts:200`, `dashboard/page.tsx:98` y `dashboard/[id]/page.tsx:61`. Que la ficha esté
`sin_verificar` no significa que la cifra esté mal; significa que no se puede afirmar que esté
bien, y eso es lo que la etiqueta verde "ok" afirma hoy.

**B13 — claim atómico en `enriquecerGastoConCodigo`.** Espera porque el caso **secuencial ya
está bien resuelto** y eso el auditor no lo dijo: si C1 pega su folio, cuando llega C2 el filtro
`sinEnriquecer` deja cero candidatos, `emparejarPorMonto` devuelve null, `decidirFoto` cae en
`pedir_ticket` y el código se guarda en la bandeja (`processor.ts:158-181`) sin perder nada. La
pérdida exige la ventana concurrente exacta: dos acercamientos del mismo total, en la misma
ráfaga, con exactamente un candidato sin enriquecer. Arreglo cuando toque: UPDATE condicional
`WHERE ocr_extra->>'folioPortal' IS NULL`, con precedente exacto en `reclamarCodigoPendiente`, y
que el perdedor caiga a la bandeja en vez de descartarse.

**B14 — fechas de calendario imposibles.** Reproducido con node: OCR lee `31/04/2026` →
`normalizarFecha` produce `2026-04-31` sin objetar → `aUtc` desborda a `2026-05-01` → el límite
de mes natural sale `2026-05-31` en vez de `2026-04-30`. **El daño hay que reescribirlo:** los
plazos de 7-15 días del portal que citó el auditor están `sin_verificar` en
`politica-portales-plazos.yaml` (vienen del blog de un competidor, y la ficha prohíbe
presentarlos como obligación fiscal), y "se pierde el CFDI y la deducción" es falso — el CFDI
puede exigirse todo el ejercicio vía Conciliación de Factura. El daño real, que ya basta: el
sistema da una fecha límite y un flag `vencido` **falsos**, y mete el gasto en el mes fiscal
equivocado. Espera porque el arreglo arrastra dos reglas más: devolver `undefined` deja el gasto
sin fecha, y sin fecha `engine.ts:292` salta el aviso de caducidad y `engine.ts:355` mete el
viático en su propio "día" (`sin-fecha:{id}`), evadiendo la agrupación del tope de $750. Lo
consistente con el resto del motor es rechazar la fecha **y** emitir una diferencia de revisión
(precedente exacto: `fecha_sospechosa`, `engine.ts:135-140`).

**B18 — `factura_por_vencer` vencido suma 100% a deducible.** El daño **hoy es cero**:
`totalDeducible`/`NoDeducible`/`PorConfirmar` no se persisten (`repo.ts:285-297`) ni se muestran.
Espera hasta que se conecten esas cifras — pero entonces es bloqueante. **El arreglo del auditor
es fiscalmente incorrecto y hay que rechazarlo tal cual:** mandarlo a `NO_DEDUCIBLE_ISR` le quita
al cliente una deducción que todavía tiene (el cierre de la ventana del portal es política de un
comercio, jerarquía 6, sin fuerza legal; la propia nota del motor en `:296` lo dice). Versión
correcta: (a) emitir un tipo distinto para el caso vencido —hoy `:294-302` usa el mismo tipo para
urgente y vencido, distinguiéndolos solo por el texto— y rutearlo a **POR_CONFIRMAR**; (b) la
segunda mitad del arreglo original ("tickets sin CFDI → POR_CONFIRMAR por default") **vaciaría la
cubeta deducible**: en la política demo ni diésel ni caseta exigen CFDI, así que toda liquidación
real saldría 100% "por confirmar". El hueco de fondo es el default de política: activar
`requiereCfdi` en todos los conceptos **y a la vez** rutear `sin_cfdi` a POR_CONFIRMAR mientras el
ejercicio siga abierto, porque hoy `sin_cfdi` está en `NO_DEDUCIBLE_ISR` (`:388`) y activarlo sin
ese cambio manda toda liquidación con tickets pendientes a "no deducible" — el mismo error, al revés.

**B19 — aviso de privacidad.** El hecho de código es sólido (grep de "privacidad",
"consentimiento", "ARCO" en `src/` no arroja nada) y basta para actuar. **La cuantificación legal
hay que marcarla SUPUESTA**, con tres correcciones que no conviene repetir frente a un cliente:
(1) la obligación de poner el aviso a disposición y la sanción por omitirlo recaen sobre el
**responsable —la flota—**, no sobre el encargado; Likida responde por contrato y por tratar
datos fuera de instrucciones. Decir "expone a Likida por omitir el aviso" es incorrecto e
invierte quién lo redacta. (2) El rango 200,000–320,000 UMA es el rango **duplicado** que la ley
**abrogada** reservaba a datos **sensibles**; los datos financieros exigen consentimiento expreso
pero no son sensibles. (3) Los artículos 58/59 y el 31 del Reglamento son de la ley abrogada; la
vigente es la del DOF 20-mar-2025, el INAI desapareció y sus funciones pasaron a la Secretaría de
Anticorrupción y Buen Gobierno — y la ficha `lfpdppp-26-II.yaml` del repo la tiene `sin_verificar`
y sin transcribir. **Antes de poner números de artículo en un documento que ve un cliente, hay que
bajar la ley vigente de diputados.gob.mx.**

**B20 — subencargados.** Es una brecha de **documentación legal**, no un incumplimiento
demostrado: que nadie salga a cambiar de modelo por esto. Y el eslabón que falta primero **no es
Google, es OpenRouter**: el repo contrata con OpenRouter y Google es subencargado de un
subencargado, así que el pendiente es contractual (anexo de subencargado que cubra su cadena)
antes que una tabla del art. 52 para Google, que Likida no puede exigir directamente. Dos
matices más: mandar datos a un proveedor que los trata **por cuenta** del responsable es una
**remisión**, no una transferencia, y no requiere consentimiento — solo se vuelve transferencia
si el proveedor los trata para fines propios. Y el volumen de dato personal es menor de lo que
parece: un ticket de diésel o caseta trae datos fiscales de la **empresa**; la exposición
personal se concentra en los viáticos timbrados al RFC del operador.

**B21, B23 — el ledger de costos.** No afectan ninguna cifra que vea el operador o el contralor;
solo el margen que mide Likida. B21 pierde el costo entero de los intentos fallidos (arreglo:
acumular por intento, como `generateWithTools` ya hace por ronda en `openrouter.ts:377-378`) y
por eso va antes que B23, que solo mal-precifica. **Magnitud supuesta, no medida:** el "3 de 5
tickets truncados" es la tasa medida *antes* de la escalera de reintento con doble tope; no hay
evidencia de que siga vigente. Y B23 ya se corrigió una vez (`:384-386` lo documenta): lo que
queda es el residuo del caso mixto.

**B22 — mutex del viaje.** Dos "listo" pueden correr el agente completo: duplica costo de LLM,
generación y subida del PDF, y el operador recibe cierre y PDF dos veces. No corrompe cifras
(`guardar_liquidacion_tx` es idempotente). **Detalle que cambia la frecuencia y que el auditor no
vio:** `conv.ts:124-131` hace `return true` cuando la RPC `try_lock_viaje` devuelve **error**
(migración 0005 ausente o RPC caída) — se procede sin lock *creyendo que se tiene*, y el
`viaje.lock_timeout` que se propone observar nunca aparece.

**B24 — prompt del OCR.** Defensa en profundidad, no vulnerabilidad demostrada: `iva_monto` /
`iva_tasa` del OCR **no** alimentan el acreditamiento real (`engine.ts` exige `xmlVerificado`) y
`sanitizarFolio`/`sanitizarTexto` limpian antes del contexto del agente. Agregar la cláusula
anti-instrucción es gratis y correcto. **Las cotas del schema NO deben ponerse como se
propusieron:** un enum `[0.16, 0.08, null]` deja fuera la tasa **0%** y los exentos (LIVA 2-A y 9),
que aparecen en tickets de despensa que los operadores mandan como alimentación — un ticket con
tasa 0 fallaría el `safeParse` y el comprobante se perdería entero. Y un techo a `monto`/`litros`
tiraría comprobantes buenos: un tanque lleno de doble remolque pasa de 1,000 L y de $27,000. Lo
correcto es aceptar el valor y emitir una Diferencia de revisión — que es lo que el motor ya hace
en `engine.ts:107-110` con los montos inválidos y en `config.ts:66-73` con los topes por concepto.

---

## Lo que está bien resuelto

Esto es tan importante como la lista de arriba: son las decisiones que hay que **no romper** al
arreglar lo demás.

1. **La separación entre "no acredita impuestos" y "no es deducible para ISR"**
   (`engine.ts:246-252`). Son dos juicios distintos y el código lo sabe, con el comentario que
   explica por qué `combustible_efectivo` está en una y no en la otra. Al arreglar B6 hay que
   preservar exactamente esa distinción, solo separando IEPS de IVA.
2. **Las tres cubetas, no dos** (`engine.ts:380-405`). `POR_CONFIRMAR` existe precisamente para
   lo que no se sabe. Es la cubeta correcta para B18, y es la razón por la que el arreglo
   propuesto ahí era demasiado fuerte.
3. **El prorrateo del excedente de viáticos** (`engine.ts:399-404`): solo se pierde el excedente,
   no el gasto entero. El comentario —"mandar los $900 completos a no deducible por $150 de
   exceso es el error que más dinero le cuesta al cliente"— es la doctrina correcta del repo, y
   es el mismo argumento que salva a B7 de un arreglo peor que el bug.
4. **La reversión de `ieps_no_desglosado`** (`engine.ts:407-411`): meterlo en REVISAR mandaba
   toda liquidación con diésel a la bandeja y la vaciaba de significado. Es el antídoto
   documentado contra la sobrecorrección, y aplica a B18 y B24.
5. **El acreditamiento exige `xmlVerificado`** (`engine.ts:262`). El IVA e IEPS son *siempre* los
   importes leídos del XML, nunca recomputados con una tasa asumida. Eso ya cierra el requisito
   de "traslado expreso y por separado" del art. 5 — no lo toquen creyendo que falta.
6. **La guardia con reemplazo total y fail-closed** (`guardia.ts`). Cuando el modelo llamó
   `cuadrar_viaje`, su texto se descarta y se usa `resumenCuadre`. Cuando no se puede calcular,
   no se manda ninguna cifra. B11 es un hueco de un camino lateral, no una falla del diseño.
7. **`resumenOmitidos`** existe porque alguien ya entendió que un documento cuyos renglones no
   suman su total pierde credibilidad. B1 es esa misma idea aplicada a los duplicados: el
   principio ya está en el repo, solo falta un caso.
8. **`cortar()` y los pisos de paginación del PDF** (`pdf.ts:88-90`, `PISO_TABLA`, `PISO_PIE`),
   con la nota de que se verificaron mirando el render y no a ojo. B17 es aplicar `cortar()` a un
   sitio más.
9. **La bandeja de códigos pendientes con claim atómico** (`reclamarCodigoPendiente`): el patrón
   correcto ya existe en el repo; B13 es replicarlo.
10. **H1 sigue implementado como aviso** (`alimentacion_sin_soporte`, `engine.ts:306-327`), tal
    como la ficha dice. Verificado en código.
11. **El peaje sobre SubTotal es criterio conservador, y debe quedarse así** — ver abajo.

---

## Refutados

Lo que se descartó, para que no se vuelva a levantar.

**"H1–H7 y otros riesgos de las fichas siguen vigentes" no es un hallazgo.** Es un informe de
estado: no trae escenario nuevo ni entrada→salida, y su ítem H4 es literalmente el mismo
hallazgo del peaje, así que contarlo aparte duplicaba el mismo riesgo. Su valor real es
confirmar que el roadmap del repo sigue reflejando la realidad. Además invertía el signo: usar
SubTotal da ~13.8% **menos** estímulo, no de más — un lector apurado le habría metido mano en la
dirección equivocada.

**El peaje sobre SubTotal: cerrar `lif-2026-20-A.yaml` como "resuelto — criterio conservador",
no como pendiente.** Tres razones: (1) cuando el IVA de la caseta se acredita por separado —que
es justo lo que hace `ivaAcreditable`— ese IVA deja de ser erogación a cargo del contribuyente;
tomar 50% sobre el monto con IVA **y además** acreditar ese IVA duplica el beneficio sobre la
misma cantidad; (2) el estímulo es ingreso acumulable, así que inflar la base infla también el
ingreso acumulable y el beneficio neto crece mucho menos que el 13.8% del papel; (3) el motor
solo suma peaje de CFDI con `xmlVerificado`, es decir de casetas donde el IVA sí se acredita.
Si algún día se cambia, tendría que condicionarse a que el IVA de **esa** caseta no se haya
acreditado. **Lo que sí falta y vale más dinero es H5/H6**: el 50% se aplica a toda caseta sin
verificar Red Nacional, sin el tope de $300M de ingresos y sin la exclusión de partes
relacionadas — y esas tres son condiciones de la **ley**, no de una regla administrativa. Ahí
el motor **sobre**acredita, que es el lado caro del error.

**Arreglos concretos que NO deben implementarse** (cada uno metería un error nuevo):

| se propuso | por qué no |
|---|---|
| Meter `viatico_excede_fiscal` a `SIN_ACREDITAMIENTO` | Mata el IVA de los $750 que sí son deducibles. El excedente se cuelga del último comprobante del día, así que una comida de $200 de ancla perdería todo su IVA por un exceso ajeno. Solo prorrateo. |
| Mandar `factura_por_vencer` vencido a `NO_DEDUCIBLE_ISR` | Le quita al cliente una deducción vigente: el CFDI se puede exigir todo el ejercicio y existe la Conciliación de Factura. Va a POR_CONFIRMAR. |
| "Tickets sin CFDI → POR_CONFIRMAR por default" | Vaciaría la cubeta deducible: en la política demo ni diésel ni caseta exigen CFDI. Toda liquidación real saldría 100% "por confirmar". |
| `unique(tenant_id, viaje_id, cfdi_uuid)` como solución al doble gasto | Los NULL no colisionan en Postgres, y el gasto de la foto tiene `cfdi_uuid` NULL — que es el caso principal. Solo cubre la carrera estrecha. |
| Parsear los números de `reply` y contrastarlos 1:1 contra `politica` | Falsos positivos sobre cifras derivadas legítimas ("te quedan $350 de los $750"), que son las que el operador necesita. Plantilla fija en su lugar. |
| Enum `[0.16, 0.08, null]` para `iva_tasa`; techo a `monto`/`litros` | Deja fuera tasa 0% y exentos (LIVA 2-A y 9): un ticket de despensa fallaría `safeParse` y se perdería entero. Un tanque de doble remolque pasa de 1,000 L. Aceptar y emitir Diferencia. |
| "Corregir el test del PDF" | No existe ninguno: `grep -rln generarLiquidacionPDF` solo devuelve `tools.ts` y `pruebas-manuales/pdf.prueba.ts`, que no entra en `npm test`. Hay que **crearlo**. |
| Rediseñar el cierre para meter confirmación humana | La ficha que lo obligaría (`lfpdppp-26-II.yaml`) está `sin_verificar` y dice "el texto NO se transcribió"; su propio impacto está escrito en condicional. Además es discutible que una liquidación —aritmética de comprobado contra anticipo— "evalúe la situación económica o la fiabilidad" de nadie. Primero se cierra la ficha. |

**El escenario del nombre de operador largo en `kv()`** se refutó como estaba planteado (272pt
≈ 49 caracteres; un nombre mexicano rara vez llega) y se reemplazó por el que sí ocurre con
datos reales: **Ruta**, 227pt ≈ 41 caracteres para `origen → destino`. Mismo arreglo, escenario
defendible. Ver B17.

**"El código dañado produce la discrepancia OCR"**: no. Un código ilegible no decodifica nada y
no hay discrepancia; y si el OCR no leyó monto, el flujo cae en `soloCodigo` y el gasto ni
siquiera se da de alta. El caso vivo es ticket legible con un código que decodifica otro total.
El factor 10x del ejemplo es ilustrativo, no medido.
