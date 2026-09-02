# Aplicar en producción — orden, riesgos y qué se rompe si no

> **AUDITORÍA 24, DAT-1 (ALTO).** Producción va en la **0271**. `master` ya
> llama funciones que nacen en la **0272** y en adelante. Desplegar sin migrar
> deja el export de póliza en 503 en cada intento; aplicar en desorden puede
> **revertir un CRÍTICO ya cerrado**. Este archivo existe para que ninguna de
> las dos cosas dependa de que alguien se acuerde.

## La regla corta

```bash
supabase db push
```

Y **nada más**. `db push` aplica en orden de archivo, que es el orden correcto.
El único camino que rompe cosas es pegar migraciones a mano en el SQL editor.

## Por qué el orden no es un detalle

`ejecutar_arco_cancelacion` se ha redefinido cinco veces. La **0273** la crea
con `set search_path = public, pg_catalog` — **sin `extensions`** — y la
**0275** lo arregla con `alter function … set search_path = public,
extensions, pg_catalog`.

`create or replace` **reemplaza la cabecera entera**. Así que:

| Orden | Resultado |
|---|---|
| 0273 → 0275 (orden de archivo) | correcto: `proconfig = {public, extensions, pg_catalog}` |
| 0275 → 0273, o repetir la 0273 «por si acaso» | **REGRESIÓN**: vuelve a `{public, pg_catalog}` y la primera cancelación ARCO truena con `42883 function digest(text, unknown) does not exist` |

Esto está **probado** (S41 de la auditoría 24) y **vigilado**: el bloque
`ARCO_TELEFONO_NORM_0286` de `supabase/verificaciones.sql` lee
`pg_proc.proconfig` **en la base**, no en el archivo. Si alguien repite la
0273 en gestionado, la batería lo dice. (La red anterior,
`arco_search_path.test.ts`, lee archivos: pasaba igual con la base rota.)

## Qué usa el código de cada pendiente

| Mig. | Qué es | Si se despliega master SIN aplicarla |
|---|---|---|
| **0272** | `poliza_datos_tenant` | `/api/export/poliza` responde **503 «No se pudieron leer las liquidaciones»** en cada intento (`route.ts:215`). Falla cerrado, pero el entregable del contador no existe. |
| **0273** | ARCO borra texto libre + `incidencia.texto_anonimizado_en` | Sigue corriendo la 0264: la cancelación no retira `incidencia.descripcion` y la resolución archivada dice que sí. |
| **0274** | `uq_wa_conversacion_tenant_telefono_norm` | Vuelve el hilo partido: el mismo chofer con `52…` y `521…` estrena dos conversaciones. |
| **0275** | `search_path` de ARCO con `extensions` | Sin la 0273 no hay regresión que arreglar (la 0264 ya lo tenía). |
| **0276** | `prospecto.empleados` | `/api/lead` tiene red: reintenta sin la columna y anota el valor en `notas`. Se pierde el dato estructurado, no el lead. |
| **0286** | ARCO borra la conversación por teléfono **normalizado** (DAT-2/LEG-2, CRÍTICO) | La cancelación sigue devolviendo `"wa_conversacion": 0` con la conversación viva: la flota firma una anonimización que no ocurrió. |
| **0287** | `ultimas_posiciones_tenant` en forma `lateral` (DAT-8/REN-3) | `/dashboard/mapa` tarda >4 s con 30 días de GPS y cae a timeout con los 90 de retención. |
| **0288** | Purga de `wa_outbox` y `evento_seguridad_flota` + índice de purga en `posicion` (DAT-9/REN-4) | Dos tablas siguen creciendo sin plazo; la purga de `posicion` sigue barriendo heap. |
| **0289** | La geolocalización de incidencia se retira a los 90 días (LEG-6) | El aviso de privacidad promete un plazo que la base no cumple. |
| **0290** | Forma de teléfono/RFC/año/km/placas + `app_user.operador_id` por tenant (DAT-10/11) | Un operador sin celular cargado por el ERP **le impide a CUALQUIER otra flota** dar de alta al suyo (`23505 … Key ()=()`). |
| **0291** | Forma de `wa_conversacion.estado`, `tenant.perfil` y del expediente ARCO (DAT-13) | Una solicitud ARCO puede nacer sin titular y ya vencida. |
| **0292** | Las policies `tenant_data`/`tenant_finanzas` quedan de **solo lectura** (SEG-2) | Un contador con su cookie y la anon key puede `PATCH /rest/v1/liquidacion` con `curl`: la cifra cambia, el PDF archivado dice otra, y la bitácora no tiene entrada. |
| **0300** | Reconcilia `gasto_no_tras_liquidar()`: la 0283 (fiscal) y la 0299 (revision) redefinieron la MISMA función en paralelo sin saberlo, y `create or replace` se queda con la última entera — la 0299 se llevó la mitad de la 0283 (mover un gasto FUERA de un viaje liquidado dejaba de rebotar). Solo lo encontró la batería completa contra Postgres real, no ninguna prueba de TypeScript. | Un gasto puede moverse de un viaje ya liquidado a uno abierto sin que el trigger lo impida: la liquidación firmada deja de reflejar los gastos reales del viaje. |

## Antes de aplicar

1. **Respaldo**: las 0290 y 0291 imponen forma a columnas que hoy admiten
   cualquier cosa.
2. Las restricciones nuevas entran **`not valid`** a propósito: se imponen a
   todo lo nuevo sin barrer la tabla al aplicar. El `validate` va envuelto: si
   una fila vieja no cumple, la migración **no aborta** — deja un `NOTICE`
   diciendo qué restricción quedó `not valid` y qué falta limpiar.
   **Léelos.** Una restricción `not valid` sigue protegiendo hacia adelante,
   pero significa que hay filas sucias que alguien tiene que mirar.
3. La 0292 **retira permisos de escritura** por RLS. Es seguro porque la app
   escribe todo con `service_role`, que salta RLS. Si algún día se agrega
   escritura desde el navegador, esa policy hay que volver a crearla a
   propósito, no por accidente.

## Después de aplicar

```bash
PGOPTIONS='-c lc_messages=C' DATABASE_URL='<url de producción>' \
  node scripts/ci/correr-verificaciones.mjs supabase/verificaciones.sql
```

Esperado: **0 fallos**. Los ~19 «sin calificar» son conocidos y están en
`SIN_CALIFICAR_CONOCIDOS`; si aparece uno nuevo, no es normal.

Comprobación rápida del CRÍTICO de ARCO:

```sql
select proconfig from pg_proc where proname = 'ejecutar_arco_cancelacion';
-- esperado: {"search_path=public, extensions, pg_catalog"}
```

## Lo que sigue pendiente (auditoría 24, no cerrado aquí)

- **DAT-3 / DAT-4**: piso ≥ 0 en las cinco columnas de dinero de `gasto`, y
  `viaje_id`/`iva_retenido`/`isr_retenido`/`descuento` en el WHEN de
  `trg_gasto_no_tras_liquidar_update`. **No están en esta tanda** y son las dos
  que dejan divergir el papel firmado y la fila.
- **DAT-6**: `viaje.estatus='liquidado'` ⇔ existe `liquidacion`. Requiere
  reordenar `reabrir_viaje_tx` y reescribir 16 bloques de la batería que usan
  `estatus='liquidado'` como atajo de fixture.
- **DAT-1, tercera parte**: `/api/export/poliza` debería distinguir `PGRST202`
  («la 0272 no está aplicada») de un error de lectura, para que el 503 diga qué
  hacer. Es de otro dueño (`src/app/api/export/poliza/route.ts`).
