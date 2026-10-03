\set ON_ERROR_STOP on
-- 0564 — Liquidación externa: formato de la flota y teléfonos de copia/discrepancia.
-- Contra Postgres real. Prueba lo que solo la base garantiza:
--   (a) una fila por flota (la PK), y la plantilla tiene que ser un objeto jsonb;
--   (b) los teléfonos solo caben en E.164 sin «+» (10 a 15 dígitos), hasta 3 por lista;
--   (c) RLS prendida: solo service_role escribe (authenticated no puede insertar).
begin;

insert into public.tenant (id, nombre) values
  ('56400000-0000-4000-8000-0000000000a1', 'Flota A 0564'),
  ('56400000-0000-4000-8000-0000000000b1', 'Flota B 0564');

set local role service_role;

do $$
declare
  v_falla boolean; n int;
  A constant uuid := '56400000-0000-4000-8000-0000000000a1';
  B constant uuid := '56400000-0000-4000-8000-0000000000b1';
begin
  -- (a)
  insert into public.liquidacion_formato_flota (tenant_id, formato, copia_telefonos, discrepancia_telefonos)
    values (A, '{"version":1}', array['5215512345678'], array['5215512345678','5213312345678']);
  v_falla := false;
  begin
    insert into public.liquidacion_formato_flota (tenant_id, formato) values (A, '{"version":1}');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a1: dos formatos para la misma flota'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_formato_flota (tenant_id, formato) values (B, '[1,2]');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a2: un formato que no es objeto se aceptó'; end if;

  -- (b)
  foreach n in array array[1,2,3,4,5] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.liquidacion_formato_flota set copia_telefonos = array['123'] where tenant_id = A;                       -- corto
        when 2 then update public.liquidacion_formato_flota set copia_telefonos = array['+5215512345678'] where tenant_id = A;            -- con +
        when 3 then update public.liquidacion_formato_flota set copia_telefonos = array['5215512345678','5215512345679','5215512345670','5215512345671'] where tenant_id = A; -- 4
        when 4 then update public.liquidacion_formato_flota set discrepancia_telefonos = array['55 1234 5678'] where tenant_id = A;       -- espacios
        when 5 then update public.liquidacion_formato_flota set discrepancia_telefonos = array['5215512345678x'] where tenant_id = A;
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO b%: un teléfono inválido se aceptó', n; end if;
  end loop;
  update public.liquidacion_formato_flota set copia_telefonos = '{}', discrepancia_telefonos = '{}' where tenant_id = A;  -- vacías sí

end $$;

-- (c)
set local role authenticated;
do $$
declare v_falla boolean := false;
begin
  begin
    insert into public.liquidacion_formato_flota (tenant_id, formato) values ('56400000-0000-4000-8000-0000000000b1', '{"version":1}');
  exception when insufficient_privilege or others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c: authenticated pudo escribir el formato'; end if;
end $$;

rollback;
\echo '0564: ok'
