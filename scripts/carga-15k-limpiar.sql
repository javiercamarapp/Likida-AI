-- ═══════════════════════════════════════════════════════════════════════════
-- carga-15k-limpiar.sql — borra el tenant sintético 'ZZZ CARGA' entero.
--
-- Un solo DELETE: todas las tablas de negocio cuelgan de tenant con
-- ON DELETE CASCADE (0001), y los índices de la 0071 existen justo para que
-- este borrado no escanee tablas enteras. El id es el fijo de carga-15k.sql.
--
-- Verifica ANTES de borrar que el nombre coincida — si alguien reutilizó el
-- uuid para otra cosa, esto se niega en vez de llevarse datos reales.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t uuid := 'aaaaaaaa-0000-4000-8000-000000015000';
  n text;
begin
  select nombre into n from tenant where id = t;
  if n is null then
    raise notice 'ZZZ CARGA no existe: nada que limpiar';
    return;
  end if;
  if n <> 'ZZZ CARGA' then
    raise exception 'el tenant % se llama "%" y no "ZZZ CARGA": no se borra', t, n;
  end if;
  delete from tenant where id = t;
  raise notice 'ZZZ CARGA borrado (cascada: operador, viaje, gasto, liquidacion)';
end $$;

-- Debe devolver 0 | 0 | 0 | 0:
select
  (select count(*) from operador    where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as operadores,
  (select count(*) from viaje       where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as viajes,
  (select count(*) from gasto       where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as gastos,
  (select count(*) from liquidacion where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as liquidaciones;
