\set ON_ERROR_STOP on
-- 0899 · IdCCP persistido por viaje (A37-S10-05). Datos sintéticos; todo en una transacción que se revierte.
begin;

-- (a) la columna existe, es nullable y no tiene default.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'viaje' and column_name = 'ccp_id_ccp'
                   and is_nullable = 'YES' and column_default is null and data_type = 'text') then
    raise exception '(a) viaje.ccp_id_ccp debe existir, text, nullable y sin default';
  end if;
end $$;

insert into public.tenant (id, nombre) values ('b8990000-0000-0000-0000-000000000001', 'CCP 0899');

-- (b) un viaje nuevo nace sin IdCCP.
insert into public.operador (id, tenant_id, nombre, telefono)
values ('b8990000-0000-0000-0000-0000000000b1', 'b8990000-0000-0000-0000-000000000001', 'Chofer 0899', '525500008990');
insert into public.viaje (id, tenant_id, operador_id, origen, destino)
values ('b8990000-0000-0000-0000-0000000000a1', 'b8990000-0000-0000-0000-000000000001', 'b8990000-0000-0000-0000-0000000000b1', 'A', 'B');
do $$ begin
  if (select ccp_id_ccp from public.viaje where id = 'b8990000-0000-0000-0000-0000000000a1') is not null then
    raise exception '(b) un viaje nuevo debe nacer con ccp_id_ccp NULL';
  end if;
end $$;

-- (c) el reclamo atómico del código (UPDATE … WHERE ccp_id_ccp IS NULL): el primero gana, el segundo no pisa.
do $$ declare n1 int; n2 int; begin
  update public.viaje set ccp_id_ccp = 'CCC12345-aaaa-4bbb-8ccc-1234567890ab'
   where id = 'b8990000-0000-0000-0000-0000000000a1' and ccp_id_ccp is null;
  get diagnostics n1 = row_count;
  update public.viaje set ccp_id_ccp = 'CCCffff0-aaaa-4bbb-8ccc-1234567890ab'
   where id = 'b8990000-0000-0000-0000-0000000000a1' and ccp_id_ccp is null;
  get diagnostics n2 = row_count;
  if n1 <> 1 or n2 <> 0 then raise exception '(c) el reclamo debía ganar 1 vez y perder la 2.a (n1=%, n2=%)', n1, n2; end if;
  if (select ccp_id_ccp from public.viaje where id = 'b8990000-0000-0000-0000-0000000000a1') <> 'CCC12345-aaaa-4bbb-8ccc-1234567890ab' then
    raise exception '(c) el IdCCP del primer reclamo debe conservarse';
  end if;
end $$;

-- (d) el CHECK de forma rechaza lo que no es un IdCCP (sin prefijo CCC, longitud mala, vacío).
do $$ declare v text; begin
  foreach v in array array['no-es-un-idccp', 'AAA12345-aaaa-4bbb-8ccc-1234567890ab', 'CCC12345-aaaa-4bbb-8ccc-1234567890', ''] loop
    begin
      update public.viaje set ccp_id_ccp = v where id = 'b8990000-0000-0000-0000-0000000000a1';
      raise exception '(d) debía rechazar el IdCCP inválido «%»', v;
    exception when check_violation then null;
    end;
  end loop;
end $$;

-- (e) la regeneración explícita sobrescribe (UPDATE sin la condición).
update public.viaje set ccp_id_ccp = 'CCC99999-aaaa-4bbb-8ccc-1234567890ab' where id = 'b8990000-0000-0000-0000-0000000000a1';
do $$ begin
  if (select ccp_id_ccp from public.viaje where id = 'b8990000-0000-0000-0000-0000000000a1') <> 'CCC99999-aaaa-4bbb-8ccc-1234567890ab' then
    raise exception '(e) la regeneración explícita debe sobrescribir';
  end if;
end $$;

-- (f) mayúsculas/minúsculas: el estándar admite hex en cualquiera (el CHECK es insensible).
update public.viaje set ccp_id_ccp = 'CCCABCDE-AAAA-4BBB-8CCC-1234567890AB' where id = 'b8990000-0000-0000-0000-0000000000a1';

rollback;
\echo OK 0899_ccp_id_persistido
