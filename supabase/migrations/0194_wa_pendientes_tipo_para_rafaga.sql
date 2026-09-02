-- 0194 · AGEN-19C2-1 (corrección tras auditoría Fable-5 post-merge del
-- PR #72) — el drenado del cron (`drenado.ts`) agrupa por chofer igual que
-- el camino en vivo (`route.ts`, ESC-1), pero `listar_wa_pendientes` no
-- devolvía el TIPO del mensaje. Sin él, el cron no puede saber si hay otra
-- FOTO antes/después de la actual en la cadena de un chofer — la señal que
-- `processInbound` necesita para no cerrar la libreta de la ráfaga
-- foto-por-foto. Resultado medido: un fajo de fotos que cae al cron (el
-- caso de recuperación, no el camino feliz) seguía produciendo un acuse
-- suelto por foto, el antipatrón que el PR #72 decía haber cerrado.
--
-- Misma firma que 0187, con UNA columna aditiva — sin unicidad/atomicidad
-- nueva que verificar.

-- Postgres no deja ensanchar el `returns table` de una función existente con
-- `create or replace` (mismo caso que la 0189 con `finalizar_wa_outbox`).
drop function if exists public.listar_wa_pendientes(integer);

create or replace function public.listar_wa_pendientes(p_limite integer)
returns table (id text, intentos integer, remitente text, tipo text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limite < 1 or p_limite > 200 then
    raise exception 'wa inbox list size must be between 1 and 200';
  end if;
  return query
  select w.id,
         w.intentos,
         coalesce(nullif(w.evento ->> 'from', ''), w.id) as remitente,
         w.evento ->> 'type' as tipo
    from public.wa_evento_pendiente w
   where w.procesado_en is null
     and w.intentos < 5
     and (w.lease_expires_at is null or w.lease_expires_at <= clock_timestamp())
     -- Si A1 del mismo chofer sigue vivo en otra instancia, A2 no debe ni
     -- aparecer como trabajo disponible. El claim repite la invariantes abajo
     -- porque el listado es solo una optimización, no una frontera de verdad.
     and not exists (
       select 1
         from public.wa_evento_pendiente anterior
        where anterior.procesado_en is null
          and anterior.intentos < 5
          and coalesce(nullif(anterior.evento ->> 'from', ''), anterior.id)
              = coalesce(nullif(w.evento ->> 'from', ''), w.id)
          and (anterior.recibido_en, anterior.id) < (w.recibido_en, w.id)
          and anterior.lease_expires_at > clock_timestamp()
     )
   order by w.recibido_en, w.id
   limit p_limite;
end;
$$;

revoke all on function public.listar_wa_pendientes(integer) from public, anon, authenticated;
grant execute on function public.listar_wa_pendientes(integer) to service_role;
