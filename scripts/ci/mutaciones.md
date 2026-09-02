# Mutaciones dirigidas — auditoría 24 (rubro `pruebas`)

Lista de las 27 mutaciones dirigidas que la auditoría 24 aplicó a mano contra
`src/` y `supabase/verificaciones.sql`, y el comando para reproducir cada una
en un sandbox (copia de `src/`+`supabase/` con `node_modules` por symlink, tal
como lo hizo el auditor — **nunca sobre el árbol real**).

Fuente de las specs: `scratchpad/hallazgos/pruebas-work/specs.py` (nombre →
archivo, texto viejo, texto nuevo, archivos de prueba). Reproducir:

```bash
python3 scratchpad/hallazgos/pruebas-work/run.py <nombre-de-la-mutación>
```

aplica la mutación en el sandbox, corre los archivos de prueba listados con
`--reporter=dot`, y restaura el archivo. Log en
`scratchpad/hallazgos/pruebas-work/log/<nombre>.log`.

## Las 12 que sobrevivían (0 sobreviven después de esta ronda)

Cada una tiene ahora una prueba nueva (sufijo `_aud24.test.ts`) que la mata —
verificado a mano: se aplicó la mutación exacta de `specs.py` sobre el árbol
real, se corrió la prueba nueva, se confirmó rojo, se revirtió con
`git checkout --`.

| # | Mutación (`specs.py`) | Prueba que la mata |
|---|---|---|
| M21 | `cuadre/engine.ts:508` tope de efectivo LISR 27-III `?? 2000` → `?? 20000` | `src/lib/likida/cuadre/tope_efectivo_default_aud24.test.ts` |
| M12 | `cuadre/engine.ts:1610` `rfc_receptor_no_verificable` entra a `REVISAR` | `src/lib/likida/cuadre/rfc_no_verificable_estatus_aud24.test.ts` |
| M4 | `api/export/liquidaciones/route.ts:116-117` cursor sin `ORDER BY` | `src/app/api/export/liquidaciones/route_orden_cursor_aud24.test.ts` |
| M7 | `llm/openrouter.ts:508` la reserva de presupuesto ignora las imágenes | `src/lib/llm/cota_entrada_imagenes_aud24.test.ts` |
| M14 | `contabilidad/formatos.ts:167` `Line_ID` de SAP colapsa a 0 (PRU-A2) | `src/lib/likida/contabilidad/formatos_line_id_aud24.test.ts` |
| M15 | `intake/cfdi_xml.ts:362` retención IVA (002) contada como ISR (001) (PRU-A4) | `src/lib/likida/intake/cfdi_xml_retenciones_aud24.test.ts` |
| M16 | `api/export/poliza/route.ts:315-316` archivos del DTW de SAP intercambiados (PRU-A1) | `src/app/api/export/poliza/salida_sap_b1_aud24.test.ts` |
| M19 | `pac/sw.ts:70` autenticar ignora `!res.ok`/token nulo | `src/lib/likida/pac/sw_autenticar_no2xx_aud24.test.ts` |
| M22 | `likida/clientes.ts:859-860` `filaTarifa` invierte origen/destino (aud. 23 D6) | `src/lib/likida/clientes_escritura_aud24.test.ts` |
| M23 | `estadias/lector.ts:105` `guardarPoliticaDetencion` siempre `.eq('cliente_id', …)` (aud. 23 N6) | `src/lib/likida/estadias/lector_escritura_aud24.test.ts` |
| M24 | `likida/processor.ts:2275` el aviso de foto con fecha dudosa se calla | `src/lib/likida/foto_fecha_dudosa_log_aud24.test.ts` (y ya la mataba `foto_refoto_fecha.test.ts` existente — ver nota abajo) |
| M17 | `observability/alerta.ts:155` — el bug real vive en `carta_porte_timbre.ts` (317/379/409), no en `alerta.ts` | `src/lib/observability/alerta_uuid_huerfano_aud24.test.ts` — **`it.fails`**: requiere un cambio de producto fuera de mis archivos (constructor `fiscal`) |

## Nota sobre M22/M23/M24: la tabla de la auditoría no las marcó `(suite)`

En `hallazgos/pruebas.md` las filas M4, M7, M12, M14, M15, M16, M17, M19 y M21
llevan `(suite)`: se corrieron también contra las 711 archivos de la suite
completa y siguieron verdes. M22, M23 y M24 **no** llevan esa marca — el
auditor solo las corrió contra los archivos de su lista angosta
(`clientes*.test.ts`/`app/api/v1` para M22; `estadias/*.test.ts` para M23;
26 archivos con prefijo `processor_`/`rafaga`/`correccion_fecha`/
`ventana_dia_mx` para M24).

Al verificar M24 a mano se confirmó que `src/lib/likida/foto_refoto_fecha.
test.ts` (existente, no tiene ninguno de esos prefijos) **ya mataba la
mutación** corriendo la suite completa — el hallazgo fue un artefacto del
filtro de nombre de archivo del script del auditor, no un hueco real. Se
dejó de todos modos la prueba nueva `foto_fecha_dudosa_log_aud24.test.ts`
como segundo ancla, más cercana al síntoma exacto de PRU-7 (el
`logger.info('foto.fecha_dudosa', …)`).

## Cómo correr las 12 mutaciones contra el árbol real (verificación manual)

No hay corredor automático en este árbol (el sandbox de `pruebas-work/` vive
en el scratchpad de la sesión de auditoría, no en el repo). Para reproducir
la verificación hecha en esta ronda, aplicar a mano el `old`→`new` de
`specs.py` con un script como:

```bash
python3 - <<'EOF'
p = "<archivo>"
s = open(p).read()
old = "<texto viejo de specs.py>"
new = "<texto nuevo de specs.py>"
assert s.count(old) == 1
open(p, "w").write(s.replace(old, new))
EOF
npx vitest run <prueba _aud24.test.ts correspondiente> --reporter=dot
git checkout -- <archivo>
```

**Siempre revertir con `git checkout --` inmediatamente después de correr la
prueba — nunca dejar una mutación aplicada en el árbol.**

## Las 15 que ya morían (sin cambios en esta ronda)

M1, M2, M3, M5, M6, M8, M9, M10, M11, M13, M18, M20, M25, SQL-B.

## Fuera de mi lista asignada: SQL-A / PRU-1

`hallazgos/pruebas.md` cuenta 12 sobrevivientes y SQL-A (la política RLS de
`tarifa` invertida, mig. 0048) es uno de ellos — pero **no** está en la lista
de hallazgos que se me asignó (ver mensaje de arranque: 11 puntos que suman
exactamente los 12 de arriba, sin SQL-A). El arreglo que PRU-1 pide toca
`supabase/verificaciones.sql` (bloques `FINANZAS_RLS`, `RPCS_0159`,
`STRIPE_0163`, `AGREGADOS_0150`, `RESUMEN_POR_TENANT` — bloques
**existentes**, que REGLAS.md prohíbe editar sin un número de bloque
asignado) y `scripts/ci/correr-verificaciones.mjs` (el runner de la
batería). Ninguno de los dos está en `PLAN.md` con un rango asignado a
`pruebas`. Se deja anotado en `CIERRE.md` como "requiere cambio ajeno",
dueño probable `ops` (dueño de la CI de la batería SQL) o `datos`/`backend`
(dueños de las policies RLS).
