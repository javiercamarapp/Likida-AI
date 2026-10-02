-- ═══════════════════════════════════════════════════════════════════════════
-- 0502 · JORNADA: ALERTA SALIENTE AL ACERCARSE AL TOPE (LFT 132 fr. XXXIV, 68)
--
-- LOOP PUNTA A PUNTA, W3 «GPS/Jornada» (rango 0500-0519), Agente 12.
--
-- Hasta hoy la jornada era un REGISTRO que se miraba (tablero, CSV, WhatsApp
-- de captura). Esto la vuelve un AVISO que sale: cuando la jornada en curso de
-- un operador llega a los umbrales de la flota (por omisión 80 % y 95 % del
-- tope, y el exceso), se avisa al encargado y al operador por el canal que la
-- flota eligió. Una alerta por (jornada, nivel): la fila ES el claim.
--
--  · `jornada_alerta_config`: por flota. APAGADA por omisión (cada aviso es un
--    WhatsApp con costo y un mensaje a una persona: lo enciende el dueño). El
--    tope es el del art. 68 (12 h) o uno MÁS ESTRICTO que la flota se ponga; no
--    puede declararse uno mayor a 12.
--  · `jornada_alerta`: una fila por (jornada, nivel), con las horas al momento
--    de avisar, si el dato es COTA INFERIOR (inicio derivado del GPS o de un
--    hito) y la fuente EXPLÍCITA del inicio, y el resultado por destinatario.
--    Cuelga de `jornada_dia` con ON DELETE CASCADE: vive y muere con el
--    expediente (retención y ARCO de la jornada). No guarda teléfonos.
--
-- Todo deny-all (RLS activa, sin políticas): el panel y el cron usan
-- service_role filtrando por flota.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.jornada_alerta_config (
  tenant_id          uuid primary key references public.tenant(id) on delete cascade,
  activa             boolean not null default false,
  -- NULL = el tope duro del art. 68 (12 h). Un valor propio solo puede ser MÁS estricto.
  tope_horas         numeric(4,2),
  umbral_aviso_pct   smallint not null default 80,
  umbral_critico_pct smallint not null default 95,
  canal_encargado    text not null default 'whatsapp',
  canal_operador     text not null default 'whatsapp',
  correo_encargado   text,
  declarada_por      uuid references public.app_user(id) on delete set null,
  -- Congelado por la misma razón que `jornada_politica`: sobrevive al borrado de la cuenta.
  declarada_por_email text not null,
  actualizada_en     timestamptz not null default now(),
  constraint jornada_alerta_tope_sano check (tope_horas is null or (tope_horas > 0 and tope_horas <= 12 and tope_horas <> 'NaN'::numeric)),
  constraint jornada_alerta_umbrales_sanos check (umbral_aviso_pct between 1 and 98 and umbral_critico_pct between 2 and 99 and umbral_aviso_pct < umbral_critico_pct),
  constraint jornada_alerta_canal_encargado_dominio check (canal_encargado in ('whatsapp', 'correo', 'ambos', 'ninguno')),
  constraint jornada_alerta_canal_operador_dominio check (canal_operador in ('whatsapp', 'ninguno')),
  constraint jornada_alerta_correo_sano check (correo_encargado is null or (length(correo_encargado) <= 254 and correo_encargado ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  constraint jornada_alerta_correo_requerido check (canal_encargado not in ('correo', 'ambos') or correo_encargado is not null)
);
comment on table public.jornada_alerta_config is
  'Configuración por flota de la alerta saliente de tope de jornada. Apagada por omisión: cada aviso es un mensaje a una persona.';

create table if not exists public.jornada_alerta (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  jornada_id          uuid not null,
  nivel               text not null,
  minutos_registrados integer not null,
  tope_minutos        integer not null,
  -- true = el inicio NO lo declaró el operador (GPS/hito): las horas son «al menos».
  cota_inferior       boolean not null,
  fuente              text not null,
  descanso_sin_cierre boolean not null default false,
  estado              text not null default 'reclamada',
  encargado_canal     text,
  encargado_estado    text not null default 'pendiente',
  encargado_motivo    text,
  operador_canal      text,
  operador_estado     text not null default 'pendiente',
  operador_motivo     text,
  claim_token         uuid,
  claim_expira_en     timestamptz,
  creada_en           timestamptz not null default now(),
  cerrada_en          timestamptz,
  constraint jornada_alerta_unica unique (jornada_id, nivel),
  constraint jornada_alerta_jornada_fkey foreign key (jornada_id, tenant_id)
    references public.jornada_dia(id, tenant_id) on delete cascade,
  constraint jornada_alerta_nivel_dominio check (nivel in ('aviso', 'critico', 'exceso')),
  constraint jornada_alerta_minutos_sanos check (minutos_registrados >= 0 and minutos_registrados <= 1440 and tope_minutos > 0 and tope_minutos <= 720),
  constraint jornada_alerta_fuente_dominio check (fuente in ('declarado_operador', 'hito_viaje', 'gps', 'capturado_contralor')),
  constraint jornada_alerta_estado_dominio check (estado in ('reclamada', 'enviada', 'parcial', 'fallida', 'sin_destinatario')),
  constraint jornada_alerta_enc_estado_dominio check (encargado_estado in ('pendiente', 'enviado', 'fallido', 'sin_destinatario', 'no_aplica')),
  constraint jornada_alerta_op_estado_dominio check (operador_estado in ('pendiente', 'enviado', 'fallido', 'sin_destinatario', 'no_aplica')),
  constraint jornada_alerta_enc_canal_dominio check (encargado_canal is null or encargado_canal in ('whatsapp', 'correo', 'ambos')),
  constraint jornada_alerta_op_canal_dominio check (operador_canal is null or operador_canal in ('whatsapp')),
  constraint jornada_alerta_motivos_cortos check (coalesce(length(encargado_motivo), 0) <= 200 and coalesce(length(operador_motivo), 0) <= 200),
  -- Reclamada = con claim y sin cierre; cualquier otro estado = cerrada y sin claim.
  constraint jornada_alerta_claim_coherente check (
    (estado = 'reclamada' and claim_token is not null and claim_expira_en is not null and cerrada_en is null)
    or (estado <> 'reclamada' and claim_token is null and claim_expira_en is null and cerrada_en is not null)
  )
);
comment on table public.jornada_alerta is
  'Una alerta de tope por (jornada, nivel). La fila es el claim: dos corridas no avisan dos veces. Cuelga de jornada_dia (cascada). No guarda teléfonos.';
create index if not exists jornada_alerta_tenant_creada_idx on public.jornada_alerta (tenant_id, creada_en desc);

alter table public.jornada_alerta_config enable row level security;
alter table public.jornada_alerta enable row level security;
revoke all on public.jornada_alerta_config from public, anon, authenticated;
revoke all on public.jornada_alerta from public, anon, authenticated;
grant select, insert, update, delete on public.jornada_alerta_config to service_role;
grant select, insert, update, delete on public.jornada_alerta to service_role;

-- ── Las jornadas EN CURSO de las flotas con la alerta encendida ────────────
-- En curso = expediente abierto, con un inicio vivo y SIN fin vivo, de hoy o de
-- ayer (México): un turno nocturno cruza la medianoche. El cálculo de horas y
-- descansos lo hace la aplicación con el MISMO modelo que el tablero
-- (`componerJornada`), no una segunda fórmula aquí.
create or replace function public.jornadas_en_curso_para_alerta(
  p_ahora timestamptz default clock_timestamp(),
  p_limite integer default 500
) returns table (
  tenant_id uuid, jornada_id uuid, operador_id uuid, dia date,
  tope_horas numeric, umbral_aviso_pct smallint, umbral_critico_pct smallint,
  canal_encargado text, canal_operador text, correo_encargado text
)
language sql stable security definer set search_path = ''
as $$
  select c.tenant_id, d.id, d.operador_id, d.dia, c.tope_horas, c.umbral_aviso_pct, c.umbral_critico_pct,
         c.canal_encargado, c.canal_operador, c.correo_encargado
    from public.jornada_alerta_config c
    join public.jornada_dia d on d.tenant_id = c.tenant_id
   where c.activa
     and d.estado = 'abierto'
     and d.dia >= ((p_ahora at time zone 'America/Mexico_City')::date - 1)
     and exists (select 1 from public.jornada_asiento a
                  where a.jornada_id = d.id and a.tenant_id = d.tenant_id and a.tipo = 'inicio_jornada' and a.anulado_en is null)
     and not exists (select 1 from public.jornada_asiento a
                      where a.jornada_id = d.id and a.tenant_id = d.tenant_id and a.tipo = 'fin_jornada' and a.anulado_en is null)
   order by c.tenant_id, d.id
   limit least(greatest(p_limite, 1), 1000);
$$;
revoke all on function public.jornadas_en_curso_para_alerta(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.jornadas_en_curso_para_alerta(timestamptz, integer) to service_role;

-- ── El CLAIM de la alerta ──────────────────────────────────────────────────
-- Gana quien inserta la fila (jornada, nivel); la perdedora no hace nada. Una
-- reclamada con lease vencido (worker muerto) se puede retomar. Un nivel ya
-- avisado —o uno MAYOR, que lo hace innecesario— no se vuelve a reclamar.
create or replace function public.reclamar_jornada_alerta(
  p_tenant uuid, p_jornada uuid, p_nivel text, p_minutos integer, p_tope integer,
  p_cota boolean, p_fuente text, p_descanso_abierto boolean default false,
  p_ahora timestamptz default clock_timestamp(), p_lease_segundos integer default 300
) returns table (alerta_id uuid, claim_token uuid)
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
         minutos_registrados = excluded.minutos_registrados,
         tope_minutos = excluded.tope_minutos,
         cota_inferior = excluded.cota_inferior,
         fuente = excluded.fuente,
         descanso_sin_cierre = excluded.descanso_sin_cierre
   where a.estado = 'reclamada' and a.claim_expira_en <= p_ahora and a.tenant_id = p_tenant
  returning a.id, a.claim_token;
end;
$$;
revoke all on function public.reclamar_jornada_alerta(uuid, uuid, text, integer, integer, boolean, text, boolean, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclamar_jornada_alerta(uuid, uuid, text, integer, integer, boolean, text, boolean, timestamptz, integer) to service_role;

create or replace function public.cerrar_jornada_alerta(
  p_tenant uuid, p_id uuid, p_claim uuid, p_estado text,
  p_enc_canal text, p_enc_estado text, p_enc_motivo text,
  p_op_canal text, p_op_estado text, p_op_motivo text,
  p_ahora timestamptz default clock_timestamp()
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_estado not in ('enviada', 'parcial', 'fallida', 'sin_destinatario') then raise exception 'estado de cierre inválido'; end if;
  update public.jornada_alerta
     set estado = p_estado, claim_token = null, claim_expira_en = null, cerrada_en = p_ahora,
         encargado_canal = p_enc_canal, encargado_estado = p_enc_estado, encargado_motivo = left(p_enc_motivo, 200),
         operador_canal = p_op_canal, operador_estado = p_op_estado, operador_motivo = left(p_op_motivo, 200)
   where id = p_id and tenant_id = p_tenant and claim_token = p_claim and estado = 'reclamada';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.cerrar_jornada_alerta(uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cerrar_jornada_alerta(uuid, uuid, uuid, text, text, text, text, text, text, text, timestamptz) to service_role;

-- Un rechazo REINTENTABLE (429, red) no consume el nivel: se suelta el claim y la siguiente corrida lo reintenta.
create or replace function public.liberar_jornada_alerta(p_tenant uuid, p_id uuid, p_claim uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from public.jornada_alerta where id = p_id and tenant_id = p_tenant and claim_token = p_claim and estado = 'reclamada';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.liberar_jornada_alerta(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.liberar_jornada_alerta(uuid, uuid, uuid) to service_role;
