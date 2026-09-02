-- ═══════════════════════════════════════════════════════════════════════════
-- 0230 — CRECIMIENTO SE ENCIENDE: los diez que quedaban en 'disenado' del
-- departamento que lleva la marca hacia AFUERA pasan a VIVOS.
--
--   contenido_fiscal · lead_magnet · seo_distribucion · guiones ·
--   noticias_mercado · promos_diarias · visuales · video_demo ·
--   video_marketing · alianzas
--
-- Los diez existen en el catálogo desde la 0125 (blueprint escrito, cero
-- código). Hoy ganan motor (src/lib/likida/agentes/crecimiento.ts y
-- .../contenido.ts) y esta migración hace las altas declarativas del patrón
-- 0215/0216/0218/0219:
--
--   1. El flip en `agente_definicion`: 'vivo' + runner_habilitado + techo
--      declarado + disparador 'cron'. Seis de los diez venían con disparador
--      'manual' (contenido_fiscal, lead_magnet, seo_distribucion, visuales,
--      video_demo, video_marketing): el runner solo despacha lo que dispara
--      por reloj (candado 2), y los seis motores ya saben irse en silencio
--      cuando su periodo ya tiene pieza.
--      `modelo_rol` dice la VERDAD del motor construido: NULL en los nueve
--      deterministas (la convención de la 0125 es NULL = no usa modelo de
--      texto) y 'marketing' en `contenido_fiscal`, el único que redacta.
--      Ojo con `visuales`, `video_demo` y `video_marketing`: su `modelo_rol`
--      ya era NULL desde la 0125 porque el blueprint pensaba en Higgsfield,
--      que NO es un modelo de texto. Sigue siendo NULL por una razón nueva y
--      más fuerte: el motor construido no llama a NINGÚN modelo — produce el
--      ENCARGO de la pieza, y el render vive en el flujo local de Javier.
--      El techo se declara en los diez porque el candado 3 del runner lo
--      exige, y porque el día que alguno redacte con modelo el freno ya está
--      puesto sin que nadie tenga que acordarse.
--   2. El dominio del interruptor (0110) crece con los diez kill switches.
--      Un agente autónomo sin palanca no corre — candado 1 del runner.
--   3. `cola_pieza_crecimiento_por_periodo`: UNA pieza por (agente, periodo).
--      El título es determinista por periodo y este índice único parcial es el
--      árbitro de la carrera entre dos pasadas del runner (estándar §7: la
--      idempotencia es un constraint, no un `if`). Parcial a los diez a
--      propósito, por la misma razón que el de la 0215/0218/0219: el Redactor
--      titula sus piezas con el asunto del correo y dos prospectos pueden
--      compartir asunto legítimamente.
--   4. `aliado_objetivo` — el registro DECLARATIVO de gremios y aliados a los
--      que Likida quiere acercarse. Se siembran los tres que el blueprint de
--      alianzas nombra (CANACAR, ANPACT, TyT) SIN UN SOLO DATO DE CONTACTO y
--      SIN fecha de toque: el agente los lee, ordena el turno y prepara el
--      material, y cuando un aliado no tiene contacto capturado su parte dice
--      «SIN CONTACTO CAPTURADO». Inventar un nombre o un correo para llenar el
--      hueco sería exactamente lo que este producto no hace.
--
-- LO QUE ESTA MIGRACIÓN NO HACE: no siembra un solo contacto, ni una fecha de
-- acercamiento, ni un artículo, ni una pieza. Sembrar un dato de negocio desde
-- una migración lo convierte en verdad sin que nadie lo haya declarado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El flip: vivos, con techo y con reloj ───────────────────────────────

-- Los nueve deterministas: sin modelo, techo formal de $0.10 (el mismo criterio
-- de la 0219 — deterministas de punta a punta, pero el candado 3 se declara).
update public.agente_definicion
set estado              = 'vivo',
    runner_habilitado   = true,
    disparador          = 'cron',
    presupuesto_dia_usd = 0.10,
    modelo_rol          = null,
    actualizado_en      = now()
where id in ('lead_magnet', 'seo_distribucion', 'guiones', 'noticias_mercado',
             'promos_diarias', 'visuales', 'video_demo', 'video_marketing', 'alianzas');

-- El único que gasta modelo. $1/día es el mismo techo que `atencion_faq`
-- (0218): un borrador de artículo por corrida con el rol `marketing`, y el
-- runner lo frena contra el gasto MEDIDO del día antes de cada pasada.
update public.agente_definicion
set estado              = 'vivo',
    runner_habilitado   = true,
    disparador          = 'cron',
    presupuesto_dia_usd = 1.00,
    modelo_rol          = 'marketing',
    actualizado_en      = now()
where id = 'contenido_fiscal';

-- Las descripciones del catálogo pasan de decir el DISEÑO a decir lo
-- CONSTRUIDO — que es justo el drift que el agente de documentación caza: un
-- flip de estado sin nota deja el catálogo contando lo de antes.
update public.agente_definicion set
  descripcion = 'Propone y redacta el borrador del siguiente artículo de /blog (0230). Elige tema por RESTA: el primero del catálogo de temas citables (normas/consulta.ts) que el blog no cubre y que tiene al menos 2 fichas verificadas. Si el corpus no lo sostiene, la pieza dice «esto lo escribe un humano». Tres guardias sobre el texto del modelo: reglas editoriales de la casa, ninguna cifra sin ficha y ninguna cita fuera del corpus recuperado. Aprobar NO publica: el artículo entra por un PR.',
  actualizado_en = now()
where id = 'contenido_fiscal';

update public.agente_definicion set
  descripcion = 'Vigila el embudo REAL de la calculadora pública (0230): vistas y conversiones por página de la semana cerrada, leídas de sitio_evento, y propone mejoras concretas con el texto listo. Sin filas NO es cero: la tasa sale INDEFINIDA y el parte nombra las dos lecturas posibles (nadie entró, o el pulso no reportó). Cuenta EVENTOS, nunca usuarios: sitio_evento no guarda nada del visitante.',
  actualizado_en = now()
where id = 'lead_magnet';

update public.agente_definicion set
  descripcion = 'Audita lo que EXISTE (0230): el <title> que de verdad se sirve, la meta-descripción, la forma del slug, los slugs duplicados y el puente interno a la calculadora, sobre las URLs del sitemap. NO habla de posiciones ni de rankings: Likida no tiene Search Console y una posición sin consola es una cifra inventada. Tampoco tiempos de build: el runner corre en la función, no en el pipeline.',
  actualizado_en = now()
where id = 'seo_distribucion';

update public.agente_definicion set
  descripcion = 'Escribe el guion semanal de video a la bandeja (0230): hook de 3 segundos, escenas numeradas con narración para ElevenLabs y cierre con el puente a la calculadora, destilado de un artículo YA publicado y verificado. Este servidor no tiene los videos de referencia ni whisper, así que no destila hooks nuevos: usa las formas de arranque de los artículos del repo, con su origen citado. LA RUTINA LOCAL guiones-semanal (lunes 08:00) SIGUE VÁLIDA hasta que Javier la apague.',
  actualizado_en = now()
where id = 'guiones';

update public.agente_definicion set
  descripcion = 'Carrusel del mercado con fuente POR DATO (0230): un slide por ficha verificada del corpus exigible en el último año, con su cita, su fecha y si obliga o solo orienta. Este servidor NO navega la web y no finge una investigación que no hizo; sin fichas suficientes NO fabrica un carrusel para llenar el hueco. Semanal y no diario: el corpus cambia cuando experto_fiscal asienta una ficha. LA RUTINA LOCAL noticias-diaria (09:00) SIGUE VÁLIDA hasta que Javier la apague.',
  actualizado_en = now()
where id = 'noticias_mercado';

update public.agente_definicion set
  descripcion = 'La promo del día de un beneficio REAL, verificado contra el código (0230): cada beneficio del catálogo declara qué símbolo del producto lo sostiene y su respaldo se MIDE en la corrida ejecutando el motor de la calculadora. Si el factor del peaje cambiara, la promo cambia con él o se cae. Copy por canal (LinkedIn, Instagram, TikTok). No compone la pieza gráfica: eso es del agente visuales. LA RUTINA LOCAL promos-diaria (10:00) SIGUE VÁLIDA hasta que Javier la apague.',
  actualizado_en = now()
where id = 'promos_diarias';

update public.agente_definicion set
  descripcion = 'Produce el ENCARGO de la pieza gráfica (0230): brief, copy verificado contra el motor, referencias de marca obligatorias de MARCA.md y DESIGN.md, y el prompt listo para la skill likida-post. NO genera imagen y no puede: los modelos de MARCA.md §5 corren por Higgsfield en el flujo local de Javier y el servidor no tiene el pipeline. La pieza lo declara en su propio cuerpo. El logo se compone, jamás se genera.',
  actualizado_en = now()
where id = 'visuales';

update public.agente_definicion set
  descripcion = 'Produce el ENCARGO del video que se manda antes de la llamada (0230): guion de 45 segundos anclado a un beneficio verificado contra el motor, con la parte de PRUEBA grabada de la UI real (papel abre, producto cierra), la cadena de seis etapas de MARCA.md §6 y el gate de Javier en la animación. NO genera video: la narración es ElevenLabs y la animación seedance, las dos en el flujo local.',
  actualizado_en = now()
where id = 'video_demo';

update public.agente_definicion set
  descripcion = 'Produce el ENCARGO del reel para el gremio (0230): estructura de 30 segundos destilada de un artículo YA publicado, que hereda la verificación editorial que ese artículo pasó en CI. Formato 1080x1920 con zona segura, canales LinkedIn/Instagram/TikTok. NO genera video: sheets, animación y narración viven en el flujo local de Javier.',
  actualizado_en = now()
where id = 'video_marketing';

update public.agente_definicion set
  descripcion = 'Mantiene la lista de gremios y aliados objetivo y propone el SIGUIENTE toque (0230): el que lleva más tiempo sin acercamiento, con el material que el sistema ya sabe (prospectos capturados agregados por ciudad) y la verdad de la tracción. NO inventa contactos: los aliados los declara una persona en aliado_objetivo y, sin contacto capturado, el parte dice «SIN CONTACTO CAPTURADO» y el siguiente paso es conseguirlo.',
  actualizado_en = now()
where id = 'alianzas';

-- ── 2. Los diez kill switches (candado 1 del runner) ───────────────────────
-- La lista recrea el dominio COMPLETO a propósito (mismo razonamiento que la
-- 0215/0216/0217/0218/0219 y la correctiva 0227): las migraciones corren en
-- orden numérico, así que la recreación más alta define el dominio final —
-- enumerar solo los míos borraría del CHECK las palancas de los agentes
-- anteriores. Un valor de más no enciende nada (SIN FILA = ENCENDIDO); uno de
-- menos rompe la palanca de otro agente en silencio, que es el fallo caro.
--
-- Los 30 primeros son la lista de la 0227 copiada TAL CUAL (que a su vez es la
-- de la 0219): global + 8 de flota/redactor + 4 financieros + 4 de dirección +
-- 3 de prospección + 6 de éxito + 4 de back office. Los 10 de abajo son los de
-- esta migración. Total: 40.
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    -- Los agentes de flota (0102/0105) y el Redactor (0122).
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    -- Los 4 financieros (0215).
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual',
    -- Los 4 de dirección (0216).
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal',
    -- La máquina de prospección (0217).
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
    -- Los 6 de éxito del cliente (0218).
    'agente:soporte', 'agente:onboarding_cliente', 'agente:exito_cliente',
    'agente:atencion_faq', 'agente:cobranza_saas', 'agente:retencion',
    -- Los 4 del back office restante (0219).
    'agente:vigilante_calidad', 'agente:documentacion',
    'agente:legal_compliance', 'agente:talento',
    -- Los 10 de crecimiento (0230). Ninguno publica nada, y aun así llevan
    -- palanca: son los únicos cuyo producto lleva la marca hacia AFUERA, y si
    -- una pieza sale mal, apagar al que la fabrica tiene que ser un click.
    'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:seo_distribucion',
    'agente:guiones', 'agente:noticias_mercado', 'agente:promos_diarias',
    'agente:visuales', 'agente:video_demo', 'agente:video_marketing',
    'agente:alianzas'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El dominio COMPLETO de palancas (40 al 0230). Cada migración que enciende agentes lo RECREA enumerando todo el catálogo: la recreación más alta gana, y una que enumere solo los suyos borraría en silencio las palancas anteriores (el incidente que la 0227 corrigió). El espejo en código es INTERRUPTORES en src/lib/likida/interruptores.ts.';

-- ── 3. Una pieza por periodo — el árbitro de la carrera ────────────────────
create unique index if not exists cola_pieza_crecimiento_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('contenido_fiscal', 'lead_magnet', 'seo_distribucion',
                   'guiones', 'noticias_mercado', 'promos_diarias',
                   'visuales', 'video_demo', 'video_marketing', 'alianzas');

comment on index public.cola_pieza_crecimiento_por_periodo is
  'UNA pieza por (agente, periodo) para los 10 de crecimiento (0230): el título es determinista por semana (o por día en promos_diarias, o por tema en contenido_fiscal) y dos pasadas del runner que compitan por el mismo lo resuelve la base — gana exactamente una. Parcial a estos diez: las piezas del Redactor titulan por asunto y pueden repetirse entre prospectos.';

-- ── 4. Los aliados objetivo, DECLARADOS ────────────────────────────────────
create table if not exists public.aliado_objetivo (
  -- Clave legible: el parte cita por id y un uuid no se cita.
  id             text primary key
                   constraint aliado_objetivo_id_forma check (id ~ '^[a-z0-9_]{2,40}$'),
  nombre         text not null
                   constraint aliado_objetivo_nombre_no_vacio check (length(btrim(nombre)) > 0),
  tipo           text not null
                   constraint aliado_objetivo_tipo_dominio
                   check (tipo in ('gremio', 'medio', 'aliado_comercial', 'evento')),
  estado         text not null default 'sin_contacto'
                   constraint aliado_objetivo_estado_dominio
                   check (estado in ('sin_contacto', 'contactado', 'en_platicas', 'aliado', 'descartado')),
  -- NULL = SIN CONTACTO CAPTURADO. El agente lo reporta como tal y JAMÁS
  -- inventa un nombre ni un correo: escribirle a un contacto que salió de una
  -- máquina es la forma más rápida de quemar una relación de gremio. Es texto
  -- libre y no una tabla de personas a propósito: aquí no se guardan datos
  -- personales de nadie, solo la nota de por dónde entrar que un humano
  -- escribió.
  contacto_nota  text,
  -- NULL = NUNCA SE LE TOCÓ. No es «hace mucho»: es que no consta.
  ultimo_toque_en date,
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Un aliado que ya lo es, o que se contactó, tiene que decir cuándo se le
  -- tocó: un estado que avanzó sin fecha no es auditable (mismo criterio que
  -- `candidato_criba_coherente`, 0219).
  constraint aliado_objetivo_toque_coherente
    check (estado in ('sin_contacto', 'descartado') or ultimo_toque_en is not null)
);

comment on table public.aliado_objetivo is
  'Gremios, medios y aliados a los que Likida quiere acercarse (0230). Los declara una persona; el agente alianzas solo los LEE, ordena el turno del siguiente toque y prepara el material con lo que el sistema ya sabe. Sin tenant: son de la empresa, no de una flota. Deny-all.';
comment on column public.aliado_objetivo.contacto_nota is
  'NULL = sin contacto capturado. El parte de alianzas escribe «SIN CONTACTO CAPTURADO» y propone conseguirlo por el directorio público del gremio — nunca rellena con un nombre inventado.';
comment on column public.aliado_objetivo.ultimo_toque_en is
  'NULL = nunca se le tocó. El agente ordena el turno poniendo primero a los que no constan tocados; NULL no se lee como «hace mucho tiempo», se lee como «no consta».';

-- Mismo doble candado que el resto del catálogo interno (0219/0223).
alter table public.aliado_objetivo enable row level security;
revoke all on table public.aliado_objetivo from public, anon, authenticated;
grant select, insert, update, delete on table public.aliado_objetivo to service_role;

-- La consulta del agente: el turno del siguiente toque.
create index if not exists aliado_objetivo_turno_idx
  on public.aliado_objetivo (ultimo_toque_en nulls first)
  where estado not in ('aliado', 'descartado');

-- Los tres que el blueprint de alianzas nombra. Se siembran SIN contacto y SIN
-- fecha: el registro existe para que el turno se vea, no para fingir que hay
-- una relación. Los nombres son los de instituciones públicas del gremio, no
-- datos de ninguna persona.
insert into public.aliado_objetivo (id, nombre, tipo, estado, notas) values
  ('canacar', 'CANACAR (Cámara Nacional del Autotransporte de Carga)', 'gremio', 'sin_contacto',
   'Nombrado en el blueprint de alianzas. Sin contacto capturado y sin acercamiento previo: el primer paso es conseguir la vía de entrada por el directorio público de la cámara.'),
  ('anpact', 'ANPACT (Asociación Nacional de Productores de Autobuses, Camiones y Tractocamiones)', 'gremio', 'sin_contacto',
   'Nombrado en el blueprint de alianzas. Sin contacto capturado y sin acercamiento previo.'),
  ('tyt', 'T21 / Transportes y Turismo (prensa del gremio)', 'medio', 'sin_contacto',
   'Nombrado en el blueprint de alianzas como TyT. Sin contacto capturado y sin acercamiento previo: la vía es la mesa de redacción publicada, no un correo adivinado.')
on conflict (id) do nothing;
