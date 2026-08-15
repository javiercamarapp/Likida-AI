-- ═══════════════════════════════════════════════════════════════════════════
-- 0107 — La talacha autorizada por WhatsApp (14-ago-2026, F4 del plan).
--
-- El circuito que Transportes Innovativos describió: el chofer reporta
-- "se me ponchó una llanta" con la foto de la nota, el JEFE autoriza o
-- rechaza respondiendo por WhatsApp, y el gasto llega a la liquidación con
-- su incidencia ya decidida — con QUIÉN y CUÁNDO, porque el agente prepara
-- y marca pero NUNCA autoriza solo (§4.6 del plan).
--
-- Todo vive en `incidencia` (0047) y no en una tabla nueva a propósito: la
-- talacha ES una incidencia (tipo 'averia') y la pantalla de incidencias ya
-- la enseña. Lo que faltaba era el dinero y la firma:
--
--   · monto_estimado — lo que el chofer DIJO o lo que la nota TRAE. NULL =
--     no se dijo monto todavía (≠ costó cero: un cero aquí sería una cifra
--     que nadie midió, y ese cero está prohibido en este producto).
--   · evidencia_path — la foto de la nota en Storage (mismo bucket y mismo
--     criterio que `gasto.imagen_url`: se conserva, no se exhibe).
--   · gasto_id — el comprobante que esa nota generó en la liquidación. Es
--     EL enlace incidencia↔gasto: por él se sabe que un gasto de camino
--     llegó pre-autorizado, sin tocar el motor de cuadre.
--   · autorizacion — NULL para las incidencias de siempre (informativas,
--     nada que autorizar). 'pendiente' arranca el circuito; 'autorizada' o
--     'rechazada' son la decisión del jefe.
--   · autorizada_por / autorizada_en — la firma: quién decidió y cuándo,
--     EN AMBOS SENTIDOS (también el rechazo se firma; el nombre de la
--     columna es por el caso feliz, el comment lo deja dicho).
--
-- El claim anti-doble-decisión NO es un mecanismo nuevo: es un UPDATE
-- condicional `WHERE autorizacion = 'pendiente'` (atómico por construcción
-- de Postgres, mismo patrón que el sello 0058/0087/0090) — si el jefe
-- aprieta el botón dos veces, gana exactamente una.
--
-- TODO ES ADITIVO: columnas nullables sobre una tabla existente. Un
-- despliegue viejo sigue corriendo contra este esquema sin enterarse.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.incidencia
  add column monto_estimado numeric,
  add column evidencia_path text,
  add column gasto_id uuid references public.gasto(id) on delete set null,
  add column autorizacion text,
  add column autorizada_por uuid references public.app_user(id) on delete set null,
  add column autorizada_en timestamptz;

comment on column public.incidencia.monto_estimado is
  'Lo que el chofer dijo o la nota trae (0107). NULL = sin monto reportado, NO "costó cero" — la pantalla dice "sin monto", nunca $0.00.';
comment on column public.incidencia.evidencia_path is
  'Foto de la nota (talacha) en Storage, bucket privado (0107). Mismo criterio que gasto.imagen_url: se conserva como evidencia, no se exhibe sin base legal.';
comment on column public.incidencia.gasto_id is
  'El gasto que la nota generó en la liquidación (0107). Es el enlace por el que un gasto de camino se lee como pre-autorizado — el motor de cuadre no se toca.';
comment on column public.incidencia.autorizacion is
  'NULL = incidencia informativa, no hay nada que autorizar (el caso de todas las anteriores a la 0107). pendiente | autorizada | rechazada.';
comment on column public.incidencia.autorizada_por is
  'Quién DECIDIÓ — también el rechazo se firma aquí (0107). El agente nunca escribe esta columna solo: siempre viene de un humano identificado por teléfono.';
comment on column public.incidencia.autorizada_en is
  'Cuándo se decidió (0107). Hora del mensaje del jefe, la verdad que tenemos.';

-- El dominio de la decisión, y la firma amarrada a ella: hay firma EXACTAMENTE
-- cuando hay decisión. Sin este check, una "autorizada" sin quién/cuándo se
-- leería igual que una firmada — y la firma es todo el punto del circuito.
alter table public.incidencia
  add constraint incidencia_autorizacion_dominio
    check (autorizacion is null or autorizacion in ('pendiente', 'autorizada', 'rechazada')),
  add constraint incidencia_decision_firmada
    check ((autorizacion in ('autorizada', 'rechazada'))
           = (autorizada_por is not null and autorizada_en is not null));

-- Lo que el jefe consulta al responder "autorizo" sin botón: las pendientes de
-- SU flota. Parcial porque las incidencias informativas (autorizacion NULL) son
-- la población grande y nunca entran a esta consulta.
create index if not exists incidencia_autorizacion_pendiente_idx
  on public.incidencia (tenant_id)
  where autorizacion = 'pendiente';
