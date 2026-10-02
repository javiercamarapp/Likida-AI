-- ═══════════════════════════════════════════════════════════════════════════
-- 0647 — Vigía: respuestas rápidas APROBADAS por la flota.
--
-- El histórico exportado de un grupo (0484) ya deja ver qué le preguntan los clientes y qué contesta el equipo (FAQs y
-- «respuesta típica»). Esto cierra el ciclo: el gerente APRUEBA una de esas respuestas (o la escribe) y, a partir de
-- ahí, cuando un cliente escribe algo que el Vigía no entendió y se parece a esa pregunta, el borrador ya trae el texto
-- aprobado en vez del «no logré entender, lo paso a tu ejecutivo». El mensaje sigue pasando por el gerente con un toque
-- (una pregunta no entendida nunca se autoenvía); la aprobación de la respuesta es del TEXTO, no del envío.
--
--   · `vigia_respuesta_rapida`: una fila por pregunta típica y flota; `estado` = aprobada | retirada. Una pregunta
--     (sin importar mayúsculas ni espacios) tiene a lo más UNA respuesta aprobada por flota.
--   · `vigia_respuesta_rapida_aprobar`: alta o corrección ATÓMICA (on conflict sobre la pregunta aprobada), con tope de 200
--     aprobadas por flota para que la comparación al llegar un mensaje siga siendo barata.
--   · `vigia_respuesta_rapida_usar`: cuenta el uso de forma atómica; solo de una respuesta aprobada de ESA flota.
--
-- RLS: la flota lee las suyas (quien ve el Vigía); solo el servicio escribe. Retención: son plantillas de la flota, no datos
-- de clientes finales (no llevan teléfono ni nombre), así que no caducan con `retencion_dias`.
--
-- Idempotente. El código funciona contra una base SIN esta migración (no hay respuestas rápidas y el borrador sale como
-- siempre, con un warning, en vez de fallar el mensaje del cliente).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.vigia_respuesta_rapida (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  tema          text not null,
  pregunta      text not null,
  texto         text not null,
  estado        text not null default 'aprobada',
  aprobada_por  uuid,
  aprobada_en   timestamptz not null default now(),
  usos          integer not null default 0,
  ultimo_uso_en timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vigia_respuesta_rapida_id_tenant_key unique (id, tenant_id),
  constraint vigia_respuesta_rapida_tema check (tema in ('ubicacion', 'eta', 'documentos', 'factura_pod', 'cita_anden', 'tarifa', 'otro')),
  constraint vigia_respuesta_rapida_estado check (estado in ('aprobada', 'retirada')),
  constraint vigia_respuesta_rapida_pregunta check (char_length(btrim(pregunta)) between 3 and 240),
  constraint vigia_respuesta_rapida_texto check (char_length(btrim(texto)) between 1 and 700),
  constraint vigia_respuesta_rapida_usos check (usos >= 0)
);
create unique index if not exists vigia_respuesta_rapida_pregunta_uq
  on public.vigia_respuesta_rapida (tenant_id, lower(btrim(pregunta))) where estado = 'aprobada';
create index if not exists vigia_respuesta_rapida_tenant_idx
  on public.vigia_respuesta_rapida (tenant_id, estado, tema);
comment on table public.vigia_respuesta_rapida is
  '0647: respuestas típicas que el gerente aprobó (o escribió) para preguntas frecuentes de clientes; el Vigía las usa como base del borrador cuando no entiende un mensaje que se les parece.';

alter table public.vigia_respuesta_rapida enable row level security;
drop policy if exists tenant_lee on public.vigia_respuesta_rapida;
create policy tenant_lee on public.vigia_respuesta_rapida for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_respuesta_rapida from public, anon, authenticated;
grant select on table public.vigia_respuesta_rapida to authenticated;
grant select, insert, update, delete on table public.vigia_respuesta_rapida to service_role;

-- Alta o corrección atómica de la respuesta aprobada de una pregunta. Devuelve su id.
create or replace function public.vigia_respuesta_rapida_aprobar(
  p_tenant uuid, p_tema text, p_pregunta text, p_texto text, p_usuario uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_n integer;
begin
  if p_tenant is null then raise exception 'flota requerida' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenant where id = p_tenant) then raise exception 'flota inexistente' using errcode = '22023'; end if;
  -- El tope solo cuenta lo que sería NUEVO: corregir la respuesta de una pregunta ya aprobada nunca topa.
  if not exists (select 1 from public.vigia_respuesta_rapida where tenant_id = p_tenant and estado = 'aprobada' and lower(btrim(pregunta)) = lower(btrim(p_pregunta))) then
    select count(*) into v_n from public.vigia_respuesta_rapida where tenant_id = p_tenant and estado = 'aprobada';
    if v_n >= 200 then raise exception 'tope de 200 respuestas rápidas aprobadas por flota' using errcode = '54000'; end if;
  end if;
  insert into public.vigia_respuesta_rapida (tenant_id, tema, pregunta, texto, aprobada_por)
  values (p_tenant, p_tema, btrim(p_pregunta), btrim(p_texto), p_usuario)
  on conflict (tenant_id, lower(btrim(pregunta))) where estado = 'aprobada'
  do update set tema = excluded.tema, texto = excluded.texto, aprobada_por = excluded.aprobada_por,
                aprobada_en = now(), updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.vigia_respuesta_rapida_aprobar(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.vigia_respuesta_rapida_aprobar(uuid, text, text, text, uuid) to service_role;

-- Cuenta un uso. `false` = no existe, ya se retiró o es de otra flota.
create or replace function public.vigia_respuesta_rapida_usar(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.vigia_respuesta_rapida
     set usos = usos + 1, ultimo_uso_en = now()
   where id = p_id and tenant_id = p_tenant and estado = 'aprobada';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.vigia_respuesta_rapida_usar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vigia_respuesta_rapida_usar(uuid, uuid) to service_role;
