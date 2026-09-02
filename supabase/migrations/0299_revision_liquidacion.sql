-- ═══════════════════════════════════════════════════════════════════════════
-- 0299 — REVISIÓN HUMANA DE LA LIQUIDACIÓN: aprobar / ajustar / rechazar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- AUDITORÍA 24, BLOQUEANTE 6 (producto-completitud §18 + FE-5 + FE-11 + WA-3 +
-- DAT-6). La promesa del producto es «el agente cuadra, tú firmas lo que no».
-- Hasta hoy la firma no existía: cero `.update` sobre `liquidacion` en `src/`
-- (el único UPDATE SQL era el contador de descargas de la 0114). La cola
-- «Esperan tu revisión» crecía para siempre, el CSV y la póliza exportaban
-- liquidaciones que nadie había mirado, y una lectura nítida pero mal
-- ($8,000 → $800, WA-3) no tenía ningún camino para corregirse: el chofer
-- no, el panel tampoco.
--
-- LO QUE ESTA MIGRACIÓN AGREGA
--
--  1. `liquidacion.revision` — `pendiente | aprobada | ajustada | rechazada` —
--     con quién (`revisada_por` + su correo, que sobrevive a la baja del
--     usuario), cuándo, el motivo y los ajustes persistidos.
--
--  2. `revisar_liquidacion(...)`: la ÚNICA puerta para cambiar la revisión.
--     Transaccional, `security definer`, con el candado del viaje ANTES que el
--     de la liquidación (el mismo orden que `guardar_liquidacion_tx` y el
--     trigger de la 0036 — al revés se puede abrazar en deadlock con un cierre
--     en vuelo). Valida el estado, persiste ajustes de monto sobre `gasto`
--     (delta aritmético sobre el total: NO re-cuadra — un segundo motor en SQL
--     sería «dos cálculos»), reabre a `en_cuadre` al rechazar, y deja
--     bitácora en la misma transacción.
--
--  3. Tres reglas en la tabla, para que la revisión no dependa de que todo
--     pase por la RPC (la lección de DAT-6):
--     · una liquidación que CUADRÓ SOLA queda firme sin humano (`aprobada`
--       con `revisada_por` NULL = el motor): «tú firmas lo que NO cuadró»;
--     · un re-cierre del motor (upsert de `guardar_liquidacion_tx`) que cambia
--       las cifras RETIRA la firma anterior — lo firmado ya no es lo que dice
--       la fila;
--     · cambiar la revisión por fuera de la RPC rebota (LR003).
--
--  4. Coherencia `viaje.estatus` ↔ `liquidacion.revision` como constraint
--     trigger DIFERIDO (se comprueba al commit, así `reabrir_viaje_tx` —que
--     pone el viaje `abierto` y DESPUÉS borra la liquidación— sigue
--     funcionando): un viaje `liquidado` no convive con una liquidación
--     `rechazada`, y una liquidación firmada por una PERSONA no convive con un
--     viaje que alguien devolvió a `abierto`/`en_cuadre` con un UPDATE suelto
--     (el S9 de DAT-6). La forma amplia de DAT-6 («liquidado ⇔ existe
--     liquidación») NO se impone aquí: 21 bloques de verificaciones.sql
--     insertan liquidaciones sin cerrar el viaje y la impondría rompiendo la
--     batería. Queda anotado.
--
--  5. `gasto_no_tras_liquidar()` (0036/0037, cuerpo de la 0036 con el
--     search_path de la 0074) aprende dos cosas: una liquidación RECHAZADA no
--     es «emitida» (el chofer tiene que poder mandar el ticket bueno), y la
--     RPC de revisión puede corregir `gasto.monto` dentro de su transacción
--     (GUC `likida.revision_en_curso`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ─────────────────────────────────────────────────────────────
alter table public.liquidacion
  add column if not exists revision           text not null default 'pendiente',
  add column if not exists revisada_por       uuid references public.app_user(id) on delete set null,
  add column if not exists revisada_por_email text,
  add column if not exists revisada_en        timestamptz,
  add column if not exists motivo             text,
  add column if not exists ajustes            jsonb;

comment on column public.liquidacion.revision is
  'pendiente | aprobada | ajustada | rechazada. Solo la cambia revisar_liquidacion(); una liquidación que cuadró sola nace `aprobada` con revisada_por NULL (= el motor). Un re-cierre que cambia cifras la devuelve a pendiente/aprobada-motor (0299).';
comment on column public.liquidacion.revisada_por is
  'Quién firmó. NULL con revision<>pendiente = la firmó el motor (cuadró sola). El correo se copia aparte para sobrevivir a la baja del usuario.';
comment on column public.liquidacion.ajustes is
  'Arreglo de {gasto_id, concepto, monto_anterior, monto_nuevo} que la persona aplicó al ajustar. El total se movió por la suma de las deltas; `diferencias` sigue siendo la del cuadre original.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_revision_dominio') then
    alter table public.liquidacion add constraint liquidacion_revision_dominio
      check (revision in ('pendiente', 'aprobada', 'ajustada', 'rechazada'));
  end if;
  -- Una firma sin fecha, o una pendiente con firma, es una fila que miente.
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_revision_firma') then
    alter table public.liquidacion add constraint liquidacion_revision_firma
      check (
        (revision = 'pendiente' and revisada_en is null and revisada_por is null
           and revisada_por_email is null and ajustes is null)
        or (revision <> 'pendiente' and revisada_en is not null)
      );
  end if;
  -- Rechazar o ajustar sin decir por qué no es una revisión: es un botón.
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_revision_motivo') then
    alter table public.liquidacion add constraint liquidacion_revision_motivo
      check (revision not in ('rechazada', 'ajustada') or nullif(btrim(motivo), '') is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_ajustes_arreglo') then
    alter table public.liquidacion add constraint liquidacion_ajustes_arreglo
      check (ajustes is null or jsonb_typeof(ajustes) = 'array');
  end if;
end $$;

-- La cola por antigüedad (`revision='pendiente'`, más vieja primero) y el
-- listado por llave de /v1/liquidaciones filtrando por revisión: el ORDER BY
-- completo, en las dos direcciones.
create index if not exists liquidacion_tenant_revision_idx
  on public.liquidacion (tenant_id, revision, created_at, id);

-- ── 2. Las que ya cuadraron solas quedan firmes; el resto, pendientes ───────
update public.liquidacion
   set revision = 'aprobada',
       revisada_en = created_at,
       motivo = 'Cuadró sola: sin diferencias'
 where revision = 'pendiente' and estatus = 'cuadrada';

-- ── 3. Reglas en la tabla ───────────────────────────────────────────────────
create or replace function public.liquidacion_revision_regla()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare en_rpc boolean := coalesce(current_setting('likida.revision_en_curso', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    -- Nace pendiente o nace firmada por el motor. Nunca nace firmada por
    -- una persona: eso solo lo hace la RPC, después.
    if new.revision <> 'pendiente' and not en_rpc then
      raise exception 'la liquidación nace pendiente de revisión: la firma se pone con revisar_liquidacion(...)'
        using errcode = 'LR003';
    end if;
    if new.revision = 'pendiente' and new.estatus = 'cuadrada' then
      new.revision := 'aprobada';
      new.revisada_por := null;
      new.revisada_por_email := null;
      new.revisada_en := now();
      new.motivo := 'Cuadró sola: sin diferencias';
      new.ajustes := null;
    end if;
    return new;
  end if;

  if en_rpc then
    return new;
  end if;

  if (new.total_comprobado, new.total_anticipo, new.diferencia, new.estatus, new.diferencias)
     is distinct from
     (old.total_comprobado, old.total_anticipo, old.diferencia, old.estatus, old.diferencias) then
    -- Re-cierre del motor: lo que se había firmado ya no es lo que dice la
    -- fila. La firma se retira; si cuadró sola, queda firme por el motor.
    if new.estatus = 'cuadrada' then
      new.revision := 'aprobada';
      new.revisada_en := now();
      new.motivo := 'Cuadró sola: sin diferencias';
    else
      new.revision := 'pendiente';
      new.revisada_en := null;
      new.motivo := null;
    end if;
    new.revisada_por := null;
    new.revisada_por_email := null;
    new.ajustes := null;
    return new;
  end if;

  if (new.revision, new.revisada_por, new.revisada_por_email, new.revisada_en, new.motivo, new.ajustes)
     is distinct from
     (old.revision, old.revisada_por, old.revisada_por_email, old.revisada_en, old.motivo, old.ajustes) then
    raise exception 'la revisión de la liquidación % solo se cambia con revisar_liquidacion(...): un UPDATE suelto no deja rastro de quién firmó', old.id
      using errcode = 'LR003';
  end if;
  return new;
end $$;

comment on function public.liquidacion_revision_regla() is
  '0299. Una liquidación nace pendiente (o firme por el motor si cuadró sola); un re-cierre que cambia cifras retira la firma; la revisión solo cambia dentro de revisar_liquidacion() (GUC likida.revision_en_curso). LR003 = intento por fuera.';

drop trigger if exists trg_liquidacion_revision_regla on public.liquidacion;
create trigger trg_liquidacion_revision_regla
  before insert or update on public.liquidacion
  for each row execute function public.liquidacion_revision_regla();

-- ── 4. Coherencia viaje.estatus ↔ liquidacion.revision (DAT-6, forma acotada) ─
create or replace function public.viaje_revision_coherente()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_viaje uuid;
  v_estatus text;
  v_rev text;
  v_humano boolean;
begin
  -- Dos `if`, no un `case`: plpgsql resuelve `new.viaje_id` contra la fila
  -- REAL, y la de `viaje` no tiene ese campo aunque la rama no se tome.
  if tg_table_name = 'viaje' then
    v_viaje := new.id;
  else
    v_viaje := new.viaje_id;
  end if;
  -- Se relee TODO al momento del commit: la fila que disparó el trigger pudo
  -- haberse borrado (reabrir_viaje_tx) o cambiado después.
  select estatus into v_estatus from viaje where id = v_viaje;
  if v_estatus is null then
    return null;
  end if;
  select revision, (revisada_por is not null or revisada_por_email is not null)
    into v_rev, v_humano
    from liquidacion where viaje_id = v_viaje;
  if v_rev is null then
    return null;
  end if;

  if v_rev = 'rechazada' and v_estatus = 'liquidado' then
    raise exception 'el viaje % está liquidado y su liquidación está rechazada: una de las dos miente', v_viaje
      using errcode = '23514';
  end if;
  if v_rev in ('aprobada', 'ajustada') and v_humano and v_estatus <> 'liquidado' then
    raise exception 'el viaje % tiene una liquidación firmada por una persona y no está liquidado: reabrirlo es reabrir_viaje_tx, no un UPDATE de estatus', v_viaje
      using errcode = '23514';
  end if;
  return null;
end $$;

comment on function public.viaje_revision_coherente() is
  'DAT-6 (0299), forma acotada a la revisión: liquidado ⇏ rechazada; firmada por persona ⇒ liquidado. Diferido al commit para que reabrir_viaje_tx (abre el viaje y LUEGO retira la liquidación) siga funcionando.';

drop trigger if exists trg_liquidacion_revision_coherente on public.liquidacion;
create constraint trigger trg_liquidacion_revision_coherente
  after insert or update of revision, revisada_por, revisada_por_email on public.liquidacion
  deferrable initially deferred
  for each row execute function public.viaje_revision_coherente();

drop trigger if exists trg_viaje_revision_coherente on public.viaje;
create constraint trigger trg_viaje_revision_coherente
  after update of estatus on public.viaje
  deferrable initially deferred
  for each row execute function public.viaje_revision_coherente();

-- ── 5. Una liquidación RECHAZADA no es «emitida» para los gastos ───────────
-- Cuerpo de la 0036 (misma firma, mismo candado, mismo CU001) con el
-- search_path que le fijó la 0074. Dos cambios: la liquidación rechazada no
-- cierra la puerta (el chofer manda el ticket bueno y el motor re-cuadra), y
-- la RPC de revisión puede tocar `gasto.monto` dentro de su transacción.
create or replace function public.gasto_no_tras_liquidar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare ya boolean;
begin
  if coalesce(current_setting('likida.revision_en_curso', true), '') = '1' then
    return new;
  end if;

  -- Serializa contra el cierre. No se usa el valor: se usa el candado.
  perform 1 from viaje where id = new.viaje_id for update;

  select exists (select 1 from liquidacion where viaje_id = new.viaje_id and revision <> 'rechazada') into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: el gasto llegó tarde', new.viaje_id
      using errcode = 'CU001';
  end if;
  return new;
end $$;

comment on function public.gasto_no_tras_liquidar() is
  'Impide agregar o editar gastos de un viaje cuya liquidación YA se emitió (CU001). Desde la 0299 una liquidación RECHAZADA no cuenta como emitida, y revisar_liquidacion() puede corregir montos dentro de su transacción. Ver 0036/0037.';

-- ── 6. La RPC ───────────────────────────────────────────────────────────────
create or replace function public.revisar_liquidacion(
  p_tenant      uuid,
  p_liquidacion uuid,
  p_accion      text,
  p_motivo      text  default null,
  p_ajustes     jsonb default null,
  p_actor       uuid  default null,
  p_actor_email text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_viaje     viaje%rowtype;
  v_liq       liquidacion%rowtype;
  v_email     text;
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_aj        jsonb;
  v_gasto     gasto%rowtype;
  v_nuevo     numeric;
  v_delta     numeric := 0;
  v_ajustes   jsonb := '[]'::jsonb;
  v_excluido  boolean;
  v_telefono  text;
  v_accion    text;
begin
  if p_accion not in ('aprobar', 'ajustar', 'rechazar') then
    raise exception 'acción desconocida: % (aprobar | ajustar | rechazar)', p_accion
      using errcode = 'LR001';
  end if;

  -- EL VIAJE PRIMERO, LUEGO LA LIQUIDACIÓN. Es el orden de guardar_liquidacion_tx
  -- y del trigger de la 0036; tomarlos al revés puede abrazarse con un cierre
  -- en vuelo. `for update of v` traba solo el viaje aquí.
  select v.* into v_viaje
    from viaje v
    join liquidacion l on l.viaje_id = v.id
   where l.id = p_liquidacion and l.tenant_id = p_tenant and v.tenant_id = p_tenant
     for update of v;
  if not found then
    raise exception 'la liquidación % no existe o no es de la flota %', p_liquidacion, p_tenant
      using errcode = 'LR002';
  end if;

  select l.* into v_liq from liquidacion l where l.id = p_liquidacion for update;

  if v_liq.revision = 'rechazada' then
    raise exception 'la liquidación % ya está rechazada: espera a que el motor vuelva a cuadrar el viaje', p_liquidacion
      using errcode = 'LR011';
  end if;
  if v_liq.revision <> 'pendiente' and (v_liq.revisada_por is not null or v_liq.revisada_por_email is not null) then
    raise exception 'la liquidación % ya fue revisada (%) por % el %: no se firma dos veces', p_liquidacion, v_liq.revision,
      coalesce(v_liq.revisada_por_email, v_liq.revisada_por::text), v_liq.revisada_en
      using errcode = 'LR010';
  end if;
  if v_viaje.estatus <> 'liquidado' then
    raise exception 'el viaje % no está liquidado (%): no hay cierre que firmar', v_viaje.id, v_viaje.estatus
      using errcode = 'LR012';
  end if;
  if p_accion in ('ajustar', 'rechazar') and v_motivo is null then
    raise exception 'ajustar o rechazar exige un motivo escrito' using errcode = 'LR013';
  end if;

  -- Quién firma: el correo se copia para que sobreviva a la baja del usuario.
  if p_actor is not null then
    select email into v_email from app_user where id = p_actor;
  end if;
  v_email := coalesce(v_email, nullif(btrim(coalesce(p_actor_email, '')), ''));
  if p_actor is null and v_email is null then
    raise exception 'la revisión la firma una persona: falta el actor' using errcode = 'LR014';
  end if;

  -- Desde aquí, los triggers de la tabla saben que es la RPC la que escribe.
  perform set_config('likida.revision_en_curso', '1', true);

  if p_accion = 'ajustar' then
    if p_ajustes is null or jsonb_typeof(p_ajustes) <> 'array' or jsonb_array_length(p_ajustes) = 0 then
      raise exception 'ajustar exige al menos un ajuste [{gastoId, montoNuevo}]' using errcode = 'LR015';
    end if;
    for v_aj in select * from jsonb_array_elements(p_ajustes) loop
      if jsonb_typeof(v_aj) <> 'object' or (v_aj ->> 'gastoId') is null or (v_aj ->> 'montoNuevo') is null then
        raise exception 'cada ajuste es {gastoId, montoNuevo}: %', v_aj using errcode = 'LR015';
      end if;
      begin
        v_nuevo := round((v_aj ->> 'montoNuevo')::numeric, 2);
      exception when others then
        raise exception 'montoNuevo no es un número: %', v_aj ->> 'montoNuevo' using errcode = 'LR016';
      end;
      if v_nuevo is null or v_nuevo <= 0 or v_nuevo > 1000000 then
        raise exception 'el monto ajustado tiene que ser mayor a cero y menor a un millón: %', v_nuevo
          using errcode = 'LR016';
      end if;

      select g.* into v_gasto from gasto g
       where g.id = (v_aj ->> 'gastoId')::uuid and g.viaje_id = v_liq.viaje_id and g.tenant_id = p_tenant
         for update;
      if not found then
        raise exception 'el comprobante % no es de este viaje', v_aj ->> 'gastoId' using errcode = 'LR017';
      end if;
      if v_gasto.monto = v_nuevo then
        raise exception 'el comprobante % ya tiene ese monto (%): no hay ajuste que aplicar', v_gasto.id, v_nuevo
          using errcode = 'LR018';
      end if;
      -- Un comprobante que el motor EXCLUYÓ del total (duplicado o monto
      -- inválido) no suma: moverle el monto no movería el total, y la delta
      -- afirmaría lo contrario.
      select exists (
        select 1 from jsonb_array_elements(coalesce(v_liq.diferencias, '[]'::jsonb)) d
         where d ->> 'gastoId' = v_gasto.id::text and d ->> 'tipo' in ('duplicado', 'monto_invalido')
      ) into v_excluido;
      if v_excluido then
        raise exception 'el comprobante % está fuera del total (duplicado o monto inválido): no se ajusta, se rechaza la liquidación', v_gasto.id
          using errcode = 'LR019';
      end if;

      update gasto set monto = v_nuevo where id = v_gasto.id;
      v_delta := v_delta + (v_nuevo - v_gasto.monto);
      v_ajustes := v_ajustes || jsonb_build_object(
        'gasto_id', v_gasto.id, 'concepto', v_gasto.concepto,
        'monto_anterior', v_gasto.monto, 'monto_nuevo', v_nuevo);
    end loop;

    update liquidacion
       set total_comprobado = total_comprobado + v_delta,
           diferencia       = diferencia - v_delta,
           revision = 'ajustada', revisada_por = p_actor, revisada_por_email = v_email,
           revisada_en = now(), motivo = v_motivo, ajustes = v_ajustes
     where id = p_liquidacion;
    v_accion := 'liquidacion.ajustada';

  elsif p_accion = 'aprobar' then
    update liquidacion
       set revision = 'aprobada', revisada_por = p_actor, revisada_por_email = v_email,
           revisada_en = now(), motivo = v_motivo, ajustes = null
     where id = p_liquidacion;
    v_accion := 'liquidacion.aprobada';

  else
    update liquidacion
       set revision = 'rechazada', revisada_por = p_actor, revisada_por_email = v_email,
           revisada_en = now(), motivo = v_motivo, ajustes = null
     where id = p_liquidacion;
    -- Vuelve a cuadre: el chofer puede mandar el ticket bueno (la 0036 ya no
    -- cuenta esta liquidación como emitida) y el próximo cierre del motor la
    -- devuelve a pendiente. Si el operador ya trae otro viaje abierto,
    -- uq_viaje_abierto_por_operador rebota con 23505 y NADA de esto queda.
    update viaje set estatus = 'en_cuadre' where id = v_viaje.id;
    v_accion := 'liquidacion.rechazada';
  end if;

  insert into bitacora_auditoria (tenant_id, actor_id, actor_email, accion, entidad, entidad_id, detalle)
  values (p_tenant, p_actor, v_email, v_accion, 'liquidacion', p_liquidacion::text,
          jsonb_build_object('viaje_id', v_viaje.id, 'folio', v_viaje.folio, 'motivo', v_motivo,
                             'ajustes', case when p_accion = 'ajustar' then v_ajustes else null end,
                             'delta', case when p_accion = 'ajustar' then v_delta else null end));

  select o.telefono into v_telefono from operador o where o.id = v_viaje.operador_id;
  select l.* into v_liq from liquidacion l where l.id = p_liquidacion;

  -- La bandera se apaga ANTES de salir: `set_config(..., true)` dura toda la
  -- transacción, y si quien llama encadena un re-cierre en la misma (una
  -- prueba, un script de soporte), los triggers de arriba lo tomarían por la
  -- RPC y no retirarían la firma.
  perform set_config('likida.revision_en_curso', '', true);

  return jsonb_build_object(
    'revision', v_liq.revision,
    'viaje_id', v_viaje.id,
    'folio', v_viaje.folio,
    'total_comprobado', v_liq.total_comprobado,
    'diferencia', v_liq.diferencia,
    'ajustes', v_liq.ajustes,
    'operador_telefono', v_telefono
  );
end $$;

comment on function public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text) is
  'La firma humana de la liquidación (0299): aprobar, ajustar ([{gastoId, montoNuevo}] → gasto.monto y el total por delta, sin re-cuadrar) o rechazar (viaje vuelve a en_cuadre). Candado del viaje antes que el de la liquidación; una revisada por persona no se firma dos veces (LR010); deja bitácora en la misma transacción. SECURITY DEFINER; solo service_role.';

revoke all on function public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text) to service_role;
