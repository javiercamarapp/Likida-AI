# Verificación de auditoría — IEPS de diésel y estímulo de casetas 50%

**Fecha:** 19-ago-2026 · **Auditor:** verificación fiscal-técnica sobre el código vivo
**Alcance:** hallazgos A (IEPS acreditable del diésel) y B (estímulo de peaje 50%) de la auditoría del 27-jul-2026. El hallazgo de combustible en efectivo (RFA 2.9, válvula del 15%) ya estaba confirmado cerrado y no se re-audita aquí.
**Método:** lectura línea por línea de `src/lib/likida/cuadre/engine.ts` (1,184 líneas), `src/lib/likida/liquidacion/acreditable.ts`, `src/lib/likida/intake/desglose_peaje.ts`, `src/lib/likida/config.ts`, las fichas de `normas/` y el corpus `docs/conocimiento/04-iva-ieps-estimulos.md`; ejecución de las pruebas relevantes.

**Pruebas ejecutadas (todas verdes):**

```
npx vitest run src/lib/likida/cuadre/diesel_estimulo.test.ts \
  src/lib/likida/cuadre/engine_diesel_medio_pago.test.ts \
  src/lib/likida/liquidacion/acreditable.test.ts \
  src/lib/likida/intake/desglose_peaje.test.ts        → 65/65 ✓
npx vitest run src/lib/likida/cuadre/engine.test.ts \
  src/lib/likida/cuadre/resumen.test.ts \
  src/lib/likida/cuadre/cifras.test.ts                → 154/154 ✓
```

---

## HALLAZGO A — IEPS acreditable del diésel

### VEREDICTO: **PARCIAL**

El defecto que la auditoría señaló (cifra en pesos derivada del IEPS desglosado del CFDI, que salía siempre cero) **ya no existe**: el motor retiró la cifra en pesos a propósito y hoy entrega **litros elegibles** con el filtro de medio de pago correcto. Pero el **cálculo correcto** (cuota disminuida semanal del DOF × litros, por fecha de compra) **sigue sin implementarse**: la tabla de cuotas ya existe como dato en el repo y **ningún código la consume**. La omisión es deliberada y está documentada — no es un bug silencioso — pero el estímulo en pesos sigue sin calcularse.

### Qué hace el código hoy

1. **La cifra en pesos está retirada a propósito.** `engine.ts:974-978`: `const iepsAcreditable = 0;` con comentario explícito: "el estímulo del LIF 20-A no es una cifra que este motor pueda calcular (necesita la cuota semanal del DOF)… el dato útil es `litrosDieselAcreditables`". Ninguna ruta produce `iepsAcreditable > 0` (confirmado también en `resumen.ts:82-94`, que trata el cálculo previo como código muerto eliminado).
2. **Ya NO se busca el IEPS desglosado como base del estímulo.** El comentario de `engine.ts:1014-1016` cita la ficha: "cuota IEPS vigente al momento de la compra × LITROS. No es el IEPS trasladado en el CFDI." La fórmula vieja (sumar `iepsTraslado`) desapareció.
3. **Lo que sí se calcula: litros elegibles** (`engine.ts:1034-1056`), con estas comprobaciones:
   - Solo diésel por clave SAT: `clavesDieselIeps` = `['15101505']` (`config.ts:130`); la gasolina queda fuera (`engine.ts:1011-1013`).
   - **Medio de pago SIN válvula del 15%**: `engine.ts:1035` `const pagoElectronico = !!g.formaPago && g.formaPago !== '01';` — efectivo NO acredita, y "sin forma de pago conocida" tampoco se supone electrónico. El comentario de `engine.ts:1028-1031` lo dice textual: el requisito del 4º párrafo de LIF 20-A-IV "NO tiene la válvula del 15% que la RFA 2.9 sí concede para ISR: la facilidad salva la deducción, no el acreditamiento". Además `SIN_ACREDITAMIENTO` (`engine.ts:965`) incluye `combustible_efectivo`, `combustible_efectivo_dentro15` y `efectivo_sobre_15`: aun el efectivo deducible por la facilidad no acredita litros. **Este punto está bien resuelto y probado** (`engine_diesel_medio_pago.test.ts`, 8 casos: efectivo→0, sin forma→0, transferencia→sí, otros medios→sí, gasolina→no, sin XML→no; `diesel_estimulo.test.ts`, 6 casos con un ticket real congelado).
   - Exige XML verificado (`engine.ts:988`) y coteja litros del OCR contra monto/precio de referencia con tolerancia 0.5×–2× (`engine.ts:1045-1056`, `diesel_desviacion`).
4. **La tabla de cuotas semanales del DOF EXISTE, pero solo como dato:** `normas/datos/cuota-ieps-diesel.yaml` — 4 semanas (25-jul a 21-ago-2026), cada fila con `{vigencia, porcentaje_estimulo, estimulo_por_litro, cuota_disminuida_por_litro, fuente: {dof, edicion, codNota}}`, capturadas el 16-ago-2026 desde SIDOF con verificación aritmética (estímulo + cuota disminuida = 7.3634 exacto en las 4). La alimenta una rutina de vigilancia semanal (`normas/.latido-cuota-diesel`) que hoy corre con fricción: el entorno de nube no tiene egress y la captura del 16-ago se hizo desde sesión local. El propio archivo declara: **"el motor todavía NO consume este archivo (cablearlo es el siguiente paso declarado)"**. Verificado por grep: el único lugar del repo que lo referencia es `scripts/mejora-diaria/encargos/dof-diario.md:18` — cero consumidores en `src/`.
5. **La fecha de compra**: hoy es irrelevante para el motor porque no aplica ninguna cuota. La tabla ya trae vigencias por semana, listas para aplicarse por fecha, pero ese cruce no existe en código. Faltan además las semanas anteriores al 25-jul-2026 (barrido histórico pendiente, declarado en el YAML).
6. **El papel es honesto:** `acreditable.ts:78-80,94-100` imprime "Diésel elegible para el estímulo de IEPS" en LITROS, tono `condicionado`, con el pie: "El estímulo de diésel se calcula con la cuota SEMANAL vigente al momento de cada compra; se entregan los litros para que su contador aplique la cuota fechada."

### Qué exige la norma (según el corpus, con fuente)

- `normas/lif-2026-20-A.yaml` (verificado_fuente_primaria, LIF 2026 DOF 07-11-2025): "el monto que se podrá acreditar será el que resulte de multiplicar la cuota del impuesto especial sobre producción y servicios… **con los ajustes que, en su caso, correspondan, vigente en el momento en que se haya realizado la importación o adquisición** del diésel…, por el número de litros importados o adquiridos" — y su `advertencia_critica`: los "ajustes" son la cuota **DISMINUIDA**, que cambia **semanalmente** (ver `criterio-1-LIF-PI.yaml`: usar la cuota entera es práctica indebida que alcanza a quien presta el servicio).
- `docs/conocimiento/04-iva-ieps-estimulos.md` §2: "El IEPS de diésel no viene en el ticket. La ley prohíbe que la gasolinera lo desglose (LIEPS art. 19-II). El estímulo se calcula litros × cuota, no leyendo un número del comprobante." Y §punto 27: si no se acredita en el ejercicio, se pierde (LIF 20-A-IV 3er párrafo, citado literal en la línea 253).
- Medio de pago electrónico como requisito del acreditamiento: LIF 20-A-IV 4º párrafo (citado en `engine.ts:1028` y probado en tests).

### Qué falta exactamente

1. **Cablear** `normas/datos/cuota-ieps-diesel.yaml` al cálculo: cuota disminuida vigente **en la fecha de cada compra** × litros elegibles de ese comprobante. La estructura de datos ya existe; el cruce por vigencia, no.
2. Resolver la **tensión normativa abierta** que el propio YAML declara (16-ago-2026): dos lecturas del texto —cuota ÍNTEGRA vs cuota DISMINUIDA, factor 3.5× entre ellas— pendientes de que "un fiscalista con cédula firme una". Hasta entonces la política del producto (decisión D2 del roadmap) es mostrar litros y jamás pesos. Es decir: el faltante no es solo técnico, es una decisión fiscal pendiente de firma.
3. Completar el **histórico de cuotas** anterior al 25-jul-2026 y asegurar la cadencia semanal de captura (el riesgo declarado en `.latido-cuota-diesel` es que la rutina de nube sigue sin egress).
4. Menor, de redacción: la diferencia `ieps_no_desglosado` (`engine.ts:1058-1059`) se dispara en prácticamente todo CFDI de diésel (LIEPS 19-II prohíbe el desglose) y su nota dice que sin el desglose "se complica documentar el estímulo" — contradice al corpus, que dice que el estímulo se **calcula**, no se lee del comprobante. No decide dinero (no está en NO_DEDUCIBLE ni en REVISAR, `engine.ts:1120-1124`), pero es ruido que apunta al lado equivocado.

### Riesgo comercial (una línea)

**No se puede prometer el estímulo de IEPS en pesos a un cliente** (el motor no lo calcula y la lectura de la cuota está sin firmar); **sí se puede prometer el conteo auditado de litros elegibles** con el filtro de medio de pago correcto — y eso es lo único que el papel afirma hoy.

---

## HALLAZGO B — Estímulo de casetas al 50% (LIF 20-A fr. V / RMF 2026 regla 9.1.8)

### VEREDICTO: **PARCIAL**

Contra el "cumple 1 de 5" de la auditoría original, hoy el sistema cumple correctamente la **base de cálculo (fr. IV)**, produce la **bitácora conciliada (fr. II)** como entregable, y **declara en el propio papel todo lo que no verifica**. Pero la cifra `peajeAcreditable` se sigue calculando sobre casetas que la norma excluiría: **no filtra la forma de pago (fr. III — el efectivo mata el estímulo)**, no verifica pertenencia a la **Red Nacional de Autopistas de Cuota**, y no verifica **elegibilidad** del contribuyente (dedicación exclusiva, <$300M, partes relacionadas). La cifra impresa es una cota superior condicionada, dicha como tal — no una afirmación falsa, pero tampoco un estímulo procedente.

### Qué hace el código hoy, requisito por requisito

| # | Requisito (norma) | Estado | Evidencia |
|---|---|---|---|
| 1 | **50% del gasto en la RNA, base sin IVA** (LIF 20-A-V + RMF 9.1.8-IV) | ✅ base correcta / ❌ RNA sin verificar | `engine.ts:1008`: `peajeAcreditable += g.subTotal * peajeFactor` (factor 0.5, `config.ts:127`), solo con XML verificado (`engine.ts:988`) y sin diferencias de `SIN_ACREDITAMIENTO` (`engine.ts:983`). La base SIN IVA quedó **confirmada por norma**: RMF 9.1.8-IV (ficha `rmf-2026-9.1.8.yaml`, verificada fuente primaria) — el hallazgo H4 de `lif-2026-20-A.yaml` pasó a "RESUELTO (14-ago-2026)". **Pero** dispara con `concepto === 'caseta'` a secas: una caseta estatal/municipal fuera de la Red entra igual (H5 de la ficha, severidad media, ABIERTO). |
| 2 | **El estímulo es ingreso acumulable para ISR** (LIF 20-A, ap. A, párrafo final; corpus 04 §5) | ⚠️ declarado, no calculado | `acreditable.ts:70-71` `NOTA_INGRESO_ACUMULABLE` va como pie general del bloque en el PDF (`acreditable.ts:123`, probado en `acreditable.test.ts` "el aviso de ingreso acumulable sigue debajo de todo el bloque"). No existe la "calculadora del beneficio neto" que el corpus recomienda (04 §recomendación 7): el papel enseña el bruto con la advertencia, no el neto. |
| 3 | **Elegibilidad / topes** (dedicación exclusiva, ingresos <$300M — con corte retroactivo, RMF 9.1.6 —, no parte relacionada LISR 179) | ❌ no verificado, sí declarado | El motor no conoce ninguna de las cuatro condiciones (H5/H6 de `lif-2026-20-A.yaml`, ABIERTOS). El papel lo dice: label "Estímulo de peaje 50% … — **sujeto a elegibilidad**" (`acreditable.ts:115`), tono `condicionado`, pie `CONDICIONES_ESTIMULO_PEAJE` con las cuatro condiciones transcritas de la ficha (`acreditable.ts:64-67`), probado en `acreditable.test.ts`. No hay alerta de umbral de $300M (corpus 04 §recomendación 8: el corte es retroactivo al inicio del ejercicio, con complementarias, actualización y recargos). |
| 4 | **Acreditamiento solo contra ISR del ejercicio; si no, se pierde** (LIF 20-A-V, párrafo citado en corpus 04 §4.4) | ❌ ni modelado ni dicho en el renglón | El motor no modela contra qué se acredita (razonable: es un motor de liquidación por viaje, no de declaración), pero a diferencia del ingreso acumulable, esta condición **no aparece** en los pies del renglón de peaje ni en las leyendas de la bitácora. |
| 5 | **Pago con TAG/sistema electrónico + conservar estados de cuenta + bitácora conciliada** (RMF 9.1.8-II y III) | ⚠️ bitácora SÍ; filtro de pago NO | **Fr. II implementada**: `intake/desglose_peaje.ts` (`bitacoraRmf918`, `cruzarLineasDesglose` — conciliación línea por línea del CFDI consolidado del TAG contra los viajes), export CSV en `src/app/api/export/bitacora-peaje/route.ts`, con leyendas honestas (`desglose_peaje.ts:925-926`: "Este documento NO afirma que el estímulo… proceda; corren por cuenta del contribuyente: el aviso de marzo (fr. I), pagar con TAG y conservar estados de cuenta (fr. III)…"). 41 pruebas verdes. **Fr. III NO se aplica a la cifra**: `engine.ts:1008` no mira `formaPago` — una caseta pagada en EFECTIVO en ventanilla, con CFDI y XML, suma al `peajeAcreditable` (el gate de efectivo de `engine.ts:391` solo excluye montos > $2,000, y una caseta típica no los alcanza). El panel lo confiesa (`dashboard/agentes/peajes/vista.tsx:305`: "Likida no verifica la forma de pago de cada caseta; el efectivo en ventanilla mata el estímulo"), pero el corpus es tajante: "Pagar la caseta en efectivo en la ventanilla también mata el estímulo del 50%… Sin TAG, no hay estímulo, aunque tengas el CFDI" (04-iva-ieps-estimulos.md §punto 5 y §4.3-III). Fr. I (aviso de marzo con inventario vehicular) no existe como entregable — declarada por cuenta de la flota (vista.tsx:304). |

### Qué exige la norma (citas del corpus)

- **LIF 2026 art. 20, ap. A, fr. V** (ficha `lif-2026-20-A.yaml`, verificado_fuente_primaria; texto literal también en corpus 04 §4.1): dedicación EXCLUSIVA al transporte terrestre, uso de la Red Nacional de Autopistas de Cuota, ingresos anuales < $300M, "hasta en un 50 por ciento del gasto total erogado", sujeto a reglas del SAT, excluidas partes relacionadas (LISR 179).
- **RMF 2026 regla 9.1.8** (ficha `rmf-2026-9.1.8.yaml`, verificado_fuente_primaria): fr. I aviso de marzo con inventario vehicular por buzón tributario; fr. II bitácora de viaje que **coincida** con el estado de cuenta del TAG; fr. III pago mediante TAG/sistema electrónico y conservación de estados de cuenta; fr. IV "importe pagado… **sin incluir el IVA**, el factor de 0.5 para toda la Red".
- **Ingreso acumulable**: corpus 04 §5, cita literal del apartado A: los beneficiarios "considerarán como ingresos acumulables… en el momento en que efectivamente los acrediten".
- **Solo contra ISR del ejercicio / se pierde**: corpus 04 §4.4, cita literal; ampliación RFA 2.12 para carga federal.

### Qué falta exactamente

1. **Filtro de fr. III en la cifra**: excluir de `peajeAcreditable` (o degradar a "por confirmar") toda caseta cuya forma de pago no sea electrónica o no venga respaldada por el CFDI consolidado del proveedor de TAG — el corpus 04 §recomendación 4 lo pide textual ("Validador de peaje que exija origen de TAG… Likida debe marcarlo"). Hoy es el hueco más concreto: efectivo en ventanilla suma al estímulo impreso.
2. **Verificación de Red Nacional** (H5): catálogo o inferencia desde el estado de cuenta del TAG (corpus 04, tabla §6, fila 6).
3. **Elegibilidad del tenant** (H6): declaración de dedicación exclusiva/ingresos/partes relacionadas en la configuración de la flota (el patrón ya existe: `facilidad15` para la RFA 2.9) + alerta del umbral retroactivo de $300M.
4. **Decir en el renglón del PDF** que el acreditamiento es únicamente contra ISR del ejercicio y que el derecho se pierde si no se ejerce (hoy solo está el pie de ingreso acumulable).
5. Fr. I (aviso de marzo con inventario vehicular): entregable posible, hoy declarado por cuenta de la flota — decisión de producto, no defecto.

### Riesgo comercial (una línea)

**No se puede prometer "el 50% de tus casetas" como cifra procedente**: lo que se puede vender hoy es la base fr. IV bien calculada + la bitácora fr. II conciliada (entregable real y defendible), con la cifra siempre presentada como está en el papel — condicionada — porque incluye casetas que un pago en efectivo o una caseta fuera de la Red descalificarían.

---

## Nota transversal

En ambos hallazgos el patrón actual del producto es el mismo y es deliberado: **retirar la afirmación en lugar de calcular mal**, y decir en el papel qué no se verifica (`acreditable.ts` es explícito: "una cifra en el papel con un artículo citado al lado es una AFIRMACIÓN"). Eso cierra el riesgo de sobrepromesa que la auditoría del 27-jul señaló, pero deja ambos contadores **sin la cifra final**: el estímulo de IEPS en pesos (bloqueado por una decisión fiscal sin firmar más un cableado pendiente ya trivial) y un `peajeAcreditable` depurado por forma de pago y Red Nacional. Ninguno de los dos debe cerrarse como "CERRADO" hasta eso.
