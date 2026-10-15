# Vigía: apagado de emergencia y reversión de las migraciones 0795–0799

Guía para quien opera la plataforma cuando el aviso proactivo del Vigía (Agente 4) hay que **detenerlo ya** o **deshacerlo**. Cómo funciona el aviso
está en [vigia-aviso-proactivo.md](vigia-aviso-proactivo.md); el estado general del Vigía, en [vigia-cliente.md](vigia-cliente.md).

> Estado al 15-oct-2026: las migraciones 0795–0799 están construidas y probadas contra una base local de pruebas. **Ninguna está aplicada en una base
> real.** Esta guía es para el día en que lo estén. Una prueba (`src/app/dashboard/agentes/vigia/operacion_docs.test.ts`) mantiene los bloques de
> abajo idénticos al bloque ROLLBACK de cada migración: si una migración cambia, la prueba falla hasta que esta guía se corrige.

Hay tres niveles, de menor a mayor daño. **Casi siempre basta el primero.**

| Nivel | Qué hace | Se deshace | Cuándo |
|---|---|---|---|
| 1. Apagar | `vigia_aviso_config.habilitado = false`: deja de armar y de enviar avisos | Sí, volviendo a encender | Un aviso salió mal, falta una plantilla, el cliente se quejó, duda |
| 2. Limpiar la cola | Descarta lo que quedó esperando (`pendiente_confirmacion`, `aprobado`, `fallido`, `sin_destinatario`, `borrador`) | No (queda como `descartado`, historia) | Después de apagar, para que nada salga al volver a encender |
| 3. Revertir migraciones | Borra las tablas y columnas de 0795–0799 | **No: se pierden los datos** (hay copia de seguridad previa) | Solo si hay que retirar la función del todo |

## Lo que no se puede deshacer

- **Un aviso ya enviado no se puede «des-enviar».** Si salió a un cliente por WhatsApp o el ejecutivo lo copió a su chat, ya está en manos de la
  otra persona. Apagar y revertir solo evitan los siguientes. Si el aviso llevaba un dato equivocado, la corrección es un mensaje nuevo, escrito por una
  persona, que aclare el error.
- Un aviso en estado `enviado`, `descartado` o `reemplazado` es historia: la base impide editarlo (trigger `vigia_aviso_transicion`).
- Un correo o un WhatsApp entregado por el proveedor no se recupera aunque se borre la fila que lo registró.

## Nivel 1: apagado de emergencia (segundos)

Elegir **una** de las dos vías.

**Desde la pantalla** (la dueña de la flota, rol `flota_admin`): `/dashboard/agentes/vigia/avisos`, bloque de configuración, quitar la casilla de
encendido y guardar. Queda en la bitácora quién y cuándo.

**Desde SQL** (operador de la plataforma, con la sesión de servicio). Una flota:

```sql
update public.vigia_aviso_config
   set habilitado = false, actualizado_en = now()
 where tenant_id = '<id de la flota>';
```

Todas las flotas a la vez:

```sql
update public.vigia_aviso_config set habilitado = false, actualizado_en = now();
```

Efecto, comprobado en el código y en la prueba de la base:

- Sin fila de configuración **o** con `habilitado = false` no se arma ningún aviso nuevo (`generar.ts`) ni se reclama ninguno para enviar
  (`vigia_aviso_reclamar` no devuelve nada si la flota no está habilitada, 0797).
- La bandeja (`/dashboard/agentes/vigia/avisos`) muestra «El aviso de viaje está apagado» y rechaza confirmar o marcar avisos.
- No se pierde nada: lo que ya estaba en la bandeja sigue ahí, en su estado.
- El Vigía de servicio al cliente (clasificar, escalar a gerentes y directores) **no** se apaga con esto; es otro interruptor (`vigia_config.habilitado`,
  ver [vigia-cliente.md](vigia-cliente.md)). Solo apagarlo si la emergencia es del Vigía completo.

Comprobar que quedó apagado:

```sql
select tenant_id, habilitado from public.vigia_aviso_config order by tenant_id;
```

Y que ya no salen avisos: en `/admin/crons` el latido del cron `vigia` deja de contar `avisosCreados` y `avisosEnviados` (la pasada de avisos corre
con el mantenimiento, cada 5 minutos, así que esperar hasta 5 minutos).

## Nivel 2: limpiar lo que quedó esperando

Después de apagar, descartar lo pendiente para que, el día que se vuelva a encender, no salga de golpe un montón de avisos viejos con datos que ya
cambiaron. Las transiciones a `descartado` las permite el trigger desde cualquiera de estos estados; `aprobado` pierde su arriendo de envío al
descartarse.

```sql
update public.vigia_aviso
   set estado = 'descartado', motivo = 'apagado de emergencia'
 where tenant_id = '<id de la flota>'
   and estado in ('borrador', 'pendiente_confirmacion', 'aprobado', 'fallido', 'sin_destinatario');
```

(Quitar la línea de `tenant_id` para limpiar todas las flotas.) Contar antes lo que se va a descartar:

```sql
select estado, count(*) from public.vigia_aviso
 where estado in ('borrador', 'pendiente_confirmacion', 'aprobado', 'fallido', 'sin_destinatario')
 group by estado order by estado;
```

Un aviso que **ya se estaba enviando** cuando se apagó (reclamado, con arriendo vigente) puede salir una última vez: el arriendo dura 5 minutos. Esperar
ese tiempo antes de limpiar si importa.

## Nivel 3: revertir las migraciones, una por una

Solo si hay que retirar la función. Reglas:

1. **Copia de seguridad previa, siempre.** Cada reversión borra datos. Sin copia de seguridad no se empieza.
2. **Una por una, en orden inverso**: 0799, 0798, 0797, 0796, 0795. Hay llaves foráneas de 0797 y 0799 hacia las filas del programa (0795); revertir en
   otro orden falla o deja la base a medias.
3. **Cada migración dentro de su transacción** (los bloques de abajo traen `begin;` y `commit;`). Si una falla, no queda nada a medias; se corrige y se
   repite esa sola.
4. Apagar primero (nivel 1) y esperar 5 minutos a que el cron no tenga nada en vuelo.
5. Nada de esto se ejecuta contra la base real sin que el dueño de la plataforma lo autorice; el aviso de despliegue ya exige migraciones aplicadas
   antes de `[deploy]`, así que revertir una migración con código desplegado que la usa deja funciones degradadas (ver abajo).

### Copia de seguridad previa

Con la cadena de conexión del proyecto en la variable de entorno `SUPABASE_DB_URL` (nunca escrita en un archivo del repositorio ni en un chat):

```bash
mkdir -p copia-vigia && cd copia-vigia
for t in programa_despacho_carga programa_despacho_fila programa_despacho_cambio \
         vigia_caja vigia_dato_viaje_manual vigia_politica_datos \
         vigia_aviso_config vigia_aviso \
         vigia_servicio_cliente vigia_festivo vigia_estatus_importacion; do
  pg_dump "$SUPABASE_DB_URL" --data-only --table="public.$t" --file="$t.sql"
done
psql "$SUPABASE_DB_URL" -c "\copy (select tenant_id, solo_avisar from public.vigia_config) to 'vigia_config_solo_avisar.csv' csv header"
psql "$SUPABASE_DB_URL" -c "\copy (select id, turno from public.vigia_director) to 'vigia_director_turno.csv' csv header"
psql "$SUPABASE_DB_URL" -c "\copy (select id, prioridad from public.vigia_conversacion) to 'vigia_conversacion_prioridad.csv' csv header"
psql "$SUPABASE_DB_URL" -c "\copy (select id, prioridad, intencion from public.vigia_mensaje) to 'vigia_mensaje_prioridad.csv' csv header"
ls -l   # ningún archivo en 0 bytes
```

Estos archivos contienen datos de operación (placas, operadores, avisos): guardarlos **fuera del repositorio**, con acceso restringido, y borrarlos
cuando ya no hagan falta.

### Revertir 0799 (estatus de importación por caja)

Sin dependientes.

```sql
begin;
drop table if exists public.vigia_estatus_importacion;
drop function if exists public.vigia_estatus_importacion_orden();
commit;
```

### Revertir 0798 (servicio al cliente, turnos, prioridad, «solo avisar»)

Antes: el CHECK de intención solo se puede restaurar si ningún mensaje conserva la intención `datos_unidad`; el primer `update` los pasa a `otro`.

**Cuidado con `solo_avisar`.** Esa columna es la que mantiene al Vigía en «avisar, no contestar». Sin ella el código se comporta como
`solo_avisar = false`: vuelve el copiloto que redacta borradores por aprobar y, si la flota lo tenía, el autoenvío. **Apagar el Vigía de la flota
(`vigia_config.habilitado = false`) antes de revertir esta migración**, o aceptar ese cambio de comportamiento.

```sql
begin;
update public.vigia_mensaje set intencion = 'otro' where intencion = 'datos_unidad';
alter table public.vigia_mensaje drop constraint if exists vigia_mensaje_intencion_dominio;
alter table public.vigia_mensaje add constraint vigia_mensaje_intencion_dominio check (
  intencion is null or intencion in ('ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'baja', 'saludo', 'otro'));
alter table public.vigia_mensaje drop column if exists prioridad;
alter table public.vigia_conversacion drop column if exists prioridad;
alter table public.vigia_config drop column if exists solo_avisar;
drop table if exists public.vigia_festivo;
alter table public.vigia_director drop column if exists turno;
drop function if exists public.vigia_servicio_quitar(uuid, uuid);
drop function if exists public.vigia_servicio_guardar(uuid, uuid, uuid, text, text, text, boolean, uuid);
drop table if exists public.vigia_servicio_cliente;
commit;
```

### Revertir 0797 (bandeja de avisos y su configuración)

Se pierde la bandeja completa, incluido el historial de lo enviado. La copia de seguridad de `vigia_aviso` es el único registro de qué se le dijo a cada cliente.

```sql
begin;
drop function if exists public.vigia_aviso_cerrar(uuid, uuid, uuid, text, text, timestamptz);
drop function if exists public.vigia_aviso_reclamar(uuid, uuid, integer, timestamptz);
drop table if exists public.vigia_aviso;
drop function if exists public.vigia_aviso_transicion();
drop table if exists public.vigia_aviso_config;
commit;
```

### Revertir 0796 (datos del viaje y política de privacidad)

Se pierden las cajas del catálogo, lo capturado a mano por servicio (operador, licencia, teléfono) y las reglas de privacidad. Esa copia contiene datos
personales de terceros: tratarlo como tal.

```sql
begin;
drop function if exists public.vigia_dato_visible(uuid, uuid, text, boolean);
drop table if exists public.vigia_politica_datos;
drop table if exists public.vigia_dato_viaje_manual;
drop table if exists public.vigia_caja;
commit;
```

### Revertir 0795 (programa de despacho)

La última: las demás dependían de sus filas.

```sql
begin;
drop table if exists public.programa_despacho_cambio;
drop table if exists public.programa_despacho_fila;
drop table if exists public.programa_despacho_carga;
commit;
```

### Después de revertir

- El código tolera la ausencia de estas tablas (error 42P01 o PGRST205 = «aún no aplicada»): las pantallas del programa y de los avisos muestran el
  aviso de migración pendiente y el cron no arma ni envía nada. No hace falta redesplegar para que nada se rompa.
- Comprobar que las tablas ya no existen y que el resto del Vigía sigue en pie:

```sql
select to_regclass('public.programa_despacho_fila') as programa, to_regclass('public.vigia_aviso') as aviso,
       to_regclass('public.vigia_caja') as caja, to_regclass('public.vigia_servicio_cliente') as servicio,
       to_regclass('public.vigia_estatus_importacion') as estatus;   -- todas null
select to_regclass('public.vigia_config') as config, to_regclass('public.vigia_conversacion') as conversacion;   -- ambas con valor
```

- Correr la batería de la base (las pruebas SQL de `supabase/tests/` del Vigía anterior a 0795) y las pruebas de la app; ver [vigia-cliente.md](vigia-cliente.md),
  sección «Operación».
- Volver a aplicar una migración revertida es seguro: todas son idempotentes (`if not exists`). Los datos se restauran desde la copia de seguridad con
  `psql "$SUPABASE_DB_URL" -f <tabla>.sql`, tabla por tabla y en el orden 0795, 0796, 0797, 0798, 0799.

## Qué hacer con el cliente si ya salió algo equivocado

1. Apagar (nivel 1) para que no salgan más.
2. Averiguar qué avisos salieron: `select id, fila_id, version, canal, enviado_en from public.vigia_aviso where estado = 'enviado' and enviado_en > now() - interval '1 day';`
3. Decidir con la flota si hace falta una aclaración. La escribe una persona; el Vigía no envía correcciones por su cuenta (una cancelación o un cambio nacen
   siempre como borrador por confirmar).
4. Registrar la causa y el arreglo antes de volver a encender.
