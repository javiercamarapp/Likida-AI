# El proceso de liquidación automática, de punta a punta

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (`00` a `11` en `likida-conocimiento/`).
> Este documento no vuelve a investigar el marco fiscal: lo aplica a un proceso completo,
> agrega el marco laboral que `11-huecos.md` encontró y que el proceso operativo no puede ignorar,
> y contrasta el diseño contra el código de Cuadra tal como existe hoy en
> `javiercamarapp/cuadra/src/lib/cuadra/`. Cada afirmación legal remite a la ola 1; no se repiten
> las citas textuales completas, solo la referencia y el número de artículo/regla.

---

## Resumen para el fundador

1. **El proceso tiene tres capas, no una**: de una sola vez (alta de operador y unidad), por viaje (la máquina de estados que ya existe en germen en Cuadra) y por periodo (mes y ejercicio, que hoy no existe en ningún lado). Confundir las tres es el error de diseño más caro: los cinco contadores fiscales y los dos laborales viven en la capa de periodo, no en la de viaje, y el motor de hoy (`cuadre/engine.ts`) solo ve un viaje a la vez.
2. **Hallazgo urgente y accionable hoy mismo**: el motor de cuadre que YA está construido marca *todo* combustible pagado en efectivo como no deducible, sin excepción. Eso contradice la corrección C1 que la propia ola 1 verificó: hasta 15% del combustible del ejercicio puede pagarse en efectivo y seguir siendo deducible (RFA 2026, regla 2.9). Hoy Cuadra le va a decir a un contralor que un gasto deducible no lo es. Ver CONFLICTOS.
3. **"Régimen del operador" no es un campo que el contralor elige**: se deriva de dos preguntas — ¿de quién es la unidad? ¿de quién es el permiso? Si el operador conduce el camión de la flota, la LFT (art. 256, capítulo propio del autotransporte) lo convierte en relación de trabajo *aunque el contrato diga lo contrario*. La ruta "tercero" (erogaciones por cuenta de terceros) solo existe cuando el operador aporta su propia unidad y su propio permiso.
4. **Los descuentos al operador tienen dos topes legales que ninguna liquidación puede saltarse** (LFT art. 110): la deuda exigible no puede superar un mes de su salario, y el descuento por periodo no puede pasar del 30% del excedente sobre el salario mínimo. Una liquidación que imprime "a pagar: $0" porque absorbió un anticipo grande contra un sueldo chico puede estar imprimiendo un número ilegal.
5. **Deducible y pagadero son dos veredictos distintos, no uno.** Cuando el viaje se alarga por una causa que no es culpa del operador (demora en aduana, bloqueo carretero, espera en andén), la LFT (art. 263, fr. I) obliga a pagar hospedaje y comida aunque el gasto rompa la política interna o el tope fiscal de $750/día. El motor tiene que separar "¿es deducible fiscalmente?" de "¿se le debe al operador?".
6. **El gasto sin comprobante tiene dos válvulas, de dos bolsillos distintos, que no se deben mezclar**: el 20% / $15,000 anuales por operador (RLISR 152, dinero de la persona) y el 8% / $1,000,000 de la empresa (RFA 2.2, dinero del negocio). El combustible queda fuera de las dos — tiene su propia válvula, la del 15% en efectivo.
7. **El cierre de mes no es un evento, son cuatro relojes corriendo en paralelo** con fechas distintas: 5 días naturales para contabilizar cada gasto (RCFF 33), día 17 para el pago provisional del 8%/16% si se usa la facilidad, día 17 para la DIOT, y el cierre del ejercicio (31-dic, o 31-mar del siguiente si el dinero se dio en diciembre) para los reintegros de terceros. Perder cualquiera de los cuatro tiene una consecuencia fiscal o laboral distinta.
8. **Lo que hoy sale hacia el ERP es un CSV plano de una fila por viaje** (`export.ts`): folio, operador, fecha, comprobado, anticipo, diferencia, estatus. No separa por concepto ni por grupo fiscal, no trae UUID + forma de pago por renglón (que el RCFF exige literalmente), no calcula los insumos de nómina, no genera la DIOT ni la carpeta de auditoría que el propio Reglamento del CFF exige tener lista para una revisión.
9. **La máquina de estados que existe hoy llega hasta "cuadrada".** No existe todavía "en excepción" como estado explícito, ni "liquidada" (con los topes laborales aplicados), ni "cerrada" (que bloquee más cargos), ni ninguna noción de periodo o ejercicio fiscal. El diseño de este documento es la ruta para llegar ahí, no una reescritura desde cero: el 60% del motor de reglas ya está construido y probado.
10. **Ningún CFDI de "liquidación" sale de Likida.** El Complemento de Liquidación del coordinado no existe (RFA Transitorio Segundo, ya verificado). Lo que Likida sí produce son: el veredicto de deducibilidad por comprobante, los insumos numéricos para que el sistema de nómina timbre las claves 003/050/081, y la póliza contable. El CFDI de flete del hombre-camión y el CFDI de nómina los timbra otro sistema con los números que Likida calculó.

---

## 1. Lo que la ola 1 ya decidió (y este documento no vuelve a discutir)

Tres decisiones de encuadre, ya fundamentadas, sobre las que se construye todo lo de abajo:

- **Cuál "liquidación" construye Likida**: la operativa — cierre de costo por viaje, no el pago de nómina ni el documento fiscal del coordinado (`09-liquidacion.md` §1).
- **Taxonomía de dos grupos, obligatoria desde el modelo de datos**: Grupo A (diésel, casetas, talacha, maniobras, pensión — costo de la unidad, nunca viático) vs. Grupo B (hospedaje, alimentación, transporte, renta de auto, kilometraje de la persona — sí es viático, y exige relación laboral o servicios profesionales del beneficiario) (`09-liquidacion.md` §3.1, `00-RESUMEN-EJECUTIVO.md` #5).
- **El régimen del operador determina el resto del flujo**, y este documento corrige la forma en que `09-liquidacion.md` §2.6 y §11 lo presentaba (dos rutas simétricas). No es una elección libre: `11-huecos.md` §1.3 encontró el Capítulo VI del Título Sexto de la LFT (arts. 256-264, "Trabajo de autotransportes"), que ningún archivo de la ola 1 había leído. El art. 256 dice que la relación entre el chofer y el propietario/permisionario del vehículo **es relación de trabajo por ley**, y que el pacto en contrario "no produce ningún efecto legal". Consecuencia de diseño: el campo `régimen del operador` se **deriva**, no se captura como opción:

  ```
  SI el operador conduce una unidad PROPIEDAD de la flota
     → régimen = SUBORDINADO (aplica LISR 93-XVII, RLISR 152, LFT completa)
  SI el operador aporta SU PROPIA unidad Y SU PROPIO permiso SICT
     → régimen = TERCERO/PERMISIONARIO (aplica RMF 2.7.1.12, exige CFDI de flete)
  SI el operador conduce unidad de la flota pero el pacto dice "prestador de servicios"
     → el pacto NO es válido (LFT 256) — el sistema debe advertir, no aceptar el flag
  ```

Ver también CONFLICTOS más abajo: esto es la corrección explícita de `11-huecos.md`, CONFLICTO 3.

---

## 2. El diagrama: la máquina de estados de punta a punta

Tres capas. La de viaje es la que hoy tiene código real; las otras dos casi no existen todavía.

### Capa 0 — de una sola vez (alta, no por viaje)

```
ALTA DEL OPERADOR
  │  nombre, teléfono, número de empleado
  │  → derivar RÉGIMEN (unidad + permiso, ver §1)
  │  → BASE DE ASIGNACIÓN (para la faja de 50 km, LISR 28-V / RLISR 57)
  │  → salario/tabulador (para los topes de descuento, LFT 110)
  ▼
ALTA DE LA UNIDAD
  │  placa, capacidad de tanque, rendimiento esperado por tipo de carga
  │  propietario (flota / operador) → alimenta la derivación de régimen
  │  TAG asignado, monedero de combustible asignado
  ▼
ALTA DE POLÍTICA
  │  topes de política (≤ topes fiscales de LISR 28-V, nunca por encima)
  │  medios de pago habilitados por bolsa (ver Capa 1)
```

### Capa 1 — por viaje (la liquidación operativa)

```
VIAJE ASIGNADO
  │  folio, origen, destino, ruta con sus plazas de cobro, operador, unidad,
  │  cliente, centro de costo, fecha de inicio
  ▼
PRESUPUESTADO
  │  litros = km de la ruta ÷ rendimiento histórico de esa unidad en esa carga
  │  casetas = suma de las plazas del corredor
  │  viáticos = días estimados × tope de política (nunca > tope fiscal LISR 28-V)
  ▼
ANTICIPADO ─────────► dispersión SEPARADA por bolsa
  │   Bolsa A (unidad: diésel, casetas, talacha) → monedero / TAG de la empresa
  │   Bolsa B (persona: hospedaje, alimentación) → tarjeta del patrón (preserva
  │            la exención del 20% de RLISR 152) o efectivo mínimo residual
  │   NUNCA depósito a cuenta personal del operador (LSS 27) sin registro contable
  │            que lo separe del salario
  ▼
EN RUTA ─────────────► captura continua por WhatsApp: foto + odómetro (si es
  │                    combustible) + geolocalización + hora, por gasto
  │                    emparejamiento ticket ↔ código de barras/QR (bandeja de
  │                    códigos pendientes, ya construida — migración 0016)
  │                    reglas de desviación EN LÍNEA, no esperan al regreso:
  │                    litros > capacidad del tanque, fuera de geocerca de la
  │                    ruta, dos cargas en intervalo menor al mínimo
  ▼
CERRADO OPERATIVO ───► el operador marca fin de viaje o entra el siguiente anticipo
  ▼
EN COMPROBACIÓN ─────► ingesta del estado de cuenta del monedero (sustituye la
  │                    foto del ticket de diésel si hay monedero — RMF 3.3.1.7)
  │                    ingesta del CFDI mensual del proveedor de TAG
  │                    validación de cada CFDI contra el SAT (UUID/RFC/vigencia)
  │                    + lista 69-B + monitor del 49 Bis
  │                    corrida completa del motor de reglas (§4)
  ▼
   ├── CERO hallazgos bloqueantes ─────────────────────────► CUADRADA
   │
   └── EN EXCEPCIÓN ◄── sólo lo que una regla marcó, con su fundamento citado
          │   HUMANO decide: el contralor autoriza, rechaza o pide más evidencia.
          │   Por qué aquí y no antes: es el único punto de la LFPDPPP (art. 26,
          │   fr. II) que exige intervención humana en toda decisión automatizada
          │   con efecto significativo sobre una persona (00-RESUMEN #10). Es
          │   también, por diseño de producto, la única pantalla que el contralor
          │   ve completa — todo lo demás pasó solo.
          ▼
        CUADRADA (con cada excepción resuelta y su decisión trazada: quién,
                  cuándo, con qué fundamento)
  ▼
LIQUIDADA ───────────► se calcula el saldo del operador aplicando LOS DOS TOPES
  │                    LABORALES (LFT 110): deuda exigible ≤ 1 mes de su
  │                    salario; descuento del periodo ≤ 30% del excedente sobre
  │                    el salario mínimo. Sin interés sobre el saldo (LFT 111).
  │                    Se separa DEDUCIBLE (veredicto fiscal, por comprobante)
  │                    de PAGADERO (veredicto laboral: LFT 257 y 263 pueden
  │                    obligar a pagar algo que no es deducible)
  ▼
CERRADA ─────────────► no admite más cargos. Genera:
                       - póliza contable separada por grupo fiscal
                       - insumos de nómina: OtrosPagos 003 / Percepción 050
                         (gravado y exento por separado) / Deducción 081
                       - si el operador es TERCERO: alerta de reintegro pendiente
                         con el reloj del cierre de ejercicio corriendo (§8)
```

### Capa 2 — por periodo (mes y ejercicio fiscal) — cross-cutting, no vive en un viaje

```
Continuo, por tenant, con corte mensual y anual:

  CONTADOR 15% combustible en efectivo (RFA 2.9)   ─┐
  CONTADOR 8% / $1,000,000 gasto ciego (RFA 2.2)    ─┤  alerta a ~80% del tope,
  CONTADOR 20% / $15,000 por operador (RLISR 152)   ─┤  bloqueo/advertencia dura
  CONTADOR faja 50 km (marca, no acumula)           ─┤  al llegar al tope
  CONTADOR deuda laboral por operador (LFT 110)     ─┘

  Reloj de 5 días (RCFF 33-B-I)         → cada gasto, no el mes
  Reloj del día 17 (8%/16% + DIOT)      → mensual
  Reloj de cierre de ejercicio          → 31-dic (o 31-mar si se dio en dic.)
  Reloj de renovación de monedero       → agosto-octubre (ficha 7/ISR)
  Reloj de constancia de viáticos       → 15-feb del año siguiente
```

Todos los contadores de la Capa 2 son estado **del tenant y del ejercicio fiscal**, no del viaje. Es la pieza que hoy no existe en ninguna parte del código (ver §11).

---

## 3. Etapa por etapa: qué se captura, qué valida el sistema y quién interviene

| Etapa | Qué se captura | Quién lo aporta | Qué valida el sistema (y contra qué) | ¿Interviene humano? |
|---|---|---|---|---|
| Alta de operador | Nombre, teléfono, propiedad de la unidad que va a conducir, propiedad del permiso | Contralor, en onboarding | Deriva régimen (LFT 256); si el pacto contradice la propiedad de la unidad, advierte | Sí — el contralor confirma la propiedad; el sistema no puede inferirla |
| Alta de unidad | Placa, capacidad de tanque, rendimiento esperado por tipo de carga | Contralor | — | Sí, captura inicial |
| Presupuesto | Ruta, km, plazas de peaje del corredor | Despachador / sistema de ruteo | Litros y casetas contra el histórico de esa unidad; viáticos contra topes fiscales (LISR 28-V) | No, si el presupuesto cae dentro de política |
| Anticipo | Monto, bolsa (A/B), medio de dispersión | Contralor / tesorería | Que el medio corresponda a la bolsa (combustible → monedero, no efectivo salvo residuo); que no vaya a cuenta personal | Sí — autoriza el anticipo; el sistema bloquea medios incorrectos por bolsa |
| En ruta | Foto del comprobante, odómetro (si es diésel), geolocalización, hora | Operador, por WhatsApp | Litros vs. capacidad del tanque; ubicación vs. geocerca de la ruta; intervalo mínimo entre cargas | No, salvo que la desviación sea severa (alerta en tiempo real al contralor, no bloqueo automático del viaje) |
| Comprobación — monedero | Estado de cuenta con Complemento de Estado de Cuenta de Combustibles: número de monedero, fecha/hora, litros, tipo de combustible, precio unitario, RFC de la estación (RMF 3.3.1.10 fr. III) | Emisor del monedero (Edenred, Toka, Sí Vale…), vía integración | Sustituye la foto del ticket como comprobante fiscal (RMF 3.3.1.7) | No |
| Comprobación — TAG | CFDI mensual consolidado del proveedor de TAG | Proveedor del TAG, vía integración o descarga | Cruza contra la bitácora del viaje (origen/destino/ruta) — insumo también del estímulo de casetas (RMF 9.1.8) | No |
| Comprobación — CFDI sueltos | UUID, RFC emisor/receptor, vigencia, estado 69-B | Motor de validación contra el SAT (`intake/sat.ts`, ya construido) | UUID existe y vigente; RFC receptor = RFC de la empresa; emisor no está en 69-B ni en el 49 Bis | No, salvo código ambiguo del SAT (602) — nunca se declara "apócrifa" sin más evidencia |
| Cuadre | — (etapa de cómputo, no de captura) | Motor de reglas (`cuadre/engine.ts` + lo que falta) | Las reglas de la §4 completas | No |
| Excepción | Decisión del contralor: autoriza, rechaza, pide evidencia | Contralor | Registra quién, cuándo, con qué fundamento se citó | **Sí, obligatorio** — LFPDPPP art. 26-II |
| Liquidada | — | Motor de topes laborales | Deuda ≤ 1 mes de salario; descuento ≤ 30% del excedente del mínimo (LFT 110) | No, salvo que el contralor quiera perdonar el saldo (siempre puede dar más, nunca menos de lo legal) |
| Cerrada | — | Motor de salida | Genera póliza, insumos de nómina, alerta de reintegro si aplica | No |
| Cierre de mes | — | Motor de contadores de periodo | Corre los cinco contadores fiscales + DIOT + pago provisional | Sí, para la presentación ante el SAT (el contralor o su contador la envía; Likida entrega el número, no presenta la declaración) |

---

## 4. Reglas de decisión explícitas (el motor)

Notación: **[CONSTRUIDO]** ya existe y corre en `cuadre/engine.ts` hoy (27-jul-2026). **[FALTA]** no existe en el código todavía. Cada regla lleva su fundamento y, si aplica, el archivo/línea donde vive hoy.

### 4.1 Reglas por comprobante (ya corren, viaje por viaje)

| # | Regla | Efecto | Fundamento | Estado |
|---|---|---|---|---|
| 1 | Combustible con `FormaPago = 01` (efectivo) | No deducible | LISR 27-III | **[CONSTRUIDO, pero INCOMPLETO]** — ver CONFLICTO 1: falta el contador del 15% (RFA 2.9) que puede volver deducible ese mismo gasto |
| 2 | Gasto NO combustible en efectivo > $2,000 | No deducible | LISR 27-III | [CONSTRUIDO] `engine.ts` líneas 108-111 |
| 3 | Viático de alimentación nacional > $750/día | El excedente no es deducible | LISR 28-V | [CONSTRUIDO] `engine.ts` líneas 113-118 — **cuidado**: no aplicar ese mismo tope a hospedaje nacional, que no lo tiene (`09-liquidacion.md` §2.3, corrección explícita) |
| 4 | Folio duplicado (UUID, o concepto+folio+monto) | Se excluye del total comprobado | Regla de cordura interna | [CONSTRUIDO] `engine.ts` líneas 66-83 |
| 5 | CFDI cancelado / EFOS / UUID no encontrado | No deducible | CFF 29-A; Anexo 69-B | [CONSTRUIDO] `engine.ts` líneas 154-163 |
| 6 | RFC receptor ≠ RFC de la empresa | No deducible | CFF 29-A | [CONSTRUIDO] `engine.ts` línea 151-153 |
| 7 | CFDI de combustible tipo I/E sin complemento de hidrocarburos, vigente desde el 24-abr-2026 | No deducible | RMF 2.7.1.48 | [CONSTRUIDO], dos niveles (con XML / sin XML) `engine.ts` líneas 166-189 |
| 8 | CFDI de diésel sin IEPS desglosado | Deducible, pero se pierde el acreditamiento del estímulo | LIF 2026 art. 20 | [CONSTRUIDO] `engine.ts` líneas 236-241 |

### 4.2 Reglas que faltan y son las que diferencian el producto (Capa 2, de periodo)

```
REGLA — Contador de combustible en efectivo (RFA 2026, 2.9)
  acumulado_efectivo_diesel_ejercicio += monto del gasto
  SI acumulado_efectivo_diesel_ejercicio / total_pagado_combustible_ejercicio > 15%
     → el EXCEDENTE sobre el 15% se marca no deducible (no el gasto completo,
       no el total del contador — la ley cae el excedente que rompe el tope)
  SI ratio > 12% (semáforo de alerta, propuesta de producto, no de ley)
     → avisar al contralor antes de que se rompa el tope
  [FALTA: periodicidad SIN VERIFICAR — ver SIN VERIFICAR #1]

REGLA — Contador de deducción ciega (RFA 2026, 2.2)
  acumulado_8pct_ejercicio += monto del gasto sin comprobante marcado bajo esta facilidad
  tope = MIN(8% × ingresos_propios_ejercicio, $1,000,000)
  SI acumulado_8pct_ejercicio > tope → el excedente NO es deducible
  SI se usa la facilidad → calcular ISR_definitivo = 16% × acumulado_del_periodo
     y generar el pago provisional exigible el día 17 del mes siguiente
  COMBUSTIBLE NUNCA entra a este contador (excluido desde 2024)
  [FALTA — no hay tabla de ingresos del tenant ni acumulador de ejercicio]

REGLA — Contador de no comprobado por operador (RLISR 152)
  acumulado_no_comprobado_operador_ejercicio += monto sin CFDI de este viático
  SI acumulado > $15,000 en el ejercicio → el excedente es gravado, no exento
  SI monto_sin_comprobar > 20% del total de viáticos "de esa ocasión" → el
     excedente sobre 20% es gravado, no exento
  SI el 80% restante NO se erogó con tarjeta del patrón → el 20% completo
     pierde la exención (se vuelve gravado íntegro), no solo el excedente
  [FALTA — no existe acumulador por operador ni verificación de medio de pago
   del 80% restante]

REGLA — Faja de 50 km (LISR 28-V; RLISR 57)
  distancia = distancia(base_asignación_operador, lugar_del_gasto)
  SI concepto ∈ Grupo B (viático) Y distancia ≤ 50 km → no deducible
  [FALTA — no existe el campo base_asignación en la tabla operador]

REGLA — Grupo A nunca es viático
  SI concepto ∈ {diesel, caseta, talacha, maniobras, pensión}
     → jamás puede ir a Percepción 050 del CFDI de nómina, sin importar quién
       lo pida o cómo se haya capturado
  [FALTA modelar 'grupo_fiscal' como campo explícito — hoy 'concepto' es un
   enum plano sin ese amarre estructural, types/cuadra.ts línea 5]

REGLA — Tope de deuda laboral (LFT 110, primer párrafo)
  saldo_exigible_operador ≤ 1 × salario_mensual_operador
  SI el faltante del viaje > ese tope → NO se puede cobrar todo de una vez;
     se prorratea a periodos siguientes
  [FALTA — no existe]

REGLA — Tope de descuento por periodo (LFT 110, fr. I)
  descuento_del_periodo ≤ 30% × (salario_del_periodo − salario_mínimo_del_periodo)
  SI el descuento calculado excede ese 30% → se aplica el máximo permitido y el
     resto se traslada al siguiente periodo (nunca se descuenta de golpe)
  [FALTA — no existe. SIN VERIFICAR cómo se mide "salario del periodo" cuando
   el pago es por viaje o por km — ver SIN VERIFICAR #3]

REGLA — Deducible ≠ pagadero (LFT 263-I, 257)
  SI el viaje se prolongó por causa NO imputable al operador (demora,
     bloqueo, espera documentada)
     → hospedaje y alimentación de esos días extra SE DEBEN pagar al
       operador aunque excedan la política interna o el tope fiscal de
       LISR 28-V. Se marcan "pagadero: sí, deducible: parcial/no".
  SI el viaje se acortó → el salario pactado por viaje NO se reduce (LFT 257)
  [FALTA — el motor de hoy solo produce un veredicto por gasto (deducible o
   no); no separa la pregunta laboral de la fiscal]

REGLA — Sin interés sobre saldos del operador (LFT 111)
  El saldo negativo de un operador (le debe a la empresa) NUNCA acumula
  interés, sin importar cuánto tiempo lleve abierto.
  [Guardarraíl de diseño, no una regla que "dispara": prohibición explícita
  a codificar en el motor de saldos]

REGLA — Reintegro vencido de tercero (RMF 2.7.1.12, fr. II inciso e)
  fecha_límite = 31-dic del ejercicio en que se entregó el anticipo
                 (31-mar del siguiente si se entregó en diciembre)
  SI hoy > fecha_límite Y el dinero no se usó ni se reintegró
     → alertar: el remanente se convierte en INGRESO ACUMULABLE del tercero,
       que debe emitir su propio CFDI de ingreso por esa cantidad
  [FALTA — no existe el reloj ni la alerta]
```

---

## 5. Qué pasa cuando algo no cuadra

Tres desenlaces posibles contra el anticipo (ya identificados en `09-liquidacion.md` §2.4 y §5.3), más el candado laboral que la ola 1 no tenía:

1. **Comprobado = anticipo** → cierra sin fricción, pasa a `CUADRADA`.
2. **Comprobado > anticipo** (el operador puso de su bolsa) → se autoriza el excedente si cae dentro de política y topes fiscales, o entra a `EN EXCEPCIÓN` si no. El reembolso al operador sigue las mismas reglas de medio de pago que el anticipo original (nunca a cuenta personal sin registro contable que lo separe).
3. **Comprobado < anticipo** (sobró) → dos caminos que dependen del régimen:
   - **Operador subordinado**: se descuenta de la siguiente liquidación, **sujeto a los dos topes de LFT 110** (§4.2). Si el faltante rebasa el tope de un mes de salario o el 30% del excedente del mínimo, el saldo se prorratea — no se puede "cerrar en cero" de golpe.
   - **Operador tercero (RMF 2.7.1.12)**: se reintegra por el mismo medio en que se entregó (cheque nominativo o traspaso), antes del cierre del ejercicio. Pasado ese plazo sin uso ni reintegro, es ingreso acumulable del tercero (regla de §4.2).

**Antes de aplicar cualquier descuento**, el motor debe correr la separación de §4.2 (deducible ≠ pagadero): un gasto que excede la política pero que la LFT obliga a pagar (viaje prolongado por causa ajena) **no se descuenta del operador**, aunque no sea deducible para la empresa. Son dos preguntas distintas sobre el mismo peso, y confundirlas produce un descuento ilegal.

---

## 6. El gasto sin comprobante: dos válvulas que no se deben confundir

| | RLISR 152 (persona) | RFA 2026, regla 2.2 (empresa) |
|---|---|---|
| ¿De quién es el gasto? | Del operador subordinado, sus viáticos | De la empresa/coordinado, cualquier gasto sin requisitos fiscales |
| Tope | 20% de cada ocasión, y $15,000 al año por persona | 8% de ingresos propios, tope $1,000,000 al año |
| Condición dura | El 80% restante debe erogarse con tarjeta del patrón, o se pierde toda la exención | Pagar 16% de ISR definitivo sobre lo deducido, con pagos provisionales al día 17 |
| ¿Aplica a combustible? | No — el combustible no es viático (Grupo A) | **No, excluido desde 2024** |
| ¿Qué pasa si se rompe? | El monto no comprobado se vuelve gravado para el operador | Todo lo deducido se vuelve no deducible retroactivo, y el 16% ya pagado **no se recupera** (es definitivo) |
| Contador que hay que llevar | Por operador, acumulado del ejercicio | Por tenant/coordinado, acumulado del ejercicio |
| Estado en Cuadra hoy | [FALTA] | [FALTA] |

El combustible pagado sin comprobante tiene su **propia** válvula — el 15% de la RFA 2026, regla 2.9 (§7) — y nunca debe mezclarse con ninguna de las dos de arriba. Meter diésel al 8% ciego es el error más caro que puede cometer una flota (`03-isr-facilidades.md`, resumen #4, ya verificado en ola 1).

---

## 7. El contador del 15% de combustible en efectivo

Mecánica exacta (RFA 2026, regla 2.9, ya verificada en `09-liquidacion.md` §3.6):

- Aplica solo a personas físicas o morales **dedicadas exclusivamente al autotransporte terrestre de carga federal**, tributando en Título II Cap. VII o Título IV Cap. II Sección I de la LISR.
- El límite es **15% del total de pagos por consumo de combustible del periodo**, no 15% de cada ticket ni un monto fijo.
- El CFDI del combustible pagado en efectivo **sigue siendo obligatorio**, y debe consignar el permiso vigente de Ley de Hidrocarburos del proveedor — la facilidad exime del medio de pago, no del comprobante.
- Rebasar el 15% no reduce proporcionalmente la deducción: **tira el excedente completo**, y con él su IVA acreditable (`00-RESUMEN-EJECUTIVO.md` #4 y "Riesgos abiertos, Fiscales").

**Semáforo propuesto para el producto** (no es ley, es diseño): alertar al contralor a partir de 12% acumulado, bloquear la promesa de deducibilidad al llegar a 15%.

**Lo que no está resuelto en fuente y hay que tratar con cuidado** (`00-RESUMEN-EJECUTIVO.md`, pendiente #9): la regla no dice si el 15% se mide mensual, acumulado del ejercicio, o anual cerrado. La lectura más consistente con el Transitorio Primero de la RFA (que dice que sus facilidades "aplican a todo el ejercicio 2026") es **acumulado del ejercicio fiscal**, y así se diseña este contador — pero un auditor podría exigir el corte mensual. Ver SIN VERIFICAR #1.

---

## 8. Cómo se cierra el mes: los relojes que corren en paralelo

Ninguno de estos cuatro relojes es "el cierre de mes" por sí solo. Los cuatro corren en paralelo, con disparadores y consecuencias distintas:

| Reloj | Plazo | Qué dispara si se pasa | Fundamento |
|---|---|---|---|
| **Contabilización de cada gasto** | 5 días naturales desde la operación | El asiento nace fuera de plazo para la contabilidad electrónica — riesgo en revisión, aunque el gasto siga siendo deducible | RCFF art. 33, apartado B, fr. I (hallazgo de `11-huecos.md` §1.1, ningún archivo de la ola 1 lo tenía) |
| **Pago provisional del 8%/16%** (si se usa la facilidad de gasto ciego) | Día 17 del mes siguiente al que se dedujo (con corrimiento por terminación de RFC — tabla en `03-isr-facilidades.md` §4.7) | Recargos y actualización sobre el 16% no enterado a tiempo | RFA 2026, regla 2.2, fr. IV |
| **DIOT** | Día 17 del mes siguiente | Infracción por no presentar la declaración informativa; para coordinados, se puede presentar de forma global por el coordinado y sus integrantes | LIVA art. 32, fr. VIII; RFA 2026, regla 2.11 (verificada en `11-huecos.md` §1.2 — hueco de obligación que ningún archivo de la ola 1 cubrió) |
| **Reintegro de erogaciones por cuenta de terceros** | Último día del ejercicio (31-dic), o 31-mar del siguiente si el dinero se entregó en diciembre | El remanente se vuelve ingreso acumulable del tercero, que debe timbrar su propio CFDI | RMF 2026, regla 2.7.1.12, fr. II inciso e) |

Dos relojes adicionales, de menor frecuencia pero con multa nombrada, que conviene vigilar en la misma capa:

- **Constancia/CFDI de nómina con el total de viáticos del año**: a más tardar el 15 de febrero del año siguiente (LISR 99-VI, cumplida vía CFDI de nómina por RMF 2.7.5.3).
- **Relación individualizada de operadores bajo la facilidad del 7.5%**: 15-feb-2027, ficha 65/ISR (RFA 2026, regla 2.1).
- **Renovación de la autorización del emisor del monedero**: agosto-octubre de cada año (ficha 7/ISR). No es un reloj de la flota, pero si el emisor no renueva, el cliente se queda sin comprobante deducible de combustible sin aviso — vale la pena monitorear el padrón, no solo confiar en la integración.

**Ninguno de estos cuatro relojes existe hoy en el código de Cuadra.** El motor de cuadre corre por viaje, sin noción de mes ni de ejercicio fiscal (ver §11).

---

## 9. Qué sale hacia el ERP

Lo que la etapa `CERRADA` debería producir, con su fundamento:

1. **Póliza contable separada por grupo fiscal**, no por proveedor: costo de operación (Grupo A deducible), viáticos dentro de tope (Grupo B deducible), viáticos excedidos (no deducible), gasto sin comprobante bajo la facilidad del 8% (no deducible con IVA, gravado el 16%), y multas (nunca deducibles, LISR 28-VI).
2. **Insumos para el CFDI de nómina**: los tres importes de las claves `OtrosPagos` 003 (lo entregado), `Percepciones` 050 desglosado en gravado y exento (lo comprobado, aplicando las cinco condiciones de RLISR 152 — nunca copiar la tabla de ejemplo del SAT a ciegas, ver `09-liquidacion.md` §3.3), y `Deducciones` 081 (el ajuste). Likida **calcula** estos tres números; el sistema de nómina los **timbra**.
3. **DIOT**: proveedor, RFC, tasa, IVA trasladado, IVA retenido, forma de pago — dato que ya existe limpio en el modelo de gasto (`ivaTraslado`, `formaPago` en `types/cuadra.ts`) y que hoy no se exporta con ese propósito.
4. **UUID y forma de pago por renglón** en cualquier exportación contable — es el requisito literal del RCFF art. 33-B-III ("identificación de cada operación... relacionándolas con los folios... de tal forma que pueda identificarse la forma de pago"), verificado en `11-huecos.md` §1.1.
5. **Carpeta de auditoría** (diagrama del sistema, descripción de cómo se almacenan y procesan los datos, export íntegro) — no es opcional: el RCFF art. 34 obliga al **cliente** a tenerla disponible para el SAT, y si Likida no se la entrega, el cliente incumple sin saberlo (`11-huecos.md` §1.1).
6. **Lo que Likida NO emite**: el CFDI de flete del hombre-camión (lo timbra el tercero), el CFDI de nómina (lo timbra el sistema de nómina con los insumos de Likida), y el Complemento de Liquidación del coordinado (no existe — RFA Transitorio Segundo, ya verificado en ola 1). Likida entrega números y veredictos con fundamento citado, no documentos fiscales que no le corresponde emitir.

---

## 10. Cómo lo hacen hoy las flotas, y qué cambia

Resumen operativo — el detalle completo, con las patologías de la caja chica y el benchmark de EE. UU., ya está en `09-liquidacion.md` §2, §4 y §5; aquí solo el contraste directo:

| | Hoy (sector, según `09-liquidacion.md`) | Diseño de este documento |
|---|---|---|
| Captura de gastos | Sobre físico al regreso, capturado a mano en Excel o en el módulo del TMS, días o semanas después | Continua, por WhatsApp, con contexto (odómetro, geo) en el momento del gasto |
| Comprobante de combustible con monedero | La gasolinera factura al operador o a la flota (**prohibido por regla**, RMF 3.3.1.7) — hallazgo de producto más importante de la ola 1 | Se ingiere el Complemento de Estado de Cuenta del emisor; la foto del ticket es solo control operativo |
| Cruce contra el anticipo | Manual, al cierre, tres desenlaces sin lógica sistemática | Automático, con los tres desenlaces del §5 y los topes laborales aplicados |
| Contadores fiscales (15%, 8%, 20%, faja de 50 km) | Nadie los lleva (`09-liquidacion.md` §4.6, "el hueco") | Contadores de periodo con semáforo (§4.2, §6, §7) — **hoy tampoco los lleva Cuadra**, ver §11 |
| Topes laborales del descuento (LFT 110) | Nadie los aplica — el hallazgo es de esta ola, no de la primera | Motor de saldos con los dos topes como candado duro |
| Salida contable | Póliza manual, sin separación por régimen fiscal | Póliza automática separada por grupo fiscal |
| Salida a nómina | Captura manual de las claves 003/050/081, con errores frecuentes de qué monto va en cada una | Insumos calculados automáticamente, con las cinco condiciones de exención verificadas |
| Documento fiscal del coordinado | Formato de 2015 por transitorio, porque el Complemento de Liquidación nunca se publicó | Igual — Likida no promete resolver esto (no se puede) |

---

## 11. Brecha entre este diseño y lo que Cuadra tiene construido hoy

Revisado directamente en `javiercamarapp/cuadra/src/lib/cuadra/` el 27-jul-2026:

| Pieza del diseño | ¿Existe hoy? | Evidencia |
|---|---|---|
| Motor de cuadre determinístico por viaje | **Sí** | `cuadre/engine.ts`, con 8 reglas por comprobante corriendo (§4.1) |
| Validación de CFDI contra el SAT + EFOS | **Sí** | `intake/sat.ts` (SOAP público, `ConsultaCFDIService`) |
| Complemento de hidrocarburos, dos niveles | **Sí** | `engine.ts` líneas 166-189 |
| Acreditamiento de IEPS/IVA/peaje | **Sí** | `engine.ts` líneas 216-242 |
| Bandeja de códigos pendientes (emparejamiento de acercamientos) | **Sí** | migración `0016_codigo_pendiente.sql`, `repo.ts` |
| Grupo fiscal A/B explícito | **No** | `concepto` es un enum plano (`diesel|caseta|factura|viaticos|otro`), `types/cuadra.ts` línea 5 — no hay un campo estructural que impida que "diésel" llegue a Percepción 050 |
| Régimen del operador derivado (unidad + permiso) | **No** | tabla `operador` solo tiene `nombre, telefono, numero_empleado, activo` (migración `0001_init.sql`) — no hay campo de régimen ni de propiedad de unidad/permiso |
| Base de asignación / faja de 50 km | **No** | no existe el campo, ni la regla en `engine.ts` |
| Unidad como entidad con capacidad de tanque y rendimiento | **Parcial** | vive en `tenant.config` (jsonb) por placa (`config.ts`, `UnidadConfig`), no en una tabla propia ni ligada a propietario/permiso |
| Contador 15% combustible en efectivo (RFA 2.9) | **No** — y contradicho | `engine.ts` marca **todo** combustible en efectivo como no deducible sin excepción (líneas 106-107). Ver CONFLICTO 1 |
| Contador 8% / $1,000,000 (RFA 2.2) | **No** | no hay tabla de ingresos del tenant ni acumulador de ejercicio |
| Contador 20% / $15,000 por operador (RLISR 152) | **No** | no hay acumulador por operador ni verificación del medio de pago del 80% restante |
| Topes laborales de descuento (LFT 110) | **No** | no hay salario del operador en el modelo de datos, ni lógica de tope |
| Deducible ≠ pagadero (LFT 263, 257) | **No** | el motor produce un solo veredicto por gasto |
| Máquina de estados hasta "cerrada" con periodo fiscal | **Parcial** | `viaje.estatus` solo tiene `abierto` y `en_cuadre` en uso real (`conv.ts` línea 40); `liquidacion.estatus` es `cuadrada / con_diferencias / revisar` (`types/cuadra.ts` línea 77) — no existe `en_excepcion` como estado propio, ni `liquidada`, ni `cerrada`, ni ningún concepto de mes/ejercicio |
| Ingesta de estado de cuenta de monedero (ECC) | **No** | `intake/ocr.ts` procesa fotos de tickets; no hay parser del Complemento de Estado de Cuenta de Combustibles para Monederos Electrónicos |
| Ingesta de CFDI mensual de TAG | **No** | no hay conector |
| Salida a ERP | **Parcial** | `export.ts` genera un CSV de una fila por liquidación (folio, operador, fecha, comprobado, anticipo, diferencia, estatus, num_diferencias) — sin desglose por concepto, sin UUID/forma de pago por renglón, sin grupo fiscal |
| DIOT | **No** | no existe |
| Insumos de nómina 003/050/081 | **No** | no existe |
| Carpeta de auditoría (RCFF 34) | **No** | no existe como entregable |

**Lectura para el fundador:** lo construido hoy es sólido en la capa de "¿este comprobante individual es válido y deducible?" — que es, no por casualidad, exactamente la capa donde vive el diferenciador frente a la competencia (validación SAT, EFOS, hidrocarburos, acreditamiento). Lo que falta por completo es la capa de **periodo**: los cinco contadores fiscales y los dos laborales que ningún competidor lleva tampoco, y que son la propuesta de valor de mayor defensa (`00-RESUMEN-EJECUTIVO.md` #4). Ese es el orden de construcción que se sostiene con lo que ya existe.

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Corregir la regla de combustible en efectivo en `engine.ts` para que consulte el contador acumulado del 15% antes de declarar "no deducible" (o, mientras no exista el contador, suavizar el mensaje a "verificar contra el 15% del ejercicio" en vez de una negación tajante) | Hoy el código contradice la corrección C1 ya verificada por la propia ola 1; puede decirle a un contralor que pierde una deducción que sí tiene | Bajo | Inmediato — antes de la demo del 6-ago |
| Agregar el campo `grupo_fiscal` (A/B) explícito al modelo de gasto, derivado del `concepto`, no opcional | Es el candado estructural que impide que diésel llegue a Percepción 050 de nómina | Bajo | Fase 1 |
| Agregar `régimen` y `base_asignación` a la tabla `operador`, derivando `régimen` de dos preguntas (propiedad de unidad, propiedad de permiso), nunca como selección libre | Sin esto no se puede correr la faja de 50 km ni decidir si el "viático" es válido o es precio de flete | Medio | Fase 1 |
| Construir la tabla `unidad` con capacidad de tanque, rendimiento esperado por tipo de carga y propietario, sacándola de `tenant.config` jsonb | Hoy vive en config, no relacionada a la unidad como entidad ni al régimen del operador | Medio | Fase 1 |
| Construir el contador de periodo del 15% de combustible en efectivo, por tenant y ejercicio, con semáforo a 12% | Es el contador de mayor retorno inmediato: nadie en el mercado lo lleva y hoy ni Cuadra | Medio | Fase 1 |
| Construir los contadores del 8%/$1,000,000 y del 20%/$15,000 por operador | Mismo argumento — propuesta de valor defendible que ningún competidor tiene | Medio-Alto | Fase 1-2 |
| Meter los dos topes laborales (LFT 110) al motor de saldos del operador | Sin esto, la liquidación puede imprimir un descuento o un "a pagar $0" ilegal | Bajo | Fase 1 |
| Separar el veredicto **deducible** del veredicto **pagadero** por gasto (LFT 263-I, 257) | Un viaje prolongado por causa ajena obliga a pagar aunque el gasto no sea deducible ni cumpla política | Medio | Fase 1 |
| Definir el estado `EN_EXCEPCION` explícito en `liquidacion.estatus` (hoy es implícito vía `revisar`) y el estado `CERRADA` con bloqueo de cargos nuevos | Cierra la máquina de estados hasta donde la propone este documento | Bajo | Fase 1-2 |
| Construir el parser del Complemento de Estado de Cuenta de Combustibles (monedero) | Es mejor dato que cualquier OCR — timbrado, granular, y evita pedirle al operador una foto que fiscalmente no sirve | Medio | Fase 2 |
| Construir el export de DIOT (proveedor, RFC, tasa, IVA trasladado/retenido, forma de pago) | El dato ya existe limpio en el modelo; es una exportación, no una funcionalidad nueva | Bajo-Medio | Fase 2 |
| Calcular los tres insumos de nómina (003/050/081) con las cinco condiciones de exención de RLISR 152 verificadas, no copiadas de la tabla de ejemplo del SAT | Evita timbrar como exento un monto que en realidad es gravado | Medio | Fase 2 |
| Agregar UUID y forma de pago por renglón a cualquier export contable | Requisito literal del RCFF 33-B-III | Bajo | Fase 2 |
| Armar la carpeta de auditoría (diagrama del sistema, descripción de almacenamiento/procesamiento, export íntegro) como entregable de onboarding | El cliente está obligado a tenerla (RCFF 34); si Likida no se la da, el cliente incumple sin saberlo | Medio | Antes del primer cliente pagado |
| Construir el reloj de reintegro de terceros (alerta antes del 31-dic / 31-mar) | Sin alerta, el remanente se convierte en ingreso acumulable del tercero sin que nadie se entere a tiempo | Bajo | Fase 2 |

---

## CONFLICTOS

**CONFLICTO 1 — el código ya construido contradice la corrección C1 de la propia ola 1.**
`00-RESUMEN-EJECUTIVO.md` (corrección C1) y `09-liquidacion.md` (resumen #7) verificaron que el diésel pagado en efectivo **sí puede ser deducible** para autotransporte de carga federal, hasta el 15% del total pagado por combustible en el ejercicio (RFA 2026, regla 2.9). Sin embargo, `cuadre/engine.ts` (líneas 106-107, leído hoy 27-jul-2026) marca **cualquier** combustible con `FormaPago = 01` como no deducible, sin excepción y sin consultar ningún contador del 15%. El propio archivo `01-cfdi-cff.md` y `05-hidrocarburos.md` sostenían la versión dura (sin excepción); `03-isr-facilidades.md` y `09-liquidacion.md` corrigieron con la versión del 15%. El código de producción hoy implementa la versión **incorrecta** (la dura), no la corregida. No se tocó el código para este encargo (fuera de mandato: "esta ola es de investigación y diseño"); se deja señalado para que se corrija con evidencia, no a ciegas.

**CONFLICTO 2 — "régimen del operador" como elección libre de dos rutas simétricas.**
`09-liquidacion.md` §2.6 y §11 presentan la ruta "empleado" (viáticos) y la ruta "tercero" (RMF 2.7.1.12) como dos caminos legales igualmente disponibles que "Likida tiene que preguntar cuál antes de procesar nada" — es decir, como un campo de selección. `11-huecos.md`, CONFLICTO 3, ya corrigió esto con el art. 256 de la LFT: la ruta "tercero" **solo** es válida cuando el operador aporta su propia unidad y su propio permiso; si conduce la unidad de la flota, la relación de trabajo existe por ley aunque el contrato diga lo contrario. Este documento adopta la versión corregida de `11-huecos.md` (§1 de este mismo archivo). Se deja constancia por si algún material comercial o técnico posterior cita `09-liquidacion.md` §11 sin la corrección: modelaría un campo con dos valores que la ley no trata como equivalentes.

---

## SIN VERIFICAR

1. **Periodicidad del contador del 15% de combustible en efectivo** (RFA 2026, regla 2.9): la regla no dice si se mide mensual, acumulado del ejercicio o anual cerrado. Este documento diseñó el contador como acumulado del ejercicio, por ser la lectura más consistente con el Transitorio Primero de la RFA, pero **no hay confirmación de un fiscalista ni criterio del SAT**. Ya estaba señalado como pendiente #9 en `00-RESUMEN-EJECUTIVO.md`.
2. **Si el tope de $1,000,000 de la regla 2.2 es por integrante o por coordinado.** `11-huecos.md` §3 propone un argumento textual (el tope corre por integrante, porque la regla habla de "los contribuyentes" y los integrantes son los contribuyentes en un coordinado), pero lo marca explícitamente como "argumento textual nuevo, no certeza". El contador de §4.2 asume por integrante; puede estar mal.
3. **Cómo se mide "un mes de salario" y "el excedente del salario mínimo" (LFT 110) cuando el operador cobra por viaje o por kilómetro, no por sueldo fijo.** Ningún archivo de la ola 1 ni de esta ola encontró un criterio que aterrice esos dos topes a un esquema de pago variable. La regla de §4.2 es una lectura razonada (usar el promedio del periodo relevante), no una certeza verificada en fuente.
4. **Si la deducción del 8% de gasto ciego reduce o no la base de PTU.** Sigue abierto desde `00-RESUMEN-EJECUTIVO.md`, pendiente #8. No afecta el diseño del proceso, pero sí el cálculo que Likida le muestre al cliente en el cierre de mes.
5. **Si hay una Segunda Resolución de Modificaciones a la RMF 2026 posterior al 9-jul-2026** que haya tocado las reglas 2.2, 2.9 o 2.7.1.12 citadas en este documento. No se verificó el índice del DOF más allá del 27-jul-2026 (mismo pendiente que `11-huecos.md`, SIN VERIFICAR #1).
6. **Las disposiciones de carácter general de la STPS sobre el registro electrónico de jornada** (LFT art. 132, fr. XXXIV): el Transitorio Quinto las exige desde el 1-ene-2027 pero no se han emitido. No se incorporó como reloj en la §8 de este documento porque su fecha de exigibilidad es posterior al horizonte de esta liquidación; queda como módulo de Fase 3 (`11-huecos.md`, acciones concretas).
7. **Si "erogar con tarjeta del patrón" (RLISR 152) admite el monedero de combustible como equivalente cuando el gasto NO es de combustible.** No se encontró esa equivalencia resuelta en ningún archivo de la ola 1. Se asumió, para el diseño de §4.2, que la tarjeta del patrón debe ser una tarjeta de crédito, débito o servicios distinta del monedero de combustible (que por regla 3.3.1.6 solo puede usarse para comprar combustible).
8. **El estado exacto del código de Cuadra descrito en §11** corresponde a una lectura del repositorio el 27-jul-2026. Si el código cambió después de esa fecha, la tabla de brecha puede estar desactualizada.

---

## Fuentes

Este documento no realizó investigación normativa nueva: aplicó y extendió el marco fiscal y legal ya verificado en fuente primaria por la ola 1. Toda cita legal remite a los siguientes archivos, que contienen el texto íntegro, el artículo/regla y la fecha de la fuente primaria consultada:

- `likida-conocimiento/00-RESUMEN-EJECUTIVO.md` — correcciones C1 a C6, las 10 cosas que cambian el producto, riesgos abiertos.
- `likida-conocimiento/09-liquidacion.md` — proceso operativo hoy, marco fiscal del anticipo (LISR 27, 28-V, 93-XVII, 99-VI; RLISR 41, 57, 58, 152, 263; RMF 2.7.1.12, 2.7.5.3, 3.3.1.6, 3.3.1.7, 3.3.1.10; RFA 2026 completa; LSS 27), mapa de software existente, máquina de estados original.
- `likida-conocimiento/03-isr-facilidades.md` — mecánica completa de la regla 2.2 (8%/$1,000,000/16%), fechas exactas del pago provisional del día 17, tabla de corrimiento por terminación de RFC.
- `likida-conocimiento/11-huecos.md` — Capítulo laboral del autotransporte (LFT arts. 256-264, 110, 111), contabilidad electrónica y el reloj de 5 días (RCFF 33, 34), DIOT (LIVA 32-VIII, RFA 2.11), jornada laboral (DOF 01-may-2026), CONFLICTO 3 (régimen del operador vs. LFT 256).
- `likida-conocimiento/10-contradicciones.md` — verificación de que la Primera Modificación a la RMF 2026 no tocó las reglas del complemento de hidrocarburos citadas aquí, y del criterio 43/ISR/PI sobre pagos a través de terceros.
- `likida-conocimiento/00-INDICE.md` — mapa de qué archivo cubre qué.

Fuentes primarias del propio repositorio de código (Cuadra), leídas directamente el 27-jul-2026 para la §11 (brecha) y el CONFLICTO 1:

- `javiercamarapp/cuadra/src/lib/cuadra/cuadre/engine.ts`
- `javiercamarapp/cuadra/src/lib/cuadra/cuadre/guardia.ts`
- `javiercamarapp/cuadra/src/types/cuadra.ts`
- `javiercamarapp/cuadra/src/lib/cuadra/config.ts`
- `javiercamarapp/cuadra/src/lib/cuadra/export.ts`
- `javiercamarapp/cuadra/src/lib/cuadra/conv.ts`
- `javiercamarapp/cuadra/src/lib/cuadra/repo.ts`
- `javiercamarapp/cuadra/supabase/migrations/0001_init.sql`, `0003_costos.sql`, `0004_fiscal_config.sql`, `0007_acreditamiento.sql`, `0016_codigo_pendiente.sql` (solo lectura, sin modificar ni crear migraciones)

No se usó WebSearch, WebFetch ni exa en esta ola: el encargo es de diseño de proceso sobre un marco ya investigado, y las reglas duras del encargo piden construir encima de la ola 1, no repetirla.
