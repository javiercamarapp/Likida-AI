-- ═══════════════════════════════════════════════════════════════════════════
-- 0240 — EL CARRIL COMPLETO DEL PANEL DE QA (Fase C): una corrida deja de
--        caber en una sola invocación, y el avance se guarda FOTO POR FOTO.
--
-- EL PROBLEMA QUE VIENE A RESOLVER. `MAX_FOTOS_CARRIL_RAPIDO = 10`
-- (qa-tipos.ts) no era un capricho: el carril rápido corre dentro de una
-- función serverless con `maxDuration`, y subir la constante a 91 no daría 91
-- fotos procesadas — daría una corrida MUERTA A LA MITAD, que además mentiría
-- (el estado se queda en 'corriendo' y nadie sabe cuántas alcanzaron a
-- medirse). Javier metió 91 comprobantes reales al banco el 25-ago-2026 y con
-- diez no se prueba nada.
--
-- LA FORMA DE LA CURA. La corrida larga avanza en VARIAS PASADAS: cada pasada
-- es una invocación con su propio reloj, procesa las fotos que le alcancen, y
-- deja escrito exactamente cuáles. La siguiente pasada continúa desde ahí. Lo
-- que el número de fotos deja de limitar lo siguen limitando el RELOJ y el
-- DINERO, que es lo que de verdad se acaba.
--
-- POR QUÉ ESTO ES DDL Y NO UN `if` EN TYPESCRIPT. Dos pasadas pueden
-- solaparse (el navegador reintenta, alguien abre la pantalla en dos pestañas,
-- una pasada que Vercel dio por muerta sigue viva unos segundos más). Un
-- `if (yaProcesada)` leído antes de mandar la foto es una CARRERA: los dos
-- lados leen "no", los dos mandan, y el ticket se procesa —y se paga— dos
-- veces. La idempotencia de esta tabla es la PK `(corrida_id, foto_id)`: el
-- segundo intento rebota con 23505 y el motor lo lee como lo que es (esa foto
-- ya tiene dueño), no como un error. Es la misma lección que la 0185 aprendió
-- con `qa_foto.hash` y que `uq_gasto_img_hash` aplica en producción.
--
-- LO QUE NO CAMBIA. Los topes de DINERO se quedan enteros: `TOPE_CORRIDA_USD`
-- ($2, config.qa.ts del ejército) y `TOPE_DIA_USD` ($5, qa-tipos.ts). Son lo
-- único que separa una corrida de pruebas de una factura sorpresa, y con 91
-- fotos el gasto es real. El costo que se guarda aquí sigue siendo el MEDIDO
-- (leído de `llm_costo`, o sea lo que reportó el proveedor del modelo), nunca
-- una estimación. Tampoco cambia el tope del carril rápido: el rápido sigue
-- siendo rápido y sigue teniendo su diez. Lo que se agrega es el OTRO carril.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Lo que una corrida larga necesita recordar entre pasadas ───────────────
--
-- `memoria` guarda (a) las identidades sintéticas —tenant, viaje, teléfono, y
-- el segundo chofer cuando el guion lo pide— para que la pasada 2 continúe
-- sobre el MISMO tenant en vez de sembrar otro; (b) el dato del ataque de
-- dedup cuando el guion repite una foto, porque el oráculo #3 se corre en una
-- pasada POSTERIOR a la que lo montó; y (c) los MENSAJES de bitácora vistos,
-- que es lo único que el oráculo #8 mira. Sin (c), una corrida larga juzgaría
-- el invariante #8 con los eventos de la última pasada nada más y diría que
-- "la bitácora registró lo ocurrido" sabiendo sólo el final.
--
-- Es jsonb y no un puñado de FKs a propósito, y el porqué importa: esas filas
-- son sintéticas y se BORRAN en la limpieza (`delete from tenant` en cascada),
-- mientras que la corrida tiene que sobrevivir a su propio tenant — es la
-- evidencia de lo que pasó. Una FK con `on delete set null` vaciaría justo el
-- dato que después explica la corrida; una con `on delete cascade` borraría la
-- corrida entera. El historial de la 0231 (arreglada por la 0236) es el
-- recordatorio de lo caro que sale elegir mal ese `on delete`.
alter table public.qa_corrida
  add column if not exists memoria jsonb;

-- Dónde va la corrida. El `estado` de la 0185 dice cómo terminó; esto dice
-- por dónde va mientras no termina, que es lo que una corrida de varias
-- pasadas necesita para retomar sin repetir.
alter table public.qa_corrida
  add column if not exists fase text not null default 'siembra';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qa_corrida_fase_dominio'
  ) then
    alter table public.qa_corrida
      add constraint qa_corrida_fase_dominio
      check (fase in ('siembra', 'fotos', 'cierre', 'oraculos', 'limpieza', 'terminada'));
  end if;
end $$;

-- POR QUÉ SE CORTÓ LA ÚLTIMA PASADA. Nunca se infiere de un conteo: si la
-- corrida paró, paró por el reloj o por el dinero, y la pantalla tiene que
-- poder decir CUÁL sin adivinarlo. NULL = no se cortó (o todavía no ha
-- corrido ninguna pasada), que no es lo mismo que "se cortó por nada".
alter table public.qa_corrida
  add column if not exists corte text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qa_corrida_corte_dominio'
  ) then
    alter table public.qa_corrida
      add constraint qa_corrida_corte_dominio
      check (corte is null or corte in ('reloj', 'dinero'));
  end if;
end $$;

-- Cuántas pasadas lleva. Se enseña en la pantalla: una corrida que va en la
-- pasada 7 de 91 fotos está avanzando, y una que lleva 40 pasadas sin mover
-- el conteo está atorada — dos cosas que un spinner no distingue.
alter table public.qa_corrida
  add column if not exists pasadas integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qa_corrida_pasadas_no_negativas'
  ) then
    alter table public.qa_corrida
      add constraint qa_corrida_pasadas_no_negativas check (pasadas >= 0);
  end if;
end $$;

-- EL CANDADO DE UNA PASADA A LA VEZ. Guarda el id de la pasada que tiene la
-- corrida tomada; NULL = libre. La toma es un UPDATE condicional (`… where id
-- = ? and pasada_en_vuelo is null`), o sea que la arbitra Postgres y no un
-- `if` del servidor: dos invocaciones simultáneas piden, una gana y la otra
-- lee 0 filas y se va sin gastar un peso. `latido_en` (0185) es el que permite
-- soltar una pasada que murió sin devolver la llave — se reclama sólo cuando
-- lleva más que el techo de una pasada sin dar señales, nunca "por si acaso".
alter table public.qa_corrida
  add column if not exists pasada_en_vuelo uuid;

comment on column public.qa_corrida.memoria is
  'Lo que una corrida larga recuerda entre pasadas: identidades sintéticas (tenant/viaje/teléfono, y el 2º chofer si el guion lo usa), el dato del ataque de dedup para el oráculo #3, y los mensajes de bitácora vistos para el oráculo #8. jsonb y no FKs: esas filas se borran en la limpieza y la corrida tiene que sobrevivirlas — es la evidencia.';
comment on column public.qa_corrida.fase is
  'Por dónde va la corrida entre pasadas: siembra → fotos → cierre → oraculos → limpieza → terminada. `estado` dice cómo terminó; `fase` dice dónde retomar.';
comment on column public.qa_corrida.corte is
  'Por qué paró la última pasada: reloj | dinero. NULL = no se cortó. Nunca se infiere de un conteo — la pantalla lo DICE con la palabra exacta.';
comment on column public.qa_corrida.pasada_en_vuelo is
  'Id de la pasada que tiene la corrida tomada; NULL = libre. La toma es un UPDATE condicional que arbitra Postgres: dos pasadas simultáneas no pueden gastar dos veces.';

-- ── EL AVANCE, FOTO POR FOTO ───────────────────────────────────────────────
create table if not exists public.qa_corrida_foto (
  corrida_id uuid not null references public.qa_corrida(id) on delete cascade,
  -- `on delete restrict` a propósito, y en contra del reflejo de poner
  -- cascade: si alguien depura el banco, lo que NO puede pasar es que
  -- desaparezca en silencio la prueba de que esta corrida procesó ese ticket y
  -- cuánto costó. El borrado del banco rebota diciendo que hay corridas que lo
  -- citan — fallar cerrado y decirlo, que es la regla de la casa.
  foto_id    uuid not null references public.qa_foto(id) on delete restrict,
  -- El orden dentro de la corrida (1-based): es el que la pantalla usa para
  -- decir "foto 47 de 91" sin recalcular nada.
  n          integer not null check (n > 0),
  -- 'corriendo' es un estado REAL y persistido, no un adorno: es la marca que
  -- una pasada deja antes de mandar la foto. Si la invocación muere ahí, la
  -- fila queda en 'corriendo' y la siguiente pasada la lee por lo que es —una
  -- foto que se empezó y no se sabe cómo acabó— y la pasa a 'interrumpida'.
  -- Ni acierto ni fallo: "no se procesó" ≠ "salió mal".
  estado     text not null check (estado in ('corriendo', 'ok', 'bad', 'interrumpida')),
  -- En qué pasada se tomó. Con esto, "cuántas fotos hizo la pasada 3" es una
  -- consulta y no una reconstrucción a ojo.
  pasada     integer not null check (pasada > 0),
  detalle    text,
  -- NULL = NO SE MIDIÓ, y jamás 0 por omisión. Un 0 aquí diría "esta foto no
  -- costó nada", que es una afirmación; NULL dice "no se sabe", que es la
  -- verdad cuando la lectura de llm_costo no alcanzó a correr. La regla de la
  -- casa es explícita: null jamás se vuelve 0 ni NaN.
  costo_usd  numeric(12,4) check (costo_usd is null or costo_usd >= 0),
  inicio     timestamptz not null default now(),
  fin        timestamptz,
  -- ═════════════════════════════════════════════════════════════════════════
  -- LA IDEMPOTENCIA ES ESTA LÍNEA. No un `if (yaProcesada)` antes de mandar:
  -- eso es una carrera, y una carrera perdida aquí significa mandar el mismo
  -- ticket dos veces al modelo (dinero real) y contarlo dos veces (una cifra
  -- inventada). Con la PK, la segunda pasada que intente tomar la misma foto
  -- rebota con 23505 y el motor lo lee como "esa ya tiene dueño".
  -- ═════════════════════════════════════════════════════════════════════════
  primary key (corrida_id, foto_id)
);

comment on table public.qa_corrida_foto is
  'El avance de una corrida larga (carril completo), UNA FILA POR FOTO. La PK (corrida_id, foto_id) es la garantía de que una foto no se procesa dos veces aunque dos pasadas se solapen: el segundo intento rebota con 23505. costo_usd NULL = no medido, nunca 0.';
comment on column public.qa_corrida_foto.estado is
  'corriendo = tomada por una pasada y todavía sin cerrar; ok/bad = terminó; interrumpida = una pasada murió con ella en vuelo y NO se sabe cómo acabó (ni acierto ni fallo).';
comment on column public.qa_corrida_foto.costo_usd is
  'Costo MEDIDO de esta foto, leído de llm_costo (lo que reportó el proveedor del modelo). NULL = no se pudo medir; jamás se rellena con 0.';

-- La pantalla pide el avance de UNA corrida en orden — el índice es sobre la
-- misma expresión que la consulta usa, o no lo usa.
create index if not exists qa_corrida_foto_orden_idx
  on public.qa_corrida_foto (corrida_id, n);

-- ── RLS deny-all + grants sólo a service_role ──────────────────────────────
-- Mismo patrón que la 0185 (qa_foto/qa_corrida/qa_corrida_paso) y que
-- despliegue_visto (0234): esto es superficie de superadmin y sólo
-- supabaseAdmin() (server, bypassa RLS) la toca. Sin policies, RLS deniega a
-- anon y authenticated; el `revoke` + `grant` explícitos cierran además la vía
-- de un grant heredado, que es el hallazgo que los advisors de la 0234 buscan.
alter table public.qa_corrida_foto enable row level security;
revoke all on table public.qa_corrida_foto from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_corrida_foto to service_role;
