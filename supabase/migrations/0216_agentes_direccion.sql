-- ═══════════════════════════════════════════════════════════════════════════
-- 0216 — LA DIRECCIÓN SE ENCIENDE: kpi_whatsapp, desempeno_startup,
-- orquestador y orquestador_semanal pasan de 'disenado' a VIVOS en el runner.
--
-- Los cuatro existen en el catálogo desde la 0125 (blueprint escrito, cero
-- código). Hoy ganan motor (src/lib/likida/direccion/reportes.ts) y esta
-- migración hace las tres altas declarativas del patrón redactor (0122/0123):
--
--   1. El flip en `agente_definicion`: estado 'vivo' + runner_habilitado +
--      presupuesto_dia_usd. El techo se DECLARA aunque el motor v1 sea
--      determinista (cero modelo — las reglas calculan y también redactan,
--      con plantilla fija): el candado 3 del runner exige techo para correr,
--      y el día que alguno redacte con modelo, el freno ya está puesto.
--      `modelo_rol` pasa a NULL por la convención de la 0125: NULL = no usa
--      modelo de texto, que es la verdad de este motor. El rol 'analisis'
--      que la siembra les puso era el diseño; esto es lo construido.
--   2. El dominio del interruptor (0110) crece con los cuatro kill switches.
--      Un agente autónomo sin palanca no corre — candado 1 del runner.
--   3. `reporte_direccion`: el sello + el artefacto. Cada reporte generado
--      queda persistido UNA vez por (agente, periodo) — el unique es la
--      idempotencia del patrón 0202 (el sello se escribe DESPUÉS de que el
--      canal aceptó, lección c2-1: sellar antes de enviar convierte un fallo
--      transitorio en silencio permanente) y el cuerpo persistido es lo que
--      hace CITABLE al reporte (el blueprint de desempeño lo exige) y lo que
--      permite decir "ayer no salió el reporte" en vez de callarlo.
--
-- El canal de salida es el correo del operador (ALERTA_EMAIL) — INTERINO y
-- declarado en el propio reporte: el WhatsApp de Javier espera el número
-- verificado de Meta (sección c del plan-hacia-el-90, bloqueado fuera del
-- código). Cambiar de canal no cambia al agente: cambia una función de envío.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El flip: vivos, con techo y sin modelo (deterministas v1) ───────────
update public.agente_definicion
set estado            = 'vivo',
    runner_habilitado = true,
    presupuesto_dia_usd = 0.10,
    modelo_rol        = null,
    actualizado_en    = now()
where id in ('kpi_whatsapp', 'desempeno_startup', 'orquestador', 'orquestador_semanal');

-- ── 2. Los cuatro kill switches (candado 1 del runner) ─────────────────────
-- La lista incluye TAMBIÉN a los cuatro financieros de la 0215 a propósito:
-- las migraciones corren en orden numérico, así que esta recreación es la
-- ÚLTIMA y define el dominio final — si enumerara solo los míos, borraría
-- del CHECK a los que la 0215 acaba de dar de alta. Un valor de más en el
-- CHECK no enciende nada (SIN FILA = ENCENDIDO); uno de menos rompe la
-- palanca de otro agente en silencio.
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual',
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal'
  )
);

-- ── 3. El sello y el artefacto: un reporte por (agente, periodo) ───────────
create table if not exists public.reporte_direccion (
  id         uuid primary key default gen_random_uuid(),
  -- FK al catálogo (patrón 0116): un reporte sin autor declarado no existe.
  agente     text not null references public.agente_definicion(id),
  -- 'dia-AAAA-MM-DD' (el diario) o 'lun-AAAA-MM-DD' (la semana, por su
  -- lunes de México). Formato con CHECK: un periodo libre volvería el sello
  -- inservible — dos ortografías del mismo día serían dos reportes.
  periodo    text not null,
  -- El reporte TAL CUAL salió (o quedó como artefacto): la cita. Sin cuerpo
  -- no hay reporte que sellar.
  cuerpo     text not null,
  -- Conteos de la corrida (p. ej. prospectos por estado) para que la semana
  -- siguiente pueda decir el delta sin recalcular la historia.
  resumen    jsonb,
  -- Qué fuentes NO se pudieron leer al armarlo. Vacío = todas contestaron.
  -- Se persiste porque "fuentes ciegas por semana" es métrica del blueprint.
  fuentes_ciegas text[] not null default '{}',
  creado_en  timestamptz not null default now(),
  -- NULL = artefacto (diagnóstico, secciones del ciclo — los transporta
  -- otro agente) o correo que aún no sale. Solo lo escribe el motor DESPUÉS
  -- de que Resend aceptó el envío.
  enviado_en timestamptz,
  constraint reporte_direccion_cuerpo_no_vacio check (length(btrim(cuerpo)) > 0),
  constraint reporte_direccion_periodo_forma check (periodo ~ '^(dia|lun)-\d{4}-\d{2}-\d{2}$'),
  -- LA idempotencia (patrón 0202): la carrera de dos corridas del runner la
  -- gana exactamente una; la perdedora ve el unique y no duplica el correo.
  constraint reporte_direccion_agente_periodo unique (agente, periodo)
);

comment on table public.reporte_direccion is
  'Los reportes de dirección (0216): el sello de "ya salió/ya se generó" por (agente, periodo) y el cuerpo citable. Sin tenant: son del NEGOCIO, como prospecto (0105) y cola_aprobacion (0117). El único escritor es direccion/reportes.ts; el sello de envío se escribe después de que el canal aceptó (lección c2-1).';
comment on column public.reporte_direccion.enviado_en is
  'NULL = artefacto que transporta otro agente, o correo que no ha salido. Se escribe SOLO tras la aceptación del canal — jamás antes de enviar.';

-- Mismo doble candado que prospecto/cola_aprobacion: RLS deny-all + solo el
-- servidor. Ningún panel lee esto directo — lo que se enseña sale del server.
alter table public.reporte_direccion enable row level security;
revoke all on table public.reporte_direccion from public, anon, authenticated;
grant select, insert, update, delete on table public.reporte_direccion to service_role;
