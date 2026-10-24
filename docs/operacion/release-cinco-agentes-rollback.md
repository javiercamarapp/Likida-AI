# Release cinco agentes: rollback por migración y por superficie (0770–0855)

Para quien opera la plataforma. Cubre las 61 migraciones que existen entre la `0770` y la `0855`
(los números `0771`–`0774`, `0783`, `0816`–`0819`, `0821`, `0822`, `0824`–`0829`, `0831`, `0833`–`0839` no existen
y no deben reutilizarse; ver [NUMERACION-SALTADA.md](../../supabase/migrations/NUMERACION-SALTADA.md)).

> **Este documento no ejecuta nada.** Todo SQL de abajo es una reversa documentada, escrita a partir de lo que cada
> archivo de `supabase/migrations/` crea o cambia. Cada bloque se prueba primero en una base local o en una rama de
> Supabase, nunca por primera vez en producción.

> **ADVERTENCIA (producción).** Las migraciones `0845` a `0855` **ya están aplicadas en producción**. Una reversa en
> producción la ejecuta **solo el responsable de la plataforma**, con respaldo previo verificado
> (`scripts/respaldo.sh`, ver [sección 1](#1-principios-y-orden)) y con el código ya vuelto a una versión compatible
> ([sección 4](#4-rollback-de-código-en-vercel-por-sha)). Nadie más corre estas reversas, y ningún agente automático
> debe correrlas.

## 1. Principios y orden

1. **Casi nunca hace falta revertir la base.** Casi todo es aditivo y, si no hay fila, el código no hace nada. El
   orden de preferencia es: (a) apagar con interruptores, (b) volver el código a un SHA anterior, (c) solo como último
   recurso, revertir SQL.
2. **Orden de operación:** apagar (secciones 5 y 3) → volver el código (sección 4) → recién entonces, y solo si es
   necesario, SQL. El código nuevo llama a funciones y tablas que la reversa elimina; si se revierte la base con el
   código nuevo en pie, esas llamadas fallan.
3. **Orden inverso de número.** Se revierte de la `0855` hacia la `0770`. Hay funciones y restricciones que una
   migración posterior redefinió sobre otra anterior (ver [riesgos de orden](#2-riesgos-de-orden-leer-antes-de-la-tabla));
   revertir la menor primero deja a la mayor apuntando a una definición que ya no existe.
4. **Respaldo primero, siempre que haya datos de la flota.** El proyecto de base no tiene respaldo automático
   verificado; el procedimiento es:
   ```bash
   ./scripts/respaldo.sh            # guarda en ~/likida-respaldos/base/likida-<fecha>.sql
   ```
   Verifica que el archivo no pese 0 bytes y que se pueda leer antes de continuar. Si el respaldo no sale, no se
   revierte nada.
5. **`drop table` y `drop column` borran datos de la flota sin vuelta atrás.** Si la tabla o columna ya tiene filas
   reales, no se borra: se apaga la función y se deja la estructura (basura inerte, sin costo). Se borra solo cuando
   se confirma que no hay nada que conservar o ya existe el respaldo.
6. **Una migración a la vez, dentro de una transacción**, con `begin; ... commit;` y revisando el resultado antes del
   `commit`. Las reversas que recrean restricciones usan `not valid` + `validate` cuando la tabla es grande.
7. **No hay reversa para `0841`** (cierre de políticas): revertirla reabre un hueco de seguridad. Ver su fila.
8. **No se publica nada para "documentar" una reversa.** Los cambios a este archivo son solo documentación.

## 2. Riesgos de orden (leer antes de la tabla)

Estas migraciones redefinen algo que ya tenía una definición anterior. Revertir significa **restaurar la definición
previa**, que se recupera del archivo indicado. Si entre ambas hay otra migración que también lo redefine, se
restaura la de mayor número que sea menor que la que se revierte (verificado: hoy no hay intermedias).

| Migración | Redefine | Definición previa en | Qué pasa si se revierte fuera de orden |
| --- | --- | --- | --- |
| `0801` | función `sembrar_hitos_conductor(integer)` | `0380_conductor_hitos.sql` | Se restaura el cuerpo de la `0380`; el código nuevo lee columnas de perfil que dejan de existir. |
| `0842` | restricción `interruptor_id_dominio` (CHECK) | `0250_palancas_carta_porte_y_copiloto.sql` (60 nombres) | Si existe una fila `agente:carta_porte_salida_tms` en `interruptor`, el `add constraint` falla: borrarla antes. |
| `0784` | restricción `cron_latido_id_dominio` (CHECK) | `0701_estado_publico.sql` (sin `tms`) | Falla si existe la fila `cron_latido` con id `tms`: borrarla antes. |
| `0845` | función `reclamar_jornada_alerta` (cambia el `returns table`: hubo `drop` + `create`) | `0502_jornada_alerta_tope.sql` | Hay que hacer `drop function` de la firma nueva y volver a crear la de la `0502`; un `create or replace` solo no basta. |
| `0849` | función `ejecutar_arco_cancelacion_cuenta(uuid, uuid)` | `0442_arco_cancelacion_cuenta_de_oficina.sql` | Se pierde el candado de "último dueño activo" del lado de la base. |
| `0853` | función `conductor_indicadores(...)` | `0385_conductor_validacion_sitios_evidencia.sql` | Se pierden las dos claves de validación degradada del tablero. |
| `0790` | CHECK `cp_documento_evento_tipo_dominio` | `0670_cp_documento_embarques_tabla.sql` | Falla si hay eventos con los tipos nuevos (`envio_*`, `revisor_asignado`). |
| `0791` | CHECK `cp_documento_formato_dominio`, `cp_perfil_formato_dominio` | `0420_carta_porte_multiformato.sql` | Falla si hay filas con formato `json`. |
| `0823` | CHECK `viaje_hito_evidencia_tipo` | `0385_conductor_validacion_sitios_evidencia.sql` | Falla si hay evidencia de tipo `documento_cierre`. |
| `0803` | CHECK `viaje_sitio_derivado_criterio_dominio` | `0637_viaje_sitio_derivado.sql` | Falla si hay filas con criterio `equivalencia` o `equivalencia_sin_sitio`. |
| `0843` | CHECK `peaje_ingesta_archivo_origen_dominio` | `0563_peajes_correo_pull_aviso_anulacion.sql` | Falla si hay archivos con origen `sftp`. |
| `0789` | CHECK `liquidacion_excepcion_tipo_dominio` | `0786_liquidacion_desglose_meta.sql` | Falla si hay excepciones `unidades_mezcladas`. |
| `0788` | CHECK `liquidacion_entrega_correo_correo_forma` e índice `liquidacion_entrega_correo_destinatario_unico` | `0787_liquidacion_entrega_correo.sql` | Restaurar el índice previo; ver fila. |
| `0855` | índice `viaje_sin_aceptar_idx` | `0058_confirmacion_de_viaje.sql` | Sin consecuencia de datos; recrear con el predicado de la `0058`. |
| `0841` | políticas RLS de 10 tablas | `0050`, `0052`, `0053`, `0055`, `0093`, `0094`, `0163` (políticas `for all` originales) | **No revertir.** Reabre escritura por PostgREST. |
| `0810` | `peaje_caseta.lat` / `lng` pierden `not null` | tabla original de la caseta | `set not null` falla si hay casetas sin coordenadas. |

Dos migraciones tocan el mismo objeto sin ser una redefinición de la otra: `0780` y `0802` agregan la **misma** columna
`despacho_ref` a `viaje` y `posicion` (ambas con `if not exists`). Se borra una sola vez, al revertir la **menor**
(`0780`), y solo si ya se revirtió también la `0802`; ver sus filas.

## 3. Tabla migración → efecto → tipo → reversa → cuándo NO revertir

Tipos: **A** = aditiva (tabla, columna o índice nuevo); **R** = redefine algo previo (hay que restaurar); **D** =
destructiva o que quita acceso. "Respaldo" = correr `scripts/respaldo.sh` antes, si hay filas reales.

### 3.1 Perfil y peajes (0770, 0775–0779, 0810–0815, 0843, 0847, 0850)

| Migración | Efecto | Tipo | Reversa SQL | Cuándo NO revertir |
| --- | --- | --- | --- | --- |
| `0770_tenant_perfil` | Tabla `tenant_perfil` (perfil `cinco_agentes` por flota), RLS, trigger `tenant_perfil_bitacora_trg` que escribe en `bitacora_auditoria`. | A | Primero quitar el perfil de cada flota con `scripts/perfil/revertir-cinco-agentes.sh`; después `drop trigger if exists tenant_perfil_bitacora_trg on public.tenant_perfil; drop function if exists public.tenant_perfil_bitacora(); drop table if exists public.tenant_perfil;` | Si alguna flota tiene fila: la tabla vacía no estorba, mejor dejarla (sin fila el código no hace nada). Las filas de `bitacora_auditoria` ya escritas no se borran. |
| `0775_peaje_desglose_clase_unidad_periodo` | Columnas `clase`, `unidad_archivo`, `importe_100` en `desglose_peaje_linea`; `periodo_oficial_desde`, `periodo_oficial_hasta`, `periodo_origen`, `no_periodo`, `calidad` en `desglose_peaje`; 4 CHECK; índice `desglose_peaje_periodo_oficial_idx`. | A | `drop index if exists public.desglose_peaje_periodo_oficial_idx; alter table public.desglose_peaje drop column if exists periodo_oficial_desde, drop column if exists periodo_oficial_hasta, drop column if exists periodo_origen, drop column if exists no_periodo, drop column if exists calidad; alter table public.desglose_peaje_linea drop column if exists clase, drop column if exists unidad_archivo, drop column if exists importe_100;` (las columnas se llevan sus CHECK). | Cualquier desglose ya importado con periodo oficial: se pierde el periodo y la calidad. Respaldo. Ver también [peajes-rollback.md](peajes-rollback.md) §3 (dice que 0775–0777 no requieren revertir). |
| `0776_peaje_reglas_cobro_config` | Tablas `peaje_caseta_nombre`, `peaje_tag_baja` (reglas de cobro por caseta y bajas de TAG), RLS. | A | `drop table if exists public.peaje_tag_baja; drop table if exists public.peaje_caseta_nombre;` | Si la flota declaró reglas o bajas de TAG: son configuración suya. Respaldo. |
| `0777_peaje_reclamo_seguimiento` | Constraint `desglose_peaje_id_tenant_key`; tablas `peaje_reclamo`, `peaje_reclamo_nota` con FK compuestas; índices. | A | `drop table if exists public.peaje_reclamo_nota; drop table if exists public.peaje_reclamo;` y, solo al final de todo lo de peajes, `alter table public.desglose_peaje drop constraint if exists desglose_peaje_id_tenant_key;` | Cualquier reclamo abierto o con acreditación registrada. Es dinero reclamado al proveedor. Respaldo obligatorio. Antes: revertir `0847`, `0815`, `0814` (dependen de estas tablas). |
| `0778_peaje_excepcion_unidad_y_cruce_justificado` | Tablas `peaje_caseta_excepcion_unidad`, `peaje_cruce_justificado`, RLS. | A | `drop table if exists public.peaje_cruce_justificado; drop table if exists public.peaje_caseta_excepcion_unidad;` | Si hay cruces justificados por la flota (decisiones humanas). Respaldo. |
| `0779_peaje_atipicos` | Tablas `peaje_atipico_config`, `peaje_atipico`, índices, RLS. | A | `drop table if exists public.peaje_atipico; drop table if exists public.peaje_atipico_config;` | Si hay atípicos en revisión. Respaldo. |
| `0810_peaje_catalogo_coordenadas_opcionales` | `peaje_caseta.lat` y `lng` aceptan nulo; columna `por_pasada`; CHECK `peaje_caseta_coordenadas_en_pareja`. | R | `alter table public.peaje_caseta drop constraint if exists peaje_caseta_coordenadas_en_pareja; alter table public.peaje_caseta drop column if exists por_pasada;` y, **solo si no hay casetas sin coordenadas** (`select count(*) from public.peaje_caseta where lat is null or lng is null` = 0): `alter table public.peaje_caseta alter column lat set not null, alter column lng set not null;` | Si hay casetas cargadas sin coordenadas (el `set not null` falla): dejar las columnas nulas y solo quitar lo demás. |
| `0811_peaje_tarifario` | Tabla `peaje_tarifa` (tarifario por caseta y clase), índice, RLS. | A | `drop table if exists public.peaje_tarifa;` | Si hay tarifas `confirmada` por la flota. Respaldo. |
| `0812_peaje_tag_tipo_unidad` | Columna `peaje_tag.tipo_unidad` + CHECK `peaje_tag_tipo_unidad_dominio`. | A | `alter table public.peaje_tag drop column if exists tipo_unidad;` (se lleva el CHECK). | Si ya hay TAG clasificados. Respaldo. |
| `0813_peaje_unidad_inmovilizada` | Tabla `peaje_unidad_inmovilizada`, índice, RLS. | A | `drop table if exists public.peaje_unidad_inmovilizada;` | Si hay periodos de inmovilización declarados (afectan la revisión de cobros). Respaldo. |
| `0814_peaje_cruce_viaje` | Constraint `desglose_peaje_linea_id_tenant_key`; tablas `peaje_cruce_viaje`, `peaje_vinculo_config`; índices, RLS. | A | `drop table if exists public.peaje_cruce_viaje; drop table if exists public.peaje_vinculo_config; alter table public.desglose_peaje_linea drop constraint if exists desglose_peaje_linea_id_tenant_key;` (la constraint, tras revertir `0815`, que podría depender de ella). | Si hay vínculos cruce-viaje confirmados. Respaldo. |
| `0815_peaje_candidato_accion` | Tabla `peaje_candidato_accion`, índices, RLS. | A | `drop table if exists public.peaje_candidato_accion;` | Si hay acciones tomadas sobre candidatos a reclamo. Respaldo. |
| `0843_peajes_sftp` | CHECK de `peaje_ingesta_archivo.origen` ampliado con `sftp`; 11 columnas `sftp_*` en `peaje_ingesta_config` (incluye `sftp_credencial_cifrada`); 7 CHECK; índice `peaje_ingesta_config_sftp_trabajo_idx`; función `peaje_sftp_reclamar(int, int)`. | R | `drop function if exists public.peaje_sftp_reclamar(int, int); drop index if exists public.peaje_ingesta_config_sftp_trabajo_idx; alter table public.peaje_ingesta_config drop column if exists sftp_host, drop column if exists sftp_puerto, drop column if exists sftp_usuario, drop column if exists sftp_ruta, drop column if exists sftp_huellas, drop column if exists sftp_credencial_cifrada, drop column if exists sftp_activo, drop column if exists sftp_intervalo_min, drop column if exists sftp_proximo_en, drop column if exists sftp_ultimo_en, drop column if exists sftp_ultimo_error;` y restaurar el CHECK de origen según `0563`: `delete`/reclasificar antes las filas con `origen = 'sftp'` (o dejar el CHECK ampliado), luego `alter table public.peaje_ingesta_archivo drop constraint if exists peaje_ingesta_archivo_origen_dominio; alter table public.peaje_ingesta_archivo add constraint peaje_ingesta_archivo_origen_dominio check (origen in ('api','panel','correo','pull'));` | Si hay archivos con `origen = 'sftp'` ya procesados (la huella sha256 es evidencia de qué se importó) o una flota con credencial SFTP cifrada guardada: dejar el CHECK ampliado. Respaldo. Borrar `sftp_credencial_cifrada` también borra el secreto que la flota entregó: avisarle que tendrá que volver a darlo. |
| `0847_peaje_reclamo_candado_idempotencia` | Índice único parcial `peaje_reclamo_activo_unico (tenant_id, desglose_id, categoria) where estado <> 'rechazado'`. | A | `drop index if exists public.peaje_reclamo_activo_unico;` | Sin riesgo de datos, pero quitarlo reabre la carrera de reclamos duplicados: no quitarlo salvo que bloquee una operación legítima. |
| `0850_peaje_ingesta_tope_candado` | Función `peaje_archivo_encolar(uuid, text, text, text, text, int, bytea)` (encola con tope y deduplicación en una sola llamada). | A | `drop function if exists public.peaje_archivo_encolar(uuid, text, text, text, text, int, bytea);` | **Antes volver el código** (`ingesta.ts` la llama por RPC): con código nuevo y función borrada, la ingesta de peajes deja de encolar. No hay datos propios. |

### 3.2 Remisión TMS y liquidaciones por correo (0780–0789, 0802, 0804)

| Migración | Efecto | Tipo | Reversa SQL | Cuándo NO revertir |
| --- | --- | --- | --- | --- |
| `0780_viaje_despacho_ref` | Columna `despacho_ref` en `viaje` y `posicion`; índice `viaje_despacho_ref_idx`. | A | `drop index if exists public.viaje_despacho_ref_idx; alter table public.posicion drop column if exists despacho_ref; alter table public.viaje drop column if exists despacho_ref;` (documentada en el propio archivo). **Hacerlo solo junto con `0802`**, que declara las mismas columnas. | Si los viajes ya llevan la referencia del TMS: se pierde el enlace viaje–despacho. Respaldo. |
| `0802_despacho_ref_en_viaje_y_posicion` | Repite `add column if not exists despacho_ref` en `viaje` y `posicion` (sin efecto si la `0780` ya corrió). | A | Nada propio: la columna es la misma de `0780`. | Ver `0780`. |
| `0781_tms_sincronizacion` | Tablas `tms_sincronizacion`, `tms_ingesta`, RLS cerrada. | A | `drop table if exists public.tms_ingesta; drop table if exists public.tms_sincronizacion;` (documentada en el archivo). | Si hay estado de sincronización o ingestas con errores a investigar. Respaldo. |
| `0782_tms_mapeo` | Tabla `tms_mapeo` (mapeo de campos por flota), índice único, RLS. | A | `drop table if exists public.tms_mapeo;` (documentada en el archivo). | El mapeo es configuración de la flota: sin respaldo, rehacerlo cuesta. Respaldo. |
| `0784_cron_latido_tms` | CHECK `cron_latido_id_dominio` ampliado con el id de cron `tms`. | R | `delete from public.cron_latido where id = 'tms'; alter table public.cron_latido drop constraint cron_latido_id_dominio; alter table public.cron_latido add constraint cron_latido_id_dominio check (id in ('wa-pendientes','wa-outbox','escalar','facturar','purgar','runner','gps','asistencia','descarga-sat','jornada','portales-vivos','liquidaciones-externas','peajes','conductor-hitos','vigia','buzon-entrega','jornada-alertas','carta-porte-docs','guardia'));` (copiada de la propia migración). | Mientras el cron `tms` siga programado: sin el id en el CHECK, su latido no se puede escribir y `/admin/crons` lo marcará como roto. Desprogramarlo antes (sección 5). |
| `0785_liquidacion_correo_destinatarios` | Columnas `operador.correo`, `correo_rebotado_en`, `coordinador_id`; tablas `liquidacion_coordinador`, `liquidacion_correo_config`; trigger `operador_anonimiza_correo` y su función; 2 constraints en `operador`; políticas `tenant_lee`. | A | `drop trigger if exists operador_anonimiza_correo on public.operador; drop function if exists public.operador_anonimiza_correo(); drop table if exists public.liquidacion_correo_config; drop table if exists public.liquidacion_coordinador; alter table public.operador drop constraint if exists operador_coordinador_tenant_fkey, drop constraint if exists operador_correo_forma; drop index if exists public.operador_coordinador_idx; alter table public.operador drop column if exists coordinador_id, drop column if exists correo_rebotado_en, drop column if exists correo;` | **Contiene correos de personas (dato personal)**: borrar la columna `operador.correo` destruye lo capturado. Si ya se capturaron correos o hay config de canal, no revertir: apagar el canal en `liquidacion_correo_config` (`activa = false`). Respaldo y, si hay personas, aviso a la flota. |
| `0786_liquidacion_desglose_meta` | Tablas `liquidacion_desglose`, `liquidacion_excepcion`, `liquidacion_pull_estado`, índices únicos, políticas `tenant_lee`. | A | `drop table if exists public.liquidacion_excepcion; drop table if exists public.liquidacion_pull_estado; drop table if exists public.liquidacion_desglose;` | **Dinero de operadores**: desgloses ya generados y su evidencia de envío. No revertir con datos; respaldo. |
| `0787_liquidacion_entrega_correo` | Tabla `liquidacion_entrega_correo` (cola de correos con claim y trazabilidad de entrega), índices, política; función `reclamar_entregas_correo(integer, timestamptz, integer)`. | A | `drop function if exists public.reclamar_entregas_correo(integer, timestamptz, integer); drop table if exists public.liquidacion_entrega_correo;` | Es la **evidencia de que se entregó una liquidación**. Con filas enviadas/entregadas no se borra. Respaldo. Revertir `0788` antes. |
| `0788_liquidacion_correo_retencion` | CHECK `liquidacion_entrega_correo_correo_forma` reescrito, índice único `liquidacion_entrega_correo_destinatario_unico` recreado; función `purgar_liquidacion_entrega_correo(integer, integer, timestamptz)` (retención/anonimización). | R | `drop function if exists public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz);` y restaurar el CHECK y el índice con la definición de `0787_liquidacion_entrega_correo.sql` (`drop index if exists ...; create unique index ...` copiando el predicado de la `0787`). | Si ya corrió la purga, el correo de las filas viejas está anonimizado y el CHECK de la `0787` puede rechazarlas: no restaurar el CHECK antiguo. Para detener la purga, desprogramar el cron (sección 5), no borrar la función. |
| `0789_liquidacion_desglose_numeros` | Columnas `numero_liquidacion`, `numero_pago`, `bitacoras` en `liquidacion_desglose`; 3 CHECK; índice único `liquidacion_desglose_numero_liquidacion_unico`; CHECK `liquidacion_excepcion_tipo_dominio` ampliado con `unidades_mezcladas`. | R | `delete from public.liquidacion_excepcion where tipo = 'unidades_mezcladas';` → restaurar el CHECK de `0786_liquidacion_desglose_meta.sql` (tipos: `sin_poliza, operador_no_encontrado, operador_sin_correo, coordinador_sin_correo, total_no_cuadra, concepto_prohibido, neto_negativo, tipo_sin_regla, correccion_pendiente, mapeo_invalido`) → `drop index if exists public.liquidacion_desglose_numero_liquidacion_unico; alter table public.liquidacion_desglose drop column if exists bitacoras, drop column if exists numero_pago, drop column if exists numero_liquidacion;` | Con liquidaciones numeradas ya entregadas: el número es el que vio el operador. No borrar. Respaldo. |
| `0804_viaje_transito_y_marcas_tms` | Columnas `viaje.transito_estado`, `transito_actualizado_en`, `transito_texto_origen`, `tms_salida_en`, `tms_llegada_en`; CHECK `viaje_transito_estado_check`. | A | `alter table public.viaje drop column if exists transito_estado, drop column if exists transito_actualizado_en, drop column if exists transito_texto_origen, drop column if exists tms_salida_en, drop column if exists tms_llegada_en;` | Si hay viajes con marcas de salida/llegada del TMS (lectura sistema de seguimiento). Respaldo. |

### 3.3 Carta porte: salida al TMS (0790–0794, 0830, 0832, 0842)

| Migración | Efecto | Tipo | Reversa SQL | Cuándo NO revertir |
| --- | --- | --- | --- | --- |
| `0790_cp_envio_tms` | Tablas `cp_envio_tms` (cola de envío) y `cp_salida_config`; columna `cp_documento.revisor_asignado`; CHECK `cp_documento_evento_tipo_dominio` ampliado (`envio_*`, `revisor_asignado`); funciones `cp_envio_reclamar(int, int)`, `cp_envio_marcar_alerta(uuid, uuid)`, `cp_envio_liberar_alerta(uuid, uuid)`. | R | `drop function if exists public.cp_envio_liberar_alerta(uuid, uuid); drop function if exists public.cp_envio_marcar_alerta(uuid, uuid); drop function if exists public.cp_envio_reclamar(int, int); drop table if exists public.cp_envio_tms; drop table if exists public.cp_salida_config; alter table public.cp_documento drop column if exists revisor_asignado;` y restaurar el CHECK de eventos con la lista de `0670_cp_documento_embarques_tabla.sql` (antes: `delete from public.cp_documento_evento where tipo in ('envio_preparado','envio_pendiente_reque','envio_enviado','envio_rechazado','envio_error','envio_alertado','envio_subido_a_mano','revisor_asignado');`, o dejar el CHECK ampliado). Revertir `0794` antes (usa `cp_salida_config`). | Con envíos al TMS ya hechos: `cp_envio_tms` es la bitácora de qué se mandó y qué respondió el TMS; borrar eventos pierde la traza. Respaldo. Ver [carta-porte-salida-tms-rollback.md](carta-porte-salida-tms-rollback.md). |
| `0791_cp_formato_json_y_causa_rechazo` | CHECK de formato (`cp_documento`, `cp_perfil`) ampliado con `json`; columna `cp_documento.rechazo_causa` + CHECK. | R | `alter table public.cp_documento drop column if exists rechazo_causa;` y restaurar los CHECK de formato con la lista de `0420_carta_porte_multiformato.sql` (sin `json`); antes: `update` o revisión de las filas con `formato = 'json'`. | Con documentos `json` ya recibidos: la reversa del CHECK falla. Con `rechazo_causa` llena: se pierde el motivo. Respaldo. |
| `0792_cp_catalogo_cliente` | Tablas `cp_cliente_numero`, `cp_catalogo_producto`, `cp_catalogo_parte` (catálogos por cliente de la flota), RLS cerrada. | A | `drop table if exists public.cp_catalogo_parte; drop table if exists public.cp_catalogo_producto; drop table if exists public.cp_cliente_numero;` | Los catálogos los **cargó la flota** (partes, productos, números de cliente). Rehacerlos es trabajo humano. Respaldo. |
| `0793_cp_sat_catalogo` | Tabla `cp_sat_catalogo` (catálogo SAT local), RLS cerrada. | A | `drop table if exists public.cp_sat_catalogo;` | Se puede volver a poblar desde el origen, pero hasta entonces la validación contra catálogo falla. Aplicar solo con el código apagado. |
| `0794_cp_ccp_timbrado_recibido` | Tabla `cp_ccp_timbrado`; columna `cp_salida_config.responder_ccp` (default `false`); funciones `cp_ccp_marcar_respondido(uuid, uuid)`, `cp_ccp_liberar_respuesta(uuid, uuid)`. | A | `drop function if exists public.cp_ccp_liberar_respuesta(uuid, uuid); drop function if exists public.cp_ccp_marcar_respondido(uuid, uuid); drop table if exists public.cp_ccp_timbrado; alter table public.cp_salida_config drop column if exists responder_ccp;` | Si ya hay complementos timbrados recibidos y respondidos: es registro fiscal. Respaldo obligatorio. |
| `0830_cp_distancias` | Tabla `cp_distancia` (distancias entre sitios para carta porte), RLS cerrada. | A | `drop table if exists public.cp_distancia;` | Si la flota capturó distancias a mano. Respaldo. |
| `0832_cp_referencia_cliente` | Tablas `cp_cliente_referencia`, `cp_viaje_referencia`, RLS cerrada. | A | `drop table if exists public.cp_viaje_referencia; drop table if exists public.cp_cliente_referencia;` | Si ya hay referencias de viaje que se imprimen en la carta porte. Respaldo. |
| `0842_interruptor_carta_porte_salida_tms` | CHECK `interruptor_id_dominio` ampliado (61 nombres) con `agente:carta_porte_salida_tms`. | R | `delete from public.interruptor where id = 'agente:carta_porte_salida_tms'; alter table public.interruptor drop constraint interruptor_id_dominio; alter table public.interruptor add constraint interruptor_id_dominio check (id in (<lista de 60 nombres de 0250_palancas_carta_porte_y_copiloto.sql>));` Copiar la lista **literal** de la `0250`; no escribirla de memoria. | **Revertir esta deja sin posibilidad de apagar la salida al TMS desde el panel** (no se puede insertar la fila). Preferible dejarla. Otras migraciones del rango que añadieron palancas cuya fila ya exista harían fallar el `add constraint`: confirmar primero con `select id from public.interruptor`. |

### 3.4 Vigía: programa, avisos y datos del viaje (0795–0799, 0803, 0805–0809, 0820, 0823)

El detalle de 0795–0799 (apagado de emergencia en niveles 1 y 2, copia previa, orden de reversa y qué hacer con el
cliente si ya salió algo) está en [vigia-aviso-rollback.md](vigia-aviso-rollback.md). Aquí el resumen.

| Migración | Efecto | Tipo | Reversa SQL | Cuándo NO revertir |
| --- | --- | --- | --- | --- |
| `0795_programa_despacho` | Tablas `programa_despacho_carga`, `programa_despacho_fila`, `programa_despacho_cambio`, índices. | A | `drop table if exists public.programa_despacho_cambio; drop table if exists public.programa_despacho_fila; drop table if exists public.programa_despacho_carga;` (documentada en el archivo; revertir **después** de 0796, 0797 y 0799, que apuntan a `programa_despacho_fila` con `on delete cascade`/`set null`). | Si hay cargas del programa: es el insumo de todo el Vigía. Respaldo. |
| `0796_vigia_datos_viaje` | Tablas `vigia_caja`, `vigia_dato_viaje_manual` (puede contener licencia y teléfono del operador, **dato personal**), `vigia_politica_datos`; función `vigia_dato_visible(uuid, uuid, text, boolean)`. | A | `drop function if exists public.vigia_dato_visible(uuid, uuid, text, boolean); drop table if exists public.vigia_politica_datos; drop table if exists public.vigia_dato_viaje_manual; drop table if exists public.vigia_caja;` | La **política de privacidad** (`vigia_politica_datos`) define qué puede ver el cliente: borrarla sin reemplazo y con el código nuevo en pie puede exponer o negar datos. Apagar los avisos primero. Datos personales: respaldo y aviso. |
| `0797_vigia_aviso` | Tablas `vigia_aviso_config` y `vigia_aviso`; trigger `vigia_aviso_transicion_trg`; funciones `vigia_aviso_transicion()`, `vigia_aviso_reclamar(uuid, uuid, integer, timestamptz)`, `vigia_aviso_cerrar(uuid, uuid, uuid, text, text, timestamptz)`. | A | `drop function if exists public.vigia_aviso_cerrar(uuid, uuid, uuid, text, text, timestamptz); drop function if exists public.vigia_aviso_reclamar(uuid, uuid, integer, timestamptz); drop table if exists public.vigia_aviso; drop function if exists public.vigia_aviso_transicion(); drop table if exists public.vigia_aviso_config;` | Los avisos `enviado` son registro de lo que se le dijo al cliente. No borrar si ya se envió alguno; apagar con `update public.vigia_aviso_config set habilitado = false` (vigia-aviso-rollback, nivel 1). |
| `0798_vigia_servicio_prioridad` | Tablas `vigia_servicio_cliente`, `vigia_festivo`; columna `vigia_director.turno`; columnas `prioridad` en `vigia_conversacion` y `vigia_mensaje`; `vigia_config.solo_avisar`; CHECK de intención con `datos_unidad`; funciones `vigia_servicio_guardar(uuid, uuid, uuid, text, text, text, boolean, uuid)` y `vigia_servicio_quitar(uuid, uuid)`. | R | Bloque completo, en este orden: `update public.vigia_mensaje set intencion = 'otro' where intencion = 'datos_unidad'; alter table public.vigia_mensaje drop constraint if exists vigia_mensaje_intencion_dominio; alter table public.vigia_mensaje add constraint vigia_mensaje_intencion_dominio check (intencion is null or intencion in ('ubicacion','eta','documentos','factura_pod','queja','pide_humano','baja','saludo','otro')); alter table public.vigia_mensaje drop column if exists prioridad; alter table public.vigia_conversacion drop column if exists prioridad; alter table public.vigia_config drop column if exists solo_avisar; drop table if exists public.vigia_festivo; alter table public.vigia_director drop column if exists turno; drop function if exists public.vigia_servicio_quitar(uuid, uuid); drop function if exists public.vigia_servicio_guardar(uuid, uuid, uuid, text, text, text, boolean, uuid); drop table if exists public.vigia_servicio_cliente;` (tomada del bloque ROLLBACK del archivo). | `vigia_servicio_cliente` guarda **teléfonos y correos** de contactos del cliente; `vigia_festivo` y `turno` son configuración de la flota. Si el CHECK de intención se restaura con la lista de `0400` y el `update` previo se omite, falla. Respaldo y aviso. |
| `0799_vigia_estatus_importacion` | Tabla `vigia_estatus_importacion`, trigger `vigia_estatus_importacion_orden` y su función. | A | `drop table if exists public.vigia_estatus_importacion; drop function if exists public.vigia_estatus_importacion_orden();` (documentada en el archivo). | Si hay estatus de caja de varias fuentes (programa, track & trace, manual). Respaldo. |
| `0803_sitio_equivalencia` | Tabla `sitio_equivalencia`; CHECK `viaje_sitio_derivado_criterio_dominio` ampliado (`equivalencia`, `equivalencia_sin_sitio`). | R | `delete from public.viaje_sitio_derivado where criterio in ('equivalencia','equivalencia_sin_sitio');` (o reclasificar) → restaurar el CHECK con la lista de `0637_viaje_sitio_derivado.sql` → `drop table if exists public.sitio_equivalencia;` | Las equivalencias las **capturó la flota** (texto de sitio a geocerca). Borrar `viaje_sitio_derivado` pierde un derivado que el Conductor ya usó; si hay uso, dejar el CHECK ampliado y solo apagar. Respaldo. |
| `0805_insight_linea_base` | Tabla `insight_linea_base` con política `administra_flota`. | A | `drop table if exists public.insight_linea_base;` (documentada en el archivo, "solo si nadie capturó nada"). | Si alguien capturó una línea base: es la referencia contra la que se mide la mejora. Respaldo. |
| `0806_viaje_parada` | Tabla `viaje_parada`; trigger `viaje_parada_cerrar_al_liquidar` sobre `viaje` y su función. | A | `drop trigger if exists viaje_parada_cerrar_al_liquidar on public.viaje; drop function if exists public.viaje_parada_cerrar_al_liquidar(); drop table if exists public.viaje_parada;` | Si hay paradas registradas (insumo de cobro y de la lectura del viaje). Quitar el trigger **antes** que la función. Respaldo. |
| `0807_ciclo_por_servicio` | Tabla `ciclo_servicio` (ciclo esperado por tipo de servicio). | A | `drop table if exists public.ciclo_servicio;` | Es configuración de la flota. Respaldo. |
| `0808_ruta_autorizada` | Tabla `ruta_autorizada` (corredores autorizados), índices. | A | `drop table if exists public.ruta_autorizada;` | Configuración de la flota que alimenta alertas de desvío. Respaldo. |
| `0809_catalogo_documentos_cliente` | Tabla `cliente_documento_requerido` (documentos que exige cada cliente). | A | `drop table if exists public.cliente_documento_requerido;` (documentada en el archivo). Revertir `0823` antes (la referencia con FK compuesta). | Configuración de la flota. Respaldo. |
| `0820_evento_geocerca_huerfano` | Columna `agente_conductor_config.registrar_geocerca_huerfana` (default `false`); tabla `evento_geocerca_huerfano`; función `purgar_eventos_geocerca_huerfanos(integer, integer)`. | A | `drop function if exists public.purgar_eventos_geocerca_huerfanos(integer, integer); drop table if exists public.evento_geocerca_huerfano; alter table public.agente_conductor_config drop column if exists registrar_geocerca_huerfana;` | Sin riesgo si la columna está en `false` (apagado por omisión). Con eventos guardados: son cruces aún no reconciliados; respaldo. |
| `0823_documentos_cierre_evidencia` | CHECK `viaje_hito_evidencia_tipo` ampliado con `documento_cierre`; columna `viaje_hito_evidencia.documento_requerido_id` (FK compuesta); constraints `cliente_documento_requerido_id_tenant_key`, `viaje_hito_evidencia_id_tenant_key`; tabla `viaje_documento_cierre`. | R | `drop table if exists public.viaje_documento_cierre; alter table public.viaje_hito_evidencia drop column if exists documento_requerido_id;` Según el propio archivo **el CHECK se deja ampliado**: quitar `documento_cierre` exige antes borrar o reclasificar las filas que lo usen y restaurar la lista de `0385_conductor_validacion_sitios_evidencia.sql` (`sello, anden, recibido, otra`). | Si hay documentos de cierre recibidos: es evidencia de entrega. Respaldo. Las constraints únicas (`*_id_tenant_key`) las usan también `0852` y las FK: no quitarlas mientras haya dependientes. |

### 3.5 Conductor (0800, 0801, 0851–0853, 0855)

| Migración | Efecto | Tipo | Reversa SQL | Cuándo NO revertir |
| --- | --- | --- | --- | --- |
| `0800_conductor_voluntarios_y_origen_aceptacion` | Columnas `operador.agente_voluntario`, `agente_voluntario_desde`, `agente_voluntario_por`; `viaje.aceptado_origen` + CHECK; `agente_conductor_config.piloto_max_voluntarios` + CHECK; índice `operador_voluntario_idx`; funciones `aceptar_viajes_importados(uuid, uuid[], timestamptz)`, `retirar_voluntario(uuid, uuid)`. | A | `drop function if exists public.retirar_voluntario(uuid, uuid); drop function if exists public.aceptar_viajes_importados(uuid, uuid[], timestamptz); drop index if exists public.operador_voluntario_idx; alter table public.agente_conductor_config drop column if exists piloto_max_voluntarios; alter table public.viaje drop column if exists aceptado_origen; alter table public.operador drop column if exists agente_voluntario, drop column if exists agente_voluntario_desde, drop column if exists agente_voluntario_por;` | **Quién es voluntario del piloto es consentimiento de personas**: borrar `agente_voluntario` pierde ese registro y puede hacer que el Conductor deje de hablarle a quien aceptó (o, peor, que hable con quien no). Mejor apagar el agente con interruptor y dejar las columnas. |
| `0801_conductor_perfil_seguimiento_y_umbrales` | 10 columnas de perfil/umbrales en `agente_conductor_config` (`perfil_seguimiento`, `gps_obsoleto_min`, `detenido_min`, `segundo_aviso_min`, `escalar_senal_min`, `silencio_respuesta_min`, `mostrar_estados_frontera`, `aplicar_salida_del_tms`, `linea_base_llamadas_por_viaje`, `linea_base_registrada_en`) + 3 CHECK; redefine `sembrar_hitos_conductor(integer)`. | R | **Primero restaurar la función** con el cuerpo de `0380_conductor_hitos.sql` (copiar el `create or replace function public.sembrar_hitos_conductor` literal; no confundir con otra firma), **después**: `alter table public.agente_conductor_config drop column if exists perfil_seguimiento, drop column if exists gps_obsoleto_min, drop column if exists detenido_min, drop column if exists segundo_aviso_min, drop column if exists escalar_senal_min, drop column if exists silencio_respuesta_min, drop column if exists mostrar_estados_frontera, drop column if exists aplicar_salida_del_tms, drop column if exists linea_base_llamadas_por_viaje, drop column if exists linea_base_registrada_en;` | Si la flota ajustó umbrales o la **línea base** de llamadas por viaje ya está registrada (es la referencia para medir la mejora): se pierde. Respaldo. |
| `0851_un_viaje_abierto_por_unidad` | Índice único parcial `uq_viaje_abierto_por_unidad (tenant_id, unidad_id) where estatus in ('abierto','en_cuadre') and unidad_id is not null`; la migración **aborta** si ya hay unidades con dos viajes abiertos. | A | `drop index if exists public.uq_viaje_abierto_por_unidad;` (documentada en el archivo). | Sin riesgo de datos. Quitarlo reabre la doble asignación de una unidad: solo si bloquea una operación legítima. |
| `0852_evidencia_reuso_tenant` | Columna `viaje_hito_evidencia.reuso_tenant_evidencia_id`; constraints `viaje_hito_evidencia_id_tenant_key` y `viaje_hito_evidencia_reuso_fkey`; índice `viaje_hito_evidencia_sha_tenant_idx`; trigger `conductor_detectar_evidencia_reuso_tenant` y su función (ventana de 180 días). | A | `drop trigger if exists conductor_detectar_evidencia_reuso_tenant on public.viaje_hito_evidencia; drop function if exists public.conductor_detectar_evidencia_reuso_tenant(); drop index if exists public.viaje_hito_evidencia_sha_tenant_idx; alter table public.viaje_hito_evidencia drop column if exists reuso_tenant_evidencia_id;` (documentada en el archivo). La constraint `viaje_hito_evidencia_id_tenant_key` **no** se quita aquí: también la declara `0823`. | Es **control antifraude** (evidencia reutilizada entre viajes). Quitarlo deja pasar la misma foto en dos viajes. Las filas marcadas son la prueba de un caso: respaldo. |
| `0853_tablero_validacion_degradada` | Redefine `conductor_indicadores(uuid, timestamptz, timestamptz, uuid, uuid, uuid)` (agrega dos claves de validación degradada). | R | Restaurar el cuerpo de `0385_conductor_validacion_sitios_evidencia.sql` (`create or replace function public.conductor_indicadores` con la misma firma; hay que **conservar** el mismo `returns`, si no fallaría el `or replace`). | Sin datos. Pero el tablero del código nuevo lee las dos claves nuevas: volver primero el código. |
| `0855_viaje_rechazado_en` | Columna `viaje.rechazado_en`; CHECK `viaje_rechazado_requiere_aviso`; índice parcial `viaje_sin_aceptar_idx` recreado con `rechazado_en is null`. | R | `drop index if exists public.viaje_sin_aceptar_idx; alter table public.viaje drop column if exists rechazado_en; create index if not exists viaje_sin_aceptar_idx on public.viaje (avisado_en) where aceptado_en is null and escalado_en is null and estatus = 'abierto';` (el predicado original es el de `0058_confirmacion_de_viaje.sql`; confirmarlo ahí antes de correr). La columna ya se lleva la constraint. | Si hay viajes rechazados registrados: sin la columna, la escalación vuelve a tratar un rechazo como "no contestó". Respaldo. |

### 3.6 Seguridad, cuentas, otros (0840, 0841, 0844–0846, 0848, 0849, 0854)

| Migración | Efecto | Tipo | Reversa SQL | Cuándo NO revertir |
| --- | --- | --- | --- | --- |
| `0840_revocar_sesiones_usuario` | Función `revocar_sesiones_usuario(uuid)` (borra `auth.sessions` del usuario; solo `service_role`). | A | `drop function if exists public.revocar_sesiones_usuario(uuid);` | Sin datos. Pero la usa el código al dar de baja un usuario: **volver el código antes**, o dar de baja a alguien no cerrará sus sesiones activas (riesgo de seguridad). |
| `0841_cerrar_policies_for_all_restantes` | Reemplaza las políticas `for all` por `select` acotado a flota/rol en `conector_credencial`, `tenant_api_key`, `invitacion`, `solicitud_arco`, `rastreo_credencial`; quita `plan_escritura`, `suscripcion_escritura`, `factura_saas_escritura`, `plan_price_escritura`; deja `evento_stripe_superadmin` solo en `select`. | D | **No hay reversa recomendada.** Solo existe en la forma "recrear las políticas `for all` originales" (`0050`, `0052`, `0053`, `0055`, `0093`, `0094`, `0163`), y eso **reabre escritura por PostgREST con el JWT del usuario** (credenciales de conectores, llaves de API, planes, suscripciones y facturas). | **Nunca revertir** salvo instrucción expresa del responsable de seguridad. Si algo legítimo dejó de funcionar, el arreglo es mover esa escritura al servidor (`service_role`), no reabrir la política. |
| `0844_gasto_aviso_sin_robot` | Columna `gasto.autofactura_aviso_sin_robot_en`. | A | `alter table public.gasto drop column if exists autofactura_aviso_sin_robot_en;` | Se pierde el registro de a quién ya se avisó "sin robot"; el aviso podría repetirse a la flota. Respaldo. |
| `0845_jornada_alerta_enviado_candado` | Columna `jornada_alerta.enviado_en`; función `marcar_jornada_alerta_enviada(...)` (10 argumentos); **redefine** `reclamar_jornada_alerta` con `drop` + `create` (cambia el `returns table`). | R | `drop function if exists public.reclamar_jornada_alerta(uuid, uuid, text, integer, integer, boolean, text, boolean, timestamptz, integer); drop function if exists public.marcar_jornada_alerta_enviada(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz);` luego **recrear** `reclamar_jornada_alerta` copiando el `create function` de `0502_jornada_alerta_tope.sql` (con su `returns table` original), y por último `alter table public.jornada_alerta drop column if exists enviado_en;` | Es el candado de "una sola vez" de las alertas de jornada (LFT). Sin la columna, el reenvío puede duplicar alertas a operadores y encargados. Antes volver el código; y no hacerlo entre cron y cron sin haber apagado `jornada-alertas`. |
| `0846_equipo_candado_ultimo_dueno` | Funciones `equipo_cambiar_rol(uuid, uuid, text, text)` y `equipo_desactivar_usuario(uuid, uuid, text, uuid)` con candado por flota (impide dejar la flota sin dueño). | A | `drop function if exists public.equipo_desactivar_usuario(uuid, uuid, text, uuid); drop function if exists public.equipo_cambiar_rol(uuid, uuid, text, text);` | **Volver el código antes**: con las funciones borradas, cambiar roles y dar de baja usuarios falla; con una versión vieja del código que lo haga en dos consultas se reabre la carrera "último dueño". |
| `0848_factura_proveedor_cfdi_tardio` | Columnas `factura_proveedor.xml_crudo_tardio`, `recibido_tardio_en`; CHECK `factura_proveedor_cfdi_tardio_coherente`. | A | `alter table public.factura_proveedor drop column if exists xml_crudo_tardio, drop column if exists recibido_tardio_en;` | `xml_crudo_tardio` es el **CFDI original** que llegó después: documento fiscal con obligación de conservarse. Si hay filas llenas, no borrar. Respaldo. |
| `0849_arco_cancelacion_cuenta_candado_ultimo_dueno` | **Redefine** `ejecutar_arco_cancelacion_cuenta(uuid, uuid)` (cancelación de cuenta por solicitud ARCO) con el candado de último dueño; borra/anonimiza datos del usuario al ejecutarse. | R | Restaurar el cuerpo de `0442_arco_cancelacion_cuenta_de_oficina.sql` (`create or replace function public.ejecutar_arco_cancelacion_cuenta` misma firma). | La reversa quita el candado y deja ejecutar una cancelación que deje a la flota sin dueño. Además **esta función ya ejecutó borrados reales** si hubo solicitudes ARCO: nada de lo borrado vuelve con la reversa. |
| `0854_freno_temporal` | Tabla `freno_temporal` (frenos con plazo, deny-all), RLS. | A | `drop table if exists public.freno_temporal;` | Si hay un freno activo (`activo_hasta` futuro), borrarlo lo **levanta** sin avisar. Mirar `select * from public.freno_temporal where activo_hasta > now();` antes. El código que escribe/lee frenos (`marcarFrenoTemporal` / `frenoTemporalActivo` en `src/lib/likida/interruptores.ts`) tolerará mal la ausencia: volver el código antes. |

## 4. Rollback de código en Vercel por SHA

Volver el código es **más seguro y rápido que revertir SQL**, y es el primer paso si el problema es de comportamiento
y no de estructura. El flujo es `.github/workflows/rollback-production.yml`, "Vercel rollback production".

**Entradas reales** (`workflow_dispatch`, ambas obligatorias):

| Entrada | Qué es |
| --- | --- |
| `deployment_url` | URL o ID **exacto** del deployment estable al que volver. Debe empezar con `https://`. |
| `confirmation` | Debe ser exactamente `ROLLBACK_PRODUCTION`. Cualquier otro valor aborta sin tocar producción. |

Lo que hace, en orden:

1. **Valida (fail-closed):** rechaza una URL que no sea HTTPS y una confirmación incorrecta.
2. **Corre `npx --yes vercel@41.7.3 rollback "$URL"`** con el secreto `VERCEL_TOKEN` (falla si falta). Corre en el
   entorno `production` de GitHub, así que aplican sus reglas de aprobación.
3. **Verifica salud:** pide `"$URL/api/health"` con reintentos y exige `status == "ok"` y `checks.db == "ok"`.

Notas:

- **No recibe un SHA**, recibe un deployment. Para volver "a un SHA" hay que localizar primero el deployment que Vercel
  construyó con ese commit (panel de Vercel, o `vercel ls`) y pasar su URL/ID. Verifica que el deployment elegido
  corresponde al commit esperado antes de lanzarlo.
- **Un rollback de Vercel no cuesta un build** (promueve un deployment ya hecho). Lanzar el workflow son 0 builds.
  Revertir en Git con un commit nuevo a la rama que despliega **sí** dispara un build: decirlo y contarlo antes (regla
  de costos de la plataforma). No se usa la bandera `[deploy]` para esto.
- **Compatibilidad con la base:** el código al que se vuelve debe funcionar con el esquema actual. Las migraciones de
  este rango son aditivas casi todas, por lo que el código anterior las ignora; las excepciones están en la columna
  "Cuándo NO revertir" (`0840`, `0845`, `0846`, `0850`, `0853`: el código nuevo depende de ellas, el viejo no). Si el
  SHA elegido es anterior a una migración que el código aún necesita, **no** se baja de ahí sin revisar.
- Después del rollback, confirma `/api/health` y la pantalla `/admin/crons` (los latidos vuelven a verde).

## 5. Rollback por superficie

| Superficie | Cómo se apaga o se revierte | Documento |
| --- | --- | --- |
| Perfil de flota `cinco_agentes` (menú, resumen, OCR y cuadre) | `scripts/perfil/revertir-cinco-agentes.sh [--produccion] <UUID>`: borra `tenant_perfil` y **solo** los interruptores `ocr`/`cuadre` que puso el perfil; escribe un respaldo del estado previo en `~/likida-respaldos/perfil/` y pide escribir el UUID. **No** toca `liquidacion_correo_config` (decisión de producto: el canal de liquidación sigue en correo). Verificación: `scripts/perfil/verificar-cinco-agentes.sh --esperado sin ...`. | [perfil-cinco-agentes.md](perfil-cinco-agentes.md) |
| Peajes (cobros, atípicos, reclamos, canales de ingesta, SFTP) | Apagar `agente:peajes` (el cron lo respeta y responde `saltado`; el buzón responde `503` y no pierde archivos); desactivar canales de entrada por flota en la configuración; reversa SQL de 0775–0779, 0810–0815, 0843, 0847, 0850 (sección 3.1). Anular un desglose mal importado en vez de borrar tablas. | [peajes-rollback.md](peajes-rollback.md) |
| Vigía (programa de despacho, avisos al cliente, servicio, prioridad) | Nivel 1: `update public.vigia_aviso_config set habilitado = false` (una flota o todas) o la casilla en la pantalla de avisos. Nivel 2: limpiar lo pendiente. Nivel 3: reversas 0799 → 0795 una por una. | [vigia-aviso-rollback.md](vigia-aviso-rollback.md) |
| Carta porte: salida al TMS | Interruptor `agente:carta_porte_salida_tms`, o poner el modo en `descarga`. Reversa SQL de 0790–0794, 0830, 0832, 0842 (sección 3.3). | [carta-porte-salida-tms-rollback.md](carta-porte-salida-tms-rollback.md) |
| Conexión TMS (sincronización, mapeo, marcas de tránsito) | Desprogramar/apagar el cron `tms`; reversa de 0780–0782, 0784, 0802, 0804 (sección 3.2). | [conexion-tms.md](conexion-tms.md) |
| Liquidaciones por correo | Poner `liquidacion_correo_config.activa = false` por flota; detener el cron de purga; **no** borrar tablas con entregas hechas (sección 3.2). | [liquidacion-desglose-correo.md](liquidacion-desglose-correo.md) |
| Conductor (voluntarios, umbrales, evidencia, validación degradada) | Apagar el agente con interruptor (sección 6) o por flota con `interruptor_tenant`; los umbrales `aplicar_salida_del_tms`, `mostrar_estados_frontera` y `registrar_geocerca_huerfana` ya vienen en `false` por omisión. | [agente-conductor.md](agente-conductor.md) |
| Código en producción | Workflow de rollback por deployment (sección 4). | `.github/workflows/rollback-production.yml` |

## 6. Apagar crons y funciones con el interruptor por tenant

Hay dos palancas, y conviene usar la más pequeña que resuelva el problema.

**Global por agente** (`interruptor`, mig. 0110, ampliado por 0842): apagar `agente:peajes`,
`agente:carta_porte_salida_tms` o `global` desde la consola de Likida. Los crons leen `global` más el interruptor de
su agente en **cada corrida** y, si alguno está apagado, no procesan nada y dejan un latido `saltado`. No hay que
retirar el cron del despliegue. Afecta a **todas** las flotas.

**Por flota** (`interruptor_tenant`, mig. 0297; lectura en `src/lib/likida/interruptor_tenant.ts`): apaga el pipeline
del chofer de **una** flota sin tocar las demás. Reglas reales del código:

- Pipelines posibles: `whatsapp`, `ocr`, `cuadre` (CHECK de la tabla). No existe un pipeline para peajes, Vigía ni
  carta porte por flota: para esos se usa el interruptor global o el `habilitado` de su propia configuración.
- Se escribe una fila `(tenant_id, pipeline)` con `apagado = true` y **`motivo` obligatorio** (el CHECK lo exige al
  apagar; se limpia al encender). Lo hace la pantalla de administración (`getInterruptoresPipelineDeTenant` / `apagar`
  / `encender` en `lib/admin/negocio.ts`); no se edita la tabla a mano salvo que el responsable lo decida y lo deje
  anotado.
- **Sin fila = encendido. Si la lectura falla = también encendido** (a diferencia del interruptor global, que falla
  cerrado): es una palanca operativa, no de incidente. Por eso **un apagado por flota no sirve como freno de
  emergencia si la base está inestable**; para eso, el global.
- `pipelineTenantApagado()` devuelve `true` por código para `ocr` y `cuadre` cuando la flota tiene el perfil
  `cinco_agentes` (aunque no haya fila). `whatsapp` nunca se apaga por perfil. Quitar el perfil (sección 5) devuelve
  `ocr` y `cuadre` a su estado normal.

**Frenos con plazo** (`freno_temporal`, 0854): los escribe el propio código para frenar algo un tiempo (p. ej.
cobranza). Pasado `activo_hasta` quedan inertes; no se rehabilitan a mano, se esperan o se borra la fila sabiendo
que se levanta el freno.

**Apagado de una función programada concreta**, de más suave a más fuerte:
1. Interruptor del agente (global o por flota, según la tabla de arriba).
2. `habilitado = false` / `activa = false` en la configuración propia (`vigia_aviso_config`,
   `liquidacion_correo_config`, `cp_salida_config`, `peaje_ingesta_config.sftp_activo`).
3. Desprogramar el cron del despliegue: es cambio de código y sí cuesta un build; no hacerlo sin decirlo antes.

## 7. Lista de comprobación antes de cualquier reversa en producción

- [ ] Hay un incidente real y los interruptores (sección 6) no bastaron.
- [ ] El código ya está en una versión compatible (sección 4) y `/api/health` está en `ok`.
- [ ] `scripts/respaldo.sh` produjo un archivo con tamaño real y se pudo abrir.
- [ ] Se probó el mismo bloque SQL en una base local o rama de pruebas.
- [ ] Se revisó la columna "Cuándo NO revertir" de **cada** migración del bloque, y se contó cuántas filas reales hay.
- [ ] Se revierte en orden inverso, una migración por transacción, con verificación antes de `commit`.
- [ ] Está avisada la persona responsable de la plataforma y, si hay datos personales o fiscales de por medio, la flota.
- [ ] Se anota qué se hizo, cuándo y con qué respaldo.

## 8. Qué este documento no cubre

- No es una prueba de que cada reversa corra: se redactaron a partir de la lectura de los archivos SQL y de las
  reversas documentadas en ellos; las que el archivo trae (`0780`, `0781`, `0782`, `0784`, `0795`–`0799`, `0805`,
  `0809`, `0823`, `0851`, `0852`, `0853`, `0855`) se copiaron de ahí; las demás se derivaron del propio DDL.
- No cubre migraciones fuera de `0770`–`0855`.
- No cubre las variables de entorno ni los secretos de Vercel, ni los datos que ya salieron por WhatsApp o por correo.
