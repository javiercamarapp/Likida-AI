# Pruebas — auditoría 24 (rubro `pruebas`, 1-sep-2026)

Qué hizo este cierre, sobre el hallazgo `hallazgos/pruebas.md`: **12 de 27
mutaciones dirigidas sobrevivían** (verificado por el auditor con
`hallazgos/pruebas-work/`). Este documento es el resumen operativo; el
detalle mutación-por-mutación y cómo reproducirlas vive en
`scripts/ci/mutaciones.md`.

## Resultado

- **11 de las 12 mutaciones sobrevivientes ahora mueren** con una prueba
  nueva (sufijo `_aud24.test.ts`, junto al módulo que anclan). Cada una se
  verificó a mano: se aplicó la mutación exacta de `specs.py` sobre el árbol
  real, se corrió la prueba nueva sola, se confirmó rojo, se revirtió con
  `git checkout --`.
- **1 (M17, PRU-A3) queda como `it.fails`**: el bug real vive en
  `src/lib/likida/carta_porte_timbre.ts:317,379,409` (fuera de mis
  archivos — dominio fiscal/timbrado), no en `observability/alerta.ts`. La
  prueba (`src/lib/observability/alerta_uuid_huerfano_aud24.test.ts`) usa el
  `alertarOperador` y el `redactarTexto` REALES (no el mock simplificado de
  `alerta.test.ts`) con el payload EXACTO que esos tres llamadores
  construyen hoy, y confirma que el UUID fiscal sale redactado
  (`id:<huella>`) del correo de «uuid huérfano». La vuelve verde el
  constructor `fiscal`, pasando `uuidFiscal` como llave aparte en los tres
  llamadores (sin tocar `LLAVES_SIN_REDACTAR`, que ya está bien).
- **12/12 mutaciones asignadas: ancladas.** (El conteo de "12 sobreviven" del
  auditor incluye SQL-A/PRU-1, que **no** está en mi lista asignada — ver
  `scripts/ci/mutaciones.md`, sección "Fuera de mi lista asignada".)

## Hallazgo adicional durante el trabajo: M22/M23/M24 no llevaban `(suite)`

En la tabla del auditor, M4/M7/M12/M14/M15/M16/M17/M19/M21 llevan `(suite)`
(se corrieron también contra las 711 archivos de la suite completa). M22,
M23 y M24 no la llevan — el auditor solo las corrió contra un puñado de
archivos con nombre de prefijo específico. Al verificar M24 a mano se
encontró que `src/lib/likida/foto_refoto_fecha.test.ts` (existente) **ya la
mataba** al correr contra la suite completa; el "sobrevive" del hallazgo fue
un artefacto del filtro de nombre del script de mutación del auditor
(prefijo `processor_`/`rafaga`/`correccion_fecha`/`ventana_dia_mx`; ese
archivo no calza ninguno). Se dejó de todos modos una prueba nueva
(`foto_fecha_dudosa_log_aud24.test.ts`) como segundo ancla, más cercana al
síntoma exacto (`logger.info('foto.fecha_dudosa', …)`).

## Flakes de zona horaria (TZ=Pacific/Kiritimati, TZ=Asia/Tokyo)

Se identificaron los 14 archivos de prueba que usan `new Date()` sin
`vi.useFakeTimers`/`vi.setSystemTime`:

```
src/app/api/health/route.test.ts             src/lib/admin/qa-storage.test.ts
src/app/api/stripe/webhook/route.test.ts     src/lib/likida/agentes/cobranza_reparto.test.ts
src/lib/likida/processor_cadena.test.ts      src/lib/likida/arnes_ticket_real.test.ts
src/lib/likida/asistencia_wa.test.ts         src/lib/likida/processor_hitos.test.ts
src/app/api/cron/escalar/route.test.ts       src/lib/likida/agentes/exito.test.ts
src/lib/formato.test.ts                      src/lib/likida/portal_pago_lectura.test.ts
                                              src/lib/likida/agentes/corridas.test.ts
                                              src/lib/utils_fecha.test.ts
```

**Corridos los 13 aplicables** (el 14º, `arnes_ticket_real.test.ts`, tiene
`describe.skipIf(GRUPOS.length === 0)` y se salta sin `TICKET_PATH`/llaves —
correcto, es el único `skipped` de la suite) bajo `TZ=Asia/Tokyo` (UTC+9) y
`TZ=Pacific/Kiritimati` (UTC+14):

```
TZ=Asia/Tokyo         npx vitest run <13 archivos> --reporter=dot  →  372 passed
TZ=Pacific/Kiritimati npx vitest run <13 archivos> --reporter=dot  →  372 passed
```

**0 fallos en ambas corridas — no se tocó ningún archivo.** Se revisó
además por qué, para no dejarlo en "pasó de suerte":

- `new Date().toISOString()` es TZ-INVARIANTE: `process.env.TZ` no cambia
  qué instante ES "ahora", solo cómo lo formatean los métodos LOCALES
  (`getHours()`, `toLocaleDateString()`, `new Date(y,m,d)`). Ninguno de los
  13 archivos usa un método local sobre un `new Date()` sin argumento.
- Las funciones de "día de México" del producto (`hoyMx`, `inicioDiaMx`,
  `finDiaMx`, `lib/formato.ts`) usan un offset **fijo** `-06:00`, no
  `Intl`/`process.env.TZ` — documentado en el propio archivo ("México no
  tiene horario de verano desde 2022"). El offset del proceso no las mueve.
- `src/lib/admin/qa-storage.test.ts` ya tenía el caso más peligroso resuelto
  desde antes: compara timestamps por INSTANTE (`Date.parse`), no por texto
  — el comentario del archivo documenta el bug que esto reemplazó ("se
  rompía sola pasadas las 18:00 hora MX").
- `src/lib/likida/agentes/exito.test.ts` usa `new Date()` como argumento de
  "ahora", pero SIEMPRE junto a un reloj de vuelta YA VENCIDO
  (`RELOJ_VENCIDO = Date.now() - 1`): el corte ocurre antes de que el valor
  de "ahora" pese en ninguna aserción, y ninguna aserción compara contra un
  día calendario.

**Conclusión: los 14 archivos no están rotos por zona horaria hoy.** No se
hicieron cambios especulativos — editar una prueba que ya pasa, sin una
falla que reproducir, sería el mismo tipo de churn que CLAUDE.md pide
evitar. Si algún archivo de este grupo empieza a fallar bajo una TZ extrema
en el futuro, este documento y los dos comandos de arriba son el punto de
partida para diagnosticarlo.

## Cobertura de dinero: un borde nuevo por módulo sin arnés

- **`guardar_liquidacion`** (`repo.ts`): `repo_escritura_n_gastos_cero_
  aud24.test.ts` — el borde `nGastos = 0` (todos los comprobantes
  rechazados) llega a la RPC como `0`, nunca como `null` (el error clásico
  de `||` en vez de `??`).
- **`facturacion_escritura` cancelar con pagos**: ya tenía el borde
  count=0/count=1 anclado en `facturacion_escritura_cableado.test.ts`
  (`cancelarFactura — cuenta los pagos ANTES de cancelar`). No se dupicó.
- **`stripe` doble cobro**: ya tenía el borde anclado en
  `app/api/stripe/webhook/route.test.ts` ("evento REPETIDO (ya aplicado):
  200 con repetido:true y NO aplica"). No se duplicó.
- **`pac` HTTP**: `sw_autenticar_no2xx_aud24.test.ts` — 401 con `{message}` y
  200 sin `data.token`, ambos en la PRIMERA autenticación (sin token
  cacheado), clase `auth`, sin llamar a `/issue`.
- **`contabilidad` SAP/CONTPAQi**: `formatos_line_id_aud24.test.ts`
  (`Line_ID` secuencial sin repetir) y `salida_sap_b1_aud24.test.ts` (los dos
  archivos del DTW no están intercambiados).

## Archivos nuevos de este cierre

Ver tabla completa en `scripts/ci/mutaciones.md`. Resumen: 12 archivos
`*_aud24.test.ts` nuevos, 0 archivos de producto tocados, 0 migraciones.

## Propuesta de CI (no ejecutada — `ops` es dueño de `.github/workflows/`)

Ver `CIERRE.md`, sección "Propuesta de CI para `ops`".
