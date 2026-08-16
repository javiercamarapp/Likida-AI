-- ═══════════════════════════════════════════════════════════════════════════
-- 0122 — El Redactor (C5) entra al producto: catálogo + interruptor.
--
-- La última pieza de código de la Fase 2 del plan hacia el 90%: "Conectar el
-- Redactor (C5) a la cola de aprobación". El agente redacta el PRIMER correo
-- de un prospecto del censo (prompts/redactor.md: 3 variantes, cifras
-- canónicas, cero personalización alucinada) y lo deja en `cola_aprobacion`
-- — NUNCA envía: el envío ya tiene su única puerta (enviarPiezaPorCorreo,
-- 0120) con el CHECK enviar-solo-aprobado y la guardia de cadencia 48h.
--
-- Dos altas declarativas, cero tablas nuevas:
--  1. La fila en `agente_definicion` (0116) — sin ella, encolarPieza rebota
--     por FK: una pieza sin autor declarado no entra a la cola.
--  2. `agente:redactor` en el dominio del interruptor (0110) — el kill
--     switch del patrón de la casa. El CHECK se recrea con el valor nuevo;
--     que basura siga rebotando ya lo prueba el bloque de la 0110, y que
--     'redactor' se acepta se prueba en TS (redactor.test.ts).
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion) values
  ('redactor', 'Redactor de Primer Contacto', 'leads', 'manual', 'vivo',
   'C5: redacta el primer correo de un prospecto del censo (variantes A/B/C del guion) y lo deja en la cola de aprobación. JAMÁS envía — el envío exige aprobación humana y pasa por la guardia de cadencia.')
on conflict (id) do nothing;

alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor'
  )
);
