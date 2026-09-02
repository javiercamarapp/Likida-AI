# §6.2 — El `FormaPago = 99` del CFDI de monedero

**Estado: DECISIÓN PENDIENTE DE JAVIER. No se tocó el motor.**
Análisis del 28-ago-2026, sobre `master` a `a173fc32`.

El plan de cierre del ciclo (`PLAN-FASES.md`, Fase 1 punto 4) y
`DIESEL-MODALIDADES.md` §6.2 marcan esto como *"la pregunta abierta más
importante"*, y las dos dicen lo mismo sobre cómo resolverla:

> **Esto se decide con un ECC real en la mano, no con lectura de norma.**

Este documento existe porque **no hay un ECC real** y la sesión que lo buscó
tenía que dejar por escrito qué encontró, en vez de dejar la casilla en
blanco o —peor— cambiar el motor con un argumento de lectura.

---

## 1. El hecho: qué pasa hoy

`cuadre/engine.ts`, bloque de acreditamiento (~línea 1370):

```ts
const litros = Number((g.ocrExtra as Record<string, unknown> | undefined)?.litros ?? 0);
const pagoElectronico = !!formaPagoEfectiva
  && (MEDIOS_LISR_27_III as readonly string[]).includes(formaPagoEfectiva);
if (pagoElectronico && Number.isFinite(litros) && litros > 0) { … litrosDieselAcreditables += litros; }
```

`MEDIOS_LISR_27_III = ['02','03','04','05','28','29']`. El `'99'` **no está**,
y no está a propósito: la RMF 2.7.1.29 fr. II define *99 Por definir* como
**la contraprestación que todavía no se ha pagado**, y el estímulo de la LIF
2026 art. 20 ap. A fr. IV (4º párrafo) exige que el diésel se haya pagado con
monedero autorizado, tarjeta a favor del contribuyente, cheque nominativo o
transferencia. Acreditar sobre un `99` sería acreditar sobre algo no pagado.

**Eso, para un CFDI suelto de estación, es correcto y no está en discusión.**

## 2. Por qué el monedero es un caso distinto

El CFDI mensual del emisor del monedero declara **cómo la flota le pagó AL
EMISOR** — que puede ser crédito a 30 días, y entonces el encabezado dirá
`99`. **No declara cómo se pagó en la bomba**: en la bomba se pagó con el
monedero, que es precisamente uno de los medios que la LIF admite
(`c_FormaPago 05`). Si el `99` del encabezado apagara los litros, se
perderían **los litros de todo el mes** de la modalidad más limpia
fiscalmente que existe — justo el segmento donde el estímulo vale más.

## 3. Lo que el código hace HOY con eso, y por qué es lo correcto

Es importante ser exacto, porque el riesgo está mal descrito en el plan:
**hoy el `99` del ECC no apaga nada**, por un detalle del camino de
consolidados que no es un accidente:

| Camino | ¿Copia `forma_pago` del encabezado del CFDI al gasto? |
|---|---|
| CFDI 1:1 (`repo.ts:updateGastoCfdiXml`) | **Sí.** Un CFDI suelto con `99` apaga litros e IVA de ese gasto. |
| Consolidado (`consolidado.ts:ligarLineaAGasto`) | **No.** Escribe `cfdi_uuid`, `cfdi_orden`, `xml_verificado`, `clave_prod_serv` y `ocr_extra.litros`. **Nunca `forma_pago`.** |

O sea: al ligar una línea ECC a un ticket, el gasto **conserva la forma de
pago que leyó el OCR del papel** — `'01'`, `'04'` o `undefined`. El `99` del
encabezado del estado de cuenta no viaja. La consecuencia real es la
contraria a la que el plan temía:

- Si el OCR leyó *tarjeta* (`'04'`), **los litros sí se acreditan**, aunque el
  encabezado del ECC diga `99`.
- Si el OCR no pudo leer el medio de pago (`undefined` — lo normal en un
  ticket de monedero, porque `intake/ocr.ts` solo mapea *efectivo* → `'01'`
  y *tarjeta* → `'04'`, y cualquier otra cosa a `undefined`), **los litros
  NO se acreditan**. No por el `99`: por no tener dato.

**Ese es el hueco de verdad**, y es distinto del que el plan describe.

## 4. La recomendación, para que Javier la decida — NO IMPLEMENTADA

La pieza que falta no es tocar `MEDIOS_LISR_27_III` ni leer el `99` del
encabezado. Es que **`evidenciaMonedero` ya sabe, con evidencia y no con
sospecha, que una carga se pagó con monedero autorizado**: o el RFC del
gasto está en el padrón, o existe una línea ECC del mismo día, misma estación
y mismo monto (Fase 2, `intake/evidencia_monedero.ts`). Y "pagado con
monedero electrónico autorizado por el SAT" es exactamente `c_FormaPago 05`,
uno de los seis medios de `MEDIOS_LISR_27_III`.

La recomendación sería: cuando `evidenciaMonedero(g, lineasEcc).tipo !==
'ninguna'`, tratar la **forma de pago efectiva de ese gasto** como `'05'`
para el estímulo, aunque el OCR no la haya leído — porque la evidencia del
medio de pago no viene del papel, viene del estado de cuenta del emisor.

**Por qué NO se hizo en esta ronda, y no debe hacerse sin Javier:**

1. **Es una afirmación sobre dinero fiscal tomada sin el documento.** El plan
   dice que esto se decide con un ECC real en la mano. No lo hay: el repo no
   tiene un solo archivo `.xml`, y los tres fixtures ECC que existen son el
   mismo string sintético con distinto nombre (RFC de relleno `edn010101aa1`,
   UUID `1111…5555`) — **y ninguno de los tres declara siquiera `FormaPago`**,
   que es justo el atributo que habría que mirar.
2. **Cambiaría el resultado de una liquidación hacia arriba.** Acreditar de
   más es del lado caro: responde el cliente ante una revisión, y el criterio
   no vinculativo 1/LIF/PI fr. II alcanza a quien *"asesore o participe"* —
   o sea a Likida.
3. **La lectura del `05` es razonable pero no está verificada contra fuente
   primaria en este repo.** `docs/asistencia/DIESEL-MODALIDADES.md:3` fija
   `05 = monedero electrónico` como corrección de catálogo, y
   `normas/lisr-27-III.yaml` y `normas/lif-2026-20-A.yaml` traen el texto de
   los medios admitidos; pero **nadie ha comprobado con qué clave timbra de
   verdad su ECC un emisor autorizado**. Puede ser `03`, puede ser `99`, y
   `DIESEL-MODALIDADES.md` (modalidad 1 de la tabla) admite las dos como
   posibles sin haber visto una.

**Lo que desbloquea la decisión:** un solo estado de cuenta mensual real
—XML— de cualquiera de los 13 emisores de la semilla
(`intake/padron_monederos.json`). Con ese archivo se contesta de una vez:
qué `FormaPago` trae el encabezado, con qué tipografía escribe
`TipoCombustible`, y si el `Cantidad` por línea viene en litros.

---

## 5. El otro pendiente de la Fase 1: el CHECK de `gasto.forma_pago`

El plan (Fase 1 punto 5) pide endurecer el CHECK de `gasto.forma_pago`
(mig. 0025) contra el catálogo real del SAT, *"porque hoy solo valida
`^[0-9]{2}$` y un `'77'` inventado por el OCR entra"*.

**No se hizo, y la razón no es pereza:**

- **El `'77'` no existe.** Grep de `'77'` en `src/` y en
  `supabase/migrations/`: cero. `intake/ocr.ts` mapea *efectivo* → `'01'`,
  *tarjeta* → `'04'` y **cualquier otra cosa a `undefined`** — no hay un
  tercer código inventado. `intake/cfdi_xml.ts:formaPagoSat()` rellena un
  dígito suelto (`"1"` → `"01"`) y descarta lo que no sean 1-2 dígitos.
- **La 0025 declinó el catálogo por escrito, con su razón** (línea 55):
  *"escribir el catálogo mal rechazaría CFDI legítimos, que es peor que el
  problema"*. Un CHECK con una clave de menos hace que un CFDI válido no se
  pueda ni guardar.
- **Y este repo no tiene el catálogo `c_FormaPago` verificado contra
  fuente.** No está en `normas/`, ni en `normas/datos/`. Lo que hay son
  claves sueltas citadas en prosa (`01, 02, 03, 04, 05, 06, 08, 28, 29, 30,
  99`). Escribir el CHECK con esas y omitir las que no aparecen —hay más—
  produciría exactamente el daño que la 0025 previó. **Escribirlo de memoria
  está prohibido por la primera regla de la casa.**

**Lo que desbloquea esto:** el catálogo `c_FormaPago` del SAT bajado y
fechado en `normas/datos/`, con el mismo patrón que
`normas/datos/cuota-ieps-diesel.yaml`. Con ese archivo el CHECK se escribe
en diez minutos y sin riesgo. Sin él, la forma (dos dígitos) es la
restricción honesta.

---

## Resumen para la mesa

| Pregunta | Respuesta de esta ronda |
|---|---|
| ¿Se tocó el motor por el `99`? | **No.** |
| ¿El `99` del ECC apaga los litros del mes, hoy? | **No** — el camino de consolidado no copia `forma_pago`. El plan lo describía al revés. |
| ¿Entonces por qué siguen saliendo en cero muchos tickets de monedero? | Porque el OCR no lee "monedero" y deja `forma_pago` en `NULL`, y el motor exige un medio admitido. |
| ¿Qué se recomienda? | Tratar la forma de pago efectiva como `'05'` cuando `evidenciaMonedero` afirma con evidencia. **Sin implementar.** |
| ¿Qué falta para decidirlo? | **Un ECC real (XML) de cualquiera de los 13 emisores de la semilla.** |
| ¿Se endureció el CHECK de `forma_pago`? | **No.** Falta el catálogo `c_FormaPago` verificado en `normas/datos/`. |
