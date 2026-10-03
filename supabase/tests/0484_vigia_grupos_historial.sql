\set ON_ERROR_STOP on
-- 0484 — Grupos críticos e histórico del Vigía, contra Postgres REAL.
-- Lo que solo la base puede demostrar: un nombre de grupo no se repite por cliente (sin importar mayúsculas), la misma
-- exportación no entra dos veces al mismo grupo, borrar la importación borra sus mensajes, el autor solo admite el hash
-- corto, y los rangos de la config.
begin;

insert into public.tenant (id, nombre) values ('48400000-0000-4000-8000-0000000000a1', 'Flota A 0484');
insert into public.cliente (id, tenant_id, nombre) values ('48400000-0000-4000-8000-0000000000a2', '48400000-0000-4000-8000-0000000000a1', 'Cliente A');
insert into public.vigia_grupo (id, tenant_id, cliente_id, nombre, critico)
values ('48400000-0000-4000-8000-0000000000a3', '48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a2', 'Operación Cliente A', true);

do $$ begin
  begin
    insert into public.vigia_grupo (tenant_id, cliente_id, nombre)
    values ('48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a2', ' operación cliente a ');
    raise exception '0484: se repitió un grupo con otro formato de nombre';
  exception when unique_violation then null; end;

  insert into public.vigia_historial_import (id, tenant_id, grupo_id, sha256, mensajes)
  values ('48400000-0000-4000-8000-0000000000a4', '48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a3', repeat('a', 64), 1);
  begin
    insert into public.vigia_historial_import (tenant_id, grupo_id, sha256, mensajes)
    values ('48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a3', repeat('a', 64), 1);
    raise exception '0484: la misma exportación entró dos veces';
  exception when unique_violation then null; end;

  insert into public.vigia_historial_mensaje (tenant_id, import_id, grupo_id, enviado_en, rol, autor_hash, texto)
  values ('48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a4', '48400000-0000-4000-8000-0000000000a3', now(), 'cliente', repeat('b', 12), '¿dónde va mi viaje?');
  begin
    insert into public.vigia_historial_mensaje (tenant_id, import_id, grupo_id, enviado_en, rol, autor_hash, texto)
    values ('48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a4', '48400000-0000-4000-8000-0000000000a3', now(), 'cliente', 'Juan Perez', 'x');
    raise exception '0484: el autor admitió un nombre en claro';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_historial_mensaje (tenant_id, import_id, grupo_id, enviado_en, rol, autor_hash, texto)
    values ('48400000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-0000000000a4', '48400000-0000-4000-8000-0000000000a3', now(), 'sistema', repeat('b', 12), 'x');
    raise exception '0484: el rol admitió un valor inventado';
  exception when check_violation then null; end;

  begin
    insert into public.vigia_config (tenant_id, sla_critico_min) values ('48400000-0000-4000-8000-0000000000a1', 1);
    raise exception '0484: sla_critico_min admitió 1 minuto';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_config (tenant_id, molestia_aviso_nivel) values ('48400000-0000-4000-8000-0000000000a1', 1);
    raise exception '0484: molestia_aviso_nivel admitió 1';
  exception when check_violation then null; end;
  insert into public.vigia_config (tenant_id) values ('48400000-0000-4000-8000-0000000000a1');
  if (select sla_critico_min from public.vigia_config where tenant_id = '48400000-0000-4000-8000-0000000000a1') <> 10 then
    raise exception '0484: el plazo crítico por omisión no es 10';
  end if;

  -- Borrar la importación se lleva sus mensajes.
  delete from public.vigia_historial_import where id = '48400000-0000-4000-8000-0000000000a4';
  if exists (select 1 from public.vigia_historial_mensaje where import_id = '48400000-0000-4000-8000-0000000000a4') then
    raise exception '0484: quedaron mensajes huérfanos';
  end if;
end $$;

rollback;
