-- ═══════════════════════════════════════════════════════════════════════════
-- 0243 — LA BANDEJA DE CONCILIACIÓN DEL SAT: donde el contralor DECIDE.
--
-- EL HUECO QUE CIERRA. La descarga masiva (0231, corregida por la 0236) baja
-- los CFDI del buzón fiscal y los cruza contra los gastos que reportaron los
-- choferes. Cuando el cruce es limpio, el comprobante queda 'casado' y no hace
-- falta nadie. Pero dos de los cuatro estatus EXISTEN PRECISAMENTE PARA QUE UN
-- HUMANO DECIDA:
--
--   · 'ambiguo'    — varios gastos empataron (van en `candidatos jsonb`) y el
--                    motor se NIEGA a adivinar: mientras hay candidatos,
--                    `gasto_id` es NULL (mismo criterio que
--                    `cfdi_consolidado_linea.candidatos`, 0076).
--   · 'disponible' — bajó del SAT y ningún gasto lo reclama. Es un hallazgo
--                    por derecho propio: alguien gastó y nadie lo reportó.
--
-- …y hasta hoy no había dónde decidir. La pantalla enseñaba cinco CIFRAS
-- (`sat_descarga_conteos`, 0236) y una tarjeta que decía «Esperan que tú
-- decidas» sin una lista, sin un botón y sin forma de elegir un candidato.
-- Las columnas `resuelto_por` y `resuelto_en` que la 0231 creó para registrar
-- quién resolvió NO TENÍAN UN SOLO ESCRITOR en `src/`: los únicos escritores de
-- la tabla eran el ciclo automático (`sat_descarga/ciclo.ts`).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LAS CUATRO PIEZAS
--
--   1. `resuelto_por_email` — LA FIRMA QUE SOBREVIVE AL BORRADO DE LA CUENTA.
--      `resuelto_por` es uuid con `on delete set null` (ARCO): el día que la
--      cuenta de quien resolvió se borra, el expediente pierde la firma y
--      queda un cruce que nadie hizo. Mismo patrón —y misma razón— que
--      `cola_aprobacion.resuelto_por_email` (0120) y `jornada_dia
--      .cerrado_por_email` (0241). El CHECK lo exige en los dos sentidos.
--   2. `sat_cfdi_resolucion` — EL EXPEDIENTE APPEND-ONLY DE CADA ACTO HUMANO.
--      Ligar, ignorar y REVERTIR dejan fila. Corregir es anotar, no
--      sobrescribir (criterio de `jornada_asiento`, 0241): un cruce mal hecho
--      se deshace ANOTANDO quién lo deshizo y por qué, jamás borrando el
--      rastro de que se había hecho.
--   3. EL ÍNDICE DE LA LISTA. La bandeja pagina de verdad —esta tabla puede
--      crecer a 200,000 CFDI por petición según la propia 0231— y ordena por
--      fecha dentro de un estatus. Sin este índice esa consulta es un sort
--      sobre la tabla entera; y un `.limit()` sin `.order()` alimentando una
--      cifra publicada es una cifra inventada (hallazgo c7-4).
--   4. EL TRIGGER DE LA 0236, HONESTO HASTA EL FINAL. Cuando el gasto con el
--      que un comprobante había casado se borra, la base lo degrada a
--      'disponible'. Faltaba lo demás: la firma vieja se quedaba pegada
--      —«resuelto por Ana» sobre una fila que ya no está resuelta— y la
--      reversión de la máquina no dejaba rastro. Ahora limpia la firma y
--      ESCRIBE su propio renglón en el expediente.
--
-- NO SE AFLOJA `sat_cfdi_descargado_casado_coherente`. Ese CHECK es lo que
-- impide afirmar un cruce que no existe, y toda esta bandeja se construye
-- PARA RESPETARLO: resolver un ambiguo escribe estatus y gasto en el MISMO
-- update; revertir los limpia en el MISMO update. Ninguna escritura de aquí
-- deja jamás la fila en el estado intermedio que el CHECK prohíbe.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. LA FIRMA QUE SOBREVIVE AL BORRADO DE LA CUENTA ──────────────────────
alter table public.sat_cfdi_descargado
  add column if not exists resuelto_por_email text;

comment on column public.sat_cfdi_descargado.resuelto_por_email is
  'SNAPSHOT del correo de quien resolvió este comprobante a mano (patrón cola_aprobacion.resuelto_por_email 0120 y jornada_dia.cerrado_por_email 0241). Existe porque resuelto_por es uuid con `on delete set null` para ARCO: sin este snapshot, borrar la cuenta dejaría un cruce firmado por nadie. NULL = lo resolvió el cruce automático (o nadie todavía) — el ciclo NUNCA escribe esta columna.';

comment on column public.sat_cfdi_descargado.resuelto_en is
  'Cuándo lo resolvió UNA PERSONA. NULL = nunca pasó por manos humanas: lo decidió el cruce automático del ciclo, o sigue esperando. No confundir con created_at, que es cuándo bajó del SAT.';

-- La firma es de verdad o no es. Una fila que dice «resuelto el martes» sin
-- decir POR QUIÉN es exactamente el registro que no sirve como evidencia: la
-- pregunta que se le hace a este expediente seis meses después es «¿quién
-- afirmó que este CFDI era de este gasto?». Los dos sentidos, porque un
-- correo sin fecha tampoco reconstruye nada.
--
-- `resuelto_por` (el uuid) queda FUERA del CHECK a propósito: se anula solo
-- cuando la cuenta se borra, y ese día la firma tiene que seguir en pie.
--
-- Entra sin backfill: `sat_cfdi_descargado` tiene 0 filas en producción (la
-- descarga aún no se activa) y, aunque tuviera, el ciclo automático nunca
-- escribió `resuelto_en` — todas las filas existentes cumplen con las dos en
-- null.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'sat_cfdi_descargado_firma_coherente'
       and conrelid = 'public.sat_cfdi_descargado'::regclass
  ) then
    alter table public.sat_cfdi_descargado
      add constraint sat_cfdi_descargado_firma_coherente
      check ((resuelto_en is null) = (resuelto_por_email is null));
  end if;
end $$;

comment on constraint sat_cfdi_descargado_firma_coherente on public.sat_cfdi_descargado is
  'Una resolución humana tiene fecha Y firma, o no existe (0243). El uuid resuelto_por queda fuera a propósito: se anula al borrar la cuenta (ARCO) y ese día la firma tiene que seguir en pie — para eso está el correo congelado.';

-- La llave que hacen posibles las FK compuestas de la casa (0028/0145). La
-- 0231 se la puso a `sat_descarga_solicitud` y no a esta tabla; el expediente
-- de abajo la necesita para que un acto de la flota A no pueda colgarse de un
-- comprobante de la flota B.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'sat_cfdi_descargado_id_tenant_key'
       and conrelid = 'public.sat_cfdi_descargado'::regclass
  ) then
    alter table public.sat_cfdi_descargado
      add constraint sat_cfdi_descargado_id_tenant_key unique (id, tenant_id);
  end if;
end $$;


-- ── 2. EL EXPEDIENTE APPEND-ONLY DE CADA ACTO HUMANO ───────────────────────
--
-- POR QUÉ UNA TABLA Y NO TRES COLUMNAS MÁS. Porque un comprobante puede pasar
-- por manos humanas VARIAS VECES —se liga, se descubre que estaba mal, se
-- revierte, se liga a otro gasto—, y las columnas de la fila solo pueden
-- contar la ÚLTIMA. La fila dice EN QUÉ ESTÁ; esta tabla dice CÓMO LLEGÓ. Sin
-- ella, deshacer un cruce sería indistinguible de que el cruce nunca hubiera
-- existido, que es justo lo que un expediente fiscal no puede permitirse.
--
-- POR QUÉ ADEMÁS DE `bitacora_auditoria`: aquélla es la copia cross-tenant que
-- /admin reconstruye y se purga a 365 días (0155). Ésta vive PEGADA al
-- comprobante, viaja con él y es lo que la pantalla del contralor enseña
-- debajo de cada fila. Las dos se escriben; ninguna sustituye a la otra
-- (mismo reparto que `jornada_dia` declaró en la 0241).
create table if not exists public.sat_cfdi_resolucion (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  cfdi_id      uuid not null,
  -- Qué se hizo. Cuatro actos y ni uno más:
  --   'ligado'    — una persona afirmó que este CFDI es de este gasto.
  --   'ignorado'  — una persona lo archivó, con motivo.
  --   'revertido' — una persona DESHIZO un acto anterior, con motivo.
  --   'degradado' — no fue una persona: el gasto con el que había casado se
  --                 borró y la base soltó el cruce (trigger de la 0236). Es
  --                 el ÚNICO acto sin firma, y se llama distinto para que
  --                 nadie lo lea como si alguien hubiera decidido.
  acto         text not null,
  -- El gasto que se ligó ('ligado') o del que se soltó ('revertido' /
  -- 'degradado'). NULL en 'ignorado': ahí no hay gasto de por medio.
  --
  -- SIN LLAVE FORÁNEA A `gasto`, Y ES DELIBERADO —el mismo criterio que la
  -- 0231 declaró por escrito para `peaje_cierre_aviso` («sin FK a gasto a
  -- propósito: el sello debe sobrevivir a que el gasto se borre») y que
  -- `bitacora_auditoria.entidad_id` usa desde la 0053.
  --
  -- Las tres alternativas están cerradas, y probarlas contra Postgres real es
  -- lo que dejó ver por qué:
  --   · `on delete set null (gasto_id)` BORRARÍA EL HECHO. Y encima choca con
  --     el CHECK `sat_cfdi_resolucion_ligado_con_gasto` de abajo: al borrar el
  --     gasto, la fila 'ligado' se quedaría sin gasto, el CHECK reventaría y
  --     con él el DELETE del viaje entero — el bug c7-3 de la 0231 otra vez,
  --     en una tabla nueva.
  --   · `on delete cascade` borraría el renglón del expediente. Aquí no se
  --     borra nada: es la regla de la casa para esta bandeja.
  --   · `on delete restrict` haría que un expediente impidiera borrar un
  --     gasto, o sea que la auditoría bloqueara la operación.
  -- Que el gasto ya no exista NO invalida el hecho de que alguien afirmó ese
  -- cruce: es exactamente lo que este expediente tiene que poder contar. La
  -- pertenencia a la flota la garantiza el llamador (que resuelve el gasto
  -- con `.eq('tenant_id')` antes de escribir) y, sobre todo, la afirmación
  -- VIVA —`sat_cfdi_descargado.gasto_id`—, que sí lleva la FK compuesta.
  gasto_id     uuid,
  -- El antes y el después, medidos. Un expediente que solo dice «se cambió»
  -- obliga a reconstruir el estado anterior de memoria.
  estatus_antes   text not null,
  estatus_despues text not null,
  -- Por qué. Obligatorio en los dos actos que QUITAN una afirmación
  -- ('ignorado' y 'revertido'): sin motivo, el siguiente que mire la fila no
  -- puede saber si fue un error corregido o un descuido.
  motivo       text,
  actor_id     uuid references public.app_user(id) on delete set null,
  -- El correo congelado, por la misma razón que arriba: el uuid se anula si la
  -- cuenta se borra y el expediente perdería la firma.
  actor_email  text,
  creado_en    timestamptz not null default now(),

  constraint sat_cfdi_resolucion_acto_dominio
    check (acto in ('ligado', 'ignorado', 'revertido', 'degradado')),
  constraint sat_cfdi_resolucion_estatus_dominio
    check (estatus_antes   in ('casado', 'disponible', 'ambiguo', 'ignorado')
       and estatus_despues in ('casado', 'disponible', 'ambiguo', 'ignorado')),
  -- Un acto que quita una afirmación exige decir por qué.
  constraint sat_cfdi_resolucion_motivo_exigido
    check (acto not in ('ignorado', 'revertido')
        or (motivo is not null and length(btrim(motivo)) > 0)),
  -- TODO ACTO HUMANO VA FIRMADO. El único sin firma es el de la base, y se
  -- llama 'degradado' precisamente para que se distinga a simple vista de una
  -- decisión de alguien.
  constraint sat_cfdi_resolucion_firma_exigida
    check (acto = 'degradado' or (actor_email is not null and length(btrim(actor_email)) > 0)),
  -- Ligar es afirmar un cruce: sin gasto no hay cruce que afirmar.
  constraint sat_cfdi_resolucion_ligado_con_gasto
    check (acto <> 'ligado' or gasto_id is not null),
  -- LA FK COMPUESTA DE LA CASA (0028/0145): el acto de la flota A no se cuelga
  -- de un comprobante de la flota B. Va en CASCADE y no en `set null` porque
  -- un renglón de expediente sin comprobante no describe nada; el único camino
  -- que borra un `sat_cfdi_descargado` es borrar la flota entera, y ese día
  -- todo esto se va con ella.
  constraint sat_cfdi_resolucion_cfdi_tenant_fkey
    foreign key (cfdi_id, tenant_id)
    references public.sat_cfdi_descargado (id, tenant_id) on delete cascade
);

comment on table public.sat_cfdi_resolucion is
  'El expediente APPEND-ONLY de lo que las personas decidieron sobre cada CFDI bajado del SAT (0243). La fila de sat_cfdi_descargado dice EN QUÉ ESTÁ el comprobante; esto dice CÓMO LLEGÓ ahí. Deshacer un cruce escribe un renglón nuevo, jamás borra el anterior — corregir es anotar (criterio de jornada_asiento, 0241). Sin UPDATE ni DELETE concedidos a ningún rol de la app: un expediente que su dueño puede editar no sirve como evidencia (mismo criterio que bitacora_auditoria, 0053).';
comment on column public.sat_cfdi_resolucion.acto is
  'ligado / ignorado / revertido son actos de una PERSONA y van firmados. degradado NO lo es: lo escribe el trigger de la 0236 cuando el gasto con el que el comprobante había casado se borra. Se llama distinto para que nadie lea una acción referencial de la base como si alguien la hubiera decidido.';
comment on column public.sat_cfdi_resolucion.actor_email is
  'SNAPSHOT del correo de quien lo hizo — sobrevive al borrado de la cuenta (la FK actor_id es `on delete set null` por ARCO). NULL solo en acto = degradado, y el CHECK sat_cfdi_resolucion_firma_exigida lo garantiza.';
comment on column public.sat_cfdi_resolucion.motivo is
  'Por qué. Obligatorio al ignorar y al revertir: los dos QUITAN una afirmación sobre el dinero de alguien, y sin motivo no se puede distinguir un error corregido de un descuido.';

-- El expediente de UN comprobante, en orden, que es como lo lee la pantalla.
create index if not exists sat_cfdi_resolucion_cfdi_idx
  on public.sat_cfdi_resolucion (tenant_id, cfdi_id, creado_en desc);

-- «¿Quién le pegó un comprobante a ESTE gasto, y cuándo?» — la pregunta que se
-- hace desde el otro lado, cuando lo que se está revisando es la liquidación y
-- no el buzón.
create index if not exists sat_cfdi_resolucion_gasto_idx
  on public.sat_cfdi_resolucion (tenant_id, gasto_id)
  where gasto_id is not null;

-- Mismo doble candado que el resto de la feature (0196/0198/0226/0229/0231):
-- RLS deny-all y grants SOLO a service_role. Y aquí, además, SIN update ni
-- delete PARA NADIE: la tabla es append-only por privilegio, no por
-- convención de código. (Las acciones referenciales —el cascade desde
-- `tenant`/`sat_cfdi_descargado` y el `set null` desde `gasto`— corren por
-- dentro y no piden estos permisos, así que borrar una flota sigue siendo
-- posible.)
alter table public.sat_cfdi_resolucion enable row level security;
revoke all on table public.sat_cfdi_resolucion from public, anon, authenticated;
grant select, insert on table public.sat_cfdi_resolucion to service_role;
-- Y EL REVOKE EXPLÍCITO, que no sobra: Supabase aplica `alter default
-- privileges … grant select, insert, update, delete on tables to service_role`
-- al aprovisionar el proyecto (lo espeja `supabase/pruebas-aislamiento/
-- andamio_ci.sql:94`), así que una tabla nueva nace con UPDATE y DELETE ya
-- concedidos y el `grant` de arriba no los quita — probado contra Postgres
-- real: sin esta línea, `has_table_privilege('service_role', …, 'UPDATE')`
-- sigue devolviendo true y el «append-only» sería una promesa de comentario.
-- Con ella, la única forma de corregir un renglón es escribir otro, que es
-- exactamente lo que esta bandeja afirma que hace.
revoke update, delete on table public.sat_cfdi_resolucion from service_role;


-- ── 3. EL ÍNDICE DE LA LISTA ───────────────────────────────────────────────
--
-- La bandeja lista POR ESTATUS y ORDENA POR FECHA (el comprobante más nuevo
-- primero, que es el que todavía se puede accionar), con `id` de desempate
-- para que la página 2 no repita ni se salte filas cuando dos CFDI comparten
-- fecha. Los índices que ya existían no sirven para eso:
--   · `sat_cfdi_descargado_estatus_idx (tenant_id, estatus)` no lleva la
--     fecha, así que cada página sería un sort de todo el estatus.
--   · `sat_cfdi_descargado_pendientes_idx (tenant_id, estatus, fecha)` es
--     PARCIAL (solo disponible/ambiguo), va ASCENDENTE y no trae el desempate.
--
-- Con 200,000 comprobantes —el tope por petición que la propia 0231 declara—
-- la diferencia entre este índice y su ausencia es la diferencia entre una
-- pantalla y un timeout.
create index if not exists sat_cfdi_descargado_bandeja_idx
  on public.sat_cfdi_descargado (tenant_id, estatus, fecha desc nulls last, id desc);


-- ── 4. EL TRIGGER DE LA 0236, HONESTO HASTA EL FINAL ───────────────────────
--
-- Lo que la 0236 dejó a medias, y que solo se ve cuando ya hay firmas que
-- perder:
--
--   (a) LA FIRMA VIEJA SE QUEDABA PEGADA. Ana liga a mano el CFDI con el gasto
--       G; alguien borra el viaje del que cuelga G; la base degrada el
--       comprobante a 'disponible' —correctamente— pero `resuelto_por`,
--       `resuelto_por_email` y `resuelto_en` seguían diciendo «resuelto por
--       Ana el martes». Una fila que espera decisión y afirma estar resuelta
--       es la peor de las dos mentiras posibles: la pantalla la sacaría de la
--       cola de trabajo y nadie volvería a mirarla. Con el CHECK
--       `sat_cfdi_descargado_firma_coherente` de arriba, además, quedaría una
--       firma que ya no describe nada.
--   (b) LA REVERSIÓN DE LA MÁQUINA NO DEJABA RASTRO. El motivo se escribía en
--       `candidatos` —y eso se conserva, la 0236 lo prometió por escrito y hay
--       una verificación que lo comprueba—, pero `candidatos` es un campo que
--       la siguiente resolución sobrescribe. El expediente de arriba es donde
--       un hecho se queda.
--
-- La condición del WHEN no cambia: sigue siendo deliberadamente estrecha —la
-- fila TENÍA gasto, ya no lo tiene, y sigue diciendo 'casado'— para que el
-- trigger solo alcance a la acción referencial y jamás a una escritura de la
-- aplicación (que cambia estatus y gasto_id en el MISMO update).
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

  -- (b) El renglón del expediente ANTES de limpiar la firma, para poder decir
  -- QUIÉN había hecho el cruce que la base acaba de soltar. `old.gasto_id`
  -- —el gasto que se está borrando en este mismo instante— se guarda tal cual
  -- porque esa columna NO tiene llave foránea, precisamente para esto: el
  -- expediente tiene que poder nombrar un gasto que ya no existe.
  insert into public.sat_cfdi_resolucion
    (tenant_id, cfdi_id, acto, gasto_id, estatus_antes, estatus_despues, motivo, actor_id, actor_email)
  values (
    new.tenant_id, new.id, 'degradado', old.gasto_id, old.estatus, 'disponible',
    'El gasto con el que había casado se borró, y con él el cruce. '
      || coalesce('Lo había resuelto a mano ' || old.resuelto_por_email || '. ', '')
      || 'El comprobante vuelve a esperar decisión.',
    null, null
  );

  -- (a) La firma se limpia: esta fila ya no está resuelta por nadie. Quién la
  -- había resuelto no se pierde — quedó en el renglón de arriba.
  new.resuelto_por := null;
  new.resuelto_por_email := null;
  new.resuelto_en := null;

  return new;
end;
$$;

comment on function public.sat_cfdi_descargado_gasto_borrado() is
  'Degrada a «disponible» el comprobante cuya contraparte se borró (0236), y desde la 0243 además LIMPIA LA FIRMA y anota el hecho en sat_cfdi_resolucion. Lo dispara la acción referencial `on delete set null (gasto_id)`, no la aplicación: sin él, el CHECK casado_coherente volvería a reventar el DELETE del gasto — que es el bug c7-3 con otra cara. Dejar la firma pegada haría que una fila que espera decisión afirmara estar resuelta, y la pantalla la sacaría de la cola de trabajo.';
