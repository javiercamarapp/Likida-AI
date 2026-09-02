-- ═══════════════════════════════════════════════════════════════════════════
-- 0237 — CORRECTIVA DE LA 0228: LA IDEMPOTENCIA DEL ABONO ES UNA RESTRICCIÓN
--
-- La 0228 YA ESTÁ APLICADA EN PRODUCCIÓN, así que nada de lo que sigue se
-- arregla editándola: se arregla aquí. Esta migración cierra cinco defectos
-- que la auditoría adversarial del ciclo 7 encontró sobre el portal de pago y
-- el REP, todos en la superficie que más caro cuesta equivocar — una página
-- pública donde un tercero mira una cifra de dinero y decide pagarla.
--
-- IDEMPOTENTE: segura de re-correr (patrón de la 0145). Cada pieza va detrás
-- de su `if not exists` o de su `if exists`; ninguna `add constraint` pelada.
--
-- ── 1 · c7-5 (alto) · CONCILIAR DOS VECES CREABA DOS ABONOS REALES ────────
--
-- `conciliarPropuesta` preguntaba `if (fila.estado !== 'pendiente')` y DESPUÉS
-- llamaba a `registrar_pago_tx`. Entre la pregunta y el insert cabe el segundo
-- clic: dos pestañas del contralor sobre la misma propuesta de $5,000 contra un
-- saldo de $34,800 pasaban las dos —ninguna es sobrepago— y `pago_recibido`
-- terminaba con DOS abonos por UN depósito. La cartera del cliente quedaba con
-- $10,000 abonados por $5,000 depositados, y el abono huérfano había que
-- cancelarlo a mano.
--
-- Un "consulto si existe y luego inserto" no es idempotencia: es una carrera
-- con un comentario optimista encima. La idempotencia de esta casa es un
-- ÍNDICE ÚNICO PARCIAL, y aquí es `pago_recibido (propuesta_id) where
-- propuesta_id is not null`: la propuesta es la llave natural del abono que
-- nace de ella, y la base —no el orden de dos statements— es quien impide el
-- segundo. La segunda pestaña recibe un 23505 y `conciliarPropuesta` lo lee
-- como "este abono ya existe": se cuelga del que ya está y termina de sellar,
-- así que conciliar dos veces es EXACTAMENTE conciliar una vez.
--
-- `propuesta_id` es NULLABLE y lo seguirá siendo: la inmensa mayoría de los
-- abonos los teclea el contralor a mano y no nacen de ninguna propuesta. El
-- índice es parcial por eso — sin el `where`, dos pagos tecleados a mano
-- chocarían entre sí por compartir el NULL... que en Postgres no chocan, pero
-- el índice parcial además no los indexa, que es lo que se quiere.
--
-- ── 2 · c7-25 (medio) · UN REP COLGADO DEL PAGO DE OTRA FACTURA ───────────
--
-- Las FK compuestas de la 0228 garantizan que el pago y la factura sean de la
-- MISMA FLOTA, y ahí se detienen: nada impedía que `rep_emitido` apuntara a la
-- factura A y al pago de la factura C. El contralor con dos pestañas pega el
-- `pagoId` equivocado y el portal del cliente A enseña «Importe pagado
-- $12,000.00» sobre un abono que fue a otra factura, con un XML que dice otra
-- cosa. La regla de la casa dice que eso lo tienen que impedir LAS LLAVES, no
-- una convención: se añade `unique (id, factura_id, tenant_id)` a
-- `pago_recibido` y con ella dos FK de TRES columnas —de `rep_emitido` y de
-- `portal_pago_propuesta`— que hacen imposible por esquema colgar un
-- complemento (o una conciliación) del pago de otra factura.
--
-- ── 3 · c7-18 (medio) · UN PAGO DESCARTADO SE RE-REGISTRABA COMO «YA ESTÁ» ─
--
-- `portal_pago_propuesta_unica` era `(liga_id, fecha, monto, referencia)` SIN
-- filtrar por estado. Dos consecuencias, las dos mentiras hacia el cliente:
--   · el contralor descarta una propuesta; el cliente revisa su banco, ve que
--     sí pagó y vuelve a registrar lo mismo → 23505 → la ruta le contesta «Ese
--     pago ya estaba registrado… No hace falta hacer nada más». Es falso: está
--     DESCARTADO, no registrado, y no volverá a la bandeja de nadie;
--   · la unicidad era por LIGA, no por FACTURA. Revocar la liga y generar otra
--     —el flujo normal cuando el link se pierde— dejaba entrar la misma
--     referencia otra vez: dos propuestas idénticas en la bandeja.
-- El índice pasa a ser PARCIAL sobre las pendientes y anclado a la FACTURA.
--
-- ── 4 · c7-15 (medio, latente-alto) · EL ÍNDICE QUE SOSTIENE LA RUTA PÚBLICA ─
--
-- `resolverLiga` busca por `token_prefijo` en CADA visita de `/pago/<token>`,
-- en cada POST de `/api/pago/registrar` y en cada descarga del complemento. No
-- había un solo índice que empezara por esa columna: cada visita era un seq
-- scan de `portal_pago_liga` —y un prefijo inexistente, que es el caso de todo
-- token inventado, no se beneficia del `limit 20`. La ironía del esquema era
-- que la columna que NO necesita índice de búsqueda (`token_hash`, que se
-- compara en tiempo constante ya con las candidatas en la mano) tenía único, y
-- la que sí, no.
--
-- ── LO QUE NO SE PUDO ARREGLAR CON UN ÍNDICE, Y DÓNDE QUEDÓ ───────────────
--
-- c7-26 (una liga CADUCADA ocupa el lugar de la viva en
-- `portal_pago_liga_viva_unica`, y el contralor recibe «esa factura ya tiene
-- un enlace vigente» sobre un cadáver) NO se arregla aquí, y no por olvido:
-- el predicado tendría que ser `revocada_en is null and expira_en > now()`, y
-- `now()` no es IMMUTABLE — Postgres rechaza un índice parcial que dependa del
-- reloj, y con razón: el conjunto indexado cambiaría solo, sin escritura que lo
-- provoque. Se cierra en `crearLigaPago`, que revoca la liga caducada antes de
-- insertar la nueva y lo deja anotado en la bitácora. Ver ahí el porqué.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `pago_recibido.propuesta_id`: la llave de idempotencia del abono ────
alter table public.pago_recibido
  add column if not exists propuesta_id uuid;

comment on column public.pago_recibido.propuesta_id is
  'La propuesta del portal de pago (0228) de la que nació este abono, o NULL si lo tecleó el contralor a mano (que es el caso de la inmensa mayoría). Es la LLAVE DE IDEMPOTENCIA de la conciliación: el índice único parcial de la 0237 es lo que impide que conciliar dos veces la misma propuesta —dos pestañas, un doble clic con latencia— cree DOS abonos reales por UN solo depósito. Antes eso lo cuidaba un `if` previo en TypeScript, que es una carrera con un comentario optimista encima.';

do $$
begin
  -- `portal_pago_propuesta` estrena su `unique (id, tenant_id)`: nunca había
  -- sido DESTINO de una FK y por eso la 0228 no se lo puso. Ahora lo es, y la
  -- regla de la 0028/0145 exige la compuesta del lado del destino.
  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_propuesta_id_tenant_key'
      and conrelid = 'public.portal_pago_propuesta'::regclass
  ) then
    alter table public.portal_pago_propuesta
      add constraint portal_pago_propuesta_id_tenant_key unique (id, tenant_id);
  end if;

  -- La FK compuesta con su tenant, patrón 0028/0145. `set null (propuesta_id)`
  -- CON LISTA DE COLUMNAS: `set null` a secas anularía también `tenant_id`, que
  -- es NOT NULL, y reventaría el DELETE — es el hueco que la 0028 declaró por
  -- escrito y la 0145 cerró. Producción corre PostgreSQL 17.
  --
  -- Y `set null` y no `cascade`: si la propuesta desapareciera, el abono de
  -- verdad NO se borra detrás de ella. Es dinero que entró al banco; lo que se
  -- pierde es su llave de idempotencia, no el hecho.
  if not exists (
    select 1 from pg_constraint
    where conname = 'pago_recibido_propuesta_tenant_fkey'
      and conrelid = 'public.pago_recibido'::regclass
  ) then
    alter table public.pago_recibido
      add constraint pago_recibido_propuesta_tenant_fkey
      foreign key (propuesta_id, tenant_id)
      references public.portal_pago_propuesta (id, tenant_id)
      on delete set null (propuesta_id);
  end if;
end $$;

-- UN abono por propuesta. Parcial porque `propuesta_id` es NULL en todos los
-- pagos tecleados a mano y esos no compiten por nada.
create unique index if not exists pago_recibido_propuesta_unica
  on public.pago_recibido (propuesta_id)
  where propuesta_id is not null;

-- ── 2. `registrar_pago_tx` recibe la propuesta y la escribe EN EL MISMO INSERT ──
--
-- El séptimo parámetro tiene DEFAULT null: los cinco llamadores que registran
-- un pago tecleado a mano no cambian ni una línea, y PostgREST resuelve la
-- llamada por nombre igual que antes. Hay que DROPear la versión de seis
-- argumentos: `create or replace` no puede añadir un parámetro (crearía una
-- segunda función y la llamada de seis quedaría ambigua).
--
-- Todo lo demás es LA MISMA función de la 0159, letra por letra: el `for
-- update` sobre la factura, la suma de pagos con la fila trabada, las cuatro
-- reglas en el mismo orden y el sello de `pagada` en la misma transacción. Lo
-- único nuevo es la columna que viaja en el insert — y por eso el 23505 del
-- índice de arriba sale de DENTRO de la transacción que traba la factura, que
-- es exactamente donde la carrera vivía.
drop function if exists public.registrar_pago_tx(uuid, uuid, date, numeric, text, text);

create or replace function public.registrar_pago_tx(
  p_tenant     uuid,
  p_factura    uuid,
  p_fecha      date,
  p_monto      numeric,
  p_metodo     text,
  p_referencia text,
  p_propuesta  uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total   numeric;
  v_estatus text;
  v_pagado  numeric;
  v_saldo   numeric;
  v_salda   boolean;
  v_pago    uuid;
begin
  -- El tenant SIEMPRE en el where: el id de una factura ajena no puede abrir
  -- la puerta ni para trabarla.
  select total, estatus into v_total, v_estatus
    from factura_emitida
   where id = p_factura and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'factura % fuera de la flota %', p_factura, p_tenant
      using errcode = 'CU010';
  end if;

  -- Ya con la fila trabada: nadie más puede estar insertando un pago sobre
  -- ESTA factura mientras se suma.
  select coalesce(sum(monto), 0) into v_pagado
    from pago_recibido
   where factura_id = p_factura and tenant_id = p_tenant;

  v_saldo := round(v_total - v_pagado, 2);

  -- Las cuatro reglas, en el MISMO orden que `evaluarAbono` (TS) — el orden
  -- importa: una factura cancelada Y sobrepagada tiene que decir "cancelada".
  if v_estatus = 'cancelada' then
    raise exception 'motivo=cancelada saldo=%', v_saldo using errcode = 'CU011';
  elsif v_estatus = 'borrador' then
    raise exception 'motivo=borrador saldo=%', v_saldo using errcode = 'CU011';
  elsif v_estatus = 'pagada' then
    raise exception 'motivo=pagada saldo=%', v_saldo using errcode = 'CU011';
  elsif p_monto > v_saldo + 0.005 then
    raise exception 'motivo=sobrepago saldo=%', v_saldo using errcode = 'CU011';
  end if;

  v_salda := p_monto >= v_saldo - 0.005;

  -- `propuesta_id` entra AQUÍ y no en un UPDATE posterior: si se sellara
  -- después, entre el insert y el sello volvería a caber la segunda pestaña y
  -- el índice único no habría servido de nada.
  insert into pago_recibido (tenant_id, factura_id, fecha, monto, metodo, referencia, propuesta_id)
  values (p_tenant, p_factura, coalesce(p_fecha, current_date), p_monto, p_metodo, p_referencia, p_propuesta)
  returning id into v_pago;

  if v_salda then
    update factura_emitida set estatus = 'pagada'
     where id = p_factura and tenant_id = p_tenant and estatus = 'emitida';
  end if;

  return jsonb_build_object(
    'pago_id', v_pago,
    'saldo_previo', v_saldo,
    'saldada', v_salda
  );
end $$;

comment on function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text, uuid) is
  'Registra un abono con la factura TRABADA (for update): la suma de pagos, la decisión de dinero y el insert ocurren en una transacción. Sin esto, dos abonos simultáneos ven los dos el mismo saldo y la factura queda sobrepagada — `factura_saldo` en negativo, en silencio (DAT-05). Desde la 0237 acepta `p_propuesta`: la propuesta del portal que originó el abono, que el índice único parcial `pago_recibido_propuesta_unica` convierte en llave de idempotencia — conciliar dos veces la misma propuesta crea UN abono, y la segunda sesión recibe 23505 en vez de duplicar el dinero del cliente.';

-- Solo service_role. El `revoke from public` NO basta: Supabase concede EXECUTE
-- explícito a anon/authenticated por default privileges (lección de la 0013).
revoke execute on function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text, uuid) from public, anon, authenticated;
grant  execute on function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text, uuid) to service_role;

-- ── 3. El REP y la conciliación no se pueden colgar del pago de OTRA factura ──
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pago_recibido_id_factura_tenant_key'
      and conrelid = 'public.pago_recibido'::regclass
  ) then
    alter table public.pago_recibido
      add constraint pago_recibido_id_factura_tenant_key unique (id, factura_id, tenant_id);
  end if;

  -- Un complemento de pago ampara UN abono de LA factura que dice amparar. Con
  -- dos columnas esto era una convención escrita en un comentario; con tres es
  -- una llave.
  if not exists (
    select 1 from pg_constraint
    where conname = 'rep_emitido_pago_factura_tenant_fkey'
      and conrelid = 'public.rep_emitido'::regclass
  ) then
    alter table public.rep_emitido
      add constraint rep_emitido_pago_factura_tenant_fkey
      foreign key (pago_id, factura_id, tenant_id)
      references public.pago_recibido (id, factura_id, tenant_id)
      on delete restrict;
  end if;

  -- Lo mismo para la propuesta conciliada: el abono al que apunta tiene que ser
  -- de SU factura. Sin esto, un `pago_id` equivocado dejaría una propuesta
  -- "conciliada" cuyo dinero se aplicó a otro papel.
  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_pago_propuesta_pago_factura_tenant_fkey'
      and conrelid = 'public.portal_pago_propuesta'::regclass
  ) then
    alter table public.portal_pago_propuesta
      add constraint portal_pago_propuesta_pago_factura_tenant_fkey
      foreign key (pago_id, factura_id, tenant_id)
      references public.pago_recibido (id, factura_id, tenant_id)
      on delete restrict;
  end if;
end $$;

-- ── 4. La propuesta repetida: solo las PENDIENTES compiten, y por FACTURA ──
drop index if exists public.portal_pago_propuesta_unica;

create unique index if not exists portal_pago_propuesta_unica_pendiente
  on public.portal_pago_propuesta (factura_id, fecha, monto, upper(btrim(referencia)))
  where estado = 'pendiente';

comment on index public.portal_pago_propuesta_unica_pendiente is
  'IDEMPOTENCIA DE LA BANDEJA, corregida por la 0237. Parcial sobre las PENDIENTES: una propuesta ya DESCARTADA no bloquea que el cliente vuelva a registrar el mismo depósito — antes chocaba contra el índice y la página le contestaba «ya estaba registrado, no hace falta hacer nada más», que era falso y lo dejaba sin bandeja donde caer. Y anclado a la FACTURA y no a la LIGA: revocar el enlace y generar otro es el flujo normal cuando el link se pierde, y con la llave por liga la misma referencia entraba dos veces.';

-- ── 5. El índice que la ruta pública necesitaba desde el primer día ────────
create index if not exists portal_pago_liga_prefijo_idx
  on public.portal_pago_liga (token_prefijo);

comment on index public.portal_pago_liga_prefijo_idx is
  'La ruta pública /pago/<token> resuelve por PREFIJO y compara el sha256 en tiempo constante contra las candidatas. Sin este índice cada visita —y cada token inventado por un bot, que es el caso que no se beneficia del limit— era un seq scan de la tabla de TODAS las flotas. El único de portal_pago_liga que empieza por esta columna.';
