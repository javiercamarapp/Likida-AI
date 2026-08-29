# Frente F — triaje medido de las nueve piezas sin lanzar

**Fecha del triaje**: 28-ago-2026 · **Medido contra**: `origin/master` en `f68e00fd`
(worktree limpio recién creado desde ese commit — no contra el worktree viejo).

El blueprint advertía: *«revisar cada uno contra el código antes de construir —
puede que alguno ya se haya resuelto de colateral»*. Tenía razón: **de las nueve,
tres ya estaban hechas enteras, una es de otro fork, y solo dos valen construirse
ahora.** Cada veredicto trae su evidencia `archivo:línea`; ninguno se afirma de
memoria.

| # | Pieza | Veredicto | Puerta en tablero |
|---|-------|-----------|-------------------|
| 1 | Tablero de calidad | A MEDIAS — solo la puerta; las fuentes existen dispersas | `/admin/calidad-evals` (vacía honesta) |
| 2 | Centro de mando (Fase D) | HECHO en su núcleo | `/admin/tu-turno`, `/admin/crons`, `/admin/agentes`, `/admin/corridas` |
| 3 | Órdenes por WhatsApp del operador | HECHO | WhatsApp + `/dashboard/despacho` |
| 4 | Embudo y cohortes | A MEDIAS — hueco declarado por el propio agente | `/admin/crecimiento` (secciones «todavía no») |
| 5 | Examen fiscal de 32 preguntas | MISMA PIEZA que E.26 del fork de Fase E — no se construye aquí | `/admin/evals` (la infra ya corre) |
| 6 | Pantalla de `gps_device_id` | HECHA ENTERA | `/dashboard/unidades` |
| 7 | Broadcast | NADA — la puerta existe y lo dice | `/admin/comunicacion` (vacía honesta) |
| 8 | Portal de colaboración con el cliente | NADA — la más grande; se separa | sin puerta |
| 9 | Conectores CONTPAQi / Aspel | NADA de código; diseño sí — se separa | sin puerta |

---

## 1. Tablero de calidad — a medias (solo la puerta)

- La puerta existe y es honesta: `src/app/admin/calidad-evals/page.tsx:8-14`
  declara que «Likida no tiene pipeline de evaluación ni tabla de feedback
  (👍/👎) hoy» y pinta un empty-state.
- Pero las fuentes de calidad **sí existen, dispersas**:
  - El examen del analista (EVALOPS, mig. 0134) con juez humano y regla de
    re-examen: `src/app/admin/evals/page.tsx:41-45` y
    `scripts/evals/correr-analista.ts:1-16`.
  - El banco de verdad de QA (migs. 0239/0240): `src/app/admin/qa/`.
  - Las corridas de agentes con veredicto: `agente_corrida` (mig. 0102,
    `src/lib/likida/agentes/ingenieria.ts:143`).
- Lo que falta de verdad: **agregar esas fuentes en un tablero único** y la
  tabla de feedback 👍/👎 (que sí exige migración nueva).

**Decisión**: se construye la agregación sin migración (las fuentes ya están
medidas); el feedback 👍/👎 queda declarado como pendiente en la propia página —
no se finge con una tabla vacía.

## 2. Centro de mando (Fase D) — hecho en su núcleo

- La bandeja única existe y es real: `src/app/admin/tu-turno/page.tsx:16-31`
  junta bus_pieza (0127), cola_aprobacion (0117), escalaciones, PRs de GitHub
  y las rutinas launchd con su botón de «correr ahora» que ENCOLA una orden
  (`bus_orden`) — jamás ejecuta en la Mac directamente.
- El editor de rutinas está cerrado desde el 17-ago:
  `src/lib/admin/bus.ts:70-74` — `ORDENES_UI` incluye `editar_encargo`, con
  `bus_rutina.encargo_md` como el texto que el editor pre-llena
  (`bus.ts:27-29`).
- Las ramas `fase-d/bus-de-mando`, `fase-d/editor-rutinas` y
  `fase-d/cerebro-pulido` están **mergeadas en master** (verificado con
  `git merge-base --is-ancestor`).
- Lo que del plan de Fase D **no** existe (0 hits en `src/`): la bandeja de
  contexto universal y el estudio de marketing. Son proyectos grandes por sí
  solos y no se meten a la fuerza en este frente.

**Decisión**: nada que construir aquí; las sub-piezas faltantes se separan.

## 3. Órdenes por WhatsApp del operador — hecho

- El despacho por WhatsApp existe de punta a punta:
  `src/lib/likida/despacho_wa.ts:16-19` — «EL JEFE DESPACHA POR WHATSAPP (F4
  del plan): parser puro → resumen → confirmación humana → crearViaje (que ya
  avisa al chofer solo)».
- El intérprete es puro y regex a propósito (no un modelo), porque un falso
  positivo manda a una persona a carretera: `src/lib/likida/crear_viaje_wa.ts:9-27`.
- El chofer tiene sus comandos cerrados («va», «radio F-123 25», «listo»):
  `src/lib/likida/processor.ts:1153`, y los flujos de oficina conviven con el
  intérprete sin robarse texto (`processor.ts:577-599`).

**Decisión**: nada que construir.

## 4. Instrumentación de embudo y cohortes — a medias, hueco declarado

- Lo que existe: `sitio_evento` (mig. 0223) cubre SOLO el sitio público
  (blog/calculadora), sin ningún dato del visitante
  (`supabase/migrations/0223_plataforma_marketing.sql:33-53`).
- El hueco lo declara el propio agente cada noche, con la spec exacta:
  - `src/lib/likida/agentes/ingenieria_producto.ts:1043` — «EL HUECO MÁS
    GRANDE, DICHO SIN ADORNO: no existe analítica de producto DENTRO de la
    app… Sin eso no hay cohortes, no hay activación medida».
  - `ingenieria_producto.ts:904` — propone «una tabla `producto_evento`
    (tenant_id, pantalla, accion, created_at) — el hermano interno de
    sitio_evento».
  - `ingenieria_producto.ts:909-912` — las cohortes son derivables en cuanto
    esa tabla exista.
- La puerta existe: `/admin/crecimiento` lista «Embudo activados → de pago» y
  «Retención por cohortes» en «Lo que esta página todavía no puede mostrar»
  (`src/app/admin/crecimiento/page.tsx:93-94`).
- El embudo activados → de pago ni siquiera necesita la tabla nueva: se puede
  medir HOY con `tenant.created_at` (0001), la primera liquidación por tenant
  y la suscripción SaaS (0052/0163).

**Decisión**: SE CONSTRUYE — es la pieza con más daño por no tenerla: cada día
sin la tabla es dato de uso perdido para siempre, y el hueco está declarado por
escrito en el parte nocturno.

## 5. Examen fiscal de 32 preguntas — es la E.26 del fork de Fase E

**Comprobado: son la misma pieza. No se construye en este frente.**

- El diseño: `docs/conocimiento/22-evaluacion.md:22` (las 32 preguntas doradas)
  y su regla de re-examen (`:40-42`).
- `docs/conocimiento/plan-de-cierre.md:147-148` la nombra con la misma
  descripción que la E.26: «QA fase 2 (el examen fiscal de 32 preguntas
  doradas — diseño pagado, cero código)».
- En master, la **fase 1** ya corre: EVALOPS 0134 (`eval_caso`/`eval_corrida`/
  `eval_resultado`), `scripts/evals/correr-analista.ts`, y `/admin/evals` con
  juez humano y acusación de drift de prompt — pero SOLO para el agente
  `analista`.
- La **fase 2** (el examen del Contador, las 32 preguntas) tiene cero código:
  no hay agente `contador` en `src/lib/agents/` (solo analista, copiloto,
  chat-tools) y no existe ningún JSON con el banco dorado (barrido de
  `*dorad*`/`*preguntas*` en el repo: solo docs y el perfil de onboarding).

Al fork de Fase E le sirve saber que **no parte de cero**: la infraestructura
de corridas, veredicto agregado binario («una trampa fallada tumba todo») y el
juez humano en pantalla ya existen — su trabajo es el banco de 32 casos y el
agente examinado, no el arnés.

## 6. Pantalla de `gps_device_id` — hecha entera

- El formulario: `src/app/dashboard/unidades/forma.tsx:160-202` — sección
  «EL AMARRE CON EL GPS (columnas de la 0176)»: selector de proveedor del
  catálogo `CONECTORES_GPS` + input `gpsDeviceId` + leyenda con
  `gps_visto_en` («El GPS está entrando: la última posición llegó el …»).
- El guardado con validación: `src/app/dashboard/unidades/page.tsx:81-113`,
  incluido el mensaje del índice único («Ese número de dispositivo ya está
  ligado a otra unidad…»).
- La garantía en la base: índice único parcial sobre
  `(tenant_id, gps_proveedor, gps_device_id)` — mig. 0176 y
  `src/lib/likida/operacion.ts:1025`.
- La liga se ve por fila en la lista: `src/app/dashboard/unidades/vista.tsx:235`.

**Decisión**: nada que construir. El renglón del blueprint quedó resuelto de
colateral con la 0176 y el formulario de unidades.

## 7. Broadcast — nada (y la puerta lo dice)

- `src/app/admin/comunicacion/page.tsx:8-9`: «No existe tabla ni tooling de
  campañas/broadcast: el único canal de mensajes hoy es el bot de WhatsApp
  conversando 1 a 1 con cada chofer».
- Lo más cercano que hay es `wa_outbox` (mig. 0180): una cola saliente 1-a-1
  con reintentos — no es infraestructura de campañas.

**Decisión**: NO se construye ahora, con razón dicha: con un solo tenant real
no hay a quién difundir, y un broadcast por WhatsApp fuera de la ventana de
24 horas exige plantillas aprobadas por Meta — infraestructura especulativa
hoy. El daño de no tenerlo es el más bajo de las nueve.

## 8. Portal de colaboración con el cliente del transportista — se separa

- Cero código en master. Ojo con el falso amigo: los «portales» de master y de
  los PRs #201/#202 (mig. 0248) son los **portales de facturación** (CAPUFE y
  compañía — `src/app/api/cron/facturar/route.test.ts:159-184`); no tienen
  nada que ver con esta pieza.
- Lo que exige: identidad para un tercero EXTERNO al tenant (el cliente del
  transportista no es usuario de la flota), superficie pública nueva, modelo
  de permisos/RLS nuevo, y decisiones de producto que no están escritas en
  ningún doc de `docs/conocimiento/`.

**Decisión**: es la pieza más grande de las nueve y no cabe en este frente sin
dejarla a medias. Se separa como proyecto propio, empezando por el documento de
diseño que hoy no existe.

## 9. Conectores CONTPAQi / Aspel — se separa (con el bloqueo dicho)

- Cero código: `grep -i "contpaq\|aspel"` en `src/` no devuelve nada; solo docs.
- El diseño sí está pagado: `docs/conocimiento/DOCUMENTO-MAESTRO.md:100` trae
  los layouts exactos (Contpaqi TXT con registros `P`/`M`/`AD` + UUID; Aspel
  COI con `FIN_PARTIDAS` y fecha DD/MM/AAAA), y `DOCUMENTO-MAESTRO.md:20`
  declara «póliza Contpaqi ❌ pend. ERP». El CSV genérico ya existe
  (`src/lib/likida/export.ts`).
- **El bloqueo honesto**: una póliza contable lleva números de cuenta del
  catálogo del cliente, y ese catálogo no existe en ninguna tabla de la base.
  Un TXT con cuentas supuestas sería una cifra inventada — exactamente lo que
  la regla número uno del repo prohíbe. Antes del generador va la pantalla de
  mapeo de cuentas por tenant, y eso es una pieza de producto, no un formato.

**Decisión**: se separa. El orden correcto es: (1) mapeo de cuentas por tenant,
(2) generador TXT contra ese mapeo, (3) botón de descarga junto al CSV.

---

## Orden de construcción decidido (por daño de no tenerlo)

1. **Instrumentación de producto** (`producto_evento` + embudo activados→pago +
   cohortes en `/admin/crecimiento`) — cada día sin la tabla es dato perdido
   para siempre; el hueco está declarado cada noche en el parte del agente.
2. **Tablero de calidad** (`/admin/calidad-evals` agrega las fuentes ya
   medidas) — la señal existe y está invisible; sin migración, riesgo bajo.
3. Broadcast, portal de colaboración y conectores ERP: separados, con la razón
   de cada uno escrita arriba. El examen fiscal es del fork de Fase E.
