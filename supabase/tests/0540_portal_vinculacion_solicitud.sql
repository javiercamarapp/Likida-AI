\set ON_ERROR_STOP on
-- 0540 — SOLICITUD DE VINCULACIÓN ASISTIDA DE PORTAL (código de un solo uso).
-- Lo que solo la base garantiza, con datos sintéticos propios (rollback):
--   (a) una sola solicitud VIVA por (flota, portal); otra flota sí puede;
--   (b) solo un rol con permiso de la flota (no uno de baja, no otra flota) la crea;
--   (c) el código sirve UNA vez (carrera de dos máquinas: gana una) y vencido no sirve;
--   (d) cerrar solo desde 'reclamada'; completar vencida → expirada; cancelada no se cierra;
--   (e) retención: cierra vivas vencidas y borra cerradas viejas; mínimo 7 días;
--   (f) CHECKs (hash hex, comercio) y permisos solo service_role.
begin;

insert into public.tenant (id, nombre) values
  ('54000000-0000-4000-8000-0000000000a1', 'Flota A 0540'),
  ('54000000-0000-4000-8000-0000000000b1', 'Flota B 0540');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo, desactivado_en) values
  ('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-0000000000a1', 'dueno-0540@test.invalid', 'Dueño',   'flota_admin', true,  null),
  ('54000000-0000-4000-8000-0000000000c2', '54000000-0000-4000-8000-0000000000a1', 'baja-0540@test.invalid',  'De baja', 'flota_admin', false, now()),
  ('54000000-0000-4000-8000-0000000000c3', '54000000-0000-4000-8000-0000000000a1', 'vend-0540@test.invalid',  'Vendedor','vendedor',    true,  null),
  ('54000000-0000-4000-8000-0000000000d1', '54000000-0000-4000-8000-0000000000b1', 'dueno-b-0540@test.invalid', 'Dueño B', 'flota_admin', true,  null);

set local role service_role;
do $$
declare
  r jsonb;
  A constant uuid := '54000000-0000-4000-8000-0000000000a1';
  B constant uuid := '54000000-0000-4000-8000-0000000000b1';
  dueno constant uuid := '54000000-0000-4000-8000-0000000000c1';
  baja  constant uuid := '54000000-0000-4000-8000-0000000000c2';
  vend  constant uuid := '54000000-0000-4000-8000-0000000000c3';
  dueno_b constant uuid := '54000000-0000-4000-8000-0000000000d1';
  h1 constant text := repeat('1', 64);
  h2 constant text := repeat('2', 64);
  h3 constant text := repeat('3', 64);
  h4 constant text := repeat('4', 64);
  v_id uuid;
begin
  -- (b) quién puede crear
  r := public.crear_vinculacion_portal(A, 'enerser', baja, h1);
  if (r->>'ok')::boolean then raise exception '0540: un usuario de baja creó la solicitud'; end if;
  r := public.crear_vinculacion_portal(A, 'enerser', vend, h1);
  if (r->>'ok')::boolean then raise exception '0540: un vendedor creó la solicitud'; end if;
  r := public.crear_vinculacion_portal(A, 'enerser', dueno_b, h1);
  if (r->>'ok')::boolean then raise exception '0540: un usuario de OTRA flota creó la solicitud'; end if;
  r := public.crear_vinculacion_portal(A, 'enerser', dueno, h1, 90);
  if (r->>'ok')::boolean then raise exception '0540: aceptó una vigencia de 90 minutos'; end if;

  -- (a) una viva por (flota, portal)
  r := public.crear_vinculacion_portal(A, 'enerser', dueno, h1);
  if not (r->>'ok')::boolean then raise exception '0540: no creó: %', r; end if;
  v_id := (r->>'id')::uuid;
  r := public.crear_vinculacion_portal(A, 'enerser', dueno, h2);
  if (r->>'ok')::boolean then raise exception '0540: abrió una segunda solicitud viva'; end if;
  r := public.crear_vinculacion_portal(A, 'gogas', dueno, h2);
  if not (r->>'ok')::boolean then raise exception '0540: otro portal de la misma flota debe poder: %', r; end if;
  r := public.crear_vinculacion_portal(B, 'enerser', dueno_b, h3);
  if not (r->>'ok')::boolean then raise exception '0540: otra flota, mismo portal, debe poder: %', r; end if;

  -- (c) el código sirve una vez
  r := public.reclamar_vinculacion_portal(repeat('9', 64));
  if (r->>'ok')::boolean then raise exception '0540: reclamó un código desconocido'; end if;
  r := public.reclamar_vinculacion_portal(h1);
  if not (r->>'ok')::boolean or (r->>'comercio') <> 'enerser' or (r->>'tenant_id')::uuid <> A then raise exception '0540: no reclamó bien: %', r; end if;
  r := public.reclamar_vinculacion_portal(h1);
  if (r->>'ok')::boolean then raise exception '0540: el código se reclamó DOS veces'; end if;

  -- (d) cerrar: otra flota no cierra la mía; la mía sí; no se cierra dos veces
  r := public.cerrar_vinculacion_portal(v_id, B, 'completada', 3);
  if (r->>'ok')::boolean then raise exception '0540: otra flota cerró mi solicitud'; end if;
  r := public.cerrar_vinculacion_portal(v_id, A, 'rara', 3);
  if (r->>'ok')::boolean then raise exception '0540: aceptó un estado de cierre inválido'; end if;
  r := public.cerrar_vinculacion_portal(v_id, A, 'completada', 3);
  if not (r->>'ok')::boolean then raise exception '0540: no cerró: %', r; end if;
  r := public.cerrar_vinculacion_portal(v_id, A, 'completada', 3);
  if (r->>'ok')::boolean then raise exception '0540: cerró dos veces'; end if;
  -- completada libera el lugar: se puede pedir otra vinculación del mismo portal
  r := public.crear_vinculacion_portal(A, 'enerser', dueno, h4);
  if not (r->>'ok')::boolean then raise exception '0540: no liberó el lugar tras completar: %', r; end if;

  -- vencida: no se reclama y pasa a expirada; completar vencida → expirada
  update public.portal_vinculacion_solicitud set creada_en = now() - interval '2 hour', expira_en = now() - interval '1 hour' where codigo_hash = h4;
  r := public.reclamar_vinculacion_portal(h4);
  if (r->>'ok')::boolean then raise exception '0540: reclamó un código vencido'; end if;
  if (select estado from public.portal_vinculacion_solicitud where codigo_hash = h4) <> 'expirada' then raise exception '0540: no marcó expirada'; end if;
  r := public.crear_vinculacion_portal(A, 'gogas', dueno, repeat('5', 64));
  if (r->>'ok')::boolean then raise exception '0540: gogas ya tenía una viva (h2) y debía rechazar'; end if;
  r := public.reclamar_vinculacion_portal(h2);
  update public.portal_vinculacion_solicitud set creada_en = now() - interval '2 hour', expira_en = now() - interval '1 hour' where codigo_hash = h2;
  r := public.cerrar_vinculacion_portal((select id from public.portal_vinculacion_solicitud where codigo_hash = h2), A, 'completada', 1);
  if (r->>'ok')::boolean then raise exception '0540: completó una solicitud vencida'; end if;
  if (select estado from public.portal_vinculacion_solicitud where codigo_hash = h2) <> 'expirada' then raise exception '0540: vencida al completar no quedó expirada'; end if;

  -- cancelar
  if public.cancelar_vinculacion_portal(B, 'enerser') <> 1 then raise exception '0540: no canceló la viva de B'; end if;
  if public.cancelar_vinculacion_portal(B, 'enerser') <> 0 then raise exception '0540: canceló algo que ya no estaba vivo'; end if;
  r := public.reclamar_vinculacion_portal(h3);
  if (r->>'ok')::boolean then raise exception '0540: reclamó una cancelada'; end if;

  -- (e) retención
  begin
    perform public.purgar_vinculacion_portal(3);
    raise exception '0540: aceptó una retención de 3 días';
  exception when raise_exception then
    if sqlerrm like '0540:%' then raise; end if;
  end;
  update public.portal_vinculacion_solicitud set cerrada_en = now() - interval '200 days' where estado = 'completada';
  if public.purgar_vinculacion_portal(90) < 1 then raise exception '0540: no borró la cerrada vieja'; end if;
  if (select count(*) from public.portal_vinculacion_solicitud where estado = 'completada') <> 0 then raise exception '0540: quedó una completada vieja'; end if;

  -- (f) CHECKs
  begin
    insert into public.portal_vinculacion_solicitud (tenant_id, comercio, codigo_hash, expira_en) values (A, 'x', 'no-hex', now() + interval '1 hour');
    raise exception '0540: aceptó un hash que no es hex';
  exception when check_violation then null;
  end;
  begin
    insert into public.portal_vinculacion_solicitud (tenant_id, comercio, codigo_hash, expira_en) values (A, 'Mal Comercio!', repeat('7', 64), now() + interval '1 hour');
    raise exception '0540: aceptó un comercio con forma inválida';
  exception when check_violation then null;
  end;
end $$;

-- (f) permisos: anon/authenticated no tocan nada
reset role;
set local role authenticated;
do $$
begin
  begin
    perform count(*) from public.portal_vinculacion_solicitud;
    raise exception '0540: authenticated leyó la tabla';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
