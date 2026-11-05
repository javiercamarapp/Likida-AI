-- REVERSA (solo si no quedan filas con los tipos nuevos; si quedan, borrarlas antes): alter table public.evento_seguridad drop constraint if exists evento_seguridad_tipo_check; alter table public.evento_seguridad add constraint evento_seguridad_tipo_check check (tipo in ('firma_invalida','intent_invalido','step_up_rechazado','rate_limit','inyeccion_prompt','acceso_denegado','cifra_sin_respaldo','payload_excesivo','otro','login_fallido','llave_invalida','api_negada','exporte_dinero','cambio_rol')) not valid;
-- Aplicación doble: segura (drop constraint if exists + add; el check ampliado es NOT VALID).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0971 — CT-SEG-11 (F2): dos tipos de evento de seguridad más: página negada y segundo factor fallido.
--
-- La 0954 dejó declaradas, sin emisor, las fuentes «páginas del panel negadas por rol o perfil» (guard.ts redirige sin registrar) y
-- «segundo factor fallido o saltado» (mfa.ts decide y no registra). Esta migración solo AMPLÍA el check de `tipo` para que puedan
-- escribirse; los emisores viven en src/lib/seguridad/registro_acceso.ts. No toca filas ni funciones: la RPC de la 0955 delega el
-- dominio al check. NOT VALID: todo valor viejo ya cumplía la lista anterior (un subconjunto), así que no recorre la tabla.
--
-- COMPATIBILIDAD: el registro degrada a `otro` si la base aún no trae esta migración (ver TIPOS_NUEVOS en eventos.ts).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

alter table public.evento_seguridad drop constraint if exists evento_seguridad_tipo_check;
alter table public.evento_seguridad add constraint evento_seguridad_tipo_check check (tipo in (
  'firma_invalida', 'intent_invalido', 'step_up_rechazado', 'rate_limit',
  'inyeccion_prompt', 'acceso_denegado', 'cifra_sin_respaldo',
  'payload_excesivo', 'otro',
  'login_fallido', 'llave_invalida', 'api_negada', 'exporte_dinero', 'cambio_rol',
  'pagina_negada', 'mfa_fallido'
)) not valid;

commit;
