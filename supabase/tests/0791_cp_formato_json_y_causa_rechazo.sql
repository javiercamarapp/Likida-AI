\set ON_ERROR_STOP on
-- 0791 — CARTA PORTE: formato `json` y causa de rechazo.
--
-- Lo que SOLO la base puede demostrar, contra Postgres real (todo dentro de una transacción revertida):
--   (a) cp_documento.formato y cp_perfil.formato admiten 'json' y siguen rechazando uno inventado ('yaml');
--   (b) los siete formatos de la 0420 siguen admitidos (las filas existentes siguen válidas);
--   (c) cp_documento.rechazo_causa: NULL por defecto, admite las 8 causas del dominio, rechaza una inventada;
--   (d) la migración no redefine ninguna función: las RPC de la 0420–0790 siguen existiendo.
-- Datos sintéticos (dominio .invalid).
begin;

insert into public.tenant (id, nombre) values
  ('79100000-0000-4000-8000-0000000000a1', 'Flota A 0791');

set local role service_role;

-- ── (a)+(b) formatos ──────────────────────────────────────────────────────
do $$
declare
  ta constant uuid := '79100000-0000-4000-8000-0000000000a1';
  f text;
  i int := 0;
begin
  foreach f in array array['pdf_texto', 'pdf_escaneado', 'imagen', 'excel', 'csv', 'xml', 'correo', 'json'] loop
    i := i + 1;
    insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256)
    values (ta, 'manual', f, 'f' || i || '.bin', 1000, lpad(to_hex(i), 64, '0'));
    insert into public.cp_perfil (tenant_id, clave, nombre, formato)
    values (ta, 'perfil-' || i, 'Perfil ' || i, f);
  end loop;

  begin
    insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256)
    values (ta, 'manual', 'yaml', 'x.yaml', 1000, repeat('f', 64));
    raise exception '0791: cp_documento admitió formato yaml';
  exception when check_violation then null;
  end;

  begin
    insert into public.cp_perfil (tenant_id, clave, nombre, formato)
    values (ta, 'perfil-yaml', 'Perfil yaml', 'yaml');
    raise exception '0791: cp_perfil admitió formato yaml';
  exception when check_violation then null;
  end;

  -- Un documento ya existente puede pasar a json (UPDATE) sin romper nada.
  update public.cp_documento set formato = 'json' where nombre_archivo = 'f1.bin';
end $$;

-- ── (c) causa de rechazo ──────────────────────────────────────────────────
do $$
declare
  ta constant uuid := '79100000-0000-4000-8000-0000000000a1';
  c text;
  n int;
begin
  select count(*) into n from public.cp_documento where tenant_id = ta and rechazo_causa is not null;
  if n <> 0 then raise exception '0791: rechazo_causa debe ser NULL por defecto (%)', n; end if;

  foreach c in array array['suma_no_cuadra', 'falta_dato_critico', 'formato_ilegible', 'no_es_embarque',
                           'duplicado', 'cliente_desconocido', 'tms_rechazo', 'otra'] loop
    update public.cp_documento set rechazo_causa = c where tenant_id = ta and nombre_archivo = 'f1.bin';
  end loop;

  begin
    update public.cp_documento set rechazo_causa = 'x' where tenant_id = ta and nombre_archivo = 'f1.bin';
    raise exception '0791: rechazo_causa admitió un valor inventado';
  exception when check_violation then null;
  end;

  update public.cp_documento set rechazo_causa = null where tenant_id = ta and nombre_archivo = 'f1.bin';
end $$;

-- ── (d) la migración no redefine funciones ────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
        'cp_documento_reclamar', 'cp_documento_dividir', 'cp_documentos_por_avisar', 'cp_documentos_pendientes',
        'cp_documentos_agotados', 'cp_documento_reclamar_aviso', 'cp_documento_liberar_aviso',
        'cp_envio_reclamar', 'cp_envio_marcar_alerta', 'cp_envio_liberar_alerta')) < 10 then
    raise exception '0791: falta alguna RPC de las migraciones anteriores';
  end if;
end $$;

rollback;
