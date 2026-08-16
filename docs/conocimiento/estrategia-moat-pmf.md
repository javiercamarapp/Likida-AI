# Moat y PMF — el análisis honesto (15-ago-2026)

> **Reemplaza la versión del 14-ago-2026** (el día que se declaró el rumbo a
> mercado). Esa versión se escribió antes de tres hallazgos que cambian el
> análisis: el universo de mercado es 2.7× más grande de lo que se creía
> (`05-Precios-y-Finanzas/universo-de-mercado.md`), la RFA 2.9 (el 15% de
> combustible en efectivo) y el estímulo de peaje NO aplican a flota privada
> mientras que el IEPS de diésel SÍ, y la suite de pruebas real corrió HOY a
> 4,549 pruebas verdes contra las ~3,161 del 14-ago. Este documento pide a
> propósito la lectura incómoda: **un inversionista de diligencia real
> pregunta "¿por qué no lo copia Uvicuo en un trimestre?", y un moat inventado
> se cae en esa pregunta.** Todo lo del código trae archivo:línea; todo lo de
> mercado trae su fuente o su supuesto declarado en la misma línea.

---

## El veredicto en una línea

**Sí hay un moat, pero es un moat de tiempo acumulado, no de barrera
estructural — y hoy vale $0 de valuación porque no hay un solo cliente
pagando que lo use.** Lo defendible no es "el motor fiscal" como idea (eso
lo copia un despacho fiscal bueno en meses); es el trabajo YA HECHO y
verificado que un competidor tendría que rehacer desde cero: 23 fichas
normativas verificadas contra fuente primaria, 4,549 pruebas automatizadas,
74 bloques de verificación de concurrencia corridos contra Postgres real (no
mocks), y una lista de bugs fiscales reales ya encontrados y media corregidos
(H4-H7 abajo). Eso no se replica en un sprint. Pero replicarlo tampoco es
imposible con capital — Uvicuo tiene $4M y un roadmap declarado de comerse el
80% del costo de flota. **La consecuencia práctica: el trabajo de esta
semana no es profundizar el moat, es convertirlo en clientes firmados antes
de que alguien con más dinero decida que vale la pena copiarlo.**

---

## Parte 1 — El moat, candidato por candidato

### 1. El motor fiscal y el corpus de `normas/`

**Qué es, verificado hoy:** `normas/` tiene **23 fichas** YAML (no 24; conteo
directo: `ls normas/*.yaml | wc -l` = 23), cada una con `texto_vigente`
transcrito de la fuente primaria (DOF, diputados.gob.mx, SAT), `estado_
verificacion` y `usado_en_codigo`. `cuadre/engine.ts` tiene 1,183 líneas, de
las cuales `~75-76%` es aritmética de comprobante-contra-anticipo genérica
(deduplicación UUID/RFC, calidad de OCR, EFOS/CFDI cancelado, tope de
viáticos LISR 28-V) y solo `~24-25%` (líneas 301-394, 530-601, 973-1061) es
exclusivo de autotransporte — cifra ya verificada línea por línea en
`15-La-Feature-Definitiva/00-LA-FEATURE.md` §3.1, y que este documento
confirma sin repetir el trabajo.

**Lectura de Javier, atacada:** su lectura es que esto es "ventaja de 12-18
meses, no foso — las reglas se copian con un buen fiscalista". **Es
correcta a medias.** Las REGLAS individuales (15% de efectivo, 50% de peaje,
tope de viáticos) sí están públicas en el DOF y un fiscalista las lee en una
tarde. Lo que NO se copia en una tarde es lo acumulado alrededor de esas
reglas — y aquí está la cuantificación que la versión anterior no tenía,
verificada hoy contra el repo, no citada de memoria:

- **4,549 pruebas automatizadas, 333 archivos, corridas hoy 15-ago-2026**
  (`npx vitest run` → `Test Files 333 passed | Tests 4548 passed | 1 skipped`).
  El 14-ago la línea base (`docs/auditoria-3/00-ESTADO-RONDA.md`) era 3,161
  verdes en 261 archivos — **1,388 pruebas nuevas en un día**, la mayoría
  fiscales o de concurrencia.
- **74 bloques `DO $...$` en `supabase/verificaciones.sql`** (conteo directo:
  `grep -c "^do \$"`), cada uno corrido contra Postgres real — no contra un
  mock de Supabase — con la salida pegada tal cual en el archivo (fechas,
  hashes, mensajes de error de Postgres). Esto prueba garantías que un test
  con mock no puede probar: índices únicos, `ON CONFLICT`, RLS contra la API
  REST anónima (14 tablas leídas → 0 filas, 5 escrituras rechazadas con
  `42501`, documentado el 31-jul).
- **13 rondas de auditoría automatizada acumuladas** (`docs/auditoria-3` a
  `docs/auditoria-13`), cada una corriendo 11-12 auditores expertos por rubro
  en paralelo más una verificación adversarial — por ejemplo 18 hallazgos
  verificados en la ronda 9, 12 en la ronda 8, 11 en la ronda 6
  (`docs/auditoria-{6,8,9}/00-ESTADO-RONDA.md`).
- **Bugs fiscales reales ya encontrados, con severidad y estado** —
  el ejemplo que el propio encargo pide, verificado hoy en
  `normas/lif-2026-20-A.yaml`:
  - **H4** (severidad alta): la ley dice que el 50% de peaje se calcula
    sobre el "gasto total erogado" (con IVA); el motor usaba el SubTotal sin
    IVA (`engine.ts` — `peajeAcreditable += g.subTotal * 0.5`). **RESUELTO**
    el 14-ago cuando se verificó que la RMF 2026 regla 9.1.8 fr. IV sí ordena
    excluir el IVA — el motor estaba bien por la razón equivocada, y esa
    diferencia solo se descubre leyendo dos fuentes primarias a la vez.
  - **H5** (media, abierto): el motor aplica el 50% a CUALQUIER gasto con
    concepto "caseta", sin verificar que sea de la Red Nacional de Autopistas
    de Cuota — una caseta estatal no da el estímulo y el motor la estaría
    acreditando de más.
  - **H6** (media, abierto): el motor no conoce los ingresos anuales del
    cliente ni su relación de partes relacionadas — dos condiciones legales
    del estímulo de peaje (LIF 20-A fr. V) que hoy se aplican sin verificar.
  - Este patrón de hallazgos H1-H7 numerados, con severidad y estado, se
    repite en `normas/lisr-28-V.yaml` y `normas/rmf-2026-2.7.1.48.yaml`
    (`grep -l hallazgo normas/*.yaml`).

**Cuánto trabajo real representa esto:** un competidor con dinero no compra
"un motor de reglas" — compra el proceso completo: transcribir texto vigente
de una fuente primaria, escribir el test que ata la ficha al código, correr
la verificación adversarial que encuentra el H4/H5/H6 (que exige leer DOS
normas a la vez, no una), y repetir eso 23 veces con 13 rondas de auditoría
encima. Es meses de trabajo de un equipo dedicado, no una tarde de un
fiscalista. **Ésa es la corrección honesta a la lectura de Javier: el moat no
está en las reglas, está en el proceso de verificación que las rodea, y ese
proceso sí tarda en copiarse.**

**Qué lo haría permanente:** que `normas/` deje de ser, como diagnosticó
`00-LA-FEATURE.md` §3.2, "un catálogo pasivo de citas legales" y se vuelva un
motor declarativo real — hoy el 15% de RFA 2.9 vive hardcodeado en
`engine.ts:357` (`const tope = 0.15 * total`) en vez de leerse de
`condiciones_de_aplicacion` de la ficha. Mientras cada regla nueva exija
tocar TypeScript a mano, el moat sigue siendo "mucho trabajo acumulado, caro
de alcanzar" — no "imposible de alcanzar". Conectar el catálogo al motor es
lo que lo vuelve un activo que se reusa entre verticales sin reescribir
código cada vez (ver Parte 4).

### 2. Los datos que solo se acumulan operando

**Hoy vale cero, literal — verificado, no supuesto.** `CLAUDE.md` del repo lo
dice sin rodeos: "La base entera está en cero (0 viajes, 14-ago-2026) porque
no hay clientes todavía, no porque falte código." `cliente`, `unidad` y
`tarifa` ya tienen escritor (el panel y `POST /v1/{viajes,unidades}`);
`factura_emitida`, `pago_recibido`, `posicion` y `geocerca` siguen sin uno.
El moat de datos no es que esté delgado: **es que todavía no existe.**

**¿A partir de cuántos clientes-mes empieza a ser defendible?** No hay un
número mágico universal, pero sí un umbral razonado desde lo que el propio
producto necesita para que el dato tenga valor:

- **El piso técnico es 1 cliente × 1 mes completo de operación**, porque
  antes de eso no hay ni siquiera una muestra de "costo real por ruta" que
  otro no pueda replicar preguntándole al mismo cliente directamente.
- **El piso comercial (donde empieza a doler cambiarse) es
  ~3 clientes-mes con el mismo perfil de flota** — suficiente para que
  Likida pueda decirle a un cliente NUEVO "así se comporta un cliente como tú"
  con benchmarks, algo que ningún competidor sin datos de flotas mexicanas
  reales puede ofrecer. Este número es un **supuesto declarado de este
  documento**, no una medición: se basa en que 3 observaciones es el mínimo
  para hablar de "rango" en vez de "un caso" sin sonar ridículo frente a un
  contralor que audita.
- **El piso defendible de verdad (underwriting fintech, §5 del documento
  viejo) es 12+ meses de historial de un cliente**, porque el "moat de
  underwriting" que la estrategia fintech propone depende de ver un ciclo
  completo de estacionalidad y cumplimiento, no un mes bueno.

**Consecuencia práctica:** cero clientes significa cero moat de datos, sin
excepción. Cada mes sin el primer cliente pagando es un mes que el reloj de
este candidato ni siquiera empieza a correr.

### 3. El costo de cambiarse

**Verificado en `normas/cff-30.yaml`:** el CFF art. 30 obliga a conservar
contabilidad y documentación fiscal **5 años** desde que se presentó la
declaración relacionada (con excepciones que lo ALARGAN: actos con efectos
fiscales prolongados, conceptos en litigio, actos societarios). El producto
conserva el XML crudo del CFDI (`repo.ts — saveCfdiXmlRaw`), y la ficha es
explícita sobre el límite real: **Likida es la ENCARGADA del tratamiento, no
la obligada — la obligación de conservar es del contribuyente, no de
Likida.** Esto importa porque debilita el argumento de lock-in: un cliente
técnicamente SÍ puede exportar su historial y auto-conservarlo; no hay una
barrera legal que se lo impida.

**¿Cuándo empieza a morder, entonces?** No por ley — por inercia y por
riesgo de auditoría, y en dos tiempos distintos:

- **Mes 1-11: el costo de cambiarse es bajo.** Poco historial, poca
  fricción real de perderlo, el cliente podría migrar sin exponerse a un
  hueco de evidencia en una auditoría del SAT.
- **A partir del mes ~12: empieza a doler de verdad**, porque el SAT puede
  auditar ejercicios anteriores y el cliente ya tiene un historial real
  documentado en Likida (CFDI validado, bitácora de estímulos, PDF de
  liquidación) que tendría que migrar o re-generar en otro sistema sin
  perder trazabilidad — y `src/app/privacidad/page.tsx` ya promete "al
  menos cinco años" de conservación, no un plazo corto.
- **Al llegar al año 5: el costo es máximo**, porque ahí es donde el CFF 30
  exige que TODO el ciclo completo siga siendo consultable, y para entonces
  el cliente tiene 5 años de datos que solo viven en Likida.

**El matiz que la versión vieja no tenía:** este switching cost no es una
barrera técnica (el cliente puede exportar), es un costo de RIESGO
percibido — y ese tipo de costo solo funciona como retención si Likida se lo
comunica activamente al cliente ("aquí vive tu evidencia ante una auditoría
del SAT de los últimos 5 años"), no si se queda implícito.

### 4. La posición de dos lados

**Verificado contra `mapa-competencia-mx.md`:** hoy, nadie más ataca los dos
lados a la vez con profundidad real. Uvicuo entra por el chofer (tarjeta +
WhatsApp) y no tiene el lado contable-fiscal serio (verificado por ausencia:
"su cumplimiento SAT es recuperar facturas, no validarlas"). Los TMS legacy
entran por la oficina del contador y no tienen al chofer en el loop (captura
manual, "sin operador en el loop, sin IA ni validación fiscal"). Handle es
el referente de producto, no compite en México.

**¿Alguien ya lo intenta? Sí — en narrativa, no en producto.** GetCastores
promete explícitamente "liquidación + combustible + WhatsApp/IA" — es
literalmente la misma jugada de dos lados que Likida ya construyó — pero el
mapa de competencia lo clasifica "MEDIO-ALTO en narrativa, BAJO en
producto": es SEO agresivo y una promesa, no algo que un prospecto pueda
probar hoy. Y Uvicuo tiene el capital y el roadmap declarado ("comerse el
80% del costo de flota") para moverse hacia el lado contable si decide que
le conviene.

**¿Es realmente difícil de atacar, o solo lo parece?** Analizado con
cuidado: **solo lo parece.** La posición de dos lados NO es, por sí misma,
una barrera — es una CONSECUENCIA de tener el motor fiscal (candidato 1) y
el registro operativo (candidato 2) al mismo tiempo. Cualquiera que
replicara el candidato 1 con suficiente inversión podría construir el lado
contable sobre su producto de chofer en un trimestre o dos — la dificultad
no vive en "estar en dos lados", vive en tener el criterio fiscal verificado
que hace que el lado contable sea confiable y no una pantalla más. **Este
candidato se reduce al candidato 1: no es un moat independiente.**

### 5. WhatsApp como interfaz

**Confirmado, pero con una corrección importante que la versión vieja no
tenía.** WhatsApp NO es moat — cualquiera lo integra con la API oficial de
Meta en semanas. La pregunta de Javier era si al menos es ventaja de
DISTRIBUCIÓN en México, y la respuesta honesta, verificada contra el mapa de
competencia, es: **cada vez menos.** Uvicuo ya vende "comprobación por foto
con IA" y un asistente de VOZ que le llama al operador moroso — está más
adelante en el canal que Likida hoy. GetCastores promete "WhatsApp/IA".
Conectamos.ai / IntegrAI venden literalmente "empleados digitales por
WhatsApp" al mismo comprador, con la misma frase que Likida usa en sus
llamadas de venta. **Tres competidores ya están en el mismo canal.**

Donde WhatsApp SÍ sigue siendo ventaja real es contra los TMS legacy
(captura manual en oficina, sin operador en el loop) — ahí la distancia es
enorme. Pero contra los competidores que de verdad importan (Uvicuo,
GetCastores, Conectamos), WhatsApp es tabla de apuesta mínima, no
diferenciador. **La corrección: la ventaja de distribución real de Likida
no es "usar WhatsApp" — es el censo propietario (829 empresas con la señal
de dolor fechada) y la red de vendedores-amigos, que ningún competidor tiene
copiado.** Y hoy ese canal está bloqueado: el WhatsApp de Likida sigue en el
**número de prueba de Meta** (verificado: `docs/conocimiento/
CONFIGURAR-META.md` — "solo puede mandar mensajes a números que..." estén
en la lista *To* del número de prueba). Un chofer real no le puede escribir
al bot todavía. Es el bloqueante operativo número uno de todo lo demás.

---

## ¿Hay moat hoy? El veredicto sin adornos

**No, no en el sentido que un inversionista entiende por "moat" — pero sí en
el sentido de "trabajo caro de alcanzar".** Distinguir los dos es la
honestidad que este documento debe tener:

- **Barrera estructural (lo que un inversionista pregunta primero):**
  no existe. Nada le impide legalmente, técnicamente o regulatoriamente a
  Uvicuo, Clara o un competidor nuevo con capital construir lo mismo. No hay
  patente, no hay licencia exclusiva, no hay efecto de red que excluya a un
  segundo jugador.
- **Ventaja de tiempo acumulado (lo que sí existe, medido arriba):** 23
  fichas verificadas, 4,549 pruebas, 74 bloques de verificación contra
  Postgres real, y una lista de bugs fiscales ya encontrados con severidad —
  eso representa meses de trabajo de un equipo dedicado, verificable, que
  nadie más tiene hecho hoy.
- **La consecuencia práctica, sin suavizar:** ese moat de tiempo vale $0 en
  una mesa de diligencia si nunca se convierte en clientes. Un inversionista
  no valora "trabajo hecho" — valora "trabajo hecho que ya generó ingreso
  recurrente que un competidor no puede replicar en el tiempo que tardaría
  en quitártelo". Hoy Likida tiene la primera mitad de esa frase y no la
  segunda. **La prioridad no es seguir profundizando el motor fiscal — ya es
  profundo — es firmar el primer cliente antes de que la ventana de tiempo
  se cierre.**

---

## Parte 2 — PMF: evidencia de problema, cero evidencia de producto

### Lo que SÍ es evidencia — el problema, abrumador

- **El censo:** 829 empresas únicas con la señal de dolor fechada
  (`censo_liquidacion_indeed.xlsx`, hoja "Estadísticas", verificado con
  `openpyxl` el 15-ago-2026 — la cifra de 828 en documentos anteriores es la
  corrida previa, diferencia de 1, irrelevante).
- **El hallazgo de hoy, el más fuerte del censo:** de **63 vacantes** cuyo
  TÍTULO contiene "liquidador" o "liquidación" (**48 empresas distintas**),
  al menos **15 (≈31%) NO son transportistas de oficio (SCIAN 484)** — son
  flotas privadas y distribuidores mayoristas: Danone, GEPP/Pepsi, Nadro,
  Grupo LALA, Grupo Bachoco, Sahuayo Abarrotes, Gas del Atlántico, entre
  otras (`15-La-Feature-Definitiva/todo-el-transporte-que-entra.md` §4,
  citado — no editado — verificado en la hoja "Señal" del censo). El puesto
  se repite literal: "Cajero Liquidador", "arqueos y cortes de caja, manejo
  de cuentas y liquidaciones" — la misma descripción que usa el resto del
  censo para el liquidador transportista. **Esto prueba que el dolor es
  real, grande y transversal a industrias que no son transporte — no que
  Likida ya tenga clientes ahí.**
- **La categoría está validada por terceros con capital:** Handle (US,
  referente de producto) y Uvicuo (MX, $4M, Mastercard) — nadie tiene que
  evangelizar ya que este es un problema con presupuesto.

### Lo que NO es evidencia — el producto, cero

- **Cero clientes pagando.** Grupo GAL y Transportes Innovativos son
  **prospectos** — Grupo GAL con cita, Transportes Innovativos con una
  llamada de descubrimiento realizada. Ninguno ha pagado un peso.
- **Cero corridas reales con datos de cliente.** `viaje`, `cliente`,
  `factura_emitida` — todo en cero por falta de clientes, no de código
  (`CLAUDE.md`).
- **El canal sigue bloqueado.** El WhatsApp de Likida está en el número de
  prueba de Meta: un chofer real no puede escribirle al bot hoy. Cualquier
  demo que "funcione" hoy necesariamente tiene a Javier operando manualmente
  una parte del flujo — no es el producto solo, es el producto con Javier
  encima (ver anti-señal abajo).

**PMF no se declara: se cobra.** La distinción entre las dos secciones de
arriba es la que Javier tiene que sostener frente a un inversionista sin
mezclarlas: "el mercado tiene el dolor" es un hecho verificado; "Likida ya
resuelve el dolor para alguien que paga" es, hoy, falso.

### Las señales que probarían PMF con el primer cliente — con umbral y cómo medirlas

Las cuatro que Javier propuso, completadas y hechas medibles contra lo que
el producto YA registra hoy (no lo que "se podría construir"):

**1. Que el chofer mande fotos sin que se lo recuerden.**
- **Cómo se mide, ya existe:** `viaje.recordatorio_comprobacion_en` (0087) —
  el sello que se escribe SOLO cuando el agente tuvo que insistirle al
  chofer. `analytics.ts:226-249` (`getHechosSolos`) ya lee este campo para
  el feed del panel — la consulta para la métrica es la misma tabla, filtro
  distinto.
- **Métrica:** % de viajes cerrados en el mes donde `recordatorio_
  comprobacion_en IS NULL` (nunca hizo falta recordarle) sobre el total de
  viajes cerrados ese mes.
- **Umbral propuesto (supuesto declarado de este documento, a ajustar con
  el primer mes real):** **≥70%** de los viajes cerrados sin necesitar
  recordatorio. Por debajo de 50%, el chofer no adoptó el hábito — el agente
  está cargando el proceso, no acompañándolo.

**2. Que el contador use el PDF en su cierre real.**
- **Hueco honesto encontrado al buscar:** hoy el producto **no instrumenta
  esto**. Se buscó en todo `src/lib/likida` una columna tipo
  `descargado_en`/`visto_en`/`abierto_en` sobre `liquidacion` y no existe
  (`grep -rn "descargad\|pdf_visto\|visto_en" src/lib/likida` no devuelve
  nada sobre el PDF). El único `abierto_en` que existe es de
  `ticket_soporte`, una tabla distinta.
- **Consecuencia:** esta señal, tal como está el producto, **se verifica
  preguntándole directamente al contador**, no midiéndola — y es la
  instrumentación más barata que falta: una columna
  `liquidacion.pdf_descargado_en` (timestamp, nulleable) que se escriba en
  la ruta que sirve el PDF resolvería esto en una migración pequeña.
- **Umbral propuesto una vez instrumentado:** el contador abre el PDF
  **dentro de la ventana de su cierre real** (los 3-5 días alrededor de
  quincena/fin de mes que el propio cliente declare como su corte) al menos
  **2 de cada 3 quincenas** consecutivas — un solo mes no distingue
  curiosidad de hábito.

**3. Que pidan agregar unidades por su cuenta.**
- **Cómo se mide, con un hueco declarado:** existe `POST /v1/unidades` con
  escritura vía `crearUnidad`, y existe la emisión de llave de API propia
  del tenant desde `/dashboard/llaves-api` (`llave-api-escritura.ts`) — un
  cliente que emite SU PROPIA llave de área "administración" y la usa para
  dar de alta una unidad está, por definición, haciéndolo sin que Javier lo
  capture por él. **Pero `unidad` no tiene columna `creado_por`** (migración
  0047: `id, tenant_id, numero_economico, placas, marca, modelo, anio,
  estado, km_actual, poliza_vence, permiso_sict_vence, verificacion_vence,
  activo, creada_en` — sin actor), así que hoy no se puede filtrar
  automáticamente "lo dio de alta el cliente" contra "lo capturó Javier en
  el onboarding" sin mirarlo a mano.
- **Umbral propuesto:** dado el tamaño de la muestra en los primeros meses
  (1-2 clientes), esto NO es una tasa — es un evento binario: **al menos 1
  unidad dada de alta por el cliente, sin que Javier la haya capturado, en
  los primeros 30 días de uso.** A esta escala, un solo caso ya es señal.

**4. Que se quejen cuando algo se rompa.**
- **Cómo se mide, ya existe y con actor real:** `ticket_soporte.abierto_por`
  (migración 0051) — **NULL si Javier abrió el ticket a nombre de la
  flota, no NULL si lo abrió el propio usuario del cliente.** `categoria`
  distingue `tecnico`/`operacion`/`facturacion`/`cuenta`/`otro`.
- **Métrica:** conteo de `ticket_soporte` donde `abierto_por IS NOT NULL` Y
  `categoria IN ('tecnico', 'operacion')`, en los primeros 60-90 días del
  cliente.
- **Umbral propuesto:** de nuevo, a esta escala es un evento, no una tasa:
  **al menos 1 ticket técnico u operativo abierto por el propio cliente**
  en ese periodo. Y el matiz que hay que sostener frente a Javier: **la
  AUSENCIA de tickets no es buena señal a esta escala** — con 1-2 clientes,
  cero quejas es más probable que sea indiferencia (no lo usan lo bastante
  para notar cuando falla) que producto perfecto.

### La anti-señal — qué parece PMF y no lo es

- **Un demo que gusta.** Reacción positiva en una llamada no es evidencia de
  producto — es evidencia de que el problema resuena, que ya está probado
  por el censo. La pregunta que sí importa es si paga, no si sonríe.
- **Un piloto que solo funciona porque Javier está encima — y ahora mismo
  es literal, no hipotético.** Con el WhatsApp todavía en número de prueba
  de Meta, CUALQUIER demo que "funcione" hoy necesariamente tiene a Javier
  operando manualmente una pieza del flujo (mandando desde el número de
  prueba, capturando por el cliente). Eso no es el producto probándose
  solo — es Javier probándose a sí mismo. La trampa se cierra el día que el
  número quede verificado y un chofer real, sin que Javier lo asista, le
  escriba al bot por su cuenta.
- **Un cliente que no paga.** Grupo GAL y Transportes Innovativos hoy son
  exactamente esto — interés real, cero compromiso de dinero. Interés no es
  PMF; es la etapa anterior a poder medir PMF.

---

## Parte 3 — Lo que cambió hoy y el documento del 14-ago no sabía

1. **El universo es 2.7× más grande y se sale de SCIAN 484.**
   `05-Precios-y-Finanzas/universo-de-mercado.md`: 52,693 empresas con >5
   unidades entre los 7 segmentos que SICT publica (no 19,600, que era
   "orden de magnitud DENUE" de segunda mano, mal por 2.29× solo en carga).
   Encima va la flota privada, que ni siquiera está en esa tabla.

2. **La RFA 2.9 (15% de efectivo) NO aplica a flota privada — verificado
   directo en `normas/rfa-2026-2.9.yaml`.** La condición de la propia ficha:
   "Dedicados EXCLUSIVAMENTE al autotransporte terrestre de carga federal."
   Una embotelladora que reparte su propio refresco no está dedicada al
   autotransporte — está dedicada a embotellar. **Y el mismo patrón se
   repite en el estímulo de peaje** (LIF 20-A fr. V, `normas/
   lif-2026-20-A.yaml`, sección `aplicabilidad_por_segmento` agregada HOY):
   el "exclusivamente" de la fracción V también califica al CONTRIBUYENTE,
   no al vehículo, así que el 50% de peaje **tampoco** aplica a flota
   privada. **Dos piezas del motor, no una, no cubren al segmento nuevo.**

3. **El IEPS de diésel SÍ aplica a flota privada, pasajeros y turístico** —
   LIF 2026 art. 20-A fr. IV, verificado hoy contra el PDF oficial de
   diputados.gob.mx. Aquí el "exclusivamente" califica al VEHÍCULO ("vehículos
   que se destinen exclusivamente al transporte... privado"), no al
   contribuyente — un camión de reparto SÍ califica. Sobre volúmenes de
   miles de litros al mes, el IEPS es el estímulo más grande de los dos.

4. **La lectura correcta, junta:** el moat fiscal es más profundo en el
   núcleo (transportistas puros: los dos estímulos, más deducibilidad, más
   69-B, más control de viáticos) y más delgado en los anillos (flota
   privada: solo el estímulo de IEPS, sin el 15% de efectivo ni el 50% de
   peaje). **El pitch a flota privada no puede prometer lo que la propia
   ficha excluye** — sería exactamente la cifra inventada que este producto
   se prohíbe.

5. **Uvicuo no tiene licencia propia: se montó en Mastercard.** El camino
   barato — no construir una plataforma de pagos regulada desde cero, sino
   apoyarse en una red que ya existe — ya está probado por el rival directo.
   Es una lectura útil para la Parte 4: la vía fintech de Likida (§5 del
   documento anterior) no necesita reinventar esa parte tampoco.

---

## Parte 4 — Cómo se construye el moat que no existe, en orden

1. **Verificar el número de WhatsApp de Meta.** No es, en sí, una decisión
   que profundice el moat — es la precondición sin la cual ninguna de las
   otras tres corre en producción real. Mientras el chofer no le pueda
   escribir al bot, el candidato 2 (datos) nunca arranca su reloj y toda
   demo sigue siendo Javier operando a mano.
2. **Firmar y cobrar al primer cliente.** Es lo único que convierte el
   "trabajo acumulado" de la Parte 1 en algo que una mesa de diligencia
   valora. Cada mes sin esto es un mes de ventana regalada a quien decida
   copiar.
3. **Construir el escritor de `factura_emitida`/`pago_recibido`.** El
   esquema del lado ingreso ya existe (migraciones 0048-0049) pero, per
   `CLAUDE.md`, "sigue sin escritor". Sin esto, el candidato 4 (dos lados)
   sigue siendo un diseño de tablas, no un producto — y es lo que
   distingue a Likida de Uvicuo de verdad, no solo en el pitch.
4. **Conectar `normas/` como motor real, no catálogo pasivo.** Empezar por
   el hueco ya probado (`engine.ts:357`, el 15% hardcodeado en vez de leído
   de la ficha), siguiendo el patrón que `config.ts:127-129` ya usa para
   `peajeFactor`. Esto es lo que vuelve reusable el 75-76% genérico del
   motor para una segunda vertical sin reescribir código cada vez — el
   candidato 1 solo se vuelve un activo escalable, y no solo una ventaja de
   tiempo, cuando esto exista.

**Qué lo destruiría, dicho sin suavizar:**

- **Que Likida se vuelva un negocio de bajo margen sobre flujo.** Es la
  advertencia que el propio encargo puso sobre la mesa: si el modelo de
  ingreso se corre hacia comisión sobre dinero movido en vez de valor fiscal
  verificado por viaje, Likida deja de tener el perfil de margen alto (90%+
  bruto, `05-Precios-y-Finanzas`) que justifica valuarla como software y
  empieza a compararse contra fintechs de bajo margen — perdiendo
  exactamente el argumento que sostiene "esto vale más que una tarjeta".
- **Que Uvicuo (o Clara) construya validación SAT seria en H2-2026** antes
  de que la profundidad fiscal de Likida se convierta en clientes firmados
  — ya lo decía la versión anterior y sigue siendo la amenaza número uno,
  ahora con más urgencia porque el reloj lleva un día más corriendo.
- **Que el número de WhatsApp no se resuelva a tiempo.** Sin chofer
  escribiéndole al bot por su cuenta, no hay dato operativo, no hay
  candidato 2, y cada demo sigue siendo Javier sosteniendo el producto con
  las manos — la anti-señal de PMF más peligrosa de todo este documento,
  porque es la que más se parece al éxito sin serlo.

---

## Fuentes citadas en este documento

Código (`~/javiercamarapp/likida`, solo lectura): `normas/{rfa-2026-2.9,
lif-2026-20-A, cff-30}.yaml` y el resto de las 23 fichas (`ls normas/*.yaml`),
`src/lib/likida/cuadre/engine.ts:357` y `:301-394,530-601,973-1061`,
`src/lib/likida/analytics.ts:213-249` (`HechoSolo`/`getHechosSolos`),
`supabase/migrations/{0047_operacion_encargado, 0051_soporte_y_cotizacion,
0102_agente_corrida}.sql`, `src/app/api/v1/unidades/route.ts`,
`src/lib/auth/llave-api-escritura.ts`, `supabase/verificaciones.sql`
(`grep -c "^do \$"` = 74), `docs/auditoria-{3,6,8,9}/00-ESTADO-RONDA.md`,
`15-La-Feature-Definitiva/00-LA-FEATURE.md` §3 (citado, no editado),
`docs/conocimiento/{mapa-competencia-mx.md, CONFIGURAR-META.md, 32-fraude.md}`,
`CLAUDE.md` (raíz del repo). Corrida real: `npx vitest run` el 15-ago-2026 →
333 archivos, 4,549 pruebas. Paquete: `05-Precios-y-Finanzas/
universo-de-mercado.md`, `15-La-Feature-Definitiva/
todo-el-transporte-que-entra.md` §4 (censo, citado — no editado). Censo:
`~/javiercamarapp/censo-liquidacion/censo_liquidacion_indeed.xlsx`, hoja
"Estadísticas" y hoja "Señal", verificado con `openpyxl` el 15-ago-2026.
