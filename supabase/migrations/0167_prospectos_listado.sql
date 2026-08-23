-- ═══════════════════════════════════════════════════════════════════════════
-- 0167 — EL LATIDO DEL CEREBRO DEJA DE PEDIR EL UNIVERSO (FE-16).
--
-- El Cerebro de ventas (/admin/mapa-prospectos) se refresca solo. Hasta hoy
-- ese refresco volvía a bajar la CARTERA ENTERA: 33,065 prospectos con sus
-- notas y sus mensajes redactados, ~33 MB de JSON, cada 5 minutos y por cada
-- pestaña abierta. El arreglo del lado del código es pedir SOLO lo que cambió
-- desde la última marca (`?desde=`), y para eso la base tiene que poder
-- contestar dos cosas que hoy NO puede:
--
-- 1. QUÉ CAMBIÓ. `prospecto.updated_at` existe desde la 0001 con
--    `default now()`, pero NADIE lo mantiene: no hay trigger, y solo unos
--    pocos escritores lo ponen a mano (`vendedores.ts` al reasignar o anotar).
--    Medido en producción el 22-ago-2026:
--
--        select count(*) filter (where updated_at > created_at + interval '1 second')
--        from prospecto;   →   0     (de 33,071 filas)
--
--    O sea: la columna dice, para TODAS las filas, la hora en que se
--    insertaron. Un delta montado sobre ella habría sido peor que no tener
--    delta — habría contestado "nada cambió" mientras el enriquecedor movía
--    el giro, el agente experto redactaba el primer toque y el vendedor
--    avanzaba el embudo. Un mapa mudo que se ve exactamente igual que un mapa
--    al día. El trigger de abajo la vuelve verdadera para CUALQUIER escritor
--    (agentes, enriquecedor, rutas de API, SQL a mano), que es la única forma
--    de que el delta no dependa de que cada llamador se acuerde.
--
-- 2. LOS TOQUES TAMBIÉN SON CAMBIO. El filtro "sin contactar en N días" y la
--    línea "Último toque" del mapa se leen de `prospecto_toque`, que es otra
--    tabla: insertar un toque no toca `prospecto`. Sin el segundo trigger, un
--    toque registrado por otro operador NUNCA llegaría a los demás Cerebros
--    abiertos — el delta traería el universo cambiado menos justo eso. Se
--    resuelve donde no se puede olvidar: la fila del toque sella a su
--    prospecto.
--
-- Y el índice: la consulta del latido es `updated_at > $1` y devuelve casi
-- siempre CERO filas. Sin índice eso es un recorrido secuencial de las 33 mil
-- filas (y del universo de 50k al que va la escala) cada 5 minutos por cada
-- pestaña abierta, para no devolver nada. Con índice es un descenso al final
-- del árbol. Barato de mantener: `prospecto` se escribe por lotes del
-- cazador/enriquecedor, no en el camino caliente de un viaje.
--
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `updated_at` deja de ser decorativa ─────────────────────────────────

create or replace function public.prospecto_marca_updated()
returns trigger
language plpgsql
as $$
begin
  -- El reloj de la BASE y no el valor que traiga el llamador: la marca del
  -- delta se compara contra sí misma, y un cliente con el reloj adelantado
  -- escribiría una hora futura y se auto-escondería de todas las lecturas
  -- siguientes.
  --
  -- `clock_timestamp()` y no `now()`: `now()` es la hora de ARRANQUE de la
  -- transacción, así que un lote del enriquecedor que toca cinco mil filas en
  -- una sola transacción las sella a todas con la hora en que empezó — que
  -- puede ser minutos antes de que terminen. El reloj de pared deja la marca
  -- más cerca del momento real del cambio, que es lo que estrecha la ventana
  -- en la que un latido podría colarse entre la escritura y el commit.
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function public.prospecto_marca_updated() is
  'Sella prospecto.updated_at en CADA update (0167). El delta del Cerebro de ventas lee esa columna; sin esto decía la hora del insert para todas las filas.';

drop trigger if exists trg_prospecto_marca_updated on public.prospecto;
create trigger trg_prospecto_marca_updated
  before update on public.prospecto
  for each row execute function public.prospecto_marca_updated();

-- ── 2. Un toque es un cambio del prospecto ─────────────────────────────────

create or replace function public.prospecto_toque_marca_prospecto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- El update dispara `trg_prospecto_marca_updated`, que es quien pone la
  -- hora. Aquí solo se toca la fila. (No hay recursión: actualizar
  -- `prospecto` no inserta toques.)
  update public.prospecto set updated_at = clock_timestamp() where id = new.prospecto_id;
  return new;
end;
$$;

comment on function public.prospecto_toque_marca_prospecto() is
  'Un toque nuevo sella a su prospecto (0167): "Último toque" y el filtro "sin contactar en N días" viven en prospecto_toque, y sin esto el delta del Cerebro nunca los vería.';

drop trigger if exists trg_toque_marca_prospecto on public.prospecto_toque;
create trigger trg_toque_marca_prospecto
  after insert on public.prospecto_toque
  for each row execute function public.prospecto_toque_marca_prospecto();

-- ── 3. El índice del delta ─────────────────────────────────────────────────

create index if not exists idx_prospecto_updated_at
  on public.prospecto (updated_at);

comment on index public.idx_prospecto_updated_at is
  'El latido del Cerebro pregunta updated_at > marca cada 5 min y casi siempre no hay nada (0167). Sin este índice esa pregunta es un seq scan de todo el universo para devolver cero filas.';

analyze public.prospecto;
