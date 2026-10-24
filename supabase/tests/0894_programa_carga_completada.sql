\set ON_ERROR_STOP on
-- 0894 · programa_despacho_carga.completada_en (A37-S59-05). Datos sintéticos; todo en una transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values ('08940000-0000-4000-8000-0000000000a1', 'Flota 0894');

-- (a) la columna existe, es nullable y NO tiene default: una carga nueva nace sin sellar.
do $$
begin
  if (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'programa_despacho_carga' and column_name = 'completada_en') <> 'YES' then
    raise exception '0894(a): completada_en debía ser nullable';
  end if;
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'programa_despacho_carga' and column_name = 'completada_en') is not null then
    raise exception '0894(a): completada_en no debía tener default';
  end if;
end $$;

set local role service_role;
insert into public.programa_despacho_carga (id, tenant_id, terminal, origen, archivo_sha256)
values ('08940000-0000-4000-8000-0000000000d1', '08940000-0000-4000-8000-0000000000a1', 'T1', 'subida', repeat('a', 64));
do $$
begin
  if (select completada_en from public.programa_despacho_carga where id = '08940000-0000-4000-8000-0000000000d1') is not null then
    raise exception '0894(a): una carga nueva debía nacer sin sellar';
  end if;
end $$;

-- (b) sellar la carga.
update public.programa_despacho_carga set completada_en = now() where id = '08940000-0000-4000-8000-0000000000d1';
do $$
begin
  if (select completada_en from public.programa_despacho_carga where id = '08940000-0000-4000-8000-0000000000d1') is null then
    raise exception '0894(b): el sello no se guardó';
  end if;
end $$;
reset role;

-- (c) idempotencia: reaplicar la migración no toca la columna ni marca como completas las cargas que siguen a medias.
insert into public.programa_despacho_carga (id, tenant_id, terminal, origen, archivo_sha256, created_at)
values ('08940000-0000-4000-8000-0000000000d2', '08940000-0000-4000-8000-0000000000a1', 'T1', 'subida', repeat('b', 64), now() - interval '2 hours');
\ir ../migrations/0894_programa_carga_completada.sql
do $$
begin
  if (select completada_en from public.programa_despacho_carga where id = '08940000-0000-4000-8000-0000000000d2') is not null then
    raise exception '0894(c): reaplicar la migración selló una carga que seguía a medias';
  end if;
end $$;

rollback;
