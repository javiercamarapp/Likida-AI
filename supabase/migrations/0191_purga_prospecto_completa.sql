-- AUDITORÍA 19 (legal C4, CRÍTICO): `purgar_prospecto_persona` (0148) solo
-- nulificaba `contacto_nombre` — dejaba `telefono`, `correo`, `notas` y
-- `lead_clave` (que la 0181 documenta como "correo O empresa": en un lead
-- del CRM público puede ser literalmente el correo) intactos en la MISMA
-- fila que el propio comentario de la 0148 llama "la misma clase de dato".
-- El aviso de retención promete borrado de la persona; el código borraba
-- una cuarta parte de ella.
--
-- Dos correcciones, misma función, mismo `security definer`:
--
--   1. El UPDATE ahora nulifica los CUATRO campos de la persona
--      (contacto_nombre, telefono, correo, notas, lead_clave) — no solo el
--      nombre. `empresa`/`ciudad`/`vacante`/`estado` se QUEDAN a propósito:
--      son datos del NEGOCIO (la empresa), no de la persona identificada —
--      LFPDPPP protege personas, no razones sociales — y el CRM sigue
--      necesitando saber qué empresas ya se tocaron.
--   2. La condición para decidir SI purgar una fila pasa de
--      `contacto_nombre is not null` a "algún campo de persona sigue con
--      dato" — un prospecto sembrado por el censo con teléfono/correo pero
--      SIN nombre de contacto capturado antes NUNCA se purgaba (el UPDATE
--      nunca la tocaba porque su única condición era sobre un campo que ya
--      era NULL desde el alta).

create or replace function public.purgar_prospecto_persona(
  p_dias integer default 365,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  borradas bigint;
  limite timestamptz := p_ahora - make_interval(days => p_dias);
begin
  -- Un prospecto FRÍO: sin trato vivo y sin toque dentro del plazo. Se
  -- evalúa en línea (sin tabla temporal: una función que se llama desde un
  -- cron no debe depender de planes cacheados sobre relaciones temporales).
  delete from public.prospecto_persona pp
   using public.prospecto p
   where p.id = pp.prospecto_id
     and p.estado in ('nuevo', 'contactado', 'perdido')
     and p.created_at < limite
     and pp.created_at < limite
     and (pp.conservar_hasta is null or pp.conservar_hasta < p_ahora)
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     );
  get diagnostics borradas = row_count;

  -- Los datos de la PERSONA en la fila del prospecto — nombre, teléfono,
  -- correo, notas y la clave del CRM cuando trae el correo. `empresa` y el
  -- resto del negocio se quedan: no son datos de una persona identificada.
  update public.prospecto p
     set contacto_nombre = null, telefono = null, correo = null, notas = null,
         lead_clave = null, updated_at = p_ahora
   where p.estado in ('nuevo', 'contactado', 'perdido')
     and p.created_at < limite
     and (p.contacto_nombre is not null or p.telefono is not null
          or p.correo is not null or p.notas is not null or p.lead_clave is not null)
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     );

  return borradas;
end;
$$;

comment on function public.purgar_prospecto_persona is
  'Freno explícito a la purga por inactividad (0148, ampliada por la 0191): NULL = regla general (365 días sin toque); una fecha = no se borra antes de ella. Para ARCO en curso o una cita futura pactada con la persona. Nulifica contacto_nombre/telefono/correo/notas/lead_clave — no solo el nombre.';

revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from public;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from anon;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from authenticated;
grant execute on function public.purgar_prospecto_persona(integer, timestamptz) to service_role;
