-- ═══════════════════════════════════════════════════════════════════════════
-- 0147 — Cuatro candados que vivían solo en código o en un comentario
--        (auditoría 18: M13, M25 MEDIO; B10, B15 BAJO). IDEMPOTENTE.
--
-- 1) M13 · `prospecto.duplicado_de` admitía A→B→A. La 0139 solo prohíbe la
--    autorreferencia; un deduplicador que no sabe cuál es la buena marca las
--    dos y las dos pasan CHECK y FK. `idx_prospecto_vivos … where duplicado_de
--    is null` es el filtro del tablero: la empresa desaparece del censo con
--    sus toques y notas, sin rastro. Lo mismo una cadena A→B→C: A apunta a
--    una fila escondida. El invariante real no es "no te apuntes a ti mismo",
--    es "LA FILA A LA QUE APUNTO ES VISIBLE". Un trigger lo hace cumplir:
--      · apuntar a una fila que ya es copia → rebota (check_violation);
--      · marcar como copia una fila a la que otras apuntan → esas copias
--        siguen al destino nuevo (la cadena se COLAPSA en vez de esconderse).
--    Producción, 22-ago-2026: 226 copias marcadas, 0 ciclos, 1 cadena de
--    largo 2 — se colapsa aquí mismo, antes de armar el trigger.
--
-- 2) M25 · El bucket público `avatares` no tenía `file_size_limit` ni
--    `allowed_mime_types`: los candados de tipo (jpeg/png/webp) y peso (2 MB)
--    vivían SOLO en los server actions de mi-perfil. Con su access token y la
--    anon key, un `authenticated` subía x.html directo al Storage y quedaba
--    servido públicamente desde el dominio de Supabase de Likida con el
--    Content-Type que él declaró. Supabase Storage sí hace cumplir estos dos
--    campos del bucket en cada subida, incluida la directa. Los valores son
--    los mismos de `TIPOS` y `TOPE_BYTES` (dashboard/mi-perfil/page.tsx:25-26).
--
-- 3) B10 · `worker_llave.capacidades text[]` aceptaba '{}' y '{bus.piezas}'
--    (plural). La llave se guardaba "con permiso" y `llaves.ts:44` la
--    rechazaba con 403 en cada llamada, a las 3 a.m. en la Mac del bus.
--    El dominio espeja CAPACIDADES_WORKER (llaves.ts:15); una prueba en TS
--    falla si las dos listas divergen.
--
-- 4) B15 · `reservar_envio_prospecto` (0124) era la única función posterior
--    a la 0054 sin su `revoke … from public`: ejecutable con la anon key
--    desde internet. Contenida (SECURITY INVOKER + RLS deny-all en
--    prospecto_contacto), pero es la excepción al patrón que la 0098 ya pagó.
--    La llama solo `cola.ts:371` con supabaseAdmin() (service_role).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. M13: la fila a la que apunto es visible ──────────────────────────────
do $$
declare n int; v int; vueltas int := 0;
begin
  -- Un ciclo no se puede colapsar solo: nadie sabe cuál es la buena.
  select count(*) into n
    from public.prospecto a join public.prospecto b on b.id = a.duplicado_de
   where b.duplicado_de = a.id;
  if n > 0 then
    raise exception 'prospecto: % ciclo(s) A→B→A en duplicado_de. Decide cuál es la fila buena de cada par y pon NULL en la otra antes de volver a aplicar.', n;
  end if;

  -- Las cadenas sí: cada copia pasa a apuntar al destino de su destino,
  -- hasta que ninguna apunte a una fila escondida.
  loop
    update public.prospecto a
       set duplicado_de = b.duplicado_de
      from public.prospecto b
     where b.id = a.duplicado_de
       and b.duplicado_de is not null
       and b.duplicado_de <> a.id;
    get diagnostics v = row_count;
    exit when v = 0;
    vueltas := vueltas + 1;
    if vueltas > 50 then
      raise exception 'prospecto: la cadena de duplicado_de no converge en 50 vueltas — hay un ciclo largo. Revísalo a mano.';
    end if;
  end loop;
end $$;

create or replace function public.prospecto_duplicado_visible()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_destino_es_copia_de uuid; v_existe boolean;
begin
  -- La autorreferencia la rechaza el CHECK de la 0139; el id inexistente, la FK.
  -- Este trigger no los tapa: los deja llegar a su restricción.
  if new.duplicado_de is null or new.duplicado_de = new.id then
    return new;
  end if;

  select true, duplicado_de into v_existe, v_destino_es_copia_de
    from public.prospecto where id = new.duplicado_de;
  if v_existe is null then
    return new;
  end if;

  if v_destino_es_copia_de is not null then
    raise exception 'prospecto %: no puede ser copia de %, que a su vez es copia de %. Apunta a la fila BUENA (visible), o las dos desaparecen del censo.',
      new.id, new.duplicado_de, v_destino_es_copia_de
      using errcode = 'check_violation';
  end if;

  -- Las copias que apuntaban a ESTA fila siguen al destino nuevo: la cadena
  -- se colapsa en vez de esconder a quien apuntaba aquí.
  update public.prospecto
     set duplicado_de = new.duplicado_de
   where duplicado_de = new.id and id <> new.duplicado_de;

  return new;
end $$;

drop trigger if exists trg_prospecto_duplicado_visible on public.prospecto;
create trigger trg_prospecto_duplicado_visible
  before insert or update of duplicado_de on public.prospecto
  for each row execute function public.prospecto_duplicado_visible();

comment on function public.prospecto_duplicado_visible is
  'duplicado_de solo puede apuntar a una fila VISIBLE (duplicado_de is null). Rebota copia-de-copia (ciclos incluidos) y colapsa cadenas al marcar (0147, M13).';

-- ── 2. M25: el bucket hace cumplir tipo y peso ──────────────────────────────
update storage.buckets
   set file_size_limit    = 2 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatares';

-- ── 3. B10: dominio de capacidades ──────────────────────────────────────────
-- drop + add: idempotente y deja claro dónde se agrega la quinta capacidad
-- el día que exista (junto con CAPACIDADES_WORKER en llaves.ts).
alter table public.worker_llave drop constraint if exists worker_llave_capacidades_dominio;
alter table public.worker_llave add constraint worker_llave_capacidades_dominio
  check (
    cardinality(capacidades) > 0
    and capacidades <@ array['bus.latido', 'bus.pieza', 'bus.catalogo', 'bus.ordenes']::text[]
  );

comment on constraint worker_llave_capacidades_dominio on public.worker_llave is
  'Espeja CAPACIDADES_WORKER (src/lib/worker/llaves.ts). Una llave sin capacidades o con una mal escrita no se guarda "con permiso" para fallar 403 después (0147, B10).';

-- ── 4. B15: la RPC de cadencia no es pública ────────────────────────────────
revoke all on function public.reservar_envio_prospecto(uuid, uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.reservar_envio_prospecto(uuid, uuid, uuid, text, int) to service_role;
