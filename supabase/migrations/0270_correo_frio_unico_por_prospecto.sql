-- ═══════════════════════════════════════════════════════════════════════════
-- 0270 · UNA pieza `correo_frio` pendiente por prospecto — el árbitro que le
-- faltaba al Redactor. Auditoría 21 (agéntico, MEDIO).
--
-- ── EL HALLAZGO ─────────────────────────────────────────────────────────────
--
-- `redactarCorreoFrio` tiene DOS disparadores desde la 0123: el botón del
-- tablero (`/admin/vendedores`) y el runner nivel 2 (cron). Su freno
-- anti-duplicado era una LECTURA previa (redactor.ts: «¿ya hay una pieza
-- pendiente de este prospecto?») — el patrón que basta cuando solo dispara un
-- humano, y que deja de bastar en cuanto compiten dos caminos: si el vendedor
-- da clic en el mismo minuto en que el cron elige al mismo prospecto, las dos
-- invocaciones leen ANTES de que ninguna inserte, ambas ven cero pendientes,
-- y las DOS piezas de `correo_frio` entran a la cola. Si un humano aprueba
-- ambas con más de 48 h de separación, la reserva de cadencia
-- (`reservar_envio_prospecto`, 0124) ya no las distingue y el prospecto
-- recibe dos correos de campaña de la misma oferta.
--
-- Los otros 6 departamentos (0215-0235) ya resuelven esta carrera con un
-- índice único parcial como árbitro real — `cola_parte_por_periodo` (0215),
-- `cola_parte_exito_por_periodo` (0218), el `unique(viaje, tier)` de
-- cobranza — bajo el estándar técnico §7: la idempotencia es un CONSTRAINT,
-- jamás un `if`. El Redactor era el único productor del catálogo protegido
-- solo por la lectura previa.
--
-- ── POR QUÉ (prospecto_id) Y NO (agente, titulo) ───────────────────────────
--
-- Los índices de la 0215/0218 arbitran por título porque sus títulos son
-- deterministas por periodo. El del Redactor NO lo es para este fin: titula
-- con el asunto de la campaña, y dos prospectos DISTINTOS comparten asunto
-- legítimamente (la propia 0218 lo deja escrito al excluir al Redactor de su
-- índice). Lo que nunca es legítimo es lo inverso: dos piezas `correo_frio`
-- PENDIENTES del mismo prospecto — exactamente la condición que el freno de
-- código ya prohibía de palabra. Este índice la prohíbe de base.
--
-- Parcial a `estado = 'pendiente'` a propósito: una pieza resuelta (aprobada
-- o rechazada) sale del índice y el Redactor puede fabricar la siguiente —
-- la misma semántica del freno («resuélvela antes de redactar otra»), ahora
-- con la base como árbitro. Y parcial a `tipo = 'correo_frio'`: la pieza del
-- SDR (`respuesta_ads`) puede convivir con un correo frío pendiente del
-- mismo prospecto, igual que hoy.
--
-- El perdedor de la carrera rebota con 23505; `redactarCorreoFrio` lo
-- traduce al MISMO mensaje de pantalla que ya daba el freno (patrón
-- `encolarPiezaExito`, exito.ts).
-- ═══════════════════════════════════════════════════════════════════════════

-- Desempate de duplicados preexistentes, si los hubiera (dos pendientes del
-- mismo prospecto fabricadas ANTES de este árbitro): sobrevive la más
-- reciente y las demás se rechazan con motivo — jamás se borran, la bandeja
-- es bitácora. El rechazo cumple los CHECK de la 0117/0120 (motivo,
-- resolución coherente, actor snapshot).
update public.cola_aprobacion c
set estado            = 'rechazado',
    motivo_rechazo    = 'Duplicada: este prospecto ya tenía otra pieza de correo frío pendiente más reciente (desempate de la migración 0270).',
    resuelto_en       = now(),
    resuelto_por_email = 'migracion-0270@likida.ai'
where c.tipo = 'correo_frio'
  and c.estado = 'pendiente'
  and c.prospecto_id is not null
  and exists (
    select 1 from public.cola_aprobacion m
    where m.tipo = 'correo_frio'
      and m.estado = 'pendiente'
      and m.prospecto_id = c.prospecto_id
      and (m.creado_en, m.id) > (c.creado_en, c.id)
  );

create unique index if not exists cola_correo_frio_por_prospecto
  on public.cola_aprobacion (prospecto_id)
  where tipo = 'correo_frio' and estado = 'pendiente' and prospecto_id is not null;

comment on index public.cola_correo_frio_por_prospecto is
  'UNA pieza de correo frío PENDIENTE por prospecto (0270, auditoría 21 agéntico MEDIO). El árbitro real de la carrera botón-del-tablero vs cron del Redactor (0123): dos invocaciones que pasan la lectura previa a la vez las resuelve la base — gana exactamente una y la perdedora rebota con 23505, que redactarCorreoFrio traduce al mismo mensaje del freno. Parcial a pendiente (una pieza resuelta libera al prospecto para la siguiente) y a correo_frio (la respuesta_ads del SDR convive, igual que los índices por título de la 0215/0218 excluyen al Redactor a propósito).';
