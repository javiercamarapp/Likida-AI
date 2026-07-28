# Inventario de citas normativas

Alcance recorrido: `src/lib/cuadra/` entero (`cuadre/`, `intake/`, `liquidacion/`,
`facturacion/`, raíz) contra las 17 fichas de `normas/*.yaml`. Búsquedas de
ausencia hechas con `command grep` (no el `grep` envuelto), por la trampa del
entorno descrita en `docs/auditoria-2/MAPA.md`.

**Aviso de concurrencia.** Durante esta auditoría hubo una sesión activa en
paralelo construyendo exactamente `guardiaFundamento()`: apareció
`src/lib/cuadra/normas/indice.ts` (índice canónico `NORMAS`, 17 entradas 1:1
con las fichas), `normas/normas_sincronizadas.test.ts`, `normas/fundamento.ts`
+ `fundamento.test.ts`, y `normas/por_diferencia.ts` — ninguno existía al
empezar; todos son `??` en `git status` (sin commitear). También
`normas/rlisr-57.yaml` se modificó EN VIVO (`git diff` lo muestra) para pasar
`citas_en_codigo` de `[]` a `["RLISR 57"]` — corrigiendo en tiempo real el
hallazgo que se documenta más abajo. Este inventario describe el código de
producto (`engine.ts`, `config.ts`, `pdf.ts`, `leyendas.ts`, `privacidad.ts`,
`processor.ts`, `repo.ts`, `intake/`, `facturacion/`), que NO cambió durante la
auditoría, y usa el estado de `normas/*.yaml` tal como quedó en disco al
cerrar. Donde el índice nuevo ya resuelve algo, se anota.

**Hallazgo de fondo, antes de la tabla:** `src/lib/cuadra/normas/indice.ts` ya
propone exactamente el `norma_id` canónico que este encargo pedía —17 llaves,
una por ficha, verificadas 1:1 contra `normas/*.yaml` por
`normas_sincronizadas.test.ts` (corrido: 8/8 tests pasan). Ver la sección
final: la respuesta a "qué `norma_id` usar" es "el que ya está en ese índice",
con una advertencia sobre qué NO verifica ese test.

---

## Citas en el código

`archivo:línea | cita textual | ficha (norma_id) | estado_verificacion`

Se marca **[NOTA]** cuando la cita vive en un `nota:`/texto que el contralor o
el PDF ven de verdad (no un comentario de desarrollador). Es la señal más
importante para `guardiaFundamento()`: esas son las citas que hoy el motor
determinístico ya "dice" fuera de cualquier guardia de LLM, y las que
`guardiaFundamento()` tendría que dejar pasar sin tocar porque no vienen del
modelo.

### LISR 27-fr-III (`lisr-27-fr-III`) — `evidencia_corroborante`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:35` | "27-III" implícito vía comentario general (ver RLISR 57 abajo) |
| `cuadre/engine.ts:42` | `LIF 2026 art. 20, ap. A / LISR` (genérico, comentario) |
| `cuadre/engine.ts:114` | `LISR 27-III, 2º párrafo` (comentario) |
| `cuadre/engine.ts:127` | **[NOTA]** `... excede el tope de ${mxn(topeEfectivo)} (LISR 27-III) — no deducible.` |
| `cuadre/engine.ts:428` | `RFA 2026` (comentario, sin número — ver rfa-2026-2.9) |
| `cuadre/engine.ts:441` | `LISR 27-III exige comprobante fiscal...` (comentario) |
| `cuadre/engine.ts:456` | `LISR 27-III exige que la deducción esté "amparada..."` (comentario) |
| `config.ts:42` | `LISR 27-III) para gasto no-combustible en efectivo` (comentario) |
| `config.ts:98` | `efectivoTopeMxn: 2000, // LISR 27-III` (comentario) |

Nota: la ficha está en `evidencia_corroborante`, NO `verificado_fuente_primaria`
— nadie leyó el artículo en diputados.gob.mx. La cita en `engine.ts:127` es
**[NOTA]** (texto que el contralor lee) y decide "no deducible" con dinero real,
sobre una ficha que su propia `nota_verificacion` dice que falta cerrar.

### LISR 28-fr-V (`lisr-28-fr-V`) — `verificado_fuente_primaria`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:59` | `LISR 28-V / RLISR 57` (comentario, doc del array `ES_VIATICO`) |
| `cuadre/engine.ts:355` | `LISR 28-V: el tope de $750 procede...` (comentario) |
| `cuadre/engine.ts:369` | **[NOTA]** `... LISR 28-V condiciona la deducción a que uno de los dos la ampare.` (`alimentacion_sin_soporte`) |
| `cuadre/engine.ts:376` | `Tope fiscal de ALIMENTACIÓN... (LISR 28-V)` (comentario, encabezado de bloque) |
| `cuadre/engine.ts:417` | **[NOTA]** `... excede el tope fiscal de ${mxn(topeAlimentacion)} por día (LISR 28-V) — el excedente...` (`viatico_excede_fiscal`) |
| `cuadre/engine.ts:463` | `Parcial: del viático solo se pierde el EXCEDENTE... (LISR 28-V)` (comentario) |
| `config.ts:41` | `viaticosTopeFiscalDiarioMxn... LISR 28-V` (comentario) |
| `config.ts:97` | `LISR 28-V, alimentación nacional` (comentario) |
| `config.ts:135` | `el tope de $750/día de LISR 28-V` (comentario, doc de `fusionarConfig`) |

Esta ficha sí está `verificado_fuente_primaria`. Las dos citas **[NOTA]** son
las cifras de deducibilidad de alimentación que el contralor ve en el PDF/panel
— bien respaldadas.

### RLISR 57 (`rlisr-57`) — `verificado_fuente_primaria`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:35` | `RLISR 57` (comentario, JSDoc de `operadorRfc`) |
| `cuadre/engine.ts:59` | `LISR 28-V / RLISR 57` (comentario) |
| `cuadre/engine.ts:183` | `RLISR 57` (comentario) |
| `cuadre/engine.ts:193` | `RLISR 57` (comentario) |
| `cuadre/engine.ts:197` | **[NOTA]** `Si es el del operador es válido (RLISR 57, trabajador subordinado)...` (`viatico_rfc_operador`) |

`citas_en_codigo` en `normas/rlisr-57.yaml` estaba `[]` (vacío) al leerlo — pese
a que el código SÍ lo cita cinco veces y una es texto que ve el contralor. Ver
"Fichas huérfanas" — este es el caso inverso: ficha marcada sin uso que el
código sí usa. **Corregido en vivo durante esta auditoría** (ver aviso de
concurrencia arriba): el archivo en disco ahora trae `["RLISR 57"]`.

### RFA 2026 regla 2.9 (`rfa-2026-2.9`) — `verificado_fuente_primaria`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:116` | `RFA 2026 regla 2.9 lo tiene por CUMPLIDO...` (comentario) |
| `cuadre/engine.ts:124` | **[NOTA]** `... cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).` (`combustible_efectivo`) |
| `cuadre/engine.ts:268` | `RFA 2026 regla 2.9), pero NO acredita IEPS` (comentario) |
| `cuadre/engine.ts:312` | `RFA 2.9 sí concede para ISR` (comentario) |

### LIF 2026 art. 20, ap. A (`lif-2026-art-20-A`) — `verificado_fuente_primaria`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:42` | `LIF 2026 art. 20, ap. A / LISR` (comentario) |
| `cuadre/engine.ts:274` | `LIF 20-A` (comentario) |
| `cuadre/engine.ts:291` | `el estímulo (LIF 2026 art. 20, ap. A) es SOLO diésel` (comentario) |
| `cuadre/engine.ts:310` | `LIF 20-A-IV (monedero, tarjeta, cheque nominativo o transferencia)` (comentario) |
| `cuadre/engine.ts:320` | **[NOTA]** `... se complica documentar el estímulo (LIF 2026 art. 20, ap. A).` (`ieps_no_desglosado`) |
| `config.ts:38` | `LIF 2026 Art. 20 / LISR` (comentario) |
| `config.ts:40` | `peajeFactor... LIF 2026 Art. 20-A` (comentario) |
| `config.ts:43` | `clavesDieselIeps... LIF Art. 20-A fr. IV` (comentario) |
| `config.ts:44` | `clavesPeaje... LIF 2026 Art. 20-A` (comentario) |
| `config.ts:96` | `peajeFactor: 0.5, // LIF 2026 Art. 20-A` (comentario) |
| `processor.ts:378` | `el estímulo del 50% de peaje (LIF 2026 Art. 20-A)` (comentario) |
| `intake/concepto.ts:9` | `el 50% del peaje (LIF 2026 Art. 20-A)` (comentario) |
| `liquidacion/pdf.ts:276` | `LIF 2026 art. 20-A es cuota semanal disminuida...` (comentario) |
| `liquidacion/pdf.ts:281` | **[NOTA — PDF]** `Diésel elegible para el estímulo de IEPS (LIF 2026 art. 20, ap. A)` |
| `liquidacion/pdf.ts:286` | **[NOTA — PDF]** `Estímulo de peaje 50% (LIF 2026 art. 20, ap. A)` |
| `liquidacion/pdf.ts:291` | `Los estímulos del art. 20 ap. A son ingreso acumulable...` (texto PDF, sin cifra propia) |

Bien respaldada (`verificado_fuente_primaria`) y las citas **[NOTA — PDF]** son
literalmente el texto impreso en el documento que se archiva.

### LIVA art. 5 (`liva-art-5`) — **`sin_verificar`** ⚠️

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts` | Sin cita textual del artículo; el bloque que calcula `ivaAcreditable` (líneas 278–288) no menciona LIVA en absoluto — la etiqueta sale hasta el PDF |
| `liquidacion/pdf.ts:285` | **[NOTA — PDF]** `IVA acreditable (LIVA art. 5)` — cifra en pesos, impresa |

Ver la sección de "Fichas `sin_verificar` que el código YA aplica" — esta es la
única que aplica de verdad.

### CFF 29-A (`cff-29-A`) — `evidencia_corroborante`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:229` | **[NOTA]** `... obligatorio desde 24-abr-2026, regla 2.7.1.48 RMF) — no deducible (CFF 29-A).` (`complemento_hidrocarburos`) |
| `intake/cfdi_xml.ts:10` | `vigente 24-abr-2026 (regla 2.7.1.48 RMF; CFF 29 y 29-A)` (comentario) |

`normas/cff-29-A.yaml` declara `usado_en_codigo: ["intake/cfdi.ts — validación
de UUID y RFC"]`. **Es incorrecto**: `command grep -n "CFF\|29-A" intake/cfdi.ts`
no devuelve nada — la ficha no se cita ahí. Las citas reales están en
`cfdi_xml.ts:10` y `engine.ts:229` (esta última **[NOTA]**, visible al
contralor). Metadata desactualizada, no un hueco de cobertura.

### criterio-1-CFF-PI (`criterio-1-CFF-PI`) — `evidencia_corroborante`

| archivo:línea | cita |
|---|---|
| `cuadre/leyendas.ts:4` | `El Anexo 3 de la RMF 2026 (DOF 09-01-2026) publica ~74 criterios...` (comentario, contexto) |
| `cuadre/leyendas.ts:11` | `Los arts. 89 y 90 del CFF son el marco de esa responsabilidad` (comentario) — **90 no tiene ficha, ver huecos** |
| `cuadre/leyendas.ts:30` | `la referencia al art. 52 del CFF es deliberada` (comentario) |
| `cuadre/leyendas.ts:38` | **[NOTA — PDF, vía `leyendaPdf()`]** `...no constituye un dictamen en términos del artículo 52 del Código Fiscal de la Federación.` |
| `liquidacion/pdf.ts:338` | `Descargo del art. 52 del CFF...` (comentario, arriba de donde se imprime `leyendaPdf()`) |

Coincide con `usado_en_codigo` de la ficha. Correcto.

### criterio-1-LIF-PI (`criterio-1-LIF-PI`) — huérfana. Ver sección dedicada.

### RMF 2.7.1.48 (`rmf-2026-2.7.1.48`) — `evidencia_corroborante`

| archivo:línea | cita |
|---|---|
| `cuadre/engine.ts:221` | `NIVEL 2: ... regla DURA (regla 2.7.1.48 RMF 2026)` (comentario) |
| `cuadre/engine.ts:229` | **[NOTA]** (compartida con CFF 29-A arriba) |
| `config.ts:34` | `lo ÚNICO que la regla 2.7.1.48 exige` (comentario) |
| `intake/cfdi_xml.ts:10` | (compartida con CFF 29-A arriba) |
| `intake/cfdi_xml.ts:39` | `la regla 2.7.1.48 NO aplica a estos` (comentario) |
| `intake/cfdi_xml.ts:95` | `Esquemas alternos que la regla 2.7.1.48 excluye` (comentario) |

### RMF 2.7.1.21 (`rmf-2026-2.7.1.21`) — `evidencia_corroborante`

Sin citas en `.ts`. La propia ficha declara `usado_en_codigo:
["FISCAL_LEGAL.md §1.6 (documentación, no código)"]` — confirmado: es correcto,
no es un hueco, la ficha se auto-declara fuera de código.

### LFPDPPP 15/16 (`lfpdppp-2025-art-15-16`) — `verificado_fuente_primaria`

| archivo:línea | cita |
|---|---|
| `privacidad.ts:4` | `QUIÉN lo debe: el RESPONSABLE, ... (LFPDPPP art. 14)` (comentario) — **art. 14 no está en `citas_en_codigo`, ver nota** |
| `privacidad.ts:11` | `art. 16 fr. II — modalidad SIMPLIFICADA` (comentario) |
| `privacidad.ts:23` | `Art. 15 fr. I lo pide junto con la identidad` (JSDoc) |
| `privacidad.ts:25` | `Art. 16 fr. II obliga a señalarlo` (JSDoc) |
| `privacidad.ts:47,50,54,57,65` | fracciones I–IV del art. 15 y art. 16 fr. II, marcadas inline en el texto del aviso simplificado (comentarios sobre cada línea del mensaje de WhatsApp) |
| `privacidad.ts:75` | `el art. 15 fr. VI obliga a comunicar los cambios` (JSDoc de `versionAviso`) |
| `privacidad.ts:112` | `por ley (art. 15 fr. V) viven los mecanismos... ARCO` (comentario) |
| `processor.ts:98` | `(art. 15 fr. VI)` (comentario) |
| `processor.ts:168` | `Aviso de privacidad... (LFPDPPP art. 16 fr. II)` (comentario) |
| `processor.ts:180` | `Un medio del art. 15 fr. IV que a veces no responde...` (comentario) |
| `repo.ts:337` | `El obligado es el RESPONSABLE... (LFPDPPP art. 14)` (comentario) |
| `repo.ts:372` | `el art. 15 fr. VI obliga a comunicar los cambios` (comentario) |

Nota importante: `citas_en_codigo` de esta ficha es `["LFPDPPP 15",
"LFPDPPP 16-II"]`. El código cita "art. 14" dos veces (`privacidad.ts:4`,
`repo.ts:337`) y esa forma NO está en el arreglo, aunque el `texto_vigente` de
la ficha SÍ incluye el Artículo 14 completo (transcrito). Es un hueco de
formato del índice, no de contenido: el texto está, la cadena de cita
declarada no la cubre.

### LFPDPPP 2 fr. XII y XX (`lfpdppp-2025-art-2-fr-XII-XX`) — usada, pese a decir huérfana. Ver sección dedicada.

### LFPDPPP 26-II y LFPDPPP 59 — huérfanas de verdad. Ver sección dedicada.

### CFF art. 30 — SIN ficha

| archivo:línea | cita |
|---|---|
| `repo.ts:11` | `Conserva el XML CRUDO del CFDI (CFF art. 30).` |
| `processor.ts:401` | `1.8: conservar el XML crudo (CFF 30).` |

### CFF art. 69-B (EFOS) — SIN ficha

| archivo:línea | cita |
|---|---|
| `intake/sat.ts:22` | `true = emisor en lista negra EFOS (art. 69-B) → fraude.` |
| `intake/sat.ts:61` | `200/201 = emisor LIMPIO (fuera de lista 69-B).` |
| `intake/sat.ts:68` | `presunto/definitivo 69-B (documentado)` |
| `cuadre/guardia.ts:76` | `proveedor en lista 69-B` (comentario, ejemplo de veredicto SOLO_CONTRALOR) |
| `src/types/cuadra.ts:35,60` | `efos?: boolean... true = emisor en lista negra 69-B (fraude)` — mismo campo, fuera de `src/lib/cuadra/` pero mismo dominio |

Esta es la cita sin ficha con más peso en dinero: `engine.ts:206-207` declara
`cfdi_efos` → entra directo a `NO_DEDUCIBLE_ISR` y a `SIN_ACREDITAMIENTO` (líneas
271 y 445) — "no deducible" duro, sin margen de revisión, sobre un artículo que
ninguna ficha respalda.

### RMF regla 2.7.1.8 — SIN ficha

| archivo:línea | cita |
|---|---|
| `config.ts:93` | `vigencia del complemento v1.0 (DOF, RMF 2.7.1.8)` — fecha `vigenteDesde: '2026-04-24'` de `hidrocarburos` |

Distinta de `rmf-2026-2.7.1.48` (mismo tema, artículo distinto). La NOTA de
`normas/cff-29-A.yaml` (`condicion_suspensiva`) menciona "regla 2.7.1.8, 2º
párrafo" de pasada, pero no existe una ficha propia con `id: rmf-2026-2.7.1.8`.
La fecha `2026-04-24` que usa `config.ts` es precisamente la que
`normas/rmf-2026-2.7.1.48.yaml` marca como "SIN respaldo" en su propia nota.

### CFF art. 90 — SIN ficha

| archivo:línea | cita |
|---|---|
| `cuadre/leyendas.ts:11` | `Los arts. 89 y 90 del CFF son el marco de esa responsabilidad` |

El art. 89 sí está en `citas_en_codigo` de `criterio-1-CFF-PI`; el 90 no
aparece en ninguna ficha.

---

## Citas SIN ficha

| Cita | Dónde | Por qué importa |
|---|---|---|
| CFF art. 30 | `repo.ts:11`, `processor.ts:401` | Fundamenta guardar el XML crudo. Bajo impacto (no decide dinero), pero es una afirmación legal sin respaldo documentado. |
| **CFF art. 69-B (EFOS)** | `intake/sat.ts` (×3), `cuadre/guardia.ts:76`, `types/cuadra.ts` (×2) | **Alto impacto.** Decide `cfdi_efos` → "no deducible" duro en `engine.ts:206-207`, sin ficha que respalde el fundamento de la lista negra ni sus efectos. |
| RMF regla 2.7.1.8 | `config.ts:93` | Fundamenta la fecha `2026-04-24` de entrada en vigor del complemento de hidrocarburos — la MISMA fecha que `rmf-2026-2.7.1.48.yaml` ya marca como sin respaldo por otra vía. Doble hueco sobre el mismo dato. |
| CFF art. 90 | `cuadre/leyendas.ts:11` | Citado junto al 89 (que sí tiene ficha) como "marco de responsabilidad" en el descargo legal. |

## Fichas `sin_verificar` que el código YA aplica

Solo una, y es la que más dinero mueve de las dos marcadas `sin_verificar`:

### `liva-art-5` (LIVA art. 5) — **aplicada como cifra real, sin verificar**

- `cuadre/engine.ts:278-288` calcula `ivaAcreditable` sumando `g.ivaTraslado`
  para todo gasto con `xmlVerificado === true` que no cayó en
  `SIN_ACREDITAMIENTO`. No hay ninguna validación adicional de los requisitos
  del art. 5 (que el IVA venga trasladado EXPRESAMENTE y POR SEPARADO, que el
  gasto sea deducible para ISR, etc.) — la propia ficha dice que ni siquiera se
  leyó el artículo.
- `liquidacion/pdf.ts:285` IMPRIME esa cifra en el PDF que se archiva:
  `"IVA acreditable (LIVA art. 5)"`, en verde, como dinero que el cliente puede
  recuperar.
- Es exactamente el escenario que `normas/liva-5.yaml` describe en su propio
  campo `riesgo_actual`: *"Si el artículo exige alguna condición adicional que
  hoy no se valida, la cifra impresa está de más. Es una cifra que el contralor
  usa."*

La segunda ficha `sin_verificar` (`politica-portales-plazos-facturacion`) **NO**
entra aquí: se revisó `engine.ts` (regla `factura_por_vencer`, líneas 334–351) y
la propia ficha (`uso_permitido_hoy`), y el motor usa la regla general del mes
natural, NO los plazos por comercio sin verificar — el texto que ve el operador
dice "puede ser menor", nunca afirma un plazo concreto. Es el ejemplo correcto
de cómo tratar una ficha `sin_verificar`: se declara la incertidumbre en vez de
afirmarla como hecho. `facturacion/comercios.ts` refuerza esto con
`plazoVerificado: false` explícito en cada entrada.

## Fichas huérfanas

Verificado con `command grep` (no el `grep` envuelto) contra `src/lib/cuadra/`
completo — cero resultados en cada caso salvo lo anotado.

| Ficha (norma_id) | `usado_en_codigo` en el YAML | Realidad verificada |
|---|---|---|
| `criterio-1-LIF-PI` (1/LIF/PI) | `[]` | **Huérfana real.** Cero citas de "1/LIF/PI" en `.ts` fuera de `normas/indice.ts`. Su guía SÍ se sigue en espíritu — `engine.ts:273-277` deja `iepsAcreditable = 0` "a propósito" con el mismo razonamiento (no imprimir pesos de un estímulo que necesita la cuota semanal) — pero el código nunca cita la ficha por nombre. Riesgo: si alguien reintroduce el cálculo en pesos sin volver a leer esta ficha, repite el error que la ficha documenta (`riesgo_cuantificado`: ~$1M/mes en una flota de 200,000 L). |
| `lfpdppp-2025-art-26-fr-II` (LFPDPPP 26-II) | `[]` | **Huérfana real.** Cero citas en código. Relevante para el futuro: su `impacto_en_producto` advierte contra un "cierre automático sin revisión humana" — hoy el diseño (bandeja del contralor) lo respeta de hecho, pero nada en código apunta de vuelta a esta ficha si alguien quita esa revisión. |
| `lfpdppp-2025-art-59` (LFPDPPP 59) | `[]` | **Huérfana real.** Cero citas en código — es material de venta (rangos de multa), no runtime. Coherente con que no debería estar en código. |
| `rfa-2026-2.2` (RFA 2026 regla 2.2, "gasto ciego" 8%) | `[]` | **Huérfana real y correcta.** El motor no implementa la facilidad del 8%; su ausencia es lo seguro (su propia `advertencia` dice que NO cubre combustible, y aplicarla mal sería peor que no aplicarla). |
| `lfpdppp-2025-art-2-fr-XII-XX` (LFPDPPP 2-XII/XX) | `[]` | **NO es huérfana — el YAML está desactualizado.** Sí se cita: `privacidad.ts:5` ("art. 2 fr. XII") y `privacidad.ts:60-61` ("art. 2 fr. XX"). Actualizar `usado_en_codigo` a `privacidad.ts`. |
| `rlisr-57` (RLISR 57) | `[]` en el `citas_en_codigo` (campo distinto, pero mismo síntoma) | **NO es huérfana.** Se cita 5 veces en `engine.ts`, una visible al contralor (línea 197). Corregido en vivo durante esta auditoría a `["RLISR 57"]" (ver aviso de concurrencia). |

## `norma_id` canónico propuesto

**No hace falta inventar uno nuevo: ya existe y ya está probado.**
`src/lib/cuadra/normas/indice.ts` (apareció durante esta auditoría, ver aviso
de concurrencia) define `NORMAS: Record<string, Norma>` con 17 llaves, cada una
copiada literal del campo `id:` de su ficha YAML correspondiente, y
`normas/normas_sincronizadas.test.ts` corrió 8/8 verde al cerrar esta auditoría,
verificando: (1) toda llave del índice tiene ficha, (2) toda ficha tiene llave
en el índice, (3) `estado_verificacion` coincide, (4) `jerarquia` coincide, (5)
toda norma tiene al menos una cita, (6) la ruta de la ficha existe.

Las 17 llaves, tal cual, sirven como `norma_id`:

```
cff-29-A · criterio-1-CFF-PI · criterio-1-LIF-PI ·
lfpdppp-2025-art-15-16 · lfpdppp-2025-art-2-fr-XII-XX ·
lfpdppp-2025-art-26-fr-II · lfpdppp-2025-art-59 ·
lif-2026-art-20-A · lisr-27-fr-III · lisr-28-fr-V · liva-art-5 ·
politica-portales-plazos-facturacion · rfa-2026-2.2 · rfa-2026-2.9 ·
rlisr-57 · rmf-2026-2.7.1.21 · rmf-2026-2.7.1.48
```

Una sola reserva, no de nomenclatura sino de cobertura: el test de sincronía
verifica que `citas` (el arreglo de formas de escritura) tenga longitud > 0,
**no que su CONTENIDO coincida con `citas_en_codigo` del YAML**. Por eso el
desfase de `rlisr-57` (`[]` vs `["RLISR 57"]`) pasó el test sin romperlo antes
de corregirse a mano — y por lo mismo `lfpdppp-2025-art-15-16` puede quedarse
sin `"LFPDPPP 14"` en su arreglo `citas` aunque el código cite el art. 14
directamente (`privacidad.ts:4`, `repo.ts:337`) y seguirá pasando el test.
Si `guardiaFundamento()` va a reconocer citas por texto (que es lo que
`normas/fundamento.ts`/`fundamento.test.ts` sugieren que está haciendo), ese
arreglo `citas` necesita:

1. Agregar `"LFPDPPP 14"` a `citas` de `lfpdppp-2025-art-15-16`.
2. Crear fichas para CFF 30, CFF 69-B (la de más peso: decide "no deducible"
   duro sobre fraude) y, si se documenta, RMF 2.7.1.8 — o `guardiaFundamento()"
   quitará esas citas de cualquier texto que el LLM narre, aunque el propio
   motor determinístico las use en sus `nota:` sin que nadie las cuestione hoy.
3. Endurecer `normas_sincronizadas.test.ts` para comparar el CONTENIDO de
   `citas` contra `citas_en_codigo`, no solo que ambos existan — es el mismo
   patrón de "copia sin verificación" que el propio comentario del test dice
   que ya falló dos veces en este repo.
