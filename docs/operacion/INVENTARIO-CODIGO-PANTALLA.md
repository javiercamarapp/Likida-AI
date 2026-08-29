# Inventario código → pantalla

**Fecha de medición: 28-ago-2026, sobre master `92b27cb1`.** Encargo de Javier:
*«Actualizar todos los dashboard a que tenga todo lo del código y tenga todo lo
construido»* — el código creció más rápido que los dos tableros, y una función
sin puerta es, para efectos prácticos, una función que no existe. Ya pasó dos
veces medidas: la bandeja de conciliación del SAT (columnas `resuelto_por`/
`resuelto_en` sin un solo escritor desde la 0231, hoy cerrada) y el medidor de
precisión del OCR (tabla en producción con cero escritores, hoy cerrado, PR #200).

## Método

Dos columnas: **qué sabe hacer el sistema** y **desde qué pantalla se llega**.

- 233 migraciones → 138 tablas y 126 funciones, cruzadas contra lectores y
  escritores en `src/` (`.from()`, `.rpc()`, funciones SQL internas y triggers).
- Grafo de imports completo de `src/` (720 archivos, 3 171 aristas) para saber
  **qué `lib/` consume cada página** — no qué SQL escribe la página, que fue la
  trampa del intento anterior (las consultas viven en `lib/`, no en `app/`).
  Los componentes cliente que llaman `/api/...` por `fetch` cuentan como puerta.
- Los 58 interruptores del CHECK (`0235`), los 10 crones de `vercel.json`, y lo
  construido esta semana (0241, 0243, 0244, 0246), uno por uno.
- Los hallazgos gordos se verificaron a mano contra el código antes de
  anotarse; dos afirmaciones del barrido automático resultaron falsas y se
  corrigieron aquí (ver §7).

Estado de cada hueco: `CERRADO (PR #N)` · `ABIERTO` · `NO AMERITA (razón)`.

---

## 1. Resumen: los huecos, priorizados por daño

**Prioridad 1 — un humano decide y hoy no puede:**

| Hueco | Estado |
|---|---|
| El **veredicto laboral** (`deducible ≠ pagadero`, LFT 110/111/263) no llega a `/dashboard/[id]`: el contralor decide el neto viendo solo la deducibilidad; el veredicto laboral solo aparece en el PDF ya generado (`src/lib/likida/liquidacion/pdf.ts`). `topeDescuento()` no lo llama nadie. Riesgo legal directo: un descuento de nómina ilegal se firma sin haber visto la advertencia. | ABIERTO → PR de esta serie |
| **4 agentes vivos sin palanca**: `carta_porte` (timbra CFDI), `experto_fiscal` (cron diario contra el DOF), `copiloto` y `guardia_alertas` están `vivo` en `agente_definicion` y NO están en el CHECK de `interruptor` (0235) — `/admin/agentes` les pinta «Sin palanca propia». No se pueden apagar sin deploy, solo tumbando `global`. | ABIERTO → PR de esta serie (migración) |

**Prioridad 2 — roto en silencio y nadie lo vería:**

| Hueco | Estado |
|---|---|
| **Crones mudos en caminos de falla**: 4 crones sin latido con el kill switch apagado (se pintaban «No late» en rojo por una decisión deliberada), el camino `interruptor_ilegible` mudo en las 10 rutas, `facturar` latiendo `ok` ANTES de trabajar, y el card de `/admin/crons` más laxo que `/api/health` (un cron puntual reportando `fallo` cada minuto salía en «los 10 relojes latieron»). | CERRADO → PR de esta serie |
| `/admin/trust-safety` afirma «no existe pipeline de detección» y **el pipeline existe desde la 0133**: `evento_seguridad` con 9 tipos y 7 escritores (webhook WhatsApp, Stripe, copiloto, worker, guardia de cifras, GPS, eventos de cámara). Solo `/admin/dev` enseña 12 filas. La página con el nombre correcto está vacía y su prosa quedó vieja. | ABIERTO → PR de esta serie |
| **Vigilante de portales sin vista de superadmin**: `portal_estado`/`portal_relogin` tienen puerta buena por flota (`/dashboard/agentes/facturas`), pero cero pantalla cross-tenant («qué flotas tienen sesiones caducadas hoy»). Y «por caducar» no existe como concepto: el aviso siempre es reactivo. | ABIERTO |
| **Eventos graves de cámara** (`conectores/sincronizar_eventos.ts`, `eventos_seguridad.ts` de Samsara) se ingieren en el cron de GPS y ninguna pantalla de `/dashboard` los enseña. | ABIERTO |

**Prioridad 3 — se mide y nadie lo ve:**

| Hueco | Estado |
|---|---|
| **Riesgo semanal LFT sin puerta**: `evaluarRiesgoSemana()` (`jornada/riesgo.ts:332`), el tope semanal por año del Transitorio Segundo (`topes.ts`), el día de descanso del art. 69 y `horas_min_entre_jornadas` — todo calculado o capturable, **cero llamadores**. `/dashboard/jornada` resume por día y nunca dice si la semana rebasó las 48 h. `horasExtraordinarias` se calcula y se tira. `horas_min_entre_jornadas` es un campo capturable muerto: se guarda y no produce señal. | ABIERTO |
| **Presupuesto IA por propósito (0244)**: `/admin/consumo` SÍ lo pinta (techo, reserva interactiva, % por flota × propósito). Faltan: ajustar el techo desde pantalla (hoy: env de Vercel + redeploy, `LIKIDA_LLM_TENANT_DAILY_BUDGET_USD` global, sin override por flota), un contador de **rechazos** (`LlmBudgetExceededError` scope `proposito` no se lee en ninguna página — es la señal de calibración), histórico (la RPC solo devuelve HOY), y espejo en `/dashboard` para que la flota vea su propio techo. | ABIERTO (parcial) |
| **Precisión OCR por campo**: cerrada en lo esencial por el PR #200 (0246, `agregarPorCampo` + `/admin/qa/[id]` con medición por corrida). Queda: `/admin/agente-ocr` — la pantalla con el nombre que un operador buscaría — sigue enseñando solo dólares, sin ni siquiera un enlace a la medición. Y la corrida de QA no pasa por el presupuesto por propósito (`qa/fotos/ocr/route.ts` llama sin `budget`, con su propio `TOPE_DIA_USD`): el frente de consumo no ve este gasto. | ABIERTO (menor) |
| **El parte de dirección** (`direccion/reportes.ts`: KPI diario, diagnóstico startup, parte 80/20) sale por correo a Javier y no existe como artefacto en `/admin/ejecutivo`. Runway y cierre mensual (`agentes/finanzas.ts`) tampoco tienen pantalla. | ABIERTO |
| **Catálogo de comercios y plazos**: vive en código (`facturacion/comercios.ts`, ~37 fichas) — deliberado, pero `plazoVerificado` (el corazón de la honestidad del módulo: «este plazo lo vimos en el portal» vs «default conservador») no es visible para nadie, ni hay tablero de cobertura (cuántos con adaptador, cuántos verificados, cuántos `noAutomatizable` y por qué). | ABIERTO |
| Las **demos agendadas** por Cal.com (`admin/calcom.ts`, webhook + reconciliación) no se ven en `/admin/crecimiento`. | ABIERTO (menor) |
| El **REP** (`intake/rep.ts`) se ingiere y no se ve en ninguna pantalla; cabe en `/dashboard/facturacion`. | ABIERTO (menor) |
| `observability/arranque.ts` grita configs ausentes solo al log del arranque; cabría un renglón en `/admin/salud-sistema`. | ABIERTO (menor) |

**Código muerto o a punto de estrenar (ni pantalla ni llamador):**

| Pieza | Veredicto |
|---|---|
| `facturacion/permiso_cre.ts` (163 líneas: identifica gasolinera por permiso CRE — 46.6% del padrón es Pemex sin portal) | A punto de estrenar: cablear dentro de `identificar.ts`; se vería solo en `/dashboard/agentes/facturas`. Sin pantalla nueva. |
| `facturacion/vinculacion_asistida.ts` (vinculación con humano resolviendo captcha/2FA en vivo) | A punto de estrenar: cablear a `portales-vinculo.tsx`, que hoy usa `relogin.ts`. |
| `facturacion/adaptadores/computer_use.ts` (343 líneas, portal por visión) | Muerto: `registro.ts` no lo registra. Decidir registrar o borrar — no es hueco de tablero. |
| `peajes/desglose.ts` | Duplicado muerto de `intake/desglose_peaje.ts` (que sí vive en `/dashboard/agentes/peajes`). Borrar, no dar puerta. |
| `agente_presupuesto_reserva` (0180) + `reservar/cerrar_reserva_presupuesto_agente` | Tabla y funciones muertas: cero llamadores en `src/` y cero en SQL. La sustituyó `llm_presupuesto_reserva` (0186/0244). Documentar como legado. |
| `portal_credencial` (0063) | Tabla muerta: cero referencias en TS; las credenciales viven cifradas en `conector_credencial` y la sesión en `sesion_portal`. |

---

## 2. Crones — 10/10 catalogados; los huecos eran de camino de falla

`vercel.json` declara exactamente 10 schedules = 10 rutas bajo `src/app/api/cron/`.
La lista de `/admin/crons` sale de `CRONS` (`src/lib/admin/salud.ts:28`) con tres
candados que funcionan: `Record<CronId,…>` que rompe la compilación al alta,
`salud.test.ts` cruzando cadencias contra `vercel.json`, y el mismo test cruzando
`CRONS` contra el CHECK `cron_latido_id_dominio` (vigente en 0241, 10 ids).
La página distingue bien «nunca latió» / «no late» / «no se pudo leer» y jamás
pinta null como 0.

Los cuatro huecos (todos de honestidad del latido, cerrados en el PR de crones
de esta serie):

1. `wa-pendientes`, `wa-outbox`, `escalar` y `purgar` devolvían 200 sin latido
   con el kill switch apagado → a los 21 min el tablero decía «No late» en rojo
   y `/api/health` alertaba al operador por una decisión deliberada.
2. El camino `interruptor_ilegible` (500) era mudo en las 10 rutas: el código
   de la causa nunca llegaba a `cron_latido.detalle`.
3. `facturar` latía `ok` ANTES de trabajar (un timeout de Vercel a los 300 s
   dejaba un «ok, hace 30 segundos» de una corrida que no terminó) y el camino
   «sin adaptadores de portal» no latía nunca.
4. El card de la vista solo miraba cadencia: un cron puntual reportando `fallo`
   cada minuto salía en «los 10 relojes latieron» — el panel del operador era
   más laxo que el endpoint público. Además, la vista no tenía ni una prueba.

Nota anotada (sin cerrar, menor): una vuelta encolada por QStash de
`wa-pendientes/cola` refresca el latido del cron padre — el pulso puede verse
fresco por una vuelta de QStash aunque el cron de Vercel esté devolviendo 401.

## 3. Interruptores — 58/58 con puerta completa; el hueco es el inverso

El CHECK vigente (0235, líneas 149-197) tiene 58 valores. El espejo en código
(`src/lib/likida/interruptores.ts`, `INTERRUPTORES`) tiene los mismos 58, cero
drift, y `observabilidad/etiquetas.ts` también (con prueba). Tres puertas:
`/admin/observabilidad` (ver + accionar los 58, distingue «nunca tocado» de
«apagado»), el ⌘K (`/api/admin/palette`, único endpoint HTTP que escribe la
palanca, con CSRF + sesión + superadmin), y `/admin/agentes` (56: los
`agente:<id>` con fila viva; `global` y `agente:descarga_sat` solo en las otras
dos puertas, por diseño). **0 invisibles, 0 fantasmas.**

El hueco real va en la otra dirección: **4 agentes `vivo` de
`agente_definicion` sin palanca en el CHECK** — `carta_porte`, `copiloto`,
`experto_fiscal`, `guardia_alertas`. `/admin/agentes` les pinta «Sin palanca
propia» (`contenido.tsx:133`). `carta_porte` timbra comprobantes fiscales y
`experto_fiscal` corre diario contra el DOF y escribe en `normas/`: apagar
cualquiera exige deploy o tumbar `global`. → PR de esta serie (migración que
extiende el CHECK + espejo + etiquetas).

## 4. Lo construido esta semana, frente por frente

- **0243 bandeja SAT**: cerrada antes de este inventario — `sat_descarga/
  {bandeja,resolucion}.ts` + `/dashboard/descarga-sat/bandeja` con lista y
  resolución firmada. Los 11 archivos del módulo tienen puerta.
- **0244 presupuesto por propósito**: puerta de LECTURA completa en
  `/admin/consumo`; faltantes en §1 (ajuste, rechazos, histórico, espejo flota).
- **0246 precisión OCR** (PR #200): por-campo y por-corrida en `/admin/qa/[id]`;
  falta el enlace/resumen en `/admin/agente-ocr` y meter la corrida de QA al
  presupuesto por propósito.
- **0241 jornada LFT**: puerta diaria buena (marcas, anulación firmada, cierre,
  política, CSV). Todo el eje SEMANAL sin puerta (§1, prioridad 3).
- **Vigilante de portales (0232/0233)**: puerta por flota buena; sin vista
  cross-tenant ni «por caducar» (§1). Sin latido propio: si falla solo la parte
  de portales dentro de `facturar`, `/api/health` no lo distingue.

## 5. Mapa módulo → pantalla (condensado)

Con puerta y sin hueco relevante: `chat`, `contabilidad`, `cotizador`,
`estadias`, `geo`, `marketing`, `pac`, `perfil`, `prospectos`, `sat_descarga`,
`saas`, `legal`, `llm/budget`, `admin/*` (cada pantalla 1:1), `agents/copiloto*`
(→ `/admin/copiloto`), `agents/analista` (→ `/dashboard/chat`).

Consumidos solo por API/cron/WhatsApp **y está bien así** (su resultado ya
tiene puerta o su canal ES WhatsApp): `intake/{almacen,decidir,hash,
pedir_fecha,rafaga}`, `jornada/{derivar,wa}`, `reglas/vigilante` (faltaría
«últimos disparos» en `/dashboard/reglas`, menor), `cuadre/{guardia,cifras,
resumen,estado_afirmado}` (guardas deterministas; sus métricas de disparo
cabrían en trust-safety), `normas/{fundamento,por_diferencia}`,
`correo/firma_entrante`, `agents/{registry,run}`, `llm/{tool-executor,
tool-idempotency}`, `worker/llaves`.

Los 14 agentes de `src/lib/likida/agentes/` despachados por el runner: su
salida cae en la bandeja (`/admin/aprobaciones`, `/admin/tu-turno`) — la puerta
de decisión existe. Huecos puntuales ya listados: parte de dirección, runway/
cierre mensual, semáforo de retención de `exito.ts`, dossier del investigador
sin pintar en `/admin/mapa-prospectos`.

## 6. Tablas sin lector directo — con su porqué (medido, no supuesto)

`tenant_perfil_version` (trigger `trg_sellar_perfil_version`),
`storage_limpieza_cursor` y `llm_costo_mensual` (dentro de
`mantenimiento_de_datos()`, que llama el cron `purgar`), `viaje_lock`
(startup), `foto_pendiente` (processor): **vivas por SQL interno, no
necesitan puerta.** `campania`/`envio_mensaje` (sustituidas por `campana`,
0123), `politica_gasto` (la política viva es `tenant.config.politica`),
`terminal` (huérfana desde 0001), `invitacion`, `liquidacion_historico`
(RPCs atómicas): legado documentado en CLAUDE.md. Muertas de verdad: §1.

## 7. Lo que NO amerita puerta, con su razón

- **`cuadre/cuota_diesel.ts` huérfano ES DELIBERADO** (el barrido automático lo
  marcó como «error de dinero silencioso» y es falso): la decisión D2 del
  roadmap prohíbe imprimir el estímulo IEPS en pesos sin fiscalista que firme
  — `engine.ts` entrega LITROS y el contador multiplica por la cuota del DOF.
  El módulo existe para que el cableado sea una línea el día que alguien firme,
  y su test vigila el contrato del YAML. Está escrito en su propia cabecera.
- **Supresiones y rebotes de correo SÍ tienen puerta** (el barrido los marcó
  sin ella): `correosSuprimidos()`/`rebotesRecientes()` se pintan en
  `/admin/aprobaciones`.
- Guardas del cuadre y de normas: son backstops del LLM; su resultado se ve en
  el canal (WhatsApp). Infraestructura (`tool-executor`, `registry`): sin puerta
  por diseño.
- Páginas sin entrada en el sidebar pero CON camino medido: `/admin/corridas`
  (desde observabilidad y copiloto), `/admin/mi-perfil` y `/admin/
  notificaciones` (chrome), `/dashboard/contador` (Resumen por rol),
  `/dashboard/integraciones` (desde conexiones). **No hay páginas huérfanas.**

## 8. Plan de cierre de esta serie

1. Este inventario (PR 1).
2. Crones veraces (PR 2) — cerrado arriba, §2.
3. Palancas para los 4 agentes sin interruptor (PR 3, migración).
4. `/admin/trust-safety` deja de mentir: lee `evento_seguridad` con conteos
   agregados y últimos eventos, declarando qué detectores existen y cuáles no
   (PR 4).
5. El veredicto laboral en `/dashboard/[id]` (PR 5).

Quedan abiertos, en orden de daño: riesgo semanal LFT, vista cross-tenant de
portales, ajuste del presupuesto por propósito + contador de rechazos, eventos
de cámara, parte de dirección/runway, catálogo de comercios, y los menores de §1.
