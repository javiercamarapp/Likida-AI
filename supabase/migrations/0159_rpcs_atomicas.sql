-- ═══════════════════════════════════════════════════════════════════════════
-- 0159 — LAS TRES ESCRITURAS DE DINERO QUE NO ERAN ATÓMICAS (auditoría 18,
--        "qué tira producción": DAT-05, DAT-06, DAT-20) + el folio del papel
--        (DAT-41).
--
-- Las tres tenían la MISMA forma —leer, decidir en TypeScript, escribir— y por
-- eso el mismo modo de fallo: entre la lectura y la escritura cabe otra
-- petición. Con un solo contralor capturando no se nota; a 50k viajes, con dos
-- pestañas abiertas y un cron encima, sí.
--
--   · DAT-05  registrarPago leía la factura, sumaba los pagos, decidía en TS y
--             luego insertaba. DOS abonos simultáneos de $10,000 sobre un saldo
--             de $11,600 pasan los dos: cada uno ve $0 pagados. Resultado:
--             $20,000 cobrados contra una factura de $11,600 y `factura_saldo`
--             en NEGATIVO. Nadie lanza, nadie loguea; se descubre cuando el
--             cliente reclama o cuando el estado de cuenta no cuadra.
--
--   · DAT-06  reabrirViaje BORRABA la liquidación y DESPUÉS abría el viaje. El
--             segundo paso puede fallar por `uq_viaje_abierto_por_operador`
--             (0029): si el operador ya tiene otro viaje abierto, el UPDATE
--             rebota con 23505 — y la liquidación YA se borró. Queda un viaje
--             `liquidado` SIN liquidación: no se puede consultar, no se puede
--             re-cerrar (el papel se perdió) y el PDF se fue con ella.
--
--   · DAT-20  CUATRO escritores hacían lee-mezcla-escribe sobre `tenant.config`
--             (política, ajustes operativos, facilidad del 15%, estrategia de
--             agentes). Dos ediciones simultáneas: la última gana y la otra
--             desaparece en silencio. Y `config` es donde viven los TOPES
--             FISCALES: perder la mezcla no es perder una preferencia, es
--             liquidar con los topes de otro.
--
-- Idempotente: todo es `create or replace` / `create table if not exists` /
-- `create index if not exists`. Se puede correr dos veces.
--
-- Reversible:
--   drop function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text);
--   drop function public.reabrir_viaje_tx(uuid, uuid);
--   drop function public.tenant_config_merge(uuid, jsonb, text[]);
--   drop function public.config_merge_profundo(jsonb, jsonb);
--   drop trigger trg_liquidacion_id_del_viaje on public.liquidacion;
--   drop function public.liquidacion_id_del_viaje();
--   -- `liquidacion_historico` NO se dropea a la ligera: guarda papel emitido.
--
-- Verificado por el bloque 131 de supabase/verificaciones.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── SQLSTATE propios ────────────────────────────────────────────────────────
-- Como el `CU001` de la 0036 y por la misma razón: el llamador tiene que poder
-- distinguir "esto es una regla de negocio, díselo al contralor con sus
-- palabras" de "esto es un error, grítalo". Un texto dentro de un 23505 no se
-- puede leer sin adivinar.
--
--   CU010  la factura no es de esta flota (o no existe)
--   CU011  el abono se rechaza por regla de dinero — el motivo viaja en el
--          mensaje, con el saldo, para que TS redacte con `mensajeRechazoAbono`
--   CU012  el viaje no es de esta flota (o no existe)
--   CU013  la flota no existe (merge de config sobre un tenant fantasma)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · DAT-05 — registrar_pago_tx: el saldo se lee CON LA FACTURA TRABADA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `for update` sobre `factura_emitida` es la pieza entera: serializa a los dos
-- abonos simultáneos, así que el segundo suma los pagos DESPUÉS de que el
-- primero insertó el suyo y ve el saldo de verdad. La suma, la decisión y el
-- insert quedan en una transacción — o entra el pago completo con su estatus,
-- o no entra nada.
--
-- El estatus `pagada` también entra aquí, y eso cierra de paso el aviso
-- `facturacion.estatus_pagada_no_escribio`: ya no existe el estado "el pago
-- quedó pero la factura no pasó a pagada", porque no hay dos escrituras.
create or replace function public.registrar_pago_tx(
  p_tenant     uuid,
  p_factura    uuid,
  p_fecha      date,
  p_monto      numeric,
  p_metodo     text,
  p_referencia text
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

  insert into pago_recibido (tenant_id, factura_id, fecha, monto, metodo, referencia)
  values (p_tenant, p_factura, coalesce(p_fecha, current_date), p_monto, p_metodo, p_referencia)
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

comment on function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text) is
  'Registra un abono con la factura TRABADA (for update): la suma de pagos, la decisión de dinero y el insert ocurren en una transacción. Sin esto, dos abonos simultáneos ven los dos el mismo saldo y la factura queda sobrepagada — `factura_saldo` en negativo, en silencio (DAT-05).';

-- Solo service_role. El `revoke from public` NO basta: Supabase concede EXECUTE
-- explícito a anon/authenticated por default privileges (lección de la 0013).
revoke execute on function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text) from public, anon, authenticated;
grant  execute on function public.registrar_pago_tx(uuid, uuid, date, numeric, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · DAT-06 — reabrir_viaje_tx: el viaje PRIMERO, y la liquidación se ARCHIVA
-- ═══════════════════════════════════════════════════════════════════════════

-- El papel emitido no se tira a la basura. Reabrir borraba la fila de
-- `liquidacion` y con ella la única constancia de lo que se le liquidó al
-- operador: montos, diferencias y la ruta del PDF que él ya recibió. Aquí se
-- archiva antes de borrar, para poder contestar "¿qué decía la liquidación que
-- reabrimos el martes?" — que hoy no se puede.
create table if not exists public.liquidacion_historico (
  id                         uuid primary key default gen_random_uuid(),
  liquidacion_id             uuid not null,
  tenant_id                  uuid not null references public.tenant(id) on delete cascade,
  viaje_id                   uuid not null,
  total_comprobado           numeric(12,2) not null default 0,
  total_anticipo             numeric(12,2) not null default 0,
  diferencia                 numeric(12,2) not null default 0,
  estatus                    text,
  diferencias                jsonb,
  ieps_acreditable           numeric(12,2),
  iva_acreditable            numeric(12,2),
  peaje_acreditable          numeric(12,2),
  litros_diesel_acreditables numeric(12,3),
  pdf_url                    text,
  export_url                 text,
  created_at                 timestamptz,
  archivada_en               timestamptz not null default now(),
  motivo                     text not null default 'reabrir'
);

comment on table public.liquidacion_historico is
  'Las liquidaciones que se retiraron al REABRIR un viaje. No es una copia de respaldo: es la constancia de un papel que el operador YA recibió y que el borrado hacía desaparecer sin rastro (DAT-06). `viaje_id` NO lleva FK a propósito — el histórico tiene que sobrevivir aunque el viaje se elimine.';

create index if not exists liquidacion_historico_viaje_idx
  on public.liquidacion_historico (tenant_id, viaje_id, archivada_en desc);

-- Deny-all (estándares §6, mismo criterio que interruptor/agente_definicion):
-- RLS activo y CERO policies — es dinero, y solo el servidor lo toca.
alter table public.liquidacion_historico enable row level security;

create or replace function public.reabrir_viaje_tx(
  p_tenant uuid,
  p_viaje  uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pdf     text;
  v_hubo    boolean := false;
  v_estatus text;
begin
  -- El viaje trabado de entrada: contra un cierre en vuelo, el que llegue
  -- segundo espera en vez de intercalarse.
  select estatus into v_estatus
    from viaje
   where id = p_viaje and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'viaje % fuera de la flota %', p_viaje, p_tenant
      using errcode = 'CU012';
  end if;

  -- ── EL ORDEN ES EL ARREGLO ────────────────────────────────────────────────
  -- El estatus PRIMERO. Es el paso que puede rebotar: si el operador ya tiene
  -- otro viaje abierto, `uq_viaje_abierto_por_operador` (0029) lanza 23505 y
  -- toda la transacción revierte — con su liquidación INTACTA. Al revés (como
  -- estaba), ese mismo rebote dejaba un viaje liquidado sin liquidación.
  --
  -- El trigger de la 0036 mira la FILA de `liquidacion`, no el estatus del
  -- viaje, así que el orden inverso no reabre nada de más: dentro de esta
  -- transacción el viaje ya está `abierto` y la liquidación ya no existe
  -- cuando alguien más pueda mirar.
  update viaje set estatus = 'abierto'
   where id = p_viaje and tenant_id = p_tenant;

  insert into liquidacion_historico (
    liquidacion_id, tenant_id, viaje_id, total_comprobado, total_anticipo,
    diferencia, estatus, diferencias, ieps_acreditable, iva_acreditable,
    peaje_acreditable, litros_diesel_acreditables, pdf_url, export_url, created_at
  )
  select l.id, l.tenant_id, l.viaje_id, l.total_comprobado, l.total_anticipo,
         l.diferencia, l.estatus, l.diferencias, l.ieps_acreditable, l.iva_acreditable,
         l.peaje_acreditable, l.litros_diesel_acreditables, l.pdf_url, l.export_url, l.created_at
    from liquidacion l
   where l.viaje_id = p_viaje and l.tenant_id = p_tenant;

  select pdf_url, true into v_pdf, v_hubo
    from liquidacion
   where viaje_id = p_viaje and tenant_id = p_tenant;

  delete from liquidacion
   where viaje_id = p_viaje and tenant_id = p_tenant;

  return jsonb_build_object(
    'pdf_perdido', v_pdf,
    'hubo_liquidacion', coalesce(v_hubo, false),
    'estatus_previo', v_estatus
  );
end $$;

comment on function public.reabrir_viaje_tx(uuid, uuid) is
  'Reabre un viaje en UNA transacción: traba el viaje, lo pone `abierto` PRIMERO (el paso que puede rebotar contra uq_viaje_abierto_por_operador) y sólo entonces archiva su liquidación en liquidacion_historico y la retira. Antes eran dos escrituras sueltas en el orden contrario: el rebote del segundo paso dejaba un viaje liquidado SIN liquidación (DAT-06).';

revoke execute on function public.reabrir_viaje_tx(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.reabrir_viaje_tx(uuid, uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · DAT-20 — tenant_config_merge: la mezcla ocurre DENTRO del UPDATE
-- ═══════════════════════════════════════════════════════════════════════════

-- `||` de jsonb NO sirve aquí, y es la trampa de este arreglo: es superficial.
-- `{"agentes":{"conductores":{...}}} || {"agentes":{"liquidacion":{...}}}`
-- reemplaza el subárbol `agentes` entero y se lleva la otra rama. Es el MISMO
-- bug que el spread plano de TS documentado en config.ts, escrito en SQL.
--
-- Esta función es `fusionarConfig` (config.ts) en Postgres, con su misma regla:
-- los objetos se mezclan recursivamente y los ARRAYS REEMPLAZAN — `politica` es
-- una lista y mezclarla por índice daría una política que nadie escribió.
create or replace function public.config_merge_profundo(a jsonb, b jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  salida jsonb;
  k      text;
begin
  if b is null or b = 'null'::jsonb then return a; end if;
  if a is null or jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then return b; end if;

  salida := a;
  for k in select jsonb_object_keys(b) loop
    if a ? k
       and jsonb_typeof(a -> k) = 'object'
       and jsonb_typeof(b -> k) = 'object' then
      salida := jsonb_set(salida, array[k], public.config_merge_profundo(a -> k, b -> k));
    else
      salida := jsonb_set(salida, array[k], b -> k, true);
    end if;
  end loop;

  return salida;
end $$;

comment on function public.config_merge_profundo(jsonb, jsonb) is
  'Mezcla PROFUNDA de dos jsonb, gemela de fusionarConfig (config.ts): objetos se recorren, arrays y escalares reemplazan. El `||` de Postgres es superficial y aquí borraría subárboles enteros de tenant.config — que es donde viven los topes fiscales.';

create or replace function public.tenant_config_merge(
  p_tenant  uuid,
  p_parcial jsonb,
  p_borrar  text[] default '{}'::text[]
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_config jsonb;
begin
  -- UN SOLO statement: Postgres traba la fila, evalúa la expresión sobre el
  -- valor vigente y escribe. No hay ventana entre leer y escribir, que es
  -- exactamente lo que los cuatro escritores de TS tenían abierta.
  --
  -- El CHECK `tenant_config_valida` (0026, redefinido hasta la 0085) corre en
  -- este UPDATE como en cualquier otro: una llave inventada o una facilidad
  -- del 15% mal formada rebota aquí, ruidosa, en vez de guardarse.
  update tenant
     set config = public.config_merge_profundo(
                    coalesce(config, '{}'::jsonb),
                    coalesce(p_parcial, '{}'::jsonb)
                  ) - coalesce(p_borrar, '{}'::text[])
   where id = p_tenant
   returning config into v_config;

  if not found then
    raise exception 'flota % inexistente', p_tenant using errcode = 'CU013';
  end if;

  return coalesce(v_config, '{}'::jsonb);
end $$;

comment on function public.tenant_config_merge(uuid, jsonb, text[]) is
  'Mezcla un parcial sobre tenant.config en UN solo UPDATE (merge profundo + borrado explícito de llaves). Los cuatro escritores de TS —política, ajustes operativos, facilidad del 15%, estrategia de agentes— hacían lee-mezcla-escribe: dos ediciones simultáneas y la de en medio desaparecía sin ruido, llevándose topes fiscales (DAT-20).';

revoke execute on function public.tenant_config_merge(uuid, jsonb, text[]) from public, anon, authenticated;
grant  execute on function public.tenant_config_merge(uuid, jsonb, text[]) to service_role;
revoke execute on function public.config_merge_profundo(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.config_merge_profundo(jsonb, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · DAT-41 — el folio del PDF es el id que de verdad se guarda
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `tools.ts` arma el objeto de la liquidación para imprimirlo con un
-- `randomUUID()` — un id que NO es el que `guardar_liquidacion_tx` va a
-- generar. Cuando el viaje no trae folio, el PDF encabeza "Folio A1B2C3D4" con
-- los ocho primeros del id inventado: el papel que el contralor archiva cita un
-- identificador que no existe en la base. Buscarlo no devuelve nada.
--
-- El arreglo es hacer el id DERIVABLE del viaje, para que el papel y la fila
-- lleguen al mismo número sin tener que hablarse: `md5(viaje_id||':liquidacion')`.
-- El trigger lo impone en la base y `idLiquidacionDeViaje` (TS) lo calcula
-- igual antes de imprimir. No se toca `guardar_liquidacion_tx` a propósito: esa
-- función es de otro arreglo en vuelo y aquí no hace falta.
--
-- Una liquidación por viaje ya era invariante (`liquidacion_viaje_uidx`, 0005),
-- así que derivarlo del viaje no colisiona con nada. Y no se re-escriben ids
-- viejos: un re-cierre sobre una liquidación anterior a esta migración conserva
-- el suyo (el `on conflict do update` no toca la PK) y sigue con el desajuste
-- hasta que ese viaje se reabra.
create or replace function public.liquidacion_id_del_viaje()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.id := md5(new.viaje_id::text || ':liquidacion')::uuid;
  return new;
end $$;

comment on function public.liquidacion_id_del_viaje() is
  'El id de una liquidación se DERIVA de su viaje, para que el PDF pueda imprimir el folio correcto antes de que la fila exista (DAT-41). Una liquidación por viaje ya lo garantiza liquidacion_viaje_uidx (0005).';

drop trigger if exists trg_liquidacion_id_del_viaje on public.liquidacion;
create trigger trg_liquidacion_id_del_viaje
  before insert on public.liquidacion
  for each row execute function public.liquidacion_id_del_viaje();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · LA LLAVE `agentes` NUNCA CABÍA EN `tenant.config` (hallazgo de DAT-20)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Al migrar los cuatro escritores al RPC salió esto: `guardarEstrategiaAgente`
-- (agentes/estrategia.ts) escribe `config.agentes`, y `llaves_ok` de
-- `config_tenant_valida` (0026, redefinida hasta la 0085) NO incluye 'agentes'.
-- Comprobado contra Postgres 17 con las 158 migraciones aplicadas:
--
--   update tenant set config = '{"agentes":{"conductores":{"horasEscalacion":5}}}'
--   → ERROR: tenant.config trae la llave "agentes", que CuadraConfig no conoce.
--
-- O sea: la pantalla de estrategia por agente JAMÁS pudo guardar. No es un
-- riesgo de concurrencia — es una función muerta que devuelve error a la cara,
-- y por eso no se veía en ningún log de corrupción silenciosa.
--
-- El arreglo NO reescribe `config_tenant_valida`: son 200 líneas de reglas de
-- dinero ajenas a este cambio y copiarlas para tocar un array es cómo se
-- pierden. Se mueve el CHECK: la config se valida SIN `agentes` con la función
-- de siempre, y `agentes` se valida con la suya. Si algún día otra migración
-- recrea `tenant_config_valida` sin el `- 'agentes'`, la llave vuelve a rebotar
-- — y el bloque 131 de verificaciones.sql lo grita.
create or replace function public.config_agentes_valida(p_agentes jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  llaves_ok text[] := array['conductores','liquidacion'];  -- ParcialEstrategia (estrategia.ts)
  k text;
  o jsonb;
  v numeric;
begin
  if p_agentes is null or p_agentes = 'null'::jsonb then
    return true;   -- sin estrategia declarada: corren los defaults del producto
  end if;

  if jsonb_typeof(p_agentes) <> 'object' then
    raise exception
      'tenant.config->agentes tiene que ser un objeto y llegó un %. Cualquier otra cosa la lee el agente como "sin estrategia" y corre con los defaults creyendo que corre con los tuyos.',
      jsonb_typeof(p_agentes);
  end if;

  for k in select jsonb_object_keys(p_agentes) loop
    if not (k = any(llaves_ok)) then
      raise exception
        'tenant.config->agentes trae la llave "%", que ParcialEstrategia no conoce. Las válidas son: %. Una llave mal escrita se guarda, no la lee nadie, y el agente sigue con su default.',
        k, array_to_string(llaves_ok, ', ');
    end if;
  end loop;

  -- Los DOS únicos números que un motor de verdad lee. Los rangos son los
  -- mismos que validan `validarHorasEscalacion` y `validarUmbralConfianza`: si
  -- se separan, la pantalla acepta lo que la base rechaza (o al revés).
  if jsonb_exists(p_agentes, 'conductores') then
    o := p_agentes -> 'conductores';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->agentes->conductores tiene que ser un objeto {"horasEscalacion": n}.';
    end if;
    if jsonb_exists(o, 'horasEscalacion') then
      if jsonb_typeof(o -> 'horasEscalacion') <> 'number' then
        raise exception 'tenant.config->agentes->conductores->horasEscalacion tiene que ser un número (llegó %).', jsonb_typeof(o -> 'horasEscalacion');
      end if;
      v := (o ->> 'horasEscalacion')::numeric;
      if v < 1 or v > 48 or v <> trunc(v) then
        raise exception 'tenant.config->agentes->conductores->horasEscalacion vale % y tiene que ser un entero entre 1 y 48. Con menos de una hora se escala todo al jefe; con más de dos días el aviso llega tarde para servir.', v;
      end if;
    end if;
  end if;

  if jsonb_exists(p_agentes, 'liquidacion') then
    o := p_agentes -> 'liquidacion';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->agentes->liquidacion tiene que ser un objeto {"umbralConfianza": n}.';
    end if;
    if jsonb_exists(o, 'umbralConfianza') then
      if jsonb_typeof(o -> 'umbralConfianza') <> 'number' then
        raise exception 'tenant.config->agentes->liquidacion->umbralConfianza tiene que ser un número (llegó %).', jsonb_typeof(o -> 'umbralConfianza');
      end if;
      v := (o ->> 'umbralConfianza')::numeric;
      if v < 0.5 or v > 0.99 then
        raise exception 'tenant.config->agentes->liquidacion->umbralConfianza vale % y vive entre 0.50 y 0.99: más abajo una lectura al aire cuenta como medición, y en 1.00 todo comprobante iría a revisión manual y el agente dejaría de liquidar.', v;
      end if;
    end if;
  end if;

  return true;
end $$;

comment on function public.config_agentes_valida(jsonb) is
  'Valida tenant.config->agentes (ParcialEstrategia). Existe porque config_tenant_valida no conoce esa llave y la rechazaba entera: la pantalla de estrategia por agente no podía guardar nada (0159).';

do $$
begin
  -- Idempotente y en un solo paso: se recrea el CHECK apuntando a la config SIN
  -- `agentes`, y se agrega el CHECK propio de `agentes`. Si ya están así, no
  -- hace nada.
  if exists (
    select 1 from pg_constraint
     where conname = 'tenant_config_valida' and conrelid = 'public.tenant'::regclass
       and pg_get_constraintdef(oid) not like '%agentes%'
  ) then
    alter table public.tenant drop constraint tenant_config_valida;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_config_valida' and conrelid = 'public.tenant'::regclass
  ) then
    alter table public.tenant
      add constraint tenant_config_valida
      check (config is null or public.config_tenant_valida(config - 'agentes'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_config_agentes_valida' and conrelid = 'public.tenant'::regclass
  ) then
    alter table public.tenant
      add constraint tenant_config_agentes_valida
      check (config is null or public.config_agentes_valida(config -> 'agentes'));
  end if;
end $$;

revoke execute on function public.config_agentes_valida(jsonb) from public, anon, authenticated;
grant  execute on function public.config_agentes_valida(jsonb) to service_role;
