-- ═══════════════════════════════════════════════════════════════════════════
-- 0236 — LO QUE LA 0231 PROMETIÓ Y NO CUMPLIÓ (auditoría adversarial, ciclo 7:
--        c7-2, c7-3, c7-13, c7-20, c7-22, c7-27).
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE Y NO SE EDITÓ LA 0231. La 0231 YA ESTÁ
-- APLICADA EN PRODUCCIÓN. Reescribirla dejaría el archivo del repo diciendo
-- una cosa y la base diciendo otra: la migración correctiva es el único camino
-- que deja las dos historias contadas —lo que se creyó, y lo que se corrigió—
-- y es también la única que se puede aplicar sobre la base viva.
--
-- NADA DE ESTO HA ESTALLADO TODAVÍA: `sat_cfdi_descargado` y
-- `sat_descarga_solicitud` tienen 0 filas en producción. Son bombas armadas,
-- y ésa es exactamente la ventana en la que sale barato desarmarlas.
--
-- LAS CINCO PIEZAS:
--
--   1. LAS DOS FK COMPUESTAS CON `SET NULL` SIN LISTA DE COLUMNAS (c7-3,
--      crítico). Es el hueco que la casa ya había identificado por escrito
--      DOS VECES —la 0028 lo declaró fuera de alcance, la 0145 lo cerró con
--      `on delete set null (columna)`— y que la 0231 volvió a abrir.
--   2. EL PROGRESO POR PAQUETE (c7-2, crítico). `paquetes_bajados` es la
--      columna que faltaba para que una solicitud de más de 3 paquetes pueda
--      terminar algún día.
--   3. EL TRASLAPE (c7-22). El índice viejo sólo bloqueaba el PAR EXACTO de
--      fechas; dos rangos distintos sobre los mismos días entraban los dos.
--   4. LOS CONTEOS DE LA PANTALLA (c7-27). Se contaban en JS sobre 20,000
--      filas traídas a mano, sin índice y sin decir que estaban truncadas.
--   5. EL ÍNDICE DEL LADO QUE REFERENCIA (0071). Sin él, borrar un gasto o
--      una solicitud barre `sat_cfdi_descargado` entera.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. c7-3 · EL `SET NULL` COMPUESTO QUE REVENTABA EL BORRADO ─────────────
--
-- Lo que la 0231 escribió (verificado con `pg_get_constraintdef` contra
-- producción):
--
--   sat_cfdi_descargado_gasto_tenant_fkey
--     FOREIGN KEY (gasto_id, tenant_id) REFERENCES gasto(id, tenant_id)
--     ON DELETE SET NULL
--
-- `SET NULL` SIN LISTA DE COLUMNAS anula TODAS las columnas referenciantes —
-- `tenant_id` incluida—, y `sat_cfdi_descargado.tenant_id` es NOT NULL. El
-- camino concreto: una flota casa un CFDI bajado del SAT con el gasto G;
-- alguien borra el viaje del que cuelga G; `gasto_viaje_tenant_fkey ... on
-- delete cascade` (0028:93) borra G en cascada; Postgres intenta poner
-- `sat_cfdi_descargado.tenant_id = NULL` y el DELETE DEL VIAJE ENTERO FALLA
-- con «null value in column "tenant_id" violates not-null constraint» — un
-- error que no dice ni una palabra del origen real. Idéntico con
-- `delete from tenant`, que es el camino de borrado de una flota
-- (`src/lib/admin/qa-motor.ts`).
--
-- La cita textual de la 0028:44-49, que ya lo había visto:
--   «una FK compuesta con SET NULL intentaría anular también el tenant y
--    reventaría el DELETE. Se pueden cerrar con `on delete set null (columna)`
--    (Postgres 15+)…»
-- y la 0145:21-27 lo cerró para el resto de la base: «Postgres 15+ admite
-- `on delete set null (columna)` — anula SOLO esa columna. Producción corre
-- PostgreSQL 17.6». El CI corre postgres:16.4. La forma está disponible en
-- las tres.
--
-- POR QUÉ NO `ON DELETE CASCADE`, que sería más corto: `sat_cfdi_descargado`
-- ES EL SELLO DE DEDUP de toda la feature. Borrar la fila al borrar el gasto
-- dejaría que el mismo folio fiscal volviera a entrar en la siguiente
-- descarga, y la idempotencia de la ingesta se perdería en silencio. El
-- comprobante existe ante el SAT independientemente de que el ticket con el
-- que casó siga en la base: es un hecho, no un detalle del gasto.
--
-- SE BARRIÓ EL RESTO DEL REPO buscando el mismo patrón (todas las FK
-- compuestas `(col, tenant_id)` con `set null`): las de la 0145 (barrido
-- dinámico), 0198, 0203, 0207, 0209 y 0213 YA usan la forma acotada
-- `set null (columna)`. Las dos de la 0231 eran las únicas dos que faltaban.
-- Y para que no vuelva a pasar sin que nadie lo note, el bloque 191 de
-- `supabase/verificaciones.sql` barre el catálogo entero y se pone rojo con
-- cualquier FK futura de esta forma, venga de la migración que venga.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'sat_cfdi_descargado_gasto_tenant_fkey'
       and conrelid = 'public.sat_cfdi_descargado'::regclass
  ) then
    alter table public.sat_cfdi_descargado
      drop constraint sat_cfdi_descargado_gasto_tenant_fkey;
  end if;

  alter table public.sat_cfdi_descargado
    add constraint sat_cfdi_descargado_gasto_tenant_fkey
    foreign key (gasto_id, tenant_id) references public.gasto (id, tenant_id)
    on delete set null (gasto_id);

  if exists (
    select 1 from pg_constraint
     where conname = 'sat_cfdi_descargado_solicitud_tenant_fkey'
       and conrelid = 'public.sat_cfdi_descargado'::regclass
  ) then
    alter table public.sat_cfdi_descargado
      drop constraint sat_cfdi_descargado_solicitud_tenant_fkey;
  end if;

  alter table public.sat_cfdi_descargado
    add constraint sat_cfdi_descargado_solicitud_tenant_fkey
    foreign key (solicitud_id, tenant_id)
    references public.sat_descarga_solicitud (id, tenant_id)
    on delete set null (solicitud_id);
end $$;

comment on constraint sat_cfdi_descargado_gasto_tenant_fkey on public.sat_cfdi_descargado is
  'El comprobante de la flota A no casa con un gasto de la flota B (0028/0145), y al borrarse el gasto se anula SOLO gasto_id — no tenant_id, que es NOT NULL. La forma sin lista de columnas (0231) hacía imposible borrar un viaje con gastos casados o una flota entera: 0236 la acota.';

comment on constraint sat_cfdi_descargado_solicitud_tenant_fkey on public.sat_cfdi_descargado is
  'El comprobante y la solicitud que lo trajo son de la MISMA flota, y al borrarse la solicitud se anula SOLO solicitud_id. El CFDI sobrevive al trámite que lo bajó: es el sello de dedup, y perderlo dejaría entrar el mismo folio otra vez.';


-- ── 1b. EL SEGUNDO CANDADO QUE EL `SET NULL` DESTAPA ───────────────────────
--
-- Acotar el SET NULL a `gasto_id` no basta por sí solo, y esto es fácil de
-- pasar por alto: la 0231 tiene también
--
--   sat_cfdi_descargado_casado_coherente
--     check ((estatus = 'casado' and gasto_id is not null)
--         or (estatus <> 'casado' and gasto_id is null))
--
-- así que un SET NULL sobre una fila `casado` la dejaría diciendo «casé» sin
-- decir con qué — y el CHECK, con toda la razón, volvería a reventar el
-- DELETE del gasto. Cambiar el CHECK sería la salida fácil Y LA EQUIVOCADA:
-- es el candado que impide afirmar un cruce que no existe, o sea la cifra
-- inventada que este producto no se permite.
--
-- La salida correcta es decir la verdad: si el gasto con el que casó se
-- borró, el cruce DEJÓ DE EXISTIR y el comprobante vuelve a estar DISPONIBLE
-- —que es literalmente lo que es: un CFDI bajado del SAT que ningún gasto
-- reclama—. El trigger lo degrada y ESCRIBE POR QUÉ en `candidatos`, con el
-- mismo `{motivo: …}` que usa el ciclo cuando marca un comprobante
-- disponible. Nadie tiene que adivinar después por qué esa fila cambió sola.
--
-- La condición del WHEN es deliberadamente estrecha —la fila TENÍA gasto, ya
-- no lo tiene, y sigue diciendo 'casado'— para que el trigger sólo alcance a
-- la acción referencial y jamás a una escritura de la aplicación
-- (`marcar()` cambia estatus y gasto_id en el mismo UPDATE, así que nunca
-- pasa por aquí).
create or replace function public.sat_cfdi_descargado_gasto_borrado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.estatus := 'disponible';
  new.candidatos := coalesce(new.candidatos, '{}'::jsonb) || jsonb_build_object(
    'motivo',
    'El gasto con el que este comprobante había casado se borró. El CFDI sigue descargado del SAT y vuelve a estar DISPONIBLE: el cruce dejó de existir y afirmarlo sería inventarlo.',
    'gasto_borrado_en', now()
  );
  return new;
end;
$$;

comment on function public.sat_cfdi_descargado_gasto_borrado() is
  'Degrada a «disponible» el comprobante cuya contraparte se borró (0236). Lo dispara la acción referencial `on delete set null (gasto_id)`, no la aplicación: sin él, el CHECK casado_coherente volvería a reventar el DELETE del gasto — que es el bug c7-3 con otra cara.';

drop trigger if exists trg_sat_cfdi_gasto_borrado on public.sat_cfdi_descargado;
create trigger trg_sat_cfdi_gasto_borrado
  before update on public.sat_cfdi_descargado
  for each row
  when (old.gasto_id is not null and new.gasto_id is null and new.estatus = 'casado')
  execute function public.sat_cfdi_descargado_gasto_borrado();


-- ── 1c. EL ÍNDICE DEL LADO QUE REFERENCIA (0071) ───────────────────────────
-- Postgres NO indexa el lado que REFERENCIA de una FK, y las dos acciones de
-- arriba son UPDATEs disparados por un DELETE: sin índice, borrar UN gasto
-- obliga a barrer `sat_cfdi_descargado` entera. Con una flota de 45,000
-- comprobantes eso convierte un borrado de viaje en un seq scan. El mismo
-- índice sirve para contar los folios NUEVOS de una solicitud (c7-20).
create index if not exists sat_cfdi_descargado_gasto_idx
  on public.sat_cfdi_descargado (tenant_id, gasto_id)
  where gasto_id is not null;

create index if not exists sat_cfdi_descargado_solicitud_idx
  on public.sat_cfdi_descargado (tenant_id, solicitud_id)
  where solicitud_id is not null;


-- ── 2. c7-2 · EL PROGRESO POR PAQUETE ──────────────────────────────────────
--
-- La 0231 guarda `paquetes` (los que el SAT reporta listos) pero NINGUNA
-- columna de los que ya se bajaron, y el ciclo baja como máximo 3 por corrida.
-- Resultado: una solicitud con más de 3 paquetes —cualquier primera descarga
-- de 90 días de una flota mediana, porque el SAT parte hasta 200,000 CFDI en
-- paquetes— NUNCA TERMINA. El cuarto paquete agota el tope, la solicitud no
-- pasa a 'descargada', `ultima_descarga_hasta` no avanza, y la corrida
-- siguiente vuelve a empezar POR EL PRIMERO. Cada 6 horas, contra el buzón
-- fiscal real, para siempre — y a partir de la tercera vuelta cada descarga
-- es un rechazo, porque el paquete del SAT vive 72 h y se baja 2 veces.
--
-- `paquetes_bajados` es la memoria que faltaba: el arreglo de los paquetes YA
-- INGERIDOS de esta solicitud. El ciclo baja los pendientes, lo va escribiendo
-- paquete por paquete (un crash a medias no pierde el avance) y cierra la
-- solicitud sólo cuando no queda ninguno.
--
-- NULL NO ES `[]`, y aquí importa: NULL significa NO SE HA BAJADO NINGUNO
-- —la solicitud todavía no llegó a esa etapa— y `[]` sería el resultado
-- medido de una lista vacía. El ciclo nunca escribe `[]`: o hay avance que
-- contar, o la columna se queda como estaba.
alter table public.sat_descarga_solicitud
  add column if not exists paquetes_bajados jsonb;

comment on column public.sat_descarga_solicitud.paquetes_bajados is
  'Los paquetes de esta solicitud que YA se bajaron E INGIRIERON, para reanudar por el primero pendiente en vez de volver a empezar (0236, c7-2). NULL = todavía no se ha bajado ninguno; jamás se escribe [] . Sin esta columna, una solicitud de más de 3 paquetes re-descargaba los mismos 3 cada 6 horas para siempre y sus CFDI no entraban nunca.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'sat_descarga_solicitud_paquetes_bajados_arreglo'
       and conrelid = 'public.sat_descarga_solicitud'::regclass
  ) then
    -- La forma, en la base: si algún día alguien escribe aquí un objeto o un
    -- número, el ciclo leería basura y "reanudar" dejaría de significar nada.
    alter table public.sat_descarga_solicitud
      add constraint sat_descarga_solicitud_paquetes_bajados_arreglo
      check (paquetes_bajados is null or jsonb_typeof(paquetes_bajados) = 'array');
  end if;
end $$;


-- ── 3. c7-22 · EL TRASLAPE, NO SÓLO EL PAR EXACTO ──────────────────────────
--
-- `uq_sat_solicitud_viva` era `unique (tenant_id, tipo, desde, hasta) where
-- estado in ('solicitada','en_proceso','lista')`, y el comentario de la 0231
-- prometía que «no puede pedir dos veces lo mismo mientras el SAT lo
-- procesa». La promesa se viola sin esfuerzo con rangos DISTINTOS que cubren
-- los mismos días: el cron abre 2026-08-01→2026-08-31, el contralor —viendo
-- que tarda— pide a mano 2026-08-01→2026-08-30, el par es distinto, el índice
-- no dice nada, y quedan DOS TRÁMITES VIVOS sobre 30 días idénticos. Dos
-- peticiones al SAT y el tope diario del RFC quemado dos veces contra el mismo
-- periodo. El mensaje «Ese rango ya tiene una solicitud en curso ante el SAT»,
-- que ya estaba escrito, no aparecía nunca.
--
-- Una restricción de exclusión sobre `daterange(desde, hasta, '[]')` cubre el
-- traslape de verdad y es a prueba de carreras, que es lo que un `if` en
-- TypeScript no puede ser. El rango va CERRADO en los dos extremos ('[]')
-- porque `desde` y `hasta` son días pedidos AL SAT, los dos inclusive: con
-- '[)' dos solicitudes que compartieran el último día se leerían como
-- disjuntas.
--
-- SE RETIRA `uq_sat_solicitud_viva`: un rango se traslapa consigo mismo, así
-- que la exclusión lo SUBSUME por completo. Dejar los dos no daría ninguna
-- garantía extra y sí haría impredecible QUÉ error sale (23505 o 23P01) ante
-- un duplicado exacto — y el código de arriba tiene que poder distinguir «ya
-- lo pidió otro» de un fallo de verdad (c7-19).
create extension if not exists btree_gist with schema extensions;

drop index if exists public.uq_sat_solicitud_viva;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'sat_solicitud_viva_sin_traslape'
       and conrelid = 'public.sat_descarga_solicitud'::regclass
  ) then
    -- Las clases de operador van calificadas con su esquema: `btree_gist`
    -- vive en `extensions` (convención de la casa desde la 0154/0160) y ese
    -- esquema NO está en el search_path por defecto.
    alter table public.sat_descarga_solicitud
      add constraint sat_solicitud_viva_sin_traslape
      exclude using gist (
        tenant_id extensions.gist_uuid_ops with =,
        tipo      extensions.gist_text_ops with =,
        daterange(desde, hasta, '[]') with &&
      ) where (estado in ('solicitada', 'en_proceso', 'lista'));
  end if;
end $$;

comment on constraint sat_solicitud_viva_sin_traslape on public.sat_descarga_solicitud is
  'Ni un solo DÍA se pide dos veces mientras el SAT lo procesa (0236, c7-22). Sustituye a uq_sat_solicitud_viva, que sólo bloqueaba el PAR EXACTO de fechas: dos rangos distintos sobre los mismos días entraban los dos y quemaban el tope diario del RFC contra el mismo periodo. Los estados terminales (descargada/error/expirada) quedan fuera del índice parcial: un reintento deliberado sigue siendo legítimo.';


-- ── 4. c7-27 · LOS CONTEOS DE LA PANTALLA, CONTADOS EN LA BASE ─────────────
--
-- La pantalla traía hasta 20,000 `estatus` y los contaba en JavaScript. Una
-- flota con 45,000 comprobantes —la propia 0231 dice que el modo webservice
-- trae 200,000 CFDI por petición— leía «descargados: 20,000 · casados: 13,102
-- · disponibles: 4,880» con las CUATRO cifras falsas y `incompleta` en false,
-- porque no hubo ningún error: sólo un `.limit()`. Una cifra truncada que no
-- se declara truncada es una cifra inventada.
--
-- Se cuenta donde se puede contar bien. El índice de apoyo tampoco existía: el
-- único sobre `estatus` es parcial (`where estatus in ('disponible',
-- 'ambiguo')`) y no cubre 'casado' ni 'ignorado', que es justo lo que la
-- pantalla necesita.
create index if not exists sat_cfdi_descargado_estatus_idx
  on public.sat_cfdi_descargado (tenant_id, estatus);

create or replace function public.sat_descarga_conteos(p_tenant uuid)
returns table (
  descargados bigint,
  casados     bigint,
  ambiguos    bigint,
  disponibles bigint,
  ignorados   bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*),
         count(*) filter (where estatus = 'casado'),
         count(*) filter (where estatus = 'ambiguo'),
         count(*) filter (where estatus = 'disponible'),
         count(*) filter (where estatus = 'ignorado')
    from public.sat_cfdi_descargado
   where tenant_id = p_tenant;
$$;

comment on function public.sat_descarga_conteos(uuid) is
  'Los cuatro cubos de la pantalla de descarga del SAT, contados EN LA BASE (0236, c7-27). Antes se traían 20,000 filas y se contaban en JS: con más comprobantes que eso, las cuatro cifras salían falsas y la pantalla no lo decía. El tenant SIEMPRE en el where — el id de otra flota no abre nada.';

-- Mismo doble candado que el resto de la feature: nadie más que el servidor.
revoke execute on function public.sat_descarga_conteos(uuid) from public, anon, authenticated;
grant  execute on function public.sat_descarga_conteos(uuid) to service_role;
