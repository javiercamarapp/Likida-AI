-- ═══════════════════════════════════════════════════════════════════════════
-- 0125 — El organigrama COMPLETO en la base + el modelo de cada agente.
--
-- Pedido de Javier (16-ago-2026): "cada agente debe tener su stack según su
-- tipo de acción — pon a los mejores en su área". Dos piezas:
--
--  1. `modelo_rol`: QUÉ rol de modelo (models.ts) usa cada agente cuando
--     corre. NULL = no usa modelo de texto (deterministas como el asignador,
--     parsers como peajes, Playwright como facturas, o motores externos
--     como los de imagen/video — Higgsfield vía likida-marketing). El
--     runner del nivel 2 despachará por este rol; hoy ya documenta la
--     verdad de los 8 vivos.
--  2. La siembra de los DISEÑADOS del catálogo (00-Blueprint-Maestro/
--     catalogo-de-agentes.md, 15-ago-2026): un agente nuevo es una FILA —
--     el principio de la 0116 aplicado al organigrama entero. Estado
--     'disenado' = blueprint escrito, CERO código; /admin/agentes los
--     enseña como lo que son. Los 3 PROPUESTOS del catálogo (redes
--     sociales, calificador de respuestas, WhatsApp comercial) NO se
--     siembran: no tienen blueprint, y una fila sin diseño afirmaría uno.
--     prompt_ref apunta al blueprint dentro del paquete 13-Agentes-de-AI.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_definicion
  add column if not exists modelo_rol text
    constraint agente_definicion_modelo_rol_dominio check (modelo_rol is null or modelo_rol in
      ('ocr', 'cuadre', 'cuadre_fallback', 'chat', 'chat_ligero', 'router',
       'back_office', 'analisis', 'extraccion', 'marketing', 'codigo', 'codigo_escritura', 'qa'));

comment on column public.agente_definicion.modelo_rol is
  'El rol de modelo (src/lib/llm/models.ts) con el que corre este agente (0125). NULL = no usa modelo de texto (determinista, parser, Playwright o motor de imagen/video externo). El default de cada rol se cambia por env, sin deploy.';

-- ── La verdad de los 8 vivos: qué modelo usan HOY ──────────────────────────
update public.agente_definicion set modelo_rol = 'cuadre'      where id = 'liquidacion';
update public.agente_definicion set modelo_rol = null          where id in ('facturas', 'cobranza', 'conductores', 'peajes', 'proveedores', 'ventas');
update public.agente_definicion set modelo_rol = 'back_office' where id = 'redactor';

-- ── La siembra del catálogo (estado disenado = blueprint sin código) ───────
insert into public.agente_definicion (id, nombre, departamento, disparador, estado, modelo_rol, prompt_ref, descripcion) values
  -- 01 · Leads y Prospección (el pipeline del censo; asignador y redactor ya viven arriba)
  ('cazador',            'Cazador del censo',            'leads', 'cron',   'disenado', 'extraccion', '01-Leads-y-Prospeccion/prompts/cazador.md', 'Reactiva el scraper del censo y detecta vacantes nuevas cada día. El scraper es código (repo censo-liquidacion); el modelo solo normaliza.'),
  ('scorer',             'Scorer de señal',              'leads', 'manual', 'disenado', 'back_office', '01-Leads-y-Prospeccion/prompts/scorer.md', 'Puntúa la señal del prospecto a tier A/B/C con compuerta de giro.'),
  ('enriquecedor',       'Enriquecedor de contacto',     'leads', 'manual', 'disenado', 'extraccion', '01-Leads-y-Prospeccion/prompts/enriquecedor.md', 'DENUE → Maps → sitio; produce el teléfono. El de mayor impacto del pipeline.'),
  ('dossier',            'Dossier del prospecto',        'leads', 'manual', 'disenado', 'back_office', '01-Leads-y-Prospeccion/prompts/dossier.md', 'La ficha de una página para el vendedor.'),
  ('vigia',              'Vigía de leads fríos',         'leads', 'cron',   'disenado', 'back_office', '01-Leads-y-Prospeccion/prompts/vigia.md', 'Detecta el lead frío y lo devuelve al pool.'),
  -- 02 · Ventas
  ('sdr',                'SDR',                          'leads', 'manual', 'disenado', 'back_office', '02-Ventas/agente-sdr.md', 'Trabaja el lead ya asignado — borradores a la cola, jamás envía.'),
  ('demo_prep',          'Preparación de demo',          'leads', 'manual', 'disenado', 'back_office', '02-Ventas/agente-demo-prep.md', 'Garantiza que la sala del demo no falle.'),
  ('propuestas',         'Propuestas',                   'leads', 'manual', 'disenado', 'back_office', '02-Ventas/agente-propuestas.md', 'Arma la propuesta con las cifras del cliente — las cifras vienen de la guía canónica.'),
  -- 03 · Atención al Cliente + 12 · Ciclo
  ('soporte',            'Soporte',                      'exito_cliente', 'manual', 'disenado', 'back_office', '03-Atencion-al-Cliente/agente-soporte.md', 'Contesta y deja registro en tickets.'),
  ('onboarding_cliente', 'Onboarding del cliente',       'exito_cliente', 'cron',   'disenado', 'back_office', '03-Atencion-al-Cliente/agente-onboarding-cliente.md', 'De la firma al primer viaje liquidado.'),
  ('exito_cliente',      'Éxito del cliente',            'exito_cliente', 'cron',   'disenado', 'analisis', '03-Atencion-al-Cliente/agente-exito-del-cliente.md', 'Reporte de valor, alerta de silencio y gatillos de expansión.'),
  ('atencion_faq',       'Atención y FAQ',               'exito_cliente', 'manual', 'disenado', 'back_office', '12-Agentes-del-Ciclo/agente-atencion-y-faq.md', 'Dudas pre-venta y de soporte desde los documentos del paquete; escala con formato fijo.'),
  ('cobranza_saas',      'Cobranza SaaS',                'exito_cliente', 'cron',   'disenado', 'back_office', '04-Cobranza/agente-cobranza-saas.md', 'Dunning de las mensualidades de Likida: cadencia -3/0/+3/+7/+15 — a la cola, jamás envía solo.'),
  ('retencion',          'Retención',                    'exito_cliente', 'cron',   'disenado', 'back_office', '12-Agentes-del-Ciclo/agente-retencion.md', 'Alerta de silencio, reporte mensual de valor, gatillos de expansión.'),
  ('orquestador_semanal','Orquestador semanal del ciclo','direccion', 'cron',  'disenado', 'analisis', '12-Agentes-del-Ciclo/prompts/orquestador-semanal.md', 'El resumen semanal del ciclo para Javier.'),
  -- 05 · Marketing y Contenido (los mejores en prosa; cifras de la guía canónica)
  ('contenido_fiscal',   'Contenido fiscal',             'crecimiento', 'manual', 'disenado', 'marketing', '05-Marketing-y-Contenido/agente-contenido-fiscal.md', 'Piezas de contenido fiscal para el gremio — manda manual-de-contenido.md.'),
  ('lead_magnet',        'Lead magnet',                  'crecimiento', 'manual', 'disenado', 'marketing', '05-Marketing-y-Contenido/agente-lead-magnet.md', 'La calculadora de recuperación fiscal.'),
  ('seo_distribucion',   'SEO y distribución',           'crecimiento', 'manual', 'disenado', 'marketing', '05-Marketing-y-Contenido/agente-seo-y-distribucion.md', 'Decide dónde se pone cada pieza.'),
  -- 06 · Imagen y Video (el motor es Higgsfield vía likida-marketing — no un LLM de texto)
  ('visuales',           'Visuales de marca',            'crecimiento', 'manual', 'disenado', null, '06-Imagen-y-Video/agente-visuales.md', 'Piezas gráficas de marca estilo papel. Motor: subagente likida-marketing + Higgsfield, con MARCA.md del repo como fuente de verdad — §5 trae la matriz de modelos por pieza (nano_banana_2 ilimitadas sin texto, gpt_image_2 para texto quemado y character/sequence sheets, Soul ID para identidad) y §6 la cadena brief→likida-post→aprobación.'),
  ('video_demo',         'Video de demo',                'crecimiento', 'manual', 'disenado', null, '06-Imagen-y-Video/agente-video-demo.md', 'El video que se manda antes de la llamada. Motor: seedance_2_0 std/480p→upscale (MARCA.md §5), skills producir-video + prompt-video-ia + sequence-sheet; narración SIEMPRE ElevenLabs.'),
  ('video_marketing',    'Video de marketing',           'crecimiento', 'manual', 'disenado', null, '06-Imagen-y-Video/agente-video-marketing.md', 'Reels y shorts para el gremio. Mismo motor y proceso que video_demo (MARCA.md §5-6): sheets en gpt_image_2, animación en seedance, aprobación antes de publicar.'),
  -- 08 · Financieros (deciden con números de Likida → el rol de análisis)
  ('analista_metricas',  'Analista de métricas',         'back_office', 'cron',   'disenado', 'analisis', '08-Financieros/agente-analista-de-metricas.md', 'Las métricas del negocio, con el manual-financiero como ritmo.'),
  ('control_costos',     'Control de costos',            'back_office', 'cron',   'disenado', 'analisis', '08-Financieros/agente-control-de-costos.md', 'IA e infra: dónde se va el dinero. /admin/consumo es su pantalla.'),
  ('tesoreria',          'Tesorería',                    'back_office', 'cron',   'disenado', 'analisis', '08-Financieros/agente-tesoreria.md', 'Flujo y runway.'),
  ('cierre_mensual',     'Cierre mensual',               'back_office', 'cron',   'disenado', 'analisis', '08-Financieros/agente-cierre-mensual.md', 'El cierre con dinero real — escala a modelos de precisión por env cuando toque.'),
  -- 09 · Operaciones Internas
  ('orquestador',        'Orquestador 80/20',            'direccion',  'cron',   'disenado', 'analisis', '09-Operaciones-Internas/agente-orquestador.md', 'El director del 80/20. Su mitad determinista YA existe: el runner nivel 2 (0123).'),
  ('vigilante_calidad',  'Vigilante de calidad',         'back_office','cron',   'disenado', 'qa', '09-Operaciones-Internas/agente-vigilante-de-calidad.md', 'Audita a los otros agentes — juicio adversarial.'),
  ('documentacion',      'Documentación',                'back_office','cron',   'disenado', 'codigo', '09-Operaciones-Internas/agente-documentacion.md', 'Evita que el paquete envejezca respecto al código.'),
  -- 10 · Ingeniería y Producto (los coder-specialists)
  ('auditor_codigo',     'Auditor de código',            'ingenieria', 'cron',   'disenado', 'codigo', '10-Ingenieria-y-Producto/agente-auditor-de-codigo.md', 'AUDITA (hallazgos, no diffs) con open-weight USA — regla del 16-ago: ningún modelo chino toca el código. Caza en manada con los testers (qa); el FIX corre con codigo_escritura (Sonnet). La skill auditoria-diaria ya existe.'),
  ('migraciones',        'Vigía de migraciones',         'ingenieria', 'cron',   'disenado', 'codigo', '10-Ingenieria-y-Producto/agente-de-migraciones.md', 'Vigila el contrato de la base de datos.'),
  ('pruebas',            'Pruebas',                      'ingenieria', 'cron',   'disenado', 'codigo_escritura', '10-Ingenieria-y-Producto/agente-de-pruebas.md', 'Mantiene la suite — ESCRIBE código de prueba, así que corre con modelo USA frontera (regla del 16-ago: ningún chino toca el código; modificarlo escala a los mejores). El diff va a aprobación.'),
  ('releases',           'Releases',                     'ingenieria', 'manual', 'disenado', 'codigo', '10-Ingenieria-y-Producto/agente-de-releases.md', 'Acompaña cada despliegue.'),
  ('rendimiento',        'Rendimiento',                  'ingenieria', 'cron',   'disenado', 'codigo', '10-Ingenieria-y-Producto/agente-de-rendimiento.md', 'La deuda con fecha de caducidad.'),
  ('producto',           'Producto',                     'ingenieria', 'cron',   'disenado', 'analisis', '10-Ingenieria-y-Producto/agente-de-producto.md', 'Traduce señal en backlog.'),
  -- 11 · Alertas y Dirección (la guardia y el copiloto YA son código)
  ('guardia_alertas',    'Guardia de alertas (A0)',      'direccion', 'manual', 'vivo', null, '11-Alertas-y-Direccion/agente-guardia-de-alertas.md', 'VIVA como reglas deterministas (lib/admin/guardia.ts) cableadas al copiloto — el LLM redacta, las reglas deciden.'),
  ('kpi_whatsapp',       'KPI a WhatsApp',               'direccion', 'cron',   'disenado', 'analisis', '11-Alertas-y-Direccion/agente-kpi-a-whatsapp.md', 'El reporte en el teléfono de Javier — hoy correo; WhatsApp cuando Meta verifique.'),
  ('desempeno_startup',  'Desempeño de la startup',      'direccion', 'cron',   'disenado', 'analisis', '11-Alertas-y-Direccion/agente-desempeno-de-la-startup.md', 'El tablero de la dirección.'),
  ('especialistas_incidente', 'Especialistas de incidente (8)', 'direccion', 'manual', 'disenado', 'analisis', '11-Alertas-y-Direccion/agentes-especialistas-de-incidente.md', 'Ocho runbooks, uno por familia de alerta — la matriz determinista ya vive en la guardia; el especialista redacta el diagnóstico.'),
  ('copiloto',           'Copiloto del fundador',        'direccion', 'manual', 'vivo', 'analisis', '11-Alertas-y-Direccion/copiloto-del-fundador.md', 'VIVO: /admin/copiloto + panel ⌘J + historial 0121. La interfaz de mando de la compañía-agente.')
on conflict (id) do nothing;
