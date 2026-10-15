-- ═══════════════════════════════════════════════════════════════════════════
-- 0777 — PEAJES: el SEGUIMIENTO de reclamos y notas de crédito.
--
-- El proveedor no atiende por teléfono: el reclamo se hace por su portal y, si
-- procede, devuelve una NOTA DE CRÉDITO sin detalle. Finanzas necesita saber qué
-- reclamó, qué le acreditaron y cuánto falta, porque «si en 3 meses no reclamas,
-- ya no hay reclamo» (el plazo corre desde el cobro más antiguo del reclamo).
--
--   · `peaje_reclamo` — un reclamo (un envío al portal): categoría de candidatos que
--     cubre, cuántos cruces y cuánto dinero, fecha del cobro más antiguo, estado,
--     referencia del portal, y lo ACREDITADO con su nota de crédito (referencia,
--     fecha, monto). Un reclamo puede recibir varias notas de crédito: se acumula en
--     `monto_acreditado` y el detalle va en `peaje_reclamo_nota`.
--   · `peaje_reclamo_nota` — cada nota de crédito recibida (monto y referencia).
--
-- El plazo y el estado «vencido» NO se guardan: se calculan al leer contra el reloj
-- (`peajes/reclamos_seguimiento.ts`), para que no envejezcan.
--
-- RLS: deny-all (prendida SIN políticas; solo service_role). FK compuesta al
-- desglose de la misma flota (molde 0145). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- La FK compuesta necesita una llave (id, tenant_id) en desglose_peaje.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_id_tenant_key') then
    alter table public.desglose_peaje add constraint desglose_peaje_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

create table if not exists public.peaje_reclamo (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenant(id) on delete cascade,
  -- El desglose del que salen los cruces reclamados (puede ser NULL si el desglose se borra).
  desglose_id              uuid,
  proveedor                text,
  -- Qué regla originó los candidatos: clase_fuera_de_3_5, extemporaneo, duplicado_exacto, tag_dado_de_baja… o 'otro'.
  categoria                text not null default 'otro',
  estado                   text not null default 'preparado',
  n_cruces                 integer not null default 0,
  monto_reclamado          numeric(12,2) not null default 0,
  monto_acreditado         numeric(12,2) not null default 0,
  -- De aquí corre el plazo de 3 meses.
  fecha_cobro_mas_antiguo  date not null,
  enviado_en               date,
  -- El folio o referencia que da el portal del proveedor al recibir el reclamo.
  referencia_portal        text,
  notas                    text,
  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),
  constraint peaje_reclamo_estado_dominio check (estado in ('preparado', 'enviado', 'acreditado_parcial', 'acreditado', 'rechazado')),
  constraint peaje_reclamo_montos_sanos check (monto_reclamado >= 0 and monto_acreditado >= 0 and n_cruces >= 0),
  constraint peaje_reclamo_enviado_coherente check (estado = 'preparado' or enviado_en is not null),
  constraint peaje_reclamo_texto_largo check (
    (referencia_portal is null or char_length(referencia_portal) <= 120)
    and (notas is null or char_length(notas) <= 1000)
    and char_length(categoria) <= 60
  ),
  constraint peaje_reclamo_id_tenant_key unique (id, tenant_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_reclamo_desglose_tenant_fkey' and conrelid = 'public.peaje_reclamo'::regclass) then
    alter table public.peaje_reclamo add constraint peaje_reclamo_desglose_tenant_fkey
      foreign key (desglose_id, tenant_id) references public.desglose_peaje (id, tenant_id) on delete set null (desglose_id);
  end if;
end $$;

comment on table public.peaje_reclamo is
  '0777: un reclamo enviado (o por enviar) al portal del proveedor de peaje. El plazo de 3 meses corre desde fecha_cobro_mas_antiguo y se calcula al leer, no se guarda.';
comment on column public.peaje_reclamo.monto_acreditado is
  'Suma de las notas de crédito recibidas para este reclamo (peaje_reclamo_nota). El proveedor devuelve notas sin detalle: este monto es lo que SÍ se acreditó.';

create index if not exists peaje_reclamo_abiertos_idx
  on public.peaje_reclamo (tenant_id, fecha_cobro_mas_antiguo)
  where estado in ('preparado', 'enviado', 'acreditado_parcial');

create table if not exists public.peaje_reclamo_nota (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  reclamo_id   uuid not null,
  referencia   text,
  fecha        date not null,
  monto        numeric(12,2) not null,
  creado_en    timestamptz not null default now(),
  constraint peaje_reclamo_nota_monto_positivo check (monto > 0),
  constraint peaje_reclamo_nota_referencia_larga check (referencia is null or char_length(referencia) <= 120)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_reclamo_nota_reclamo_tenant_fkey' and conrelid = 'public.peaje_reclamo_nota'::regclass) then
    alter table public.peaje_reclamo_nota add constraint peaje_reclamo_nota_reclamo_tenant_fkey
      foreign key (reclamo_id, tenant_id) references public.peaje_reclamo (id, tenant_id) on delete cascade;
  end if;
end $$;

create index if not exists peaje_reclamo_nota_reclamo_idx on public.peaje_reclamo_nota (tenant_id, reclamo_id);

comment on table public.peaje_reclamo_nota is
  '0777: cada nota de crédito que el proveedor devuelve por un reclamo (monto y referencia). La suma alimenta peaje_reclamo.monto_acreditado.';

alter table public.peaje_reclamo enable row level security;
alter table public.peaje_reclamo_nota enable row level security;
