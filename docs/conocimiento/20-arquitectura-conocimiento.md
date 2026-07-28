# Arquitectura de conocimiento del agente experto

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (`00` a `11`) y sobre `10-contradicciones.md` y `11-huecos.md` de esta misma ola.
> Este documento no repite investigación normativa: usa la que ya está verificada para diseñar la arquitectura que la sostiene en producción.

---

## Resumen para el fundador

El riesgo no es que el agente no sepa la ley. Es que la aprenda una vez y la repita para siempre, mientras la ley se mueve debajo. Ya tienes la prueba en tu propio código: `config.ts` guarda `vigenteDesde: '2026-04-24'` para el complemento de hidrocarburos citando "RMF 2.7.1.8", como si fuera un hecho fijo. Dos investigaciones independientes de este mismo paquete (ola 1 y ola 2) ya determinaron que esa fecha sigue **sin confirmar en fuente del SAT**. El código no lo sabe, porque el código no tiene ningún campo que diga "esto está verificado" o "esto vence" — solo tiene el número.

Ese es el problema de fondo, y no lo resuelve ni meter todas las leyes al contexto del modelo, ni montar una base de datos vectorial, ni preguntarle al SAT en cada mensaje de WhatsApp. Cada una falla distinto contra el problema mexicano específico: la Resolución Miscelánea Fiscal (RMF) y sus Facilidades Administrativas (RFA) se **modifican varias veces al año** (este año hubo una resolución el 9 de julio que cambió 28 reglas y 5 anexos de un jalón) y **se renumeran entre ejercicios** sin avisar con anticipación — la regla del 8% de gasto ciego era la "1.2" en 2022 y es la "2.2" desde 2025; el estímulo del diésel vivía en el "artículo 16" de la Ley de Ingresos y vive en el "artículo 20" desde 2026; las fichas de trámite se mudaron del Anexo 1-A al Anexo 2. Pero tampoco puedes asumir que TODO se renumera cada año: la propia RFA 2025→2026 no movió ni un número de porcentaje. La conclusión no es "cuidado, cambia" — es "no se puede saber sin verificar, así que hay que construir la verificación como infraestructura, no como intuición del que escribe el prompt".

La propuesta: no elegir entre corpus-en-contexto, RAG, skills y herramientas en vivo — usar cada una donde sí gana, en cuatro capas. Una **biblioteca normativa** de fichas cortas y versionadas (no las 11 investigaciones completas: un extracto por regla, con metadatos de vigencia). Un **enrutador determinístico** que carga solo las fichas del tema del gasto que se está procesando — el mismo patrón de "skill cargada por tema", aprovechando que el OCR de Likida ya clasifica el gasto en `diesel/caseta/viaticos/factura` antes de que el LLM vea nada. Un **vigilante de vigencia** que corre en segundo plano (no en el chat) y degrada el estado de una ficha en cuanto detecta que el DOF publicó algo nuevo sobre ella. Y **herramientas en vivo** reservadas solo para lo que cambia más rápido de lo que cualquier revisión periódica puede seguir: la cuota semanal de IEPS, el estatus del CFDI, la lista 69-B. Esto último ya existe parcialmente en tu código (`intake/sat.ts`) — hay que generalizar el patrón, no inventarlo.

La pieza que falta y que no es opcional: prohibir que el modelo escriba de memoria un número de artículo o de regla. Todo fundamento que sale al contralor tiene que venir de una ficha con un `id`, devuelta por una herramienta en ese mismo turno — exactamente como ya haces con las cifras de dinero en `guardia.ts`, que reemplaza lo que narra el modelo por el cálculo determinístico del motor. Aquí se hace lo mismo pero con la cita legal en vez del peso y centavo.

---

## 1. Por qué la cita se pudre sin avisar (evidencia, no intuición)

### 1.1 Se renumera entre ejercicios — con ejemplos reales, no hipotéticos

`03-isr-facilidades.md` §7.1 comparó el texto íntegro del Título 2 de la RFA 2025 (DOF 17-feb-2025) contra la RFA 2026 (DOF 17-feb-2026), línea por línea. Lo que cambió:

| Qué | Antes | Ahora | Ejercicio del cambio |
|---|---|---|---|
| Ficha de trámite del 8% ciego | 71/CFF, **Anexo 1-A** | 28/CFF, **Anexo 2** | 2026 |
| Ficha del estímulo LIF | 3/LIF, **Anexo 1-A** | 2/LIF, **Anexo 2** | 2026 |
| Artículo del estímulo de diésel/casetas en la LIF | **art. 16**, apartado A | **art. 20**, apartado A | 2026 (nueva LIF, DOF 07-nov-2025) |
| Número de la regla del 8% de gasto ciego | **1.2** (RFA 2022) | **2.2** (RFA 2025 y 2026) | entre 2022 y 2025 |
| Anexo de fichas de trámite en general | **1-A** | **2** | 2026 |

Y en la otra dirección, la misma comparación línea por línea encontró que los **porcentajes no cambiaron ni una vez** entre 2022 y 2026: 8%, $1,000,000, 16%, 15%, 7.5%, 300 MDP, factor 0.5. Esto es lo que hace al problema difícil de resolver con una regla simple tipo "revisa todo cada enero": **el número que importa para el cálculo (el porcentaje) es estable; el número que importa para la cita (la regla, la ficha, el anexo) no lo es**, y no hay forma de saber cuál de los dos se movió sin leer el texto completo cada vez.

*(Fuente primaria de ambas tablas: `03-isr-facilidades.md` §7.1–7.2, que a su vez cita RFA 2025 DOF 17-feb-2025 y RFA 2026 DOF 17-feb-2026, leídas íntegras.)*

### 1.2 También se mueve DENTRO del mismo ejercicio, varias veces

No basta con revisar una vez al año. La **Primera Resolución de Modificaciones a la RMF 2026** (DOF 09-jul-2026) reformó **28 reglas**, adicionó **5** y derogó **1**, y tocó **7 anexos** (1, 2, 3, 9, 14, 15, 21, 22 y 29) en un solo instrumento publicado a mitad de año — verificado por `10-contradicciones.md` §2 contra el resolutivo PRIMERO íntegro descargado del sitio del SAT. Dentro de esa modificación:

- Se **adicionó** la regla **11.7.3** ("Cálculo del precio base del diésel"), con 13 fechas de ajuste no regulares (saltos de 6, 7 y 9 días) y **retroactiva al 1-abr-2026** por su propio Transitorio Sexto — o sea, una regla publicada el 9 de julio que cambia cómo se calculaba un estímulo tres meses atrás.
- Se **reformó** el primer párrafo de la regla **2.7.1.48** (complemento de hidrocarburos), y el cambio **amplió** el universo de obligados sin que el número de la regla cambiara — el mismo identificador, contenido distinto. Es el caso más peligroso para cualquier arquitectura que solo indexe "¿la regla 2.7.1.48 sigue existiendo?": sigue existiendo, con el mismo número, pero dice algo diferente.

*(Fuente: `10-contradicciones.md` §2–4, `11-huecos.md` §2.4, ambos citando la Primera Resolución de Modificaciones, DOF 09-jul-2026, https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf)*

### 1.3 Ya está pasando dentro de tu propio código, hoy

`src/lib/cuadra/config.ts` línea 87:

```ts
hidrocarburos: {
  claves: ['15101505', '15101514', '15101515'],
  unidad: 'LTR',
  vigenteDesde: '2026-04-24', // vigencia del complemento v1.0 (DOF, RMF 2.7.1.8)
},
```

Esa fecha (24-abr-2026) es exactamente el dato que `00-RESUMEN-EJECUTIVO.md` marca como **Pendiente bloqueante #2** ("fecha exacta de publicación del Complemento Concepto de Hidrocarburos en el Portal del SAT — sigue sin confirmarse en fuente SAT") y que `11-huecos.md` §2.4 reconfirma como **abierto** después de leer la regla 2.7.1.48 reformada el 09-jul-2026 (sigue redactada en futuro: "que al efecto publique el SAT en su Portal"). El código no tiene ningún campo `estado_verificacion`. Cita un número de regla en un comentario (`2.7.1.8`) que no es el mismo que sostiene la obligación en el resto del paquete (`2.7.1.48` es la que documentan `05-hidrocarburos.md`, `10-contradicciones.md` y `11-huecos.md` como la operativa; `2.7.1.8` aparece en la ola 2 solo como la regla del **mecanismo transitorio** de "30 días tras publicación en Portal", un concepto relacionado pero distinto). Es exactamente el tipo de ambigüedad que un fiscalista detecta en dos clics, y hoy vive sin ninguna marca de advertencia en producción.

**Esto no es una crítica al código: es la prueba de que el problema es real y ya está adentro, no un riesgo futuro.**

### 1.4 El propio paquete de conocimiento se equivocó de la misma forma — y eso es la evidencia más fuerte

Si investigadores humanos con acceso a fuente primaria y presión de verificación cometieron este error, un agente sin arquitectura de citas lo va a cometer con más frecuencia, no con menos:

- **`00-RESUMEN-EJECUTIVO.md`** marcó como "Pendiente bloqueante #1" (sin criterio del SAT que confirme la cuota disminuida de IEPS) algo que **ya estaba resuelto dentro del mismo paquete**: el criterio **1/LIF/PI** del Anexo 3 (DOF 09-ene-2026), citado en `03-isr-facilidades.md` §6.1, dice exactamente eso. El resumen ejecutivo adoptó la versión de un archivo (`04`) sin cruzarla contra otro (`03`) que ya traía la respuesta. (`10-contradicciones.md` §1)
- **`09-liquidacion.md`** afirmó, marcado literalmente como **"Verificado"**, que la Primera Resolución de Modificaciones "solo modificó las reglas 2.7.1.48 y 2.7.5.8". Modificó 28. La palabra "Verificado" no evitó el error porque no había ningún mecanismo que forzara re-verificación contra el texto completo del instrumento. (`10-contradicciones.md` §2)
- **`05-hidrocarburos.md`** citó el fundamento del estímulo de diésel como "LIF 2026 art. 16-A-IV" en **tres lugares distintos** del mismo archivo, incluyendo uno donde transcribe el texto **correcto** bajo el número de artículo **equivocado** — el peor caso posible, porque parece una cita fabricada aunque no lo es. (`10-contradicciones.md` §10)

Ninguno de los tres es un error de conocimiento. Los tres son errores de **falta de verificación cruzada obligatoria en el momento de citar**. Eso es exactamente lo que una arquitectura tiene que automatizar, porque no se resuelve pidiéndole al agente "ten más cuidado".

---

## 2. La jerarquía normativa como campo de datos, no como buen juicio

La instrucción de la ola ("LEY ≠ FACILIDAD ADMINISTRATIVA ≠ POLÍTICA INTERNA") no es un recordatorio de estilo: es un requisito de esquema. Si la jerarquía no es un campo que el motor pueda leer, tarde o temprano el motor va a tratar la política de un portal de facturación como si tuviera la misma fuerza que una ley, o va a presentarle a un contralor un criterio no vinculativo como si fuera obligatorio.

### 2.1 La jerarquía verificada, de arriba hacia abajo

1. **Constitución** (no aparece en el paquete de Likida; se asume).
2. **Ley** — LISR, LIVA, LIEPS, CFF, LFT, LCPAF. Crea la obligación; es lo único que puede fijar sujeto, objeto, base, tasa o tarifa.
3. **Reglamento** — RLISR, RCFF. Desarrolla la ley sin poder exceder su alcance.
4. **Regla general (RMF/RFA)** — creada por facultad expresa del **CFF art. 33, fracción I, inciso g)**, texto vigente (verificado, diputados.gob.mx, consultado 27-jul-2026):

   > *"Publicar anualmente las resoluciones dictadas por las autoridades fiscales que establezcan disposiciones de carácter general [...] Las resoluciones que se emitan conforme a este inciso y que se refieran a sujeto, objeto, base, tasa o tarifa, **no generarán obligaciones o cargas adicionales a las establecidas en las propias leyes fiscales**."*

   Esto no es interpretación: es el límite constitucional explícito de lo que la RMF y la RFA pueden hacer. La tesis del Pleno de la SCJN **P. LV/2004** (citada por vlex.com.mx sobre el mismo artículo, verificada por su reproducción textual) lo confirma con dos restricciones concretas para el **principio de reserva de ley**: (1) la ley debe remitir expresamente a la RMF, y (2) la regla de RMF **no puede superar los alcances** de la ley que pretende regular. Consecuencia de diseño: cuando una ficha de norma tipo `RMF`/`RFA` parezca decir algo que la ley no dice, el motor debe marcarlo como sospechoso, no como autoritativo — puede ser un error de captura o puede ser una regla que de hecho excede su facultad (litigable).
5. **Anexos** — fichas de trámite, catálogos técnicos (Anexo 20, CCP 3.1), tarifas (Anexo 8), cantidades actualizadas (Anexo 5). Fuerza normativa de lo que reglamentan, pero cambian de número de anexo más seguido que las reglas mismas (Anexo 1-A → Anexo 2 en 2026).
6. **Criterios no vinculativos** — Anexo 3 (74 criterios verificados por `10-contradicciones.md` §11: 4 del CFF, 44 de ISR, 12 de IVA, 5 de IEPS, 6 de LFD, 2 de LISH, 1 de LIF). Su nombre lo dice: **no obligan al contribuyente**. Marcan lo que el SAT considera "práctica indebida" — información de riesgo de auditoría, no obligación legal. Presentarlos con la misma fuerza que una ley es el error de jerarquía más caro que el motor puede cometer, porque además la cláusula "quien asesore, aconseje, preste servicios o participe" de estos criterios **alcanza a Likida directamente** (`00-RESUMEN-EJECUTIVO.md`, "regla transversal").
7. **Política interna de un tercero** (portal de facturación, TAG, monedero) — cero fuerza legal. El "72 horas para facturar" de G500 o el "48 horas" de ARCO Sonora (`config.ts`, array `portales`) son plazos comerciales de la estación, no un plazo fiscal. `00-INDICE.md` ya lo señala: "no existe ese plazo [30 o 60 días]; el plazo real es el ejercicio fiscal".

### 2.2 El hueco concreto en el código de hoy

`config.ts` define `estimulos` (fundamento: LIF y LISR — **ley**), `hidrocarburos` (fundamento: RMF — **regla general**) y `portales: PortalFacturacion[]` (fundamento: **ninguno, es política de un tercero**) como tres campos del mismo tipo `CuadraConfig`, sin ningún campo que distinga su jerarquía. Un desarrollador nuevo — o un LLM generando texto para el contralor — no tiene, mirando el tipo, ninguna señal de que `estimulos.efectivoTopeMxn` es ley dura y `portales[].plazoHoras` es un plazo que la gasolinera puede cambiar mañana sin avisarle a nadie. Es el mismo tipo de hueco que el CFF art. 5 (verificado, diputados.gob.mx) obliga a cerrar del lado legal:

> *"Las disposiciones fiscales que establezcan cargas a los particulares [...] son de aplicación estricta. Se considera que establecen cargas a los particulares las normas que se refieren al sujeto, objeto, base, tasa o tarifa."*

Aplicación estricta significa texto verbatim, no parafraseado, y con su nivel exacto de obligatoriedad visible. Eso solo se puede automatizar si la jerarquía es un campo, no una nota mental.

---

## 3. Comparación de las cuatro arquitecturas contra el problema mexicano específico

| Arquitectura | Qué pasa con la renumeración anual | Qué pasa con "no alucine el artículo" | Costo/latencia | Cuándo gana |
|---|---|---|---|---|
| **Corpus completo en contexto** (meter los 11 archivos, o las leyes crudas, en el system prompt) | No falla por el corpus en sí — falla porque nada dentro de un bloque de texto fuerza una re-verificación cruzada antes de citar. Es exactamente lo que le pasó a `00-RESUMEN-EJECUTIVO.md`: tenía la respuesta correcta en el mismo corpus (`03`) y usó la incorrecta (`04`) porque nada obligaba a cruzar los dos. | El modelo sigue generando el número de memoria a partir de lo que leyó, con el mismo riesgo de transcripción que un humano cansado. `guardia.ts` ya documenta este riesgo para cifras de dinero ("el LLM pudo transcribir mal un número al narrarlo"); aplica igual a un número de regla. | Alto en tokens por turno (los 11 archivos suman ~700KB; incluso resúmenes de 40-90KB cada uno). Nada de esto se amortiza porque un viaje de WhatsApp normalmente solo necesita 3-5 reglas, no 74 criterios. | Para que un humano audite el corpus completo antes de una decisión de producto — no para servir un turno de chat. |
| **RAG sobre documentos** (embeddings + búsqueda vectorial sobre PDFs del SAT/DOF o sobre los `.md` de ola 1) | Un vector no sabe de vigencia. Si se indexa la RFA 2025 y la RFA 2026 juntas, la pregunta "¿cuál es el tope del 8%?" recupera ambas con score casi idéntico porque el texto es casi idéntico (`03-isr-facilidades.md` §7.1 documentó que el único cambio real entre ambas fue de fecha y de número de ficha, no de contenido semántico) — nada en la similitud de embeddings distingue "vigente" de "derogada". Tampoco resuelve que la regla 2.7.1.48 cambió de alcance sin cambiar de número: el chunk sigue siendo recuperable con el mismo score antes y después de la reforma del 09-jul-2026, salvo que alguien reindexe a mano. | Mejora la exactitud de la cita **si** el chunk correcto se recupera, pero el riesgo de recuperar el chunk *casi* correcto (misma regla, versión vieja; o regla vecina, mismo tema) es justo lo que produce una cita con apariencia de autoridad y contenido derogado — el peor tipo de alucinación porque no se ve como alucinación. | Medio-alto: requiere pipeline de ingesta, embeddings, base vectorial (hoy `package.json` de cuadra no tiene ninguna librería de vectores — no hay pgvector ni SDK de embeddings instalado; se construiría desde cero). | Cuando el corpus normativo es grande y no está pre-clasificado (miles de documentos heterogéneos). No es el caso de Likida: el dominio ya cabe en 11 temas conocidos. |
| **Skills cargadas por tema** (paquete de fichas normativas que se activa según el tipo de gasto/tema del turno) | No resuelve la renumeración por sí sola — una skill fija que nadie actualiza envejece igual que un corpus fijo. Pero **acota el radio de daño**: si la skill de "hidrocarburos" queda desactualizada, solo afecta gastos de combustible, no los 74 criterios completos. Y una skill se puede versionar y forzar su revisión con una fecha de caducidad explícita, cosa que un corpus libre no tiene. | Si cada skill trae sus fichas con `id` y texto verbatim (no prosa libre), el modelo tiene menos superficie para inventar, porque solo ve las 3-8 fichas relevantes al tema, no 90KB de contexto de los que "recordar" un número. | Bajo: la clasificación por tema ya existe en el pipeline de Likida (el `concepto` del gasto — diesel/caseta/viáticos/factura — lo produce el OCR antes de que el LLM entre). Cargar la skill correcta es una consulta indexada, no una búsqueda semántica. | Es la arquitectura de base para Likida: el dominio ya está pre-taxonomizado (Grupo A/B, 11 temas de ola 1, tipos de concepto ya clasificados por el pipeline). |
| **Herramientas que consultan la fuente en vivo** (llamar al SAT/DOF en el momento) | Es la única capa que nunca miente sobre HOY — no hay copia local que envejecer. Pero el DOF y el SAT no exponen "dame la regla vigente para la fecha X": son PDF de prosa (el índice diario del DOF y `pdftotext` sí funcionan, verificado por `11-huecos.md` §"Nota de método", pero no es una API de consulta estructurada) o portales SPA que devuelven 403 (`00-RESUMEN-EJECUTIVO.md`, riesgos de dependencia). | Máxima fidelidad de la fuente, pero cero garantía de que el modelo interprete bien un PDF de 30 páginas en el momento — y es demasiado lento para un turno de WhatsApp. El propio `intake/sat.ts` ya asume esto: timeout de 4 segundos y **fail-open a "pendiente"** si el SAT no contesta a tiempo, precisamente porque no se puede bloquear la conversación esperando a la fuente. | Alto en latencia por turno si se hace síncrono; bajo en costo de mantenimiento si se hace asíncrono (job en segundo plano). | Para los pocos datos que cambian más rápido que cualquier ciclo de revisión razonable: la cuota semanal de IEPS (varió de $7.3634 a $2.0925 en 5 meses), el estatus de un CFDI específico, la lista 69-B, el padrón mensual de la CNE. |

**Conclusión de la comparación:** ninguna arquitectura sola resuelve el problema mexicano. Corpus-en-contexto y RAG comparten la misma falla de fondo — ninguna tiene un concepto nativo de "vigente a partir de" ni de "esto lo deroga". Skills-por-tema resuelve el enrutamiento pero no la frescura. Herramientas en vivo resuelven la frescura pero no caben en la latencia de un chat ni existen como API estructurada para todo. La arquitectura tiene que combinar las cuatro, cada una en la capa donde gana.

---

## 4. La arquitectura concreta para Likida: cuatro capas

```
Capa 0 — BIBLIOTECA NORMATIVA
  Fichas cortas, una por norma, versionadas en git. Fuente de verdad.
  (sustituye "el modelo recuerda la ley" por "el modelo busca la ficha")
        │
        ▼
Capa 1 — ENRUTADOR DETERMINÍSTICO (el "skill" del dominio fiscal)
  concepto del gasto (ya clasificado por el OCR) → set de fichas relevantes.
  Sin embeddings. Una tabla de mapeo mantenida a mano, como se hizo con
  Grupo A / Grupo B en el modelo de datos.
        │
        ▼
Capa 2 — VIGILANTE DE VIGENCIA (el "tool en vivo", pero en segundo plano)
  Job periódico: lee el índice diario del DOF + las páginas de anexos del SAT,
  compara contra el hash de cada ficha, y si detecta cambio degrada su
  estado_verificacion a "revisar". NO bloquea conversaciones — corre aparte.
        │
        ▼
Capa 3 — HERRAMIENTAS EN VIVO DE VERDAD (síncronas, dentro del turno)
  Solo para lo que cambia más rápido que cualquier revisión periódica:
  validador de CFDI (ya existe: intake/sat.ts), cuota semanal de IEPS,
  lista 69-B, padrón mensual CNE.
        │
        ▼
Capa 4 — CONVERSACIÓN
  El LLM nunca ve el corpus completo ni el PDF crudo. Solo ve las fichas que
  la Capa 1 ya filtró, con id + texto verbatim + estado_verificacion.
  El LLM NUNCA escribe un número de artículo de memoria: solo referencia un
  id de ficha, y el servidor sustituye el texto real (igual que guardia.ts
  ya reemplaza las cifras que el modelo narra mal).
```

### Por qué esto y no menos

- **Capa 0 no es una base de datos vectorial ni un ORM el día 1.** Es una carpeta `normas/` con un archivo por regla, en el mismo repo, revisable en un `git diff` por un fiscalista sin que tenga que aprender SQL. Se promueve a tabla de Supabase cuando el volumen lo justifique — no antes, porque construir infraestructura de base de datos antes de tener ni una ficha cargada es exactamente el tipo de sobre-ingeniería que retrasa la demo del 6-ago.
- **Capa 1 reusa lo que ya existe.** El pipeline de Likida ya clasifica cada gasto en un concepto (`diesel`, `caseta`, `viaticos`, `factura` — visto en `config.ts`, `politica: PoliticaGasto[]`). Convertir eso en un enrutador a fichas normativas es una tabla de mapeo `concepto → [norma_id, norma_id, ...]`, no un sistema nuevo. Esto es literalmente el patrón "skill cargada por tema" — Claude Code carga la skill correcta según lo que hay que hacer; aquí se carga el paquete normativo correcto según qué tipo de gasto se está evaluando.
- **Capa 2 es la que hoy no existe y es la más urgente.** `11-huecos.md` demostró que `curl` directo a `dof.gob.mx` y `diputados.gob.mx` responde 200 a peticiones automatizadas, y que `pdftotext -layout` (ya instalado en el entorno de desarrollo) extrae el texto completo de cualquier PDF del DOF o de una ley en segundos. Es decir: **el método ya está probado, dos veces, por dos investigaciones distintas de esta misma ola.** Falta envolverlo en un job que corra con regularidad (semanal es razonable dado que hubo una Resolución de Modificaciones en julio; ver SIN VERIFICAR sobre la cadencia histórica) y que escriba el resultado como degradación de estado, no como alarma que nadie lee.
- **Capa 3 ya tiene un ejemplo funcionando.** `intake/sat.ts` es exactamente el patrón correcto: sin credenciales, con timeout corto, fail-open a un estado neutral ("pendiente") en vez de bloquear o inventar. El mismo patrón hay que replicarlo para la cuota semanal de IEPS (que hoy no tiene ningún ingestor, y es "la pieza de mayor valor técnico del paquete" según `00-RESUMEN-EJECUTIVO.md` §2) y para el padrón mensual de la CNE.
- **Capa 4 es donde se fuerza la disciplina de cita** — ver §6.

---

## 5. El formato exacto de cada ficha de norma

Cada norma vive en su propio archivo (`normas/<id>.yaml` o fila de tabla, mismo esquema). Campos obligatorios:

```yaml
id: rmf-2026-2.7.1.48                 # estable dentro del ejercicio; ver historial para cambios de número
tipo: regla_general                   # ley | reglamento | regla_general | rfa | anexo | criterio_no_vinculativo | norma_estatal | nom | politica_comercio
jerarquia: 4                          # 1=ley, 2=reglamento, 3=RMF/RFA, 4=anexo, 5=criterio no vinculativo, 6=política de tercero
                                       # (2.7.1.48 es "regla_general" y jerarquía 3; se usa 4 aquí solo de ejemplo de anexo — ajustar por caso real)
instrumento: "Resolución Miscelánea Fiscal para 2026"
articulo_o_regla: "2.7.1.48"
fraccion: null
texto_vigente: >
  Para los efectos de los artículos 29 y 29-A del CFF, los contribuyentes que
  enajenen gasolinas y diésel a que hace referencia la regla 2.6.1.1., fracción II,
  deben incorporar en el CFDI que se emita, el "Complemento Concepto para la
  facturación de Hidrocarburos y Petrolíferos", que al efecto publique el SAT
  en su Portal.
fecha_publicacion: 2026-07-09          # DOF de la Primera Resolución de Modificaciones
fecha_vigencia_desde: null             # SIN CONFIRMAR — ver estado_verificacion
fecha_vigencia_hasta: null             # null = vigente hasta nuevo aviso
deroga_a: null
derogada_por: null
version_anterior: rmf-2026-2.7.1.48-v0 # la redacción previa a la reforma del 09-jul-2026
fuente_url: "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf"
fuente_tipo: dof_oficial               # dof_oficial | sat_oficial | diputados_oficial | fuente_secundaria
estado_verificacion: evidencia_corroborante  # verificado_fuente_primaria | evidencia_corroborante | sin_verificar | contradicho
nota_verificacion: >
  La fecha exacta de exigibilidad (correlacionada con 24-abr-2026 en config.ts)
  NO está confirmada en el Portal del SAT. La regla, reformada el 09-jul-2026,
  sigue redactada en futuro ("que al efecto publique el SAT"). Ver 11-huecos.md §2.4.
verificado_por: "ola2 / 11-huecos.md, 10-contradicciones.md"
verificado_el: 2026-07-27
usado_en_codigo: ["config.ts:hidrocarburos.vigenteDesde", "cuadre/engine.ts:181"]
```

Ejemplo de **historial de renumeración** (la parte que resuelve el problema del encargo), usando la regla del 8% de gasto ciego:

```yaml
id: rfa-2026-2.2
articulo_o_regla: "2.2"
version_anterior: rfa-2022-1.2         # mismo contenido normativo, número distinto, ejercicio distinto
cambio_de_numero: true
nota_renumeracion: >
  Regla "1.2" en la RFA 2022 (DOF 14-abr-2022). Renumerada a "2.2" a más
  tardar en la RFA 2025 (DOF 17-feb-2025) y se mantiene en RFA 2026
  (DOF 17-feb-2026). El contenido (8%, tope $1,000,000, 16% definitivo)
  no cambió en esa renumeración. Verificado: 03-isr-facilidades.md §7.2.
```

Ejemplo de **ficha de política de tercero** (jerarquía 6, cero fuerza legal — para que el motor nunca la confunda con una obligación fiscal):

```yaml
id: politica-g500-plazo-facturacion
tipo: politica_comercio
jerarquia: 6
instrumento: "Portal de facturación G500 (g500network.com)"
texto_vigente: "Plazo de facturación: 72 horas desde la compra."
fuente_url: "https://www.g500network.com"
fuente_tipo: fuente_secundaria
estado_verificacion: verificado_fuente_primaria   # verificado contra el portal, NO contra ley
nota_verificacion: >
  Este plazo es política comercial de la estación. NO existe plazo fiscal
  equivalente (CFF 29; LISR 27 fr. XVIII). Nunca presentar como obligación legal.
usado_en_codigo: ["config.ts:portales[0]"]
```

**El campo que hace el trabajo pesado es `estado_verificacion`.** Reutiliza exactamente el vocabulario que el equipo humano ya usa a mano en los archivos de ola 1 y ola 2 ("SIN VERIFICAR", "evidencia corroborante, no prueba", "no lo dictaminé"): no hay que inventar una taxonomía nueva, hay que formalizar la que ya funciona. Una ficha con `estado_verificacion: sin_verificar` o `contradicho` **no puede citarse frente a un cliente** sin una marca visible — la Capa 4 lo hace cumplir (§6).

---

## 6. Cómo se fuerza la cita de fundamento

El principio: **el modelo nunca teclea un número de artículo o de regla.** Solo puede referenciar el `id` de una ficha que una herramienta le devolvió en ese mismo turno. El texto que llega al contralor no lo escribe el modelo — lo sustituye el servidor, verbatim, desde la Capa 0. Esto es la misma arquitectura que `guardia.ts` ya usa para las cifras de dinero, aplicada al fundamento legal:

```
guardiaCifras(reply, toolCalls)        // YA EXISTE — cifras de dinero
  → si hay cifras y no vienen de cuadrar_viaje/consultar_politica,
    se reemplazan por el resultado determinístico del motor.

guardiaFundamento(reply, toolCalls)    // PROPUESTO — mismo patrón, para citas legales
  → si el texto contiene un patrón de cita (número de artículo, "regla",
    "RMF", "LISR", "CFF", etc.) y ese número NO corresponde a un norma_id
    devuelto por consultar_normativa() en ese turno, se rechaza la cita:
    se sustituye por el texto verbatim de la ficha, o si no se llamó
    ninguna ficha, se elimina la afirmación y se marca como "por verificar".
  → FAIL-CLOSED: ante la duda, no se cita nada antes que citar mal.
```

Y el veredicto que el motor produce (extensión natural del `AccionFoto`/`Liquidacion` ya tipados en el repo) debe forzar la referencia, no permitir texto libre:

```ts
interface VeredictoFiscal {
  veredicto: 'deducible' | 'no_deducible' | 'requiere_revision' | 'sin_criterio';
  fundamento: {
    norma_id: string;               // FK a la Capa 0 — nunca texto libre
    // articulo_o_regla, texto_vigente, jerarquia se resuelven server-side
    // desde norma_id; el modelo NO los genera.
  }[];
  confianza: 'verificado_fuente_primaria' | 'evidencia_corroborante' | 'interpretacion_sin_criterio';
}
```

Dos reglas duras adicionales que se derivan de §2 y que el esquema tiene que exigir:

1. **Ningún `fundamento` con `jerarquia >= 5` (criterio no vinculativo) puede presentarse como obligación.** El texto de salida al contralor debe traer la coletilla de riesgo ("el SAT considera esto práctica indebida; no es una obligación legal, es una señal de auditoría"), tomada del propio criterio, no inventada por el modelo.
2. **Ningún `fundamento` con `estado_verificacion: sin_verificar` o `contradicho` puede salir en un documento que se le entregue a un cliente** (liquidación, cotización, respuesta de WhatsApp con cifra fiscal). Puede citarse internamente para el equipo de Likida, siempre con la marca visible.

---

## 7. Qué hace el agente cuando la norma no cubre el caso

El paquete de ola 1 y ola 2 ya documentó, con fuente primaria leída, varios casos reales donde la ley **no dice** lo que hace falta que diga:

- Si el tope de $1,000,000 de la regla 2.2 es por integrante o por coordinado (`03-isr-facilidades.md`, pendiente #7): "ningún texto lo dice expresamente".
- Si el 8% ciego reduce o no la base de PTU (`03`, pendiente #8): "no hay criterio ni regla".
- Cómo se mide en el tiempo el 90% de exclusividad del art. 72 LISR (`03`, pendiente #10): "la ley no lo precisa".
- La metodología exacta del radio de 30 km de Carta Porte (`02-carta-porte.md`, pendiente #13): "no define si es geodésica, desde qué punto, ni cómo se prueba".
- La faja de 50 km aplicada a un operador de largo recorrido (`03`, pendiente #15): "el RLISR 57 define 'establecimiento' [...] para un operador eso es discutible. Sin criterio del SAT ni tesis."

Estos no son huecos de investigación que "algún día se cierran". Son huecos **de la ley misma**, y van a seguir apareciendo con clientes reales, en situaciones que ninguna de las 11 investigaciones anticipó. La arquitectura tiene que tratarlos como un estado de primera clase, no como un error:

- **`veredicto: 'sin_criterio'` es una respuesta válida y esperada**, no una falla del sistema. El agente la produce cuando la Capa 1 no encuentra ninguna ficha con `estado_verificacion: verificado_fuente_primaria` que cubra el caso exacto, y ninguna ficha `evidencia_corroborante` con margen razonable.
- **Nunca extrapolar en silencio.** Si el agente aplica una regla por analogía (p. ej., tratar la faja de 50 km de un operador de base fija como si aplicara igual a uno de largo recorrido), tiene que marcarlo explícitamente como interpretación propia, con `confianza: interpretacion_sin_criterio`, nunca mezclado con una cita de `verificado_fuente_primaria`.
- **Enrutar a la bandeja de excepciones del contralor, no decidir solo.** Esto no es una preferencia de diseño: `00-RESUMEN-EJECUTIVO.md` §10 ya estableció que la LFPDPPP art. 26 fr. II (DOF 20-mar-2025) exige un humano en el loop para cualquier decisión automatizada con efecto significativo sobre una persona, y que el copy correcto es "el sistema prepara y marca; el contralor decide". Un `sin_criterio` sin revisión humana antes de comunicarse al cliente incumple esa obligación, no solo es una mala práctica de producto.
- **El costo de un falso "sin_criterio" es bajo; el costo de un falso "deducible" es alto.** Por eso el sesgo del sistema debe ser fail-closed hacia `sin_criterio`/`requiere_revision`, igual que `guardia.ts` ya hace fail-closed hacia "dame un momento" en vez de arriesgar una cifra inventada.

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Crear `normas/` con una ficha por cada cita que YA vive en el código (`config.ts`, `engine.ts`, `sat.ts`): ~10-15 fichas para empezar (2.7.1.48, 20-A-IV, 20-A-V, 27-III, 28-V, 29/29-A, 2.7.1.12, 2.2, 2.9, 1/LIF/PI) | Es el hueco más barato de cerrar y el que más riesgo quita: hoy esas citas son strings sin metadatos de vigencia | Bajo | Antes de la demo del 6-ago |
| Corregir o marcar `SIN VERIFICAR` visible el comentario de `config.ts:87` (`vigenteDesde` / "RMF 2.7.1.8") citando la ficha correspondiente y su `estado_verificacion: evidencia_corroborante` | Es el ejemplo real de cita frágil en producción que este documento usa como caso de estudio; dejarlo tal cual después de haberlo encontrado sería peor que no haberlo encontrado | Bajo | Ya |
| Añadir un campo `jerarquia` (o al menos `fundamento_legal: 'ley' \| 'facilidad' \| 'politica_comercio'`) al tipo `CuadraConfig`, empezando por separar `estimulos`/`hidrocarburos` (ley/RMF) de `portales` (política de tercero) | Hoy los tres viven en el mismo tipo sin ninguna señal de jerarquía; es la causa raíz de que una promesa de producto pueda tratar un plazo de portal como si fuera plazo fiscal | Bajo | Fase 1 |
| Construir el vigilante de vigencia (Capa 2) como job periódico con `curl` + `pdftotext -layout` contra el índice diario del DOF y las páginas de anexos del SAT | El método ya está probado dos veces por investigaciones independientes de esta ola (`10-contradicciones.md`, `11-huecos.md`); falta envolverlo en un cron, no inventarlo | Medio | Fase 1–2, antes del primer cliente |
| Extender `guardiaCifras()` a `guardiaFundamento()` con el mismo patrón fail-closed, bloqueando cualquier número de artículo/regla en la respuesta del modelo que no venga de un `norma_id` devuelto por una tool en ese turno | Es la única forma de que "no alucine el artículo" sea una garantía de arquitectura y no una esperanza sobre el prompt | Medio | Fase 1, junto con el motor de veredictos |
| Definir `VeredictoFiscal` con `fundamento: { norma_id }[]` (referencia, no texto libre) como tipo compartido entre el motor de reglas y la capa de conversación | Cierra la puerta a que el modelo narre un artículo de memoria aunque la ficha correcta exista en la Capa 0 | Bajo | Fase 1 |
| Agregar el estado `sin_criterio` / `requiere_revision` al esquema de veredicto, con enrutamiento obligatorio a la bandeja de excepciones del contralor | Ya documentado como obligación legal (LFPDPPP 26-II) y como los 5+ huecos reales de ola 1/ola 2 que no tienen criterio publicado | Bajo | Fase 1 |
| Construir el ingestor de la cuota semanal de IEPS como herramienta en vivo (Capa 3), replicando el patrón de `intake/sat.ts` (timeout corto, fail-open a "pendiente") | Es el dato que cambia más rápido de todo el paquete (3.5x en 5 meses) y hoy no tiene ningún ingestor | Medio | Fase 2, ya priorizado por `00-RESUMEN-EJECUTIVO.md` |
| No construir RAG vectorial para este dominio en esta etapa | El corpus normativo de Likida cabe en ~11 temas pre-clasificados; RAG añade infraestructura (no existe hoy en `package.json`) y un modo de falla nuevo (recuperar la versión derogada con score alto) sin resolver el problema de vigencia que sí resuelve la Capa 0+2 | — (decisión de NO construir) | Ya |

---

## CONFLICTOS

**CONFLICTO 1 — el código de producción ya contradice el estado de verificación que el propio paquete de conocimiento estableció.** `config.ts:87` cita `vigenteDesde: '2026-04-24'` como si fuera un hecho cerrado. `00-RESUMEN-EJECUTIVO.md` (Pendiente bloqueante #2) y `11-huecos.md` §2.4 (independientemente, en ola 2) coinciden en que esa fecha **sigue sin confirmar en fuente del SAT**. No es un conflicto entre dos documentos de investigación — es un conflicto entre el código que ya corre y el conocimiento verificado que debería gobernarlo. Ver Acciones concretas, fila 2.

**CONFLICTO 2 (menor, de secuencia) — el orden de construcción de `00-RESUMEN-EJECUTIVO.md` no incluye una etapa explícita para la biblioteca normativa.** La "Fase 1" del resumen ejecutivo pone el modelo de datos (#5) y el motor de reglas con veredictos (#6) antes que cualquier mención de dónde vive el fundamento citable. Esta arquitectura no contradice esa secuencia, pero le agrega un prerrequisito silencioso: el motor de reglas del punto #6 no puede citar fundamento de forma confiable si la Capa 0 (§4 de este documento) no existe primero, aunque sea en su versión mínima de ~10 fichas. No es una contradicción de hechos, es una dependencia que el plan original no hizo explícita.

---

## SIN VERIFICAR

1. **Cadencia histórica de modificaciones a la RMF en años anteriores a 2026.** Solo se confirmó que la RMF 2026 tuvo al menos una Resolución de Modificaciones a julio (28 reglas). No se verificó cuántas resoluciones de modificación tuvieron la RMF 2023, 2024 o 2025 en total durante su ejercicio, dato que serviría para calibrar la frecuencia óptima del vigilante de vigencia (Capa 2) con evidencia en vez de estimación.
2. **Si el DOF o el SAT exponen algún mecanismo de suscripción (RSS, webhook, API) para publicaciones nuevas**, en vez de depender de leer el índice diario. No se investigó; de existir, abarataría la Capa 2 significativamente.
3. **Texto exacto del CFF art. 35** sobre criterios internos del SAT que vinculan a sus propias autoridades pero no al contribuyente. Se usó el criterio del Anexo 3 (no vinculativo, ya verificado por ola 1 y ola 2) como base de la jerarquía §2.1, pero no se leyó el art. 35 directamente esta sesión — la distinción entre "criterio normativo" (interno, vincula funcionarios) y "criterio no vinculativo" (Anexo 3, señala prácticas indebidas) puede tener matices adicionales que un fiscalista debería confirmar antes de fijar el campo `tipo` en el esquema de la Capa 0.
4. **Costo real de operación del vigilante de vigencia** (frecuencia semanal vs. mensual, volumen de fichas a revisar) — no se dimensionó; se recomienda instrumentarlo y medir antes de fijar la cadencia.
5. La fecha de exigibilidad del Complemento de Hidrocarburos (24-abr-2026) y el criterio exacto sobre la cuota disminuida de IEPS **siguen abiertos** — se heredan de `00-RESUMEN-EJECUTIVO.md`, `10-contradicciones.md` y `11-huecos.md`; este documento no los investiga de nuevo, solo diseña la infraestructura para que su re-verificación sea automática en vez de manual.

---

## Fuentes

**Primarias, verificadas en esta sesión (vía exa, 27-jul-2026):**

- Código Fiscal de la Federación, texto vigente (última reforma DOF 09-abr-2026) — art. 5o. (aplicación estricta) y art. 33, fracción I, inciso g) (facultad de RMF y su límite) — https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- Tesis P. LV/2004, Pleno de la SCJN, sobre reserva de ley y límites de la RMF — reproducida en https://mexico.justia.com/federales/codigos/codigo-fiscal-de-la-federacion/titulo-tercero/capitulo-i/ y https://vlex.com.mx/vid/obligaciones-autoridades-fiscales-559041970 (texto de la tesis citado, no la fuente jurisdiccional original del Semanario Judicial — **verificación de segundo grado**, marcarlo así frente a un fiscalista)

**Heredadas de ola 1 y ola 2, con su propia verificación de fuente primaria (no reinvestigadas aquí, solo referenciadas):**

- `00-RESUMEN-EJECUTIVO.md`, `00-INDICE.md`
- `03-isr-facilidades.md` §7.1–7.2 — diff RFA 2025 (DOF 17-feb-2025) vs. RFA 2026 (DOF 17-feb-2026); historia del gasto ciego 2022-2026
- `10-contradicciones.md` §1, §2, §4, §10, §11 — criterio 1/LIF/PI (Anexo 3, DOF 09-ene-2026); Primera Resolución de Modificaciones a la RMF 2026 (DOF 09-jul-2026); regla 11.7.3; conteo de los 74 criterios del Anexo 3
- `11-huecos.md` §2.1, §2.4, "Nota de método" — validador SOAP del SAT probado en vivo; método `curl` + `pdftotext -layout` contra DOF/Diputados, probado y funcionando

**Código de Likida leído como evidencia (no como fuente normativa):**

- `src/lib/cuadra/config.ts` — cita frágil de ejemplo (línea 87) y el hueco de jerarquía en `CuadraConfig`
- `src/lib/cuadra/cuadre/guardia.ts` — patrón fail-closed existente, base del `guardiaFundamento()` propuesto
- `src/lib/cuadra/intake/sat.ts` — patrón de herramienta en vivo existente (Capa 3), base para replicar
- `src/lib/cuadra/tools.ts` — patrón de tool registrada (`consultar_politica`, `cuadrar_viaje`) como precedente de `consultar_normativa()`
- `src/lib/cuadra/cuadre/engine.ts` (línea ~181) — ejemplo de fundamento hoy incrustado como texto libre en una nota, no como referencia estructurada
- `package.json` — confirmado: sin librería de embeddings ni pgvector instalados (fundamenta la recomendación de no construir RAG vectorial en esta etapa)
- `supabase/migrations/0001` a `0016` — confirmado: no existe tabla para normas/reglas fiscales hoy (greenfield)
