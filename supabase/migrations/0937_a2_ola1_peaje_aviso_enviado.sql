-- ═══════════════════════════════════════════════════════════════════════════
-- 0937 — PEAJES (A2, ola 1): el SELLO de los avisos proactivos de plazo y de archivo.
--
-- El cron de peajes ahora avisa (a) que un cobro sin reclamar está por vencer su
-- plazo (30 y 7 días antes, una vez por archivo y umbral) y (b) que falta el
-- archivo de una decena. Un aviso debe salir UNA vez: el sello se RESERVA antes de
-- enviar (el insert con la llave primaria es el compare-and-set: dos procesos no
-- mandan dos avisos) y se devuelve si el envío falla para que el siguiente barrido
-- lo reintente.
--
--   tipo  = 'plazo'                → clave = '<desglose_id>:<umbral en días>'
--   tipo  = 'recordatorio_archivo' → clave = '<desde>/<hasta>' de la decena
--
-- Sin FK a desglose_peaje a propósito: el sello debe sobrevivir a que el archivo se
-- anule (anular no debe reabrir un aviso ya dado). Tabla NUEVA: RLS prendida SIN
-- políticas, acceso directo revocado a anon/authenticated y grant EXPLÍCITO a
-- service_role. ADITIVA e IDEMPOTENTE; nace vacía. Rango A2 ola 1: 0935–0937.
--
-- REVERSA (documentada, NO ejecutada):
--   drop table if exists public.peaje_aviso_enviado;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_aviso_enviado (
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  tipo        text not null,
  clave       text not null,
  creado_en   timestamptz not null default now(),
  primary key (tenant_id, tipo, clave),
  constraint peaje_aviso_enviado_tipo_valido check (tipo in ('plazo', 'recordatorio_archivo')),
  constraint peaje_aviso_enviado_clave_larga check (char_length(clave) between 1 and 120)
);

comment on table public.peaje_aviso_enviado is
  '0937: sello de los avisos proactivos de peajes (plazo de reclamo por vencer y archivo decenal faltante). Una fila = ese aviso ya se dio (o está reservado). Sin FK a desglose a propósito.';

alter table public.peaje_aviso_enviado enable row level security;
revoke all on table public.peaje_aviso_enviado from public, anon, authenticated;
grant select, insert, update, delete on table public.peaje_aviso_enviado to service_role;
