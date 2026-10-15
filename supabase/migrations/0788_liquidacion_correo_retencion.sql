-- ═══════════════════════════════════════════════════════════════════════════
-- 0788 — LIQUIDACIÓN POR CORREO: retención de la entrega (Agente 1, rango A1).
--
-- Lo que Likida retiene del desglose entregado por correo es ≈1 año: el archivo
-- que sirve de consulta es la carpeta de enviados del cliente, no esta base.
-- Esta migración añade la purga de esa copia, sin tocar la retención de
-- `liquidacion_externa` (0562: 60 meses, piso 24), que sigue mandando sobre la
-- liquidación misma; la cascada de 0787 borra las entregas cuando eso ocurre.
--
-- ── QUÉ AÑADE ───────────────────────────────────────────────────────────────
--
--   1. `purgar_liquidacion_entrega_correo(p_meses, p_limite, p_ahora)`: para las
--      entregas en estado TERMINAL (enviada, entregada, rebotada, queja,
--      fallida, omitida) con más de `p_meses` meses (defecto 13, PISO 12):
--        · encola `xlsx_ruta` en `storage_huerfano_candidato` (bucket
--          `liquidaciones`, motivo `retencion_entrega_correo`; el cron `purgar`
--          borra el objeto por la Storage API, SQL no puede) y la pone en NULL;
--        · sustituye el correo por la constancia literal `purgado`: la fila
--          queda para estadística (estado, fechas, intentos) sin dato personal.
--      Una entrega `pendiente` o `enviando` JAMÁS se toca. Idempotente: lo ya
--      purgado no se vuelve a elegir y el archivo se encola una sola vez.
--      Solo service_role.
--   2. Ajuste mínimo a la 0787 para que la constancia sea posible: el CHECK de
--      forma del correo admite el literal `purgado`, y la unicidad por
--      destinatario deja fuera las filas purgadas (de lo contrario dos
--      destinatarios del mismo rol y generación chocarían al quedar ambos como
--      `purgado`). Para todo correo real la regla no cambia.
--
-- ── POR QUÉ NO ROMPE A NADIE ────────────────────────────────────────────────
--
-- Función nueva. El CHECK solo se ensancha (todo lo que pasaba antes pasa) y
-- el índice único sigue igual para correos reales. Nadie llama la función hasta
-- que el cron `purgar` la use; con la tabla vacía (config en su defecto) no
-- hace nada.
--
-- ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
--
-- `drop ... if exists` antes de recrear constraint e índice, `create or
-- replace` en la función. Aplicarla dos veces no cambia nada la segunda vez.
--
-- ── CÓMO SE REVIERTE (documentado, no automático) ───────────────────────────
--
--   drop function if exists public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz);
--   -- Solo si NO hay filas con correo = 'purgado' (si las hay, la regla vieja
--   -- no las admite y habría que borrarlas o rellenarlas antes):
--   alter table public.liquidacion_entrega_correo
--     drop constraint liquidacion_entrega_correo_correo_forma;
--   alter table public.liquidacion_entrega_correo
--     add constraint liquidacion_entrega_correo_correo_forma check (
--       correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(correo) <= 254);
--   drop index if exists public.liquidacion_entrega_correo_destinatario_unico;
--   create unique index liquidacion_entrega_correo_destinatario_unico
--     on public.liquidacion_entrega_correo (liquidacion_externa_id, generacion, rol, lower(correo));
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La constancia `purgado` cabe en la tabla ─────────────────────────────
alter table public.liquidacion_entrega_correo
  drop constraint if exists liquidacion_entrega_correo_correo_forma;
alter table public.liquidacion_entrega_correo
  add constraint liquidacion_entrega_correo_correo_forma check (
    correo = 'purgado'
    or (correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(correo) <= 254)
  );

drop index if exists public.liquidacion_entrega_correo_destinatario_unico;
create unique index if not exists liquidacion_entrega_correo_destinatario_unico
  on public.liquidacion_entrega_correo (liquidacion_externa_id, generacion, rol, lower(correo))
  where correo <> 'purgado';

-- ── 2. purgar_liquidacion_entrega_correo ────────────────────────────────────
create or replace function public.purgar_liquidacion_entrega_correo(
  p_meses  integer     default 13,
  p_limite integer     default 500,
  p_ahora  timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer; v_archivos integer;
begin
  if p_meses is null or p_meses < 12 or p_limite is null or p_limite < 1 or p_limite > 5000 or p_ahora is null then
    raise exception 'parámetros de purga inválidos (p_meses >= 12, p_limite 1..5000)' using errcode = 'PU001';
  end if;

  with viejas as (
    select id, xlsx_ruta
      from public.liquidacion_entrega_correo
     where estado in ('enviada', 'entregada', 'rebotada', 'queja', 'fallida', 'omitida')
       and correo <> 'purgado'
       and created_at < p_ahora - make_interval(months => p_meses)
     order by created_at, id
     limit p_limite
       for update skip locked
  ), encoladas as (
    insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
    select 'liquidaciones', xlsx_ruta, 'retencion_entrega_correo'
      from viejas where xlsx_ruta is not null
    on conflict (bucket, nombre) do nothing
    returning nombre
  ), purgadas as (
    update public.liquidacion_entrega_correo e
       set correo = 'purgado', xlsx_ruta = null, updated_at = p_ahora
      from viejas v
     where e.id = v.id
    returning e.id
  )
  select (select count(*) from purgadas), (select count(*) from encoladas) into v_n, v_archivos;

  return jsonb_build_object('purgadas', v_n, 'archivosEncolados', v_archivos, 'parcial', v_n >= p_limite);
end $$;

revoke all on function public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz)
  to service_role;

comment on function public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz) is
  '0788: retención de la entrega por correo (13 meses por defecto, piso 12). Solo estados terminales; encola xlsx_ruta en storage_huerfano_candidato y deja correo = purgado. Idempotente. Solo service_role.';
