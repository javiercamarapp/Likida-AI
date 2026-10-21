-- ═══════════════════════════════════════════════════════════════════════════
-- 0845 — JORNADA: candado de "ya se envió de verdad" (cierra la ventana de la
-- 0502 entre el WhatsApp real y el cierre del claim).
--
-- HALLAZGO (auditoría, LFT 132 fr. XXXIV): el arriendo (`p_lease_segundos`) del
-- claim de `reclamar_jornada_alerta` es de 300 s por omisión, pero la cadencia
-- del cron (`vercel.json`) es de 900 s. Si el proceso muere ENTRE que Meta
-- aceptó el WhatsApp real y que se llamó a `cerrar_jornada_alerta`, el claim
-- queda con arriendo vencido GARANTIZADO antes de la siguiente corrida. Esa
-- corrida retomaba el MISMO claim y volvía a correr el MISMO camino de envío
-- (`alerta_tope.ts`), que no distinguía "claim nuevo" de "claim retomado": un
-- SEGUNDO WhatsApp real para el mismo nivel, violando la regla #5 del propio
-- `alerta_tope.ts` ("UNA VEZ POR NIVEL"). Encima, el `ON CONFLICT DO UPDATE`
-- de la retoma SOBREESCRIBÍA `minutos_registrados`/`cota_inferior`/`fuente`,
-- borrando el rastro de CON QUÉ datos salió el primer aviso real — el
-- expediente de jornada es prueba ante autoridad, así que no se vale perder
-- ese rastro aunque el cierre se reintente mil veces.
--
-- DISEÑO (mismo patrón que `cp_envio_marcar_alerta`, 0790 — candado "una sola
-- vez" con columna `... IS NULL`): `jornada_alerta.enviado_en` se marca con
-- `marcar_jornada_alerta_enviada` INMEDIATAMENTE después de que al menos un
-- destinatario (encargado u operador) confirmó el envío real — ANTES de
-- llamar a `cerrar_jornada_alerta`. Si el proceso muere después de marcar
-- pero antes de cerrar, la siguiente corrida retoma el lease vencido, ve
-- `enviado_en` no nulo y:
--   · NO reenvía nada (la app, en `alerta_tope.ts`, se salta el envío entero);
--   · NO sobreescribe minutos_registrados/tope_minutos/cota_inferior/fuente/
--     descanso_sin_cierre ni los estados por destinatario ya persistidos —
--     el expediente sigue diciendo CUÁNDO y CON QUÉ se mandó el primer aviso
--     real, sin importar cuántas veces se reintente el cierre;
--   · solo renueva el lease (claim_token/claim_expira_en) para que ESTE
--     proceso pueda terminar de cerrar el registro con esos mismos datos.
-- Sin confirmación previa (enviado_en IS NULL — nada real salió todavía, p.ej.
-- cayó antes de reclamar destinatarios o el canal era 'ninguno'), la retoma
-- sigue actualizando con los datos frescos: mismo comportamiento que la 0502
-- (lo prueba la sección (c) de `supabase/tests/0502_jornada_alerta_tope.sql`,
-- que NUNCA marca `enviado_en` y por tanto no toca esta rama nueva).
--
-- Aditiva: una columna nullable + una función nueva + `reclamar_jornada_alerta`
-- reemplazada (su `returns table` cambia, así que se DROP antes del REPLACE,
-- como en 0086/0155/0189). Deny-all + service_role, igual que el resto de la
-- 0502. No se aplica a producción desde esta sesión.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.jornada_alerta
  add column if not exists enviado_en timestamptz;

comment on column public.jornada_alerta.enviado_en is
  'Cuándo se confirmó el envío REAL de al menos un destinatario (Meta aceptó el WhatsApp, o el correo salió) para este (jornada, nivel). Candado "una sola vez": lo marca marcar_jornada_alerta_enviada() antes de cerrar_jornada_alerta(). NULL = nada real ha salido todavía. Con fecha, una retoma de lease vencido NO reenvía y NO sobreescribe minutos_registrados/tope_minutos/cota_inferior/fuente/descanso_sin_cierre ni los estados por destinatario: el expediente conserva CUÁNDO y CON QUÉ datos salió el primer aviso real.';

-- ── El candado de "ya se envió de verdad" (mismo patrón de cp_envio_marcar_alerta, 0790) ──
create or replace function public.marcar_jornada_alerta_enviada(
  p_tenant uuid, p_id uuid, p_claim uuid,
  p_enc_canal text, p_enc_estado text, p_enc_motivo text,
  p_op_canal text, p_op_estado text, p_op_motivo text,
  p_ahora timestamptz default clock_timestamp()
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.jornada_alerta
     set enviado_en = p_ahora,
         encargado_canal = p_enc_canal, encargado_estado = p_enc_estado, encargado_motivo = left(p_enc_motivo, 200),
         operador_canal = p_op_canal, operador_estado = p_op_estado, operador_motivo = left(p_op_motivo, 200)
   where id = p_id and tenant_id = p_tenant and claim_token = p_claim and estado = 'reclamada' and enviado_en is null;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.marcar_jornada_alerta_enviada(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.marcar_jornada_alerta_enviada(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz) to service_role;

-- ── `reclamar_jornada_alerta`: la retoma respeta el candado de arriba ──────
-- Cambia el `returns table`, así que se DROP antes del REPLACE (mismo patrón
-- que 0086/0155/0189: PostgREST no puede resolver dos firmas de salida).
drop function if exists public.reclamar_jornada_alerta(uuid, uuid, text, integer, integer, boolean, text, boolean, timestamptz, integer);

create function public.reclamar_jornada_alerta(
  p_tenant uuid, p_jornada uuid, p_nivel text, p_minutos integer, p_tope integer,
  p_cota boolean, p_fuente text, p_descanso_abierto boolean default false,
  p_ahora timestamptz default clock_timestamp(), p_lease_segundos integer default 300
) returns table (
  alerta_id uuid, claim_token uuid, ya_enviado boolean,
  minutos_registrados integer, tope_minutos integer, cota_inferior boolean, fuente text, descanso_sin_cierre boolean,
  encargado_canal text, encargado_estado text, encargado_motivo text,
  operador_canal text, operador_estado text, operador_motivo text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_rango integer := case p_nivel when 'aviso' then 1 when 'critico' then 2 when 'exceso' then 3 else null end;
begin
  if v_rango is null then raise exception 'nivel de alerta inválido'; end if;
  if p_lease_segundos < 30 or p_lease_segundos > 900 then raise exception 'lease fuera de 30..900'; end if;
  -- Ya hay una alerta de este nivel o mayor (cerrada o en vuelo con lease vigente): nada que reclamar.
  if exists (
    select 1 from public.jornada_alerta a
     where a.jornada_id = p_jornada and a.tenant_id = p_tenant
       and (case a.nivel when 'aviso' then 1 when 'critico' then 2 else 3 end) >= v_rango
       and (a.estado <> 'reclamada' or a.claim_expira_en > p_ahora)
       and not (a.nivel = p_nivel and a.estado = 'reclamada' and a.claim_expira_en <= p_ahora)
  ) then
    return;
  end if;
  return query
  insert into public.jornada_alerta as a (
    tenant_id, jornada_id, nivel, minutos_registrados, tope_minutos, cota_inferior, fuente, descanso_sin_cierre,
    estado, claim_token, claim_expira_en, creada_en
  ) values (
    p_tenant, p_jornada, p_nivel, p_minutos, p_tope, p_cota, p_fuente, p_descanso_abierto,
    'reclamada', gen_random_uuid(), p_ahora + make_interval(secs => p_lease_segundos), p_ahora
  )
  on conflict (jornada_id, nivel) do update
     set claim_token = gen_random_uuid(),
         claim_expira_en = p_ahora + make_interval(secs => p_lease_segundos),
         -- Si el envío REAL ya se confirmó (enviado_en no nulo: ver 0845), NO se pisa lo capturado
         -- entonces — el expediente debe decir con qué datos salió el aviso real, no los de ahora.
         -- Sin confirmación previa, se actualiza con lo fresco de siempre (comportamiento de la 0502).
         minutos_registrados = case when a.enviado_en is null then excluded.minutos_registrados else a.minutos_registrados end,
         tope_minutos         = case when a.enviado_en is null then excluded.tope_minutos else a.tope_minutos end,
         cota_inferior        = case when a.enviado_en is null then excluded.cota_inferior else a.cota_inferior end,
         fuente               = case when a.enviado_en is null then excluded.fuente else a.fuente end,
         descanso_sin_cierre  = case when a.enviado_en is null then excluded.descanso_sin_cierre else a.descanso_sin_cierre end
   where a.estado = 'reclamada' and a.claim_expira_en <= p_ahora and a.tenant_id = p_tenant
  returning
    a.id, a.claim_token, (a.enviado_en is not null),
    a.minutos_registrados, a.tope_minutos, a.cota_inferior, a.fuente, a.descanso_sin_cierre,
    a.encargado_canal, a.encargado_estado, a.encargado_motivo, a.operador_canal, a.operador_estado, a.operador_motivo;
end;
$$;
revoke all on function public.reclamar_jornada_alerta(uuid, uuid, text, integer, integer, boolean, text, boolean, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclamar_jornada_alerta(uuid, uuid, text, integer, integer, boolean, text, boolean, timestamptz, integer) to service_role;
