# Plan por fases para cerrar el ciclo punta a punta (23-ago-2026)

Regla de orden: **primero lo que no necesita integración externa**, porque una integración
convierte una fase de días en una de semanas y mete a un tercero en la ruta crítica.
Regla de corte: cada fase termina en algo que se puede **demostrar a un cliente**, no en
"infraestructura lista".

---

## FASE 0 — El día 1, en paralelo a todo (bloquea la Fase 5)
Mandar a aprobación de Meta las plantillas nuevas. Tardan días y no dependen de código:
`siniestro_reportado_v1` y `siniestro_sin_atender_v1`.
**No reusar `recordatorio_cierre`** — `escalar_viaje` ya admite que su texto habla de otro evento.
Y recordar que **una plantilla no lleva botones**: el texto debe invitar a responder, que es lo
que reabre la ventana de 24 h.

---

## FASE 1 — Los litros que hoy se tiran  *(2-3 días, sin integración)*
El arreglo con mejor relación esfuerzo/dinero de todo el sistema.

> **ESTADO AL 28-ago-2026.** Los puntos 1 y 2 están **hechos y en `master`**
> (mig. `0168`: `litros` + `clave_prod_serv`; `litrosDeLinea` /
> `claveProdServDeLinea` / `ligarLineaAGasto` en `intake/consolidado.ts`).
> El punto 3 está hecho **sobre un fixture sintético, no sobre un ECC real**:
> el repo no tiene un solo `.xml` y los tres fixtures ECC son el mismo string
> de relleno. Los puntos **4 y 5 siguen abiertos a propósito**, con el
> análisis y la recomendación escritos y **pendientes de decisión de Javier**
> en `docs/asistencia/ECC-FORMAPAGO-99.md`. Ojo con el punto 4: el motor **no
> apaga hoy** los litros por el `99` del ECC —el camino de consolidado nunca
> copia `forma_pago` del encabezado—, así que el riesgo real es otro y está
> descrito en ese documento.

`cfdi_xml.ts:87` ya parsea `cantidad` de cada línea ECC, pero `cfdi_consolidado_linea` (mig. 0076)
**no tiene columna para litros** — se leen y se tiran al persistir. Consecuencia: toda flota con
monedero obtiene conciliación de gastos y **cero litros acreditables de IEPS**, que es justo el
segmento donde el estímulo vale más.

1. Migración: `litros numeric(12,3)` y `clave_prod_serv text` en `cfdi_consolidado_linea`.
2. Mapear `cantidad` → `litros` al persistir; sumar sólo `15101505` (diésel).
3. Prueba de equivalencia contra un ECC real.
4. **Antes de tocar `engine.ts:1185`, verificar la pregunta abierta §6.2**: si el CFDI del monedero
   viene con `FormaPago = 99` (crédito con el emisor), hoy se tiran los litros de TODO el mes.
   El `99` describe cómo la flota le pagó al emisor, no cómo se pagó en la bomba.
   **Esto se decide con un ECC real en la mano, no con lectura de norma.**
5. Endurecer el CHECK de `gasto.forma_pago` (mig. 0025:97) contra el catálogo real del SAT:
   hoy sólo valida `^[0-9]{2}$` y un `'77'` inventado por el OCR entra.

## FASE 2 — Que el ticket de monedero deje de contarse dos veces  *(2 días, sin integración)*

> **ESTADO AL 28-ago-2026 — el párrafo de abajo YA NO ES CIERTO y se conserva
> como el diagnóstico del 23-ago.** RMF 3.3.1.7 **sí se aplica** desde esa
> misma noche: `intake/padron_monederos.ts` (semilla de 13 RFC con su fuente)
> + `intake/evidencia_monedero.ts` (los dos caminos: padrón, o línea ECC del
> mismo día/estación/monto) → `cuadre/engine.ts` (diferencia
> `ticket_monedero`) y `sat_descarga/cruce.ts` (un CFDI de emisor de monedero
> nunca se cruza 1:1). Al chofer no se le cobra nada por esto:
> `ticket_monedero` **no** está en la lista de "no entró en tu cuenta" de
> `cierre_aviso.ts`, y se rutea a `'panel'`, no a una decisión del jefe.
> Sigue abierto el **punto 3** (vigilancia de la ficha 7/ISR): no hay cron ni
> aviso, y la ventana de renovación está abierta ahora mismo.

RMF 3.3.1.7 **no se aplica en ningún lado** del código (sólo se menciona en el ROADMAP).
La gasolinera tiene PROHIBIDO facturar una carga de monedero, así que el ticket que el chofer
fotografía no vale fiscalmente — pero el dedup no lo ve como copia (el ticket no trae UUID y su
folio es el de la estación; la línea ECC trae el UUID del monedero con su `orden`).
Resultado hoy: **la carga entra dos veces, se infla el viaje y se le cobra al chofer una diferencia
que no existe.**

1. Sembrar el padrón de RFCs de emisores de monedero (los 13 del corpus como semilla).
   Ojo: el SAT publica **dos listas en dos URLs que no coinciden** — hay que leer las dos, más el
   padrón de no renovados.
2. Regla: si el gasto tiene RFC de emisor en el padrón, **o** existe una línea ECC del mismo día,
   estación y monto, el ticket es **evidencia operativa (litros, odómetro, hora), nunca un gasto**.
3. Vigilancia de la ficha 7/ISR: la autorización del emisor se renueva con aviso **entre agosto y
   octubre**. Estamos dentro de la ventana. Si el emisor cae, el cliente se queda sin comprobante
   deducible de combustible y hoy nadie le avisa.

## FASE 3 — Consolidar el perfil, ANTES de construir encima  *(1 semana, sin integración)*
No estaba en el plan original y tiene que ir aquí. **El perfil del cliente ya existe, repartido en
cinco lugares que no se hablan**: `tenant.config`, columnas de `tenant`, `agente_cobranza_config`
(0089), `agente_notificacion_config` (0097) y `conector_credencial` (0094). El plano de siniestros
proponía un **sexto**. Construir agentes nuevos antes de consolidar es construir encima de la deriva.

Y el tamaño del problema: **de los 10 agentes vivos sólo 2 leen algo del cliente** — liquidación
(todo) y conductores (`horasEscalacion`). Las únicas dos perillas editables del producto son un
umbral de OCR y un número de horas.

1. `tenant.perfil jsonb` como **columna propia** en la misma fila. No una llave más de `config`
   (`getConfig()` **fusiona los defaults de demo**, así que estructuralmente no puede contestar
   "¿esto lo declaró el cliente o es nuestro relleno?" — por eso ya hay dos lectores que se lo
   saltan). No tabla aparte (`getConfig` es una sola consulta bajo `COSTO_AGENTE_MS = 15_000` en
   el camino caliente de WhatsApp).
2. Historial en `tenant_perfil_version` **con trigger, no por convención**, porque
   `actualizarFacilidad15` ya escribe sin bitácora y nadie lo notó. Sello `perfil_version` en
   `liquidacion` y `liquidacion_historico`.
3. `perfil/preguntas.ts` como punto único, que **expone decisiones, no campos**:
   `decidir()` **no acepta `inferido`**; `sugerir()` sí, y devuelve la pregunta.
   Un agente que quiera actuar sobre una inferencia tiene que llamar a una función que no existe.
4. **Migrar al perfil la facilidad del 15%, la ventana de cobranza y `ORDEN_AVISO`.**
   Esto va antes que cualquier agente nuevo.

**Tres huecos fiscales abiertos HOY que esta fase cierra:**
- `estimulos.peajeFactor = 0.5` se aplica **sin condición** (`config.ts:127`), pero LIF 2026 20-A
  es sólo para ingresos **< $300M**. **Una flota grande está recibiendo un estímulo que no le toca.**
- Ni `carta_porte.ts` ni `fiscal.ts` mencionan **"dedicado"**, y la RMF 2.7.7.1.3 **invierte los
  roles** del complemento en transporte dedicado (el corpus ya lo advierte,
  `00-RESUMEN-EJECUTIVO.md:227`).
- `normas/rfa-2026-2.2.yaml` está verificada contra fuente primaria y **ningún archivo de `src/`
  la lee** — la deducción del 8% sin documentación, sin aplicar.

Y uno que protege a Likida, no al cliente: con **hombre-camión** los viáticos son práctica fiscal
indebida, y la fracción II del Criterio 6/ISR/PI **alcanza al proveedor de software**.

Diseño completo en `docs/perfil/PERFIL-OPERATIVO.md`.

## FASE 4 — El agente de asistencia, versión que ya sirve  *(1 semana, sin integración)*
Corresponde a la migración `0168` y a los pasos 1-2 del plano técnico. Al terminar esta fase el
agente **ya es demostrable**, aunque todavía no tenga GPS ni mapas.

1. Migración 0168 + bloque de verificación: ampliar `incidencia` (tipos `siniestro|robo|
   emergencia_medica|varado|bloqueo`, prioridad `critica`, lat/lng, `hay_lesionados`,
   `nivel_escalado`, `reconocida_en`) y crear `proveedor_emergencia`, `flota_poliza`,
   `contacto_emergencia`, `incidencia_evento` (con `unique (incidencia_id, wa_message_id)` como
   llave de idempotencia). El protocolo va en `tenant.config`, **no en tabla** — `politica_gasto`
   como tabla ya es un callejón documentado.
   `hay_lesionados` NULL significa **"no preguntado"**: jamás `false` por defecto.
2. Reconocedor de dos niveles (ROJO gana sobre cualquier palabra de talacha), **sin tope de largo**:
   quien describe un choque escribe largo, y talacha corta a 220.
3. Enrutamiento en los 5 puntos, sobre todo el **caption de foto ANTES de la visión**: hoy la foto
   de un camión volcado paga OCR y el chofer recibe *"esa foto salió difícil de leer, ¿me la
   reenvías con buena luz?"* mientras su unidad arde. **Es un bug activo, no una funcionalidad que
   falta.**
4. Incidencia + aviso al jefe **síncrono en el turno del webhook**, con botones. Orden obligatorio:
   (1) abrir incidencia + evento, (2) avisar, (3) *sólo si queda presupuesto* el modelo redacta.
   Con `COSTO_AGENTE_MS=15s`, el caso normal es que **no haya presupuesto para el modelo**: el
   camino determinista tiene que estar completo por sí solo, no ser el plan B.

## FASE 5 — Escalamiento y directorio  *(4-5 días; consume las plantillas de la Fase 0)*
1. Captura en `/dashboard` de directorio de emergencia, póliza y contactos. Hoy `unidad.poliza_vence`
   es **una fecha suelta**: falta aseguradora, número y el 800 de siniestros, que es EL dato que el
   agente necesita.
2. Escalamiento por 5 niveles con claim atómico **monótono** (`nivel_escalado`). Diferencia con
   `escalar_viaje`: allí el sello no expira nunca; aquí **tiene que volver a disparar**, porque que
   el nivel 1 no conteste es el caso de uso.
3. Cron `/api/cron/asistencia` cada 5 min (el de escalar corre cada hora: para una emergencia no sirve).
4. Ventana horaria: aplica a la **severidad**, no al canal. ROJO la ignora siempre; ÁMBAR reusa
   `dentroDeVentana` de cobranza y fuera de ventana **difiere** con `notificar_desde`, no tira.
   Nunca se le pide al modelo que juzgue si despierta a alguien.
5. Cascada de canales con una fila de bitácora por intento: botones → plantilla → correo →
   `alertarOperador`. Y al chofer se le dice la verdad si el jefe no recibió.

**Likida NO marca 911 ni a la aseguradora, nunca.** Una llamada automática abre un siniestro, que es
dinero y acto jurídico; y un despacho falso de 911 es delito. El flag `requiere911` sólo cambia el
texto y el orden, jamás quién marca.

## FASE 6 — Los relojes legales  *(1 semana, sin integración)*
Etapa 14 del ciclo. Puro reloj sobre datos que Likida **ya tiene**, y los montos son brutales.

1. **Aviso preventivo de `ValorMercancia`**: es opcional para el SAT pero **define la
   indemnización**. Sin valor declarado y sin prima, el tope legal es **15 UMA/tonelada =
   $1,759.65/t**. Con valor declarado y prima pagada, el transportista responde por el total incluso
   ante caso fortuito. Y de los campos de seguro del CFDI **sólo el de responsabilidad civil es
   obligatorio**: el de CARGA es opcional — justo el que importa cuando se pierde la mercancía.
   Decirle a la flota *antes* del siniestro que cobrará $1,759/tonelada es un aviso que nadie da.
2. **Sustitución de CFDI por siniestro/robo**: el SAT ordena **sustituir, no cancelar** — nuevo CFDI
   con `TipoRelacion 04` y **luego** cancelar el original con motivo 01. Ese orden es obligatorio.
   El agente de siniestros dispara la tarea.
3. **Relojes de materiales peligrosos**: SICT + SEMARNAT en **≤3 días hábiles** (RTTMRP 57 Bis, hasta
   500 UMA por omitir); PROFEPA aviso inmediato + formalización en 3 días hábiles (trámite
   PROFEPA-03-017 mod. B); ASEA **Informe Inicial 6 h Tipo 3 / 12 h Tipo 2**, seguimiento y **cierre
   ≤10 días naturales**, anexando **copia de la Carta Porte** (art. 14 Sexies) — dato que ya vive
   en Likida.
4. **Vencimientos de flota**: pólizas, licencias, verificación físico-mecánica (**anual**, no
   semestral). Y el historial de multas, porque reincidir dos veces en 2 años faculta a la SICT a
   **revocar el permiso**.
5. **Multas**: −25% por reconocer la falta y −25% adicional por pagar en 15 días hábiles (sólo
   tránsito, no el tabulador de báscula); 30 días hábiles para pagar antes de que el vehículo se
   turne a la autoridad fiscal; y la palanca del **art. 76 de la Ley de Caminos**: garantizar el
   monto y que el vehículo se entregue *en depósito al conductor o al propietario*.

Directorio semilla verificado: **SETIQ 800 002 1400** (triple fuente; la NOM-005 obliga a llevarlo
a bordo; **no tiene WhatsApp**), **CENACOM 55 5128 0000** ext. 36428/36422/36469/37807/37810.
Sin verificar y **no meter al directorio hasta confirmarlos por teléfono**: el 088 de Guardia
Nacional, el 078 de Ángeles Verdes y el 800 de PROFEPA.

## FASE 7 — El IVA que se pierde en silencio  *(3-4 días, sin integración)*
`engine.ts:1148` excluye correctamente el IVA de un CFDI con `FormaPago 99` citando LIVA 5-III,
y el comentario dice que se acreditará el mes en que se pague **con su complemento de pago**.
Pero **no hay código que ingiera ese REP** — `MetodoPago` ni siquiera se parsea. El IVA sale de la
cuenta y no vuelve nunca: para una flota que compra a crédito con su estación de casa es el **16%
de su gasto de diésel, cada mes**. Es el hueco donde el sistema hace lo correcto y aun así le cuesta
dinero al cliente, y por eso es más peligroso que un bug ruidoso.

1. Parsear `MetodoPago` (PUE/PPD).
2. Ingerir el CFDI de Pagos (`TipoDeComprobante = P`) y ligarlo al PPD que liquida.
3. Liberar el IVA (y el IEPS) en el mes del pago.

## FASE 8 — GPS y mapas  *(depende de terceros — por eso va al final)*
Los conectores ya existen con `probar()` verificado (Wialon, Samsara, Geotab, Navixy). Falta
**el poller** y la columna `unidad.gps_device_id`. Y una API de mapas para ETA, distancia real y
geocodificación inversa del pin — que es lo que el gruero necesita oír.
Hasta entonces: cascada pin → `posicion` → ciudad **rotulando siempre la fuente**, y `eta_min`
se queda en `null`. Un ETA en línea recta sobre carretera de montaña es una cifra fabricada.

## FASE 9 — Lo que queda del ciclo
Mantenimiento (etapa 13: la tabla ya existe, 0 filas, sin escritor) y cotización (etapa 1: la
más grande, la que más se parece a un CRM y la que compite con software que las flotas ya tienen).
Y encender `experto_fiscal`, que **no es un agente nuevo**: la ley ya vive en TypeScript y probada.
Encenderlo es exponer lo que existe, no escribir un cerebro.

---

## Riesgos colaterales que hay que cerrar en cualquier fase que los toque
- `getSystemPrompt` cae al prompt de **liquidación** por `default`: una clave mal escrita le da al
  agente de siniestros el prompt de cuadre, en silencio.
- `incidencia` tiene RLS `tenant_data` a secas mientras `gasto` está tras `ve_finanzas()`: un
  `monto_estimado` grande pone dinero a la vista de un rol al que el panel se lo esconde.
- `contacto_emergencia` guarda a un familiar que nunca aceptó nada → aviso de privacidad y purga.
- El **gate de privacidad**: un siniestro ROJO debe ir por encima, con tratamiento mínimo
  (incidencia + aviso, sin foto/OCR/modelo). El medio ARCO ya se izó encima; esto es decisión de
  producto y legal, no un default.
- `geocerca` existe y **nadie la lee**.
- `models.ts` define el rol `piloto` que el CHECK de `agente_definicion` no incluye.
