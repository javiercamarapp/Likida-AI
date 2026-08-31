-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 22 · DATOS-1 (ALTO) — la 0024 arregló `operador` y dejó a
-- `wa_conversacion` con el mismo defecto.
--
-- `wa_conversacion_tenant_tel_uidx` (0005:13) es `(tenant_id, telefono)` sobre
-- el TEXTO CRUDO. La 0024 diagnosticó exactamente este modo de falla para
-- `operador` y lo cerró con `telefono_normalizado(...)`; su propio comentario
-- lo dice: «"529993700779" y "5219993700779" pasaban como dos … de la misma
-- flota, con el historial partido entre las dos».
--
-- Y el código AFIRMA que las dos formas llegan: `conv.ts:64-71` documenta el
-- "1" que Telmex metió entre lada y celular, y por eso existe
-- `variantesTelefono()`, con la que `resolveOperador` resuelve al chofer por
-- cualquiera de las seis. `loadConversation` no: busca con `.eq('telefono',
-- telefono)` —igualdad exacta— y si no encuentra, INSERTA.
--
-- Consecuencia: el MISMO chofer, entrando por otro camino, estrena
-- conversación. Su `estado` —el viaje en curso, la barrera de ráfaga, el aviso
-- de privacidad ya puesto— se parte en dos filas, y ninguna de las dos tiene la
-- historia completa.
--
-- ── POR QUÉ EL ÍNDICE NUEVO NO BASTA POR SÍ SOLO ──────────────────────────
-- Puede haber filas duplicadas YA creadas. Crear el índice único sin
-- consolidarlas fallaría, así que primero se fusionan: sobrevive la más
-- reciente por `updated_at` y las demás se borran. No se intenta fusionar los
-- `estado` jsonb — mezclar dos máquinas de estado a ciegas fabricaría un
-- estado que nunca existió; se conserva el más nuevo, que es el que el chofer
-- está viviendo.
-- ═══════════════════════════════════════════════════════════════════════════

-- (1) Consolidar duplicados por (tenant_id, teléfono normalizado).
with ordenadas as (
  select id,
         row_number() over (
           partition by tenant_id, public.telefono_normalizado(telefono)
           order by updated_at desc nulls last, id desc
         ) as rn
    from public.wa_conversacion
)
delete from public.wa_conversacion c
 using ordenadas o
 where c.id = o.id and o.rn > 1;

-- (2) El índice único sobre la forma normalizada, igual que la 0024 para
--     `operador`. El viejo se conserva: un duplicado exacto sigue siendo un
--     duplicado, y quitarlo no es parte de este arreglo.
create unique index if not exists uq_wa_conversacion_tenant_telefono_norm
  on public.wa_conversacion (tenant_id, public.telefono_normalizado(telefono));

comment on index public.uq_wa_conversacion_tenant_telefono_norm is
  'Auditoría 22, DATOS-1. Espeja `uq_operador_tenant_telefono_norm` (0024): el mismo celular mexicano llega como 52… o 521… según por dónde entre, y con el índice crudo de la 0005 el mismo chofer estrenaba conversación —partiendo su estado, su barrera de ráfaga y la constancia del aviso de privacidad— al cambiar de camino de entrada.';
