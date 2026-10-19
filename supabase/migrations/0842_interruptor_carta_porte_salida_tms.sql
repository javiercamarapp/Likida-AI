-- ═══════════════════════════════════════════════════════════════════════════
-- 0842 — AMPLÍA `interruptor_id_dominio` CON `agente:carta_porte_salida_tms`.
--
-- T-A3-28 (carta-porte-salida-tms.md, carta-porte-multiformato.md) ya pregunta
-- este interruptor en DOS call sites reales (`src/app/api/cron/carta-porte-docs/
-- route.ts`) y YA vive en `INTERRUPTORES` (src/lib/likida/interruptores.ts:113).
-- Pero la restricción `interruptor_id_dominio` de la base se quedó en la lista
-- de la 0250 (60 nombres): sin este nombre en el CHECK, el panel no puede
-- INSERTAR una fila para apagarlo — `estaApagado()` lee «sin fila = encendido»
-- y nadie puede escribir la fila que lo apagaría. La única palanca práctica
-- hasta hoy era poner el modo en `descarga` (menos descubrible; ver
-- docs/operacion/carta-porte-salida-tms.md línea ~37 y su rollback). El
-- `APLICAR-EN-PRODUCCION.md` ya anotaba esta migración como pendiente.
--
-- MISMA MECÁNICA QUE 0227/0230/0234/0235/0250: el CHECK se RECREA enumerando
-- el catálogo COMPLETO (60 del 0250 + este 1 = 61). Una migración que
-- enumerara solo el suyo borraría en silencio las palancas anteriores (el
-- incidente que la 0227 corrigió). ADITIVA: ningún nombre se quita.
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
    -- Las 2 de la 0250: los agentes vivos que corrían en el producto SIN
    -- poderse apagar. Carta Porte escribe al jefe por WhatsApp al despachar;
    -- el copiloto gasta modelo y ejecuta acciones de admin.
    'agente:carta_porte', 'agente:copiloto',
    -- La de esta migración (0842): la SALIDA de Carta Porte al TMS del
    -- cliente (T-A3-28). Palanca propia y no solo `agente:carta_porte`: la
    -- pasada de envíos SUBE un archivo al sistema del cliente (efecto fuera
    -- de Likida) y apagarla no debe frenar la extracción de la bandeja.
    'agente:carta_porte_salida_tms'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El dominio COMPLETO de palancas (61 al 0842 — el catálogo entero de la compañía agente, más carta_porte, copiloto y la salida de carta_porte al TMS, más la global). Cada migración que enciende agentes lo RECREA enumerando todo el catálogo: la recreación más alta gana, y una que enumere solo los suyos borraría en silencio las palancas anteriores (el incidente que la 0227 corrigió). El espejo en código es INTERRUPTORES en src/lib/likida/interruptores.ts.';
