# Los doce rubros

Cada auditor recibe **solo su sección**. Mandarle las doce lo vuelve superficial en todas.

Índice: [1 Frontend](#1-frontend) · [2 Backend y API](#2-backend-y-api) · [3 Agéntico](#3-sistema-agéntico-y-orquestación) · [4 Tool calling](#4-tool-calling) · [5 Seguridad](#5-seguridad) · [6 Fiscal](#6-cumplimiento-fiscal) · [7 Legal](#7-cumplimiento-legal) · [8 Arquitectura](#8-arquitectura-y-mantenibilidad) · [9 Pruebas](#9-pruebas) · [10 Operabilidad](#10-operabilidad-y-dx) · [11 Rendimiento](#11-rendimiento-y-costo) · [12 Modelo de datos](#12-modelo-de-datos-y-esquema) · [Escala](#la-escala-0-10)

Notas de arranque (auditoría 2, 28-jul-2026): frontend 7 · backend 6 · agéntico 5 · tool calling 6 · seguridad 7 · fiscal 6 · legal 6 · arquitectura 6 · pruebas 6 · operabilidad 6 · rendimiento 6 · datos 7. Global 6.2.

---

## 1 · Frontend

**Dueño de** lo que el contralor ve y toca: paneles, tablas, estados vacíos, estados de carga, errores que llegan a pantalla, accesibilidad, responsive.

**Dónde:** `src/app/(dashboard)/`, `src/app/(admin)/`, `src/app/(portal)/`, `src/app/(demo)/`, `design-system/`, `globals.css`.

**Qué cuenta:** un mapeo de etiquetas que ya no cuadra con `src/types/`; un estado que la UI no sabe pintar y deja en blanco o crudo; un error de servidor que llega al usuario como stack; una cifra que se formatea distinto en dos pantallas; contraste o tamaño de toque que reprueba; un `key` de React inestable que reordena filas de dinero.

**Lo que se le escapa a este rubro si no se le exige:** el panel no tiene lint ni prueba, así que la desincronización con los tipos es su modo de falla dominante. Comparar **cada** mapa literal del panel contra `src/types/cuadra.ts` es trabajo obligatorio, no opcional.

**Anclas:** 8+ si cada estado (vacío, cargando, error, parcial) está pintado a propósito y los mapas derivan del tipo. 6 si se ve bien en el camino feliz. 4 o menos si el comprador puede ver una cifra mal formateada o una pantalla en blanco.

---

## 2 · Backend y API

**Dueño de** rutas, handlers, contratos de entrada y salida, concurrencia, idempotencia, manejo de errores del servidor, transacciones.

**Dónde:** `src/app/api/`, `src/lib/cuadra/processor.ts`, `repo.ts`, `conv.ts`, `duplicados.ts`, `pg_errores.ts`, `middleware.ts`.

**Qué cuenta:** un `if` que detecta la condición mala y no hace `return`; un error de la segunda escritura que se ignora; un lock que se pide y no se respeta; un upsert que no lanza y deja que dos caminos reporten éxito; un `catch` que se traga el error sin registrar cuál fila falló; un contrato que acepta lo que no debería.

**El sesgo a corregir:** este código se lee correcto. La auditoría 2 bajó backend de 8 a 6 justamente porque la lectura era buena y las pruebas no existían. **Leer no es verificar** — para cada camino de concurrencia, decir explícitamente si hay test que lo cubra, y nombrarlo.

**Anclas:** 8+ si cada camino que toca dinero tiene prueba propia y los errores se propagan con identificador de la fila. 6 si es correcto por lectura y no por prueba. 4 o menos si existe un camino donde el dinero se escribe dos veces o no se escribe y nadie se entera.

---

## 3 · Sistema agéntico y orquestación

**Dueño de** el ciclo de vida de una conversación: quién habla, cuándo, con qué contexto, qué pasa si el ciclo muere a la mitad, qué texto sale hacia el humano.

**Dónde:** `src/lib/agents/` (`run.ts`, `registry.ts`, `prompts.ts`), `src/lib/cuadra/processor.ts`, `conv.ts` (mutex, barrera de ráfaga), `presupuesto.ts`, `startup.ts`, `cuadre/guardia.ts`, `cuadre/resumen.ts`.

**Qué cuenta:** el destinatario equivocado (un veredicto que es del contralor y llega al chofer); una ejecución parcial que persiste y no cierra el ciclo con el humano; una carrera entre mensajes del mismo lote; un prompt que autoriza al modelo a narrar lo que debería ser determinístico; un reintento que duplica efecto; el caso "se trabó" donde el usuario nunca recibe su salida.

**La pregunta que ordena el rubro:** si el proceso muere en este punto exacto, ¿qué ve el humano y qué quedó en la base? Recorrer el ciclo punto por punto con esa pregunta encuentra más que leer el código de corrido.

**Anclas:** 8+ si cada punto de muerte tiene un cierre definido hacia el humano. 5–6 si el camino feliz es sólido y los bordes son suposiciones. 3 o menos si existe un estado donde la base dice una cosa y el usuario cree otra.

---

## 4 · Tool calling

**Dueño de** la frontera entre el modelo y el mundo: definición de tools, argumentos, ejecución, resultados que vuelven al modelo, loop-guard, fallback entre proveedores, contabilidad de tokens y costo.

**Dónde:** `src/lib/cuadra/tools.ts`, `src/lib/llm/openrouter.ts` (`generateWithTools`, `generateStructured`), `src/lib/llm/models.ts`, `src/lib/llm/tool-executor.ts`.

**Qué cuenta:** un parámetro que el modelo puede llenar y que decide sobre dinero o sobre a quién pertenece un dato; un resultado de tool que vuelve al modelo con más de lo que necesita; un loop-guard que cuenta mal; un fallback que cambia de modelo sin cambiar la atribución de costo; una respuesta truncada que se trata como completa; una tool que se ejecuta dos veces porque la deduplicación mira la llamada y no el efecto.

**Lo que hay que reconocer, no “encontrar”:** las tools declaran `properties: {}` a propósito — el modelo decide *cuándo*, nunca *con qué datos*, y `tenantId`/`viajeId` salen del contexto resuelto en servidor. Eso cierra la inyección de prompt de forma estructural. Un auditor que proponga “validar mejor los argumentos” no leyó el código. Lo que sí hay que vigilar es que ninguna tool nueva rompa esa regla.

**Anclas:** 8+ si ninguna tool acepta datos del modelo y el camino con fallback tiene prueba. 6 si la regla se respeta pero el cliente que la implementa no tiene pruebas unitarias. 4 o menos si el modelo puede influir en qué fila se escribe.

---

## 5 · Seguridad

**Dueño de** autenticación, autorización, secretos, RLS y grants, firma de webhooks, límites de cuerpo y de tasa, URLs firmadas, dependencias con CVE.

**Dónde:** `src/lib/auth/`, `middleware.ts`, `src/app/api/webhook/`, `supabase/migrations/*seguridad*`, `src/lib/env.ts`, `src/lib/ratelimit.ts`, `package-lock.json`.

**Qué cuenta:** un secreto que tiene fallback derivado de otro secreto cuando falta; autorización que descansa en una sola capa (un matcher de middleware es una capa, no dos); un `GRANT` implícito de Supabase que el `revoke from public` no alcanza; una URL firmada con TTL más largo de lo que dura la necesidad; un CVE con camino real de explotación en esta app — y si no lo hay, **decirlo y descartarlo por escrito**, como se descartó el bypass de middleware de Next.

**Herramientas:** `review` para SQL, fronteras de confianza y efectos escondidos en condicionales. `auditor-permisos` si la ronda toca configuración de permisos o hooks. `npm audit` como insumo, nunca como veredicto.

**Anclas:** 8+ si toda ruta privilegiada tiene dos capas independientes y ningún secreto tiene fallback silencioso. 7 si el diseño es correcto y las capas son una sola en algún punto. 4 o menos si existe un camino de acceso sin autenticar a datos de un tenant.

---

## 6 · Cumplimiento fiscal

**Dueño de** que las cifras que el producto imprime y afirma coincidan con la norma vigente: deducibilidad, IVA acreditable, IEPS, estímulos, requisitos del CFDI, plazos.

**Dónde:** `normas/*.yaml` es la **fuente de verdad**; el código a auditar es `src/lib/cuadra/liquidacion/deducibilidad.ts`, `cuadre/engine.ts`, `cuadre/leyendas.ts`, `liquidacion/pdf.ts`, `intake/cfdi.ts`, `intake/sat.ts`, `facturacion/`.

**Cómo se audita, y es distinto a los demás rubros:** se abre la ficha YAML, se lee el texto transcrito de la norma, y se compara contra la línea de código que la implementa. Las fichas marcadas `verificado_fuente_primaria` traen el texto literal y ganan cualquier discusión. Las que no lo están se anotan como *no verificable en esta ronda* — no se asume que están bien ni que están mal.

**Qué cuenta:** usar la cifra equivocada aunque el nombre coincida (el IEPS trasladado del CFDI **no** es el estímulo del LIF 2026 art. 20-A, que es cuota semanal × litros — la ficha lo dice literal); un requisito de deducibilidad que no se valida; una leyenda del PDF que cita un artículo que no dice eso; un plazo tratado como mensual cuando la ley lo pone por ejercicio; una facilidad aplicada a un concepto que no cubre.

**Peso:** un error aquí sale impreso en verde en el PDF citando un artículo, y un contador lo ve en la primera revisión. Vale más que un bug de UI aunque el diff sea de una línea.

**Anclas:** 8+ si cada cifra fiscal impresa rastrea a una ficha `verificado_fuente_primaria` y hay prueba con el caso de la norma. 6 si la lógica es correcta y la trazabilidad es informal. 3 o menos si el producto imprime una cifra fiscal equivocada.

---

## 7 · Cumplimiento legal

**Dueño de** datos personales y credenciales: consentimiento, aviso de privacidad, transferencias a terceros, retención, custodia, derechos ARCO.

**Dónde:** `src/lib/cuadra/privacidad.ts`, `supabase/migrations/*aviso_privacidad*`, `src/lib/llm/` (toda salida hacia un modelo externo es una transferencia), `src/lib/cuadra/intake/sanitizar.ts`, `export/`, `docs/conocimiento/` y `FISCAL_LEGAL.md` §2.

**Qué cuenta:** mandar la foto o el dato de un operador a un modelo externo sin que el aviso lo cubra; un consentimiento implícito donde la ley pide expreso; un ranking o evaluación de personas sin aviso y sin revisión humana; credenciales de portales guardadas de forma que no se puedan revocar; datos que se quedan más de lo necesario; ausencia de camino para ejercer derechos.

**Por qué es rubro aparte de fiscal:** un error fiscal le cuesta dinero al cliente y se corrige con una nota de crédito. Un error legal es responsabilidad de Likida frente a la autoridad y frente al titular del dato, y no se corrige con dinero. La LFPDPPP vigente es la de marzo 2025 — cualquier razonamiento con la ley anterior es un hallazgo en sí mismo.

**Anclas:** 8+ si cada salida de datos personales tiene su base en el aviso y hay camino de revocación. 6 si el aviso existe y cubre lo principal con huecos anotados. 3 o menos si hay transferencia de datos personales sin cobertura.

---

## 8 · Arquitectura y mantenibilidad

**Dueño de** dónde vive cada cosa, cuántas copias hay de la misma verdad, qué tan caro es cambiar algo, y qué se va a desincronizar la próxima vez.

**Dónde:** todo `src/`, con foco en fronteras: ¿todo el acceso a datos pasa por `repo.ts`? ¿el motor de dinero sigue siendo puro? ¿cuántos lugares definen el mismo mapa de conceptos?

**Qué cuenta:** dos literales que dicen lo mismo y ya divergieron (`engine.ts` con `otro: 'Gasto'` y `pdf.ts` con `otro: 'Otro'` es el ejemplo canónico: la ronda anterior lo marcó como advertencia y volvió a pasar); acceso a datos que se salta el repositorio; una función pura que empezó a hacer I/O; una dependencia que apunta al revés.

**La regla del rubro:** una advertencia de la ronda anterior que volvió a ocurrir **no es una advertencia, es un hallazgo**, y baja la nota aunque no haya bug visible hoy. Es la única forma de que la deuda cobre factura antes de que la cobre el cliente.

**Anclas:** 8+ si cada verdad vive en un lugar y las fronteras se respetan sin excepción. 6 si las fronteras existen y hay dos o tres fugas conocidas. 4 o menos si la misma lógica de dinero vive en más de un archivo.

---

## 9 · Pruebas

**Dueño de** qué está cubierto, qué no, y si las pruebas fallarían de verdad si alguien revirtiera el arreglo que dicen proteger.

**Dónde:** todos los `*.test.ts`, `.github/workflows/ci.yml`, `supabase/verificaciones.sql`, `pruebas-manuales/` (que **no se corren**: hacen llamadas reales de pago).

**Qué cuenta:** el cálculo del dinero probado y la **escritura** del dinero sin arnés; una prueba que pasa aunque se rompa la función (assertion floja, mock que devuelve lo que la prueba quiere oír); una prueba que depende de la hora o de la red y por eso es intermitente; cobertura del camino feliz sin ningún caso de borde; una regresión ya corregida sin prueba que la ancle.

**El chequeo que distingue este rubro:** tomar dos o tres pruebas y romper a propósito la función que cubren, mentalmente o de verdad. Si la prueba seguiría verde, es decoración. Reportar cuáles.

**Anclas:** 8+ si cada arreglo histórico tiene prueba anclada con el ID del bug y el CI corre en cada push. 6 si la suite es grande y verde pero hay zonas de dinero sin arnés. 4 o menos si la suite pasa con la función rota.

---

## 10 · Operabilidad y DX

**Dueño de** qué pasa cuando algo se rompe en producción: ¿alguien se entera?, ¿en cuánto tiempo?, ¿con qué información?, ¿y se puede reproducir localmente?

**Dónde:** `src/lib/observability/`, `src/lib/logger.ts`, `instrumentation.ts`, configuración de Sentry, `.github/workflows/ci.yml`, `DEPLOY.md`, `scripts/seed.sh`, `.env.example`.

**Qué cuenta:** un log de fallo que no dice **cuál** liquidación falló; Sentry instalado pero sin cablear; ninguna alerta en el camino del dinero; un error que se traga y devuelve 200; una variable de entorno que falta y el sistema arranca igual, mal; un `setup` que no deja el proyecto corriendo en una máquina limpia.

**La pregunta que ordena el rubro:** si esto revienta a las 3 de la mañana con un cliente adentro, ¿qué tengo a la mañana siguiente para saber qué pasó? Si la respuesta es "nada", la nota no pasa de 5 por más limpio que esté el código.

**Anclas:** 8+ si cada fallo del camino del dinero genera alerta con identificador suficiente para reconstruirlo. 6 si hay logs pero nadie los mira y el CI existe. 4 o menos si un fallo en producción es invisible.

---

## 11 · Rendimiento y costo

**Dueño de** el peor caso, no el promedio: tiempos contra los límites reales de la plataforma, tokens por interacción, dinero por operación, consultas por request.

**Dónde:** `src/lib/cuadra/presupuesto.ts`, `costos.ts`, `src/lib/llm/openrouter.ts`, `maxDuration` de las rutas, `repo.ts` (N+1), `src/lib/queue/`, `intake/ocr.ts`.

**Qué cuenta:** un presupuesto de tiempo que no cabe en su propio límite (peor caso 112s contra `maxDuration=60` fue exactamente esto, y el mensaje se perdía en silencio sin reintento); un timeout que no considera la suma de los eslabones; una consulta dentro de un bucle; un modelo caro donde uno barato bastaba; tokens gastados en contexto que el modelo no usa; una imagen que se manda sin redimensionar.

**Cómo se audita:** sumar los peores casos de la cadena a mano y comparar contra el límite escrito. No estimar "se siente rápido" — el número contra el número.

**Anclas:** 8+ si el peor caso sumado cabe con margen y el costo por operación está medido. 6 si el promedio es bueno y el peor caso está apenas dentro. 4 o menos si el peor caso excede el límite y falla callado.

---

## 12 · Modelo de datos y esquema

**Dueño de** si la base puede guardar un estado imposible: restricciones, unicidad, tipos, nulabilidad, RLS, migraciones y su reversibilidad.

**Dónde:** `supabase/migrations/`, `src/types/cuadra.ts`, `src/lib/cuadra/repo.ts`, `supabase/verificaciones.sql`.

**Qué cuenta:** un dominio sin `CHECK` que acepta un monto negativo o un estado inventado; falta de `unique` donde la lógica asume unicidad (el mismo CFDI liquidándose dos veces es el caso de manual); un tipo de TypeScript más estricto que la columna, que es la forma más común de mentirse; una migración que no se puede revertir; RLS que se apoya en que la aplicación se porte bien.

**El chequeo que distingue el rubro:** para cada invariante que el código asume, preguntar si la base la impone. Si la respuesta es "la aplicación se encarga", es un hallazgo — porque un script, una consola de Supabase o un bug futuro no pasan por la aplicación.

**Anclas:** 8+ si cada invariante del código tiene su restricción en la base. 7 si las unicidades críticas están y faltan los CHECK de dominio. 4 o menos si la base acepta un estado que el producto no sabe manejar.

---

## La escala 0–10

Cinco es "funciona en el camino feliz y los bordes son suposiciones". Cada punto arriba cuesta trabajo real y verificable; cada punto abajo describe un daño concreto, no una incomodidad.

- **9–10** — reservado. Solo si un experto externo del rubro no encontraría nada material. Casi nunca se otorga y hay que justificar por qué esta vez sí.
- **8** — sólido con red: pruebas, restricciones o alertas que sostienen lo que el código promete.
- **6–7** — correcto donde importa, sin red en la periferia. Es donde vive un pre-revenue honesto.
- **5** — el camino feliz funciona; los bordes son fe.
- **3–4** — existe un camino donde el producto hace algo mal y nadie se entera.
- **0–2** — el rubro no está atendido.

**Mover una nota exige una razón escrita de una de estas tres formas**, porque son las únicas que distinguen señal de ruido:

1. *Se atacó y subió* — hay commits de esta ronda que cerraron hallazgos del rubro.
2. *Deuda que cobró factura* — algo marcado como advertencia antes ya ocurrió.
3. *Mirada más profunda* — el código no cambió, la nota anterior estaba inflada. **Decirlo así**, con esas palabras: no es que empeorara, es que se vio mejor.

Sin una de las tres, la nota se queda igual. Una nota que se mueve sola es ruido, y el ruido diario destruye la utilidad de la serie histórica.
