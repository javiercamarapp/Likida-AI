-- ═══════════════════════════════════════════════════════════════════════════
-- 0945 — PEAJES (A2, ola 10, A2P-18): la RESERVA con vencimiento de los avisos de cruces atípicos.
--
-- Antes el aviso de atípicos pasaba el hallazgo a `estado = 'avisado'` ANTES de enviar: si el proceso moría entre reservar y enviar, el
-- hallazgo quedaba «avisado» sin que nadie lo hubiera recibido y no se reenviaba. Ahora la reserva lleva un vencimiento
-- (`aviso_reservado_hasta`, 10 min): se limpia al confirmar el envío y, si vence sin confirmarse, el barrido devuelve el hallazgo a
-- `nuevo` para reintentar. NULL = sin reserva pendiente (todo lo anterior a esta migración queda como ya avisado, sin reenviar nada).
--
-- H759-1 (verificación independiente del PR #759): los avisos de desgloses de peaje que NO pueden salir por configuración (sin teléfono de
-- la oficina, plantilla sin aprobar) acaparaban la cola global de `peaje_avisos_pendientes` (5 por pasada, entre todas las flotas, ordenada
-- por antigüedad): 5 viejos bloqueados dejaban sin avisos a TODAS las flotas. Ahora un desglose bloqueado se APARTA con backoff:
-- `aviso_proximo_en` (no se vuelve a ofrecer antes de esa hora) y `aviso_esperas` (cuántas veces se pospuso; el código lo saca de la cola al
-- llegar al tope). La RPC respeta la espera y ordena por la próxima revisión (o la antigüedad si nunca se pospuso).
--
-- ADITIVA e IDEMPOTENTE: columnas nullable / con defecto, un índice parcial y `create or replace` de la RPC (misma firma y mismos permisos
-- que en la 0563). Sin tablas nuevas: RLS y permisos vienen de la 0779 y la 0563. Rango A2 ola 10: 0945–0949.
--
-- REVERSA (documentada, NO ejecutada): restaurar la RPC de la 0563 (sin el filtro de espera) y
--   drop index if exists public.peaje_atipico_reserva_pendiente_idx;
--   alter table public.peaje_atipico drop column if exists aviso_reservado_hasta;
--   alter table public.desglose_peaje drop constraint if exists desglose_peaje_aviso_esperas_chk;
--   alter table public.desglose_peaje drop column if exists aviso_esperas, drop column if exists aviso_proximo_en;
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.peaje_atipico add column if not exists aviso_reservado_hasta timestamptz;

comment on column public.peaje_atipico.aviso_reservado_hasta is
  '0945: vencimiento de la reserva del aviso (estado avisado sin confirmar). NULL = sin reserva pendiente. Vencida, el barrido devuelve el hallazgo a nuevo.';

create index if not exists peaje_atipico_reserva_pendiente_idx
  on public.peaje_atipico (aviso_reservado_hasta) where aviso_reservado_hasta is not null;

-- H759-1: el apartado con backoff de los avisos bloqueados por configuración.
alter table public.desglose_peaje add column if not exists aviso_proximo_en timestamptz;
alter table public.desglose_peaje add column if not exists aviso_esperas integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_aviso_esperas_chk') then
    alter table public.desglose_peaje add constraint desglose_peaje_aviso_esperas_chk check (aviso_esperas >= 0);
  end if;
end $$;
comment on column public.desglose_peaje.aviso_proximo_en is
  '0945: no se vuelve a ofrecer al barrido de avisos antes de esta hora (el aviso estaba bloqueado por configuración: sin destinatario o plantilla sin aprobar). NULL = sin espera.';
comment on column public.desglose_peaje.aviso_esperas is
  '0945: cuántas veces se pospuso el aviso por estar bloqueado por configuración; al llegar al tope el código lo saca de la cola (aviso_requerido=false) hasta que se vuelva a evaluar.';

-- Mismo contrato que en la 0563 (firma, SECURITY INVOKER, solo service_role); añade la espera y ordena por la próxima revisión.
create or replace function public.peaje_avisos_pendientes(p_limite int default 5, p_max_intentos int default 5)
returns table (tenant_id uuid, desglose_id uuid)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'peaje_avisos_pendientes: p_limite fuera de rango (1-50)';
  end if;
  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'peaje_avisos_pendientes: p_max_intentos fuera de rango (1-20)';
  end if;
  return query
  select d.tenant_id, d.id
    from public.desglose_peaje d
   where d.aviso_requerido and d.aviso_oficina_en is null and d.anulado_en is null and d.aviso_intentos < p_max_intentos
     and (d.aviso_proximo_en is null or d.aviso_proximo_en <= now())
   order by coalesce(d.aviso_proximo_en, d.creado_en), d.id
   limit p_limite;
end;
$$;
comment on function public.peaje_avisos_pendientes(int, int) is
  '0563/0945: desgloses con aviso a la oficina por enviar (barrido del cron de peajes). Cruza flotas a propósito; devuelve solo ids; aparta los bloqueados por configuración con backoff (aviso_proximo_en). SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_avisos_pendientes(int, int) from public, anon, authenticated;
grant execute on function public.peaje_avisos_pendientes(int, int) to service_role;
