-- 0684 · Preflight CONCURRENTLY de los índices de la prueba de carga de 250 camiones.
-- Correr con psql en autocommit ANTES de `supabase db push` si las tablas ya son grandes
-- (no bloquea INSERT/UPDATE/DELETE). Idempotente: si ya existen, no hace nada; un índice
-- inválido por una corrida interrumpida se retira y se rehace.
\set ON_ERROR_STOP on
set lock_timeout = '5s';
set statement_timeout = '30min';

select format('drop index concurrently public.%I', c.relname)
  from pg_index i join pg_class c on c.oid = i.indexrelid
 where i.indisvalid is false
   and c.relname in ('gasto_folio_sin_cfdi_idx','vigia_mensaje_aprobado_idx','vigia_mensaje_enviado_idx',
                     'viaje_hito_mensaje_en_idx','viaje_hito_tenant_actualizado_idx','viaje_hito_evento_creado_idx',
                     'viaje_hito_aviso_creado_idx','vigia_evento_creado_idx')
\gexec

create index concurrently if not exists gasto_folio_sin_cfdi_idx
  on public.gasto (tenant_id, concepto, folio, monto) include (viaje_id, id)
  where folio is not null and folio <> '' and (cfdi_uuid is null or cfdi_uuid = '');
create index concurrently if not exists vigia_mensaje_aprobado_idx
  on public.vigia_mensaje (aprobado_en) where direccion = 'saliente' and estado = 'aprobado';
create index concurrently if not exists vigia_mensaje_enviado_idx
  on public.vigia_mensaje (tenant_id, enviado_en desc)
  where direccion = 'saliente' and estado = 'enviado' and respuesta_a is not null;
create index concurrently if not exists viaje_hito_mensaje_en_idx
  on public.viaje_hito (tenant_id, mensaje_en) where mensaje_en is not null;
create index concurrently if not exists viaje_hito_tenant_actualizado_idx
  on public.viaje_hito (tenant_id, updated_at desc, id desc);
create index concurrently if not exists viaje_hito_evento_creado_idx on public.viaje_hito_evento (created_at);
create index concurrently if not exists viaje_hito_aviso_creado_idx on public.viaje_hito_aviso (created_at);
create index concurrently if not exists vigia_evento_creado_idx on public.vigia_evento (created_at);
