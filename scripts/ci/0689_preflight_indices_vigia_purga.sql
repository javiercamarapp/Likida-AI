-- 0689 · Preflight CONCURRENTLY de los índices de la purga del Vigía (ronda 16, vuelta 2).
-- Correr con psql en autocommit ANTES de `supabase db push` si `vigia_mensaje` ya es grande
-- (no bloquea INSERT/UPDATE/DELETE). Idempotente: si ya existen, no hace nada; un índice
-- inválido por una corrida interrumpida se retira y se rehace.
\set ON_ERROR_STOP on
set lock_timeout = '5s';
set statement_timeout = '30min';

select format('drop index concurrently public.%I', c.relname)
  from pg_index i join pg_class c on c.oid = i.indexrelid
 where i.indisvalid is false
   and c.relname in ('vigia_mensaje_respuesta_a_idx', 'vigia_conversacion_cerrada_idx')
\gexec

create index concurrently if not exists vigia_mensaje_respuesta_a_idx
  on public.vigia_mensaje (respuesta_a, tenant_id)
  where respuesta_a is not null;
create index concurrently if not exists vigia_conversacion_cerrada_idx
  on public.vigia_conversacion (cerrada_en)
  where estado = 'cerrada';
