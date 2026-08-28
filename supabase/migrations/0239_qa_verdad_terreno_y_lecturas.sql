-- ═══════════════════════════════════════════════════════════════════════════
-- 0239 — LA VERDAD-DE-TERRENO SE VUELVE UN CONTRATO, Y CADA LECTURA DEL OCR
--        QUEDA ESCRITA CON SU MEDICIÓN
--
-- CONTEXTO. La 0185 creó `qa_foto` con tres columnas para el oráculo humano
-- (`ocr_esperado`, `confirmado_por`, `confirmado_en`) y un solo CHECK:
-- `qa_foto_confirmacion_completa`, que impide un "esperado" sin firma. Eso
-- cubre QUIÉN lo dijo. No cubre QUÉ dijo: `ocr_esperado` es `jsonb` a secas, o
-- sea que cualquier objeto entra, incluido uno al que le falte la mitad.
--
-- Ahora entran 91 comprobantes REALES etiquetados a mano, y esa laxitud deja
-- de ser inocente. La etiqueta de cada foto es la vara con la que se va a medir
-- el OCR de producción, y el número que salga de ahí —"el modelo lee bien el
-- 84% de los campos"— se va a citar en una decisión. Una vara mal formada no
-- da un error: da un porcentaje equivocado que nadie puede distinguir de uno
-- bueno.
--
-- EL AGUJERO CONCRETO, Y POR QUÉ UN VALIDADOR EN TYPESCRIPT NO LO TAPA.
-- En la etiqueta, un campo en `null` significa una de dos cosas OPUESTAS:
--
--   · el papel NO imprime ese campo (un voucher de terminal no trae RFC), o
--   · el papel SÍ lo imprime pero en la foto no se distingue.
--
-- La diferencia decide el veredicto del OCR sobre ese campo:
--
--   · si el papel no lo imprime y el OCR devuelve algo, ALUCINÓ → error;
--   · si el papel lo imprime y no se ve, no hay contra qué medir → el campo
--     sale del denominador, ni acierto ni error.
--
-- O sea que un `null` sin clasificar no es un hueco cosmético: es un campo que
-- el motor de medición va a contar de alguna de las dos formas sin tener
-- derecho a elegir. Por eso el contrato exige que TODA clave con valor `null`
-- esté en `ilegibles` o en `noAplica`, en exactamente una de las dos, y que
-- ninguna clave con valor esté en cualquiera de ellas.
--
-- `validarVerdadTerreno` (src/lib/admin/qa-tipos.ts) lo comprueba y explica
-- cuál de los tres modos se rompió. Se replica AQUÍ porque las 91 etiquetas se
-- van a escribir con un script de ingesta y con la mano, la ingesta se va a
-- repetir, y la regla de la casa es que un invariante que corrompe una
-- medición es una restricción de base y no un `if` que alguien recuerda
-- llamar. Es el mismo criterio con el que la 0185 puso `unique` sobre el hash
-- en vez de confiar en el dedup de TypeScript.
--
-- LA SEGUNDA MITAD: `qa_foto_lectura`. Hoy correr el OCR contra el banco no
-- deja rastro — el resultado se pinta y se pierde con el refresco. Sin
-- historia no hay forma de contestar la única pregunta que importa aquí, que
-- es si el modelo mejoró o empeoró entre dos cambios de prompt. Cada corrida
-- del OCR contra una foto escribe una fila con lo que leyó, cómo se midió
-- campo por campo, y cuánto costó.
--
-- QUÉ NO LLEVA, Y POR QUÉ. `tenant_id`: `qa_foto` no lo tiene porque el banco
-- es superficie de SUPERADMIN, no de una flota — las fotos son material de
-- prueba de la casa. Inventarle multi-tenancy a la tabla hija sería inventar
-- una dimensión que la tabla madre no tiene, y obligaría a todo lector a
-- filtrar por una columna que siempre valdría lo mismo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El contrato de la verdad-de-terreno, como función IMMUTABLE ─────────────
--
-- Va como función y no como una expresión gigante dentro del CHECK por dos
-- motivos: se puede leer, y se puede PROBAR sola desde verificaciones.sql sin
-- tener que insertar y esperar el rebote. `immutable` es cierto —solo mira su
-- argumento, no consulta nada— y es requisito para usarla en un CHECK.
create or replace function public.qa_verdad_terreno_valida(v jsonb)
returns boolean
language sql
immutable
as $func$
  select
    -- Forma: un objeto, no un arreglo ni un escalar.
    jsonb_typeof(v) = 'object'
    -- La clase del papel, del mismo catálogo que `ClaseComprobante`.
    and (v ->> 'clase') in ('ticket', 'voucher_bancario', 'cfdi_impreso', 'no_comprobante')
    -- Las dos listas EXISTEN siempre. Ausente ≠ vacía: una lista ausente
    -- significa "no se pensó en clasificar", y es justo lo que se prohíbe.
    and jsonb_typeof(v -> 'ilegibles') = 'array'
    and jsonb_typeof(v -> 'noAplica') = 'array'
    -- Las 7 claves medibles están presentes (aunque valgan null): una clave
    -- AUSENTE se leería como null sin haber sido nunca considerada.
    and (v ?& array['emisor','rfcEmisor','folio','monto','fecha','sucursal','dominioFacturacion'])
    and (v ? 'comercioClave')
    -- Ninguna clave puede estar en las dos listas a la vez: son afirmaciones
    -- contradictorias ("el papel no lo trae" y "lo trae pero no se ve").
    and not exists (
      select 1
      from jsonb_array_elements_text(v -> 'ilegibles') AS i(clave)
      where i.clave in (select j.clave from jsonb_array_elements_text(v -> 'noAplica') AS j(clave))
    )
    -- Y el invariante central, clave por clave:
    --   valor null  →  exactamente una de las dos listas lo menciona
    --   valor dado  →  ninguna de las dos lo menciona
    and not exists (
      select 1
      from unnest(array['emisor','rfcEmisor','folio','monto','fecha','sucursal','dominioFacturacion']) AS k(clave)
      where (
        -- null sin clasificar
        (v -> k.clave) is null or jsonb_typeof(v -> k.clave) = 'null'
      ) <> (
        -- clasificado en alguna de las dos
        k.clave in (select t.clave from jsonb_array_elements_text(v -> 'ilegibles') AS t(clave))
        or k.clave in (select t.clave from jsonb_array_elements_text(v -> 'noAplica') AS t(clave))
      )
    );
$func$;

comment on function public.qa_verdad_terreno_valida(jsonb) is
  'El contrato de `qa_foto.ocr_esperado` (la verdad-de-terreno del oráculo humano). Exige que TODA clave medible en null esté clasificada en "ilegibles" o en "noAplica" —en una sola de las dos— y que ninguna clave con valor lo esté. El motivo no es la limpieza: un null sin clasificar hace que la medición del OCR tenga que elegir a ciegas entre "alucinó" (el papel no lo imprime) y "no hay contra qué medir" (el papel lo imprime y no se ve), y esas dos dan porcentajes distintos. Gemela de validarVerdadTerreno() en src/lib/admin/qa-tipos.ts, que además explica cuál de los tres modos se rompió.';

alter table public.qa_foto
  drop constraint if exists qa_foto_verdad_terreno_completa;
alter table public.qa_foto
  add constraint qa_foto_verdad_terreno_completa
  check (ocr_esperado is null or public.qa_verdad_terreno_valida(ocr_esperado));

comment on column public.qa_foto.confirmado_en is
  'Cuándo se firmó la verdad-de-terreno. Junto con `confirmado_por` es lo que el CHECK qa_foto_confirmacion_completa (0185) exige para que `ocr_esperado` pueda existir: un esperado sin firma es un dato que nadie respalda.';

-- Las fotos CONFIRMADAS son la porción del banco que se puede medir, y la
-- pantalla las pide una y otra vez para contar "N de 91 etiquetadas". Índice
-- parcial: las no confirmadas no entran, así que ocupa lo que ocupa el
-- subconjunto y no el banco entero.
create index if not exists qa_foto_confirmadas_idx
  on public.qa_foto (confirmado_en desc)
  where ocr_esperado is not null;

-- ── Cada corrida del OCR contra una foto, con su medición ───────────────────
create table if not exists public.qa_foto_lectura (
  id           uuid primary key default gen_random_uuid(),
  foto_id      uuid not null references public.qa_foto(id) on delete cascade,
  corrida_en   timestamptz not null default now(),
  modelo       text not null,
  ocr_leido    jsonb not null,
  medicion     jsonb not null,
  campos_ok    integer not null check (campos_ok >= 0),
  campos_mal   integer not null check (campos_mal >= 0),
  campos_no_medidos integer not null check (campos_no_medidos >= 0),
  costo_usd    numeric(12,4) not null default 0 check (costo_usd >= 0),
  motivo       text,
  -- Las 7 claves medibles de `ClaveVerdad` se miden TODAS, siempre: cada una
  -- sale ok, mal o no medida. Si los tres contadores no suman 7, la fila está
  -- describiendo una medición que no ocurrió — y ese es exactamente el número
  -- que luego se agrega en un porcentaje. Se cierra aquí en vez de confiar en
  -- que quien escriba la fila haya contado bien.
  constraint qa_foto_lectura_campos_completos
    check (campos_ok + campos_mal + campos_no_medidos = 7)
);

comment on table public.qa_foto_lectura is
  'Una corrida del OCR REAL de producción (extraerComprobante) contra una foto del banco, con su medición campo por campo contra la verdad-de-terreno de esa foto. Existe para poder contestar si el modelo mejoró o empeoró entre dos cambios de prompt: sin historia, cada corrida borra a la anterior y "el OCR lee bien" no es una afirmación comprobable. Es apéndice, no reemplazo: nada se actualiza aquí, solo se inserta.';
comment on column public.qa_foto_lectura.foto_id is
  'La foto del banco que se leyó. `on delete cascade` porque una lectura sin su foto no significa nada: no habría ni imagen que revisar ni etiqueta contra la cual entender la medición.';
comment on column public.qa_foto_lectura.corrida_en is
  'Cuándo se corrió. Es el eje del historial: la pregunta que esta tabla contesta ("¿mejoró el modelo?") se responde comparando dos instantes, así que se indexa descendente.';
comment on column public.qa_foto_lectura.modelo is
  'El modelo que de verdad respondió, tal como lo reporta OpenRouter (no el que se pidió: el enrutador puede caer a otro). Comparar dos corridas sin saber qué modelo contestó cada una compararía dos cosas distintas creyendo que son la misma.';
comment on column public.qa_foto_lectura.ocr_leido is
  'Lo que la visión leyó, CRUDO y aplanado a las 7 claves medibles. Se guarda aparte de la medición porque la medición depende de cómo se compara —normalización de acentos, de dominio, tolerancia del monto— y eso puede cambiar: con el crudo guardado, una regla nueva se puede volver a aplicar sobre las lecturas viejas sin volver a gastar en el modelo.';
comment on column public.qa_foto_lectura.medicion is
  'Campo → {esperado, leido, veredicto, motivo}. El veredicto es ok / mal / no_medido, y los tres NO son dos: `no_medido` es el campo que la persona marcó ilegible, que sale del denominador porque no hay contra qué medirlo. Contarlo como acierto premiaría al OCR por adivinar y contarlo como error lo castigaría por una foto quemada.';
comment on column public.qa_foto_lectura.campos_ok is
  'Aciertos. Con campos_mal forma el DENOMINADOR real de la exactitud; los no medidos quedan fuera a propósito.';
comment on column public.qa_foto_lectura.campos_no_medidos is
  'Campos sin medir: ilegibles según la persona, o la corrida entera falló técnicamente (proveedor caído, imagen que no se pudo bajar). En el segundo caso valen 7 y `motivo` dice por qué — un fallo de infraestructura contado como fallo de lectura hundiría la exactitud del modelo sin que el modelo haya visto la foto.';
comment on column public.qa_foto_lectura.costo_usd is
  'Costo REAL de la llamada de visión, tal como lo reporta el proveedor. Cuando la llamada se abortó y no hubo `usage`, el costo NO se midió: la fila lleva 0 y `motivo` lo DICE, porque un 0 sin explicación se lee como "gratis" y esto se suma contra el tope diario.';
comment on column public.qa_foto_lectura.motivo is
  'Por qué falló, si falló, o por qué la medición no se pudo hacer. Nunca en silencio: una lectura sin resultado y sin motivo obliga a abrir la foto para adivinar qué pasó.';

create index if not exists qa_foto_lectura_foto_idx
  on public.qa_foto_lectura (foto_id, corrida_en desc);

create index if not exists qa_foto_lectura_corrida_idx
  on public.qa_foto_lectura (corrida_en desc);

-- ── RLS deny-all + grants solo a service_role ──────────────────────────────
--
-- Mismo doble candado que la 0196 le puso a qa_foto / qa_corrida /
-- qa_corrida_paso, y por la misma razón agravada: `ocr_leido` y `medicion`
-- contienen el RFC, la razón social y la sucursal de comprobantes REALES —dato
-- personal del art. 2 fr. VI de la LFPDPPP en cuanto el emisor es persona
-- física—. RLS sin policies deniega a anon y authenticated; el `revoke` es la
-- segunda capa por si algún día alguien escribe una policy de más.
alter table public.qa_foto_lectura enable row level security;

revoke all on public.qa_foto_lectura from public, anon, authenticated;
grant select, insert, update, delete on public.qa_foto_lectura to service_role;

-- La función tampoco es de nadie más: se usa dentro de un CHECK (que corre con
-- los privilegios del sistema, no del llamador) y desde verificaciones.sql.
revoke all on function public.qa_verdad_terreno_valida(jsonb) from public, anon, authenticated;
grant execute on function public.qa_verdad_terreno_valida(jsonb) to service_role;
