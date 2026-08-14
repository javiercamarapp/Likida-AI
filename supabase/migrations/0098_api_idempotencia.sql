-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCIA DURABLE DE LA API v1 — la capa que faltaba
--
-- `_escritura.ts` documenta el hueco desde que se escribió, y esta migración es
-- la que lo cierra. Vale la pena repetir el problema entero, porque el que se
-- cierra aquí NO es el que la gente supone.
--
-- ── LO QUE YA ESTABA PROTEGIDO ───────────────────────────────────────────
--
-- El duplicado, que es el daño caro, ya no podía ocurrir: antes de insertar se
-- busca por la llave natural (`viaje_folio_unico`, `unidad_economico_unico`) y
-- si el insert choca igual se relee y se devuelve la fila que existe. Por más
-- veces que un TMS reintente, no hay dos viajes con el mismo folio en una
-- flota. Eso sigue igual y NO depende de esta tabla.
--
-- ── LO QUE NO ESTABA, Y ES LO QUE ESTA TABLA ARREGLA ─────────────────────
--
-- La capa 1 era un Map en memoria. En Vercel cada instancia arranca con el
-- suyo vacío, así que dos consecuencias cruzaban instancias sin cubrirse:
--
--  1. **La MISMA llave con un cuerpo DISTINTO no se detectaba.** El integrador
--     manda `folio: VJ-9` con un error de mapeo, corrige el cuerpo y reusa la
--     misma `Idempotency-Key` creyendo que "reintenta". Hoy recibe un 200 con
--     el viaje viejo y `idempotente: true`, y se va convencido de que su
--     corrección se guardó. Nada se corrompe —por eso se eligió así— pero se
--     va con una creencia falsa, que es la clase de silencio que este repo
--     persigue. Con la huella del cuerpo guardada, eso es un 400 que lo dice.
--     400 y no 409 porque `CodigoError` (en `_comun.ts`) es un dominio CERRADO
--     sobre el que el integrador ramifica: agregarle un código rompe a los
--     clientes ya escritos, y el mensaje ya explica exactamente qué hacer.
--
--  2. **El reintento no devolvía la MISMA respuesta, sino una equivalente.**
--     Suficiente para no duplicar; insuficiente para un cliente generado que
--     compara cuerpos.
--
-- ── POR QUÉ LA LLAVE LLEVA TENANT Y RUTA, NO SOLO LA LLAVE ───────────────
--
-- Una `Idempotency-Key` la elige el CLIENTE. Dos flotas distintas pueden mandar
-- la misma —un `1`, un `test`, el mismo uuid copiado del ejemplo de la doc— y
-- si la llave fuera única global, la segunda flota recibiría de vuelta la
-- respuesta de la primera: los datos de otra empresa, servidos por el
-- mecanismo que existe para proteger. El `tenant_id` va PRIMERO en la llave
-- por eso, y no por el índice.
--
-- La `ruta` entra por lo mismo en pequeño: un cliente que reusa su llave entre
-- `POST /viajes` y `POST /unidades` recibiría el cuerpo del recurso
-- equivocado.
--
-- ── LA RETENCIÓN ES PARTE DEL DISEÑO, NO UNA TAREA PENDIENTE ─────────────
--
-- Un reintento honesto ocurre en segundos o minutos; a los días ya no es un
-- reintento, es una petición nueva que casualmente repite la llave. Guardar
-- estas filas para siempre haría crecer la tabla con el tráfico total de la
-- API sin que ninguna de esas filas vuelva a leerse. Se purgan con el cron que
-- ya existe; el índice por fecha es para ese borrado, no para consultas.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.api_idempotencia (
  tenant_id   uuid        not null references public.tenant(id) on delete cascade,
  -- La ruta lógica, no la URL: 'v1.viajes.post'. Es la misma cadena que ya usa
  -- `escribir({ evento })` para el log, así que no hay una segunda opinión
  -- sobre cómo se llama una operación.
  ruta        text        not null,
  llave       text        not null,

  -- SHA-256 del cuerpo normalizado. Se guarda el HASH y no el cuerpo: el cuerpo
  -- de un viaje trae folio, ruta y montos —datos de la flota— y para lo único
  -- que hace falta aquí es para responder "¿es el mismo cuerpo, sí o no?".
  -- Un hash contesta eso y no guarda nada que se pueda leer.
  huella      text        not null,

  -- La respuesta EXACTA que se sirvió, para volver a servirla tal cual. Sí trae
  -- datos (el id y el folio creados), y es el precio de poder prometer "la
  -- misma respuesta". Por eso esta tabla se purga.
  status      smallint    not null,
  cuerpo      jsonb       not null,

  created_at  timestamptz not null default now(),

  primary key (tenant_id, ruta, llave)
);

-- La forma de la llave se fija en la BASE además de en el código porque esta
-- tabla decide qué respuesta recibe quién: una llave vacía o de un carácter
-- colisionaría entre peticiones sin relación, y el que llegara segundo
-- recibiría la respuesta del primero.
alter table public.api_idempotencia
  drop constraint if exists api_idempotencia_llave_forma;
alter table public.api_idempotencia
  add constraint api_idempotencia_llave_forma
  check (length(llave) between 8 and 200 and llave !~ '[[:cntrl:]]');

alter table public.api_idempotencia
  drop constraint if exists api_idempotencia_huella_forma;
alter table public.api_idempotencia
  add constraint api_idempotencia_huella_forma
  check (huella ~ '^[0-9a-f]{64}$');

-- Solo se escriben respuestas que la API de verdad sirvió. Un 500 no se
-- recuerda a propósito: un fallo SÍ se puede reintentar, y grabarlo dejaría al
-- integrador atrapado replayando su propio error.
alter table public.api_idempotencia
  drop constraint if exists api_idempotencia_status_dominio;
alter table public.api_idempotencia
  add constraint api_idempotencia_status_dominio
  check (status in (200, 201));

-- Para el purgado, no para consultar. Sin él, el `delete … where created_at <`
-- del cron recorre la tabla entera cada noche.
create index if not exists api_idempotencia_por_fecha
  on public.api_idempotencia (created_at);

-- RLS ENCENDIDA Y SIN NINGUNA POLÍTICA, y es deliberado, no un olvido.
--
-- Esta tabla no se lee nunca desde el panel ni desde una sesión de usuario: la
-- escribe y la lee EXCLUSIVAMENTE la capa de API con service role, que salta
-- RLS por diseño. Encenderla sin políticas es lo que garantiza que ningún
-- camino con la llave anónima o de usuario pueda tocarla — ni siquiera por
-- error, el día que alguien exponga un `select *` genérico. Una política
-- "por flota" sería peor: daría la impresión de que este contenido es del
-- cliente, y no lo es. Es plomería del transporte.
alter table public.api_idempotencia enable row level security;

comment on table public.api_idempotencia is
  'Respuestas ya servidas de las escrituras de la API v1, por (flota, ruta, Idempotency-Key). Cierra el hueco que el Map en memoria no podía: misma llave con cuerpo DISTINTO cruzando instancias, que hoy devuelve 200 con la fila vieja y manda al integrador convencido de que su corrección se guardó. El duplicado NUNCA dependió de esta tabla: eso lo protege la llave natural. Se purga: un reintento honesto ocurre en minutos.';
comment on column public.api_idempotencia.huella is
  'SHA-256 del cuerpo normalizado. Se guarda el hash y no el cuerpo porque lo único que hace falta contestar es "¿es el mismo cuerpo?", y un hash lo contesta sin almacenar datos de la flota.';
comment on column public.api_idempotencia.llave is
  'La Idempotency-Key la elige el CLIENTE, así que dos flotas pueden mandar la misma. El tenant_id va PRIMERO en la llave primaria por eso: sin él, la segunda flota recibiría la respuesta de la primera.';

-- ── EL PURGADO, EN EL MISMO SITIO QUE EL RESTO ─────────────────────────────
--
-- Se extiende `mantenimiento_de_datos` en vez de abrir un segundo camino de
-- borrado: un `delete` suelto en la ruta del cron sería una tabla que alguien
-- puede olvidar cuando toque la función, y dos lugares donde buscar por qué
-- algo desapareció.
--
-- SIETE DÍAS, no treinta como WhatsApp. Un reintento honesto ocurre en
-- segundos; a la semana ya no es un reintento sino una petición nueva que
-- casualmente repite la llave, y para ésa la respuesta correcta la da la llave
-- natural. Retener más solo guardaría cuerpos con datos de la flota que nadie
-- va a volver a leer.
create or replace function public.purgar_api_idempotencia(
  p_dias  integer     default 7,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare n bigint;
begin
  delete from public.api_idempotencia
   where created_at < p_ahora - make_interval(days => p_dias);
  get diagnostics n = row_count;
  return n;
end $$;

-- EL `revoke` NO ES CEREMONIA: sin él, Postgres deja EXECUTE a PUBLIC y
-- Supabase publica la función en PostgREST como /rest/v1/rpc/. Al ser
-- SECURITY DEFINER corre como `postgres` y SALTA la RLS que esta misma
-- migración acaba de encender — o sea que cualquiera con la anon key (que va
-- en el bundle del navegador, es pública por diseño) podría llamarla con
-- `p_dias = 0` y vaciar la tabla desde internet, en bucle y sin autenticarse.
--
-- Se escribió sin esto el 14-ago-2026 y se detectó en la auditoría del mismo
-- día: era la ÚNICA función del repo alcanzable por `anon`. Sus tres gemelas
-- (`purgar_wa_mensaje_procesado` en la 0072, `consolidar_llm_costo_mensual`,
-- `mantenimiento_de_datos`) sí lo traían; el patrón existía y se omitió.
revoke all on function public.purgar_api_idempotencia(integer, timestamptz) from public;
revoke all on function public.purgar_api_idempotencia(integer, timestamptz) from anon;
revoke all on function public.purgar_api_idempotencia(integer, timestamptz) from authenticated;
grant execute on function public.purgar_api_idempotencia(integer, timestamptz) to service_role;

create or replace function public.mantenimiento_de_datos(
  p_dias_wa integer     default 30,
  p_ahora   timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare wa bigint; ia bigint; idem bigint;
begin
  wa   := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora);
  ia   := public.consolidar_llm_costo_mensual(p_ahora);
  idem := public.purgar_api_idempotencia(7, p_ahora);
  return jsonb_build_object(
    'waPurgados', wa,
    'diasWa', p_dias_wa,
    'iaConsolidados', ia,
    'llmCostoPurgado', false,
    'idempotenciaPurgada', idem,
    'corridaEn', p_ahora
  );
end $$;
