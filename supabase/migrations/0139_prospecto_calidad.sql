-- ═══════════════════════════════════════════════════════════════════════════
-- LA CALIDAD DEL CENSO DEJA DE VIVIR EN PROSA (18-ago-2026).
--
-- La auditoría de los 13 agentes encontró que el censo de 33,070 filas tiene
-- tres enfermedades, y que las tres nacen del mismo defecto estructural: los
-- datos que permitirían detectarlas NO están en columnas.
--
-- ── 1. `sitio` Y `sitio_verificado` ────────────────────────────────────────
-- El dominio se guardaba dentro de `notas` como el texto «sitio: x.mx». Sin
-- columna no hay índice, no hay validación y no hay forma barata de preguntar
-- "¿cuántas empresas comparten este dominio?" — que resultó ser LA consulta que
-- caza el error más caro. Ejemplos reales encontrados:
--   · PUNTO A PUNTO T2 con `gmodelo.com` (el enriquecedor se quedó con el
--     dominio del CORPORATIVO padre cuando la razón social no tenía sitio);
--   · VELCEN MOTORS con `monterrey.foton.mx` (dominio de la MARCA que
--     distribuye, no de la empresa — y encima es una agencia, no un
--     transportista);
--   · MT EXPRESS con `mtexpress.com`, que es un PERIÓDICO DE IDAHO. Ese
--     `news@mtexpress.com` habría recibido una oferta comercial en la
--     redacción de un diario estadounidense.
--
-- `sitio_verificado` es la mitad que faltaba: hoy `completitudDe` regala +10
-- puntos con solo ver el regex `sitio:` en las notas, así que una fila con el
-- dominio de la cervecera equivocada puntúa igual que una correcta y SUBE en el
-- tablero. El error de scraping se convertía en prioridad de venta.
--
-- ── 2. `scian` ─────────────────────────────────────────────────────────────
-- El código de actividad del DENUE se estaba TIRANDO — el mismo error que la
-- 0128 corrigió con lat/lng. Sin él, probar que una fila es transportista solo
-- se puede por heurística de texto, y la palabra "liquidación" arrastró bancos
-- (E-Global, cámara de compensación autorizada por Banxico), retail (Soriana) y
-- procesadores de pago (Copayment) al segmento que parecía el mejor del censo.
-- Con SCIAN 484/485/488 el veredicto es duro, no una sospecha.
--
-- ── 3. `duplicado_de` ──────────────────────────────────────────────────────
-- 1,291 filas de más medidas hoy: el universo real es 31,778, no 33,070. La
-- deduplicación se hacía sobre el nombre CRUDO, así que «AUTO EXPRESS PERLA» y
-- «AUTOEXPRESS PERLA» son dos prospectos. Tres Guerras aparece CINCO veces.
--
-- SE MARCA, NO SE BORRA. Un delete perdería el historial de toques y las notas
-- que cada corrida acumuló en cada copia, y no hay forma de deshacerlo. Apuntar
-- a la fila buena conserva todo y deja que el tablero decida qué enseñar — es
-- la misma lógica del filtro `/DUPLICADO:/` que `prospectos-mapa.ts` ya aplica
-- sobre `notas`, pero con dientes y sin depender de prosa.
--
-- NO SE CREA EL ÍNDICE ÚNICO sobre el nombre todavía: con 1,227 grupos
-- duplicados vivos, `create unique index` abortaría la migración entera. Va
-- después de marcar, en su propia migración, cuando la base ya pueda cumplirlo.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto
  add column if not exists sitio            text,
  add column if not exists sitio_verificado boolean not null default false,
  add column if not exists scian            text,
  add column if not exists duplicado_de     uuid references public.prospecto(id) on delete set null;

comment on column public.prospecto.sitio is
  'Dominio de la empresa. Antes vivia como texto «sitio: x.mx» dentro de notas, donde no se podia indexar ni validar.';
comment on column public.prospecto.sitio_verificado is
  'Alguien COMPROBO que este dominio es de esta empresa. false = salio del enriquecedor y puede ser el del corporativo padre, el de la marca que distribuye, o el de un tercero sin relacion.';
comment on column public.prospecto.scian is
  'Codigo de actividad del DENUE. 484=autotransporte de carga, 485=pasajeros, 488=servicios relacionados. Es el unico veredicto duro de «esto es transportista».';
comment on column public.prospecto.duplicado_de is
  'Apunta a la fila BUENA cuando esta es una copia. NULL = es la buena o no se ha revisado. Se marca, no se borra: un delete perderia los toques y las notas de la copia.';

-- Un prospecto no puede ser copia de sí mismo: eso oculta la fila para siempre
-- sin dejar a dónde ir.
alter table public.prospecto
  drop constraint if exists prospecto_duplicado_no_circular;
alter table public.prospecto
  add constraint prospecto_duplicado_no_circular
    check (duplicado_de is null or duplicado_de <> id);

-- El backfill saca el dominio de la prosa. Entra como NO verificado a
-- propósito: es exactamente el dato del que desconfiamos.
update public.prospecto
   set sitio = lower((regexp_match(notas, 'sitio:[ ]*(?:https?://)?(?:www[.])?([a-z0-9.-]+[.][a-z]{2,})'))[1])
 where sitio is null and notas ~ 'sitio:';

-- La consulta que caza el error más caro: un dominio pegado a varias empresas.
create index if not exists idx_prospecto_sitio on public.prospecto (sitio) where sitio is not null;
create index if not exists idx_prospecto_scian on public.prospecto (scian) where scian is not null;
-- Los vivos son los que NO son copia: es el filtro por defecto del tablero.
create index if not exists idx_prospecto_vivos on public.prospecto (created_at desc) where duplicado_de is null;
