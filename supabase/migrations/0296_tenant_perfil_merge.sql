-- 0296 — auditoría 24, H20/H21/H22: `guardarPerfilPatch` (lib/likida/repo.ts)
-- leía `tenant.perfil`, mezclaba el patch EN JAVASCRIPT y volvía a escribir en
-- un segundo statement — un clásico "lost update". La entrevista de
-- onboarding (`ChatEntrevista`, dashboard/onboarding/chat.tsx) guarda una
-- respuesta a la vez, así que dos respuestas mandadas casi juntas (doble
-- clic, dos pestañas, o la conversación y el formulario "Prefiero el
-- formulario" tocados por dos personas de la misma flota) intercalan sus dos
-- lecturas ANTES de que cualquiera de las dos escriba: la segunda escritura
-- pisa la primera con un `perfil` que nunca vio su patch. El perfil declarado
-- por el cliente es la base del onboarding fiscal y de qué preguntas la
-- entrevista vuelve a hacer — perder una respuesta silenciosamente hace que
-- la entrevista la vuelva a preguntar (molesto) o, peor, que un patch de
-- "regimenFiscalElegible" se pierda y `actualizarFacilidad15` decida sobre un
-- valor viejo.
--
-- El arreglo es un RPC que hace la lectura Y la escritura en el MISMO
-- statement — el UPDATE lee su propio `perfil` en la misma fila, bajo el
-- lock de esa fila: dos llamadas concurrentes se serializan (la segunda
-- espera a que la primera COMMITee y parte de su resultado), en vez de
-- intercalar dos lecturas hechas en Node.
--
-- ALCANCE DE ESTA MIGRACIÓN (frontend-sis solo puede tocar `supabase/`,
-- `perfil/**` y el bloque 243 de verificaciones.sql — NO `lib/likida/repo.ts`,
-- que es de otro agente): se crea el RPC y se prueba con Postgres real
-- (bloque 243). Cambiar `guardarPerfilPatch` para llamarlo en vez de
-- leer+escribir queda anotado en CIERRE.md como pendiente del dueño de
-- `repo.ts` — el RPC es compatible hacia atrás (mismo resultado que el
-- código actual cuando no hay carrera) y no requiere ningún cambio de
-- esquema adicional para adoptarse.
create or replace function public.tenant_perfil_merge(
  p_tenant_id uuid,
  p_patch jsonb,
  p_actualizado_por uuid
)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
declare
  v_perfil jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'tenant_perfil_merge: el patch debe ser un objeto jsonb (recibido %)', jsonb_typeof(p_patch);
  end if;

  -- El `||` de jsonb es un merge SUPERFICIAL (mismo comportamiento que
  -- `{ ...actual, ...patch }` en el código actual: no se cambia la semántica
  -- de merge, solo se hace atómica). `coalesce` cubre una fila cuyo `perfil`
  -- fuera NULL — no debería pasar (`not null default '{}'` desde 0169), pero
  -- un RPC no debe asumir lo que ya garantiza una columna si el costo de no
  -- asumirlo es cero.
  update public.tenant
  set perfil = coalesce(perfil, '{}'::jsonb) || p_patch,
      perfil_actualizado_por = p_actualizado_por
  where id = p_tenant_id
  returning perfil into v_perfil;

  if not found then
    -- Fallar cerrado: un tenant que no existe (o al que RLS le niega el
    -- UPDATE — la 0078 dejó `tenant` de solo lectura por RLS, así que un rol
    -- sin service_role nunca entra aquí) no puede devolver un perfil de
    -- mentiras.
    raise exception 'tenant_perfil_merge: tenant % no encontrado o sin permiso de escritura', p_tenant_id;
  end if;

  return v_perfil;
end;
$$;

comment on function public.tenant_perfil_merge(uuid, jsonb, uuid) is
  'H20/H21/H22 (auditoría 24): mezcla un patch en tenant.perfil de forma ATÓMICA (lectura+escritura en el mismo UPDATE, bajo el lock de la fila) — reemplaza el patrón leer-en-Node/escribir-en-Node de guardarPerfilPatch (repo.ts), que perdía respuestas de la entrevista de onboarding bajo escrituras concurrentes. El trigger trg_sellar_perfil_version (0169) sigue disparando igual: es un UPDATE de tenant.perfil como cualquier otro.';

-- Solo service_role: mismo criterio que 0188 (claim/renew/complete/fail de
-- agente_mutacion) — la app SIEMPRE llama este RPC con supabaseAdmin(), y
-- `tenant` ya es de solo lectura por RLS (0078) para cualquier otro rol, así
-- que un `authenticated` que lo invocara por PostgREST directo se topa con el
-- `not found` de la RLS antes de tocar una fila ajena.
grant execute on function public.tenant_perfil_merge(uuid, jsonb, uuid) to service_role;
