-- 0067 — Nada se purgaba. Lo que se borra, lo que NO, y por qué.
--
-- AUDITORÍA DE DATOS, CRÍTICO. Dos tablas crecen sin techo y ninguna tenía una
-- sola línea que las recortara. La auditoría además tenía razón en cuál revienta
-- primero: `llm_costo` guarda una fila por LLAMADA AL MODELO, y un solo mensaje
-- de WhatsApp dispara varias (router, OCR, cuadre…), así que crece más rápido
-- que `wa_mensaje_procesado`, que guarda una por mensaje.
--
-- ═══ 1. `wa_mensaje_procesado` — SE PURGA A LOS 30 DÍAS ══════════════════
--
-- Es una tabla de IDEMPOTENCIA y nada más: `wa_message_id` es la PK y no tiene
-- `tenant_id` (ver CLAUDE.md), así que no se puede atribuir a una flota y no
-- responde ninguna pregunta de negocio. Su único trabajo es que un reenvío de
-- Meta no procese dos veces el mismo mensaje.
--
-- 30 días cubre de sobra la ventana de reintentos de Meta, que se mide en horas
-- —Meta reintenta un webhook durante un periodo corto y después lo abandona—.
-- Un mes es más de un orden de magnitud por encima; el margen es deliberado
-- para que la purga nunca sea la causa de un doble procesamiento. Borrar más
-- agresivo no gana nada: la tabla es de dos columnas.
--
-- `idx_wa_msg_created` SE QUEDA. La auditoría lo señaló como índice que nadie
-- lee —y tenía razón sobre el estado de HOY—, pero su forma no es un accidente:
-- es exactamente `(created_at)`, la forma de un `delete where created_at < …`.
-- Era el índice de una purga que nunca se escribió. Esta migración escribe la
-- purga, así que el índice pasa de peso muerto a ser el que la sostiene.
-- Borrarlo y volverlo a crear habría sido el error.
--
-- ═══ 2. `llm_costo` — NO SE PURGA. SE CONSOLIDA. ═════════════════════════
--
-- Es la fuente del costo por viaje: el dato con el que Likida sabe lo que le
-- cuesta operar una flota y con el que se defiende un precio. Borrarla borra
-- historia de negocio, no basura.
--
-- Y hay un motivo MÁS DURO para no purgarla hoy, que es el que decide:
-- `resumen_costo_ia_tenant()` (0062/0064) suma las filas CRUDAS de `llm_costo`
-- para la ventana que se le pida. Si se borraran las filas viejas, esa función
-- seguiría contestando —sin avisar— con una suma MENOR para cualquier periodo
-- purgado. El panel enseñaría una cifra distinta del mismo mes según cuándo se
-- mire. Eso choca de frente con la regla que define al producto ("nunca
-- inventar una cifra", CLAUDE.md): una cifra que encoge sola es peor que una
-- tabla grande.
--
-- Así que el arreglo es AGREGARLA, no purgarla. Se crea el consolidado mensual
-- —que es la granularidad que el panel de verdad lee— y se deja corriendo desde
-- ahora, para que la historia de negocio quede preservada en forma compacta
-- ANTES de que exista el volumen. El día que `llm_costo` estorbe de verdad, la
-- purga ya tendrá dónde apoyarse; ese día habrá que enseñarle a
-- `resumen_costo_ia_tenant()` a leer el consolidado para los meses cerrados, y
-- ESE es el trabajo que falta, no un `delete`.
--
-- Se consolidan solo los meses CERRADOS: el mes en curso todavía recibe filas,
-- y un consolidado parcial es justo la cifra engañosa que se quiere evitar.

-- ── El consolidado mensual ───────────────────────────────────────────────
create table if not exists public.llm_costo_mensual (
  tenant_id       uuid        not null references public.tenant(id) on delete cascade,
  mes             date        not null,   -- primer día del mes, en UTC
  fase            text        not null,
  modelo          text        not null,
  llamadas        bigint      not null default 0,
  tokens_in       bigint      not null default 0,
  tokens_out      bigint      not null default 0,
  costo_usd       numeric     not null default 0,
  viajes          bigint      not null default 0,
  consolidado_en  timestamptz not null default now(),
  primary key (tenant_id, mes, fase, modelo),
  constraint llm_costo_mensual_mes_es_dia_1 check (date_trunc('month', mes::timestamp)::date = mes),
  constraint llm_costo_mensual_no_negativo  check (llamadas >= 0 and tokens_in >= 0
                                                   and tokens_out >= 0 and costo_usd >= 0
                                                   and viajes >= 0)
);

-- La PK entra por `tenant_id`, así que la FK contra `tenant` ya queda cubierta
-- (mismo criterio que la 0066: no se agrega un índice que la PK ya sirve).

alter table public.llm_costo_mensual enable row level security;

-- Sin políticas: es tabla de servicio. `service_role` salta RLS; nadie más
-- la lee hasta que exista la pantalla que la use. Mismo criterio que el resto
-- del esquema — se abre cuando haya quien la lea, no antes.
revoke all on public.llm_costo_mensual from anon, authenticated;

-- ── La consolidación: idempotente, solo meses cerrados ───────────────────
create or replace function public.consolidar_llm_costo_mensual(p_ahora timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  corte date := date_trunc('month', p_ahora at time zone 'UTC')::date;  -- excluye el mes en curso
  n bigint;
begin
  insert into public.llm_costo_mensual as m
        (tenant_id, mes, fase, modelo, llamadas, tokens_in, tokens_out, costo_usd, viajes, consolidado_en)
  select c.tenant_id,
         date_trunc('month', c.created_at at time zone 'UTC')::date,
         c.fase, c.modelo,
         count(*), sum(c.tokens_in), sum(c.tokens_out), sum(c.costo_usd),
         count(distinct c.viaje_id),
         now()
    from public.llm_costo c
   where c.created_at < corte
   group by 1,2,3,4
  on conflict (tenant_id, mes, fase, modelo) do update
     set llamadas = excluded.llamadas,
         tokens_in = excluded.tokens_in,
         tokens_out = excluded.tokens_out,
         costo_usd = excluded.costo_usd,
         viajes = excluded.viajes,
         consolidado_en = excluded.consolidado_en;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.consolidar_llm_costo_mensual(timestamptz) from public, anon, authenticated;

-- ── La purga de idempotencia ─────────────────────────────────────────────
create or replace function public.purgar_wa_mensaje_procesado(p_dias int default 30,
                                                              p_ahora timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n bigint;
begin
  if p_dias < 7 then
    -- Un plazo corto convierte la purga en la causa del doble procesamiento
    -- que la tabla existe para impedir. Se falla cerrado y se dice por qué.
    raise exception 'purgar_wa_mensaje_procesado: % días es demasiado poco; el mínimo es 7', p_dias
      using errcode = 'PU001';
  end if;
  delete from public.wa_mensaje_procesado
   where created_at < p_ahora - make_interval(days => p_dias);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.purgar_wa_mensaje_procesado(int, timestamptz) from public, anon, authenticated;

-- ── La corrida completa, para que el cron llame a UNA sola cosa ──────────
create or replace function public.mantenimiento_de_datos(p_dias_wa int default 30,
                                                         p_ahora timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare wa bigint; ia bigint;
begin
  wa := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora);
  ia := public.consolidar_llm_costo_mensual(p_ahora);
  return jsonb_build_object(
    'waPurgados', wa,
    'diasWa', p_dias_wa,
    'iaConsolidados', ia,
    -- Se dice explícitamente que `llm_costo` NO se purga, para que nadie lea
    -- este resultado como "ya se limpió todo".
    'llmCostoPurgado', false,
    'corridaEn', p_ahora
  );
end $$;

revoke all on function public.mantenimiento_de_datos(int, timestamptz) from public, anon, authenticated;
