-- ═══════════════════════════════════════════════════════════════════════════
-- 0850 — PEAJES: el tope de 50 archivos pendientes por flota deja de ser una
-- carrera (auditoría adversarial, HALLAZGO CRÍTICO, 21-oct-2026).
--
-- `recibirArchivoPeaje` (ingesta.ts) hacía un SELECT count de pendientes por
-- flota y, si estaba bajo el tope (MAX_PENDIENTES_POR_FLOTA = 50), un INSERT
-- por separado — sin candado. Dos envíos concurrentes podían leer el MISMO
-- count por debajo del tope y los dos insertar, rebasándolo. `_race_toctou.
-- test.ts` lo reproducía con dos envíos simultáneos de contenido distinto y un
-- hueco de uno bajo el tope: ambos pasaban y la flota quedaba en 51.
--
-- El candado real vive en la BASE, mismo molde que la 0693
-- (`vigia_respuesta_rapida_aprobar`): una función toma un candado de
-- transacción POR FLOTA antes de contar, así que dos envíos de la misma
-- flota se serializan (otras flotas no se esperan) y el segundo ya ve el
-- tope. El dedup por huella (idempotencia del mismo archivo reenviado) se
-- comprueba ANTES del candado (camino rápido, no pelea por el candado del
-- tope) y se REPITE bajo el candado (dos envíos del MISMO archivo a la vez
-- pudieron pasar el primer chequeo juntos, antes de que cualquiera insertara).
--
-- `ingesta.ts` pasa a llamar esta función en UNA sola ida a la base en vez de
-- tres (existe/cuenta/inserta): el camino de «choca con el unique, se trata
-- como duplicado» que cubría la carrera a nivel aplicación deja de hacer
-- falta — el candado la cierra antes de que el INSERT pueda chocar.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.peaje_archivo_encolar(
  p_tenant uuid, p_huella text, p_nombre text, p_proveedor text, p_origen text, p_bytes int, p_contenido bytea
) returns table (id uuid, estado text, duplicado boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_estado text;
  v_n integer;
begin
  if p_tenant is null then raise exception 'flota requerida' using errcode = '22023'; end if;

  -- Camino rápido: el mismo archivo reenviado (idempotencia por huella) no debe
  -- pelear por el candado del tope de abajo.
  select a.id, a.estado into v_id, v_estado
    from public.peaje_ingesta_archivo a
   where a.tenant_id = p_tenant and a.huella = p_huella;
  if found then
    return query select v_id, v_estado, true;
    return;
  end if;

  -- Candado de transacción por flota (mismo molde que 0693): sin él, contar
  -- pendientes/procesando + insertar no es atómico y el tope se rebasa con
  -- envíos simultáneos — el TOCTOU real de esta migración.
  perform pg_advisory_xact_lock(hashtextextended('peaje_ingesta_tope:' || p_tenant::text, 0));

  -- Repetir el dedup YA con el candado tomado: dos envíos del MISMO archivo a
  -- la vez pudieron pasar el primer chequeo juntos (ninguno había insertado
  -- todavía) antes de que cualquiera llegara aquí.
  select a.id, a.estado into v_id, v_estado
    from public.peaje_ingesta_archivo a
   where a.tenant_id = p_tenant and a.huella = p_huella;
  if found then
    return query select v_id, v_estado, true;
    return;
  end if;

  select count(*) into v_n
    from public.peaje_ingesta_archivo a
   where a.tenant_id = p_tenant and a.estado in ('pendiente', 'procesando');
  -- 50 = MAX_PENDIENTES_POR_FLOTA en src/lib/likida/peajes/ingesta.ts. Si ese
  -- número cambia, cambia aquí EN EL MISMO commit (no hay forma de importarlo).
  if v_n >= 50 then
    raise exception 'tope de 50 archivos pendientes por flota' using errcode = '54000';
  end if;

  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, proveedor, origen, bytes, contenido, estado)
  values (p_tenant, p_huella, p_nombre, p_proveedor, p_origen, p_bytes, p_contenido, 'pendiente')
  returning peaje_ingesta_archivo.id into v_id;

  return query select v_id, 'pendiente'::text, false;
end;
$$;
comment on function public.peaje_archivo_encolar(uuid, text, text, text, text, int, bytea) is
  '0850: encola un archivo de peajes de forma atómica (dedup por huella + tope de 50 pendientes/procesando por flota), con un candado de transacción por flota (mismo molde que 0693) para que envíos concurrentes no rebasen el tope. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_archivo_encolar(uuid, text, text, text, text, int, bytea) from public, anon, authenticated;
grant execute on function public.peaje_archivo_encolar(uuid, text, text, text, text, int, bytea) to service_role;
