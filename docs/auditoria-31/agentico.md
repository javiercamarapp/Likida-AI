# Sistema agéntico y orquestación — auditoría 31

**Nota: 4/10** (antes 4). Razón del movimiento: **ninguna — se queda**, y las dos
razones que sí tengo apuntan en direcciones contrarias y se cancelan. Lo digo con
números contables, no con juicio:

- **Se atacó y subió (+):** el CRÍTICO AG-C1 de la 30 **está cerrado de verdad**.
  Lo abrí primero, como pedía el encargo: `sat_descarga/ciclo.ts:342-357` mueve
  `marcar(..., 'ignorado')` FUERA del `if (!yaDescargado)` y deja el contador
  `r.consolidados++` adentro (`:357`), que era la mitad sutil. El `update` de
  `marcar` (`:403-407`) es idempotente sobre un CFDI ya `'ignorado'`, así que
  repetirlo en cada re-ingesta no cuesta nada. Ese consolidado ya no se queda en
  la cola «nadie reportó este gasto».
- **Mirada más profunda (−):** encontré un **ALTO nuevo en el camino feliz del
  demo** (foto → «listo» → PDF) que ni la 29 ni la 30 vieron: el cierre le dice
  al chofer que su PDF **no se entregó** y despierta a Javier por WhatsApp, en el
  caso exacto en que `sendDocument` **ya lo encoló** y el outbox lo va a entregar
  en cinco minutos. El repo conoce ese mecanismo tan bien que **subió el TTL de la
  firma a 900 s precisamente para que ese reintento funcione**
  (`processor.ts:1284-1307`, AGEN-9) — y la rama que decide qué decirle al humano
  no lo consulta.

Contable, para que mañana se distinga medición de impresión:

| Medida | Valor de hoy |
|---|---|
| Hallazgos abiertos de la 30 verificados uno por uno | 4 de 4 abiertos + 5 reincidentes del 29 |
| Siguen intactos **línea por línea** | **8 de 9** (solo AG-C1 cerró) |
| Llamadores de `pdfEstadoDe` sobre los 3 envíos de PDF del cierre | **2 de 3** (`processor.ts:1187`, `avisar_cierre.ts:282`; falta `processor.ts:4804`) |
| Selladores de carta muerta (`descartarCartaMuerta`) | **1**, y solo ve `type='image'` (`conv.ts:994`) |
| Archivos de prueba del rubro corridos hoy | 20 archivos / 256 pruebas, verdes |

El ancla de 3 («existe un estado donde la base dice una cosa y el usuario cree
otra») sigue tocando por **tres** caminos distintos: el ALTO nuevo del PDF y los
dos ALTOs de `sat_descarga` de la 30. Se queda en 4 y no en 3 por lo mismo que
argumentó la ronda anterior y que volví a comprobar: la maquinaria de
concurrencia es buena de verdad (mutex firmado, claim con lease y fencing,
barrera fail-closed, orden por chofer en tres capas) y ahora además el CRÍTICO
cerró con prueba.

**El riesgo mayor del rubro, hoy:** el producto trata «Meta no me contestó» y
«Meta rechazó esto para siempre» como el mismo hecho en el último metro del
cierre — el único metro que el contralor y el chofer ven — y contesta el más
alarmante de los dos.

---

## Estado de los hallazgos abiertos de la 30

Verificados uno por uno con el fuente delante. El árbol es el mismo que calificó
la 30 (`git diff 5ce91b2..HEAD` = dos dotfiles de `normas/`), así que todo lo que
sigue abierto lo está **por construcción**; lo verifiqué igual porque un hallazgo
que ya no está sería un hallazgo mal reportado.

| Hallazgo 30 | Dónde lo verifiqué hoy | Veredicto |
|---|---|---|
| **[CRÍTICO]** El consolidado reintentado se queda en `'disponible'` | `ciclo.ts:342-357` — `marcar` fuera del `if`, contador adentro | **CERRADO** ✅ |
| **[ALTO]** Un consolidado que lanza se da por bajado y avanza el calendario | `ciclo.ts:358-360`, `:394`, `:660`, `:687-709` | **REINCIDENTE** |
| **[ALTO]** La puerta de idempotencia de `guardarYConciliarConsolidado` falla ABIERTA | `consolidado.ts:421-439`, `:440-443`, `:457-483`, `:505-529` | **REINCIDENTE** |
| **[MEDIO]** «Sin respuesta» la apaga un segundo usuario de la flota | `exito.ts:1372-1379`, `soporte.ts:280-285` | **REINCIDENTE** (no lo repito abajo: sin código nuevo, el texto de la 30 sigue siendo exacto) |
| **[ALTO 29]** `escalado` no re-arma su filo | `escalar_viaje.ts:274-281`, `:285`, `:465-467` | **REINCIDENTE, 4ª ronda** |
| **[MEDIO 29]** El prompt ordena narrar el remanente que la guardia prohíbe | `prompts.ts:79`, `guardia.ts:108-121`, `tools.ts:163-172` | **REINCIDENTE** (con daño medido nuevo) |
| **[MEDIO 29]** La carta muerta que no es foto no la drena nadie | `conv.ts:994`, `wa_pendientes.ts:316-325,344-361` | **REINCIDENTE** (sube a ALTO, evidencia nueva) |
| **[BAJO 29]** `definitivo` sella para el contralor y no para el chofer | `avisar_cierre.ts:92-99` vs `processor.ts:1200-1208` | **REINCIDENTE** |
| **[BAJO 29]** El «listo» sin hora se abandona mudo | `processor.ts:4009-4015` | **REINCIDENTE** |

---

## Hallazgos

### [ALTO] El cierre le dice al chofer «tu PDF no se entregó» y despierta a Javier por WhatsApp justo cuando el PDF **ya está encolado y va a llegar**; encima no sella la entrega, y el siguiente «gracias» se lo manda por segunda vez

`src/lib/likida/processor.ts:4804` (`const enviado = await sendDocument(...)`) ·
**`:4805-4817`** (la rama `!enviado.ok`: `logger.error` + `alertarOperador` +
el texto al chofer) · **`:4818-4823`** (el `else` es el ÚNICO que sella) ·
`:97` (importa `pdfEstadoDe` y **no lo usa aquí**) · `:1187-1199` (el camino de
reentrega que SÍ lo usa) · `src/lib/meta/client.ts:557-563` (el catch de red
**encola** y devuelve `{ok:false}` **sin `codigo`**) · `:566-571` (un código
reintentable **también encola**) · `src/lib/likida/avisar_cierre.ts:110-117`
(`pdfEstadoDe`: sin `codigo` → `'encolado'`) ·
`src/lib/likida/processor.ts:1284-1307` (`TTL_FIRMA_PDF_SEGUNDOS = 900`,
subido en AGEN-9 **para que el reintento del outbox a los 300 s funcione**) ·
`src/lib/observability/alerta.ts:191` (`pdf\.no_entregado` está en
`EVENTOS_DE_DINERO` → sale también por WhatsApp a `ALERTA_WA`) ·
`src/lib/likida/processor.ts:2286-2295` (la reentrega que se dispara después).

**Escenario, con valores.** Flota Innovativos. El chofer Juan cierra su viaje
`V-4410`: anticipo $12,000.00, comprobado $9,681.00. `guardar_liquidacion` OK,
los dos PDF en el bucket, `viaje.estatus = 'liquidado'`, `liquidacion.pdf_url =
'11111111-…/v4410.pdf'`. `createSignedUrl` devuelve su liga de 900 s.

1. `sendDocument` hace el POST a la Graph API y el `fetch` se cae por red
   (`AbortSignal.timeout(10_000)` o un `ECONNRESET`). `client.ts:562` **mete el
   payload entero —`link` incluido— a `wa_outbox` con
   `RETRASO_AMBIGUO_SEGUNDOS = 300`** y devuelve
   `{ ok:false, error:'No se pudo contactar a WhatsApp: fetch failed' }`,
   **sin `codigo`**.
2. `processor.ts:4805` solo mira `!enviado.ok`. Entonces, en este orden:
   - `logger.error('pdf.no_entregado', …)`;
   - `alertarOperador('pdf.no_entregado', …)` → correo «[Likida] Falló
     pdf.no_entregado» **y WhatsApp a `ALERTA_WA`**, porque `alerta.ts:191` lo
     clasifica como evento de dinero;
   - al chofer: *«Tu liquidación ya quedó cerrada ✅, pero el PDF **no se te
     entregó** por un problema del chat. **Pídeselo a tu contralor**: él ya lo
     tiene en el panel. 🙏»*;
   - **no se llama `sellarEntregaLiquidacion`**: `entregada_operador_en` queda
     en `null`.
3. **Cinco minutos después el outbox entrega el mismo payload** y Juan recibe su
   `liquidacion.pdf`. El aviso del punto 2 era falso, y el TTL de 900 s existe
   exactamente para que ese reintento funcione (lo dice el comentario de `:1294`
   y lo fija la prueba `processor_cierre.test.ts:219-223`).
4. **Y el sello sin poner cobra otra vez.** Juan escribe «gracias». Ya no tiene
   viaje abierto, así que cae en `:2278`: `liquidacionRecienteDe` trae la
   liquidación con `entregadaOperadorEn: null`, el atajo de `:2286` no aplica, y
   `entregarCierrePendiente` **vuelve a firmar Storage y a mandar el mismo PDF**.
   Juan recibe su liquidación **dos veces**, con dos ligas firmadas distintas del
   mismo documento.

**Lo que hace esto un hallazgo y no una opinión:** la función que traduce el
`{ok, codigo}` de `sendDocument` a «esto se va a arreglar solo / esto no» ya
existe, ya está exportada *"porque el mismo contrato lo usan DOS llamadores"*
(`avisar_cierre.ts:106-109`), y **este es el tercero, que no la llama**. El
camino de reentrega (`:1192-1199`) y el aviso al jefe (`:4912-4915`) sí la
consultan. El camino feliz —el que se proyecta en la sala— es el único que no.

Consecuencia: el chofer es mandado a molestar a su contralor por un documento que
ya viene en camino; el contralor recibe la llamada y concluye que el producto no
entrega lo que promete; y el operador del sistema recibe una alarma de dinero, a
las 3 a.m. y por WhatsApp, por un blip de red de diez segundos que el propio
sistema ya resolvió. Es el mismo vicio que `alertarHuecoConfiguracion`
(`alerta.ts:327-344`) documenta como «enseñar a Javier a ignorar el correo».

Causa raíz probable: en esta rama «Meta no contestó» y «Meta dijo que no» son el
mismo booleano (`!enviado.ok`), y el sistema contesta siempre el peor de los dos.

---

### [ALTO] Una carta muerta que NO es foto no la sella nadie: el chofer nunca se entera de que su mensaje se perdió, y la alarma del cron queda encendida una vez por hora durante 90 días — REINCIDENTE (la 30 lo reportó como MEDIO; sube por daño medido, no por código nuevo)

`src/lib/likida/conv.ts:994` (`.eq('evento->>type','image')`) ·
`src/lib/likida/wa_pendientes.ts:344-361` (`descartarCartaMuerta`) ·
`src/lib/likida/processor.ts:4100-4133` (**su único llamador**, dentro de
`if (cierreSolicitado)` y solo sobre `fotoAnterior.muertas`) ·
`wa_pendientes.ts:316-325` (`cartasMuertas()` cuenta **todas**, sin filtrar tipo)
· `src/app/api/cron/wa-pendientes/drenado.ts:241-245` (la alerta) · `:251-254`
(el latido) · `src/lib/observability/alerta.ts:43` (`PISO_ALERTA_MS` = 1 h) ·
`:281-282` (la huella del piso es `codigo=cartas_muertas`, constante) ·
`supabase/migrations/0155_purgas_y_bucket_comprobantes.sql:148-151` (las cartas
muertas se conservan **90 días**).

**Escenario, con valores.** El chofer Juan reporta una avería por texto:
*«talacha, me cobran 800»*, wamid `wamid.HBgMNTI…A1`. Su fila entra a
`wa_evento_pendiente` con `tipo_evento = 'text'`. Cinco corridas seguidas del
cron la reclaman y `processInbound` lanza las cinco veces (un `resolverCuentaOficina`
que devuelve ambigüedad, un OCR de la cadena que truena, lo que sea):
`anotarFalloPendiente` la deja con `intentos = 5`.

Desde ese instante:

1. **La fila es invisible para el cron** (`0325:55-56` y `:95-96` filtran
   `intentos < 5`) y **no bloquea** la cadena de Juan (el `not exists (anterior …
   intentos < 5)` de `0325:100-106` la excluye a propósito). O sea: nunca se va a
   procesar sola, y nada aguas abajo lo nota.
2. **Nadie la sella.** `descartarCartaMuerta` tiene exactamente **un** llamador,
   y la lista que le llega sale de `consultarFotoAnterior`, que filtra
   `evento->>type = 'image'` (`conv.ts:994`). Un texto, un pin de ubicación, una
   nota de voz o un XML no entran nunca a esa lista.
3. **Juan no recibe una palabra.** Su reporte de avería —el que dispara la
   autorización del jefe— desaparece. Él ve sus dos palomitas azules.
4. **Y la alarma se queda encendida.** `cartasMuertas()` devuelve `1` en **cada**
   corrida (el cron corre cada minuto); `drenado.ts:244` llama
   `alertarOperador('cron.wa_pendientes', { codigo:'cartas_muertas' })`, cuya
   huella de piso es constante → **un correo «Urgente» por hora, para siempre**,
   más el `registrarLatido('wa-pendientes', 'parcial')` de `:251-254` que deja
   ese cron **amarillo en `/admin/crons` sin interrupción**. Hasta que la purga
   de la `0155` la borre: **90 días · 24 = ~2,160 correos** del mismo incidente
   ya conocido.

**Intenté refutarlo y no se sostiene.** (a) `grep` de `descartarCartaMuerta` da
dos apariciones fuera de pruebas: su definición y el llamador de `processor.ts`.
(b) No hay otro escritor de `procesado_en` sobre `wa_evento_pendiente`: el único
es el sellado de éxito del drenado. (c) El comentario de la `0155:145-146` dice
«el cron las grita a diario» — el código las grita en cada corrida, con el piso
horario de `alerta.ts` como único freno.

Consecuencia: un chofer con una ponchadura pagada de su bolsa y ningún rastro de
que reportó; y el canal que Javier tiene para enterarse de los incidentes REALES
del sistema queda inservible durante tres meses por uno solo ya atendido. Es
textualmente el modo de falla que `alertarHuecoConfiguracion` se escribió para
evitar, un archivo más allá.

Causa raíz probable: «carta muerta» se modeló como un caso de la barrera de
fotos del cierre, no como un estado terminal de la bandeja con su propio cierre
hacia el humano.

---

### [ALTO] `escalado` no re-arma su filo para la flota que se compuso: el aviso queda mudo DE POR VIDA — REINCIDENTE, 4ª ronda

`src/lib/likida/escalar_viaje.ts:274-281` (`anota`, definida fuera pero **llamada
solo dentro** del `for (const v of viajes)` de `:285`) · `:465-467`
(`for (const [tenantId, c] of porFlota)` — el cierre de corrida solo recorre lo
que `anota` metió) · `:496-501` (el `avisar(..., { hayProblema: c.folios.length > 0 })`)
· `src/lib/likida/agentes/notificaciones.ts:990-993` (`cerrarIncidente` es lo
ÚNICO que re-arma) · `:515-522` (`debeAvisar`: agotadas las marcas, *«ya se avisó
con N y no queda nada nuevo que decir; vuelve a avisar cuando esto se resuelva y
reaparezca»*).

**Escenario, con valores.** Flota Innovativos, `horasEscalacion = 6`.

- **Semana 1.** Tiene 1, luego 4, luego 12 viajes sin confirmar. `avisar` manda
  sus tres correos y `magnitud_avisada` llega a `12`: `marcaAlcanzada(12)` es la
  última marca, así que `debeAvisar` devuelve el texto de `:520`.
- **Semana 2.** El despachador arregla el problema: los choferes confirman a
  tiempo y **la consulta de candidatos deja de devolver viajes de esa flota**
  (`:246-250` filtra por `avisadoEn <= ahora - horas`).
- **Aquí está el defecto.** Sin candidatos, el `for` de `:285` no corre ni una
  vuelta para ese tenant → `anota` nunca se llama → **`porFlota` no lo contiene**
  → el `for` de `:465` no lo visita → **`avisar(..., hayProblema:false)` no se
  llama jamás** → `cerrarIncidente` no corre → el incidente **nunca cierra**.
- **Semana 5.** Vuelve a pasar. `previo.ultimo.magnitud = 12`,
  `incidenteCerrado = false` (`actualizado_en` no se movió), y `debeAvisar` vuelve
  a `:515-522`: silencio. **La flota no vuelve a recibir un aviso de escalación
  nunca más**, mientras `/dashboard/notificaciones` sigue enseñando el
  interruptor encendido.

El propio `notificaciones.ts:954-959` nombra a `escalar_viaje.ts` como el
llamador responsable de esto: *«Que un (agente, evento) llegue aquí con
`hayProblema: false` cuando de verdad ya no hay problema es responsabilidad de
QUIEN LLAMA»*. El fix de la 28 (AG-A5) movió la llamada fuera del
`if (c.folios.length > 0)`, pero la dejó dentro de `porFlota` — y `porFlota`
tiene el mismo dominio que tenía el `if`: flotas **con candidatos hoy**.

Consecuencia: el dueño de la flota que arregló su operación pierde para siempre
la alarma que compró, y el día que vuelva a romperse nadie se lo dice. Es el
peor sentido de la falla: se apaga al portarse bien.

Causa raíz probable: «flotas que este barrido evaluó» se derivó de «flotas con
trabajo este barrido», y el cierre de incidente necesita la primera.

---

### [ALTO] Un consolidado cuya conciliación lanza se da por bajado, avanza el calendario fiscal y no se reintenta NUNCA — REINCIDENTE

`src/lib/likida/sat_descarga/ciclo.ts:358-360` (el `catch` empuja a `r.errores`
y `continue`) · **`:394`** (`ingerir` devuelve `{completo:true}` aunque haya
errores) · `:660` (`if (resultado.completo) bajados.push(p)`) · `:604,687-709`
(`todoBien` **nunca lo tocan los errores** → `estado: 'descargada'` y
`ultima_descarga_hasta` avanza) · `src/app/api/cron/descarga-sat/route.ts:155-157`
(`sano` mira `errores === 0` → el latido sí sale `'parcial'`, pero **el TEXTO del
error no viaja**: `registrarLatido` recibe el conteo).

Lo verifiqué otra vez porque el fix de AG-C1 tocó estas mismas líneas y podía
haberlo arrastrado: **no lo hizo**. Con `marcar` ahora fuera del `if`, el orden
es `try { guardarYConciliar(); marcar(); }` — si `guardarYConciliar` lanza,
`marcar` tampoco corre, y el sello sigue en `'disponible'`. El escenario de la
30 (ECC `9f3c…a1`, 412 líneas, 380 gastos sellados, cero filas en
`cfdi_consolidado_linea`, paquete anotado como bajado, calendario al 31 del mes)
se reproduce línea por línea.

Consecuencia: el mes de diésel más caro del año queda medio conciliado y fuera
del alcance de cualquier reintento automático; la única señal es un `1` junto a
un `parcial`, indistinguible del `1` de un XML ilegible del mismo paquete.

Causa raíz probable: `ingerir` trata «este CFDI falló» y «este paquete terminó»
como hechos independientes, y solo el segundo decide si el trabajo se da por
hecho.

---

### [ALTO] La puerta de idempotencia de `guardarYConciliarConsolidado` falla ABIERTA y puede revertir la resolución HUMANA de una línea — REINCIDENTE

`src/lib/likida/intake/consolidado.ts:421-439` (el `try/catch` deja
`existentes = null` y **sigue**) · `:440-443` (la salida temprana que ese bloque
dice ser) · `:457-470` (`selladoPorIndice`, que solo reconoce el trabajo de la
MÁQUINA: gastos con `cfdi_orden`) · `:477-483` (el JOIN se re-corre para toda
línea sin gasto sellado) · `:505-529` (el `upsert` con `estatus` en el payload y
**sin** `resuelto_por`/`resuelto_en`) · `:609-618` (`resolverLineaAMano` →
`estatus = 'sin_match'`, que por definición **no sella ningún gasto**) ·
`src/lib/likida/sat_descarga/ciclo.ts:340-341` (el llamador que `d0db998` hizo
vivo en cada re-ingesta).

Escenario, valores y refutación: idénticos a la 30 (línea `indice = 7`,
`monto = 1,842.50`, el contador Luis declarando «ninguno corresponde» el
2-sep-2026). Lo verifiqué de nuevo con el fuente delante y el comentario de
`:419-420` —*«El error de lectura conserva su camino de siempre (seguir al JOIN,
que la reanudación de abajo protege)»*— **sigue siendo falso**: la reanudación de
`:445-470` protege las líneas cuyo gasto quedó sellado, y `sin_match` es
precisamente la resolución que no sella ninguno.

Consecuencia: un veredicto humano firmado se revierte en silencio, el expediente
le atribuye al contador una decisión que no tomó, y el gasto queda con
`xml_verificado = true` — la bandera que abre el bloque de acreditamiento.

Causa raíz probable: la puerta que declara «este CFDI ya se procesó» falla
abierta, y su respaldo reconoce el trabajo de la máquina pero no el del humano.

---

### [MEDIO] El prompt ORDENA narrar una cifra derivada que la guardia define como inventada: cada «hola» del chofer planta un evento de seguridad de severidad media y paga un cuadre entero — REINCIDENTE (con daño nuevo, medido)

`src/lib/agents/prompts.ts:79` (*«ÁBRELE con los números (cuántos comprobantes
lleva, cuánto suman, cuánto era el anticipo, **cuánto queda**)»*) ·
`src/lib/likida/tools.ts:163-172` (lo que `estado_viaje` **de verdad devuelve**:
`anticipo`, `comprobado`, `comprobantes`, `copias_excluidas`, `por_concepto`,
`litros_diesel_leidos` — **no hay remanente**) ·
`src/lib/likida/cuadre/cifras.ts:137-145` (*«una cifra DERIVADA por el modelo
(restar el anticipo del comprobado, por ejemplo) **no está respaldada** aunque
sus operandos sí lo estén»*) · `src/lib/likida/cuadre/guardia.ts:108-121`
(el cotejo) · **`:119`** (`registrarEventoSeguridad({ tipo:'cifra_sin_respaldo' })`)
· `:143,152` (se cae al reemplazo con `cuadrarDesdeDB`) ·
`src/lib/seguridad/eventos.ts:38` (`severidad: ev.severidad ?? 'media'`) ·
`:90-102` (`getEventosSeguridad`, el panel de Trust & Safety).

**Escenario, con valores.** Viaje `V-4410`: `anticipo = 12000`,
`comprobado = 9681`, 4 comprobantes. El chofer escribe «¿cómo vas?».

1. El prompt obliga: el modelo llama `estado_viaje` y contesta *«Llevas 4
   comprobantes por $9,681.00 de un anticipo de $12,000.00; **te quedan
   $2,319.00**.»*
2. `guardiaCifras`: `cuadro = false`, `consultoRespaldo = true`,
   `tieneCifrasDeDinero = true` → entra al bloque de `:108`.
   `cifrasSinRespaldo` extrae `9681`, `12000`, `2319`; **`2319` no está en el
   respaldo** porque ninguna tool lo devolvió y el archivo declara a propósito
   que no acepta derivadas → `fuera = [2319]`.
3. `logger.warn('guardia_cifras_sin_respaldo')` **y** un `INSERT` en
   `evento_seguridad` con `tipo = 'cifra_sin_respaldo'`, `severidad = 'media'`.
4. No hay `return`: el flujo cae a `:143` y **se paga un `cuadrarDesdeDB`
   completo** (viaje + gastos + config + perfil, más el acumulado del ejercicio)
   para sustituir el texto por el resumen determinístico — que dice lo mismo.

Consecuencia doble, y la segunda es la que importa para el demo: la pantalla de
Trust & Safety de `/admin` se llena de eventos de severidad **media** generados
por el camino que el propio prompt ordena, así que el tablero que existe para
detectar un chofer intentando manipular al modelo mide, en realidad, cuántas
veces el chofer saludó. Y cada saludo cuesta un cuadre.

Causa raíz probable: el prompt le pide al modelo una cifra que ninguna tool
calcula, y la guardia —correctamente— la trata como inventada. Las dos mitades
son coherentes consigo mismas y contradictorias entre sí.

---

### [BAJO] `definitivo` sella la entrega del contralor y no la del chofer: la asimetría queda al revés de quién sí puede pedirlo por otro lado — REINCIDENTE

`src/lib/likida/avisar_cierre.ts:92-99` (`pdfListoParaSellar` acepta `'encolado'`
y `'definitivo'`) · `src/lib/likida/processor.ts:1200-1208` (el camino del
CHOFER: `'definitivo'` → `pdf = 'fallo'`, **sin sellar**) · `:4912-4915` (el
camino del JEFE en el cierre, que sí acepta `'definitivo'`).

**Escenario, con valores.** Meta devuelve `131030` (destinatario fuera de la
lista de pruebas) para el número de Juan. El PDF del jefe se sella con una
alerta única; el de Juan **no**, así que el sello `entregada_operador_en` se
queda en `null` y cada mensaje suyo dentro de las 24 h vuelve a firmar Storage y
a pegarle a la Graph API hasta agotar `TECHO_REENTREGAS_POR_PROCESO = 2`
(`processor.ts:1134`) — un techo **por proceso**, que una invocación fría
reinicia (lo dice `:1127-1132`).

Consecuencia: gasto repetido de Storage y Graph API por un rechazo que nunca va a
dejar de serlo, y un chofer que lee «el PDF no se te pudo entregar» en cada
turno. Es deuda, no dinero mal: la liquidación está cerrada y el contralor la
tiene.

Causa raíz probable: `pdfListoParaSellar` se escribió para el jefe y el camino
del chofer se quedó con el `if/else` anterior.

---

### [BAJO] El «listo» sin hora de Meta se abandona MUDO y consume su intento hasta volverse carta muerta — REINCIDENTE

`src/lib/likida/processor.ts:4009-4015`: `logger.error('cierre.timestamp_indeterminado')`,
`await soltarClaim()`, `return` — **sin un solo `say`**.

`soltarClaim()` sin `sinConsumirIntento` hace que `processInbound` devuelva
`'reintentable'` (`:1544`), y el drenado lo traduce a `anotarFalloPendiente`
(`drenado.ts:163`), o sea que **sí gasta intento**. Cinco vueltas y el «listo»
es carta muerta — que, por el hallazgo de arriba, tampoco la sella nadie porque
`type = 'text'`.

**Escenario, con valores.** Un mensaje entra por el simulador de QA o por un
llamador interno sin `timestampMs` ni `recibidoMs` (filas anteriores al deploy
que añadió `recibidoMs`). El chofer escribe «listo»; el turno se cae aquí cinco
veces seguidas y él no recibe nada, ni la primera vez ni la quinta. Su viaje se
queda `abierto` para siempre y su liquidación no existe.

Consecuencia: el modo de falla «se trabó» sin que nadie diga que se trabó — el
que este archivo lleva seis rondas cerrando en todos los demás `return`
(el del mutex ocupado a `:4225-4227`, el de `intake.incremento_fallido` a
`:4398`, el del `catch` general a `:4986`). Éste es el único que se quedó mudo.

Causa raíz probable: el `return` se añadió para cortar un bucle infinito de
reintentos y se le puso el rastro en el log, que es para nosotros, no para él.

---

### [BAJO] El degradado por OpenRouter caído corre `cuadrarDesdeDB` DOS veces en el mismo turno y ensucia la señal de «el modelo inventó cifras»

`src/lib/likida/processor.ts:4544-4550` (el degradado:
`reply = resumenCuadre(await cuadrarDesdeDB(...), false, 'operador')`) ·
`:4605-4610` (`guardiaCifras(reply, agentTools, ...)` con `agentTools = []`) ·
`src/lib/likida/cuadre/guardia.ts:102` (no sale temprano: el texto **sí** tiene
cifras) · `:143` (`liq = snapshotCierre ?? await cuadrarDesdeDB(...)`) · `:152`.

**Escenario, con valores.** OpenRouter devuelve 429 en las seis rondas.
`runAgent` lanza, `isTransientError` dice `true`, y el degradado arma el resumen
determinístico con un `cuadrarDesdeDB` en modo `best_effort`. Ochenta líneas
después `guardiaCifras` recibe ese texto con `agentTools = []`: `cuadro` es
`false` y `consultoRespaldo` es `false`, así que ni siquiera llega al cotejo —
cae directo a `:143` y **vuelve a correr `cuadrarDesdeDB`** para reemplazar el
texto del MOTOR por otro texto del MOTOR. Y `:4607` escribe
`logger.warn('agent.cifras_forzadas')` en un turno donde **el modelo no escribió
una sola palabra**.

Es exactamente el defecto que TC-A1/TC-M1 (auditoría 28) cerró para el cierre
recuperado — `replyDeCierreRecuperado` narra el snapshot archivado en vez de
recalcular, y su comentario de `:1405-1413` dice *«Dos `best_effort` en el mismo
turno pueden diferir entre sí»*. Esta rama se quedó sin el mismo tratamiento.

Consecuencia: dos lecturas del ejercicio en el turno en que el sistema ya está
degradado y con el presupuesto quemado, y un contador (`agent.cifras_forzadas`)
que mide otra cosa de la que dice medir para quien lo lea mañana.

Causa raíz probable: la guardia asume que su entrada siempre viene del modelo;
en este camino viene del motor.

---

## Lo que revisé y está bien

Abierto, leído y recorrido con la pregunta del rubro («si muere aquí, ¿qué ve el
humano y qué quedó en la base?»):

- **El cierre de AG-C1**, ya descrito: `ciclo.ts:342-357`. El razonamiento del
  comentario es correcto y el reparto entre `marcar` (fuera) y `r.consolidados++`
  (dentro) es la parte que no era obvia.
- **El mutex del viaje, de punta a punta** (`conv.ts:821-918`): `'indeterminado'`
  es un tercer estado real, no un `false` disfrazado; la ventana de despliegue
  (`p_token` de la 0280 sin aplicar) reintenta sin token **y solo abre si la
  segunda llamada también dice «función ausente»** (`:881-891`, ALT-151); y el
  llamador (`processor.ts:4209-4231`) le dice al chofer cosas distintas y ciertas
  para `'ocupado'` y para `'indeterminado'`. El lease se firma (`nuevoTokenDeLock`)
  y solo con esa firma se suelta (`:4988`).
- **El claim del mensaje con lease y fencing** (`conv.ts:551-644`,
  `processor.ts:1493-1549`): cuatro estados, no dos; `'indeterminado'` **no**
  abandona el turno con su razón escrita (`:1512-1520`); el renovador con
  `unref()` y guardia de re-entrada (`conv.ts:635-644`); y `soltarClaim` distingue
  «aplazado sin consumir intento» de «abandonado», que es lo que hace que el
  drenado (`drenado.ts:152-164`) devuelva el intento en `'sin_tiempo'` y lo
  consuma en el resto.
- **La barrera de ráfaga es fail-closed en los tres puntos donde importa**:
  `intakeDelta` devuelve `null` y no `0` (`conv.ts:1046-1055`); el sondeo dejó de
  ser una escritura y trata el contador vencido por TTL como 0 **con su log**
  (`:1082-1106`); `esperarIntake` trata `null` como «no sé» y **no abre**
  (`:1156-1159`), con gracia inicial configurable para la carrera fotos+«listo».
  Y el `+1` que no se confirma corta la foto en vez de seguir (`processor.ts:2395-2411`).
- **El orden por chofer tiene tres capas y las tres están vivas**: la RPC
  (`0325:40-66`: `row_number()` por remitente + `anterior_arrendado`), el claim
  anclado con `not exists(anterior …)` (`0325:95-106`), y el `break` del drenado
  cuando un mensaje no termina (`drenado.ts:126-133,167`). Verifiqué además que
  una carta muerta **no** bloquea la cadena: el `anterior` filtra `intentos < 5`.
- **El destinatario del veredicto**: los **cuatro** llamadores de `resumenCuadre`
  pasan `'operador'` explícito (`processor.ts:1418`, `:4316`, `:4546`,
  `guardia.ts:152`). `SOLO_CONTRALOR` se filtra ANTES de contar, así que el «…y N
  observaciones más» no le promete al chofer algo que no va a ver
  (`resumen.ts:86-101`), y el descargo legal solo va al contralor (`:123`).
- **`guardiaCifras` con snapshot de cierre** (`guardia.ts:88-91,137-143`): sin
  snapshot **no se recalcula** — se dice «Ya cerré tu liquidación ✅» y se manda
  el PDF. Ningún camino puede narrar un cuadre distinto del impreso.
- **La base es la autoridad sobre el cierre, en los DOS caminos**
  (`processor.ts:4359-4381` camino feliz, `:4462-4476` camino de excepción), con
  `confirmarCierreEnBase` (`:1333-1399`) devolviendo **tres** respuestas y
  degradando a «cerrado sin snapshot» en vez de a «no sé si cerró» (`:1377-1385`).
- **El reloj compartido de la invocación** (`presupuesto.ts:301-335`): arranca en
  el inicio de LA INVOCACIÓN y no del mensaje; `margenDuro()` es distinto de
  `restante()` por la identidad que AGEN-A1 documenta; y `MARGEN_CIERRE_CRITICO_MS`
  se deriva de la tabla `PASOS_CIERRE`, que una prueba compara contra el fuente.
- **El ciclo del analista del panel** (`agents/analista.ts:406-497` +
  `api/dashboard/chat/route.ts:116-177`): el reintento correctivo **borra
  `CAPTURAS` antes** (`:429`), suma el costo de la primera vuelta al error antes
  de soltarlo (`:455-463`), y el `finally` del stream siempre cierra con un
  evento `{t:'error'}` — el turno que truena no deja al contralor mirando un
  spinner. El timeout de 40 s es **uno** para los dos ciclos (`:368-369`), así que
  cabe en el `maxDuration = 60` de la ruta.
- **`runAgent`** (`agents/run.ts:61-103`): combina tres señales de aborto, el
  `clearTimeout` vive en el `finally`, y `costoPorModelo` se propaga para que
  `processor.ts:4392-4400` registre una fila por modelo cuando el ciclo cruzó de
  proveedor.
- **`cerrarRafagasPorCorte` cierra SOLO la libreta del teléfono que se quedó sin
  reloj** (`processor.ts:1439-1443`), que era el fix de la 24 — con pool de 5
  cadenas, cerrar todas producía dos cifras y ninguna verdadera.

## Lo que NO alcancé a revisar

- **Los ~45 motores de agente** (`agentes/{backoffice,direccion,crecimiento,…}.ts`).
  Esta ronda abrí `escalar_viaje.ts` y `notificaciones.ts` completos; `exito.ts`
  lo abrió la 30. Los demás siguen sin caminar: **4ª ronda**.
- **`copiloto-tools.ts` (cross-tenant), `copiloto-intents.ts` y
  `copiloto-historial.ts`**: sexta ronda fuera. Leí `analista.ts` entero por
  primera vez y ahí salió limpio; el copiloto es otro ciclo y no lo toqué.
- **`agentes/enviador.ts` y la cadencia de campaña bajo concurrencia real.**
- **La ráfaga bajo concurrencia REAL.** Leí `intakePendientes`, `esperarIntake`,
  `intentarLockViaje` y las tres capas de orden en la 0325, y monté los casos en
  papel; **no** monté dos invocaciones solapadas. Séptima ronda sin rehacerlo.
- **`sat_descarga/peaje_cierre.ts`**: comparte `venceEn` con la descarga y es la
  otra mitad de esa ruta; solo lo miré desde el lado del reloj.
- **El camino de oficina del consolidado sin reloj** (`processor.ts:1667-1672`):
  `guardarYConciliarConsolidado` se llama ahí **sin `venceEn`**, a diferencia de
  `ingerirRep` dos líneas arriba (`:1657`, que sí recibe
  `Date.now() + reloj.restante()`). La asimetría es real y la leí; **no la
  reporto** porque no pude fijar valores que demuestren que un ECC típico no cabe
  en la invocación, y un hallazgo sin escenario medible no es un hallazgo.
- **Nada que exija base viva.** Los tres ALTOs de `sat_descarga`/bandeja se
  argumentan sobre el fuente, las migraciones (`0325`, `0155`) y las pruebas
  existentes; el comportamiento de `wa_outbox` se deriva de `meta/client.ts:557-571`
  y del comentario probado de `processor.ts:1284-1307`, leído, no ejecutado.
- **No corrí la suite completa** (la corre el orquestador). Corrí 20 archivos del
  rubro: `guardia`, `rafaga`, `ciclo_flota`, `wa_pendientes`,
  `wa_pendientes_carta_muerta`, `processor_cierre`, `processor_cierre_parcial`,
  `agents/run`, `agents/prompts` y la familia `conv*` — **256 pruebas, todas
  verdes**, para confirmar que leo el árbol vivo.
