-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25, BE-C1a + BE-C1b + DATOS-C1 (CRÍTICO, reincidente de la 24).
-- DECISIÓN DE PRODUCTO YA TOMADA: cuando `revisar_liquidacion(..., 'ajustar')`
-- mueve el total a mano, el sistema REGENERA el desglose fiscal y el PDF con
-- las cifras recalculadas — no solo mueve `total_comprobado`/`diferencia` por
-- una delta aritmética y deja todo lo demás (iva_acreditable, ieps_acreditable,
-- peaje_acreditable, litros_diesel_acreditables, diferencias, estatus, y el
-- PDF archivado) con la cifra vieja.
--
-- LO QUE ESTA MIGRACIÓN AGREGA
--
--  1. `revisar_liquidacion(...)` gana un octavo parámetro, `p_recalculo
--     jsonb`. Es OBLIGATORIO cuando `p_accion = 'ajustar'` (LR021 si falta) —
--     `src/lib/likida/revision_recalculo.ts` lo arma ANTES de llamar a la RPC,
--     re-corriendo el motor de cuadre (`cuadrarDesdeDB`, puro en TypeScript)
--     sobre los gastos VIVOS del viaje con el monto ya ajustado en memoria.
--     La RPC NO re-implementa el motor en SQL —«un segundo motor en SQL sería
--     dos cálculos» (revision.ts) — solo PERSISTE lo que TypeScript calculó,
--     dentro de la MISMA transacción y bajo el MISMO candado del viaje que ya
--     tomaba, así que sigue siendo LA ÚNICA puerta.
--
--     Guardarraíl (LR020): el `totalComprobado` de `p_recalculo` tiene que
--     coincidir, al centavo, con `total_comprobado + delta` (la aritmética
--     que la RPC ya hacía) — si no coincide, algo cambió entre que
--     TypeScript leyó los gastos y que esta transacción los tocó (una carrera
--     angosta, ver el comentario de `cuadrarDesdeDB`), y se rechaza en vez de
--     persistir dos cifras que ya no describen el mismo hecho.
--
--     Los campos que SÍ se sustituyen por el recálculo (no por la delta):
--     `diferencia`, `estatus`, `diferencias`, `ieps_acreditable`,
--     `litros_diesel_acreditables`, `iva_acreditable`, `peaje_acreditable`.
--     Lo que NO se toca: `gasto.sub_total`/`iva_traslado`/`ieps_traslado` —
--     son el HECHO del CFDI (o su ausencia), y prorratearlos a mano sobre el
--     monto nuevo sería inventar una cifra que ningún papel respalda (la
--     razón por la que `poliza.ts` ya declaró "un IVA no acreditable
--     inventado" como la falla que no se puede repetir). El motor los LEE tal
--     cual están y de ahí sale el desglose recalculado.
--
--  2. `liquidacion.pdf_historial` — arreglo de `{url, archivadaEn}`: el PDF
--     que un ajuste sustituye NO se borra, se archiva ahí (lo escribe
--     `revision_recalculo.ts` después de subir el PDF nuevo a la misma ruta
--     canónica, `${tenant}/${viaje}.pdf` — la que todo el resto del sistema
--     ya asume). `pdf_url` sigue siendo, sin ambigüedad, CUÁL es el vigente.
--
--  3. Los dos sellos de entrega de la 0279 (`entregada_operador_en`,
--     `avisada_oficina_en`) se limpian en el MISMO recálculo (TypeScript, no
--     aquí — no son parte de `revisar_liquidacion`): un ajuste vuelve a dejar
--     pendiente la entrega del papel correcto al chofer, en vez de que la
--     base siga afirmando "ya se le dio" sobre un PDF que ya no es el que
--     está en `pdf_url`.
--
--  4. `agregar_pdf_historial(...)` — un `jsonb ||` atómico para empujar la
--     entrada archivada a `pdf_historial` sin leer-modificar-escribir en TS
--     (que perdería una entrada si dos ajustes de la misma liquidación
--     corrieran cerca uno del otro — improbable, LR010 ya impide una segunda
--     firma, pero el patrón cuesta lo mismo hacerlo bien que mal).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ─────────────────────────────────────────────────────────────
alter table public.liquidacion
  add column if not exists pdf_historial jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_pdf_historial_arreglo') then
    alter table public.liquidacion add constraint liquidacion_pdf_historial_arreglo
      check (jsonb_typeof(pdf_historial) = 'array');
  end if;
end $$;

comment on column public.liquidacion.pdf_historial is
  'AUDITORÍA 25 (mig. 0306). Los PDF que un ajuste sustituyó en pdf_url (mismo bucket, ruta archivada): {url, archivadaEn}[]. pdf_url sigue siendo el vigente; esto es SOLO histórico, nunca se borra.';

-- ── 2. La firma vieja SE VA — la lección literal de la 0158/0022 ───────────
-- `create or replace` con una lista de parámetros distinta SOBRECARGA, no
-- reemplaza; con dos firmas vivas toda llamada posicional de PostgREST falla
-- con "is not unique" y NINGUNA revisión se firma.
drop function if exists public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text);

create or replace function public.revisar_liquidacion(
  p_tenant      uuid,
  p_liquidacion uuid,
  p_accion      text,
  p_motivo      text  default null,
  p_ajustes     jsonb default null,
  p_actor       uuid  default null,
  p_actor_email text  default null,
  -- AUDITORÍA 25, BE-C1a/BE-C1b/DATOS-C1: el recálculo COMPLETO del motor
  -- (TypeScript, `cuadrarDesdeDB` sobre los gastos vivos con el ajuste ya
  -- aplicado en memoria) — obligatorio cuando p_accion = 'ajustar'.
  p_recalculo   jsonb default null
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
  v_total_delta numeric;
  v_total_recalculo numeric;
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
    -- AUDITORÍA 25: sin el recálculo del motor no hay con qué sustituir el
    -- desglose — antes de esta migración era EXACTAMENTE ese hueco.
    if p_recalculo is null or jsonb_typeof(p_recalculo) <> 'object' then
      raise exception 'ajustar exige el recálculo del motor (p_recalculo): revisarLiquidacion() lo arma con cuadrarDesdeDB antes de llamar a esta RPC'
        using errcode = 'LR021';
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

    -- LR020: el recálculo de TypeScript tiene que describir el MISMO ajuste
    -- que esta transacción acaba de aplicar. `round(...,2)` porque el motor
    -- en TS ya redondea a centavos y una diferencia de punto flotante no es
    -- una carrera real.
    v_total_delta := round(v_liq.total_comprobado + v_delta, 2);
    v_total_recalculo := round((p_recalculo ->> 'totalComprobado')::numeric, 2);
    if v_total_recalculo is null or abs(v_total_recalculo - v_total_delta) > 0.01 then
      raise exception 'el recálculo (%) no coincide con el ajuste aplicado (%): algo cambió los gastos de este viaje entre el cálculo y el guardado — vuelve a intentar', v_total_recalculo, v_total_delta
        using errcode = 'LR020';
    end if;

    update liquidacion
       set total_comprobado = v_total_recalculo,
           diferencia       = round((p_recalculo ->> 'diferencia')::numeric, 2),
           estatus          = (p_recalculo ->> 'estatus')::text,
           diferencias      = coalesce(p_recalculo -> 'diferencias', '[]'::jsonb),
           ieps_acreditable = round(coalesce((p_recalculo ->> 'iepsAcreditable')::numeric, 0), 2),
           litros_diesel_acreditables = round(coalesce((p_recalculo ->> 'litrosDieselAcreditables')::numeric, 0), 3),
           iva_acreditable  = round(coalesce((p_recalculo ->> 'ivaAcreditable')::numeric, 0), 2),
           peaje_acreditable = round(coalesce((p_recalculo ->> 'peajeAcreditable')::numeric, 0), 2),
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
                             'delta', case when p_accion = 'ajustar' then v_delta else null end,
                             'recalculo', case when p_accion = 'ajustar' then p_recalculo else null end));

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
    'operador_telefono', v_telefono,
    -- AUDITORÍA 25 (mig. 0306): quién y cuándo firmó — `revision_recalculo.ts`
    -- los necesita para el sello "Revisada por X el fecha" del PDF nuevo, sin
    -- tener que confiar en lo que TS mandó de entrada (la RPC ya resolvió el
    -- correo real desde `app_user`, que puede no ser el que llegó por parámetro).
    'revisada_por_email', v_liq.revisada_por_email,
    'revisada_en', v_liq.revisada_en
  );
end $$;

comment on function public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text, jsonb) is
  'La firma humana de la liquidación (0299; recálculo del desglose y guardarraíl LR020/LR021 en la 0306, AUDITORÍA 25 BE-C1a/BE-C1b/DATOS-C1): aprobar, ajustar ([{gastoId, montoNuevo}] → gasto.monto, y el desglose completo (total_comprobado/diferencia/estatus/diferencias/iva-ieps-peaje-litros acreditables) lo sustituye p_recalculo, el motor recorrido en TypeScript sobre los gastos vivos — nunca una delta a mano sobre el desglose) o rechazar (viaje vuelve a en_cuadre). Candado del viaje antes que el de la liquidación; una revisada por persona no se firma dos veces (LR010); deja bitácora en la misma transacción, con el recálculo adjunto. SECURITY DEFINER; solo service_role.';

revoke all on function public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.revisar_liquidacion(uuid, uuid, text, text, jsonb, uuid, text, jsonb) to service_role;

-- ── 3. `agregar_pdf_historial` ──────────────────────────────────────────────
-- Fuera de `revisar_liquidacion` a propósito: el archivado a Storage (donde
-- vive el PDF que se está sustituyendo) es un paso de TypeScript que corre
-- DESPUÉS de que la RPC ya confirmó el ajuste — SQL no sube ni copia bytes
-- de un bucket. No toca `revision`/`revisada_*`/`motivo`/`ajustes` ni las
-- columnas que la 0299 vigila para "retirar la firma": no hay guardarraíl
-- que sortear, es un `update` normal, atómico solo para que el `||` de jsonb
-- no pise una entrada previa.
create or replace function public.agregar_pdf_historial(p_tenant uuid, p_liquidacion uuid, p_entrada jsonb)
returns void
language sql
set search_path = public, pg_catalog, pg_temp
as $$
  update liquidacion
     set pdf_historial = pdf_historial || jsonb_build_array(p_entrada)
   where id = p_liquidacion and tenant_id = p_tenant;
$$;

comment on function public.agregar_pdf_historial(uuid, uuid, jsonb) is
  'AUDITORÍA 25 (mig. 0306). Empuja {url, archivadaEn} a liquidacion.pdf_historial con `||` (atómico, sin leer-modificar-escribir en TS). No es la puerta de la revisión: no toca ninguna columna que 0299 vigile.';

revoke all on function public.agregar_pdf_historial(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agregar_pdf_historial(uuid, uuid, jsonb) to service_role;
