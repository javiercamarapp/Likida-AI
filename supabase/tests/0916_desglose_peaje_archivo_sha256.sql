\set ON_ERROR_STOP on
-- 0916 — A37-S47-02: el mismo archivo (misma huella SHA-256) no genera dos desgloses vigentes en una flota; otra flota sí puede
-- tener la misma huella; anular libera la huella; los desgloses sin huella (anteriores) no compiten; la forma de la huella se
-- valida. Datos sintéticos, todo en una transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('09160000-0000-4000-8000-0000000000a1', 'Flota A 0916'),
  ('09160000-0000-4000-8000-0000000000b1', 'Flota B 0916');

do $$
declare
  a uuid := '09160000-0000-4000-8000-0000000000a1';
  b uuid := '09160000-0000-4000-8000-0000000000b1';
  h  text := repeat('ab', 32);
  id1 uuid;
  n int;
begin
  -- (a) el primero entra; el segundo con la MISMA huella en la MISMA flota choca (23505).
  insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre, archivo_sha256)
  values (a, 'PASE', 'agosto.xlsx', h) returning id into id1;
  begin
    insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre, archivo_sha256)
    values (a, 'PASE', 'agosto (copia).xlsx', h);
    raise exception '(a) la misma huella en la misma flota debía chocar';
  exception when unique_violation then null;
  end;

  -- (b) otra flota con la misma huella: entra.
  insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre, archivo_sha256) values (b, 'PASE', 'agosto.xlsx', h);

  -- (c) los desgloses sin huella (anteriores a la 0916) no compiten entre sí.
  insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre) values (a, 'IAVE', 'a.csv');
  insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre) values (a, 'IAVE', 'b.csv');

  -- (d) anular libera la huella: re-subir tras anular es el flujo de corrección.
  update public.desglose_peaje
     set anulado_en = now(), anulado_por = 'prueba@flota.test', anulado_motivo = 'prueba 0916'
   where id = id1;
  insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre, archivo_sha256) values (a, 'PASE', 'agosto-corregido.xlsx', h);
  select count(*) into n from public.desglose_peaje where tenant_id = a and archivo_sha256 = h;
  if n <> 2 then raise exception '(d) debía haber 2 filas con la huella (1 anulada, 1 vigente), hay %', n; end if;

  -- (e) la forma de la huella: 64 hex en minúsculas.
  begin
    insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre, archivo_sha256) values (a, 'PASE', 'x.xlsx', 'no-es-hex');
    raise exception '(e) una huella mal formada debía rechazarse';
  exception when check_violation then null;
  end;
  begin
    insert into public.desglose_peaje (tenant_id, proveedor, archivo_nombre, archivo_sha256) values (a, 'PASE', 'x.xlsx', upper(repeat('ab', 32)));
    raise exception '(e) una huella en mayúsculas debía rechazarse';
  exception when check_violation then null;
  end;
end $$;

rollback;
