-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · DAT-13 — LOS JSONB Y EL EXPEDIENTE ARCO QUE EL PRODUCTO
-- INTERPRETA SIN QUE LA BASE LES PIDA FORMA.
-- (DAT-6 se evaluó aquí y quedó DIFERIDO; la razón, abajo.)
--
-- ── DAT-6 (MEDIO): DIFERIDO, Y LA RAZÓN ES DE PESO ───────────────────────
-- La coherencia `viaje.estatus = 'liquidado'` ⇔ existe `liquidacion` NO se
-- impone aquí. Se implementó, se probó contra la batería completa, y se
-- retiró: rompe 16 bloques de `verificaciones.sql` que no son de esta ronda.
--
-- No es que los bloques estén mal. Decenas usan `insert into viaje (…,
-- 'liquidado')` como ATAJO DE FIXTURE —necesitan un viaje liquidado para
-- probar otra cosa (que el gasto tardío rebote, que la póliza agrupe, que el
-- PDF se archive) y no la liquidación en sí—. Y el bloque `TARDE`
-- (`verificaciones.sql:779`) va más lejos: asevera `liquidado-sin-liquidacion-
-- sigue = t`, es decir, DOCUMENTA que el hueco existe, a propósito, para
-- probar que el trigger del gasto tardío mira la FILA de `liquidacion` y no el
-- estatus del viaje.
--
-- Cerrar DAT-6 es correcto y sigue pendiente, pero es un movimiento
-- coordinado: el trigger, más el reordenado de `reabrir_viaje_tx` (hoy pone
-- `estatus='abierto'` ANTES de borrar la liquidación, así que ni siquiera un
-- trigger inmediato de la mitad contraria pasaría), más la reescritura de esos
-- 16 bloques para que construyan sus fixtures por el camino real. Eso no cabe
-- en el arreglo mínimo de un hallazgo MEDIO ni en los archivos de este
-- constructor. Va al CIERRE con el diff propuesto, en vez de dejar la batería
-- roja o de imponer una regla a medias.
--
-- ── DAT-13 (BAJO): jsonb que el producto lee como objeto ──────────────────
-- `wa_conversacion.estado = '"hola"'` (S17) y `tenant.perfil = '[1,2]'` (S16)
-- entraban: el código hace `estado.turns` / `perfil.algo` sobre lo que salga.
-- `tenant.config` ya tiene el molde (`config_tenant_valida`, con un mensaje
-- que cita la línea de `engine.ts` que reventaría); esto es copiarlo.
--
-- Y `solicitud_arco` (S38) admitía una solicitud de cancelación SIN titular
-- —ni `operador_id` ni `titular_ref`— y con `vence_en` ANTERIOR a
-- `recibida_en`: un expediente ARCO que no dice de quién es y que nace
-- vencido. El plazo del art. 32 LFPDPPP se cuenta desde que se recibe.
--
-- FUERA DE ALCANCE, con razón: el dominio de `incidencia_evento.tipo`. Sus
-- escritores (`asistencia_wa.ts`, `asistencia_camara.ts`, `mesa_control.ts`)
-- pasan `tipo` como VARIABLE, no como literal, así que el juego de valores no
-- se puede enumerar leyendo el código. Un dominio incompleto rechazaría el
-- evento legítimo de un siniestro en curso —perder la bitácora de un choque
-- es peor que tener la columna suelta—. Queda anotado en el CIERRE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. DAT-13: los jsonb que el producto lee como objeto ─────────────────
alter table public.wa_conversacion drop constraint if exists wa_conversacion_estado_objeto;
alter table public.wa_conversacion add constraint wa_conversacion_estado_objeto
  check (estado is null or jsonb_typeof(estado) = 'object') not valid;

alter table public.tenant drop constraint if exists tenant_perfil_objeto;
alter table public.tenant add constraint tenant_perfil_objeto
  check (perfil is null or jsonb_typeof(perfil) = 'object') not valid;

-- ── 2. DAT-13: la solicitud ARCO dice de quién es y no nace vencida ───────
alter table public.solicitud_arco drop constraint if exists arco_titular_presente;
alter table public.solicitud_arco add constraint arco_titular_presente
  check (operador_id is not null or titular_ref is not null) not valid;

alter table public.solicitud_arco drop constraint if exists arco_vence_despues_de_recibida;
alter table public.solicitud_arco add constraint arco_vence_despues_de_recibida
  check (vence_en is null or recibida_en is null or vence_en >= recibida_en::date) not valid;

-- ── 3. Validar lo viejo sin poder tumbar el deploy (mismo molde que 0290) ─
do $$
declare c record;
begin
  for c in
    select unnest(array['wa_conversacion'::text, 'tenant', 'solicitud_arco', 'solicitud_arco']) as tabla,
           unnest(array['wa_conversacion_estado_objeto'::text, 'tenant_perfil_objeto',
                        'arco_titular_presente', 'arco_vence_despues_de_recibida']) as restriccion
  loop
    begin
      execute format('alter table public.%I validate constraint %I', c.tabla, c.restriccion);
    exception when others then
      raise notice 'AUD24/0291: % sigue NOT VALID (hay filas previas que no cumplen): %',
        c.restriccion, sqlerrm;
    end;
  end loop;
end $$;

-- ── 4. DAT-14 (BAJO): que `service_role` pasa quede DICHO en la base ──────
-- `borrado_de_dinero_prohibido` hace `if v_rol not in ('authenticated','anon')
-- then return old`: es decir, `service_role` —el ÚNICO rol con el que la app
-- escribe— puede borrar un gasto o una liquidación de un viaje ya liquidado.
-- Probado (S22/S22b): ACEPTADO.
--
-- No se cierra, y la refutación es la razón: la app NO TIENE camino de delete
-- sobre `gasto`, `viaje` ni `liquidacion` (el `.delete()` de `repo.ts:933` es
-- sobre `codigo_pendiente`; reabrir usa `reabrir_viaje_tx`, que ARCHIVA en
-- `liquidacion_historico`). Cerrarlo de verdad exige un rol aparte para las
-- migraciones y la purga, que hoy no existe. Lo que sí se puede hacer —y es lo
-- que falta— es que la garantía no viva sólo en un comentario de una migración
-- de 2025: queda escrita en el catálogo, donde la lee cualquiera que consulte
-- la función antes de escribir un script de soporte.
comment on function public.borrado_de_dinero_prohibido() is
  'Impide borrar dinero ya liquidado a `authenticated` y `anon`. AVISO (AUD24 DAT-14): NO frena a `service_role`, que es el rol con el que la app escribe TODO — un script de soporte, el SQL editor o el conector ERP del piloto pueden borrar un gasto o una liquidacion de un viaje liquidado y este trigger los deja pasar. Hoy es aceptable porque la app no tiene ningun camino de delete sobre gasto/viaje/liquidacion (reabrir_viaje_tx archiva en liquidacion_historico, no borra). Si algun dia se agrega uno, esta funcion NO es la red.';
