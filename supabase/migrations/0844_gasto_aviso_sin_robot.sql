-- ═══════════════════════════════════════════════════════════════════════════
-- 0844 — Agente 6 Autofactura: candado del aviso "comercio sin adaptador" (el fallback genérico).
--
-- QUÉ FALTABA: de los comercios del catálogo (`facturacion/comercios.ts`) que SÍ se reconocen
-- —portal, campos leídos— hay varios para los que nadie escribió un adaptador de automatización
-- (`enrutar.ts` ya los clasifica con motivo 'sin_robot' y `mensajeParaEncargado` ya arma el mensaje
-- con la liga del portal y los datos que el OCR extrajo del ticket). Pero NADA disparaba ese
-- mensaje: `facturarAlVuelo` (`al_vuelo.ts`) devolvía `motivo: 'sin_adaptador'` sin tocar la base,
-- así que el ticket nunca entraba a `bloqueadosPorFlota` (`cron/facturar/lote.ts`) y el WhatsApp de
-- `avisarPorFacturar` no salía jamás — el ticket se quedaba viendo la pantalla de "por facturar"
-- para siempre, en silencio.
--
-- ESTA COLUMNA ES EL CANDADO DE "YA SE AVISÓ UNA VEZ" para ese fallback. A PROPÓSITO es una columna
-- separada de `autofactura_bloqueada_en`/`autofactura_bloqueo` (0065): aquellas las lee `enrutar()`
-- para decidir el TEXTO del mensaje ('bloqueado' = "se intentó y no se pudo" vs 'sin_robot' = "no sé
-- llenarlo solo"), y pisarlas aquí haría que la próxima lectura del ticket dijera la frase
-- equivocada —nadie intentó nada, es que no hay quien lo intente—. Por eso NO saca al ticket de la
-- cola automática ni de la pantalla: sigue viéndose, una persona lo puede facturar con la liga que
-- ya recibió, y si algún día se escribe el adaptador la máquina lo retoma sin que nadie lo desatore.
--
-- NULL = no se ha avisado todavía (o nunca aplica, para un comercio con adaptador). Con fecha = ya
-- se le mandó el WhatsApp una vez con la liga del portal y los datos del ticket; no se repite.
--
-- Aditiva e idempotente: una sola columna nullable, sin CHECK, sin tocar RLS ni ninguna función.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.gasto
  add column if not exists autofactura_aviso_sin_robot_en timestamptz;

comment on column public.gasto.autofactura_aviso_sin_robot_en is
  'Cuando se avisó por WhatsApp al encargado, con la liga del portal y los datos ya leídos del ticket, que este comercio todavía no tiene adaptador escrito (enrutar(): motivo sin_robot). NULL = no avisado todavía. Independiente de autofactura_bloqueada_en/autofactura_bloqueo: no cambia cómo enrutar() clasifica ni redacta el mensaje de este ticket, y no lo saca de la cola ni de la pantalla de "por facturar".';
