-- ═══════════════════════════════════════════════════════════════════════════
-- 0263 — AUDITORÍA E.28, C-1 (MEDIA-BAJA): ligar un CFDI del SAT a un gasto
--         no era transaccional, y la cuña que dejaba no tenía salida.
--
-- `ligarComprobante` (resolucion.ts) hacía DOS escrituras SUELTAS desde
-- TypeScript, en dos viajes distintos a la base:
--
--   1. UPDATE gasto SET cfdi_uuid = …, xml_verificado = true
--   2. UPDATE sat_cfdi_descargado SET estatus = 'casado', gasto_id = …
--
-- Los fallos EN BANDA (la escritura 2 responde con error, o afecta cero
-- filas) sí se compensaban: el código soltaba el gasto por su propio folio
-- (`.eq('cfdi_uuid', cfdi.cfdiUuid)`) y devolvía un motivo claro. Pero una
-- MUERTE DEL PROCESO entre la escritura 1 y la 2 —el runtime se recicla, el
-- lambda se corta, el pod muere— no es un fallo en banda: no hay ningún
-- `catch` que corra, así que no hay compensación. El gasto se queda con
-- `cfdi_uuid` + `xml_verificado = true` (afirmando estar facturado) mientras
-- el CFDI del otro lado sigue en `'disponible'`.
--
-- Y esa cuña NO TENÍA SALIDA desde la interfaz:
--   · re-ligar el MISMO gasto rebota con `gasto_ya_tiene_cfdi` (línea 229 de
--     resolucion.ts: el gasto ya tiene folio, aunque el CFDI no lo sepa);
--   · ligarlo a OTRO gasto viola `uq_gasto_cfdi_uuid` (0065: único por
--     `(tenant_id, cfdi_uuid, cfdi_orden)`) — el folio ya está pegado en otro
--     lado;
--   · revertir dice `nada_que_revertir` (línea 447: el CFDI nunca llegó a
--     'casado' ni a 'ignorado', que son los dos únicos estados que
--     `revertirResolucion` sabe deshacer).
-- Solo se reparaba a mano en la base — exactamente el mismo patrón no-
-- atómico que la 0231 ya tenía en el cruce automático (`ciclo.ts`), ahora
-- con un camino HUMANO (clic + red lenta) que lo hace más probable.
--
-- ── EL ARREGLO: LAS DOS ESCRITURAS Y EL EXPEDIENTE, EN UNA FUNCIÓN ─────────
--
-- `sat_cfdi_ligar_tx` hace lo que antes eran dos viajes a la base (más un
-- tercero, el insert al expediente que antes también quedaba "mejor
-- esfuerzo" fuera de la transacción) en UNA sola función `plpgsql`. El orden
-- interno se conserva —el gasto PRIMERO, el comprobante DESPUÉS— por la
-- misma razón que ya explicaba el comentario de TypeScript: al revés, un
-- comprobante podría quedar diciendo "casé" con un gasto que otro se llevó.
-- La diferencia es que ahora, si CUALQUIER paso falla —el `for update` no
-- encuentra fila, `gasto_no_tras_liquidar` (0036/0037) rebota porque el
-- viaje ya se liquidó, o cualquier otra cosa—, Postgres deshace TODO lo que
-- esta llamada llevaba escrito. Ya no hay "a medias" que reparar a mano: o
-- entra el cruce completo con su expediente, o no entra nada.
--
-- Reversible:
--   drop function public.sat_cfdi_ligar_tx(uuid, uuid, uuid, text, jsonb, uuid, text);
--
-- Verificado por el bloque 211 de supabase/verificaciones.sql, incluido un
-- fallo INYECTADO a medio camino (un CHECK temporal que solo dispara para la
-- fila de la prueba) que demuestra que la escritura del gasto —que ya había
-- corrido dentro de la misma llamada— se deshace también.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── SQLSTATE propios, mismo criterio que el CU001 de la 0036 ───────────────
--   CU014  el comprobante no coincide con el estatus anclado (alguien más lo
--          resolvió mientras el contralor decidía — la misma carrera que el
--          `.eq('estatus', cfdi.estatus)` de TypeScript decidía antes,
--          ahora dentro del candado).
--   CU015  el gasto no está disponible para este cruce (no es de esta
--          flota, ya no existe, o ya tiene comprobante — perdió la carrera
--          contra otro cruce que le pegó folio primero).

create or replace function public.sat_cfdi_ligar_tx(
  p_tenant           uuid,
  p_cfdi             uuid,
  p_gasto            uuid,
  p_estatus_esperado text,
  p_candidatos       jsonb,
  p_actor_id         uuid,
  p_actor_email      text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cfdi_uuid text;
begin
  -- El comprobante TRABADO y ANCLADO al estatus que TypeScript ya leyó: si
  -- alguien más lo resolvió entre esa lectura y esta llamada, la fila no
  -- aparece con `estatus = p_estatus_esperado` y se aborta AQUÍ, antes de
  -- tocar una sola tabla más.
  select cfdi_uuid into v_cfdi_uuid
    from sat_cfdi_descargado
   where id = p_cfdi and tenant_id = p_tenant and estatus = p_estatus_esperado
     for update;

  if not found then
    raise exception 'comprobante % no coincide con el estatus % en la flota %', p_cfdi, p_estatus_esperado, p_tenant
      using errcode = 'CU014';
  end if;

  -- El gasto TRABADO: de esta flota y TODAVÍA sin comprobante. Perder esta
  -- carrera aquí es justo lo que antes contaba `(ligado ?? []).length !== 1`
  -- en TypeScript, solo que ahora se decide ANTES de escribir nada — nunca
  -- después, con un gasto ya ligado que hay que soltar por su cuenta.
  perform 1 from gasto
   where id = p_gasto and tenant_id = p_tenant and cfdi_uuid is null
     for update;

  if not found then
    raise exception 'gasto % no disponible para el cruce en la flota %', p_gasto, p_tenant
      using errcode = 'CU015';
  end if;

  -- ── LAS DOS ESCRITURAS, EN UNA SOLA TRANSACCIÓN ──────────────────────────
  -- El gasto PRIMERO, el comprobante DESPUÉS — el mismo orden que ya usaba
  -- TypeScript. Este UPDATE puede lanzar CU001 (`gasto_no_tras_liquidar`,
  -- 0036/0037) si el viaje del gasto YA se liquidó: se deja propagar tal
  -- cual, sin atraparlo aquí, para que el llamador lo distinga con las
  -- mismas palabras de siempre — y para que, si truena, la función entera
  -- revierta sin dejar nada escrito.
  update gasto
     set cfdi_uuid = v_cfdi_uuid, cfdi_orden = 1, xml_verificado = true
   where id = p_gasto and tenant_id = p_tenant;

  update sat_cfdi_descargado
     set estatus = 'casado',
         gasto_id = p_gasto,
         candidatos = p_candidatos,
         resuelto_por = p_actor_id,
         resuelto_por_email = p_actor_email,
         resuelto_en = now()
   where id = p_cfdi and tenant_id = p_tenant;

  -- El expediente, EN LA MISMA TRANSACCIÓN. Antes de esta migración, `anotarActo`
  -- lo escribía DESPUÉS de que las dos escrituras de arriba ya habían
  -- terminado, a propósito "mejor esfuerzo" (su comentario en TypeScript:
  -- "si falla, se grita en el log — nunca se traga en silencio", pero
  -- tampoco deshace nada). Aquí no hace falta ese best-effort: si este
  -- INSERT no se escribe, el UPDATE del gasto y el del comprobante tampoco
  -- quedan — los tres son la misma unidad.
  insert into sat_cfdi_resolucion
    (tenant_id, cfdi_id, acto, gasto_id, estatus_antes, estatus_despues, actor_id, actor_email)
  values
    (p_tenant, p_cfdi, 'ligado', p_gasto, p_estatus_esperado, 'casado', p_actor_id, p_actor_email);

  return jsonb_build_object('gasto_id', p_gasto, 'cfdi_uuid', v_cfdi_uuid);
end;
$$;

comment on function public.sat_cfdi_ligar_tx(uuid, uuid, uuid, text, jsonb, uuid, text) is
  'Liga un CFDI del SAT a un gasto EN UNA transacción (auditoría E.28, C-1). Antes eran dos escrituras sueltas desde TypeScript (gasto, luego sat_cfdi_descargado) con el expediente escrito después como mejor esfuerzo: una muerte del proceso entre la primera y la segunda dejaba el gasto afirmando estar facturado (cfdi_uuid + xml_verificado=true) mientras el CFDI seguía disponible, y esa cuña no tenía salida desde la interfaz (re-ligar rebotaba con gasto_ya_tiene_cfdi, ligar a otro violaba uq_gasto_cfdi_uuid de la 0065, revertir decía nada_que_revertir). Aquí las dos escrituras y el renglón del expediente son una sola unidad: cualquier fallo a mitad de camino —simulado o real, incluido CU001 si el viaje ya se liquidó— revierte TODO. CU014 = el comprobante ya no coincide con el estatus anclado; CU015 = el gasto ya no está disponible para el cruce.';

-- Solo service_role. El `revoke from public` NO basta: Supabase concede
-- EXECUTE explícito a anon/authenticated por default privileges (lección de
-- la 0013).
revoke execute on function public.sat_cfdi_ligar_tx(uuid, uuid, uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant  execute on function public.sat_cfdi_ligar_tx(uuid, uuid, uuid, text, jsonb, uuid, text) to service_role;
