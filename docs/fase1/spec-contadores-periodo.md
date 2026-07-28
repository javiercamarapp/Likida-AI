# Especificación: contadores del EJERCICIO/PERIODO (Fase 1)

> Solo especificación. No se tocó código en este trabajo.
> Fecha: 28-jul-2026. Repo: `~/javiercamarapp/cuadra`.

## Por qué esto es un documento aparte de `engine.ts`

`src/lib/cuadra/cuadre/engine.ts` (`cuadrarViaje`) es una función pura que recibe
**un viaje** y devuelve su liquidación. No tiene memoria entre llamadas: no sabe
cuánto combustible en efectivo pagó el tenant en lo que va del año, no sabe
cuánto ha ganado la empresa, no sabe cuánto le debe ya un operador. Tres topes
legales reales dependen exactamente de esa memoria que el motor no tiene:

1. El 15% de combustible en efectivo — RFA 2026 regla 2.9 (`normas/rfa-2026-2.9.yaml`).
2. Los dos topes laborales de descuento — LFT art. 110 fr. I.
3. El 8% / $1,000,000 / 16% definitivo — RFA 2026 regla 2.2 (`normas/rfa-2026-2.9.yaml`... `normas/rfa-2026-2.2.yaml`).

Evaluarlos "por viaje" no es solo incompleto: **no significa nada**. El 15% es
una fracción del combustible del ejercicio completo; un solo viaje no tiene
"15%", tiene un pago que empuja un acumulador que vive fuera de él.

## Nota sobre las fuentes y su verificación

Distingo tres tipos de fuente en este documento, porque no pesan igual:

- **Ficha `normas/*.yaml`** — el mecanismo formal del repo, con `estado_verificacion`
  declarado. Es lo más fuerte que hay aquí. Cito su ruta y su estado.
- **Investigación `docs/conocimiento/*.md`** — texto legal transcrito con cita de
  fuente primaria (DOF, diputados.gob.mx) por quien la escribió, pero **sin**
  ficha YAML formal en `normas/` y por lo tanto sin el campo `estado_verificacion`
  del repo. Es la situación de **todo el marco laboral (LFT arts. 110, 111, 256,
  257, 260, 263)**: está transcrito literalmente en `docs/conocimiento/11-huecos.md`
  con fecha de lectura (27-jul-2026) y referencia de fuente (DOF), pero nadie lo
  convirtió todavía en ficha. Lo trato como **fuente primaria citada pero sin
  formalizar** — no como `sin_verificar` (que en este repo significa "una sola
  fuente secundaria, blog o competidor") ni como `verificado_fuente_primaria`
  (que exige la ficha). Es un hueco del propio catálogo de normas, y lo señalo
  como acción al final.
- **Mi propia lectura o inferencia** — cuando ninguna fuente resuelve algo y
  tengo que razonar el diseño. Lo marco explícitamente como supuesto, nunca
  como regla.

---

## Contador 1 — 15% de combustible en efectivo (RFA 2026, regla 2.9)

**Ficha:** `normas/rfa-2026-2.9.yaml` — `estado_verificacion: verificado_fuente_primaria`
(leída en el DOF/SIDOF, corroborada en tres reproducciones independientes,
`verificado_el: 2026-07-27`). Es la fuente más fuerte de las tres de este
documento.

### 1. Base de cálculo

15% del **total de pagos por consumo de combustible del ejercicio**, no del
gasto total de la flota, no de las erogaciones totales, no de un monto fijo por
ticket. Texto literal de la ficha (líneas 16-17):

> "...siempre que estos [los pagos en efectivo] no excedan el 15 por ciento del
> total de los pagos efectuados por consumo de combustible para realizar su
> actividad."

Fórmula:

```
ratio = Σ(monto de gasto combustible con formaPago = '01', efectivo, del ejercicio)
        ────────────────────────────────────────────────────────────────────────
        Σ(monto de TODO gasto combustible, cualquier forma de pago, del ejercicio)
```

El denominador es **todo** el combustible pagado en el ejercicio (efectivo +
electrónico), no solo el electrónico. Esto ya lo dice `engine.ts:124` en el
texto del aviso ("cuenta contra el tope del 15% del combustible del ejercicio")
pero hoy es una nota, no un cálculo — ver §5.

**Condición de aplicación previa, que gatea todo lo demás** (ficha, líneas 32-34):
solo aplica a contribuyentes **dedicados exclusivamente** al autotransporte
terrestre de carga federal, tributando en Título II Cap. VII (coordinados) o
Título IV Cap. II Sección I (persona física con actividad empresarial) de la
LISR. Si el tenant no cae en uno de esos dos regímenes, el contador no debería
ni activarse — hoy no hay dónde capturar eso (ver §5).

### 2. Ventana temporal

**Supuesto explícito, no verificado directamente por mí en fuente primaria en
esta sesión:** el "ejercicio fiscal" en materia de ISR es el año de calendario
(1-ene a 31-dic), salvo el ejercicio irregular de inicio de actividades (CFF
art. 11). No hay ficha en `normas/` para este artículo — es una regla base del
derecho fiscal mexicano, no controvertida, pero la incluyo como supuesto
explícito porque la regla lo pide.

Dos matices que **sí** están sourced y que complican la respuesta simple
"1-ene a 31-dic":

- **La vigencia de la propia RFA 2026 no cubre el año completo.** La ficha
  (líneas 22-24) declara `fecha_vigencia_desde: 2026-02-18`,
  `fecha_vigencia_hasta: 2026-12-31`. Publicada el 17-feb-2026, en vigor el
  18-feb-2026. Eso deja un hueco entre el 1-ene y el 17-feb-2026 en el que la
  facilidad, por su propio texto de vigencia, no estaba en vigor — aunque
  `docs/conocimiento/34-proceso-liquidacion.md:319` reporta que el Transitorio
  Primero de la RFA dice que sus facilidades "aplican a todo el ejercicio
  2026", lo que sugiere retroactividad hasta el 1-ene. **No leí el Transitorio
  Primero yo mismo ni encontré su texto citado literal en ningún archivo de este
  repo** — solo la paráfrasis del documento de investigación. Esto es un
  **hueco real, no resuelto**: si un cliente paga combustible en efectivo el
  10-ene-2026, ¿ese pago cuenta para el 15% del ejercicio 2026 aunque la RFA
  todavía no estuviera vigente ese día? Lo marco `sin_criterio` — ver el
  apartado final.
- **Periodicidad de la medición dentro del ejercicio: SIN VERIFICAR.** El texto
  de la regla no dice si el 15% se mide mensual, acumulado corriente, o solo al
  cierre del ejercicio. `docs/conocimiento/34-proceso-liquidacion.md:319` y
  `:440` lo marcan explícitamente como pendiente ("la regla no dice si el 15%
  se mide mensual, acumulado del ejercicio, o anual cerrado... no hay
  confirmación de un fiscalista ni criterio del SAT") y diseña el contador como
  **acumulado corriente del ejercicio** (se recalcula con cada pago, no se
  espera al cierre) por ser la lectura más conservadora para el semáforo de
  producto. Adopto esa misma lectura aquí, con la misma etiqueta: no es
  certeza, es la lectura más defendible mientras no haya criterio del SAT.

**Viaje a caballo entre dos ejercicios.** Ningún documento de este repo trata
este caso para la regla 2.9. Mi construcción, marcada como inferencia propia:
el 15% no es un atributo del **viaje**, es un atributo de cada **pago de
combustible** individual, agrupado por la fecha de ese pago (la fecha del
comprobante/CFDI, no la fecha de inicio o fin del viaje). Un viaje que arranca
el 28-dic-2026 y cierra el 3-ene-2027 tiene gastos de combustible que caen en
dos ejercicios distintos, y cada uno se cuenta contra el acumulador de SU
ejercicio. El motor por viaje (`engine.ts`) no necesita saber esto — lo que
necesita es que la Capa 2 (el contador) agregue por **fecha del gasto**, no por
fecha del viaje. Esto es consistente con el principio general de que la
deducción de ISR se atribuye al ejercicio en que se erogó el gasto, pero no
encontré ninguna fuente en este repo que lo diga para este caso específico —
lo trato como supuesto razonado, no como cita.

### 3. Unidad de agregación

**Por tenant** (la persona física o moral contribuyente), leído del texto
literal: "los contribuyentes personas físicas o morales... dedicados
exclusivamente...". El sujeto de la obligación es el contribuyente.

**El hueco "por integrante o por coordinado" — SÍ aplica aquí, y nadie lo
resolvió para ESTA regla específicamente.** `docs/conocimiento/11-huecos.md:378`
y `docs/conocimiento/34-proceso-liquidacion.md:441` (SIN VERIFICAR #2)
documentan el argumento — pero **para la regla 2.2** (8%/$1,000,000), no para
la 2.9. El argumento textual (los integrantes de un coordinado son los
"contribuyentes" bajo LISR 72-73, así que el tope corre por integrante, no de
forma consolidada por el coordinado) usa exactamente la misma frase inicial
("los contribuyentes personas físicas o morales...") que trae la regla 2.9. Por
identidad de redacción, el mismo argumento aplicaría al 15% de combustible: **si
Likida sirve a un coordinado con varios integrantes, el contador del 15% correría
por integrante, no consolidado del coordinado.** Pero esto es una extensión MÍA
del argumento de `11-huecos.md`, no algo que ese documento ni ningún otro haya
afirmado para la regla 2.9 específicamente. Lo marco `sin_criterio`: ningún
fiscalista lo ha confirmado ni para la 2.2 ni, menos aún, para la 2.9.

Consecuencia práctica: si el modelo de datos solo agrega por `tenant_id` y el
tenant es un coordinado con integrantes, el contador puede estar sumando mal
desde el diseño — de más (si debía ser por integrante) o de menos relevancia
regulatoria (si en realidad sí corre consolidado). Likida no modela hoy la
relación coordinado↔integrante en absoluto (no hay tabla ni campo para eso —
ver §5), así que este hueco hoy es principalmente teórico, pero se vuelve real
en cuanto exista un cliente coordinado.

### 4. Qué pasa al superarlo

Texto de la ficha, no ambiguo en esto: **no hay prorrateo proporcional.**
`docs/conocimiento/34-proceso-liquidacion.md:315`: "Rebasar el 15% no reduce
proporcionalmente la deducción: tira el excedente completo, y con él su IVA
acreditable." El diseño del contador en `34-proceso-liquidacion.md:198-204`
formaliza esto como: se marca no deducible **el excedente sobre el 15%**, no
el gasto individual completo que causó el cruce, y no el acumulado completo del
contador.

**Pero "cuál pago específico es el excedente" es un hueco real que ningún
documento resuelve.** Si el acumulado del ejercicio cruza el 15% con el pago
#47 del año, ¿ese pago #47 completo se vuelve no deducible, o solo la porción
de él que rebasa el umbral (p. ej. si el pago #47 lo cruza de 14.8% a 15.3%,
solo el 0.3% de ese pago específico)? Y si viene un reembolso o una
reclasificación de un pago anterior (p. ej. una factura que se cancela), ¿el
acumulado se recalcula retroactivamente y cambia el veredicto de pagos
posteriores que ya se le mostraron "deducibles" a un contralor? Ninguna fuente
en este repo trata la mecánica de "quién es el excedente" a nivel de
comprobante individual. Lo marco `sin_criterio` — es exactamente el tipo de
caso que, per las reglas de este encargo, va a la bandeja del contralor, no se
resuelve por default silencioso.

**Semáforo de producto (no es ley):** `34-proceso-liquidacion.md:203-204,317`
propone avisar al contralor a partir de 12% acumulado, como diseño de UX, no
como regla legal. Lo incluyo aquí solo para que quede claro que es una decisión
de producto, no una interpretación de la RFA.

### 5. Qué dato hace falta guardar

Revisado en `src/types/cuadra.ts` y `supabase/migrations/*.sql` (28-jul-2026):

| Dato | ¿Existe hoy? | Evidencia |
|---|---|---|
| Régimen fiscal del tenant (Título II Cap. VII / Título IV Cap. II Secc. I / otro) | **No** | `tenant` (`supabase/migrations/0001_init.sql:9-13`) solo tiene `nombre, rfc, ciudad, plan`. Sin este dato no se puede saber si el tenant siquiera califica para la facilidad |
| Bandera "dedicado exclusivamente al autotransporte de carga federal" | **No** | mismo lugar — no existe el campo |
| `forma_pago` y `concepto` por gasto, para poder sumar numerador/denominador | **Sí** | `gasto.forma_pago` (`supabase/migrations/0007_acreditamiento.sql:4`), `gasto.concepto` (`0001_init.sql:61`) — el dato base **sí** está, solo falta agregarlo |
| Acumulador materializado del ejercicio (numerador, denominador, ratio, estado del semáforo) | **No** | no existe tabla ni vista; sería computable con un `SUM ... GROUP BY tenant_id, extract(year from fecha)` sobre `gasto`, pero hoy nada lo calcula ni lo cachea, y el motor (`engine.ts`) no recibe ese dato como input — su `CuadreInput` (líneas 23-50) no tiene ningún campo de acumulado de ejercicio |
| Relación coordinado ↔ integrante | **No** | no existe ningún modelo de esa relación en el esquema — relevante para el hueco de §3 |

**El dato más barato de resolver primero:** el numerador y denominador son
computables hoy mismo desde `gasto` sin nueva migración (la columna
`forma_pago` y `concepto` ya existen). Lo que falta no es una columna nueva
sobre el gasto — es (a) el campo de régimen/condición de aplicación en `tenant`,
que gatea si el contador debe correr, y (b) una capa nueva (no `engine.ts`, que
es puro y por viaje) que consulte el acumulado y decida el veredicto antes de
que el motor marque `combustible_efectivo` como "por confirmar" a ciegas —
que es lo que hace hoy (`engine.ts:122-128`, `:446`).

---

## Contador 2 — 8% / $1,000,000 / 16% definitivo (RFA 2026, regla 2.2)

**Ficha:** `normas/rfa-2026-2.2.yaml` — `estado_verificacion: verificado_fuente_primaria`
(mismo DOF/SIDOF que la 2.9, `verificado_el: 2026-07-27`). `usado_en_codigo: []`
— la propia ficha confirma que hoy no hay ni una línea de código que la use.

### 1. Base de cálculo

`MIN(8% × ingresos propios de la actividad del ejercicio, $1,000,000)`. Texto
literal de la ficha (líneas 9-16):

> "...podrán deducir hasta el equivalente al 8 por ciento de los ingresos
> propios de su actividad, sin exceder de $1,000,000.00... durante el ejercicio
> fiscal, sin la necesidad de contar con documentación que reúna requisitos
> fiscales, siempre que: ... III. El contribuyente realice el pago del ISR
> anual sobre el monto deducido... aplicando la tasa del 16 por ciento."

Dos cosas que hay que decir con precisión porque es fácil equivocarse:

- La base es **ingresos**, no gasto ni erogaciones. Esto es distinto de la
  regla del combustible (que se mide contra el propio gasto de combustible) y
  distinto de RLISR 152 (que se mide contra el gasto de viáticos de esa
  ocasión — pero esa regla no es parte de este encargo).
- **El combustible está excluido de esta válvula, expresamente** (ficha, líneas
  17-20): "Lo establecido en esta regla no será aplicable a los gastos que
  realicen los contribuyentes por concepto de adquisición de combustibles para
  llevar a cabo su actividad." La ficha lo repite como advertencia (línea 32-34):
  "NO cubre combustible... Prometerle a un contralor que el diésel sin factura
  'entra en el 8%' es falso." Esto es una regla dura de diseño, no solo un
  detalle: cualquier implementación de este contador tiene que filtrar
  `concepto != combustible` antes de sumar, sin excepción y sin bandera de
  configuración que lo apague.

### 2. Ventana temporal

Mismo supuesto que el Contador 1: ejercicio fiscal = año calendario (CFF art.
11, no verificado por mí en fuente primaria en esta sesión, sin ficha en
`normas/`). Esta ficha (`rfa-2026-2.2.yaml`) también tiene
`fecha_vigencia_desde: 2026-02-18` / `fecha_vigencia_hasta: 2026-12-31` (líneas
22-23) — el mismo hueco de los 47 días de enero-febrero que señalé en el
Contador 1 aplica aquí igual, sin resolver.

Reloj adicional, sourced de investigación no de ficha:
`docs/conocimiento/34-proceso-liquidacion.md:330,148` reporta que si se usa la
facilidad, el pago provisional del 16% es exigible **el día 17 del mes
siguiente** al que se dedujo (RFA 2026, regla 2.2, fr. IV) — esto no está en el
`texto_vigente` transcrito en la ficha (que corta en la fracción III), así que
lo trato como cita de investigación sin ficha propia, no como texto verificado
por la ficha misma.

### 3. Unidad de agregación

**Este es el hueco que el encargo pide explícitamente, y aquí SÍ hay una fuente
directa que lo trata (a diferencia del Contador 1, donde tuve que extenderlo
yo).** `docs/conocimiento/11-huecos.md:378` y
`docs/conocimiento/34-proceso-liquidacion.md:441` (SIN VERIFICAR #2):

> "El tope de $1,000,000 de la regla 2.2 es por integrante... Argumento
> textual nuevo, no certeza: la regla habla de 'los contribuyentes personas
> físicas o morales' y su fr. III solo encarga al coordinado 'efectuar el
> entero de dicho impuesto por cuenta de los mismos'. En un coordinado los
> contribuyentes son los integrantes (LISR 72-73), así que el tope corre por
> integrante. Sigue sin criterio del SAT."

Marco esto **`sin_criterio`**, exactamente como pide el encargo: es un
argumento textual razonable, construido por quien investigó, pero sin
confirmación del SAT ni de un fiscalista. El contador de
`34-proceso-liquidacion.md:207-214` (§4.2) **asume por integrante** al
diseñarlo, y lo dice explícitamente ("El contador de §4.2 asume por integrante;
puede estar mal" — línea 441). Yo no tengo elementos nuevos para resolverlo;
lo hereda esta especificación con la misma etiqueta de incertidumbre.

Para un tenant que NO es coordinado (permisionario individual persona moral o
física), no hay ambigüedad: es por tenant, sin más.

### 4. Qué pasa al superarlo

Aquí encontré una **contradicción real dentro del mismo documento de
investigación**, que señalo en vez de resolverla arbitrariamente (regla de
"revisar sin ceder": no aceptar una afirmación sin verificarla, y verificarla
aquí significa notar que las dos partes del mismo archivo no dicen lo mismo):

- `docs/conocimiento/34-proceso-liquidacion.md:210` (bloque REGLA, §4.2): "SI
  acumulado_8pct_ejercicio > tope → **el excedente NO es deducible**" — lectura
  de ruptura parcial, solo se pierde lo que pasa del tope.
- `docs/conocimiento/34-proceso-liquidacion.md:300` (tabla, §6): "¿Qué pasa si
  se rompe? | **Todo lo deducido se vuelve no deducible retroactivo**, y el 16%
  ya pagado no se recupera (es definitivo)" — lectura de ruptura total
  retroactiva, se pierde el año completo bajo la facilidad.

Son dos afirmaciones distintas sobre la misma regla, en el mismo archivo, sin
que ninguna cite el texto exacto de la RFA que resuelva cuál es correcta. El
`texto_vigente` transcrito en la propia ficha `rfa-2026-2.2.yaml` tampoco lo
dice — solo transcribe la condición de la fr. III sobre el 16% definitivo, no
qué pasa si el 8%/$1,000,000 se rebasa. **No puedo resolver esta contradicción
con lo que hay en el repo.** La marco `sin_criterio` explícitamente: cualquier
implementación tiene que decidir con un fiscalista cuál de las dos lecturas
aplica, porque el impacto económico es muy distinto (perder solo el excedente
vs. perder la facilidad completa del ejercicio).

Lo que **sí** está firme, porque es texto literal de la ficha (línea 16): el
16% de ISR ya pagado sobre lo deducido bajo esta facilidad "se considerará como
definitivo y no será acreditable ni deducible" — es decir, aunque después se
determine que el gasto no calificaba, ese 16% ya enterado no se recupera nunca.
Eso no depende de la contradicción de arriba.

### 5. Qué dato hace falta guardar

| Dato | ¿Existe hoy? | Evidencia |
|---|---|---|
| **Ingresos propios de la actividad, por tenant y por ejercicio** | **No — y es el hallazgo más grande de este documento** | Grep exhaustivo (`command grep -n "ingreso" src/lib/cuadra/repo.ts src/types/cuadra.ts`, y sobre todo `supabase/migrations/*.sql`) no encontró ni una columna, tabla o campo de ingresos en todo el modelo de datos. Cuadra registra **gastos** (`gasto`), **anticipos** (`viaje.anticipo`) y **liquidaciones** de costo — nunca ingresos por flete ni facturación de la flota. La base de este contador (8% de ingresos) es un dato que Likida hoy **no captura de ninguna forma**, ni siquiera como campo manual |
| Régimen fiscal / relación coordinado-integrante | **No** | mismo hueco que el Contador 1 |
| `concepto = combustible` como exclusión dura | **Sí, el dato existe** (`gasto.concepto`), falta la regla de filtrado en un contador que aún no existe | — |
| Acumulador del 8%/16% por ejercicio | **No** | no existe tabla, vista ni campo en `Liquidacion` (`src/types/cuadra.ts:94-120`) que registre "monto deducido bajo la facilidad 2.2" ni "16% pagado a la fecha" |

**Esto cambia la prioridad de implementación respecto al Contador 1.** El
Contador 1 (15%) es computable hoy con los datos que ya existen en `gasto` —
solo falta la capa de agregación. El Contador 2 (8%/$1,000,000) **no** es
computable hoy aunque se construya esa capa, porque falta el dato de entrada
más básico: la empresa tendría que capturar sus ingresos manualmente en algún
lado (no hay onboarding para eso hoy) antes de que el contador tenga sentido.

---

## Contador 3 — Topes laborales del art. 110 fr. I de la LFT

**Fuente:** `docs/conocimiento/11-huecos.md:149-155` — texto transcrito con
cita de fuente primaria (DOF, reforma del párrafo 09-01-1974), leído
27-jul-2026. **No existe ficha en `normas/` para la LFT en absoluto** — ni el
art. 110, ni el 111, ni el capítulo completo de autotransportes (arts.
256-264). Esto lo trato, siguiendo la nota metodológica del inicio, como
fuente primaria citada pero **sin formalizar** en el mecanismo de verificación
del repo. Texto literal:

> "Los descuentos en los salarios de los trabajadores, están prohibidos salvo
> en los casos y con los requisitos siguientes: I. Pago de deudas contraídas
> con el patrón por anticipo de salarios, pagos hechos con exceso al
> trabajador, errores, pérdidas, averías... La cantidad exigible en ningún caso
> podrá ser mayor del importe de los salarios de un mes y el descuento será al
> que convengan el trabajador y el patrón, sin que pueda ser mayor del treinta
> por ciento del excedente del salario mínimo."

Son **dos topes independientes**, no uno:

### 1. Base de cálculo

```
Tope A — deuda exigible:
  saldo_exigible_acumulado_operador ≤ 1 × salario_mensual_del_operador

Tope B — descuento por periodo de pago:
  descuento_del_periodo ≤ 30% × (salario_del_periodo − salario_mínimo_del_periodo)
```

**Condición previa que gatea todo el contador**, también sourced
(`docs/conocimiento/11-huecos.md:168-170`): esto aplica **solo al operador
SUBORDINADO**. "Al hombre-camión permisionario se le retiene del precio del
flete por contrato mercantil, y ahí no rige el art. 110." Si el operador es
tercero/permisionario (aporta su propia unidad y su propio permiso SICT — regla
derivada de LFT art. 256, `docs/conocimiento/34-proceso-liquidacion.md:33-42`),
este contador entero no debe correr: lo que se le retiene es una deducción
contractual de su contraprestación mercantil, no un descuento salarial, y el
art. 110 no lo alcanza.

**Además, guardarraíl relacionado que hay que codificar aparte, no como
"regla que dispara"** (`docs/conocimiento/11-huecos.md:141-142`, LFT art.
111): "Las deudas contraídas por los trabajadores con sus patrones en ningún
caso devengarán intereses." El saldo negativo de un operador nunca acumula
interés, sin importar cuánto tiempo lleve abierto — es una prohibición
absoluta a nivel de diseño del motor de saldos, no un tope condicional.

### 2. Ventana temporal

Aquí la ventana **no es el ejercicio fiscal** — es el **periodo de pago** del
operador (la unidad que corresponda a su esquema de pago: semanal, quincenal,
mensual, o por liquidación de viaje si así se le paga). Esto es un punto donde
el encargo original ya distingue bien: el 15% y el 8% son del ejercicio: el
110 es del periodo de nómina/liquidación, un ciclo mucho más corto y que se
repite muchas veces al año.

**El hueco más serio de todo este documento vive aquí, y está explícitamente
sin resolver en la fuente:** `docs/conocimiento/34-proceso-liquidacion.md:249,442`
(SIN VERIFICAR #3):

> "Cómo se mide 'un mes de salario' y 'el excedente del salario mínimo' (LFT
> 110) cuando el operador cobra por viaje o por kilómetro, no por sueldo fijo.
> Ningún archivo de la ola 1 ni de esta ola encontró un criterio que aterrice
> esos dos topes a un esquema de pago variable. La regla de §4.2 es una lectura
> razonada (usar el promedio del periodo relevante), no una certeza verificada
> en fuente."

El texto del art. 110 fr. I fue escrito pensando en un salario fijo periódico.
La mayoría de los operadores de autotransporte de carga cobran por viaje o por
kilómetro (art. 257 LFT lo reconoce como esquema válido: "El salario se fijará
por día, por viaje, por boletos vendidos o por circuito o kilómetros
recorridos"). No hay ningún criterio del SAT, la STPS ni de un fiscalista
citado en este repo que diga cómo convertir "1 mes de salario" o "salario del
periodo" a un esquema variable. Lo marco `sin_criterio` explícitamente — es
exactamente el tipo de caso que el encargo pide señalar, no inventar.

**Viaje a caballo entre dos periodos de pago.** Mismo tipo de problema que el
Contador 1 pero con el periodo de nómina en vez del ejercicio: ningún documento
lo trata. Construcción propia, marcada como inferencia: el tope se aplica al
momento en que el descuento efectivamente se aplica (la fecha de la
liquidación/pago), no a las fechas del viaje que originó el faltante — es
consistente con que el tope B es "del periodo" de descuento, no del viaje.

### 3. Unidad de agregación

**Por operador**, no por tenant ni por RFC de la empresa. Es una relación
laboral individual — el art. 110 protege a "los trabajadores" en singular, cada
uno con su propio salario y su propio saldo. No hay ambigüedad de "por
integrante o por coordinado" aquí porque no es una regla fiscal del régimen del
contribuyente, es una protección laboral del trabajador individual.

### 4. Qué pasa al superarlo

Del bloque REGLA en `docs/conocimiento/34-proceso-liquidacion.md:238-249`
(§4.2), que a su vez interpreta el texto legal (no es cita literal de la LFT,
la LFT solo fija el tope, no dice qué hacer operativamente al superarlo — esta
parte SÍ es diseño de producto, lo marco así):

- Si el faltante de un viaje excede el tope A (1 mes de salario) de una sola
  vez: **no se puede cobrar todo de una vez**; se prorratea a periodos
  siguientes.
- Si el descuento calculado de un periodo excede el tope B (30% del excedente
  del mínimo): se aplica el máximo permitido ese periodo y **el resto se
  traslada al periodo siguiente** — nunca se descuenta de golpe.
- Consecuencia explícita para el producto (`docs/conocimiento/34-proceso-liquidacion.md:17`):
  "Una liquidación que imprime 'a pagar: $0' porque absorbió un anticipo grande
  contra un sueldo chico puede estar imprimiendo un número ilegal." El motor no
  puede "cerrar en cero" un faltante grande contra un sueldo chico en una sola
  liquidación.

### 5. Qué dato hace falta guardar

| Dato | ¿Existe hoy? | Evidencia |
|---|---|---|
| `operador.salario` | **No** | `operador` (`supabase/migrations/0001_init.sql:29-36`) tiene `nombre, telefono, numero_empleado, activo` — nada de compensación. `src/types/cuadra.ts:132-137` (interfaz `Operador`) tampoco lo tiene |
| `operador.regimen` (subordinado / tercero-permisionario) | **No** | mismo lugar — sin este campo no se puede saber si el art. 110 aplica siquiera |
| Esquema de pago del operador (fijo / por viaje / por km) | **No** | necesario para resolver (aunque sea parcialmente) el hueco `sin_criterio` de §2 |
| Salario mínimo vigente (general o zona libre de la frontera norte, según ubicación) | **No, y es dato externo, no del cliente** | no hay ninguna tabla de referencia de salario mínimo en el repo; lo publica CONASAMI anualmente y varía por zona. Nota: la LFT usa el salario mínimo **como salario**, no como UMA — la desindexación de 2016 sacó al salario mínimo como unidad de referencia de otras leyes, pero en materia laboral se mantiene como el salario mismo (esto lo digo por conocimiento general del dominio, **no lo verifiqué contra una fuente en este repo** — márquese igual como supuesto) |
| Saldo/adeudo acumulado del operador, corriendo entre liquidaciones | **No** | grep sobre `repo.ts` y `types/cuadra.ts` no encontró ningún campo `saldo` ni `adeudo`. Cada `Liquidacion` (`src/types/cuadra.ts:94-120`) tiene su propia `diferencia`, pero nada las encadena en un balance corriente por operador a través del tiempo |

**Esto es el contador más lejos de ser computable de los tres**, porque
necesita tres cosas que hoy no existen en absoluto (salario, régimen, saldo
corriente) y una referencia externa (salario mínimo por zona) que tampoco vive
en el repo.

### Deducible ≠ pagadero — arts. 257 y 263 fr. I, y qué SÍ se le puede descontar al operador

El encargo pide explícitamente separar el veredicto fiscal del laboral. Esto
es la pieza que lo hace operativo.

**Lo que dice el art. 257** (`docs/conocimiento/11-huecos.md:118-123`, texto
transcrito de fuente primaria):

> "...Cuando el salario se fije por viaje, los trabajadores tienen derecho a un
> aumento proporcional en caso de prolongación o retardo del término normal del
> viaje por causa que no les sea imputable. **Los salarios no podrán reducirse
> si se abrevia el viaje**, cualquiera que sea la causa."

Es decir: si el viaje se acorta, el operador cobra su tarifa completa
igual — no hay descuento por kilómetros no recorridos. Y si el viaje se
prolonga por una causa que NO es culpa del operador (demora en aduana, bloqueo
carretero, espera en andén — no una causa imputable a él, como manejar
despacio o desviarse), tiene derecho a un pago adicional proporcional.

**Lo que dice el art. 263 fr. I** (`docs/conocimiento/11-huecos.md:129-132`):

> "Los patrones tienen las obligaciones especiales siguientes: I. En los
> transportes foráneos pagar los gastos de hospedaje y alimentación de los
> trabajadores, cuando se prolongue o retarde el viaje por causa que no sea
> imputable a éstos."

**La consecuencia exacta que pide el encargo:** si el viaje se prolonga por
causa no imputable al operador, el hospedaje y la alimentación de esos días
extra **se le deben pagar**, aunque:

- excedan la política interna de la flota (el tope de política es un límite
  contractual de la empresa, no una obligación legal del trabajador), y
- excedan el tope fiscal de LISR 28-V ($750/día de alimentación) — el gasto
  puede volverse **no deducible para la empresa por el excedente**, y **al
  mismo tiempo pagadero al operador por completo**. Son dos ejes distintos:
  uno mide si el SAT permite deducirlo, el otro mide si la LFT obliga a
  pagarlo. Que el primero diga "no" no cambia la respuesta del segundo.

**Qué SÍ se le puede descontar al operador, con qué condiciones exactas** (art.
110 fr. I, texto ya citado arriba):

1. Solo por: anticipo de salarios, pagos hechos con exceso al trabajador,
   errores, pérdidas o averías de las que sea responsable. **No** por
   cualquier gasto que resultó "no deducible" para la empresa — la
   no-deducibilidad fiscal no es, por sí misma, una de las causales del art.
   110 fr. I. Si un gasto no es deducible porque el CFDI no llegó a tiempo,
   eso no convierte automáticamente ese monto en una "deuda" del operador; solo
   hay deuda cobrable si hay un faltante real (comprobado < anticipo, dinero
   que efectivamente no se justificó).
2. Antes de aplicar cualquier descuento por faltante, el motor tiene que restar
   primero lo que sea **pagadero** por los arts. 257/263 fr. I (viaje
   prolongado por causa ajena) — ese monto no entra al cálculo del faltante
   descontable, porque legalmente se le debe al operador, no es un gasto que
   él tenga que justificar.
3. Del faltante que sí queda como deuda genuina, el descuento está limitado
   por los dos topes A y B de §1 de este contador — nunca se cobra todo de
   golpe si excede esos límites.
4. Nunca se le carga interés sobre el saldo (art. 111, ya citado).

**Lo que hoy el motor no puede hacer en absoluto**
(`docs/conocimiento/34-proceso-liquidacion.md:393`, verificado contra
`engine.ts` en esta misma sesión — el archivo produce un solo campo
`diferencias: Diferencia[]` con un veredicto por gasto, sin ningún campo que
distinga "deducible" de "pagadero", y sin ningún dato de entrada sobre causa de
demora o si fue imputable al operador): **el motor de hoy no tiene forma de
saber que un viaje se prolongó por causa ajena al operador**, porque no captura
esa causa en ningún lado del modelo de `Gasto` ni de `Viaje`
(`src/types/cuadra.ts:19-49`, `:122-130`). Sin ese dato de entrada, ni siquiera
se puede empezar a construir esta regla — es un hueco de captura, no solo de
cálculo.

---

## Qué NO se puede determinar con la información disponible

Consolidado de todo lo marcado `sin_criterio` arriba, para que quede como
bandeja única:

1. **¿El 15% (RFA 2.9) y el 8%/$1,000,000 (RFA 2.2) corren por integrante o
   por coordinado?** Argumento textual razonado a favor de "por integrante"
   solo para la 2.2 (`11-huecos.md:378`); para la 2.9 lo extendí yo por
   analogía de redacción, sin confirmación de nadie. Ninguna de las dos tiene
   criterio del SAT.
2. **¿Los pagos de combustible en efectivo del 1-ene al 17-feb-2026 cuentan
   para el acumulador del 15% del ejercicio 2026?** La RFA 2026 entró en vigor
   el 18-feb-2026 según su propia ficha; un documento de investigación reporta
   (sin cita textual verificada por mí) que el Transitorio Primero la hace
   aplicable a "todo el ejercicio 2026". Contradicción potencial sin resolver.
3. **¿Qué comprobante específico se marca como "el excedente" cuando el
   acumulado del 15% se cruza a mitad de un pago, y qué pasa si un pago
   anterior se cancela o reclasifica después?** No hay mecánica definida en
   ninguna fuente.
4. **¿Rebasar el 8%/$1,000,000 de la RFA 2.2 tira solo el excedente o toda la
   facilidad del ejercicio, retroactivamente?** El mismo documento de
   investigación se contradice internamente (§4.2 dice solo el excedente; §6
   dice todo, retroactivo). No hay texto de la RFA que lo resuelva en este
   repo.
5. **¿Cómo se traduce "1 mes de salario" y "el excedente del salario mínimo"
   (LFT 110 fr. I) a un operador que cobra por viaje o por kilómetro, no por
   sueldo fijo?** Documentado como sin criterio por la propia investigación
   (`34-proceso-liquidacion.md:442`) — es el hueco más importante de los tres
   contadores porque bloquea CUALQUIER implementación del Tope A/B, no solo un
   caso extremo.
6. **La periodicidad de medición del 15%** (¿mensual, acumulado corriente, o
   solo al cierre?) — declarado SIN VERIFICAR por la fuente que lo diseñó.
7. **El valor y la variante correcta (general / frontera norte) del salario
   mínimo aplicable**, y si en 2026 sigue siendo un valor distinto de la UMA
   para efectos de la LFT — no verificado en este repo, dato que además cambia
   cada año por decreto de CONASAMI y tendría que vivir como referencia
   externa, no como constante hardcodeada.

Y un hueco de proceso, no de fondo, que vale la pena nombrar aparte: **no
existe ninguna ficha `normas/*.yaml` para la LFT** (ni el art. 110, ni el 111,
ni el capítulo de autotransportes 256-264). Todo lo laboral de este documento
descansa en `docs/conocimiento/11-huecos.md`, que es investigación con cita
primaria pero sin el formato ni el `estado_verificacion` que el resto del
sistema normativo del repo exige antes de que el producto pueda "afirmarlo"
(`normas/README.md:21-26`). Si estos tres contadores se van a construir, la
primera acción — antes de escribir una sola línea de motor — es convertir esas
citas en fichas YAML formales, del mismo modo que ya existe para `rfa-2026-2.9`
y `rfa-2026-2.2`.

---

## Resumen de estado_verificacion de lo citado

| Fuente | Tipo | Estado |
|---|---|---|
| `normas/rfa-2026-2.9.yaml` | Ficha | `verificado_fuente_primaria` |
| `normas/rfa-2026-2.2.yaml` | Ficha | `verificado_fuente_primaria` |
| `normas/lisr-27-III.yaml` (regla base que la 2.9 excepciona) | Ficha | `evidencia_corroborante` (no `verificado_fuente_primaria` — pendiente leer el PDF de diputados.gob.mx, según su propia `nota_verificacion`) |
| LFT arts. 110, 111, 256, 257, 260, 263 fr. I | Investigación (`docs/conocimiento/11-huecos.md`), sin ficha en `normas/` | Sin campo formal — tratado como "fuente primaria citada, sin formalizar" |
| CFF art. 11 (definición de ejercicio fiscal) | Supuesto de dominio general | No verificado en esta sesión, sin ficha |
| Salario mínimo vs. UMA en materia laboral | Supuesto de dominio general | No verificado en esta sesión, sin ficha |
