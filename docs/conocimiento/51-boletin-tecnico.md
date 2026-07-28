# Boletín técnico de Likida

> Diez rubros, un evaluador adversarial. 27-jul-2026.
> Auditoría sobre el código tal como está hoy: `npm test` 248/248 verde en 3.57s, `npx tsc --noEmit` limpio.
> Nada de lo que sigue está editado en el repo — esto califica y propone; los arreglos los aterriza el orquestador.

---

## Boletín de calificaciones

| Rubro | Nota | Riesgo mayor en una línea |
|---|:--:|---|
| Backend y API | **8** | El código de concurrencia que protege el dinero (mutex, claim, transacción de cierre) es correcto por lectura, pero no tiene un solo test propio. |
| Seguridad | **7** | Si `DASHBOARD_SECRET` falta en producción, el HMAC de la cookie se deriva del propio passcode (`passcode.ts:15`); y la autorización del panel descansa en una sola capa, el matcher de `middleware.ts:33`. |
| Tool calling | **7** | `generateWithTools` (openrouter.ts:318-426) —loop-guard, ejecución parcial, fallback cross-provider— no tiene ni un test unitario. |
| Arquitectura y mantenibilidad | **7** | El panel del comprador lee Supabase con mapeo escrito a mano fuera de `repo.ts`, sin prueba; ya se desincronizó una vez. |
| Frontend | **6** | La capa que el contralor mira no tiene prueba ni lint, y el mapa `CONCEPTO` de `dashboard/[id]/page.tsx:10` ya quedó corto frente a `types/cuadra.ts`. |
| Sistema agéntico y orquestación | **6** | `guardia.ts:40` manda al chofer, por WhatsApp, los veredictos fiscales reservados al contralor. En el camino feliz del demo. |
| Pruebas | **6** | El cálculo del dinero está probado; la **escritura** del dinero (`saveLiquidacion` / `guardar_liquidacion_tx`) no tiene ni un arnés. |
| Modelo de datos y esquema | **6** | Cero CHECK de dominio en 16 migraciones y sin `unique(tenant_id, cfdi_uuid)` en `gasto`: el mismo CFDI puede liquidarse dos veces. |
| Operabilidad y DX | **6** | Si algo se rompe, nadie se entera: Sentry sin cablear, sin CI, sin lint, y el log del fallo de cierre no dice qué liquidación falló. |
| Rendimiento y costo | **5** | Con los defaults del código el peor caso son 112s contra `maxDuration=60`: el mensaje se pierde en silencio, sin reintento de Meta. |

**Nota global: 6.4**

---

## Nota global y qué significa

6.4 no es "a medio hacer". Es un sistema con el núcleo bien construido y la periferia sin red.

La máquina de dinero está por encima de lo que se ve en un pre-revenue: motor de cuadre puro y verificable a simple vista, cierre atómico en plpgsql con rollback, tools sin un solo parámetro del LLM, guardia determinística fail-closed contra cifras alucinadas, cuatro capas independientes de idempotencia, y 248 tests que sí fallarían si alguien revirtiera los fixes (están anotados con el ID del bug que corrigen). Eso es lo que sostiene el 6.4 y es lo que **no hay que romper**.

Lo que está flojo es todo lo que rodea al cálculo, y es exactamente lo que se nota en la sala:

- La escritura del dinero no tiene prueba.
- El panel que ve el comprador no tiene prueba ni lint, y ya tiene un mapeo desincronizado.
- El peor caso no cabe en su propio presupuesto de tiempo, y cuando revienta lo hace callado.
- La última milla hacia el operador manda el texto equivocado.

Ninguna de esas cuatro es cara. Tres se arreglan en menos de una hora cada una.

**Veredicto para el demo del 6-ago: CONDICIONADO.** Sí llega, pero no como está.

---

## Lo que está sólido (para no romperlo)

Estas piezas son la razón de la nota. Cualquier refactor que las toque necesita evidencia antes de aterrizar:

1. **`cuadre/engine.ts` es una función pura de verdad** — sin Supabase, sin `Date.now()`, sin fetch. La única impureza (la fecha) se inyecta en el borde, en `cuadre/desde_db.ts:33-36`, con el porqué escrito. Cinco archivos de test dedicados.
2. **Una sola fuente de verdad para el cuadre.** Las tres vías que lo necesitan (`tools.ts:49`, `processor.ts:352`, `guardia.ts:38`) pasan todas por `cuadrarDesdeDB`. No hay tres copias de la lógica de dinero.
3. **Tools sin argumentos.** `tools.ts:26,44,68` declaran `properties: {}`. El modelo decide *cuándo*, nunca *con qué datos*. `tenantId`/`viajeId` salen de `ctx`, resuelto server-side desde el teléfono verificado por HMAC de Meta. La superficie de prompt-injection para desviar dinero está cerrada estructuralmente.
4. **Cierre atómico real.** `guardar_liquidacion_tx` (migración 0013) hace insert + update en una transacción plpgsql, con `EXECUTE` revocado a `anon`/`authenticated` explícitamente — y el comentario documenta que el revoke-a-`public` **no** bastaba, o sea que alguien lo probó de verdad.
5. **Idempotencia en cuatro capas independientes:** dedup intra-ronda (`openrouter.ts:394`), cache de mutación en `makeExecutor` (solo cachea éxitos), `unique(viaje_id)` + `on conflict` en la DB, y `getOpenViaje` excluyendo `liquidado`.
6. **Guardia determinística fail-closed** (`cuadre/guardia.ts`): si el recálculo falla, no se mandan números. Prioriza no-mentir sobre no-fallar. Su lógica está probada; su llamada, no (ver bloqueante #1).
7. **HMAC-SHA256 timing-safe** en la firma de Meta y en la cookie del dashboard; cap del body en dos capas *antes* de leerlo; bucket de PDFs privado con `createSignedUrl` TTL 3600.
8. **Disciplina de comentarios "por qué + medición o cita legal"** sostenida en todo el código, no solo en el archivo estrella: `conv.ts`, `openrouter.ts` (`DEFAULT_MAX_TOKENS` derivado de "3 de 5 tickets cortados"), `processor.ts`, `comercios.ts`.
9. **`startup.ts` prueba migraciones críticas con RPC/select reales** al arrancar, no con una tabla de versión — detecta el caso "hasta ahora todo funcionaba".
10. **El ciclo auditoría→fix cierra.** Dos hallazgos de `00-MEJORAS.md` (M0.2, M0.3) ya están corregidos en el `engine.ts` actual. No es aspiracional.

---

## Plan de mejora, ordenado por (impacto ÷ esfuerzo)

Orden por rendimiento real, no por rubro. Lo de arriba es lo que más devuelve por hora invertida.

| # | Mejora | Rubro | archivo:línea | Esfuerzo | Qué gana |
|:--:|---|---|---|:--:|---|
| 1 | `resumenCuadre(liq, cuadro, 'operador')` — falta el 3er argumento | Agéntico | `src/lib/cuadra/cuadre/guardia.ts:40` | bajo | Deja de mandarle al chofer, por WhatsApp, "tu proveedor está en la lista negra del SAT" + el descargo legal completo. Una palabra. |
| 2 | Agregar `alimentacion`, `hospedaje`, `transporte` al mapa `CONCEPTO` | Frontend | `src/app/dashboard/[id]/page.tsx:10` | bajo | El contralor deja de ver `hospedaje` en minúscula cruda en su tabla. `types/cuadra.ts:10-14` ya declara los ocho. |
| 3 | Poner `CUADRA_INTAKE_ESPERA_MS=20000` y `CUADRA_INTAKE_GRACE_MS=2000` en el entorno REAL + confirmar plan/Fluid y subir `maxDuration` | Rendimiento | `.env.example:46` vs entorno; `src/app/api/webhook/whatsapp/route.ts:24` | bajo | Con los defaults son 60+12+40=112s contra un tope de 60s. Cuando revienta, Meta ya recibió su 200 y el mensaje ya está marcado como procesado: ese "listo" se pierde para siempre, sin aviso. |
| 4 | `loading.tsx` en `/dashboard` y `/dashboard/[id]` | Frontend | `src/app/dashboard/loading.tsx` (no existe), `src/app/dashboard/[id]/loading.tsx` (no existe) | bajo | Ambas son `force-dynamic` y hay cero `loading.tsx` en todo el repo: cada clic en vivo es pantalla en blanco hasta que responde Supabase. Una demo que se ve colgada se lee como producto lento. |
| 5 | Reescalar la foto (sharp, 1600px) antes de mandarla al modelo de visión | Rendimiento | `src/lib/cuadra/intake/ocr.ts:151` (comparar con `cfdi.ts:239`) | bajo | El mismo buffer ya se reescala para zxing pero se manda en resolución nativa de WhatsApp al OCR. Baja costo y latencia en el **100%** de las fotos, con una dependencia que ya está instalada. |
| 6 | Agregar `viajeId`/`tenantId` al `logger.error('tool.error')` | Operabilidad | `src/lib/llm/tool-executor.ts:53-56` | bajo | Es exactamente el log que se dispara si falla `guardar_liquidacion`. Hoy no dice *cuál* liquidación falló, y `ctx` los tiene a la mano. Una línea. |
| 7 | Merge profundo de la config del tenant | Backend | `src/lib/cuadra/config.ts:131` | bajo | `{...DEMO_CONFIG, ...override}` reemplaza objetos anidados enteros: un tenant que capture solo `estimulos.peajeFactor` pierde `clavesDieselIeps` y `clavesPeaje` sin error ni log, y el motor deja de aplicar estímulos fiscales reales. |
| 8 | `unique(tenant_id, cfdi_uuid)` parcial en `gasto` | Datos | nueva migración sobre `supabase/migrations/0001_init.sql:57-65` | bajo | El fraude que el propio código llama "número uno del sector" —mismo CFDI en dos viajes— hoy solo aparece en una tarjeta de analítica que no bloquea nada. El unique de 0009 está sobre la tabla del XML crudo, no sobre `gasto`. |
| 9 | `CHECK (monto > 0)` en `gasto`, `anticipo >= 0` en `viaje` | Datos | nueva migración; hoy cero CHECK de dominio en las 16 | bajo | El único guardarraíl contra un monto negativo es `engine.ts:99-108` en tiempo de cuadre, no en el insert. Cualquier camino de escritura futuro lo salta. |
| 10 | `eslint.config.mjs` + arreglar `npm run lint` | Operabilidad | `package.json:9` (`"lint": "next lint"`, comando removido en Next 16) | bajo | Hoy el proyecto no tiene **ningún** análisis estático. Con `jsx-a11y` prendido, los hallazgos 16-18 se detectan solos de aquí en adelante en vez de llegar a producción. |
| 11 | CI de `typecheck + test + build` | Operabilidad | no existe `.github/workflows/` | bajo | `npm test` corre en 3.5s y `tsc` está limpio: no hay nada lento que optimizar primero. Red de seguridad casi gratis antes de sumar a alguien al repo. |
| 12 | Probes de 0012 (RLS) y 0013 (cierre transaccional) en el arranque | Operabilidad | `src/lib/cuadra/startup.ts:12-56` (el patrón ya existe para 0005/0011/0016) | bajo | Si falta 0013 en una DB fresca, el primer síntoma es un `tool.error` genérico a media demo en vez de un aviso ruidoso al boot. |
| 13 | Tests de `sat.ts` con `fetch` mockeado | Pruebas | `src/lib/cuadra/intake/sat.ts:36-84` | bajo | Es la función que decide fraude (EFOS 69-B) y cancelado, y manda directo a `totalNoDeducible`. Es parseo puro con regex: los 7-8 casos ya están documentados en sus propios comentarios. Hoy un typo en `Estado>` rompe la detección de fraude en silencio. |
| 14 | `error.tsx` + `global-error.tsx` + `not-found.tsx` a nivel raíz | Frontend | `src/app/` (solo existe `dashboard/error.tsx`) | bajo | Un crash en landing/demo/acceso cae en la pantalla genérica de Next; con `@sentry/nextjs` en deps y sin `global-error.tsx`, un crash de layout raíz tampoco se reportaría cuando se cablee. |
| 15 | Test de integración del cierre: `saveLiquidacion` + `guardar_liquidacion_tx` + mutex | Pruebas / Backend | `src/lib/cuadra/repo.ts:273-300`, `src/lib/cuadra/conv.ts:84-136` | medio | Es el único tramo del camino del dinero sin arnés: ningún test ni arnés manual menciona `saveLiquidacion`, `addGasto`, `guardar_liquidacion_tx`, `acquireViajeLock` ni `claimMessage`. Convierte "lo leí y el SQL se ve bien" en algo que falla si se rompe. |
| 16 | Tests del ciclo agéntico completo | Tool calling | `src/lib/llm/openrouter.ts:318-426` | medio | Ahí viven `LoopGuardError`, `PartialExecutionError`, el cache `crossRound/inRound` y el fallback de proveedor. Hoy solo `makeExecutor` está probado. Si alguien agrega una 4ª tool, un doble-`guardar_liquidacion` no lo agarra `npm test`. |
| 17 | Cablear Sentry en los ~20 `logger.error()` existentes (o sacarlo del `package.json`) | Operabilidad | `src/instrumentation.ts:3`, `package.json` | medio | Hoy un error después del `after()` —donde ya no hay respuesta HTTP que lo delate— solo existe como una línea en el log crudo de Vercel. Cierra la brecha entre *loguear* y *alertar*. |
| 18 | Detectar `finish_reason === 'length'` en el ciclo de tools | Rendimiento | `src/lib/llm/openrouter.ts:374-421` | medio | `generateStructured` ya tiene el guardarraíl `TruncatedError` con reintento a 2x, aprendido de un bug medido en campo. El ciclo de cuadre corre con `reasoning:'high'` y `max_tokens` default de 1000, y no mira `finish_reason`: el mismo modo de falla se repite como una llamada pagada que no produjo tool_call. |
| 19 | Calcular el cuadre **una** vez por cierre en vez de tres | Rendimiento / Arquitectura | `tools.ts:49`, `tools.ts:74`, `guardia.ts:38` | medio | 9 round-trips a Supabase en lugar de 3, y elimina una discrepancia real: si entra una foto a media conversación (las fotos no toman el mutex), el número que el operador ve por WhatsApp puede no ser el que quedó en el PDF. |
| 20 | Mover los selects + mapeo del dashboard a `repo.ts` (o a un módulo de lectura compartido) + 2-3 pruebas de humo | Arquitectura / Frontend | `src/lib/cuadra/analytics.ts:19-155`, `src/app/dashboard/page.tsx:24-39` | medio | Es la única capa del código de dinero que no pasa ni por el motor puro ni por `repo.ts`, con `data.campo as string` sobre `unknown` (tsc no atrapa nada). El mejora #2 es la prueba de que se desincroniza sola. |
| 21 | Arreglar o quitar `getStatsPorOperador`: devuelve `diferencias: 0` hardcodeado | Arquitectura | `src/lib/cuadra/analytics.ts:73` | bajo | Una función exportada que miente. Si alguien la conecta al panel, muestra ceros con cara de dato. |
| 22 | Sanear `err.message` antes de que llegue al modelo | Tool calling | `src/lib/llm/tool-executor.ts:55-61` → `openrouter.ts:415` | bajo | Un error de Postgres viaja crudo al contenido `role:'tool'`; el prompt no le dice al modelo qué hacer con él, así que puede repetírselo textual al operador. `logger.error` ya guarda el detalle completo. |
| 23 | `constTimeEq()` en la comparación del passcode del login | Seguridad | `src/app/acceso/page.tsx:22-25` | bajo | `code === expected` hace short-circuit. `passcode.ts` ya tiene la función y no se reutiliza aquí. Explotabilidad baja por el rate-limit, pero es la primera inconsistencia que reportaría un pentest. |
| 24 | Fallar el arranque si falta `DASHBOARD_SECRET` en producción | Seguridad | `src/lib/auth/passcode.ts:15` | bajo | Sin esa variable el secreto del HMAC se deriva del propio passcode (`likida:${DASHBOARD_PASSCODE}`): filtrar el passcode equivale a poder forjar la cookie para siempre. |
| 25 | Revalidar la cookie dentro de las páginas del dashboard, no solo en el matcher | Seguridad | `src/middleware.ts:33`, `src/app/dashboard/page.tsx`, `dashboard/[id]/page.tsx` | medio | Hoy la autorización del panel de dinero descansa en una sola capa: un regex. Cualquier ruta nueva bajo otro prefijo abre el panel sin que nada más lo detenga. |
| 26 | Sincronizar `.env.example` con lo que el código realmente lee | Operabilidad | `.env.example` vs `grep process.env` | bajo | Faltan `DASHBOARD_PASSCODE`, `DASHBOARD_SECRET`, `DEMO_TENANT_ID`, `CUADRA_WHATSAPP_MSG_USD`; sobran `FACTURAPI_KEY`, `QSTASH_TOKEN`, `UPSTASH_*`, `SENTRY_DSN`. Se conecta con el #24. |
| 27 | h1 en el dashboard, contraste del error de `/acceso`, `overflow-x-auto` en la tabla | Frontend | `dashboard/page.tsx` (cero h1), `acceso/page.tsx:42-44` (#ff3b30 sobre #fbfbfd ≈3.5:1, falla AA), `dashboard/page.tsx:154` (`card overflow-hidden`) | bajo | Tres arreglos de minutos: outline de documento navegable, mensaje de error legible justo cuando algo salió mal, y una tabla de 5 columnas que se puede deslizar desde el teléfono. |
| 28 | Decidir el fork de `facturacion/`: conectarlo o borrarlo | Arquitectura | `facturacion/comercios.ts` (230 líneas) + `identificar.ts` (51), sin consumidores fuera de sus tests; vs `config.ts:106-115` | medio | 281 líneas vivas, probadas y muertas que resuelven lo mismo que la lista en producción. Segunda fuente de verdad: se desincronizan la primera vez que alguien agregue una gasolinera en una sola. (`caducidad.ts` sí se usa — no borrar el directorio entero.) |
| 29 | Rate limit de ráfaga en Upstash en vez de un `Map` en memoria | Rendimiento / Seguridad | `src/lib/ratelimit.ts:7-27` | medio | El tope de 40/min por teléfono no aplica cuando Vercel reparte la ráfaga entre instancias: cada una arranca su contador en 0. `@upstash/redis` ya es dependencia. |
| 30 | Conectar o desdocumentar la escalación a Opus | Agéntico | `src/lib/llm/models.ts:38-40` (rol `cuadre_fallback`) | medio | El comentario promete escalación por baja confianza / monto alto, y ningún archivo referencia ese rol. Deuda no declarada como tal. |
| 31 | `CHECK`/enum sobre `gasto.concepto` y `politica_gasto.concepto` | Datos | `supabase/migrations/0001_init.sql:38,57-65` | bajo | Es `text` libre: un typo o un acento distinto no cuadra contra la política y se guarda sin aviso. Los tres conceptos nuevos "ya funcionan" porque nada los valida, no porque estén modelados. |
| 32 | Prender `CUADRA_RECUPERAR_CIERRE_PARCIAL` (o reenvío manual del PDF desde el panel) | Agéntico | `src/lib/cuadra/processor.ts:336` | bajo (flag) / medio (reenvío) | Si el timeout pega justo después de que el viaje ya cerró, el operador recibe "se me trabó" y nunca el PDF; su "listo" reintentado cae en "No tienes viaje abierto". Ya está resuelto detrás del flag; falta prenderlo. |
| 33 | FK compuesta que amarre `tenant_id` de `gasto`/`liquidacion` al tenant real del `viaje` | Datos / Backend | `supabase/migrations/0001_init.sql:46-76`; se hereda en `0013` | alto | Nada en Postgres verifica que el `tenant_id` denormalizado coincida con el del `viaje_id` referenciado. En 0013, el `update viaje ... where id=p_viaje and tenant_id=p_tenant` afecta 0 filas **sin error**: la "transacción atómica" degrada a liquidación insertada + viaje nunca cerrado + cero excepción. Hoy no es alcanzable porque el tenant sale del teléfono verificado. |
| 34 | Pruebas del PDF contra sus propios bytes | Pruebas | `src/lib/cuadra/liquidacion/pdf.ts` (246 líneas, 0 tests) | medio | `pruebas-manuales/pdf.prueba.ts` existe pero su única aserción es `bytes.length > 1000` y el resto son `console.log` pidiéndole a un humano que lo abra. Es un arnés de mirar, no una verificación. Nada comprueba que la paginación no trunque una fila. |
| 35 | Migrar `middleware.ts` a `proxy.ts` / `proxyConfig` | Arquitectura | `src/middleware.ts:9,32` | bajo | Next 16 renombró la convención. Funciona hoy por compatibilidad hacia atrás, pero el proyecto ya corre la versión que la reemplazó. |
| 36 | Prompt caching en el system prompt del agente | Rendimiento | `src/lib/llm/openrouter.ts` (sin `cache_control` en ningún lado) | bajo | Hoy el prompt es corto y el ahorro es chico, pero `00-ROADMAP.md` ya anuncia una capa de "fundamento citable" que lo va a inflar en cada uno de los hasta 6 rounds. Evita una regresión de costo silenciosa. |
| 37 | Quitar el agente `orchestrator` (o comentar que es scaffolding) | Arquitectura | `src/lib/agents/registry.ts:7-13`, `prompts.ts:42-44` | bajo | `runAgent()` se llama en todo el repo solo con `'liquidacion'`. Deja la impresión falsa de que hay clasificación por IA en la entrada, cuando el enrutamiento es un if/else. |
| 38 | `Array.isArray` antes de mapear en `/api/demo` | Backend | `src/app/api/demo/route.ts:32` | bajo | Un 400 claro en vez de un 500 genérico de Next. Cosmético, endpoint sin dinero real. |

### Mejoras que se pisan entre sí

- **#3 se hace en una sola pasada.** Poner las variables de entorno y confirmar plan + Fluid Compute en el dashboard de Vercel son el mismo trámite; si Fluid ya está activo (300s por defecto en todos los planes hoy), sube `maxDuration` y el peor caso deja de ser un problema. No hagas una sin la otra.
- **#1 y #15/#16 se refuerzan.** El fix de `guardia.ts:40` es una palabra, pero `guardia.test.ts` hoy solo revisa el encabezado: mete el caso en el mismo commit o el bug vuelve.
- **#2 lo absorbe #20.** Parchar el mapa `CONCEPTO` a mano es lo correcto para el 6-ago; si después centralizas la lectura del dashboard en `repo.ts`, el parche desaparece. No hagas #20 antes del demo solo para evitar #2.
- **#15 y el test del mutex son el mismo arnés.** Montar Supabase local (o el mock de `supabaseAdmin`) cuesta lo mismo para uno que para los dos; hazlos juntos.
- **#1 y #19 tocan la misma función.** Si vas a reorganizar el recálculo del cuadre, el fix del destinatario entra gratis en esa pasada — pero no esperes a #19 para hacer #1.
- **#10 detecta #27 solo.** Prender ESLint con `jsx-a11y` marca el h1 y el contraste automáticamente; si vas a hacer los dos, empieza por el lint y deja que él te dé la lista.
- **#17 y #6 recorren los mismos `logger.error`.** Una sola pasada por los ~20 call-sites: agrega el contexto y el `captureException` al mismo tiempo.
- **#24 y #26 son la misma pregunta.** Sincronizar `.env.example` es cuando descubres que `DASHBOARD_SECRET` no está listado; documenta y haz obligatorio en el mismo commit.
- **#8/#9/#31 comparten migración.** Los tres son constraints sobre `gasto`: una sola migración 0017, un solo despliegue, una sola verificación de que no rompa datos existentes.
- **#33 hace parcialmente redundante al #8**, pero al revés no: la FK compuesta cierra el aislamiento entre tenants, no el reuso de CFDI. Se necesitan los dos.

---

## Lo que sube más la nota con menos trabajo

Los cinco primeros del plan, con el porqué de estar arriba:

**1. `guardia.ts:40` — `resumenCuadre(liq, cuadro, 'operador')`.**
Una palabra, y es el hallazgo más caro del reporte. No es un caso de borde: es el camino feliz del guion —foto, "listo", el agente cuadra y narra cifras, la guardia reemplaza el texto— y `guardiaCifras` corre sobre **toda** respuesta que va al operador (`processor.ts:367`, justo antes del `await say()`). El chofer recibe los cinco tipos de `SOLO_CONTRALOR` (EFOS, CFDI cancelado, RFC receptor, IEPS no desglosado, complemento) más el descargo legal completo. Que es un descuido y no una decisión lo prueba el hermano: `processor.ts:352` sí pasa `'operador'` y lleva el comentario que lo explica. Y el contralor lo va a leer en la pantalla, delante de ti.

**2. `dashboard/[id]/page.tsx:10` — tres conceptos al mapa.**
Es el defecto más barato de arreglar y el más visible en la demo: si el guion enseña un ticket de comida o de hotel, el comprador ve `alimentacion` en minúscula cruda en la tabla que le estás vendiendo. Ninguno de los diez auditores lo reportó, lo cual dice algo sobre esa capa: nadie la mira, no tiene test y no tiene lint. Arreglarlo cuesta minutos; que se te caiga en la sala cuesta la reunión.

**3. Las variables de intake en el entorno real + confirmar Fluid Compute.**
Es el único hallazgo del reporte que puede causar **pérdida silenciosa y permanente** de un mensaje del operador. Las tres esperas son secuenciales dentro del mismo `after()`: 60s de barrera por default (`conv.ts:167`), 12s de lock (`conv.ts:117`), 40s de agente (`processor.ts:315`) = 112s contra `maxDuration=60`. Cuando revienta, Meta ya recibió su 200 OK y `claimMessage` ya marcó el mensaje como procesado, así que no hay reintento; y `releaseMessageClaim` solo corre en el `finally`, que nunca llega. El operador manda "listo" y no pasa nada, nunca. La mitigación vive en `.env.example`, no en el default del código: un deploy que la olvide se lleva el peor caso completo.

**4. `loading.tsx` en las dos rutas dinámicas.**
Cero `loading.tsx` en todo el repo con tres rutas `force-dynamic`. Next bloquea la navegación sin mostrar nada hasta que resuelve Supabase. Es cosmético en teoría y determinante en la práctica: en una demo en vivo, un segundo de blanco se lee como "esto está lento" y esa impresión no se recupera con argumentos.

**5. Reescalar la foto antes del modelo de visión.**
El único de los cinco que no es del demo sino del negocio. El mismo buffer ya se reescala a 1600px para el lector de QR (`cfdi.ts:239`) y se manda sin tocar, en resolución nativa de WhatsApp, a la llamada de mayor volumen del sistema (`ocr.ts:151`). Cada foto paga tokens de imagen y latencia de subida por píxeles que no mejoran el OCR. `sharp` ya está instalado, el patrón ya está escrito diez líneas más allá. Toca el 100% de las fotos procesadas, hoy y siempre.

---

## Antes del demo del 6-ago vs. después

### Bloqueantes — antes del 6-ago (los cuatro suman menos de media jornada)

| | Qué | Dónde | Esfuerzo |
|:--:|---|---|:--:|
| 1 | Pasar `'operador'` a `resumenCuadre` + caso en `guardia.test.ts` | `cuadre/guardia.ts:40` | bajo |
| 2 | `CUADRA_INTAKE_ESPERA_MS=20000` / `CUADRA_INTAKE_GRACE_MS=2000` en el entorno real + confirmar Fluid y subir `maxDuration` | entorno de Vercel; `route.ts:24` | bajo |
| 3 | `loading.tsx` en `/dashboard` y `/dashboard/[id]` | `src/app/dashboard/` | bajo |
| 4 | Tres conceptos al mapa `CONCEPTO` | `dashboard/[id]/page.tsx:10` | bajo |

Después de aplicarlos, corre `npm test` y `npx tsc --noEmit` y **haz una pasada del guion completo mirando la pantalla**, no solo los logs: foto de diesel, foto de caseta, foto de comida (para ver el concepto nuevo), "listo", y lee el mensaje que le llega al operador en WhatsApp palabra por palabra. El bloqueante #1 solo se ve mirando.

### Antes del primer cliente que pague (no bloquean el demo)

- Constraints en la base: `unique(tenant_id, cfdi_uuid)` + `CHECK (monto > 0)` + enum de `concepto` — una sola migración 0017.
- Test de integración de `saveLiquidacion` / `guardar_liquidacion_tx` y de `acquireViajeLock` / `claimMessage`. Es la brecha que más pesa contra un 9 en Backend y contra un 8 en Pruebas.
- Cablear Sentry o sacarlo del `package.json` y del README. Hoy prometes observabilidad que no existe.
- CI de `typecheck + test + build` y `eslint.config.mjs`. Hoy no hay análisis estático de ningún tipo.
- Merge profundo de `config.ts:131`, **antes** de que exista un segundo tenant con config propia.
- `DASHBOARD_SECRET` obligatorio en producción + `.env.example` sincronizado.
- Tests de `sat.ts` (parseo puro, mockeable, decide fraude).

### Antes del segundo cliente

- Auth real con sesión por usuario y RLS activa para lecturas: el passcode único es multi-tenant-blind por diseño y el filtro por tenant es un parámetro fijo en código. Ya está en el roadmap línea 74 — no lo adelantes, pero no lo dejes pasar de largo.
- FK compuesta `tenant_id` → tenant del viaje (el hueco de 0013 que degrada la transacción atómica en silencio).
- Rate limit en Upstash.
- Decidir el fork de `facturacion/` antes de que las dos listas de marcas se separen.

---

## Ajustes del evaluador

Diez expertos calificaron; un evaluador con contexto limpio verificó cada afirmación contra el archivo y movió cuatro notas. Se deja el rastro porque los ajustes explican dónde la autoevaluación del proyecto es demasiado generosa.

**Frontend: 7 → 6.**
Dos de los diez hallazgos no sobrevivieron y uno real se le escapó. (a) Afirmó "no existe `design-system/`": sí existe, con `foundations/`, `components/`, `templates/landing/`, `styles.css` y `theme.json`. No lo abrió. (b) Infló el hallazgo de contraste de los puntos de estatus: en `dashboard/page.tsx:177-178` el punto va seguido de su etiqueta de texto en la misma celda, así que WCAG 1.4.1 se cumple por redundancia — es cosmético. (c) Se le escapó el mapa `CONCEPTO` obsoleto, que es lo que de verdad se ve en la demo. Con 7 archivos tsx, ~500 líneas, cero pruebas y cero lint, el 6 es el techo honesto.

**Sistema agéntico: 7 → 6.**
El hallazgo de `guardia.ts:40` es correcto y **peor** de lo que lo pintó: no es un caso de borde, es el camino feliz. Un 7 significa "deuda conocida"; esto no estaba conocido, está en el canal de producción más usado y sin ninguna prueba. El segundo defecto del mismo archivo (`guardia.ts:30-31` solo mira `cuadrar_viaje`, así que un cierre vía `guardar_liquidacion` muestra el encabezado neutral en el turno en que el dinero SÍ se comprometió) tampoco está cubierto. El diseño —tools sin parámetros, ctx por closure, recálculo autoritativo, cierre atómico— es lo que impide que caiga a 4-5.

**Arquitectura: 8 → 7.**
Un 8 pide "sólido, **probado**, con las decisiones documentadas", y la mitad de lo que el propio auditor marcó como deuda ya cobró. El fork de `facturacion/` es distinto de como lo describió (`caducidad.ts` sí se usa desde `engine.ts:13`; `comercios.ts` e `identificar.ts` son las 281 líneas muertas). "El dashboard duplica el mapeo sin prueba" no es un riesgo futuro: ya produjo el defecto de `CONCEPTO`. Y `analytics.ts:73` exporta `getStatsPorOperador` con `diferencias: 0` hardcodeado — una función que miente, exportada.

**Operabilidad: 7 → 6.**
Todos sus hechos son ciertos y verificados, pero él mismo escribió "esto es correcto y usable, con deuda conocida (6-7)" y luego puso 7. Para un sistema que mueve dinero, sin CI, sin lint (`next lint` ya no existe en Next 16 y no hay `eslint.config.*`), sin alertas, sin cobertura del camino de escritura y con el log del fallo de cierre incapaz de decir qué liquidación falló, el 6 es el que aguanta. El buen gusto de `startup.ts` y del logger es real y es lo que impide bajar a 5.

**Seguridad: 7 confirmada, riesgo mayor reemplazado.**
La nota se sostiene, pero el riesgo #1 declarado —el passcode multi-tenant-blind— el propio auditor admite que hoy no es explotable (un solo tenant hardcodeado) y que está en el roadmap. No se castiga lo que el roadmap dejó fuera a propósito, y menos se corona como riesgo principal. Los riesgos presentes son otros dos: `passcode.ts:15` derivando el secreto del HMAC del propio passcode si falta `DASHBOARD_SECRET`, y la autorización del panel descansando exclusivamente en el regex del matcher de `middleware.ts:33`, sin revalidación dentro de las páginas.

**Backend: 8 confirmada, con un hueco agregado.**
Verificado pieza por pieza, no solo leído. Se agrega un hallazgo dentro de su propia evidencia estrella: en la migración 0013 el insert de `liquidacion` no valida que `p_viaje` pertenezca a `p_tenant`, y el `update viaje ... where id=p_viaje and tenant_id=p_tenant` afecta 0 filas **sin error** si no coinciden — la "transacción atómica" degrada a "liquidación insertada, viaje nunca cerrado, cero excepción". Hoy no es alcanzable, por eso no baja la nota.

**Tool calling: 7 confirmada.** La mejor argumentada del lote; las cuatro capas de idempotencia se verificaron una por una y el detalle fino (`cuadrar_viaje` fuera de `READ_PREFIXES`, error crudo llegando al modelo, `generateWithTools` sin un solo test) es correcto.

**Pruebas: 6 confirmada.** Se reprodujo el grep decisivo. Un matiz sin mover la nota: sí existe `pruebas-manuales/pdf.prueba.ts`, pero su única aserción es `bytes.length > 1000` — es un arnés de mirar, no una verificación. La tesis central ("el cálculo sí está probado, la escritura no") es exacta.

**Rendimiento: 5 confirmada, y la aritmética es peor.** Su cuenta de 72s asume la mitigación de `.env.example`; con los defaults del código son 112s. Un 6 exigiría que el peor caso quepa en el presupuesto o falle ruidoso, y no hace ninguna de las dos: se pierde en silencio.

**Modelo de datos: 6 confirmada, evidencia impecable.** En las 16 migraciones no hay un solo CHECK de dominio; los únicos `check` son los `WITH CHECK` de políticas RLS. El `unique (tenant_id, cfdi_uuid)` de 0009 está sobre la tabla del XML crudo, no sobre `gasto`.
