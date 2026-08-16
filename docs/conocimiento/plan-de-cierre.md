# El plan de cierre — de donde estamos a la startup completa (16-ago-2026)

Síntesis del mapeo total del 16-ago: 6 exploradores sobre el código (33 páginas
del cliente, 39 del admin, 32 rutas API, 65 tablas, todos los motores) + 4
lectores a fondo sobre la carpeta de conocimiento del escritorio (~430 docs:
blueprints, fases, finanzas, legal, fiscal, GTM). Este plan RESECUENCIA el
Blueprint 16 del paquete (que manda) con lo que YA se construyó después de su
corte (15-ago) y con las órdenes de Javier del 16-ago (simulador, centro de
mando, banco de tickets). Regla transversal: la IA prepara, el humano aprueba.

## Los tres descubrimientos que cambian el plan

1. **El Blueprint 16 quedó parcialmente atrás en un día**: de sus "5 huecos más
   caros", la cola de aprobación (0117/0120/0124) y el catálogo de agentes
   (0116/0125) YA existen; el runner, el copiloto, el redactor y 21 rutinas
   locales también. La Fase 2 del 16 está casi cerrada EN CÓDIGO — lo que no
   está es EN PRODUCCIÓN (migs 0121-0125 sin aplicar).
2. **El production-ready ya está diseñado**: `qa-autonomo/` (6 agentes
   sintéticos, 8 oráculos, panel /admin/qa, banco de fotos) + `maquina-de-
   automejora/` (paso 0 = $0 y una semana). No se diseña: se construye.
3. **La tensión fiscal más cara está viva**: dos lecturas del estímulo de
   diésel (íntegra vs disminuida, factor 3.5×) se sostienen del mismo texto
   legal. Hasta que un fiscalista con cédula firme una, el producto muestra
   LITROS y rango, jamás pesos de estímulo. Y la RMF del 9-jul (28 reglas, la
   11.7.3 retroactiva al 1-abr) se cerró sin leer en 4 docs — los Anexos 21/22
   siguen sin revisar.

## FASE A · La verdad y el orden (esta semana — agentes, casi todo)

*Criterio de salida: ningún documento del paquete contradice a otro; ninguna
pantalla o doc del repo miente sobre el código.*

- **Higiene del escritorio**: borrar los 5 clones `enterprise*` (490 MB, 3
  marcados corrupted/broken), los 3 `.xlsx.bak`, indexar TICKETS/ (32 fotos →
  primer banco de QA), reescribir `00-LEEME.md` para cubrir las 19 carpetas,
  fusionar la carpeta 12 en la 13 (duplicación declarada).
- **Las 17 contradicciones financieras (A-Q)**: una pasada de corrección con
  `verificar-cifras.py` de candado — dos valuaciones sin reconciliar, dos
  cortes del censo, cuatro conteos de pruebas, el ancla $60-110K que no existe
  en el paquete de precios, el SOM viejo dentro del memo, "42 tablas".
- **Fiscal urgente** (encargo al experto-fiscal + dof-diario): releer la RMF
  del 9-jul completa (11.7.3, 2.7.1.48, Anexos 21/22), verificar los
  recálculos abr-jul de la cuota, aplicar el STOP de pesos del estímulo
  (litros + rango en producto y marketing), separar por nombre las dos
  bitácoras, separar las banderas `necesita_carta_porte` /
  `elegible_rfa_titulo_2`.
- **Deuda chica de código encontrada por el mapeo**: gate de ruta en
  `/dashboard/mi-perfil`; rutas huérfanas al sidebar (usuarios, políticas,
  ARCO); tope de gasto y rate limit al copiloto (`/api/admin/copiloto` es el
  único camino LLM sin freno); índice `/admin/corridas` (los chips apuntan a
  un 404); notificaciones visibles al contador o corregir el comentario;
  arreglar los 3 mapeos tool→pantalla del copiloto.

## FASE B · Production-ready medible (semanas 1-2 — agentes)

*Criterio de salida: una corrida repetible que responde "¿aguanta un piloto?"
con calificación por rubro, y el CI cazando lo que la suite no ve.*

- **QA fase 1** (diseño ya pagado): orquestador + 8 oráculos + agente Operador
  sintético con `processInbound` EN PROCESO, tenant `ZZZ QA`, semillas
  deterministas. Sin Playwright, sin staging.
- **El banco masivo de tickets** (orden del 16-ago): ingesta de carpetas
  enteras de comprobantes reales → banco etiquetado (`qa_foto` con oráculo
  humano donde falte verdad) → el ejército QA los corre contra el flujo real
  → cada fallo se vuelve hallazgo para la mejora diaria. Primer lote: los 32
  de TICKETS/ + el conjunto dorado de pruebas-manuales.
- **Automejora paso 0** ($0, una semana): los 88 oráculos SQL al CI,
  fast-check con 5 propiedades sobre `cuadre/`, Stryker acotado, y la red
  estructural para el crítico de `env.ts:12` (fallback SERVICE_ROLE→ANON).
- **Fase 1 del Blueprint 16** (cero código hasta hoy): lector de las 3
  señales de PMF (la 0114 ya escribe, nadie lee) en `/admin/flotas`; cerrar
  los 5 interruptores decorativos + bitácora del agente liquidación (criterio:
  `estaApagado(` en 13 call sites).
- **Panel /admin/qa fase A**: subir fotos → botón → veredicto con evidencia.

## FASE C · El primer cliente (semanas 2-4 — LAS LLAVES SON TUYAS)

*Criterio de salida: un piloto real corriendo y el primer peso cobrable.*

Tu lado (nadie puede hacerlo por ti, en este orden):
1. **Token `sbp_`** → migs 0121-0125 → humos → `[deploy]` (la capa comercial
   entera gira con esto).
2. **Verificación de Meta** del número real (el bloqueante #1 del paquete:
   un chofer real no puede escribirle al de prueba).
3. **Entidad legal** (regla del paquete: constituir cuando el primer cliente
   FIRME — pero el abogado se busca YA) + cesión de PI el mismo día +
   marca IMPI (la palanca más barata, ~$3.5k/clase) + los 4 contratos de
   borrador a revisión.
4. **Dominio de correo frío + warmup** (reloj muerto de 2-4 semanas: se
   arranca hoy aunque el primer envío sea en un mes) y **firma del acuerdo
   de comisión** antes del primer lead.
5. Las **5 entrevistas con contralores** — la validación que ninguna de las
   investigaciones hizo: nadie ha hablado con un comprador real.
Del lado agentes, en paralelo: calculadora de recuperación fiscal en la
landing (con la advertencia del ingreso acumulable — la honestidad ES el
diferenciador), las 10 piezas de contenido (la rutina semanal ya existe),
demo grabado + capturas, enriquecedor del censo (829 empresas, 0 teléfonos —
TODO el pipeline está detrás de esa casilla; DENUE→Maps, <$50 USD), y la
propuesta preliminar para reactivar Innovativos antes de que su consultor
cierre la puerta.

## FASE D · El centro de mando visual (semanas 3-5 — agentes; necesita C.1)

*Criterio de salida: operas todo desde /admin (y el teléfono) sin tocar una
terminal.*

- **El bus**: las 21 rutinas locales suben estado/piezas/colas a Supabase y
  leen de ahí tus órdenes; tablas nuevas + storage para imágenes.
- **La UI**: bandeja única "Tu turno" (PRs + piezas + sequences + aprobaciones
  + escalaciones, ordenada por dinero/riesgo), monitor de agentes con su
  memoria y su bandeja de contexto (arrastras documentos, videos, noticias —
  cada agente los procesa en su siguiente corrida), sequences visuales donde
  subes tus characters/lugares y el pipeline produce solo lo que falta,
  aprobar desde el teléfono.
- **El editor visual de rutinas** (orden del 16-ago): cada rutina con su
  tarjeta — horario, encargo (el prompt, editable con historial y vuelta
  atrás), tope, kill switch individual, últimas corridas con veredicto — y
  el botón de "correr ahora". Editar el encargo desde la UI escribe al bus y
  la Mac lo sincroniza a `encargos/*.md` por PR chico (la automejora y tú
  editan por el mismo camino, con el mismo rastro).
- **La memoria tipo Obsidian**: vault markdown compartido con sección por
  agente (lo aprendido, tus correcciones, sus mejores piezas), enlazado; las
  rutinas lo leen antes y lo escriben después.
- **El estudio de marketing** (orden del 16-ago, con nombre propio): una zona
  visual donde (a) sueltas videos que te gustaron y ves el banco de hooks que
  el agente destiló de cada uno; (b) subes fotos de personajes y lugares y
  ESO arranca la cadena (el pipeline usa tus hojas tal cual y produce solo lo
  que falta); (c) ves cada pieza del día como tarjeta con su copy por canal y
  el tap de publicar. Principio rector dictado por Javier: "entre más le das,
  más entienden" — cada cosa que sueltes en el estudio alimenta la memoria
  compartida de todos los agentes de marketing, no un silo.
- **WhatsApp conversacional**: tus respuestas al bot se vuelven órdenes
  (aprobar sequence, correr agente, estatus) vía webhook→bus→rutina.
- QA fase 2 (el examen fiscal de 32 preguntas doradas — diseño pagado, cero
  código) + panel QA fase B (banco masivo con oráculo humano).

## FASE E · De 1 a 6 clientes (mes 2-3)

Éxito del cliente + financieros encendidos con datos reales (los motores ya
existen, esperan filas) · envío autónomo acotado (cola→Resend con topes, ya
cableado) · QA fase 3 (browser sobre la app propia, nunca producción) ·
37 portales fases A-B (playwright_base + 4 portales + `portal_estado`; luego
~15 sin cuenta → ~54%) · evals con feedback en /admin/calidad-evals · motor
de reglas fase 1: la cuota semanal como DATO (requisito de cumplimiento
1/LIF/PI, no feature) · onboarding corrido de verdad (hoy: cero corridas
reales; los tiempos son supuestos declarados).

## FASE F · Escala (mes 3+, por señal, no por calendario)

QA fase 4 + Enterprise Readiness (9 dimensiones, compuertas duras) · fintech
B1 (comisión sobre flujo — SOLO tras SaaS cobrando; B2 descartado con número)
· portales C-D (credenciales cofre; modo asistido, jamás CAPTCHA) · registro
de jornada LFT 132-XXXIV (obligatorio 1-ene-2027, multa hasta $586k, ningún
competidor lo tiene y Likida ya recibe eventos con hora — la oportunidad
regulatoria con fecha) · SOC2/pentest solo con enterprise en pipeline real.

## Lo que NADIE resuelve (dicho para no fingirlo)

Webhook bancario mexicano (la conciliación siempre propondrá, nunca
confirmará sola) · el choque NOM-087 vs LFT 68 (se marcan ambas líneas, no se
resuelve) · la lectura A/B del estímulo (la firma un fiscalista, no un agente).
