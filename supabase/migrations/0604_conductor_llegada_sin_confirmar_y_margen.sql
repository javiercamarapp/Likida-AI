-- ═══════════════════════════════════════════════════════════════════════════
-- 0604 — Conductor: aviso al jefe de tráfico por «llegada sin confirmar» y margen de acercamiento por flota.
--
-- 1. `avisar_llegada_sin_confirmar` (APAGADO por omisión): cuando un chofer dice «ya llegué» y ninguna posición
--    lo respalda (o el viaje no tiene sitio contra el cual compararlo), el jefe de tráfico recibe UN aviso. Hoy
--    solo se ve como excepción en el tablero. Apagado: un aviso por llegada a 250 camiones es ruido hasta que
--    el tráfico lo pida (mismo criterio que `avisar_oficina_llegada` y la alerta de estadía).
-- 2. `margen_acercamiento_m`: cuántos metros ANTES del borde de la geocerca se le manda al chofer la calle de
--    instrucciones de la planta. Era una constante de 5 km en el código; ahora cada flota la ajusta
--    (5,000 m sigue siendo el valor de partida).
-- 3. Dominios que se amplían (se enumeran ENTEROS, lección de la 0227): la clase de aviso reclamable
--    `llegada_sin_confirmar` y el evento de bitácora `alerta_llegada_sin_confirmar`.
--
-- Aditiva e idempotente. El código lee la fila completa y trata una columna ausente como el valor por omisión:
-- contra la base sin migrar el aviso queda apagado y el margen sigue siendo 5,000 m.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_conductor_config
  add column if not exists avisar_llegada_sin_confirmar boolean not null default false,
  add column if not exists margen_acercamiento_m integer not null default 5000;

alter table public.agente_conductor_config drop constraint if exists conductor_config_margen_acercamiento;
alter table public.agente_conductor_config add constraint conductor_config_margen_acercamiento
  check (margen_acercamiento_m between 0 and 50000);

comment on column public.agente_conductor_config.avisar_llegada_sin_confirmar is
  '0604: avisar UNA vez al jefe de tráfico cuando un «ya llegué» sigue sin confirmarse con ubicación (o el viaje no tiene sitio para comparar). Apagado por omisión.';
comment on column public.agente_conductor_config.margen_acercamiento_m is
  '0604: metros que se suman al radio de la geocerca para decir «ya vas llegando» y mandar las instrucciones de la planta (convenios). 5,000 por omisión (supuesto, no medición); de 0 a 50,000.';

alter table public.viaje_hito_aviso drop constraint if exists viaje_hito_aviso_clase_dominio;
alter table public.viaje_hito_aviso add constraint viaje_hito_aviso_clase_dominio check (clase in
  ('solicitud', 'recordatorio', 'escalacion', 'confirmacion', 'aviso_oficina', 'ubicacion', 'alerta_estadia', 'llegada_sin_confirmar'));

alter table public.viaje_hito_evento drop constraint if exists viaje_hito_evento_dominio;
alter table public.viaje_hito_evento add constraint viaje_hito_evento_dominio check (evento in
  ('solicitado', 'recibido', 'validado', 'omitido', 'escalado', 'corregido', 'pospuesto', 'atendido', 'contacto',
   'validacion', 'evidencia', 'captura_manual', 'alerta_estadia', 'alerta_llegada_sin_confirmar'));
