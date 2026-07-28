-- B19 — Aviso de privacidad en el canal (LFPDPPP arts. 14, 15 y 16 fr. II).
--
-- El obligado es el RESPONSABLE, y ese es la FLOTA. Likida es persona encargada
-- (art. 2 fr. XII): trata los datos por cuenta de ella y no responde por la
-- omisión del aviso. Lo que sí es un hueco de producto es que la flota no PUEDA
-- cumplir aunque quiera, y eso pasaba: no había ni dónde guardar sus datos de
-- responsable ni cómo dejar constancia de haberlo puesto a disposición.
--
-- Datos del responsable en `tenant` (art. 15 fr. I pide identidad Y domicilio;
-- `nombre` y `ciudad` no alcanzan: uno es el nombre comercial y el otro no es un
-- domicilio). El aviso integral vive en el sitio de la flota, no en el nuestro:
-- es SU documento, y el art. 16 fr. II solo obliga a señalar dónde consultarlo.

alter table tenant add column if not exists razon_social text;
alter table tenant add column if not exists domicilio_fiscal text;
alter table tenant add column if not exists url_aviso_privacidad text;

comment on column tenant.razon_social is
  'Razón social tal cual en el RFC. Art. 15 fr. I. Sin esto no se puede armar el aviso.';
comment on column tenant.domicilio_fiscal is
  'Domicilio del responsable. Art. 15 fr. I. `ciudad` NO sirve: no es un domicilio.';
comment on column tenant.url_aviso_privacidad is
  'Dónde vive el aviso INTEGRAL de la flota. Art. 16 fr. II obliga a señalarlo.';

-- La constancia. Sin fecha no hay forma de sostener que se puso a disposición, y
-- sin la versión no hay forma de saber si lo que vio el operador sigue vigente:
-- el art. 15 fr. VI obliga a comunicar los cambios al aviso.
alter table operador add column if not exists aviso_privacidad_en timestamptz;
alter table operador add column if not exists aviso_privacidad_version text;

comment on column operador.aviso_privacidad_en is
  'Cuándo se le puso a disposición el aviso simplificado por WhatsApp. NULL = nunca.';
comment on column operador.aviso_privacidad_version is
  'Hash del texto que vio. Si el de la flota cambia, deja de coincidir y se vuelve a enviar.';

-- Marca la constancia y devuelve si ESTE llamado fue el que la puso.
--
-- El claim va en el WHERE, igual que en la 0017: las fotos de una ráfaga corren
-- en paralelo y el primer mensaje puede llegar a la vez por dos caminos. Sin
-- claim, el operador recibiría el aviso dos o tres veces seguidas — que además
-- de molesto se ve como un bug delante del comprador.
create or replace function marcar_aviso_privacidad(
  p_operador uuid,
  p_tenant uuid,
  p_version text
)
returns boolean
language plpgsql
as $$
declare tocadas int;
begin
  update operador
  set aviso_privacidad_en = now(),
      aviso_privacidad_version = p_version
  where id = p_operador
    and tenant_id = p_tenant
    -- Se envía si nunca se envió, o si el texto de la flota cambió desde la
    -- última vez (art. 15 fr. VI: hay que comunicar los cambios).
    and (aviso_privacidad_en is null or aviso_privacidad_version is distinct from p_version);

  get diagnostics tocadas = row_count;
  return tocadas > 0;
end $$;

revoke all on function marcar_aviso_privacidad(uuid, uuid, text) from public, anon, authenticated;
