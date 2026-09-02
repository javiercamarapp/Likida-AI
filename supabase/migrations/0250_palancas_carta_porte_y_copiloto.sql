-- ═══════════════════════════════════════════════════════════════════════════
-- 0250 — LAS DOS PALANCAS QUE FALTABAN CON CALL SITE REAL.
--
-- Inventario código→pantalla (28-ago-2026, tableros al día): 4 agentes 'vivo'
-- de `agente_definicion` no estaban en el CHECK de `interruptor` y /admin/
-- agentes les pintaba «Sin palanca propia». Pero la lección de la Fase 1
-- (15-ago: el interruptor de conductores "existía en el catálogo y ningún
-- call site lo preguntaba — era decorativo") manda: palanca SOLO donde un
-- call site la pregunte. De los 4, solo 2 tienen motor en `src/` que gatear:
--
--   · `agente:carta_porte` — el agente de WhatsApp que al despachar evalúa el
--     complemento y le escribe al jefe (carta_porte_wa.ts). Escribe a un
--     canal real y hoy apagarlo exige deploy o tumbar `global`.
--   · `agente:copiloto` — /api/admin/copiloto: gasto de modelo por llamada,
--     lecturas cross-tenant con service role y EJECUCIÓN de acciones
--     administrativas. La interfaz de mando también tiene que poderse callar
--     con un click si empieza a fabricar ruido.
--
-- Los otros 2 NO llevan palanca, con razón (y así queda en el inventario):
--   · `experto_fiscal` — sus dos rutinas (DOF diario, profundidad dominical)
--     corren LOCALES, fuera del deploy (0209): una palanca aquí no las
--     tocaría. Lo que sí corre en el producto es la tool `consultar_normas`
--     del chat, que es lectura pura del corpus.
--   · `guardia_alertas` — reglas deterministas (lib/admin/guardia.ts) dentro
--     del flujo del copiloto: lo apaga la palanca del copiloto.
--
-- MISMA MECÁNICA QUE 0227/0230/0234/0235: el CHECK se RECREA enumerando el
-- catálogo COMPLETO (58 del 0235 + estos 2 = 60). Una migración que enumere
-- solo los suyos borraría en silencio las palancas anteriores. Y la regla del
-- rebase sigue viva: CONTAR el dominio vigente en cada rebase, no confiar en
-- el número que traía el PR.
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- Los 4 de dirección que MANDAN CORREO (0216).
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
    -- Los 10 de crecimiento (0230).
    'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:seo_distribucion',
    'agente:guiones', 'agente:noticias_mercado', 'agente:promos_diarias',
    'agente:visuales', 'agente:video_demo', 'agente:video_marketing',
    'agente:alianzas',
    -- La descarga masiva del SAT (0231).
    'agente:descarga_sat',
    -- Los 8 de ingeniería (0234).
    'agente:migraciones', 'agente:seguridad', 'agente:rendimiento',
    'agente:pruebas', 'agente:auditor_codigo', 'agente:releases',
    'agente:producto', 'agente:datos_instrumentacion',
    -- Los 3 de dirección que van a la BANDEJA (0235).
    'agente:automejora', 'agente:especialistas_incidente', 'agente:fundraising',
    -- Los 6 de leads (0235).
    'agente:scorer', 'agente:dossier', 'agente:vigia',
    'agente:demo_prep', 'agente:propuestas', 'agente:cazador',
    -- Las 2 de esta migración (0250): los agentes vivos que corrían en el
    -- producto SIN poderse apagar. Carta Porte escribe al jefe por WhatsApp
    -- al despachar; el copiloto gasta modelo y ejecuta acciones de admin.
    'agente:carta_porte', 'agente:copiloto'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El dominio COMPLETO de palancas (60 al 0250 — el catálogo entero de la compañía agente más carta_porte y copiloto, más la global). Cada migración que enciende agentes lo RECREA enumerando todo el catálogo: la recreación más alta gana, y una que enumere solo los suyos borraría en silencio las palancas anteriores (el incidente que la 0227 corrigió). El espejo en código es INTERRUPTORES en src/lib/likida/interruptores.ts.';
