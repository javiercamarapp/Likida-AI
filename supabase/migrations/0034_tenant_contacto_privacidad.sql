-- ═══════════════════════════════════════════════════════════════════════════
-- EL CONTACTO DEL ART. 29, QUE NO TENÍA DÓNDE VIVIR.
--
-- El art. 29 de la LFPDPPP obliga a designar una persona o departamento de
-- datos personales, y el aviso integral tiene que decir quién es. Es el elemento
-- 10 del checklist de `docs/conocimiento/11-datos-personales.md` §5.4.
--
-- `tenant` ya guarda los otros tres datos del aviso —razón social, domicilio
-- fiscal y la liga del integral—; éste faltaba, así que la página del integral
-- no tenía de dónde sacarlo.
--
-- NULLABLE a propósito. La página DICE que la flota no lo ha designado en vez de
-- rellenar el hueco con el chat de WhatsApp y dar el artículo por cumplido. Es
-- el mismo criterio que ya rige a la liga rota: decirle la verdad al titular
-- cumple más que un contacto que no existe, y además deja visible lo que falta
-- en lugar de esconderlo.
-- ═══════════════════════════════════════════════════════════════════════════

alter table tenant add column if not exists contacto_privacidad text;

comment on column tenant.contacto_privacidad is
  'Persona o departamento de datos personales de la FLOTA (LFPDPPP art. 29), tal como debe aparecer en el aviso integral: nombre del área, correo y/o teléfono. NULL = la flota no lo ha designado, y el aviso integral lo dice en vez de inventarlo.';
