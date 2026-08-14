-- ═══════════════════════════════════════════════════════════════════════════
-- 0100 — EL DERECHO DE OPOSICIÓN, EJECUTABLE (LFPDPPP art. 26 fr. II).
--
-- El aviso de privacidad le dice al operador, textualmente: "Esa revisión la
-- hace un programa, sin que una persona la mire antes. Tienes derecho a
-- oponerte a que se decida así y a pedir que la revise alguien."
--
-- Hasta hoy (hallazgo E1, auditoría 4), oponerse insertaba una fila en
-- `solicitud_arco` y NO OCURRÍA NADA MÁS: ni bandera en `operador`, ni
-- lectura en el pipeline que suspendiera el tratamiento. El derecho se
-- anunciaba y no se podía honrar. El sancionado sería LA FLOTA (la
-- responsable), y Likida responde por contrato.
--
-- TIMESTAMPTZ Y NO BOOLEAN a propósito: NULL = el derecho no se ha ejercido
-- (medición real, no relleno); una fecha = CUÁNDO se ejerció — que es el
-- rastro que la flota necesita para demostrar desde cuándo lo honra. Se
-- escribe solo si estaba en NULL (la primera fecha es la que vale) y se
-- levanta poniéndola en NULL, decisión de la flota con el titular.
--
-- Quién la lee: `cuadre/desde_db.ts` la pasa al motor, y el motor marca la
-- liquidación con la diferencia `oposicion_titular` y estatus `revisar` —
-- la decisión deja de ser solo automatizada porque una persona la tiene que
-- cerrar. Quién la escribe: `processor.ts` cuando la solicitud clasifica
-- como oposición y el teléfono resolvió a un operador.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.operador
  add column if not exists oposicion_automatizada timestamptz;

comment on column public.operador.oposicion_automatizada is
  'Cuándo el titular ejerció su oposición a la decisión automatizada (LFPDPPP 26-II). NULL = no ejercida. Con fecha, toda liquidación suya sale a revisión humana (diferencia oposicion_titular). Se levanta poniéndola en NULL.';
