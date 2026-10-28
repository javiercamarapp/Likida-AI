-- REVERSA: (1) borrar o dar de baja primero a los operadores con teléfono «sin-tel:…» (la reversa no puede conservarlos: el índice único global de la 0024 vuelve a incluirlos y todos normalizan a la cadena vacía); (2) `drop index if exists public.uq_operador_tenant_numero_empleado_sin_tel;` (3) `drop index if exists public.uq_operador_telefono_activo; create unique index uq_operador_telefono_activo on public.operador (public.telefono_normalizado(telefono)) where activo;` (4) `drop index if exists public.uq_operador_tenant_telefono_norm; create unique index uq_operador_tenant_telefono_norm on public.operador (tenant_id, public.telefono_normalizado(telefono));` (5) `alter table public.operador drop constraint if exists operador_telefono_forma; alter table public.operador add constraint operador_telefono_forma check (anonimizado_en is not null or public.telefono_normalizado(telefono) ~ '^[0-9]{10,15}$') not valid;`
-- ═══════════════════════════════════════════════════════════════════════════
-- 0932 — A1 (LIQUIDACIÓN POR CORREO): UN OPERADOR SE PUEDE DAR DE ALTA SOLO CON NÚMERO DE EMPLEADO Y CORREO.
--
-- El cliente descartó el WhatsApp para el Agente 1 (el desglose sale por correo), pero `operador.telefono` es NOT NULL, con forma
-- de teléfono (0290) y único global entre los activos (0024): dar de alta a un operador sin teléfono era imposible. Esta
-- migración abre UNA puerta estrecha y declarada, sin tocar la regla de los que sí tienen teléfono:
--
--   · Un operador SIN WhatsApp guarda en `telefono` un marcador `sin-tel:<20 letras a-z>`. El marcador NO tiene un solo dígito, así
--     que (a) `telefono_normalizado` lo reduce a '' y NINGÚN código puede convertirlo en un número marcable (un envío de
--     WhatsApp a ese valor falla en vez de llegarle a un desconocido) y (b) ninguna consulta por teléfono real lo encuentra.
--   · `operador_telefono_forma` (0290) gana UN brazo: ese marcador exacto. Todo lo demás (teléfono con forma, o fila anonimizada)
--     sigue igual.
--   · Los dos índices únicos de teléfono (0024) se redefinen como PARCIALES que excluyen el marcador: sin esto todos los
--     operadores sin teléfono colisionarían entre sí en '' (el fallo que la 0290 cerró). Para los teléfonos reales la unicidad es
--     exactamente la de antes (mismo criterio, mismo nombre).
--   · Índice único PARCIAL nuevo (flota, número de empleado) SOLO para filas con marcador: es lo que vuelve idempotente la alta
--     por número de empleado (el mismo archivo dos veces no duplica) sin imponer unicidad de número de empleado a quien tiene
--     teléfono (hoy puede repetirse; no se cambia).
--
-- NO se crea tabla ni función. No se cambia ningún permiso. Aplicar dos veces no cambia nada (bloques que preguntan antes).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La forma del teléfono admite el marcador ─────────────────────────────
alter table public.operador drop constraint if exists operador_telefono_forma;
alter table public.operador add constraint operador_telefono_forma
  check (anonimizado_en is not null
         or public.telefono_normalizado(telefono) ~ '^[0-9]{10,15}$'
         or telefono ~ '^sin-tel:[a-z]{20}$') not valid;

comment on constraint operador_telefono_forma on public.operador is
  'AUD24 DAT-10 + 0932: teléfono con forma (10-15 dígitos) o el marcador «sin-tel:<20 letras>» de un operador sin WhatsApp (canal correo). El marcador no tiene dígitos: no es marcable.';

-- ── 2. Los índices únicos de teléfono excluyen el marcador ─────────────────
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_operador_telefono_activo' and indexdef like '%sin-tel%'
  ) then
    drop index if exists public.uq_operador_telefono_activo;
    create unique index uq_operador_telefono_activo
      on public.operador (public.telefono_normalizado(telefono))
      where activo and telefono !~ '^sin-tel:';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_operador_tenant_telefono_norm' and indexdef like '%sin-tel%'
  ) then
    drop index if exists public.uq_operador_tenant_telefono_norm;
    create unique index uq_operador_tenant_telefono_norm
      on public.operador (tenant_id, public.telefono_normalizado(telefono))
      where telefono !~ '^sin-tel:';
  end if;
end $$;

comment on index public.uq_operador_telefono_activo is
  'Un teléfono = un operador ACTIVO, en TODA la base (0024). 0932: no cuenta el marcador «sin-tel:…» de un operador sin WhatsApp.';
comment on index public.uq_operador_tenant_telefono_norm is
  'Versión normalizada de unique(tenant_id, telefono) (0024). 0932: no cuenta el marcador «sin-tel:…».';

-- ── 3. Alta idempotente por número de empleado, solo para los sin teléfono ──
create unique index if not exists uq_operador_tenant_numero_empleado_sin_tel
  on public.operador (tenant_id, numero_empleado)
  where telefono ~ '^sin-tel:' and numero_empleado is not null;

comment on index public.uq_operador_tenant_numero_empleado_sin_tel is
  '0932: un número de empleado = un operador SIN WhatsApp por flota (idempotencia de la alta por correo). No limita a los operadores con teléfono.';
