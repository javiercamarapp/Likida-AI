-- ═══════════════════════════════════════════════════════════════════════════
-- 0854 — EL FRENO TEMPORAL (automático, con TTL). HALLAZGO 2 de la auditoría
-- adversarial de A7 Cobranza (21-oct-2026).
--
-- `TOPE_RECHAZOS_META_COBRANZA`/`TOPE_RECHAZOS_META_GASTO` (cobranza.ts/
-- cobranza_gasto.ts) cuentan los rechazos reintentables SEGUIDOS de Meta con
-- una variable LOCAL (`let rechazosSeguidos = 0`) a cada llamada de
-- `ejecutarCobranza`. `ejecutarCobranzaGlobal` la propaga bien ENTRE flotas
-- porque las recorre en un bucle secuencial dentro de la MISMA llamada — pero
-- el botón "Ejecutar ahora" del panel (dashboard/agentes/cobranza/page.tsx)
-- llama `ejecutarCobranza` DIRECTO por tenant, fuera de ese bucle. Varias
-- corridas manuales concurrentes (distintos tenants, o un superadmin
-- insistiendo) podían acumular 5×N rechazos contra el MISMO número de
-- WhatsApp compartido antes de que cualquiera viera el freno de la otra —
-- el recurso que se protege es el NÚMERO, no una flota (mismo razonamiento
-- que ya usa `ejecutarCobranzaGlobal` para detener a las flotas restantes).
--
-- Esta tabla es ese freno, pero GLOBAL ENTRE INVOCACIONES (no solo entre
-- flotas de una misma llamada) y AUTOMÁTICO: lo prende el mismo código que
-- detecta el rechazo masivo, no un humano desde /admin/observabilidad, y por
-- eso NO exige `cambiado_por` ni un `motivo` no vacío como `interruptor`
-- (0110) — y SÍ necesita expirar SOLO, con un TTL corto, porque nada ni nadie
-- lo va a apagar a mano: cuando el rate-limit de Meta se enfríe, el freno
-- debe soltarse sin esperar una acción manual.
--
-- MISMO MOLDE QUE `interruptor` por lo demás: SIN FILA = SIN FRENO (el
-- default seguro es correr), catálogo cerrado por CHECK (un nombre inventado
-- no debe poder vivir para siempre sin frenar nada), deny-all (solo el
-- servidor, con service-role, lo lee y lo escribe).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.freno_temporal (
  -- El NOMBRE del freno, p. ej. 'cobranza:rechazo_masivo_whatsapp'.
  id           text primary key,
  -- Hasta cuándo está activo. Pasada esta fecha la fila queda inerte (se lee
  -- como "sin freno") sin que nadie la borre; la siguiente corrida que
  -- vuelva a disparar el mismo freno la sobreescribe con un nuevo plazo.
  activo_hasta timestamptz not null,
  -- Diagnóstico de por qué se prendió (a diferencia de `interruptor.motivo`,
  -- aquí NO es obligatorio: lo escribe código, no una persona explicando un
  -- incidente).
  motivo       text,
  creado_en    timestamptz not null default now(),

  -- El catálogo real. Un nombre fuera de esta lista rebota aquí, no vive en
  -- silencio sin frenar nada.
  constraint freno_temporal_id_dominio check (
    id in ('cobranza:rechazo_masivo_whatsapp')
  )
);

comment on table public.freno_temporal is
  '0854: freno AUTOMÁTICO con TTL (distinto de interruptor/0110, que es manual y requiere motivo+actor) — una fila con activo_hasta > now() significa "no trabajes todavía". SIN FILA = SIN FRENO. Solo lo tocan procesos del servidor (deny-all); se autolimpia por tiempo, nadie necesita apagarlo a mano.';
comment on column public.freno_temporal.id is
  'El nombre ES la llave, del catálogo de freno_temporal_id_dominio.';
comment on column public.freno_temporal.activo_hasta is
  'Hasta cuándo está activo. Una lectura con now() > activo_hasta se trata exactamente igual que "sin fila" (sin freno).';

-- Deny-all: enable SIN políticas. Todo acceso es service-role del servidor
-- (mismo patrón que `interruptor`, 0110).
alter table public.freno_temporal enable row level security;
