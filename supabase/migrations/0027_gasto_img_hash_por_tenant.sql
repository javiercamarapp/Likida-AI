-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 — La misma foto es el mismo gasto, aunque cambie de viaje.
--
-- ALTO de la auditoría 5 (modelo de datos).
--
-- ⚠️ ESTA MIGRACIÓN TOCA DATOS VIVOS. Lee la sección "LIMPIEZA" antes de
--    aplicarla, y la de "OJO CON EL ENSAYO DEL DEMO" antes de correrla contra
--    el tenant que se va a usar el 6-ago.
--
-- QUÉ ESTÁ MAL HOY. El índice de 0015 es `(tenant_id, viaje_id, img_hash)`, con
-- el `viaje_id` en medio. Un SHA-256 igual es el MISMO archivo; con el viaje en
-- la llave, el mismo archivo entra tantas veces como viajes haya.
--
-- Verificado en producción el 28-jul-2026: el hash
-- `250a4e5b34ecba43d043bf63b771c384296c5a62917bf326ab2826d1e9349d98` está en
-- DOS gastos del mismo tenant y del mismo operador:
--
--   gasto 26fd8543-cb60-46b7-851b-829a5b823be0 · viaje 44444444-…-00ff · $199.00 · 21:41:45
--   gasto 19299f03-b61f-40f4-abbe-5b8252e00860 · viaje 44444444-…-00fe · $199.00 · 22:48:07
--
-- EL ESCENARIO CON VALORES. Un ticket de fonda cuyo folio el OCR no leyó
-- (`folio NULL`, `cfdi_uuid NULL` — lo normal en papel térmico) se manda en el
-- viaje A y se vuelve a mandar en el viaje B. Entonces:
--
--   · `uq_gasto_img_hash` no choca, porque el `viaje_id` es distinto;
--   · `gastoExistePorHash` filtra `.eq('viaje_id', viajeId)` (repo.ts:124-134),
--     así que el pre-check tampoco lo ve;
--   · el motor deduplica solo DENTRO del viaje y necesita `g.folio` para armar
--     la llave `concepto|folio|monto` (engine.ts:133-137) — sin folio ni UUID no
--     hay llave;
--   · y `detectarDuplicadosEntreViajes`, que sí cruza viajes, tiene un único
--     llamador (analytics.ts:91): el panel, DESPUÉS del cierre, y empata por
--     `cfdiUuid` o por `folio+monto`, NUNCA por hash.
--
-- Resultado: el mismo dinero se comprueba dos veces, contra dos anticipos
-- distintos. Es el fraude número uno del sector, y el dato que lo cerraría —el
-- hash— ya estaba en la columna, sin usar.
--
-- POR QUÉ EL ALCANCE CORRECTO ES EL TENANT. El comentario de 0015 dice que el
-- índice se diseñó para una carrera intra-lote (dos fotos idénticas en el mismo
-- `Promise.all`), y para eso el viaje bastaba. La pregunta que no se hizo es qué
-- garantiza la llave: "una foto = un gasto" no es una propiedad del viaje, es
-- una propiedad del archivo dentro de la flota.
--
-- EL NOMBRE DEL ÍNDICE NO CAMBIA, Y ES A PROPÓSITO. `processor.ts:356` hace
-- `violaIndice(e, 'uq_gasto_img_hash')` para saber si un 23505 es benigno; el
-- nombre es la interfaz. Con el mismo nombre, el reenvío entre viajes cae solo
-- en la rama de duplicado benigno que ya existe, sin tocar una línea de `src/`.
--
-- LIMPIEZA (lo que esta migración le hace a los datos vivos). El par de arriba
-- viola la restricción nueva, así que hay que resolverlo ANTES de crearla. No se
-- borra ninguna fila: borrar un gasto de un viaje ya liquidado dejaría
-- `liquidacion.total_comprobado` sin cuadrar contra la suma de sus gastos, y el
-- PDF que ya se generó diría otra cosa que la base. Lo que se hace es DEGRADAR
-- el hash del duplicado más nuevo: se guarda en `ocr_extra.imgHashDuplicado`
-- —no se pierde, queda auditable— y la columna se pone en NULL, que en un índice
-- único de Postgres no colisiona con nada. El gasto, su monto y su liquidación
-- quedan exactamente como estaban.
--
-- Se conserva el MÁS VIEJO de cada grupo porque es el que se comprobó primero:
-- el reenvío es el segundo, por definición.
--
-- OJO CON EL ENSAYO DEL DEMO. A partir de aquí, reenviar las MISMAS fotos de
-- prueba en un viaje nuevo ya no registra gastos: el segundo intento choca con
-- el índice y el processor lo trata como duplicado benigno (log
-- `foto.dedup_race`, sin mensaje al operador). Para volver a ensayar con las
-- mismas 17 fotos hay que borrar los gastos del ensayo anterior:
--
--   delete from gasto where viaje_id = '<viaje del ensayo>';
--
-- La base no puede distinguir un ensayo de un fraude: son el mismo archivo
-- contra dos anticipos. Esa distinción es de quien ensaya.
--
-- Reversible:
--   drop index uq_gasto_img_hash;
--   create unique index uq_gasto_img_hash on gasto (tenant_id, viaje_id, img_hash);
-- (los hashes degradados se recuperan de `ocr_extra->>'imgHashDuplicado'`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Degradar los duplicados que ya existen ───────────────────────────────
with duplicados as (
  select id,
         img_hash,
         row_number() over (
           partition by tenant_id, img_hash
           order by created_at, id      -- el más viejo se queda con el hash
         ) as n
  from gasto
  where img_hash is not null
)
update gasto g
set ocr_extra = coalesce(g.ocr_extra, '{}'::jsonb)
                || jsonb_build_object(
                     'imgHashDuplicado', d.img_hash,
                     'imgHashDegradadoPor', 'mig 0027 (uq_gasto_img_hash pasó a alcance de tenant)'
                   ),
    img_hash = null
from duplicados d
where d.id = g.id and d.n > 1;

-- ── 2. Comprobar que ya no queda ninguno ────────────────────────────────────
-- Si el paso 1 no alcanzó, el `create unique index` fallaría con un mensaje que
-- no dice cuáles son. Este sí.
do $$
declare r record; msg text := '';
begin
  for r in
    select tenant_id, img_hash, count(*) as n, string_agg(id::text, ', ') as gastos
    from gasto
    where img_hash is not null
    group by tenant_id, img_hash
    having count(*) > 1
  loop
    msg := msg || format(E'\n  tenant %s · hash %s · %s gastos: %s',
                         r.tenant_id, left(r.img_hash, 16) || '…', r.n, r.gastos);
  end loop;

  if msg <> '' then
    raise exception E'Siguen quedando fotos repetidas dentro del mismo tenant:%\n\nCada grupo es el MISMO archivo comprobado más de una vez. Decide gasto por gasto cuál se queda antes de volver a aplicar.', msg;
  end if;
end $$;

-- ── 3. El índice, con el alcance correcto ───────────────────────────────────
-- Parcial `where img_hash is not null`: los NULL no colisionan entre sí en un
-- índice único de Postgres, así que el `where` no cambia el comportamiento —
-- ahorra indexar las filas sin hash (las de antes de 0014, y las que entran con
-- el flag CUADRA_DEDUP_FOTOS apagado) y deja escrito en el esquema que un gasto
-- sin hash es NORMAL, no una excepción. Mismo criterio que `uq_gasto_cfdi_uuid`
-- en 0019.
drop index if exists uq_gasto_img_hash;

create unique index if not exists uq_gasto_img_hash
  on gasto (tenant_id, img_hash)
  where img_hash is not null;

comment on index uq_gasto_img_hash is
  'Una foto = un gasto POR FLOTA, no por viaje. Un SHA-256 igual es el mismo archivo: comprobarlo en dos viajes es cobrar el mismo ticket contra dos anticipos. El nombre no cambió porque processor.ts:356 discrimina el 23505 por él.';
