-- 0182 · SCIAN COMPLETO EN EL SCORE ICP
-- 0140 compared the raw value with three-digit literals. DENUE's canonical
-- values are six digits, so every researched row received zero ICP points.
alter table public.prospecto drop column if exists similitud_icp_pct;
alter table public.prospecto add column similitud_icp_pct int generated always as (
  least(100,
    (case when left(regexp_replace(coalesce(scian, ''), '[^0-9]', '', 'g'), 3) in ('484', '485', '488') then 40 else 0 end) +
    (case when vacante is not null then 25 else 0 end) +
    (case when num_unidades is not null and num_unidades >= 10 then 20 else 0 end) +
    (case when sitio_verificado then 15 else 0 end)
  )
) stored;
create index if not exists idx_prospecto_similitud on public.prospecto (similitud_icp_pct desc) where duplicado_de is null;
