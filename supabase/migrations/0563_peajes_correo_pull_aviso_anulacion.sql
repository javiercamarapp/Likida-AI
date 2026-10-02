-- 0563 — Conciliación de peajes (Agente 2), ola 3: recepción por correo y por
-- pull, aviso a la oficina y anulación de un desglose.
--
-- ── 1. DOS CANALES DE ENTRADA MÁS ───────────────────────────────────────────
-- Hasta hoy el desglose entraba por la subida manual o por el buzón firmado
-- (POST). Ahora también:
--   · CORREO: la flota tiene su dirección `pj-<token>@<dominio de correo>` (el
--     mismo dominio y webhook firmado de Resend que los demás buzones). La flota
--     sale del token del DESTINATARIO, nunca del remitente; la flota puede
--     declarar los remitentes que sí pueden mandar (`remitentes_permitidos`).
--   · PULL: el cron consulta un endpoint HTTPS PÚBLICO que la flota (o su TMS)
--     expone con sus cortes. La URL y el token (cifrado con el cofre de la app,
--     nunca en claro) viven en `peaje_ingesta_config`; el claim
--     `peaje_pull_reclamar` impide que dos corridas consulten la misma flota a la
--     vez. SFTP NO se construye (requiere una librería y credenciales que no
--     están en el repo): ver docs/operacion/conciliacion-peajes.md.
-- `peaje_ingesta_archivo.origen` admite los dos canales nuevos; el CHECK se
-- reescribe ENTERO partiendo del de la 0376 ('api','panel').
--
-- ── 2. AVISO A LA OFICINA ───────────────────────────────────────────────────
-- Un desglose recién conciliado por el cron con cobros que el GPS no ubica o sin
-- respaldo no avisaba a nadie: quedaba esperando a que alguien abriera la
-- pantalla. `desglose_peaje.aviso_requerido / aviso_intentos / aviso_oficina_en`
-- hacen el aviso idempotente (UNA vez por desglose; el intento se reclama con
-- compare-and-set sobre `aviso_intentos`) y reintentable (tope de 5).
--
-- ── 3. ANULACIÓN ────────────────────────────────────────────────────────────
-- Un desglose subido por error (archivo de otra flota, periodo equivocado) no se
-- borra —es constancia— pero se ANULA con motivo y quién: deja de aparecer en el
-- tablero, de contar en la bitácora RMF 9.1.8 y de exportarse, y su archivo de la
-- cola libera la huella para que el archivo CORRECTO pueda mandarse.

-- Los tres canales de la configuración son INDEPENDIENTES: `activa` es solo del buzón
-- firmado (POST); `correo_activo` y `pull_activo` son de los suyos. Activar uno no
-- enciende ni revela la llave de otro.
-- ── 1. canales ──────────────────────────────────────────────────────────────
alter table public.peaje_ingesta_archivo drop constraint if exists peaje_ingesta_archivo_origen_dominio;
alter table public.peaje_ingesta_archivo
  add constraint peaje_ingesta_archivo_origen_dominio check (origen in ('api', 'panel', 'correo', 'pull'));

alter table public.peaje_ingesta_config
  add column if not exists correo_token          text,
  add column if not exists correo_activo         boolean not null default false,
  add column if not exists remitentes_permitidos text[] not null default '{}',
  add column if not exists pull_url              text,
  add column if not exists pull_credencial_cifrada text,
  add column if not exists pull_activo           boolean not null default false,
  add column if not exists pull_intervalo_min    int not null default 60,
  add column if not exists pull_proximo_en       timestamptz not null default now(),
  add column if not exists pull_ultimo_en        timestamptz,
  add column if not exists pull_ultimo_error     text;

alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_correo_token_forma;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_correo_token_forma check (correo_token is null or correo_token ~ '^[a-z0-9]{24}$');
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_correo_coherente;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_correo_coherente check (not correo_activo or correo_token is not null);
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_remitentes_tope;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_remitentes_tope check (coalesce(array_length(remitentes_permitidos, 1), 0) <= 20);
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_pull_url_forma;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_pull_url_forma check (pull_url is null or (pull_url ~ '^https://[^[:space:]@]+$' and char_length(pull_url) <= 500));
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_pull_coherente;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_pull_coherente check (not pull_activo or pull_url is not null);
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_pull_intervalo;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_pull_intervalo check (pull_intervalo_min between 15 and 1440);
-- La credencial va CIFRADA por el cofre (`v1.<iv>.<tag>.<cifrado>`): un JSON o un token en claro no caben.
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_pull_credencial_cifrada;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_pull_credencial_cifrada check (pull_credencial_cifrada is null or pull_credencial_cifrada ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

create unique index if not exists peaje_ingesta_config_correo_token_uq
  on public.peaje_ingesta_config (correo_token) where correo_token is not null;
create index if not exists peaje_ingesta_config_pull_trabajo_idx
  on public.peaje_ingesta_config (pull_proximo_en) where pull_activo;

comment on column public.peaje_ingesta_config.correo_token is
  '0563: token de la dirección pj-<token>@<dominio> (24 caracteres del alfabeto de buzon.ts). La flota sale de este token, nunca del remitente.';
comment on column public.peaje_ingesta_config.pull_credencial_cifrada is
  '0563: token Bearer del endpoint del cliente, cifrado con el cofre (AES-256-GCM, LIKIDA_COFRE_LLAVE). Nunca en claro.';

-- El claim del pull: toma hasta p_limite flotas cuyo turno ya llegó y les pone un
-- lease (pull_proximo_en = ahora + p_lease_segundos) para que otra corrida no las
-- consulte a la vez. FOR UPDATE SKIP LOCKED, igual que peaje_archivo_reclamar.
create or replace function public.peaje_pull_reclamar(p_limite int default 5, p_lease_segundos int default 600)
returns table (tenant_id uuid, pull_url text, pull_credencial_cifrada text, pull_ultimo_en timestamptz, pull_intervalo_min int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'peaje_pull_reclamar: p_limite fuera de rango (1-50)';
  end if;
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 3600 then
    raise exception 'peaje_pull_reclamar: p_lease_segundos fuera de rango (30-3600)';
  end if;
  return query
  with elegibles as (
    select c.tenant_id
      from public.peaje_ingesta_config c
     where c.pull_activo and c.pull_url is not null and c.pull_proximo_en <= now()
     order by c.pull_proximo_en, c.tenant_id
     limit p_limite
       for update skip locked
  )
  update public.peaje_ingesta_config c
     set pull_proximo_en = now() + make_interval(secs => p_lease_segundos)
    from elegibles e
   where c.tenant_id = e.tenant_id
  returning c.tenant_id, c.pull_url, c.pull_credencial_cifrada, c.pull_ultimo_en, c.pull_intervalo_min;
end;
$$;
comment on function public.peaje_pull_reclamar(int, int) is
  '0563: claim del pull de peajes: toma flotas con pull activo y turno vencido, FOR UPDATE SKIP LOCKED, y les pone un lease. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_pull_reclamar(int, int) from public, anon, authenticated;
grant execute on function public.peaje_pull_reclamar(int, int) to service_role;

-- ── 2 y 3. aviso y anulación en el desglose ─────────────────────────────────
alter table public.desglose_peaje
  add column if not exists aviso_requerido  boolean not null default false,
  add column if not exists aviso_intentos   int not null default 0,
  add column if not exists aviso_oficina_en timestamptz,
  add column if not exists anulado_en       timestamptz,
  add column if not exists anulado_por      text,
  add column if not exists anulado_motivo   text;

alter table public.desglose_peaje drop constraint if exists desglose_peaje_aviso_intentos_sanos;
alter table public.desglose_peaje
  add constraint desglose_peaje_aviso_intentos_sanos check (aviso_intentos >= 0);
alter table public.desglose_peaje drop constraint if exists desglose_peaje_anulacion_completa;
alter table public.desglose_peaje
  add constraint desglose_peaje_anulacion_completa check (
    (anulado_en is null and anulado_por is null and anulado_motivo is null)
    -- coalesce: un motivo NULL daría NULL (y un CHECK en NULL PASA), no falso.
    or (anulado_en is not null and anulado_por is not null and coalesce(char_length(btrim(anulado_motivo)), 0) between 1 and 500)
  );

create index if not exists desglose_peaje_aviso_pendiente_idx
  on public.desglose_peaje (creado_en)
  where aviso_requerido and aviso_oficina_en is null and anulado_en is null;

comment on column public.desglose_peaje.aviso_requerido is
  '0563: la conciliación del cron encontró cobros con GPS que no coincide o sin respaldo y hay que avisar a la oficina (una vez).';
comment on column public.desglose_peaje.anulado_en is
  '0563: el desglose se anuló (subido por error). No se borra: queda de constancia con quién y por qué; deja de contar en tablero, bitácora RMF 9.1.8 y exportaciones.';

-- Los desgloses con aviso pendiente (para el barrido del cron): requerido, aún sin
-- enviar, no anulados y con intentos por debajo del tope. Una RPC y no un select
-- directo porque cruza flotas a propósito (el cron barre todas) y devuelve solo
-- ids; cada acción posterior usa el tenant del propio desglose.
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
   order by d.creado_en, d.id
   limit p_limite;
end;
$$;
comment on function public.peaje_avisos_pendientes(int, int) is
  '0563: desgloses con aviso a la oficina por enviar (barrido del cron de peajes). Cruza flotas a propósito; devuelve solo ids. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_avisos_pendientes(int, int) from public, anon, authenticated;
grant execute on function public.peaje_avisos_pendientes(int, int) to service_role;
