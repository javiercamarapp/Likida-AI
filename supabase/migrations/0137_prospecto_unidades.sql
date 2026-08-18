-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE EL LEAD TRAE CONSIGO: TAMAÑO, URGENCIA Y DE DÓNDE VINO (18-ago-2026).
--
-- `/getdemo` preguntaba tres cosas que se estaban TIRANDO: al embed de Cal.com
-- solo le llegaban nombre, apellido y correo. Y ni siquiera preguntaba las dos
-- que más califican: qué tan urgente es y por qué anuncio llegó.
--
-- ── `unidades` ES TEXTO, NO ENTERO. La primera versión de esta migración la
-- declaró `int` y estaba MAL: el formulario no pide un número, pide un RANGO en
-- un `<select>` ("5 a 30 unidades", "101 a 250"). Sacarle el primer número
-- guardaría 101 para una flota de 250 — el piso del rango leído como si fuera
-- la flota entera, y siempre por debajo. Se guarda el CÓDIGO estable de la
-- opción ('5-30', '31-100', '101-250', '250+'), no su etiqueta: la etiqueta
-- está traducida y en inglés entraría "5 to 30 trucks", dejando la misma
-- respuesta escrita de dos formas según el idioma del visitante.
--
-- ── `urgencia` ES DOMINIO CERRADO, como `estado`. Texto libre aquí no se puede
-- agrupar, y el punto entero de preguntarlo es poder ordenar la cola por quién
-- necesita esto YA.
--
-- ── `atribucion` ES JSONB porque las plataformas de anuncios inventan
-- parámetros cada temporada (`fbclid`, `gclid`, `utm_*`, `msclkid`…). Una
-- columna por parámetro obliga a una migración cada vez que Meta cambia de
-- opinión. El CANAL —lo que se agrupa en el tablero— vive en `fuente`, que ya
-- existía y que `lib/admin/adquisicion.ts` ya grafica; esto es el detalle
-- debajo de esa etiqueta, no su reemplazo.
--
-- NULL SIGUE SIENDO UN VALOR REAL en las tres: los 33,070 del censo entraron
-- sin nada de esto porque el DENUE no lo trae. `null` = no se sabe.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto
  add column if not exists unidades   text,
  add column if not exists urgencia   text,
  add column if not exists atribucion jsonb;

comment on column public.prospecto.unidades is
  'Rango de flota que declaro el prospecto, como CODIGO estable del select de /getdemo: 5-30, 31-100, 101-250, 250+. Nunca la etiqueta traducida. NULL = no se sabe (el censo del DENUE no lo trae).';

comment on column public.prospecto.urgencia is
  'Que tan pronto necesita resolverlo, del select de /getdemo. NULL = no se pregunto (todo el censo).';

comment on column public.prospecto.atribucion is
  'De donde vino el lead: utm_*, fbclid/gclid, referrer y la ruta de aterrizaje. El CANAL agrupable vive en `fuente`; esto es el detalle.';

alter table public.prospecto
  drop constraint if exists prospecto_unidades_positivas;

alter table public.prospecto
  drop constraint if exists prospecto_unidades_dominio;
alter table public.prospecto
  add constraint prospecto_unidades_dominio
    check (unidades is null or unidades in ('5-30', '31-100', '101-250', '250+'));

alter table public.prospecto
  drop constraint if exists prospecto_urgencia_dominio;
alter table public.prospecto
  add constraint prospecto_urgencia_dominio
    check (urgencia is null or urgencia in ('inmediata', 'trimestre', 'explorando'));

-- El tablero de adquisición filtra por canal; sin índice, cada corte recorre
-- las 33,070 filas. Parcial porque `censo` es la enorme mayoría y no se filtra
-- por ella: lo que se busca son los pocos que llegaron por anuncio o landing.
create index if not exists idx_prospecto_fuente_no_censo
  on public.prospecto (fuente, created_at desc) where fuente <> 'censo';
