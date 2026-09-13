# Cumplimiento legal — auditoría 31

**Nota: 3/10** (antes 4). Razón del movimiento: **mirada más profunda — la nota
anterior estaba inflada**. El árbol es idéntico al que calificó la 30 (los dos
commits de la ventana tocan `normas/.latido-*` y nada más), así que nada de lo
que sigue lo rompió esta ventana. Verifiqué uno por uno **los 12 hallazgos
abiertos de la 30: los 12 siguen ahí, con `archivo:línea` reconfirmado**. Lo que
mueve la nota son tres cosas nuevas que la 30 no vio y una afirmación suya que
resultó falsa **en la dirección mala**:

1. El aviso del operador **promete por escrito** que «la imagen que no respalda
   ningún gasto se elimina sola del almacenamiento» (`privacidad.ts:766`), y hay
   **tres candados independientes** que garantizan que esa imagen no se borra
   nunca — uno de ellos invocando **CFF art. 30 sobre una fila que el propio
   operador declaró que no es comprobante de ningún gasto**. La 30 reportó esto
   como LEG-M2 [MEDIO] diciendo «ningún aviso la declara». Sí la declara: dice lo
   contrario de lo que pasa. Eso no es un MEDIO, es un CRÍTICO.
2. La **constancia del art. 16** es una sola fila que se sobrescribe, y lo único
   que guarda es un hash FNV-1a de 32 bits de un texto que **no se persiste en
   ningún lado**. No se puede probar qué leyó el titular ni cuándo recibió la
   versión anterior — y la carga de esa prueba es del responsable.
3. `pod` (la carta porte sellada que el chofer fotografía) es una categoría de
   dato que el catálogo de la fr. II **no enumera**, sin purga y fuera del
   alcance de la cancelación.

El ancla del rubro es explícita: **«3 o menos si hay transferencia de datos
personales sin cobertura»**. Hay dos, abiertas y reconfirmadas hoy: la coordenada
de la telemetría que sale a la grúa bajo un aviso que dice «la que compartiste
por el chat» (LEG-A1), y el celular del dueño de la flota que sale a un tercero
comercial bajo un aviso que promete cero transferencias (LEG-A5). Con ese ancla,
4 nunca fue defendible; 3 es lo que el texto de la regla manda.

Números contables de esta ronda, para que mañana se distinga medición de
impresión:

- **12 / 12** hallazgos abiertos de la 30 reconfirmados línea por línea.
- **18** funciones dentro de `mantenimiento_de_datos` (`0335:314-345`); las tres
  tablas con dato personal de esta ronda —`coordinacion_proveedor`,
  `comprobante_huerfano`, `pod`— **no aparecen en ninguna**.
- **0** apariciones de `coordinacion_proveedor` y **0** de `pod` en
  `0356_arco_borra_contacto_emergencia.sql`.
- **3** candados independientes bloquean el borrado de la imagen huérfana.
- **1** fila por operador guarda la constancia del art. 16; **0** filas de
  historial de versiones del aviso.
- Suite del rubro: `npx vitest run privacidad arco` → **21 archivos / 169
  pruebas, 169 en verde**. Ninguna de las tres cosas nuevas tiene prueba que la
  vigile.

Riesgo mayor hoy: el producto tiene **dos promesas de borrado escritas en el
aviso que el esquema hace imposibles de cumplir** —la coordenada del chat a los
90 días y la imagen sin gasto «que se elimina sola»—, y en el segundo caso el
código bloquea el borrado invocando una obligación fiscal que sobre esa fila
no existe.

## Hallazgos

### [CRÍTICO] LEG-31-C1 — El aviso promete que «la imagen que no respalda ningún gasto se elimina sola del almacenamiento»; tres candados independientes garantizan que no se borra nunca, y el tercero la retiene invocando CFF art. 30 sobre una foto que el propio operador declaró que no es comprobante de ningún gasto

`src/lib/likida/privacidad.ts:766` ·
`src/lib/likida/intake/almacen.ts:83` ·
`src/lib/likida/processor.ts:2072` · `:2174` · `:2193` ·
`src/lib/likida/repo.ts:632-634` ·
`supabase/migrations/0165_storage_sin_delete_directo.sql:116` · `:134` · `:138` ·
`supabase/migrations/0178_fiscal_retencion_arco_y_perfiles_erp.sql:39-49` ·
`src/lib/likida/storage_borrado.ts:52` ·
`supabase/migrations/0335_db_retencion_r3_forward.sql:314-345` ·
`supabase/migrations/0356_arco_borra_contacto_emergencia.sql:61-125`

**Norma.** `normas/lfpdppp-15-16.yaml` (art. 15 fr. V, plazo de conservación) y
art. 11: el plazo que el aviso afirma tiene que ejecutarse. Art. 25/28 fr. III
para la cancelación.

**Qué dice el aviso, literal** (`privacidad.ts:766`, sección de sensibles del
integral, el documento que el titular abre por la liga del WhatsApp):

> «… si en ella aparece por accidente algo sensible —un ticket de farmacia, por
> ejemplo—, el filtro descarta la línea del **producto** (el medicamento) cuando
> la reconoce … Por eso, si un ticket no es un gasto de la flota, lo más seguro
> es no mandarlo como comprobante. **La imagen que no respalda ningún gasto se
> elimina sola del almacenamiento.**»

**Escenario (con valores).** Juan Pérez, operador `op-1` de la flota `t-9`
(`tenant_id = 9f3c…`), sin viaje abierto, manda el 10-mar-2026 la foto de su
ticket de la farmacia por error.

1. `processor.ts:2072` sube la foto:
   `subirComprobante(op.tenantId, 'sin-viaje', imgHash, dataUrl)`.
   `almacen.ts:83` arma la ruta `${tenantId}/${viajeId}/${nombre}.${ext}` →
   **`9f3c…/sin-viaje/7a1b….jpg`** en el bucket privado `comprobantes`.
2. `processor.ts:2193` inserta `comprobante_huerfano` con `operador_id = 'op-1'`
   (`not null`, `0040:31`) y `ruta_imagen = '9f3c…/sin-viaje/7a1b….jpg'`.
3. Likida le pregunta; Juan contesta que no es de ningún viaje.
   `resolverHuerfanos(..., 'descartado', null)` (`repo.ts:632-634`) escribe
   `resuelto_en`, `resolucion = 'descartado'`, `viaje_id = null`. **No toca la
   imagen, ni encola nada.**
4. Pasa lo que tenga que pasar. La imagen sigue ahí. **Para siempre**, por tres
   candados que actúan en serie:

   - **Candado 1 — el barrido nunca la mira.** `limpiar_storage_huerfano`
     condena un objeto solo si su tenant no existe, o si el segmento de viaje es
     un UUID sin fila en `viaje` (`0165:116`, `:134`). Aquí el segmento es la
     cadena literal **`sin-viaje`**, que **no es un UUID**: `es_uuid(j.viaje_txt)`
     da `false` y el objeto ni siquiera entra a `condenados`. El tenant sí existe.
   - **Candado 2 — el anti-join explícito.** Aunque el segmento fuera un UUID,
     `0165:138` excluye del barrido todo objeto cuyo nombre esté en
     `comprobante_huerfano.ruta_imagen`. Mientras la fila viva, el archivo es
     intocable. Y la fila no muere: `comprobante_huerfano` **no aparece en
     ninguna de las 18 funciones** de `mantenimiento_de_datos` (`0335:314-345`,
     verificado con `grep -o "public\.[a-z_]*("` sobre ese bloque).
   - **Candado 3 — se la retiene por «obligación fiscal» que no existe.**
     Si alguien —una corrida futura, ARCO, una inserción a mano— metiera la ruta
     en `storage_huerfano_candidato`, el trigger
     `clasificar_retencion_storage_candidato` (`0178:39-49`) la marca
     `clase_retencion = 'fiscal_cff_30'` **solo porque existe una fila en
     `comprobante_huerfano` con ese `ruta_imagen`** (`0178:43`), **sin mirar
     `resolucion`**. Y `borrarStorageMarcado` filtra
     `.eq('clase_retencion', 'operativa')` (`storage_borrado.ts:52`): nunca la
     borra. El comentario de la migración lo dice como axioma —«Toda referencia
     viva a comprobante, liquidación o historial es evidencia fiscal»— y en esta
     fila el axioma es falso: `resolucion = 'descartado'` significa,
     literalmente, que el titular declaró que **no respalda ningún gasto**. Sin
     gasto no hay deducción, sin deducción no hay CFF art. 30.
5. El 1-sep-2026 Juan pide cancelación. `ejecutar_arco_cancelacion`
   (`0356:61-125`) toca ocho tablas; `comprobante_huerfano` **no está entre
   ellas** (`grep -n "\bpod\b\|comprobante_huerfano" 0356*.sql` → sin
   coincidencias). La fila conserva `operador_id = 'op-1'`, columna que la
   cancelación preserva a propósito.

**Intenté refutarlo y no se cae.** (a) ¿La sanitización lo salva? Solo salva el
`gasto` jsonb: `sanitizarProducto` corre en `intake/ocr.ts:686`, antes de
persistir, y **no puede tocar la imagen** — el propio archivo lo dice
(`sanitizar.ts:47-51`: «esto reduce lo que se PERSISTE, no lo que se remite … una
imagen no se puede enmascarar de antemano»). Lo que queda para siempre es el
JPG del ticket de farmacia. (b) ¿Se borra por cascada al borrar el tenant?
`comprobante_huerfano.tenant_id` sí cascadea (`0040:30`), pero eso borra la FILA
de Postgres, no el objeto de Storage — y solo aplica al borrado de la flota
entera, no al derecho de un titular. (c) ¿Está cubierto por «lo que no se puede
borrar ni pidiéndolo»? No: esa frase del mismo párrafo acota la excepción a «la
foto que **ya es comprobante de un gasto**», y ésta explícitamente no lo es.
(d) ¿Es una promesa sobre otra cosa? La frase está **dentro del párrafo del
ticket de farmacia** y viene precedida del consejo «si un ticket no es un gasto
de la flota, lo más seguro es no mandarlo»: es exactamente este caso, redactado
por el propio aviso.

**Consecuencia.** El producto le da al chofer un consejo de higiene de datos
(«no lo mandes, y si se te va, se borra sola») y hace lo contrario: conserva
indefinidamente la fotografía de un ticket de farmacia —dato sensible de salud
en la imagen, art. 2 fr. VI— ligada por `operador_id` a su persona, protegida
del único barrido que podría alcanzarla, y sobreviviendo a la cancelación que él
ejerció. Ante la Secretaría es el supuesto completo: promesa escrita + categoría
sensible + derecho ejercido + dato vivo, y con el agravante del art. 59 fr. IV
(sanción hasta por dos veces cuando hay sensibles). La `grep` que lo prueba cabe
en una línea.

**Causa raíz probable.** `clasificar_retencion_storage_candidato` deriva la base
legal de retención de la **existencia de la fila**, no de su `resolucion`: en el
único lugar donde el esquema distingue «comprobante de un gasto» de «papel que
el titular dijo que no lo es», el trigger no mira esa columna.

*(Absorbe y reclasifica **LEG-M2/30 [MEDIO]**, cuyo texto afirmaba «ningún aviso
la declara». La afirmación era falsa, y en la dirección que agrava.)*

---

### [CRÍTICO] LEG-C1 — La coordenada exacta del operador queda en texto dentro de `coordinacion_proveedor.mensaje_preparado`: ni la purga de 90 días que el aviso promete la toca, ni la cancelación ARCO (REINCIDENTE de LEG-C1/30, intacto)

`src/lib/likida/asistencia_coordinacion.ts:122` · `:337` ·
`supabase/migrations/0213_coordinacion_proveedor.sql:69` ·
`supabase/migrations/0289_purga_geolocalizacion_incidencia.sql:54-69` ·
`supabase/migrations/0335_db_retencion_r3_forward.sql:314-345` ·
`supabase/migrations/0356_arco_borra_contacto_emergencia.sql:61-125` ·
`src/lib/likida/privacidad.ts:258` · `:688`

Reverificado hoy, línea por línea y con los números corregidos donde habían
corrido:

- `asistencia_coordinacion.ts:122` sigue siendo, literal,
  `` `Ubicación: https://maps.google.com/?q=${d.lat},${d.lng}` ``.
- `:337` sigue persistiendo ese texto completo en `mensaje_preparado`, columna
  `text not null` (`0213:69`).
- **`grep -rn "coordinacion_proveedor" supabase/migrations/*.sql` devuelve 10
  coincidencias, las 10 en `0213` (su creación).** Cero en `0289`, cero en las
  18 funciones de `mantenimiento_de_datos` (`0335:314-345`), cero en `0356`.
- El aviso simplificado sigue diciendo «Se borra a los 90 días»
  (`privacidad.ts:258`, y las otras dos ramas de `SenalGps` en `:259`/`:260`); el
  integral sigue diciendo «Las ubicaciones que compartas se conservan **90 días**
  y después se borran solas» (`:688`).

Escenario, consecuencia y refutaciones: idénticos a LEG-C1/30 (`20.9123,
-100.7440` de Juan Pérez el 10-mar-2026, re-ligable por
`coordinacion_proveedor.incidencia_id → incidencia.viaje_id → viaje.operador_id`,
columna que `0356:121` conserva a propósito). No se repite aquí: nada cambió.

**Causa raíz probable.** La 0289 enumeró «los tres almacenes de geolocalización»
por nombre de columna (`lat`/`lng`) y el cuarto es una subcadena dentro de un
`text`.

---

### [ALTO] LEG-31-A1 — La constancia del art. 16 es UNA fila que se sobrescribe, y lo único que guarda es un hash FNV-1a de 32 bits de un texto que no se persiste en ningún lado: no hay forma de probar qué leyó el titular, ni de que alguna vez recibió la versión anterior

`supabase/migrations/0018_aviso_privacidad.sql:27-28` ·
`supabase/migrations/0033_aviso_reserva_aparte.sql:102-108` ·
`src/lib/likida/repo.ts:1391-1407` · `:1410-1427` ·
`src/lib/likida/privacidad.ts:371-378` · `:401-416` ·
`src/app/aviso/[tenant]/page.tsx:38`

**Norma.** Reglamento art. 31, citado por el propio repo
(`docs/conocimiento/11-datos-personales.md:206`): *«Para efectos de demostrar la
puesta a disposición del aviso de privacidad … la carga de la prueba recaerá, en
todos los casos, en el responsable.»* Y el mismo párrafo del repo lo convierte en
requisito de producto: *«**Build requirement:** log inmutable con timestamp del
mensaje de aviso enviado a cada número, versión del aviso, y del acuse de lectura
o respuesta.»* Lo que existe no es un log: es una celda.

**Escenario (con valores).**

1. 1-mar-2026. Juan Pérez (`op-1`, `t-9`) manda su primer mensaje.
   `versionAvisoVigente` (`privacidad.ts:401-416`) genera el texto y su firma:
   `versionAviso(…)` es **FNV-1a de 32 bits** devuelto en base 36
   (`privacidad.ts:371-378`), digamos `'1k4zq9'`. Meta confirma el envío y
   `confirmar_aviso_privacidad` (`0033:102-108`) escribe en la fila del operador
   `aviso_privacidad_en = '2026-03-01'`, `aviso_privacidad_version = '1k4zq9'`.
   **El texto no se guarda en ninguna parte** — ni la tabla, ni un blob, ni un
   archivo: se regenera en cada llamada a partir del código y de
   `tenant.razon_social/domicilio/url_aviso` más la señal `gps` medida en ese
   momento.
2. 8-sep-2026 (commit `8fc2fa7`, `git log -1 -- src/lib/likida/privacidad.ts`):
   se añade el párrafo entero de la transferencia al proveedor de auxilio
   (`privacidad.ts:912`) y se reescribe la enumeración del art. 35 (`:913`). La
   firma cambia a, digamos, `'2xm70b'`.
3. Siguiente mensaje de Juan. `reclamarEnvioAviso` gana la reserva porque la
   versión difiere, sale el reenvío, y `confirmar_aviso_privacidad` hace
   **`update operador set aviso_privacidad_en = now(), aviso_privacidad_version =
   p_version`** sobre la **misma fila**. Después de ese UPDATE la base dice:
   `aviso_privacidad_en = '2026-09-10'`, `version = '2xm70b'`. **`'1k4zq9'` y el
   1-mar-2026 dejaron de existir.**
4. Marzo de 2027. Juan reclama por la coordenada que el 10-may-2026 se le mandó a
   «Grúas del Bajío». La flota —la responsable— tiene que probar qué aviso estaba
   puesto a disposición ese día. En la base solo hay una fecha de septiembre y
   una cadena de seis caracteres. No puede acreditar (a) que en mayo Juan tenía
   algún aviso vigente, (b) qué decía, ni (c) —lo que aquí decide el caso— que el
   texto de mayo **no** declaraba esa transferencia, porque el párrafo entró el
   8 de septiembre.

**Intenté refutarlo y no se cae.** (a) ¿El texto vive en el mensaje enviado?
`envio_mensaje` se purga, y `ejecutar_arco_cancelacion` lo **borra** por teléfono
normalizado (`0356:68-72`): ejercer un derecho destruye la única copia accidental
del texto. (b) ¿`liberarEnvioAviso` protege esto? Protege el caso contrario, y el
comentario de `repo.ts:1410-1427` demuestra que el equipo ya razonó sobre la
carga de la prueba —«"no consta" es el peor estado posible»— pero solo para el
fallo de envío, no para la sobreescritura de una constancia válida. (c) ¿El hash
sirve como prueba de contenido? No: es un hash **no criptográfico de 32 bits**
elegido a propósito («no es criptografía: solo tiene que cambiar cuando el texto
cambia», `:369-370`), y sin el texto guardado no se puede recomputar para cotejar.
(d) ¿La página pública lo suple? No: `/aviso/[tenant]` renderiza el texto de
**hoy** bajo un rótulo `VIGENTE_DESDE = '2026-09-01'` fijo a mano
(`page.tsx:38`) — que además es falso (LEG-M1), de modo que la única
representación pública del aviso no distingue versiones ni conserva las viejas.

**Consecuencia.** El diseño del art. 16 está invertido: el sistema guarda la
**decisión** de si hay que reenviar (que es lo que necesita el motor) y tira la
**evidencia** de qué se entregó y cuándo (que es lo que necesita el responsable
ante la Secretaría). Cada vez que Likida mejora el aviso —y lleva tres rondas
mejorándolo— borra, para toda la flota, la prueba de la versión anterior. Es
deuda que cobra factura hacia atrás: cuanto mejor queda el aviso, menos
demostrable es el pasado.

**Causa raíz probable.** La constancia se modeló como dos columnas en `operador`
(0018) en vez de como una tabla de eventos, y la 0033 separó reserva de
constancia sin revisar esa decisión: `confirmar_aviso_privacidad` es un `update`,
no un `insert`.

---

### [ALTO] LEG-A1 — El párrafo de la transferencia acota el dato a «la ubicación que compartiste por el chat», y un siniestro abierto por la cámara le manda a la grúa la coordenada de la TELEMETRÍA, que el operador nunca compartió (REINCIDENTE de LEG-A1/30, intacto)

`src/lib/likida/privacidad.ts:912` · `:687` · `:690` · `:712` · `:715` ·
`src/lib/likida/asistencia_camara.ts:200-211` (en concreto `:209-210`) ·
`src/lib/likida/asistencia_proveedor.ts:45-47` ·
`src/lib/likida/asistencia_coordinacion.ts:316-317`

Reverificado: `privacidad.ts:912` sigue diciendo «tu **ubicación** —la que
compartiste por el chat— se le manda al **proveedor de auxilio en carretera**», y
`asistencia_camara.ts:209-210` sigue creando la incidencia con **`lat: e.lat,
lng: e.lng`** tomados del evento de la cámara (el mismo bloque pone
`hayLesionados: null` con el comentario «La cámara NO sabe de lesionados», lo que
confirma que esa rama es la del dispositivo, no la del chat).
`asistencia_coordinacion.ts:316-317` sigue leyendo `inc.lat/inc.lng` sin
distinguir origen.

El aviso mantiene las dos categorías **separadas por diseño**: fr. II enumera por
un lado «la **posición GPS de la unidad**» (`:687`) y por otro «la **ubicación que
tú decidas compartir** por el chat» (`:690`); y la finalidad del evento de cámara
nombra un destinatario cerrado, «abrir el expediente de asistencia y **avisar a
tu empresa**» (`:712`, `:715`). La transferencia mejor documentada del repo sigue
sin cubrir a la población que no puede haber compartido nada porque está
aturdida.

**Consecuencia.** Transferencia de dato personal sin cobertura en el aviso — uno
de los dos que fijan el ancla del rubro en 3.

---

### [ALTO] LEG-A5 — El teléfono personal del jefe de tráfico se transfiere a la grúa/llantera, y el aviso que Likida le dio a esa persona enumera solo encargados y promete pedir permiso antes de cualquier transferencia (REINCIDENTE de LEG-A5/30, intacto)

`src/lib/likida/asistencia_coordinacion.ts:125` · `:305` ·
`src/lib/likida/contactos.ts:120-123` · `:185-227` ·
`src/app/privacidad/page.tsx:58` · `:124` · `:130` · `:132`

Reverificado: `asistencia_coordinacion.ts:125` sigue cerrando el mensaje con
`` `Contacto directo del jefe de tráfico: ${d.telefonoJefe}.` `` y `:305` sigue
resolviendo ese número **por orden de rol**, no por quien autorizó. Del otro
lado, `/privacidad` —donde `page.tsx:58` declara que **Likida es la
responsable** de «quien contrata y usa el servicio»— enumera en «Con quién se
comparten» **solo personas encargadas** (alojamiento, WhatsApp, correo,
monitoreo, modelos en `:124`; Stripe en `:130`) y cierra en `:132`: «**Si algún
día quisiéramos transferir tus datos para algo distinto, te lo pediríamos
antes.** No hacer nada al leer esto no cuenta como haber aceptado.» **Cero
transferencias declaradas**, y el documento del operador (`privacidad.ts:912`)
declara el dato de esa otra persona: «el contacto que se les da es el del jefe de
tráfico».

**Consecuencia.** La segunda transferencia sin cobertura, y ésta con Likida como
responsable por derecho propio, no como encargada. Es la que el contralor —el
comprador, cuyo celular es el que sale— puede verificar en diez segundos.

---

### [ALTO] LEG-A2 — La pantalla de ARCO le dice a la contralora, ANTES de apretar el botón, que el contacto de emergencia se CONSERVA, y después del mismo clic le dice que se borró (REINCIDENTE de LEG-A2/30, intacto)

`src/app/dashboard/arco/page.tsx:258-264` (en concreto `:262`) · `:33` ·
`src/app/dashboard/arco/cancelacion_alcance.test.tsx:32-47` (en concreto `:45`)

Reverificado, pegado del archivo de hoy. El `<span>` junto al botón «Ejecutar
cancelación» (`page.tsx:258-264`) sigue diciendo «Se conservan … **su contacto de
emergencia** y su registro de jornada laboral», y `ALCANCE_CANCELACION` (`:33`),
que se pinta **después** del mismo clic, sigue diciendo «se eliminaron sus
conversaciones **y el contacto de emergencia registrado sobre su persona**». La
que manda es la segunda: `0356:76-78` hace `delete from contacto_emergencia`.

El arnés sigue sin poder atraparlo: `cancelacion_alcance.test.tsx:45` es
`expect(texto).toMatch(/contacto de emergencia/i)` — substring, no polaridad. La
suite corrió hoy en verde (parte de los 169).

**Consecuencia.** El comprador toma una decisión legal irreversible sobre datos
de un tercero (el familiar del chofer) leyendo lo contrario de lo que va a pasar,
con las dos frases en la misma pantalla.

---

### [ALTO] LEG-A3 — El texto de resolución que la RPC persiste y archiva enumera cuatro categorías conservadas; el WhatsApp y la pantalla enumeran siete (REINCIDENTE de LEG-A3/30 y /29, tercera ronda)

`supabase/migrations/0356_arco_borra_contacto_emergencia.sql:121` · `:129` ·
`src/lib/likida/repo.ts:1828` · `src/app/dashboard/arco/page.tsx:33`

Reverificado con los dos textos abiertos y comparados:

- `solicitud_arco.resolucion` (`0356:121`): «Se conservan el identificador del
  operador, el correo de la cuenta, la referencia del titular en la solicitud y
  la documentación fiscal.» → **cuatro**.
- El WhatsApp al titular (`repo.ts:1828`): las cuatro **más** «los eventos de
  cámara, telemetría (se borran solos a los 180 días, o 365 si fueron graves) y
  jornada laboral ligados a tu persona» → **siete**.

`resolucion` es lo que la pantalla pinta para toda solicitud resuelta y lo que la
flota exhibiría bajo el art. 31; el WhatsApp no se archiva. Y con los dos
hallazgos nuevos de esta ronda la lista real es más larga todavía: la imagen del
comprobante descartado (LEG-31-C1) y el POD (LEG-31-M1) tampoco están en ninguno
de los dos textos.

---

### [ALTO] LEG-A4 — La solicitud ARCO de una cuenta de oficina sigue naciendo con `operador_id = NULL` y la cancelación sigue siendo inejecutable (REINCIDENTE de LEG-A4/30 y LEG-A2/29, cuarta ronda)

`src/lib/likida/processor.ts:1596-1600` (en concreto `:1600`) ·
`src/lib/likida/contactos.ts:96` ·
`supabase/migrations/0356_arco_borra_contacto_emergencia.sql:39-41` ·
`src/app/privacidad/page.tsx:150` · `:170`

Reverificado, pegado del archivo de hoy — `processor.ts:1600` sigue siendo

```ts
await atenderPrivacidad(tenantId, porOperador?.operadorId ?? null, msg.from, msg.text);
```

y el `tenantId` de `:1597-1599` sale, cuando no hay operador, de
`resolverCuentaOficina(msg.from)`, cuyo retorno **incluye `userId`**
(`contactos.ts:96`) y se descarta en el mismo renglón. Ana Rivera, encargada de
`t-9`, escribe «ya no trabajo ahí, borren mis datos» → `solicitud_arco` con
`operador_id = NULL` → `ejecutar_arco_cancelacion` rebota en `0356:39-41` con
«solicitud sin operador o de otra flota».

**Nuevo dato de esta ronda que agrava el reincidente:** es exactamente esta
población la que `/privacidad` —donde **Likida** es la responsable— le promete
por escrito el borrado. `page.tsx:150`: «Al darte de baja no corre un plazo
automático: **se borran cuando lo pides** … y se te confirma por escrito.» Y
`:170`: «**Se borran tus datos de cuenta y de acceso.**» No existe camino de
código que lo ejecute para nadie que no sea chofer.

**Causa raíz probable.** `solicitud_arco.operador_id` referencia `operador`: el
esquema no tiene dónde poner a un titular que no es chofer, y los cuatro
intentos de arreglo se han hecho sobre el llamador.

---

### [ALTO] LEG-A6 — La oposición al tratamiento automatizado sigue sin poder encenderse cuando la flota no capturó su razón social: el único escritor vive dentro del `if (datos)` (REINCIDENTE de LEG-A6/30 y LEG-A1/29, tercera ronda)

`src/lib/likida/processor.ts:341-372` (el `if (datos)` en `:342`, el escritor en
`:352-356`, el `warn` del `else` en `:365-370`) · `:377-380` ·
`supabase/migrations/0178_fiscal_retencion_arco_y_perfiles_erp.sql:152-162`

Reverificado con el bloque completo a la vista: el `update` de
`operador.oposicion_automatizada` —el único de esa columna en todo `src/`,
confirmado con `grep -rn "oposicion_automatizada" src/`, que devuelve un solo
escritor (`processor.ts:354`) y un solo lector
(`cuadre/desde_db.ts:95 → engine.ts:616`)— sigue anidado dentro de `if (datos)`,
y el `logger.warn('arco.oposicion_sin_operador')` de `:369` sigue **dentro del
mismo `if`**. Con `tenant.razon_social` nulo, `getDatosResponsable` devuelve
`null`, el bloque entero se salta, el titular recibe «Tu solicitud quedó
registrada. Déjame checar con la empresa…» (`:379`) y el único rastro es
`privacidad.solicitud_sin_datos_responsable` (`:377`), que habla del responsable,
no del derecho que no se encendió. `ejecutar_arco_oposicion` (`0178:152-162`)
tampoco escribe la columna: no hay salida manual.

**Consecuencia.** Falla silenciosa en sentido estricto: hay constancia de
recepción, el motor sigue cerrando liquidaciones solo (`engine.ts:616` nunca
recibe `true`), y ni el titular ni la flota tienen forma de saberlo.

---

### [ALTO] LEG-A7 — La anonimización de `incidencia` es reversible por `viaje_id`: `hay_lesionados` —dato de salud— sobrevive a la cancelación y se re-liga al titular por el identificador que la propia función conserva (REINCIDENTE de LEG-A7/30, intacto)

`supabase/migrations/0356_arco_borra_contacto_emergencia.sql:85-89` · `:121` ·
`supabase/migrations/0047_operacion_encargado.sql:100` ·
`supabase/migrations/0198_asistencia_siniestros.sql:46` ·
`src/lib/likida/asistencia_wa.ts:530-537` · `src/lib/likida/privacidad.ts:746`

Reverificado: `0356:85-89` sigue haciendo `update incidencia set descripcion =
'[texto retirado…]', operador_id = null, texto_anonimizado_en = now()` y sigue
**sin tocar `viaje_id`** (`0047:100`, `on delete cascade` contra `viaje`) **ni
`hay_lesionados`** (`0198:46`). Con `viaje.operador_id` conservado a propósito
(`0356:121`), la consulta

```sql
select i.hay_lesionados, i.abierta_en, i.unidad_id
  from incidencia i join viaje v on v.id = i.viaje_id
 where v.operador_id = 'op-1';
```

devuelve el dato de salud después de una cancelación ejecutada y acusada. Aplica
a **toda** incidencia colgada de un viaje, que son las dos vías de creación (el
chofer por WhatsApp y la cámara).

---

### [MEDIO] LEG-31-M1 — `pod` (la carta porte sellada que el chofer fotografía) es una categoría de dato que el catálogo del art. 15 fr. II no enumera, sin purga y fuera del alcance de la cancelación

`src/lib/likida/privacidad.ts:661-669` (el catálogo de la fr. II; en concreto
`:664`) · `src/lib/likida/pod_wa.ts:83-91` · `:105` ·
`src/lib/likida/processor.ts:2348` · `:2361` · `:2367` ·
`supabase/migrations/0047_operacion_encargado.sql:127-148` ·
`supabase/migrations/0335_db_retencion_r3_forward.sql:314-345` ·
`supabase/migrations/0356_arco_borra_contacto_emergencia.sql:61-125`

**Norma.** Art. 15 fr. II — la ley de 2025 **añadió** la obligación de enumerar
el catálogo de datos tratados; la abrogada (art. 16) no la pedía. El propio repo
lo escribe: `docs/conocimiento/11-datos-personales.md:187` («**Fr. II es
nueva** … Hoy tienes que **listar el catálogo de datos**»).

**Escenario (con valores).** Juan Pérez (`op-1`, `t-9`), viaje `v-77`, fotografía
en el andén la carta porte sellada y la manda con el caption «aquí la carta porte
ya sellada».

1. `processor.ts:2348` la reconoce por el caption (`esCaptionPod`).
2. `processor.ts:2361` la sube: `subirComprobante(op.tenantId, viajeId, hash,
   dataUrl)` → `9f3c…/v-77/3d9e….jpg` en el bucket `comprobantes`.
3. `processor.ts:2367` → `guardarPodDelChofer` (`pod_wa.ts:83-91`) hace `upsert`
   en `pod` con `operador_id = 'op-1'`, `storage_path`, `estado = 'subido'`,
   `capturado_en`. La tabla admite además `lat`, `lng` y `nota` libre
   (`0047:133-136`).
4. Likida le contesta (`pod_wa.ts:105`): «Recibí tu carta porte sellada ✅ —
   quedó guardada como **evidencia de entrega** de este viaje.»

Contra lo que el aviso le enumeró a Juan. El catálogo de la fr. II
(`privacidad.ts:661-669`) tiene cinco renglones, y el de fotos está **acotado a
gastos** (`:664`): «Las **fotos de comprobantes** que envías por WhatsApp —diésel,
casetas, alimentación, hospedaje, refacciones— y lo que viene escrito en ellas».
La carta porte no es ninguno de esos cinco conceptos y el propio código lo
subraya: «**POR QUÉ NO ES UN GASTO** — La carta porte no vale dinero en la
liquidación: es EVIDENCIA de entrega» (`pod_wa.ts:17-19`). Tampoco cae en «el
contenido de tus mensajes» (`:665`): es un documento con su firma y sello, no
prosa de chat.

Y una vez dentro no sale:

- `pod` **no aparece en ninguna** de las 18 funciones de `mantenimiento_de_datos`
  (`0335:314-345`).
- `pod` **no aparece en `0356`** (`grep -n "\bpod\b" 0356*.sql` → sin
  coincidencias). La cancelación no lo toca; `operador_id` es `on delete set
  null` (`0047:131`) y la cancelación **no borra** la fila de `operador`, la
  anonimiza.
- La imagen queda en `9f3c…/v-77/…jpg`, con `v-77` existente, así que
  `limpiar_storage_huerfano` jamás la condena — y si llegara a la cola, el
  trigger `0178:39-49` la marcaría `fiscal_cff_30`.

**Intenté refutarlo y no se cae.** (a) ¿Retención justificada? Probablemente sí
—la carta porte es documentación fiscal— pero eso responde al plazo, no a la
**declaración**: la fr. II no admite «está justificado» como sustituto de
«está enumerado», y la constancia de cancelación (`0356:121`, cuatro categorías)
tampoco lo nombra entre lo conservado. (b) ¿Lo cubre «los viajes y liquidaciones
en los que participas» (`:665`)? Ese renglón habla de registros de viaje, no de
una fotografía de un documento firmado por él; el aviso separó explícitamente
«fotos» de «viajes» en dos renglones distintos.

**Consecuencia.** Una categoría de dato que el titular entrega a propósito, con
acuse escrito de Likida, y que su aviso no menciona. Ensancha LEG-A3: la
constancia del art. 31 enumera cuatro cosas conservadas y ésta es la octava que
sobrevive sin estar dicha.

**Causa raíz probable.** El catálogo de la fr. II se escribió enumerando los
conceptos de **gasto** del motor de liquidación, y el POD entró al producto
(F4) por un camino que deliberadamente «no toca `gasto`, no paga visión y no
participa en la barrera del listo» — el mismo aislamiento que lo dejó fuera del
inventario legal.

---

### [MEDIO] LEG-M1 — El aviso integral público anuncia «Vigente desde el 1 de septiembre de 2026» sobre un texto que cambió el 8 de septiembre (REINCIDENTE de LEG-M1/30 y /29, tercera ronda)

`src/app/aviso/[tenant]/page.tsx:38` · `:109` ·
`src/lib/likida/privacidad.ts:912-913` ·
`src/app/legal/marco_leg12_aud24.test.ts:25-34`

Reverificado: `VIGENTE_DESDE = '2026-09-01'` (`:38`, con el comentario
«Actualizar junto con el texto») y la página imprime «Vigente desde el
{fechaMx(VIGENTE_DESDE)}» (`:109`). `git log -1 --format='%h %ad' --date=short --
src/lib/likida/privacidad.ts` → **`8fc2fa7 2026-09-08`**, el commit que añadió el
párrafo entero de la transferencia al proveedor de auxilio. Un titular que abra
la liga hoy lee una sección de transferencias que no existía en la fecha que el
encabezado le declara vigente. El único candado exige que la fecha sea
**constante**, no que sea **cierta**.

Duele el doble junto a LEG-31-A1: la firma que decide el reenvío sí se movió ese
día y borró la constancia anterior; el rótulo que la persona lee, no.

---

### [MEDIO] LEG-M3 — El derecho de acceso sigue siendo el tipo por omisión y el único sin acto asociado: no existe función que arme el paquete de datos de un titular (REINCIDENTE de LEG-M3/30, LEG-M1/29 y /28, cuarta ronda)

`src/lib/likida/privacidad.ts:958` (`return 'acceso'`) ·
`src/app/dashboard/arco/page.tsx:255-288` · `src/app/api/export/`

Reverificado: `privacidad.ts:958` sigue siendo `return 'acceso'` como caída por
omisión de `tipoDeSolicitudArco`. En `/dashboard/arco`, `cancelacion` tiene
ejecutor y `oposicion` tiene constancia; `acceso` solo ofrece «Responder» con un
campo de prosa. `ls src/app/api/export/` da hoy **siete rutas** (`liquidaciones`,
`pdf`, `facturas-proveedor`, `bitacora-peaje`, `jornada`, `carta-porte-xml`,
`poliza`) más `rutas_export.test.ts`: **todas de flota**, ninguna arma el
expediente de un titular.

**Consecuencia.** El derecho que la ley pone primero, y al que cae por omisión
toda solicitud que la heurística no clasifica, es el único que el producto no
puede ejecutar. Art. 31: 20 días hábiles para una determinación sin contenido
posible.

---

### [MEDIO] LEG-M4 — «Contesta BAJA y se borran tus datos de persona» sigue siendo falso para quien agendó una demo: el payload íntegro de Cal.com queda 365 días y la baja no lo toca por diseño declarado (REINCIDENTE de LEG-M4/30 y LEG-M2/29, tercera ronda)

`src/lib/likida/privacidad.ts:1088` ·
`src/lib/correo/respuesta_campana.ts:109-112` (en concreto `:111`) ·
`src/lib/admin/calcom_webhook.ts:190` ·
`supabase/migrations/0245_purga_prospecto_entera_y_ledger_comercial.sql:139-148`

Reverificado: `respuesta_campana.ts:111` sigue diciendo, literal, que la función
«No toca … `comercial_evento` (la anonimiza `purgar_comercial_evento` **por edad,
no por baja**)», y `calcom_webhook.ts:190` sigue guardando `p_payload:
evt.payload ?? {}` completo —`attendees[].name`, `.email`, `.phone`, `.timeZone`
y las respuestas libres. María Fernández agenda el 1-mar-2026, contesta BAJA el
10-mar, recibe confirmación escrita, y sus datos siguen hasta el 1-mar-2027.
Aquí Likida es **responsable**, no encargada: acuse documentado de un borrado que
no ocurrió.

---

### [BAJO] LEG-B1 — Los comentarios que fundamentan datos sensibles, voz y confidencialidad siguen citando la numeración de la ley ABROGADA (REINCIDENTE de LEG-B1/30 y /29, tercera ronda)

`src/lib/likida/privacidad.ts:295` · `:322` · `:734` · `:746` ·
`src/lib/meta/client.ts:744`

Reverificado con `grep -rn "art\. 3 fr\.\|art\. 21"`: cuatro coincidencias de
«art. 3 fr.» en `privacidad.ts` —que es la fuente de verdad del aviso— y una de
«LFPDPPP art. 21» en `meta/client.ts:744`. La LFPDPPP vigente es la del **20 de
marzo de 2025**: las definiciones están en el **art. 2** y la confidencialidad en
el **art. 20** (`docs/conocimiento/11-datos-personales.md:37-52`, tabla de
equivalencias del propio repo). El archivo hermano lo tiene bien
(`intake/sanitizar.ts:35`, «art. 2 fr. VI»). Lo que el titular lee está correcto;
el daño es de due diligence sobre el archivo que un abogado abriría primero.

---

## Lo que revisé y está bien

- **La oposición del art. 26 fr. II, cuando llega a encenderse, sí muerde.**
  Traza completa verificada de punta a punta: un solo escritor
  (`processor.ts:354`), un solo lector (`cuadre/desde_db.ts:95`), un solo
  consumidor (`engine.ts:616`), y ese consumidor empuja una `Diferencia` de tipo
  `oposicion_titular` que impide que la liquidación quede `cuadrada` sola. El
  comentario de `desde_db.ts:86-91` explica por qué la lectura del operador va
  **sin** `.catch(() => null)`: tragarse el fallo liquidaría en automático a
  quien ejerció el derecho. Es una defensa deliberada y correcta. El defecto
  (LEG-A6) está aguas arriba, en que el interruptor no llega a encenderse.
- **El reloj del art. 31 existe, corre y se pinta.** `solicitud_arco.vence_en`
  (0053), `diasHabiles` en `privacidad.ts:966`, y `/dashboard/arco:170-174` +
  `:200` + `:241` con `venceDentroDe`/`yaVencio` y el comentario de `:62-64` que
  documenta por qué el corte es en hora de México y no UTC. Además
  `getSolicitudesArcoPendientes` (`admin/escalaciones.ts:49-58`) alimenta la
  bandeja del superadmin. Contar solo lunes-viernes sin excluir días festivos
  produce un `vence_en` **anterior o igual** al real: yerra a favor del titular,
  así que no lo reporto.
- **El aislamiento del circuito de soporte es una propiedad de cada consulta.**
  `soporte.ts:23-32` lo declara y el código lo cumple: ninguna función cruza
  flotas, ni la del superadmin, que resuelve el tenant antes por
  `lib/admin/soporte.ts`. La nota interna se filtra **en la consulta**
  (`.eq('interna', false)`, `soporte.ts:197-198`) y un actor `{tipo:'flota'}` que
  pida `interna: true` se rechaza antes de tocar la base. `ticket_soporte`
  cascadea al borrar el tenant (`0051:26`) y `ticket_mensaje` al borrar el ticket
  (`0051:61`), así que el borrado de una flota no deja prosa de personas atrás.
  Levanto el pendiente que la 30 arrastraba dos rondas.
- **`ejecutar_arco_cancelacion` es exactamente lo que dice ser.** Releí el cuerpo
  vivo (`0356:35-125`): ocho escrituras, cada una con su contador en `evidencia`,
  el `delete from contacto_emergencia` de `:76-78` intacto y con su razón escrita
  («dato de un TERCERO sin fundamento fiscal que lo retenga»). La renuncia
  declarada de la purga por antigüedad del contacto de emergencia sigue bien
  documentada en la cabecera y en el `comment on function` (`:129`): media verdad
  **dicha** es la forma correcta de dejar una deuda.
- **`purgar_geolocalizacion_incidencia` hace bien lo que dice hacer**
  (`0289:54-69`): cuenta desde `resuelta_en`, ordena bitácora antes que
  incidencia para que una corrida cortada no deje el pin del evento vivo, y deja
  `geolocalizacion_purgada_en` para que el hueco no se lea como «nunca hubo pin».
  El problema es el almacén que no enumeró (LEG-C1), no la función.
- **Toda salida a modelo sigue saliendo por una puerta.** Un solo `baseURL`
  (`llm/openrouter.ts:36`) y los tres cuerpos de petición extienden
  `PROVIDER_OPTS` (`:281-282`) en `:382`, `:709` y `:1172` con
  `provider: { data_collection: 'deny' }`. El aviso describe eso —que se **pide**—
  y no promete un contrato de retención cero. Verificado que no hay un cuarto
  camino: `grep` de `baseURL` en `src/lib/llm/` devuelve una sola línea.
- **`sanitizarProducto` corre antes de persistir, y su límite está escrito.**
  `intake/ocr.ts:686` lo aplica al único campo con contenido libre del papel, y
  `sanitizar.ts:47-51` declara el límite sin adornos: «esto reduce lo que se
  PERSISTE, no lo que se remite». Ese límite declarado es justo el que LEG-31-C1
  convierte en daño permanente, pero el filtro en sí está bien hecho y bien
  fundamentado (cita `art. 2 fr. VI`, la numeración vigente).
- **La compuerta «no se trata antes de avisar» falla cerrada.**
  `privacidad.ts:1157-1184` y `:1250-1270`: sin poder leer, la respuesta es «no».
- **El catálogo de la fr. II se declara POR FLOTA según lo medido.** `SenalGps`
  (`privacidad.ts:637`, `:680-690`) declara el rastreo satelital en tres estados
  —`conectado`, `sin_conector`, `no_medible`— según `conector_credencial`, y el
  texto de `no_medible` se mantiene byte-idéntico a propósito para que una falla
  de la medición no dispare reenvíos a media flota. Es la clase de matiz que casi
  nadie escribe y aquí está bien resuelto.
- **Suite del rubro en verde.** `npx vitest run privacidad arco` → 21 archivos,
  169 pruebas, 169 pasando, 3.78 s. (Ninguna cubre los tres hallazgos nuevos:
  lo cuento como cobertura ausente, no como suite rota.)

## Lo que NO alcancé a revisar

- **La retención del lado del proveedor** (Meta, OpenRouter y su cadena,
  Facturapi/PAC, Stripe, Cal.com, Samsara). **Quinto pendiente consecutivo.**
  Desde el repo se lee lo que se **pide** en cada llamada, no lo que el proveedor
  cumple; sin red saliente no hay forma de cotejar contra sus términos. Es el
  hueco estructural del rubro y no se va a cerrar leyendo código.
- **`docs/conocimiento/52-anexo-subencargados.md`**: existe y no lo abrí. Si
  enumera subencargados, es la pieza que decide si la cláusula de
  `/privacidad:132` («el detalle de esos subencargados está en la documentación
  del producto») es verdad o una remisión a la nada.
- **La retención de los logs de plataforma** (`processor.ts:1834-1837` escribe la
  transcripción íntegra de la nota de voz en el log). **Sexto pendiente
  consecutivo.** Sin panel de Vercel no se mide.
- **La cláusula del art. 35 con casilla de aceptar/rechazar.** El propio repo la
  declara obligatoria (`docs/conocimiento/11-datos-personales.md:190`: «sí tienes
  que poner las transferencias en el aviso, **y además con una casilla de
  aceptar/rechazar**»), y no encontré mecanismo alguno en `privacidad.ts` ni en
  `/privacidad`. **No lo reporto como hallazgo** porque no pude resolver si las
  transferencias vivas caen todas en las excepciones del art. 36 (que dispensan
  el consentimiento pero quizá no la cláusula). Necesita criterio legal humano,
  no lectura de código. Lo dejo anotado porque, si la respuesta es que sí hace
  falta, es un hallazgo de estructura, no de detalle.
- **`portal_credencial` e `invitacion`**: sin escritor según el MAPA; no verifiqué
  si algún camino nuevo las llena. La revocación que sí existe
  (`conectores/credenciales.ts`, `facturacion/sesion_portal.ts`) la 30 la dio por
  buena y no la re-corrí.
- **`comercial_evento` / prospectos más allá de LEG-M4**: no recorrí el resto del
  embudo comercial, donde Likida es responsable por derecho propio.
- **La base entera está en cero** (0 viajes, 0 clientes). Ningún escenario se
  confirmó contra filas reales: todos están construidos leyendo código,
  migraciones y fichas de `normas/`, y **cada línea citada la abrí y la leí**. Las
  afirmaciones sobre SQL que solo corre contra Postgres —los tres candados de
  LEG-31-C1, el `delete` de `contacto_emergencia`— las tomo del texto de las
  migraciones, no de una corrida.
