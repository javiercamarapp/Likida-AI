-- ═══════════════════════════════════════════════════════════════════════════
-- 0115 — La bitácora de corridas aprende el disparo `whatsapp`.
--
-- Nace de la Fase 1 del blueprint (16-Blueprint-de-Construccion, 15-ago-2026):
-- `liquidacion` es el único de los 7 agentes vivos que nunca escribió en
-- `agente_corrida` — el corazón del producto no dejaba bitácora. Su corrida
-- es el CIERRE de una liquidación (`guardar_liquidacion`, tools.ts), y ese
-- cierre no lo dispara un reloj ni un botón del panel ni un correo: lo
-- dispara el OPERADOR confirmando por WhatsApp que ya no tiene comprobantes.
--
-- Registrarlo como 'manual' mentiría en la ficha («Ejecutar ahora» sobre algo
-- que confirmó un chofer en un chat) y como 'cron' peor. Mismo criterio y
-- mismo patrón que la 0108 al agregar 'correo' para el agente de Proveedores:
-- cada disparo con su verdad.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_corrida
  drop constraint agente_corrida_disparo_dominio;
alter table public.agente_corrida
  add constraint agente_corrida_disparo_dominio
    check (disparo in ('cron', 'manual', 'correo', 'whatsapp'));
