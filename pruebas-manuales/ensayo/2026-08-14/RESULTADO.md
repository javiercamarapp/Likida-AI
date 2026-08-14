# Ensayo del demo — 14 de agosto de 2026

> **El ensayo corrió y el arco del guion PASA por el camino del simulador — pero
> solo después de cuatro arreglos hechos hoy mismo.** El más grave: la base de
> producción estaba EN CERO (0 operadores, 0 viajes) — si Javier hubiera abierto
> el demo esta mañana, el "hola" no habría enganchado nada. Segundo en gravedad:
> el RFC del tenant demo era `FDM990101XYZ8`, que **ni siquiera tiene forma
> válida de RFC**, y con él la validación de receptor —la defensa que el guion
> narra en §5— corría apagada sin avisar.

Motivo del ensayo: la ronda 4 tocó `cuadre/` (`tope_alimentacion.ts`, `fiscal.ts`)
y la skill manda re-ensayar tras cualquier cambio ahí.

## Cómo se corrió

Local (`npm run dev`) + producción real (`gngoqsvrxdguxvsizpbw`). **No se
recorrió WhatsApp**: el número sigue siendo el de PRUEBA de Meta (bloqueante
conocido) y mandar fotos desde el teléfono de Javier no lo puede hacer un
agente. Se recorrió el camino de respaldo que el propio guion designa para
"WhatsApp no entrega": el simulador `/demo` — mismo motor, mismos números.

| paso | evidencia | tiempo |
|---|---|---|
| Estado de la base del demo | consultas MCP (abajo) | — |
| Re-siembra + verificación | 5 operadores, 1 viaje abierto, 2 gastos, 3 liquidaciones | — |
| Motor DESPLEGADO (`POST app.likida.ai/api/demo`) | cuadre exacto + sobre_politica $200 | 2.2 s |
| Motor local corregido (4 presets, anticipo $10,600) | misma salida | <1 s |
| Contraprueba: CFDI timbrado a OTRO RFC | `rfc_receptor → "no es de la empresa — no deducible"` | <1 s |
| Recorrido UI `/demo` (4 clics + cerrar) | `01-demo-simulador-local.png` (MIRADA) | 4.3 s total; el cuadre en ~1 s |
| PDF del contralor con motor+renderizador reales | `02-liquidacion-pdf-contralor.pdf` (ABIERTO Y LEÍDO) | <1 s |

## Hallazgos

### 1. ROMPE — La base estaba en CERO

`operador`, `viaje`, `gasto`, `liquidacion`: 0 filas. El guion asume viaje
abierto Silao→Nuevo Laredo con anticipo $10,600 y 2 gastos. **Arreglado**:
re-sembrado con `supabase/seed.sql` vía MCP y verificado contra la base
(5 operadores, `VJ-2026-0847` abierto con anticipo $10,600, 2 gastos, 3
liquidaciones de historial). Por qué estaba en cero no quedó determinado — la
ronda 3 la dejó sembrada; nada en el repo la borra.

### 2. ROMPE — El seed no actualizaba el RFC al re-sembrar

El `on conflict … do update` del tenant no incluía `rfc`: un tenant ya existente
se quedaba con el RFC que tuviera, y la validación de receptor compara contra
ESE. **Arreglado** en `seed.sql` (`rfc = excluded.rfc`).

### 3. ROMPE — `FDM990101XYZ8` no es un RFC válido

Verificado con los validadores del propio repo (`esRfcValido`,
`rfcChecksumOk`): forma **false**, checksum **false**. El guion (§La verdad
sobre los datos) dice que el RFC del demo es `GMX0902279I1` (real, de un
tercero que dio permiso) *"solo para que la validación de receptor funcione"* —
el código decía otra cosa. **Arreglado en los 4 lados**: `seed.sql`,
`/api/demo/route.ts`, `/demo/page.tsx` y la base de producción (tenant, 2
gastos, 1 XML). `GMX0902279I1`: forma true, checksum true.

### 4. ROMPE — `/api/demo` tiraba el receptor y no pasaba `empresaRfc`

El mapeo de comprobantes no copiaba `rfcReceptor` y `cuadrarViaje` corría sin
`empresaRfc`, así que la validación de receptor **se saltaba en silencio** en el
simulador — justo la pantalla de respaldo de la sala. Con el receptor puesto
pero sin empresa, el preset de factura salía con una observación de "receptor
no verificable" que el guion no espera. **Arreglado**: el route pasa ambos y el
preset de factura trae su `rfcReceptor`. La contraprueba (CFDI a `ODM950324V2A`)
sale marcada "no es de la empresa — no deducible".

### 5. PASA — El motor desplegado dice lo que el guion promete

`POST https://app.likida.ai/api/demo` con el escenario del guion:
comprobado $10,600 = anticipo, diferencia $0, y la ÚNICA observación es
`sobre_politica` (diésel $200 sobre el tope de $4,000). 2.2 segundos. Es
exactamente el arco de §2–§3.

## Lo mirado (no solo medido)

- **`01-demo-simulador-local.png`** — la conversación completa: 4 comprobantes
  acusados (el CFDI con "validado por QR ✅"), "Cuadra exacto ✅", el "Ojo con
  esto" con la única observación, y la promesa del PDF. Nada cortado, cifras
  con formato.
- **`02-liquidacion-pdf-contralor.pdf`** — generado con `cuadrarViaje` +
  `generarLiquidacionPDF` reales (bundle esbuild, cero copias). Encabezado de
  FLOTA DEMO SA DE CV, tabla de comprobantes con estados, las tres cubetas
  (deducible $1,200 / por confirmar $9,400 con su porqué / no deducible),
  "Cuadra exacto", el párrafo de reembolso con LFT 110-I, la diferencia única y
  el descargo del CFF 52. **Nota, no hallazgo**: la columna Fecha sale "—"
  porque los presets del simulador no traen fecha; en la sala las fechas vienen
  de las fotos.

## Diferencias contra el ensayo anterior (2026-08-03/05)

El del 03 encontró el guion roto contra los datos (viaje equivocado, cifras en
ceros, IEPS retirado); todo eso se corrigió entonces y HOY los datos vuelven a
coincidir con el guion tras la re-siembra. No hay capturas comparables uno a
uno (aquel ensayo miró `/dashboard`, `/admin` y el ticket de visión; éste miró
el camino del simulador y el PDF, que es lo que toca el motor de cuadre que
cambió). La cifra de control se mantiene: **anticipo $10,600, cuadre exacto,
una sola diferencia de $200** — el motor no cambió de opinión.

## Lo que NO se recorrió (y por qué)

- **WhatsApp real** de punta a punta (fotos → `listo` → PDF por chat): número
  de prueba de Meta + hace falta el teléfono de Javier.
- **El panel tras sesión** (`/dashboard` proyectado del §4): requiere login por
  magic link con un correo real; el render de esas vistas se miró en la ronda 4
  vía previews, pero **no** con la sesión del demo. El botón del PDF
  (`/api/export/pdf/[id]`) tampoco, por lo mismo.
- **La llamada de visión** (foto de ticket real): recorrida en el ensayo del
  03, sin cambios en `agents/prompts.ts` desde entonces.

## Decisión que esto NO toma

El RFC `GMX0902279I1` en el seed y el código viene del guion de Javier ("dio
permiso"). Si ese permiso cambia, se cambia en `seed.sql` + `/api/demo/route.ts`
+ `/demo/page.tsx` + la base (4 lados — ya no 3: el seed ahora sí lo propaga).
