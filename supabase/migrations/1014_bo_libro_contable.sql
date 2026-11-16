-- 1014 — Back-office de Likida: libro contable de PARTIDA DOBLE propio (porte del núcleo contable de RTM adaptado a un SaaS).
--
-- Qué es: la contabilidad interna de Likida como empresa (no la de sus flotas). Solo-inserción, con cuadre diferido al commit, cadena de
-- hash y folio sin huecos. Nada se actualiza ni se borra: corregir es una REVERSA enlazada, con motivo, y un asiento nuevo.
--   · bo_cuenta            plan de cuentas SaaS PROPUESTO (propuesta; el contador lo define). Sin catálogo oficial del SAT.
--   · bo_periodo_contable  abierto -> preparado -> aprobado -> publicado. Solo avanza; reabrir exige motivo (bo_reabrir_periodo).
--   · bo_asiento / bo_asiento_linea  el libro. Dinero en numeric(12,2) pesos; cada línea lleva debe O haber (no ambos ni ninguno).
--   · bo_asentar / bo_reversar_asiento  ÚNICA vía de escritura (security definer, solo service_role): idempotente por clave_idem,
--     valida cuentas y periodo, toma el candado de la cadena y encadena el hash sha256.
--   · bo_verificar_cadena / bo_comprobaciones_libro  las comprobaciones por dos vías (balanza, asientos cuadrados, cadena, identidad contable).
--
-- Sin dimensiones de mayoreo (clientes, socios, modelos): una flota, si hace falta, va en origen_id (uuid suelto, sin FK).
-- Las migraciones NO se aplican a producción desde aquí: solo se escriben. ADITIVA E IDEMPOTENTE.
--
-- REVERSA (manual, en este orden):
--   drop function if exists public.bo_comprobaciones_libro();
--   drop function if exists public.bo_verificar_cadena();
--   drop function if exists public.bo_folios_con_huecos();
--   drop function if exists public.bo_reabrir_periodo(date, text, uuid);
--   drop function if exists public.bo_asegurar_periodo(date);
--   drop function if exists public.bo_reversar_asiento(uuid, text, uuid, text, date);
--   drop function if exists public.bo_asentar(text, date, text, text, uuid, text, text, uuid, jsonb);
--   drop function if exists public.bo_asentar_interno(text, date, text, text, uuid, text, text, uuid, jsonb, uuid, text);
--   drop function if exists public.bo_lineas_canon(uuid);
--   drop function if exists public.bo_texto_canonico(text, text, date, text, uuid, text);
--   drop function if exists public.bo_hash_de(text, text);
--   drop table if exists public.bo_asiento_linea;
--   drop table if exists public.bo_asiento;
--   drop table if exists public.bo_folio_contador;
--   drop table if exists public.bo_periodo_reapertura;
--   drop table if exists public.bo_periodo_contable;
--   drop table if exists public.bo_cuenta;
--   (y las funciones de trigger bo_libro_solo_insercion, bo_t_cuadre_linea, bo_t_cuadre_asiento, bo_t_periodo, bo_t_cuenta)
begin;

-- ---------------------------------------------------------------------------
-- Plan de cuentas. tipo: A activo, P pasivo, K capital, I ingreso, C costo, G gasto. naturaleza: D deudora, A acreedora.
-- ---------------------------------------------------------------------------
create table if not exists public.bo_cuenta (
  codigo     text primary key check (codigo ~ '^[0-9]{4}$'),
  nombre     text not null check (char_length(btrim(nombre)) between 3 and 120),
  tipo       text not null check (tipo in ('A', 'P', 'K', 'I', 'C', 'G')),
  naturaleza text not null check (naturaleza in ('D', 'A')),
  activa     boolean not null default true,
  -- true mientras el contador no la haya revisado: el plan completo es una PROPUESTA.
  propuesta  boolean not null default true,
  nota       text
);

comment on table public.bo_cuenta is
  '1014: plan de cuentas SaaS PROPUESTO (propuesta; el contador lo define). No es el catálogo oficial del SAT. Solo service_role.';

insert into public.bo_cuenta (codigo, nombre, tipo, naturaleza, activa, nota) values
  ('1110', 'Bancos', 'A', 'D', true, 'Cuenta bancaria de la sociedad. Hoy Likida aún no tiene cuenta propia.'),
  ('1120', 'Saldos en el procesador de pagos', 'A', 'D', true, 'Cobros de Stripe pendientes de liquidar al banco.'),
  ('1210', 'Clientes por cobrar', 'A', 'D', true, 'Mensualidades emitidas y no cobradas.'),
  ('1410', 'IVA acreditable', 'A', 'D', true, 'Solo con comprobante fiscal válido; sin RFC propio no es evaluable.'),
  ('1420', 'Anticipos a proveedores', 'A', 'D', false, 'Reservada.'),
  ('2110', 'Proveedores por pagar', 'P', 'A', true, 'Nube, IA, software y servicios.'),
  ('2120', 'Comisiones por pagar a vendedores', 'P', 'A', true, 'Devengadas y aún no pagadas.'),
  ('2130', 'Honorarios por pagar a contratistas', 'P', 'A', true, 'Registro ligero: la nómina se compra, no se construye.'),
  ('2210', 'IVA trasladado por pagar', 'P', 'A', true, 'IVA cobrado a clientes pendiente de enterar.'),
  ('2230', 'ISR por pagar', 'P', 'A', true, 'Pagos provisionales y anual; régimen pendiente de contador.'),
  ('2310', 'Ingresos diferidos', 'P', 'A', true, 'Mensualidades cobradas por anticipado.'),
  ('3110', 'Capital social', 'K', 'A', true, 'Sin sociedad constituida todavía (SAPI pendiente).'),
  ('3210', 'Resultados de ejercicios anteriores', 'K', 'A', true, null),
  ('4100', 'Ingresos por suscripción SaaS', 'I', 'A', true, 'Mensualidades de las flotas, sin IVA.'),
  ('4200', 'Otros ingresos', 'I', 'A', true, null),
  ('4210', 'Devoluciones y bonificaciones sobre ingresos', 'I', 'D', true, 'Cuenta de contra-ingreso.'),
  ('5100', 'Costos de nube e infraestructura', 'C', 'D', true, 'Vercel, Supabase y similares.'),
  ('5200', 'Costos de IA y modelos', 'C', 'D', true, 'Consumo de modelos por cliente (COGS de IA).'),
  ('5300', 'Costos de mensajería y WhatsApp', 'C', 'D', true, null),
  ('6110', 'Software y suscripciones', 'G', 'D', true, null),
  ('6120', 'Dominios y correo', 'G', 'D', true, null),
  ('6130', 'Servicios legales y de firma electrónica', 'G', 'D', true, null),
  ('6140', 'Comisiones de venta', 'G', 'D', true, 'Comisión de vendedores devengada.'),
  ('6150', 'Honorarios de contratistas', 'G', 'D', true, null),
  ('6160', 'Comisiones bancarias y del procesador de pagos', 'G', 'D', true, null),
  ('6290', 'Otros gastos de administración', 'G', 'D', true, null),
  ('7100', 'Pérdida cambiaria', 'G', 'D', false, 'Reservada: gastos en USD con tipo de cambio mensual.'),
  ('7200', 'Ganancia cambiaria', 'I', 'A', false, 'Reservada.'),
  ('7900', 'Ajuste por redondeo', 'G', 'D', true, 'Tolerancia de un centavo por asiento; vigilada.'),
  ('8100', 'ISR del ejercicio', 'G', 'D', false, 'Reservada hasta que el contador defina el régimen.')
on conflict (codigo) do nothing;

-- La naturaleza y el tipo de una cuenta con movimientos no cambian (cambiarlos reescribe la historia); nombre, activa y nota sí.
create or replace function public.bo_t_cuenta()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'las cuentas contables no se borran (%)', old.codigo using errcode = '42501';
  end if;
  if (new.codigo <> old.codigo or new.tipo <> old.tipo or new.naturaleza <> old.naturaleza)
     and exists (select 1 from public.bo_asiento_linea where cuenta = old.codigo) then
    raise exception 'la cuenta % ya tiene movimientos: no cambia de tipo ni de naturaleza', old.codigo using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Periodos contables: abierto -> preparado -> aprobado -> publicado. Reabrir solo con bo_reabrir_periodo (motivo obligatorio).
-- ---------------------------------------------------------------------------
create table if not exists public.bo_periodo_contable (
  periodo        date primary key check (periodo = date_trunc('month', periodo)::date),
  estado         text not null default 'abierto' check (estado in ('abierto', 'preparado', 'aprobado', 'publicado')),
  preparado_en   timestamptz,
  aprobado_en    timestamptz,
  aprobado_por   uuid,
  publicado_en   timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.bo_periodo_contable is
  '1014: periodos contables mensuales con transiciones controladas (la capa que usa el cierre mensual). Reabrir exige motivo. Solo service_role.';

create table if not exists public.bo_periodo_reapertura (
  id          bigint generated always as identity primary key,
  periodo     date not null references public.bo_periodo_contable (periodo),
  motivo      text not null check (nullif(btrim(motivo), '') is not null),
  reabierto_por uuid,
  creado_en   timestamptz not null default now()
);

create or replace function public.bo_t_periodo()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'los periodos contables no se borran' using errcode = '42501';
  end if;
  if new.periodo <> old.periodo then
    raise exception 'la fecha de un periodo contable no cambia' using errcode = '42501';
  end if;
  new.actualizado_en := now();
  if new.estado = old.estado then return new; end if;
  if (old.estado, new.estado) in (('abierto', 'preparado'), ('preparado', 'abierto'), ('preparado', 'aprobado'), ('aprobado', 'publicado')) then
    return new;
  end if;
  if (old.estado, new.estado) in (('aprobado', 'abierto'), ('publicado', 'abierto'))
     and current_setting('likida.bo_reapertura', true) = old.periodo::text then
    return new;
  end if;
  raise exception 'transicion de periodo contable no permitida: % -> %', old.estado, new.estado using errcode = 'P0431';
end;
$$;

drop trigger if exists bo_periodo_contable_t on public.bo_periodo_contable;
create trigger bo_periodo_contable_t
  before update or delete on public.bo_periodo_contable
  for each row execute function public.bo_t_periodo();

-- ---------------------------------------------------------------------------
-- Libro: folio sin huecos, asiento y líneas (solo-inserción).
-- ---------------------------------------------------------------------------
create table if not exists public.bo_folio_contador (
  serie  text primary key check (serie = 'A'),
  ultimo integer not null default 0 check (ultimo >= 0)
);
insert into public.bo_folio_contador (serie, ultimo) values ('A', 0) on conflict (serie) do nothing;

create table if not exists public.bo_asiento (
  id            uuid primary key default gen_random_uuid(),
  -- Número correlativo; el folio es 'A-' + este número con ceros a la izquierda. Sin huecos: se asigna dentro de la transacción del asiento.
  seq           integer not null unique check (seq >= 1),
  folio         text not null unique check (folio ~ '^A-[0-9]{4,}$'),
  clave_idem    text not null unique check (char_length(btrim(clave_idem)) between 8 and 200),
  fecha_neg     date not null,
  periodo       date not null check (periodo = date_trunc('month', fecha_neg)::date),
  descripcion   text not null check (nullif(btrim(descripcion), '') is not null),
  origen_tipo   text not null default 'manual' check (origen_tipo ~ '^[a-z_]{3,40}$'),
  -- Referencia suelta (sin FK) al hecho que originó el asiento: una factura_saas, un gasto, un pago a vendedor.
  origen_id     uuid,
  -- Soporte documental del asiento: un movimiento sin CFDI se marca «SIN CFDI — no incluir sin revisión» en el paquete.
  soporte       text not null default 'ninguno' check (soporte in ('cfdi', 'invoice_extranjero', 'ninguno')),
  soporte_ref   text,
  reversa_de    uuid unique references public.bo_asiento (id),
  motivo_reversa text,
  es_manual     boolean not null default false,
  hash_anterior text not null check (hash_anterior ~ '^[0-9a-f]{64}$'),
  hash          text not null check (hash ~ '^[0-9a-f]{64}$'),
  creado_por    uuid,
  creado_en     timestamptz not null default now(),
  check ((reversa_de is null) = (motivo_reversa is null)),
  check (motivo_reversa is null or nullif(btrim(motivo_reversa), '') is not null),
  check (es_manual = (origen_tipo = 'manual'))
);

comment on table public.bo_asiento is
  '1014: libro contable de solo inserción con cadena de hash sha256 y folio sin huecos. Corregir = reversa enlazada con motivo. Solo service_role (vía bo_asentar).';

create index if not exists bo_asiento_periodo_idx on public.bo_asiento (periodo, seq);

create table if not exists public.bo_asiento_linea (
  asiento_id uuid not null references public.bo_asiento (id),
  n          integer not null check (n >= 1),
  cuenta     text not null references public.bo_cuenta (codigo),
  debe       numeric(12, 2) not null default 0 check (debe >= 0),
  haber      numeric(12, 2) not null default 0 check (haber >= 0),
  nota       text,
  primary key (asiento_id, n),
  check ((debe = 0) <> (haber = 0))
);

comment on table public.bo_asiento_linea is
  '1014: líneas del libro (debe O haber, nunca ambos). Solo inserción; el cuadre debe = haber se exige al commit.';

create index if not exists bo_asiento_linea_cuenta_idx on public.bo_asiento_linea (cuenta, asiento_id);

create or replace function public.bo_libro_solo_insercion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'el libro contable es de solo insercion (% sobre %): corrige con una reversa', tg_op, tg_table_name using errcode = '42501';
end;
$$;

drop trigger if exists bo_asiento_solo_insercion on public.bo_asiento;
create trigger bo_asiento_solo_insercion before update or delete on public.bo_asiento
  for each row execute function public.bo_libro_solo_insercion();
drop trigger if exists bo_asiento_solo_insercion_t on public.bo_asiento;
create trigger bo_asiento_solo_insercion_t before truncate on public.bo_asiento
  for each statement execute function public.bo_libro_solo_insercion();

drop trigger if exists bo_asiento_linea_solo_insercion on public.bo_asiento_linea;
create trigger bo_asiento_linea_solo_insercion before update or delete on public.bo_asiento_linea
  for each row execute function public.bo_libro_solo_insercion();
drop trigger if exists bo_asiento_linea_solo_insercion_t on public.bo_asiento_linea;
create trigger bo_asiento_linea_solo_insercion_t before truncate on public.bo_asiento_linea
  for each statement execute function public.bo_libro_solo_insercion();

drop trigger if exists bo_periodo_reapertura_solo_insercion on public.bo_periodo_reapertura;
create trigger bo_periodo_reapertura_solo_insercion before update or delete on public.bo_periodo_reapertura
  for each row execute function public.bo_libro_solo_insercion();
drop trigger if exists bo_periodo_reapertura_solo_insercion_t on public.bo_periodo_reapertura;
create trigger bo_periodo_reapertura_solo_insercion_t before truncate on public.bo_periodo_reapertura
  for each statement execute function public.bo_libro_solo_insercion();

drop trigger if exists bo_cuenta_t on public.bo_cuenta;
create trigger bo_cuenta_t before update or delete on public.bo_cuenta
  for each row execute function public.bo_t_cuenta();

-- Cuadre: Σ debe = Σ haber por asiento Y al menos dos líneas, DIFERIDO al commit (cubre cualquier camino de escritura).
create or replace function public.bo_t_cuadre_linea()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare v_d numeric; v_h numeric; v_n bigint;
begin
  select coalesce(sum(debe), 0), coalesce(sum(haber), 0), count(*) into v_d, v_h, v_n
    from public.bo_asiento_linea where asiento_id = new.asiento_id;
  if v_d <> v_h then
    raise exception 'asiento descuadrado: debe % contra haber %', v_d, v_h using errcode = 'P0430';
  end if;
  if v_n < 2 then
    raise exception 'un asiento necesita al menos dos lineas' using errcode = 'P0430';
  end if;
  return null;
end;
$$;

create or replace function public.bo_t_cuadre_asiento()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare v_d numeric; v_h numeric; v_n bigint;
begin
  select coalesce(sum(debe), 0), coalesce(sum(haber), 0), count(*) into v_d, v_h, v_n
    from public.bo_asiento_linea where asiento_id = new.id;
  if v_n < 2 then
    raise exception 'un asiento necesita al menos dos lineas (folio %)', new.folio using errcode = 'P0430';
  end if;
  if v_d <> v_h then
    raise exception 'asiento descuadrado: debe % contra haber %', v_d, v_h using errcode = 'P0430';
  end if;
  return null;
end;
$$;

drop trigger if exists bo_asiento_linea_cuadre on public.bo_asiento_linea;
create constraint trigger bo_asiento_linea_cuadre after insert on public.bo_asiento_linea
  deferrable initially deferred for each row execute function public.bo_t_cuadre_linea();
drop trigger if exists bo_asiento_cuadre on public.bo_asiento;
create constraint trigger bo_asiento_cuadre after insert on public.bo_asiento
  deferrable initially deferred for each row execute function public.bo_t_cuadre_asiento();

-- ---------------------------------------------------------------------------
-- Hash de auditoría. El texto canónico solo usa centavos enteros y texto plano: se reproduce idéntico en TypeScript (libro.ts).
-- ---------------------------------------------------------------------------
create or replace function public.bo_hash_de(p_anterior text, p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_anterior || '|' || p_texto, 'UTF8')), 'hex') $$;

create or replace function public.bo_texto_canonico(p_folio text, p_clave text, p_fecha date, p_origen text, p_reversa uuid, p_lineas text)
returns text
language sql
immutable
set search_path = ''
as $$ select concat_ws('|', p_folio, p_clave, to_char(p_fecha, 'YYYY-MM-DD'), p_origen, coalesce(p_reversa::text, ''), p_lineas) $$;

create or replace function public.bo_lineas_canon(p_asiento uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(string_agg(n::text || ':' || cuenta || ':' || round(debe * 100)::bigint::text || ':' || round(haber * 100)::bigint::text, ';' order by n), '')
  from public.bo_asiento_linea where asiento_id = p_asiento
$$;

create or replace function public.bo_asegurar_periodo(p_periodo date)
returns date
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_p date := date_trunc('month', p_periodo)::date;
begin
  insert into public.bo_periodo_contable (periodo) values (v_p) on conflict (periodo) do nothing;
  return v_p;
end;
$$;

-- ---------------------------------------------------------------------------
-- ÚNICA vía de escritura del libro. Interna: la usan bo_asentar (asiento normal) y bo_reversar_asiento (reversa enlazada).
-- ---------------------------------------------------------------------------
create or replace function public.bo_asentar_interno(
  p_clave_idem text, p_fecha date, p_descripcion text, p_origen_tipo text, p_origen_id uuid, p_soporte text, p_soporte_ref text,
  p_actor uuid, p_lineas jsonb, p_reversa_de uuid, p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record; v_id uuid; v_periodo date; v_estado text; v_ant text; v_n integer; v_folio text; v_canon text; v_hash text;
  v_d bigint := 0; v_h bigint := 0; v_cnt integer := 0;
begin
  if p_clave_idem is null or char_length(btrim(p_clave_idem)) < 8 then
    raise exception 'la clave de idempotencia es obligatoria (8 caracteres o mas)' using errcode = '22023';
  end if;
  -- Un solo escritor a la vez: la cadena de hash y el folio sin huecos lo exigen.
  perform pg_advisory_xact_lock(hashtextextended('bo_libro:cadena', 0));
  select id into v_id from public.bo_asiento where clave_idem = p_clave_idem;
  if found then return v_id; end if;

  if p_fecha is null then raise exception 'la fecha del asiento es obligatoria' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_descripcion, '')), '') is null then raise exception 'la descripcion del asiento es obligatoria' using errcode = '22023'; end if;
  if p_soporte not in ('cfdi', 'invoice_extranjero', 'ninguno') then raise exception 'soporte invalido: %', p_soporte using errcode = '22023'; end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' then raise exception 'las lineas deben ser un arreglo' using errcode = '22023'; end if;

  for r in
    select t.ord, t.x->>'cuenta' as cuenta, coalesce((t.x->>'debe')::numeric, 0) as debe, coalesce((t.x->>'haber')::numeric, 0) as haber
    from jsonb_array_elements(p_lineas) with ordinality as t(x, ord)
  loop
    v_cnt := v_cnt + 1;
    if r.debe < 0 or r.haber < 0 or r.debe <> round(r.debe, 2) or r.haber <> round(r.haber, 2) then
      raise exception 'monto invalido en la linea %: sin negativos y con a lo mas dos decimales', r.ord using errcode = '22023';
    end if;
    if (r.debe = 0) = (r.haber = 0) then
      raise exception 'la linea % lleva debe o haber (uno solo y mayor que cero)', r.ord using errcode = '22023';
    end if;
    perform 1 from public.bo_cuenta where codigo = r.cuenta and activa;
    if not found then
      raise exception 'la cuenta % no existe o esta inactiva (linea %)', r.cuenta, r.ord using errcode = '22023';
    end if;
    v_d := v_d + round(r.debe * 100)::bigint;
    v_h := v_h + round(r.haber * 100)::bigint;
  end loop;
  if v_cnt < 2 then raise exception 'un asiento necesita al menos dos lineas' using errcode = '22023'; end if;
  if v_d <> v_h then raise exception 'el asiento no cuadra: debe % contra haber % (centavos)', v_d, v_h using errcode = 'P0430'; end if;

  -- Periodo: se crea si falta; aprobado o publicado no admite asientos nuevos (hay que reabrirlo con motivo); preparado vuelve a abierto.
  v_periodo := date_trunc('month', p_fecha)::date;
  perform public.bo_asegurar_periodo(v_periodo);
  select estado into v_estado from public.bo_periodo_contable where periodo = v_periodo for update;
  if v_estado in ('aprobado', 'publicado') then
    raise exception 'el periodo % esta % y no admite asientos nuevos: reabrelo con motivo', v_periodo, v_estado using errcode = 'P0431';
  end if;
  if v_estado = 'preparado' then
    update public.bo_periodo_contable set estado = 'abierto', preparado_en = null where periodo = v_periodo;
  end if;

  update public.bo_folio_contador set ultimo = ultimo + 1 where serie = 'A' returning ultimo into v_n;
  v_folio := 'A-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
  select hash into v_ant from public.bo_asiento order by seq desc limit 1;
  v_ant := coalesce(v_ant, repeat('0', 64));

  select string_agg(t.ord::text || ':' || (t.x->>'cuenta') || ':' || round(coalesce((t.x->>'debe')::numeric, 0) * 100)::bigint::text
                    || ':' || round(coalesce((t.x->>'haber')::numeric, 0) * 100)::bigint::text, ';' order by t.ord)
    into v_canon
  from jsonb_array_elements(p_lineas) with ordinality as t(x, ord);
  v_hash := public.bo_hash_de(v_ant, public.bo_texto_canonico(v_folio, p_clave_idem, p_fecha, p_origen_tipo, p_reversa_de, v_canon));

  insert into public.bo_asiento (seq, folio, clave_idem, fecha_neg, periodo, descripcion, origen_tipo, origen_id, soporte, soporte_ref,
                                 reversa_de, motivo_reversa, es_manual, hash_anterior, hash, creado_por)
  values (v_n, v_folio, p_clave_idem, p_fecha, v_periodo, btrim(p_descripcion), p_origen_tipo, p_origen_id, p_soporte, nullif(btrim(coalesce(p_soporte_ref, '')), ''),
          p_reversa_de, p_motivo, p_origen_tipo = 'manual', v_ant, v_hash, p_actor)
  returning id into v_id;

  insert into public.bo_asiento_linea (asiento_id, n, cuenta, debe, haber, nota)
  select v_id, t.ord::integer, t.x->>'cuenta', coalesce((t.x->>'debe')::numeric, 0), coalesce((t.x->>'haber')::numeric, 0), nullif(btrim(coalesce(t.x->>'nota', '')), '')
  from jsonb_array_elements(p_lineas) with ordinality as t(x, ord);

  return v_id;
end;
$$;

create or replace function public.bo_asentar(
  p_clave_idem text, p_fecha date, p_descripcion text, p_origen_tipo text, p_origen_id uuid, p_soporte text, p_soporte_ref text,
  p_actor uuid, p_lineas jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_origen_tipo = 'reversa' then
    raise exception 'las reversas se hacen con bo_reversar_asiento' using errcode = '22023';
  end if;
  return public.bo_asentar_interno(p_clave_idem, p_fecha, p_descripcion, p_origen_tipo, p_origen_id, p_soporte, p_soporte_ref, p_actor, p_lineas, null, null);
end;
$$;

-- Reversa: mismas líneas con los lados invertidos, enlazada al original, con motivo obligatorio. Solo se reversan asientos MANUALES,
-- una sola vez, y una reversa no se reversa (corrección = asiento nuevo).
create or replace function public.bo_reversar_asiento(p_asiento uuid, p_motivo text, p_actor uuid, p_clave_idem text, p_fecha date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare o public.bo_asiento; v_lineas jsonb; v_id uuid;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'el motivo de la reversa es obligatorio' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bo_libro:cadena', 0));
  select id into v_id from public.bo_asiento where clave_idem = p_clave_idem;
  if found then return v_id; end if;
  select * into o from public.bo_asiento where id = p_asiento;
  if not found then raise exception 'el asiento % no existe', p_asiento using errcode = '22023'; end if;
  if not o.es_manual then raise exception 'solo los asientos manuales se reversan' using errcode = '22023'; end if;
  if o.reversa_de is not null then raise exception 'una reversa no se reversa' using errcode = '22023'; end if;
  if exists (select 1 from public.bo_asiento where reversa_de = p_asiento) then
    raise exception 'el asiento % ya fue reversado', o.folio using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('cuenta', l.cuenta, 'debe', l.haber, 'haber', l.debe, 'nota', l.nota) order by l.n)
    into v_lineas from public.bo_asiento_linea l where l.asiento_id = p_asiento;
  return public.bo_asentar_interno(p_clave_idem, p_fecha, 'Reversa de ' || o.folio || ': ' || o.descripcion, 'reversa', o.id, o.soporte, o.soporte_ref,
                                   p_actor, v_lineas, p_asiento, btrim(p_motivo));
end;
$$;

create or replace function public.bo_reabrir_periodo(p_periodo date, p_motivo text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_p date := date_trunc('month', p_periodo)::date; v_estado text;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'el motivo de la reapertura es obligatorio' using errcode = '22023';
  end if;
  select estado into v_estado from public.bo_periodo_contable where periodo = v_p for update;
  if not found then raise exception 'el periodo % no existe', v_p using errcode = '22023'; end if;
  if v_estado = 'abierto' then raise exception 'el periodo % ya esta abierto', v_p using errcode = '22023'; end if;
  perform set_config('likida.bo_reapertura', v_p::text, true);
  update public.bo_periodo_contable
     set estado = 'abierto', preparado_en = null, aprobado_en = null, aprobado_por = null, publicado_en = null
   where periodo = v_p;
  perform set_config('likida.bo_reapertura', '', true);
  insert into public.bo_periodo_reapertura (periodo, motivo, reabierto_por) values (v_p, btrim(p_motivo), p_actor);
end;
$$;

-- ---------------------------------------------------------------------------
-- Verificación: cadena de hash íntegra y folios sin huecos.
-- ---------------------------------------------------------------------------
create or replace function public.bo_verificar_cadena()
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select s.folio from (
    select a.folio, a.seq, a.hash, a.hash_anterior,
           lag(a.hash) over (order by a.seq) as previo,
           public.bo_hash_de(a.hash_anterior, public.bo_texto_canonico(a.folio, a.clave_idem, a.fecha_neg, a.origen_tipo, a.reversa_de, public.bo_lineas_canon(a.id))) as recalculado
    from public.bo_asiento a) s
  where s.hash <> s.recalculado or s.hash_anterior <> coalesce(s.previo, repeat('0', 64))
  order by s.seq
  limit 1
$$;

create or replace function public.bo_folios_con_huecos()
returns bigint
language sql
stable
set search_path = public, pg_catalog
as $$ select coalesce(max(seq) - count(*), 0)::bigint from public.bo_asiento $$;

-- Comprobaciones por DOS vías (bloqueantes: ningún paquete sale si fallan). Centavos.
create or replace function public.bo_comprobaciones_libro()
returns table (codigo text, nombre text, bloqueante boolean, via_a_nombre text, via_a_cent bigint, via_b_nombre text, via_b_cent bigint, ok boolean)
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_d bigint; v_h bigint; v_n bigint; v_act bigint; v_pas bigint; v_cap bigint; v_res bigint; v_rota text; v_huecos bigint;
begin
  select coalesce(sum(round(l.debe * 100)), 0)::bigint, coalesce(sum(round(l.haber * 100)), 0)::bigint into v_d, v_h from public.bo_asiento_linea l;
  return query select 'C3'::text, 'Balanza: suma del debe contra suma del haber'::text, true, 'Suma del debe'::text, v_d, 'Suma del haber'::text, v_h, v_d = v_h;

  select count(*)::bigint into v_n from (
    select asiento_id from public.bo_asiento_linea group by asiento_id having sum(debe) <> sum(haber)) q;
  return query select 'C10'::text, 'Asientos cuadrados: ninguno con debe distinto de haber'::text, true, 'Asientos descuadrados'::text, v_n, 'Esperados'::text, 0::bigint, v_n = 0;

  v_rota := public.bo_verificar_cadena();
  v_huecos := public.bo_folios_con_huecos();
  return query select 'C21'::text, 'Cadena de hash íntegra y folios sin huecos'::text, true, 'Asiento roto (1) o huecos'::text,
                      (case when v_rota is null then 0 else 1 end)::bigint + v_huecos, 'Esperado'::text, 0::bigint, v_rota is null and v_huecos = 0;

  with t as (
    select c.tipo, sum(case when c.tipo in ('A', 'C', 'G') then round(l.debe * 100) - round(l.haber * 100) else round(l.haber * 100) - round(l.debe * 100) end)::bigint as s
    from public.bo_asiento_linea l join public.bo_cuenta c on c.codigo = l.cuenta group by c.tipo)
  select coalesce((select s from t where tipo = 'A'), 0), coalesce((select s from t where tipo = 'P'), 0), coalesce((select s from t where tipo = 'K'), 0),
         coalesce((select s from t where tipo = 'I'), 0) - coalesce((select s from t where tipo = 'C'), 0) - coalesce((select s from t where tipo = 'G'), 0)
    into v_act, v_pas, v_cap, v_res;
  return query select 'CU1'::text, 'Identidad: activo igual a pasivo más capital más resultado'::text, true, 'Activo'::text, v_act, 'Pasivo más capital más resultado'::text, v_pas + v_cap + v_res,
                      v_act = v_pas + v_cap + v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios: solo service_role; el libro solo se escribe por las funciones (security definer).
-- ---------------------------------------------------------------------------
alter table public.bo_cuenta enable row level security;
alter table public.bo_periodo_contable enable row level security;
alter table public.bo_periodo_reapertura enable row level security;
alter table public.bo_folio_contador enable row level security;
alter table public.bo_asiento enable row level security;
alter table public.bo_asiento_linea enable row level security;

revoke all on table public.bo_cuenta from public, anon, authenticated;
revoke all on table public.bo_periodo_contable from public, anon, authenticated;
revoke all on table public.bo_periodo_reapertura from public, anon, authenticated;
revoke all on table public.bo_folio_contador from public, anon, authenticated;
revoke all on table public.bo_asiento from public, anon, authenticated;
revoke all on table public.bo_asiento_linea from public, anon, authenticated;

grant select, insert, update on table public.bo_cuenta to service_role;
grant select, insert, update on table public.bo_periodo_contable to service_role;
revoke delete, truncate on table public.bo_cuenta from service_role;
revoke delete, truncate on table public.bo_periodo_contable from service_role;
-- Lo que solo escriben las funciones: service_role lee y nada más.
revoke all on table public.bo_periodo_reapertura from service_role;
revoke all on table public.bo_folio_contador from service_role;
revoke all on table public.bo_asiento from service_role;
revoke all on table public.bo_asiento_linea from service_role;
grant select on table public.bo_periodo_reapertura to service_role;
grant select on table public.bo_folio_contador to service_role;
grant select on table public.bo_asiento to service_role;
grant select on table public.bo_asiento_linea to service_role;

revoke all on function public.bo_asentar_interno(text, date, text, text, uuid, text, text, uuid, jsonb, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.bo_asentar(text, date, text, text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.bo_reversar_asiento(uuid, text, uuid, text, date) from public, anon, authenticated;
revoke all on function public.bo_reabrir_periodo(date, text, uuid) from public, anon, authenticated;
revoke all on function public.bo_asegurar_periodo(date) from public, anon, authenticated;
revoke all on function public.bo_verificar_cadena() from public, anon, authenticated;
revoke all on function public.bo_folios_con_huecos() from public, anon, authenticated;
revoke all on function public.bo_comprobaciones_libro() from public, anon, authenticated;
grant execute on function public.bo_asentar(text, date, text, text, uuid, text, text, uuid, jsonb) to service_role;
grant execute on function public.bo_reversar_asiento(uuid, text, uuid, text, date) to service_role;
grant execute on function public.bo_reabrir_periodo(date, text, uuid) to service_role;
grant execute on function public.bo_asegurar_periodo(date) to service_role;
grant execute on function public.bo_verificar_cadena() to service_role;
grant execute on function public.bo_folios_con_huecos() to service_role;
grant execute on function public.bo_comprobaciones_libro() to service_role;

commit;
