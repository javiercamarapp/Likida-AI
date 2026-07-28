# Detección de fraude y desviaciones en el gasto de flota

> Ola 2 — 27-jul-2026. Construido sobre la ola 1.

## Resumen para el fundador

1. **El fraude de flota en México no es exótico: es sobre todo combustible.** La firma Pulpo declara que el 80% de los fraudes de flotilla en México viene de cargas irregulares de diésel — doble ticket, carga fraccionada, acuerdos informales entre operador y despachador — y que la auditoría manual solo atrapa ~20% de eso contra ~95% de la automatizada. Es una cifra autodeclarada de un proveedor (SIN VERIFICAR, no la repitas como estadística oficial), pero coincide con lo que Edenred, Geotab y Ubícalo describen de forma independiente sobre el mercado mexicano: ordeña, "compras ficticias", despacho corto por bomba descalibrada y colusión despachador-operador.
2. **Likida hoy ya captura más de lo que parece, pero menos de lo que el encargo asumía.** El motor (`engine.ts`) ya corre deduplicación por UUID/folio, valida forma de pago del combustible, topa viáticos contra el tope fiscal y marca fecha sospechosa. Eso es control fiscal, no antifraude — pero es la base sobre la que se construye todo lo de abajo.
3. **Dos de los campos que el encargo asume que ya existen, no existen.** `hora` se descarta al normalizar la fecha (`fecha.ts` solo guarda `YYYY-MM-DD`) y `rendimiento` no se puede calcular porque no hay una entidad `Unidad` con capacidad de tanque ni kilómetros recorridos en ningún lado del modelo de datos. Esto no es un error: es una decisión de alcance de la ola de código que ya pasó. Pero limita qué se puede detectar HOY sin tocar el esquema.
4. **La detección más barata y de mayor valor no necesita ningún dato nuevo: es ampliar lo que ya existe.** La deduplicación de comprobantes hoy vive *dentro de un viaje* (`repo.ts:gastoExistePorHash` recibe `viajeId`), no a nivel flota. Un ticket reciclado en un viaje distinto, o un folio idéntico con un monto distinto (la huella de un ticket alterado), pasa sin que nadie lo vea. Ampliar el alcance de esa consulta es horas, no semanas.
5. **La segunda detección más barata usa un dato que Likida ya lee y hoy tira a la basura: el precio por litro implícito.** `ocrExtra.precioUnitario` se guarda por cada carga de diésel pero nunca se compara contra nada. La Comisión Nacional de Energía (CNE, gob.mx) publica diario y gratis el precio por estación de servicio de todo el país. Cruzar ambos números detecta sobreprecio, bomba descalibrada y colusión sistemática sin pedirle un solo dato nuevo al cliente.
6. **Ordeña de diésel real (litros que de verdad salieron del tanque) es la detección más cara del catálogo, no la más barata**, porque exige capacidad de tanque y kilómetros recorridos por unidad — ninguno de los dos existe hoy. Se puede aproximar con reglas más burdas mientras tanto (litros por carga contra un techo genérico, dos cargas de la misma unidad en un lapso corto), pero la versión seria queda condicionada a meter la entidad `Unidad` al modelo, algo que la ola 1 ya había señalado como pendiente.
7. **"Carga fantasma" — el viaje o el gasto que nunca ocurrió — es el fraude más caro de probar y el más caro de construir.** Requiere saber qué ruta hizo el viaje y contra qué corredor de casetas/gasolineras debía pasar; hoy `Viaje` no tiene ruta con plazas de cobro. La señal más barata mientras tanto es indirecta: comprobantes que nunca llegan a `estadoSat: 'vigente'` porque el operador nunca los facturó en el portal — un ticket que sostiene un gasto real casi siempre se termina facturando; uno inventado casi nunca.
8. **Todo lo que se marca como sospechoso tiene que llegar al contralor como pregunta, no como veredicto.** No es solo buena práctica: la LFPDPPP vigente (art. 26, fr. II, ya identificada en la ola 1 y en `21-guardarrailes.md`) le da al operador un derecho de oposición cuando un sistema, **sin intervención humana**, evalúa su "fiabilidad o comportamiento" con efecto significativo — y eso es exactamente lo que hace un detector de fraude. La ola 2 de guardarraíles ya construyó la plantilla de tres verbos (AFIRMA / CONDICIONA / RECHAZA); este documento la aplica a fraude en vez de a deducibilidad.
9. **Ordena el catálogo por lo que ya tienes, no por lo que impresiona en un pitch.** Cinco reglas se pueden escribir esta semana sobre datos que ya existen. Tres necesitan un campo nuevo pequeño. Dos necesitan una entidad nueva o una integración externa. Constrúyelas en ese orden.

---

## 1. Qué captura Likida hoy — el inventario real, verificado en el código

Antes de proponer una sola regla hay que fijar qué dato existe de verdad. Esto se verificó leyendo `src/types/cuadra.ts`, `intake/ocr.ts`, `intake/fecha.ts`, `intake/emparejar.ts`, `cuadre/engine.ts` y `repo.ts` — no se infiere de la documentación del producto.

### 1.1 Por comprobante (`Gasto`)

| Campo | ¿Existe hoy? | Dónde | Nota |
|---|---|---|---|
| `monto` | Sí | `Gasto.monto` | Del OCR o, si hay QR de CFDI, del código (gana sobre el OCR). |
| `litros` | Sí | `Gasto.ocrExtra.litros` | Solo para diésel/gasolina; leído del ticket, no verificado contra ningún padrón. |
| `precioUnitario` (precio por litro) | Sí | `Gasto.ocrExtra.precioUnitario` | Se lee del ticket. **Hoy no se compara contra nada** — ni contra otro comprobante ni contra un precio de referencia externo. |
| `fecha` | Sí, pero **solo fecha, no hora** | `Gasto.fecha` (ISO `YYYY-MM-DD`) | `normalizarFecha()` en `intake/fecha.ts` recorta a los primeros 10 caracteres. Aunque el ticket traiga hora impresa, se descarta. |
| `hora` (campo estructurado) | **No existe** | — | `ocrExtra.fechaRaw` guarda el string crudo que leyó el OCR, que *podría* incluir hora si el ticket la trae y el modelo la copió dentro del campo `fecha` de texto libre — pero no hay un campo `hora` en el schema de extracción (`ExtraccionSchema` en `ocr.ts`) ni en el tipo `Gasto`. No es un dato confiable ni consultable hoy. |
| `estacion` (nombre/RFC del emisor) | Sí | `Gasto.rfcEmisor` (validado con dígito verificador) y `Gasto.ocrExtra.estacion` (texto libre) | El RFC es el identificador confiable; el nombre de texto es ruido de OCR. |
| Folio / secuencia de folios | Sí | `Gasto.folio` (crudo), `Gasto.folioNorm` (sin ceros), `Gasto.ocrExtra.folioPortal` (del QR/código de barras) | Tres representaciones del mismo dato, deliberadamente separadas (ver comentario en `ocr.ts` sobre el caso `ITU` de 31 vs. 30 caracteres). |
| Hash de la imagen | Sí | `Gasto.imgHash` (SHA-256) | Detecta el **reenvío exacto** del mismo archivo. Una edición de un solo píxel cambia el hash — **no detecta ticket alterado**, solo ticket repetido sin tocar. |
| CFDI validado ante el SAT | Sí | `Gasto.estadoSat`, `Gasto.efos`, `Gasto.cfdiUuid` | Vía `consultarCFDI()` en `intake/sat.ts`. Si nunca hubo QR de CFDI, `cfdiValido` queda `undefined` y el gasto se sostiene solo en lo que leyó el OCR del ticket. |
| Forma de pago | Sí | `Gasto.formaPago` (`01` efectivo / `04` tarjeta) | Ya alimenta la regla fiscal de combustible en efectivo. |
| `rendimiento` (km/L de la unidad) | **No existe** | — | No hay odómetro, no hay kilómetros recorridos, no hay entidad `Unidad` con capacidad de tanque ni rendimiento esperado en ningún tipo del dominio. |

### 1.2 Por viaje (`Viaje`) y por operador (`Operador`)

`Viaje` tiene `folio`, `origen`, `destino`, `anticipo`, `fechaInicio`, `fechaFin` — **no tiene ruta con plazas de cobro ni distancia**, algo que la ola 1 (`09-liquidacion.md` §6.2) ya había marcado como campo que "hay que arrancar del cliente en el onboarding aunque duela". `Operador` tiene `id`, `nombre`, `telefono`, `terminal` — **no tiene base de asignación** (necesaria para la faja de 50 km, ya cubierto en ola 1) **ni historial de rendimiento**. No existe ninguna entidad `Unidad` en `types/cuadra.ts`.

### 1.3 Lo que el motor de reglas YA hace (no es fraude, pero es la base)

`cuadre/engine.ts` ya corre, de forma determinística y sin LLM:

- **Deduplicación** por `cfdiUuid` (regla dura) y, si no hay UUID, por `concepto|folio|monto` — **pero excluye el monto de la comparación cero veces**: si el folio es idéntico y el monto distinto, hoy **no se marca nada** (ver hallazgo 3.3 abajo).
- Combustible pagado en efectivo → no deducible (`combustible_efectivo`), gasto no-combustible en efectivo sobre $2,000 → no deducible (`efectivo_sobre_tope`).
- Viático sobre el tope fiscal diario → excedente marcado (`viatico_excede_fiscal`).
- Fecha del comprobante fuera del rango del viaje → `fecha_sospechosa`.
- Folio de diésel leído con baja confianza → `folio_verificar`.
- `diesel_desviacion` **existe como tipo declarado** (`types/cuadra.ts`) y se referencia en la clasificación de estatus (`engine.ts:246`), **pero ninguna función del motor lo produce todavía** — es un enchufe reservado, no una regla implementada. Es el lugar natural donde debería vivir la detección de ordeña cuando exista el dato de rendimiento.

**El hallazgo que corrige el encargo:** de los ocho campos que el encargo asume disponibles ("monto, litros, precio por litro, rendimiento, fecha, hora, estación, secuencia de folios"), **seis existen tal cual, uno existe pero incompleto (fecha sin hora), y uno no existe (rendimiento)**. Esto no bloquea nada de lo que sigue — la mayoría de las reglas de valor alto usan justo los seis que sí están — pero cambia el orden de prioridad: las reglas que dependían de hora o de rendimiento bajan de "esta semana" a "cuando se agregue el campo".

---

## 2. Los siete fraudes, cómo se cometen y qué señal dejan

### 2.1 Ordeña y venta de diésel

**Cómo se comete.** Se extrae combustible del tanque de la unidad — de noche, en paradas largas, en el patio — y se vende en el mercado ilícito. La variante "de escritorio" es la **compra ficticia**: el operador reporta una carga que nunca ocurrió o litros por encima de lo que realmente entró al tanque, y se queda con la diferencia en efectivo o revendiendo el vale. Geotab, Ubícalo, Edenred y Smart Fleet — los cuatro documentan el patrón de forma independiente para el mercado mexicano — coinciden en que la señal madre es el **rendimiento** (km recorridos entre litros consumidos) muy por debajo del histórico de esa unidad.

**Qué señal deja en los datos de Likida.** Hoy, ninguna directa: sin odómetro ni km recorridos, no hay rendimiento que calcular. Señales indirectas disponibles con lo que ya se captura:
- **Litros por carga por encima de un techo físico razonable.** Un tractocamión articulado típico tiene tanque de 400–800 L (referencia de mercado, SIN VERIFICAR contra un fabricante); una sola carga por encima de eso es imposible salvo error de captura o carga a un tercero.
- **Precio por litro implícito muy alejado del precio de referencia regional** (ver §2.7 — es la misma señal que colusión, y aparece junto con ordeña con frecuencia porque ambas pasan por el mismo despachador cómplice).

**Regla implementable con lo que existe.** `litros_excede_tope_generico`: si `Gasto.ocrExtra.litros` supera un techo configurable por tenant (mientras no exista `Unidad.capacidadTanque`), marcar a revisión — nunca bloquear, porque puede ser doble tanque o error de OCR. Valor: alto (es el 80% del fraude según Pulpo). Esfuerzo: bajo para la versión burda, alto para la versión seria con rendimiento real por unidad — requiere meter `Unidad` al modelo, con `capacidadTanque` y `rendimientoEsperado`, exactamente lo que la ola 1 ya recomendaba en `09-liquidacion.md` §6.2 por razones fiscales (faja de 50 km, régimen del operador) y que aquí se vuelve doblemente urgente por razones de control interno.

### 2.2 Carga fantasma (viaje o gasto fabricado)

**Cómo se comete.** El operador comprueba un viaje que no ocurrió, o alarga la duración/ruta reportada de un viaje real para justificar más diésel, casetas y viáticos de los que la operación real consumió.

**Qué señal deja.** Es el más difícil de los siete porque requiere saber qué *debió* pasar, y hoy `Viaje` no tiene ruta ni distancia con la que comparar. La señal más barata disponible: un ticket que nunca se convierte en CFDI real. Un ticket de un gasto que sí ocurrió, tarde o temprano se termina facturando en el portal del comercio (`estadoSat` pasa a `vigente`) porque a alguien de administración le urge para la deducción. Un ticket inventado — o cuyo folio nunca correspondió a una transacción real — se queda indefinidamente en `estadoSat: 'no_encontrado'` o `'pendiente'`, o nunca se le llega a pedir el CFDI. La ola 1 (`02-carta-porte.md`, línea 751) ya anotó el instrumento correcto para la versión completa: cuando el viaje trae Complemento Carta Porte, el XML incluye `TotalDistRec` (distancia recorrida) y la `ConfigVehicular` — cruzar el diésel comprobado contra esos dos campos ("un viaje de 180 km con carga de 600 litros es una alerta") resuelve el problema sin telemetría. **Hoy el parser de Likida no lee Carta Porte** (`cfdi_xml.ts` no tiene ningún campo de CCP) — es una integración nueva, no una regla.

**Regla implementable hoy (parcial).** `folio_no_facturado_prolongado`: comprobante con `folioPortal`/`urlFacturacion` presente cuyo `estadoSat` sigue en `pendiente` o `no_encontrado` X días después del viaje → a revisión, no como prueba de nada, sino como pregunta. **Regla completa (fase 2/3):** parsear Carta Porte y cruzar `TotalDistRec` contra litros de diésel del viaje. Valor: alto (es el fraude de mayor monto por evento). Esfuerzo: bajo para la versión parcial, alto para la versión con Carta Porte.

### 2.3 Tickets duplicados o alterados

**Cómo se comete.** El mismo ticket se sube dos veces (error o intención, propio o entre dos operadores que comparten estación); o el ticket se edita con una app de foto o Photoshop antes de enviarse — típicamente el monto o los litros, dejando el folio y el resto del ticket intactos porque eso es lo que exige el portal de facturación para timbrarlo después.

**Qué señal deja.** Aquí es donde Likida ya tiene la mitad de la solución construida y un hueco concreto y barato de cerrar:

- **Duplicado exacto (mismo archivo reenviado):** `imgHash` (SHA-256) ya lo detecta — pero solo *dentro del mismo viaje*, porque `gastoExistePorHash(viajeId, imgHash, tenantId)` en `repo.ts:117` recibe `viajeId` como parámetro obligatorio de alcance. Un ticket reenviado en un viaje distinto pasa sin que nadie lo vea.
- **Duplicado por folio+monto:** `engine.ts` ya lo hace, también solo dentro del array de gastos que se le pasa (que hoy es por viaje, vía `getGastos(viajeId, tenantId)`).
- **El hueco real — folio idéntico, monto distinto:** la clave de deduplicación de `engine.ts` es literalmente `` `${concepto}|${folio}|${monto}` ``. Si alguien altera el monto de un ticket ya usado y lo vuelve a subir, el folio coincide pero el monto no, la clave completa no coincide, y **hoy no se marca absolutamente nada**. Esta es la huella exacta de un ticket alterado y hoy es invisible para el sistema.
- **Sobre metadatos EXIF de la foto (análisis forense de imagen):** es una técnica real y documentada para detectar edición (rastro de software de edición, incoherencias de compresión JPEG), pero **WhatsApp recomprime las imágenes al enviarlas y típicamente descarta los metadatos EXIF** — así que su valor para un producto que recibe todo por WhatsApp es bajo. No lo vendas como control; anótalo como limitación conocida del canal.

**Regla implementable hoy.** `folio_repetido_monto_distinto`: si existe un `Gasto` previo (en cualquier viaje del tenant, no solo el actual) con el mismo `concepto` + `rfcEmisor`/estación + `folioNorm`, pero `monto` distinto por más de un margen de tolerancia, marcar a revisión con los dos montos a la vista. Junto con ampliar `gastoExistePorHash` a alcance de tenant. Valor: alto (dato ya capturado, cero integraciones nuevas). Esfuerzo: bajo — es cambiar el alcance de dos consultas existentes y agregar una comparación que ya casi existe. Fundamento fiscal adicional para justificarlo frente al cliente, no solo antifraude: LISR art. 27, fr. IV exige que las deducciones estén "restadas una sola vez" (`03-isr-facilidades.md`, línea 91) — un duplicado no detectado no es solo una sospecha de fraude, es una deducción tomada dos veces, lo cual el propio SAT puede glosar.

### 2.4 Comprobante de otra unidad o viaje

**Cómo se comete.** El operador reutiliza el ticket de una carga que sobró (por ejemplo, cargó de más "por si acaso" y ese ticket nunca se aplicó a un viaje) y lo cuela en la comprobación de un viaje distinto; o dos operadores de la misma flota, sin coordinarse, suben el mismo ticket de una caseta que en realidad pagó solo uno de los dos camiones (frecuente cuando viajan en caravana).

**Qué señal deja.** Es el mismo mecanismo del §2.3 pero cruzado entre viajes/unidades en vez de dentro del mismo viaje — y la tabla de reglas que la propia ola 1 ya había anticipado en `09-liquidacion.md` §5.4 lo nombra explícitamente: *"Comprobante ya usado en otra liquidación → Reciclado → Índice global de UUID"*. Ese índice global **no existe todavía**: el `cfdiUuid` y el `folio` se comparan solo contra los gastos del mismo viaje.

**Regla implementable hoy.** `duplicado_entre_viajes`: extender la comparación de `cfdiUuid` y de `folio+concepto+monto` para que consulte contra **todos** los gastos del tenant (o al menos contra una ventana de los últimos N días), no solo contra el viaje actual. Es la misma lógica de `engine.ts`, con una fuente de datos más amplia en `repo.ts`. Valor: alto. Esfuerzo: bajo — no requiere ni un campo nuevo ni una integración; es una consulta más amplia contra una tabla que ya existe.

### 2.5 Sobreprecio en casetas

**Cómo se comete.** Sin TAG (papel térmico suelto), el monto de una caseta es fácil de inflar al reportarlo, o de inventar una caseta que no correspondía a la ruta real. Con TAG, este riesgo prácticamente desaparece (el cargo lo genera el proveedor del TAG, no el operador) — la ola 1 ya lo señaló en `09-liquidacion.md` §3.8.

**Qué señal deja.** El monto de una caseta específica (identificada por `rfcEmisor` — CAPUFE, Aleatica, IDEAL, gobierno estatal) tiene un tarifario público por clase vehicular que **no cambia todos los días** (a diferencia del diésel). Sin necesidad de ingerir ese tarifario todavía, la señal más barata es comparar el monto reportado contra el **histórico de la misma flota para esa misma caseta**: si una caseta que la flota ha pagado 40 veces a ~$180 aparece de pronto en $340, es una anomalía aunque no se sepa la tarifa oficial.

**Regla implementable hoy.** `caseta_fuera_de_historico`: agrupar gastos `concepto = 'caseta'` por `rfcEmisor` (o por el nombre normalizado de la estación si no hay RFC — pago en ventanilla suele sí traer RFC del operador de la autopista), calcular la media móvil de esa flota para esa caseta, y marcar desviaciones de más de X% (sugerido: 25–30%, calibrable). Valor: medio. Esfuerzo: bajo — usa datos ya capturados, sin integración externa. Mejora natural de fase 2: ingerir el tarifario público de CAPUFE por clase vehicular para tener un ancla absoluta, no solo relativa al histórico propio.

### 2.6 Viáticos inflados

**Cómo se comete.** Reportar más días de viático de los que duró el viaje real (el viaje se cerró antes pero se sigue comprobando alimentación); o reportar el gasto de una comida ajena (familiar, de otro operador) como propia.

**Qué señal deja.** `Viaje.fechaInicio` y `Viaje.fechaFin` ya existen; `Gasto.fecha` y `Gasto.concepto = 'viaticos'` también. Contar cuántos días distintos tienen gasto de viáticos y compararlo contra la duración real del viaje es aritmética simple sobre datos que ya están en la base — es exactamente la regla que la ola 1 nombró en `09-liquidacion.md` §5.4 ("Días de viático > días de viaje → Inflado de viáticos → Fechas de inicio y fin del viaje") y que hoy **no está implementada** en `engine.ts` (la única regla de viáticos que existe hoy es el tope fiscal diario, `viatico_excede_fiscal`, que es un asunto de deducibilidad, no de fraude).

**Regla implementable hoy.** `dias_viatico_excede_viaje`: `COUNT(DISTINCT fecha)` de gastos `viaticos` del viaje > (`fechaFin` − `fechaInicio` en días + margen de un día por checkout/entrega). Valor: medio-alto. Esfuerzo: bajo — cero campos nuevos, cero integraciones.

### 2.7 Colusión con estaciones de servicio

**Cómo se comete.** Dos variantes documentadas de forma consistente por Edenred (el emisor de monedero más antiguo del padrón SAT, no un blog) y por Geotab/Ubícalo para el mercado mexicano: **bombas descalibradas** (la estación despacha menos litros de los que registra el ticket, sistemático, a cualquier cliente) y **acuerdo despachador-operador** (el ticket registra más litros o más monto de lo realmente entregado, y despachador y operador se reparten la diferencia). La segunda es indistinguible de la ordeña "de escritorio" del §2.1 desde el lado de los datos: ambas producen el mismo patrón — precio por litro implícito anormal, sostenido, siempre en la misma estación.

**Qué señal deja y qué la distingue de un error puntual.** Un error de OCR o una estación cara un solo día es ruido. La firma de colusión es la **persistencia**: el mismo `rfcEmisor` (o la misma estación por nombre si no hay RFC limpio), con el mismo operador o la misma unidad, mostrando un precio por litro implícito (`monto / litros`, ambos ya capturados) consistentemente por encima del precio de referencia regional durante varias cargas seguidas.

**El precio de referencia ya existe, público y gratis.** La Comisión Nacional de Energía (CNE, antes CRE) publica diariamente a las 18:00 hrs. el "Listado de Precios Comerciales de Gasolina y Diésel por Estación de Servicio" en formato XML, por permiso, para todo el país (`cne.gob.mx/ConsultaPrecios/GasolinasyDiesel/GasolinasyDiesel.html`, Acuerdo A/041/2018 de la entonces CRE). Profeco publica además un comparativo semanal por región y marca ("Quién es quién en el precio de la gasolina", `combustibles.profeco.gob.mx`). Ninguno de los dos requiere credenciales ni scraping de un portal privado — es justo el tipo de fuente que el semáforo de automatización de `11-datos-personales.md` calificaría en **verde**.

**Regla implementable.** Dos niveles:
1. **Hoy, sin integración nueva:** `precio_litro_fuera_de_historico_propio` — igual que casetas, comparar contra el promedio móvil de la propia flota para esa estación.
2. **Fase 2, con la integración a CNE:** `precio_litro_fuera_de_referencia_cne` — comparar el precio implícito del ticket contra el precio publicado por CNE para esa estación (por `rfcEmisor`/permiso) o, si no hay match exacto de estación, contra el promedio regional del día. Desviación sostenida (no un evento aislado) por encima de un umbral (sugerido 10–15%, calibrable) es la bandera de colusión, no un ticket individual.

Valor: alto — es la señal que además sirve para §2.1 (ordeña) sin trabajo adicional. Esfuerzo: bajo para el nivel 1, medio para el nivel 2 (una integración nueva pero a una fuente pública y estable, sin autenticación).

---

## 3. Catálogo ordenado por valor / esfuerzo

| # | Regla | Fraude que ataca | Dato que usa | Esfuerzo | Valor |
|---|---|---|---|---|---|
| 1 | `duplicado_entre_viajes` — ampliar dedupe de UUID/folio/hash a todo el tenant, no solo el viaje | Comprobante de otra unidad/viaje | `cfdiUuid`, `folio`, `imgHash` (ya existen) | Bajo | Alto |
| 2 | `folio_repetido_monto_distinto` — mismo folio+estación, monto diferente | Ticket alterado | `folio`, `rfcEmisor`, `monto` (ya existen) | Bajo | Alto |
| 3 | `dias_viatico_excede_viaje` | Viáticos inflados | `Viaje.fechaInicio/fechaFin`, `Gasto.fecha` (ya existen) | Bajo | Medio-Alto |
| 4 | `precio_litro_fuera_de_historico_propio` | Ordeña / colusión con estación | `monto`, `litros`, `rfcEmisor` (ya existen) | Bajo | Alto |
| 5 | `caseta_fuera_de_historico` | Sobreprecio en casetas | `monto`, `rfcEmisor`, `concepto` (ya existen) | Bajo | Medio |
| 6 | `folio_no_facturado_prolongado` | Carga fantasma (señal parcial) | `estadoSat`, `folioPortal` (ya existen) | Bajo | Medio |
| 7 | Agregar campo `hora` estructurado al schema de OCR y al tipo `Gasto` | Habilita "dos cargas en intervalo corto" | Cambio de schema | Medio | Medio (habilitador de otras reglas) |
| 8 | `dos_cargas_intervalo_corto` — misma unidad/operador, dos cargas en <2h | Ordeña / doble ticket | Requiere #7 | Medio | Alto |
| 9 | `precio_litro_fuera_de_referencia_cne` — contra precio público CNE | Colusión sistemática | Integración nueva (CNE, XML público diario) | Medio | Alto |
| 10 | `litros_excede_capacidad_tanque` (versión seria, por unidad real) | Ordeña | Requiere entidad `Unidad.capacidadTanque` | Alto | Alto |
| 11 | `rendimiento_desviado` — km/L real vs. histórico por unidad+ruta | Ordeña, odómetro falso | Requiere `Unidad`, odómetro/km recorridos | Alto | Alto |
| 12 | Cruce diésel vs. `TotalDistRec` de Carta Porte | Carga fantasma (versión seria) | Parser de CCP (no existe hoy) | Alto | Alto |
| 13 | Análisis de brechas en secuencia de folios por comercio/proveedor | Folios saltados o reciclados a escala | Requiere volumen (varios viajes) | Medio | Medio |
| 14 | Ley de Benford sobre montos | Montos inventados a escala | Requiere volumen alto (cientos de registros por operador/concepto) | Medio | Bajo hasta que haya volumen |

Las reglas 1 a 6 son, en conjunto, una a dos semanas de trabajo sobre código y datos que ya existen — ningún cliente nuevo, ninguna credencial nueva, ninguna migración de esquema. Es el orden recomendado de construcción.

---

## 4. Cómo presentar una sospecha sin acusar a nadie en falso

Este documento no inventa un marco nuevo: aplica el que la ola 2 de guardarraíles (`21-guardarrailes.md` §3–§5) ya construyó para deducibilidad fiscal, extendido a fraude. La razón de fondo por la que hay que hacerlo con el mismo rigor —no informal, no "ya después lo afinamos"— es legal, no solo de buen gusto de producto: la LFPDPPP vigente, art. 26, fr. II (citada en la ola 1, `11-datos-personales.md` §6, y ya traída a este contexto en `21-guardarrailes.md` §6) le da al operador un derecho de oposición cuando un sistema, **sin intervención humana**, evalúa "su rendimiento profesional, situación económica, fiabilidad o comportamiento" con un efecto que "afecte de manera significativa sus intereses". Un detector de fraude que descuenta, retiene un pago o abre un expediente **sin que un humano lo confirme** cae exactamente en esa fracción.

### 4.1 El verbo correcto para una alerta de fraude nunca es AFIRMA

De los tres verbos de `21-guardarrailes.md` §3.1, una alerta de fraude casi siempre es **CONDICIONA**, nunca AFIRMA — porque ninguna de las reglas del catálogo de arriba prueba fraude por sí sola. Todas producen una **desviación estadística o física** (precio fuera de rango, folio repetido, monto duplicado, días que no cuadran), y la desviación tiene explicaciones honestas además de la deshonesta: error de captura del operador, una promoción real de la estación, un desvío operativo legítimo, un checkout tardío del hotel. Tratar la desviación como veredicto es el error que puede costarle a Likida una demanda laboral y a la flota un despido injustificado sobre evidencia débil.

### 4.2 La plantilla, aplicada a fraude

Misma estructura de `21-guardarrailes.md` §4, con el vocabulario de fraude:

```
[LO QUE EL SISTEMA MIDIÓ]   → el número concreto y su fuente (el propio dato, o un dato externo público).
[CONTRA QUÉ SE COMPARÓ]     → histórico propio / referencia pública / tope físico — nunca "parece raro".
[LA DESVIACIÓN]             → cuánto y en qué dirección, sin adjetivos ("30% arriba", no "sospechoso").
[LO QUE NO SE SABE]         → que puede tener explicación legítima; se listan 1-2 ejemplos plausibles.
[QUIÉN DECIDE]              → el contralor confirma o descarta; el sistema no descuenta ni concluye solo.
```

Ejemplo, con la regla de precio por litro (§2.7 / §2.1):

> Esta carga de diésel de Juan Pérez en la Estación Río Bravo (RFC ABC010101XXX) del 24 de julio muestra un precio de $32.10/L. El precio promedio publicado por la Comisión Nacional de Energía para esa zona esa semana fue de $24.80/L — 29% arriba. Esto viene pasando en las últimas 4 cargas de esta misma estación, no solo hoy.
> **Puede deberse a** una estación fuera de la red habitual con precio real más alto, un error de captura del monto o los litros, o algo que vale la pena preguntarle directamente al operador o a la estación.
> **No se descontó nada todavía.** Queda marcado para que tú decidas si investigar, y con qué evidencia — la decisión y cualquier consecuencia para el operador son tuyas, no del sistema.

### 4.3 Reglas de diseño no negociables

1. **Ninguna alerta descuenta sueldo, retiene pago o genera una nota en el expediente del operador de forma automática.** El sistema marca; el contralor actúa. Esto es lo que evita activar la fr. II del art. 26 (hay intervención humana real, no cosmética).
2. **Nunca usar la palabra "fraude", "robo" o "robó" en la salida del producto.** Usar "desviación", "fuera de rango", "vale la pena revisar". La calificación penal la hace, en su caso, una autoridad — no una regla de negocio. Esto también reduce exposición bajo publicidad engañosa y difamación si la sospecha resulta infundada.
3. **Toda alerta trae, sin excepción, al menos una explicación no fraudulenta plausible**, aunque sea genérica. Forzar esto en la plantilla evita que la salida del LLM (si hay uno narrando la alerta) suene a acusación aunque el dato subyacente sea neutral.
4. **Trazabilidad completa**: qué regla disparó, con qué números exactos, comparados contra qué fuente, en qué momento. Sin esto no se puede responder una solicitud de oposición del operador ni defender la decisión del contralor si él sí actuó.
5. **Patrón, no evento aislado, para las alertas de mayor consecuencia** (colusión, ordeña). Un ticket caro un día es ruido; el mismo patrón sostenido varias veces es señal. La plantilla de §4.2 ya lo pide explícitamente ("esto viene pasando... no solo hoy") — es una decisión de diseño, no solo de redacción: las reglas 4 y 9 del catálogo (§3) deben evaluarse sobre una ventana de varias cargas, no gasto por gasto, antes de mostrarse como alerta.
6. **La leyenda del art. 89/90 del CFF (`21-guardarrailes.md` §5.2) no aplica aquí** — esa leyenda es para cuando el producto sugiere un tratamiento fiscal. Una alerta de fraude necesita su propia leyenda corta, distinta: *"Esto es una desviación estadística detectada por el sistema, no una acusación ni una prueba. La decisión de investigar y cualquier consecuencia le corresponden a la empresa."*

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Ampliar `gastoExistePorHash` y la deduplicación de `engine.ts` a alcance de tenant, no de viaje | Cierra el hueco de comprobante reciclado entre viajes; usa código y datos que ya existen | Bajo | Antes de la demo — es la regla de mayor retorno por hora invertida |
| Cambiar la clave de dedupe de `` `concepto\|folio\|monto` `` a `` `concepto\|estación\|folio` `` y marcar (no descartar) cuando el monto difiera | Detecta ticket alterado, hoy invisible porque el monto distinto rompe la clave completa | Bajo | Junto con la anterior |
| Implementar `dias_viatico_excede_viaje` contra `Viaje.fechaInicio/fechaFin` | Ya estaba en el catálogo de la ola 1 (§5.4 de `09-liquidacion.md`) y no se construyó; cero campos nuevos | Bajo | Esta semana |
| Implementar `precio_litro_fuera_de_historico_propio` y `caseta_fuera_de_historico` (comparación contra el promedio móvil de la propia flota) | Ataca ordeña, colusión y sobreprecio de caseta con datos que ya se capturan, sin integración externa | Bajo | Esta semana |
| Redactar y aplicar la plantilla de §4.2 a toda salida de alerta, con la leyenda de §4.3.6 | Es requisito legal (LFPDPPP art. 26-II), no solo buena práctica; evitarlo expone a Likida y al cliente | Bajo | Antes de mostrar la primera alerta a un usuario real |
| Agregar campo `hora` estructurado al `ExtraccionSchema` de `ocr.ts` y al tipo `Gasto` | Habilita "dos cargas en intervalo corto", la señal más citada en la literatura de fraude de tarjetas de combustible | Medio | Fase 2 |
| Integrar el feed público diario de la CNE (`cne.gob.mx/ConsultaPrecios/GasolinasyDiesel`) para precio de referencia por estación | Sube la regla de precio por litro de "contra mi propio histórico" a "contra el mercado real"; fuente pública, sin credenciales, ya calificaría verde en el semáforo de `11-datos-personales.md` | Medio | Fase 2 |
| Diseñar la entidad `Unidad` (capacidad de tanque, rendimiento esperado, TAG/monedero asignado) — la ola 1 ya la pedía por razones fiscales; aquí se vuelve también antifraude | Sin esto no hay rendimiento real ni tope de tanque real; toda la detección de ordeña queda en versión burda indefinidamente | Alto | Fase 2/3, cuando se meta al modelo de datos por las razones fiscales de la ola 1 |
| Parsear el Complemento Carta Porte (`TotalDistRec`, `ConfigVehicular`) cuando el viaje lo traiga | Resuelve carga fantasma sin telemetría ni GPS, usando un dato que el SAT ya exige y que Likida va a tener que leer de todos modos por Carta Porte | Alto | Fase 3, junto con el resto del roadmap de Carta Porte |
| Dejar pendientes Benford y análisis de brechas de secuencia de folios hasta tener volumen real de varias flotas/varios meses | Ambas técnicas necesitan cientos de registros por grupo para no producir ruido; construirlas antes tiene costo de oportunidad sin beneficio | — | Backlog, revisar cuando haya clientes activos con historial |

---

## CONFLICTOS

Ninguna contradicción encontrada con otros archivos de la ola 1 o de esta ola. Lo que sí hay es una corrección al **encargo mismo**, ya señalada de forma explícita en el Resumen (punto 3) y en §1.3: el encargo asume que Likida ya captura `hora` y `rendimiento` como campos disponibles, y el código verificado muestra que `hora` se descarta al normalizar la fecha y que `rendimiento` no existe porque no hay entidad `Unidad`. No es una contradicción entre documentos — es información nueva que corrige una premisa del encargo, y se trata como tal en vez de forzarla al formato CONFLICTO.

---

## SIN VERIFICAR

1. **La cifra "80% de los fraudes de flotilla en México viene de cargas irregulares de combustible" y "95% de detección automatizada vs. 20% manual".** Declarada por la firma Pulpo (proveedor de PulpoPay) en un comunicado citado por Milenio y por el periódico Zócalo. Es una cifra autodeclarada de un proveedor con interés comercial directo en el resultado — tal como la ola 1 trató las cifras de Uvicuo. Sirve como pista de que el problema es real y grande, no como estadística verificada.
2. **"Entre el 5% y el 15% del combustible comprado no llega al tanque"**, con el ejemplo de $50,000–$150,000 mensuales para una flotilla de 10 unidades. Material comercial de Smart Fleet (proveedor competidor de software de flotillas). Orden de magnitud plausible, cifra exacta no verificada contra ninguna fuente independiente.
3. **Rangos de rendimiento (km/L) de tractocamión citados en la investigación de mercado son inconsistentes entre fuentes** — Smart Fleet reporta 2–4 km/L para tractocamión articulado; GetCastores reporta el inverso, 1.0–1.8 L/km (≈0.55–1.0 km/L) para la misma categoría de vehículo. La diferencia es de 2 a 3 veces según la fuente. **No hardcodear ningún rango universal de rendimiento** — es exactamente el argumento para calcular el rendimiento esperado por unidad y por ruta a partir del histórico propio de cada flota (lo que ya recomendaba la ola 1), no de una tabla de referencia de mercado.
4. **Capacidad de tanque típica de un tractocamión articulado (400–800 L usada como techo genérico en §2.1 y §3, regla #1).** Cifra de referencia de mercado sin verificar contra especificaciones de fabricante (Kenworth, Freightliner, International). Confirmar con el catálogo de unidades del primer cliente real antes de hardcodear el techo.
5. **Que las bombas de estaciones de servicio en México se despachen sin calibración regular es una práctica documentada por Profeco (verificaciones a estaciones) pero este documento no leyó los resultados de esas verificaciones ni una cifra de qué porcentaje de estaciones falla.** El sitio de Profeco (`combustibles.profeco.gob.mx`) publica "Acciones de verificación a estaciones de servicio de gasolinas y diésel"; no se abrió ese reporte en esta investigación.
6. **Que WhatsApp descarta los metadatos EXIF de las imágenes al comprimirlas** se afirma con base en conocimiento general de cómo procesa medios la plataforma, no se verificó leyendo la documentación técnica de Meta/WhatsApp para esta investigación. Confirmar antes de usarlo como argumento definitivo para descartar el análisis forense de imagen como control.
7. **Formato exacto y estabilidad del feed XML diario de la CNE** (`cne.gob.mx/ConsultaPrecios/GasolinasyDiesel/GasolinasyDiesel.html`) — se confirmó que existe, es diario, público y sin autenticación, pero no se descargó ni se inspeccionó el XML real para confirmar qué campo identifica la estación (RFC del permisionario, número de permiso, o ambos) y si permite emparejar de forma exacta contra el `rfcEmisor` que Likida ya lee de un ticket. Hacerlo antes de comprometer la integración de la regla #9.

---

## Fuentes

### Primarias (gob.mx / código propio, verificadas)

- Código fuente de Cuadra, leído directamente el 27-jul-2026: `src/types/cuadra.ts`, `src/lib/cuadra/intake/ocr.ts`, `src/lib/cuadra/intake/fecha.ts`, `src/lib/cuadra/intake/emparejar.ts`, `src/lib/cuadra/intake/decidir.ts`, `src/lib/cuadra/cuadre/engine.ts`, `src/lib/cuadra/cuadre/guardia.ts`, `src/lib/cuadra/repo.ts`, `src/lib/cuadra/facturacion/comercios.ts`, `src/lib/cuadra/facturacion/identificar.ts`.
- Comisión Nacional de Energía — Precios de expendio de gasolinas y diésel por estación de servicio (XML diario, Acuerdo A/041/2018): https://www.cne.gob.mx/ConsultaPrecios/GasolinasyDiesel/GasolinasyDiesel.html
- Profeco — Quién es quién en el Precio de la Gasolina: https://combustibles.profeco.gob.mx/
- LISR art. 27, fr. IV ("restadas una sola vez") — ya citado y verificado en `03-isr-facilidades.md` de la ola 1, línea 91.
- LFPDPPP art. 26, fr. II — ya citado y verificado en `11-datos-personales.md` §6 de la ola 1 y retomado en `21-guardarrailes.md` §6 de la ola 2.

### Del propio paquete de conocimiento (ola 1 y ola 2, construido encima)

- `09-liquidacion.md` §4.6 (mapa de brechas) y §5.4 (tabla de reglas de detección de desviaciones) — la tabla de reglas de este documento amplía directamente esa tabla, verificando cuáles ya se implementaron y cuáles siguen pendientes.
- `02-carta-porte.md`, línea 751 — el cruce diésel vs. `TotalDistRec` del Complemento Carta Porte.
- `08-competencia.md`, líneas 510 y 519 — "nadie lo está vendiendo como control activo" y la conciliación del complemento de estado de cuenta de combustible.
- `21-guardarrailes.md` §3–§5 — el marco de los tres verbos y la plantilla de incertidumbre, extendidos aquí a fraude.
- `05-hidrocarburos.md`, líneas ~400 — anomalía de `c_SubProductoHYP` (SP25/SP23 en vez de SP18) como señal de negocio, no fiscal.

### Secundarias (pista, no fundamento — marcadas SIN VERIFICAR donde corresponde)

- Milenio — "En México 80% de fraudes en flotillas, causado por cargas irregulares de combustible: Pulpo" (08-jul-2025): https://www.milenio.com/negocios/fraudes-flotillas-causados-cargas-irregulares-combustible
- Periódico Zócalo — misma nota, replicada: https://www.zocalo.com.mx/fraude-por-combustible-el-80-de-las-perdidas-en-flotillas-proviene-de-cargas-irregulares/
- Edenred México — "¿Cómo prevenir fraudes en el control de gasolina?" (estaciones descalibradas, acuerdos despachador-operador): https://www.edenred.mx/blog/como-prevenir-fraudes-en-el-control-de-gasolina
- Geotab — "Control de combustible: cómo detectar robos y ordeña en la flotilla con telemática": https://www.geotab.com/es-latam/blog/control-de-combustible/
- Ubícalo — "Robo de combustible a transportistas: cómo prevenir pérdidas con control de diésel, GPS e IA": https://www.ubicalo.com.mx/blog/robo-de-combustible-a-transportistas/
- Smart Fleet — "Control de Combustible en Flotilla: Cómo Evitar el Robo y Fraude de Diésel en México": https://es.smartfleetapp.com/blog/control-combustible-flotilla-evitar-robo-fraude/
- Smart Fleet — "Rendimiento Camión Diésel: Cuántos km/L Son Normales": https://es.smartfleetapp.com/blog/rendimiento-combustible-camion-diesel-mexico/
- GetCastores — "Tractocamion vs Torton: Cual Consume Mas Diesel por Kilometro": https://getcastores.mx/blog/tractocamion-vs-torton-cual-consume-mas-diesel-por-kilometro-en-2026/
- Transporte.mx — Calculadora de rutas y consumo de diésel: https://transporte.mx/calculadora-de-rutas-en-mexico/
- GSE (Kazajistán, blog técnico de gestión de flotillas) — "Fuel and Fuel-Card Accounting: Entities and Anomaly Control": https://gse.kz/en/blog/fuel-cards-accounting-entities-anomaly-detection — usado como referencia de patrón de señales (dos cargas en poco tiempo, físicamente imposible, geografía fuera de ruta), no como fundamento normativo.
- Heavy Vehicle Inspection — "Fuel Card Fraud Detection & Prevention Guide for Fleet Managers": https://heavyvehicleinspection.com/blog/post/fuel-card-fraud-detection-fleet-manager-guide
- Oxmaint — "Fleet Fuel Card Reconciliation and Management Checklist": https://oxmaint.ai/industries/fleet-management/fleet-fuel-card-reconciliation-management-checklist
- Fuelshine — "Odometer Mismatch Fuel Fraud: 4 Patterns Hiding in Plain Sight": https://www.getfuelshine.com/post/odometer-mismatch-fuel-fraud-4-patterns-hiding-in-plain-sight
- GitHub, gbadedata/fuel-card-fraud-monitoring — motor de reglas de referencia (open source, datos sintéticos) para tipologías de fraude de tarjeta de combustible: https://github.com/gbadedata/fuel-card-fraud-monitoring
- Auditool — "Forensic analytics para auditores que le temen a Excel avanzado" (Ley de Benford, detección de duplicados en 3 niveles, análisis de brechas de secuencia): https://www.auditool.org/blog/fraude/forensic-analytics-para-auditores-que-le-temen-a-excel-avanzado
- fraudeinterno.com — "Ley de Benford y fraude interno: cómo detectar gastos sospechosos con análisis numérico": https://fraudeinterno.com/2026/03/17/ley-de-benford-y-fraude-interno-como-detectar-gastos-sospechosos-con-analisis-numerico/
- Nigrini, M.J. (2012). *Benford's Law: Applications for Forensic Accounting, Auditing, and Fraud Detection.* Wiley — citado por las fuentes secundarias de Benford, no leído en fuente primaria en esta investigación.
- Durtschi, Hillison & Pacini (2004). "The effective use of Benford's law to assist in detecting fraud in accounting data." *Journal of Forensic Accounting* — ídem.
- TrustDocHub — "Análisis forense de la falsificación de imágenes: cómo detectar una imagen manipulada" (ELA, ruido, metadatos EXIF): https://trustdochub.com/es/falsificacion-imagen-analisis-forense/
- Tickelia — "Fraude interno en la gestión de gastos: guía para prevenirlo" (contexto LATAM, ACFE ~5% de ingresos anuales por fraude ocupacional): https://tickelia.com/la/blog/fraude-interno/fraude-interno-en-la-gestion-de-gastos-como-abordarlo/
- Mis Flotillas — "Cómo auditar casetas, TAG y viáticos por unidad sin perderte entre tickets sueltos": https://misflotillas.com/blog/como-auditar-casetas-tag-y-viaticos-por-unidad
