# Aplicar en producción — orden, riesgos y qué se rompe si no

> **Actualización 2-sep-2026.** Las migraciones **0272→0301** ya están
> aplicadas contra la base real de producción (proyecto Supabase "Likida"),
> confirmadas en `supabase_migrations.schema_migrations` y contra el esquema
> en vivo. `search_path` de `ejecutar_arco_cancelacion` verificado en
> `public, extensions, pg_catalog`. `master` incluye el PR #303 (auditoría 24
> integrada) más #306/#307/el fix de `fast-uri`, y ya se desplegó con
> `[deploy]`. Esta sección se deja como referencia histórica de por qué el
> orden de aplicación no es un detalle — sigue aplicando para la PRÓXIMA
> tanda de migraciones.
>
> **El repo ya trae 0302 y 0303** (`5180c72`, 2-sep 16:06, cinco horas
> después de esta actualización) — **sin la misma confirmación de arriba**:
> nadie las cotejó todavía contra `schema_migrations` ni contra el esquema en
> vivo. NO se dan por aplicadas aquí (auditoría 25, operabilidad ALTO: el job
> `repair_migrations` llegó a marcarlas "applied" por bookkeeping sin correr
> su SQL — un sello de goma que este documento no va a repetir). Antes del
> siguiente `[deploy]`, aplícalas de verdad (`supabase db push`, o el job
> "Producción — aplicar migraciones reales") y confirma con
> `/api/health` → `migracion.base = "0303"`.

> **AUDITORÍA 24, DAT-1 (ALTO), contexto histórico.** Producción iba en la
> **0271**. `master` ya llamaba funciones que nacían en la **0272** y en
> adelante. Desplegar sin migrar dejaba el export de póliza en 503 en cada
> intento; aplicar en desorden podía **revertir un CRÍTICO ya cerrado**. Este
> archivo existe para que ninguna de las dos cosas dependa de que alguien se
> acuerde — la próxima vez que haya migraciones pendientes, vuelve a aplicar.

> **No uses `supabase config push` contra producción.** El `supabase/config.toml`
> es solo de la pila local de pruebas (`site_url` localhost, `enable_signup = true`,
> confirmaciones apagadas, `email_sent = 360`, MFA TOTP encendido). Empujarlo
> sobrescribe la configuración de Auth del proyecto real: registro abierto,
> enlaces mágicos a `localhost` y sin la cuota de correo de producción. Las
> migraciones se aplican con `supabase db push` (o el job de aplicar
> migraciones); la configuración de Auth se cambia solo desde el panel de
> Supabase. Ver `docs/conocimiento/DEPLOY.md` → «`supabase/config.toml` es solo local».

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
| **0302** | Retira el overload huérfano de 6 argumentos de `reservar_presupuesto_llm` (el de 8, el único con caller real desde la 0244, sigue intacto). Limpieza de superficie muerta, no cambia comportamiento. | Sin efecto funcional — el overload de 6 sigue sin caller, solo más superficie para que el próximo cambio toque la función que no es. |
| **0303** | Gradúa los 9 agentes que la 0301 marcó `experimental` (ya auditados: `cazador`, `guiones`, `noticias_mercado`, `promos_diarias`, `seo_distribucion`, `visuales`, `video_demo`, `video_marketing`, `pruebas`) — pone `experimental = false`, corrige `descripcion` a lo que el motor real hace y limpia `prompt_ref` (apuntaba a markdown que nunca se escribió). | `/admin/agentes` sigue pintando los 9 como `experimental` aunque ya se auditaron limpios — la etiqueta que la 0301 puso para avisar la promesa recortada del catálogo se queda sin la graduación que la cierra. |

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

## Próxima tanda: Carta Porte, salida al TMS (0790 a 0794)

> **Pendiente de aplicar. Este documento no la ejecuta.** Se aplica con `supabase db push` (orden de archivo), con copia de seguridad previa y autorización, y siempre ANTES de un `[deploy]` que use el código nuevo.

Orden (el de archivo, que es el correcto):

| # | Archivo | Qué crea | Riesgo |
|---|---|---|---|
| 0790 | `0790_cp_envio_tms.sql` | `cp_envio_tms`, `cp_salida_config`, tres funciones de reserva y alerta única, columna `cp_documento.revisor_asignado`, y **reescribe entera** la restricción de tipos de evento. | La restricción de eventos se recrea con la lista completa: si otra migración la toca en medio, se pierde. No aplicar fuera de orden. |
| 0791 | `0791_cp_formato_json_y_causa_rechazo.sql` | Formato `json` en documentos y perfiles, columna `rechazo_causa`. | Sin tablas nuevas; solo restricciones. |
| 0792 | `0792_cp_catalogo_cliente.sql` | `cp_cliente_numero`, `cp_catalogo_producto`, `cp_catalogo_parte`. | Tablas nuevas, sin datos. |
| 0793 | `0793_cp_sat_catalogo.sql` | `cp_sat_catalogo` (global, sin datos hasta importarlos). | Tabla nueva, sin datos. |
| 0794 | `0794_cp_ccp_timbrado_recibido.sql` | `cp_ccp_timbrado` (UUID fiscal único por flota), columna `cp_salida_config.responder_ccp` (apagada) y dos funciones del candado de respuesta. | Tabla nueva sin datos y columna con default `false`: no cambia nada hasta que una flota active «responder al cliente». |

Qué se rompe si el código llega antes que la base: el cron de Carta Porte y la pantalla de configuración de la salida fallan al leer tablas que no existen. Con la base por delante del código no pasa nada: las tablas esperan vacías.

Después de aplicar: comprobar que existen las cuatro (`select to_regclass('public.cp_envio_tms'), to_regclass('public.cp_sat_catalogo');`), dejar el modo de salida en `descarga` y seguir `docs/operacion/carta-porte-salida-tms.md`. Para deshacer: `docs/operacion/carta-porte-salida-tms-rollback.md`.

Ya escrita: `0842_interruptor_carta_porte_salida_tms.sql` amplía la restricción `interruptor_id_dominio` con `agente:carta_porte_salida_tms` (aditiva, sin quitar ningún nombre); aplicarla es lo que deja al panel apagar esa salida sin recurrir al modo `descarga` (ver el rollback).

## Próxima tanda: 0843 a 0848 (actualización 21-oct-2026)

> **Pendiente de aplicar. Este documento no la ejecuta.** Ya escritas y fusionadas a `master`, sin confirmar
> todavía contra `schema_migrations` ni contra el esquema en vivo de producción. Se aplican con `supabase db push`
> (orden de archivo), con copia de seguridad previa y autorización, y siempre ANTES de un `[deploy]` que use el
> código que las necesita.

| # | Archivo | Qué es |
|---|---|---|
| 0843 | `0843_peajes_sftp.sql` | Cuarto canal de ingesta de peajes (SFTP): tabla/columnas de configuración y `peaje_sftp_reclamar` (claim con lease), mismo molde que el pull. |
| 0844 | `0844_gasto_aviso_sin_robot.sql` | Columna `gasto.autofactura_aviso_sin_robot_en` — candado de "ya se avisó una vez" para el fallback "comercio sin adaptador" del Agente 6 (Autofactura). |
| 0845 | `0845_jornada_alerta_enviado_candado.sql` | Candado "ya se envió de verdad" (`jornada_alerta.enviado_en`) para cerrar la ventana entre el WhatsApp real de una alerta de jornada y el cierre de su claim. |
| 0846 | `0846_equipo_candado_ultimo_dueno.sql` | Candado contra el TOCTOU de dos degradaciones concurrentes de `flota_admin` que dejarían a la flota sin ningún dueño activo (auditoría adversarial, hallazgo alto #2). |
| 0847 | `0847_peaje_reclamo_candado_idempotencia.sql` | Índice único parcial en `peaje_reclamo` contra reclamos gemelos por el mismo desglose y categoría (auditoría adversarial, hallazgo alto #1). |
| 0848 | `0848_factura_proveedor_cfdi_tardio.sql` | Dos columnas (`xml_crudo_tardio`, `recibido_tardio_en`) para no perder el XML real de un CFDI que llega después de que un humano ya decidió la factura (auditoría adversarial, hallazgo alto #2). |

Ninguna se da por aplicada aquí — confirmar con `/api/health` → `migracion.base` y contra `schema_migrations`
antes de asumir que ya corrieron.

## Lo que sigue pendiente (auditoría 24, no cerrado aquí)

- ~~**DAT-3 / DAT-4**: piso ≥ 0 en las cinco columnas de dinero de `gasto`, y
  `viaje_id`/`iva_retenido`/`isr_retenido`/`descuento` en el WHEN de
  `trg_gasto_no_tras_liquidar_update`.~~ **Cerrado**: el piso llegó en la 0281
  (`gasto_importes_no_negativos`) y el WHEN completo en la 0283, reconciliado
  con la 0299 en la 0300 — las cuatro columnas que faltaban ya están.
- **DAT-6**: `viaje.estatus='liquidado'` ⇔ existe `liquidacion`. Requiere
  reordenar `reabrir_viaje_tx` y reescribir 16 bloques de la batería que usan
  `estatus='liquidado'` como atajo de fixture. Sigue sin cerrar.
- **DAT-1, tercera parte**: `/api/export/poliza` debería distinguir `PGRST202`
  («la 0272 no está aplicada») de un error de lectura, para que el 503 diga qué
  hacer. Es de otro dueño (`src/app/api/export/poliza/route.ts`). Sigue sin
  cerrar — ya no aplica el escenario original (la 0272 SÍ está aplicada), pero
  la distinción de errores en el 503 sigue siendo una mejora real pendiente.
