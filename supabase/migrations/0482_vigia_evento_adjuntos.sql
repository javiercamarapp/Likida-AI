-- ═══════════════════════════════════════════════════════════════════════════
-- 0482 — El Vigía adjunta el POD a su respuesta: tres eventos nuevos en la bitácora.
--
-- `adjunto_enviado`   el archivo salió (junto con el texto, dentro de la ventana de 24 h);
-- `adjunto_pendiente` el texto salió como PLANTILLA (ventana cerrada) y un archivo libre no
--                     puede salir: queda a la vista del gerente (clave única por mensaje y
--                     archivo: una sola vez);
-- `adjunto_fallo`     el archivo no existía, no se pudo firmar o Meta lo rechazó.
-- Sin texto, sin ruta, sin teléfono: solo ids, hash del destinatario y la causa.
--
-- El CHECK se reescribe ENTERO desde el vigente (0400) más los tres nuevos.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.vigia_evento drop constraint if exists vigia_evento_tipo_dominio;
alter table public.vigia_evento add constraint vigia_evento_tipo_dominio check (tipo in (
  'entrante', 'borrador', 'aprobado', 'rechazado', 'enviado', 'autoenviado', 'fallo_envio',
  'tomada', 'devuelta', 'cerrada', 'molestia', 'sin_respuesta', 'escalada', 'sin_destinatario',
  'optout', 'alta', 'baja_manual', 'suprimido', 'spam', 'sin_dato', 'inyeccion', 'otro_cliente',
  'adjunto_enviado', 'adjunto_pendiente', 'adjunto_fallo'
));
