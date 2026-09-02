-- ═══════════════════════════════════════════════════════════════════════════
-- 0246 — CADA LECTURA DEL OCR SABE DE QUÉ CORRIDA SALIÓ, Y UNA CORRIDA NO
--        PUEDE MEDIR LA MISMA FOTO DOS VECES.
--
-- EL AGUJERO MEDIDO QUE ESTO CIERRA. El 28-ago-2026 el carril completo
-- procesó las 90 fotos reales del banco (qa_corrida_foto = 90, US$0.29 de
-- modelo medidos) y `qa_foto_lectura` quedó en CERO filas: la corrida mandó
-- cada foto por `processInbound`, el OCR real la leyó, el gasto quedó escrito
-- — y nadie comparó lo leído contra la verdad-de-terreno que 6 auditores
-- dejaron firmada en `qa_foto.ocr_esperado`. La medición de precisión, que es
-- lo único que ese gasto venía a comprar, no existió.
--
-- El medidor (src/lib/admin/qa-medicion.ts) arregla la mitad de TypeScript:
-- lee la evidencia que la corrida persistió (los `gasto` del tenant sintético,
-- por `img_hash`) y escribe una fila por foto. Esta migración arregla las dos
-- mitades que TypeScript no puede garantizar:
--
--   1. QUÉ CORRIDA MIDIÓ. Sin `corrida_id`, dos corridas con el mismo modelo
--      son indistinguibles en la tabla, y "¿mejoró entre el prompt A y el B?"
--      —la única pregunta que este historial contesta— no se puede responder.
--
--   2. LA IDEMPOTENCIA ES UN ÍNDICE, NO UN `if`. La medición de una corrida
--      se repite (la pasada que la corre puede morir a medias y la siguiente
--      re-medir; el script de respaldo se puede correr dos veces). Un
--      `if (yaMedida)` leído antes de insertar es una CARRERA: los dos lados
--      leen "no", los dos insertan, y el porcentaje se calcula sobre filas
--      dobles — una cifra inventada. Con el índice único parcial, el segundo
--      intento rebota con 23505 y el medidor lo lee como lo que es: esa foto
--      ya está medida en esta corrida. Misma lección que la PK de
--      `qa_corrida_foto` (0240) y que `uq_gasto_img_hash` en producción.
--
-- POR QUÉ EL ÍNDICE ES PARCIAL. Las lecturas SUELTAS del botón del banco
-- (`/api/admin/qa/fotos/ocr`) no pertenecen a ninguna corrida: llevan
-- `corrida_id` NULL y se APILAN a propósito — correr el OCR dos veces contra
-- la misma foto son dos instantes del historial, y borrar o rebotar el
-- segundo destruiría justo la comparación que la 0239 vino a permitir. El
-- `where corrida_id is not null` deja ese carril intacto: la unicidad aplica
-- SOLO dentro de una corrida, donde una segunda fila no sería historia sino
-- doble conteo.
--
-- POR QUÉ `on delete set null` Y NO cascade NI restrict. La lectura es
-- historial del MODELO contra la FOTO — por eso su FK dura es `foto_id`
-- (cascade, 0239: sin la foto la medición no significa nada). La corrida es
-- el CONTEXTO de esa medición, no su dueña: si algún día una corrida se
-- borra, sus mediciones siguen siendo instantes válidos del historial del
-- modelo (cascade los borraría) y el borrado de la corrida no tiene por qué
-- rebotar (restrict lo haría). Se queda la lectura, huérfana de corrida y
-- honesta: "medida, ya no se sabe en qué corrida".
--
-- RLS: la tabla ya está cerrada desde la 0239 (deny-all + grants solo a
-- service_role) y una columna nueva no abre nada — no hay policies que tocar.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.qa_foto_lectura
  add column if not exists corrida_id uuid references public.qa_corrida(id) on delete set null;

comment on column public.qa_foto_lectura.corrida_id is
  'La corrida del panel que produjo esta medición, o NULL si la lectura salió del botón suelto del banco (/api/admin/qa/fotos/ocr). Con ella, "¿mejoró el modelo entre estas dos corridas?" es una consulta; sin ella, dos corridas del mismo modelo son indistinguibles. `on delete set null`: la lectura es historial del modelo contra la foto y sobrevive a su corrida — la corrida es contexto, no dueña.';

-- LA IDEMPOTENCIA DE LA MEDICIÓN DE UNA CORRIDA. Parcial a propósito: las
-- lecturas sueltas (corrida_id NULL) se apilan — son historial. Dentro de una
-- corrida, la segunda medición de la misma foto rebota con 23505 y el medidor
-- la trata como "ya medida", no como error.
create unique index if not exists qa_foto_lectura_una_por_corrida
  on public.qa_foto_lectura (corrida_id, foto_id)
  where corrida_id is not null;

-- Leer "todas las lecturas de ESTA corrida" es la consulta de la pantalla de
-- la corrida; el índice único parcial de arriba ya la sirve (prefijo
-- corrida_id), así que no se crea un segundo índice que pagaría escritura
-- para acelerar nada.
