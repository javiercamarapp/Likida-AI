-- ═══════════════════════════════════════════════════════════════════════════
-- NOTIFICACIONES POR AGENTE — a quién avisar, de qué, y sin volverse ruido
--
-- La arquitectura de referencia tiene «Notificaciones» en el menú de sus 8 agentes. Likida tenía cero,
-- y hasta el 14-ago-2026 no se podía construir porque no había canal de
-- entrega. Ya lo hay (Resend), así que esto es lo que faltaba.
--
-- ── DOS TABLAS Y NO UNA, PORQUE SON DOS COSAS DISTINTAS ──────────────────
--
-- `..._config` es una DECISIÓN de la flota: a quién avisar y de qué. Cambia
-- cuando alguien entra al panel y la cambia.
--
-- `..._estado` es la HUELLA del anti-ruido: cuánto va de una condición y cuándo
-- se avisó por última vez. Cambia en cada corrida del cron, muchas veces al día.
-- Mezclarlas haría que cada corrida reescribiera la fila que guarda la decisión
-- del usuario — y una escritura concurrente podría perderla.
--
-- ── EL ANTI-RUIDO: MARCAS, NO CADENCIA ───────────────────────────────────
--
-- Se avisa cuando la magnitud CRUZA una marca (1, 5, 20), no cada N horas. Un
-- agente roto 40 corridas manda 3 correos; 200 corridas también mandan 3.
--
-- Las dos alternativas obvias se descartaron con su porqué:
--   · Ventana a secas ("uno cada 6 h"): un agente caído un fin de semana largo
--     manda 16 correos idénticos. La cadencia mide el reloj; hay que medir si
--     hay NOTICIA.
--   · Filo puro (avisar una vez y callar, como `escalado_en`): sirve para un
--     viaje, que se resuelve o se muere. Un agente caído no: al tercer día
--     nadie recuerda el correo del martes.
--
-- ── EL CHECK DE LAS DOS COLUMNAS DE LA HUELLA ────────────────────────────
--
-- `avisado_en` y `magnitud_avisada` van juntas o no van. Una huella con fecha
-- pero sin magnitud se leería como magnitud 0 —o sea, "cualquier cosa es
-- noticia"— y el anti-ruido dejaría de existir sin que nada fallara.
--
-- El dominio de `agente` duplica el catálogo de TypeScript A PROPÓSITO: un id
-- con typo crearía una fila de configuración inalcanzable, en silencio. El
-- precio es una migración el día que nazca el séptimo agente, y es barato.
--
-- Sin políticas de RLS, como la 0089: solo las toca el service role. Ninguna
-- sesión de panel las lee directo — todo pasa por el motor, que ancla el tenant
-- a mano.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.agente_notificacion_config (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  agente     text not null check (agente in ('liquidacion','facturas','cobranza','conductores','peajes','proveedores')),
  eventos    jsonb not null default '["corrida_fallida"]'::jsonb,
  roles      jsonb not null default '["flota_admin"]'::jsonb,
  updated_at timestamptz not null default now(),
  -- La PK compuesta la exige el `onConflict` del upsert.
  primary key (tenant_id, agente)
);

create table if not exists public.agente_notificacion_estado (
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  agente           text not null check (agente in ('liquidacion','facturas','cobranza','conductores','peajes','proveedores')),
  evento           text not null check (evento in ('corrida_fallida','cola_atorada','escalado')),
  magnitud         integer not null default 0 check (magnitud >= 0),
  avisado_en       timestamptz,
  magnitud_avisada integer check (magnitud_avisada is null or magnitud_avisada >= 1),
  actualizado_en   timestamptz not null default now(),
  primary key (tenant_id, agente, evento),
  constraint agente_notif_huella_completa
    check ((avisado_en is null) = (magnitud_avisada is null))
);

alter table public.agente_notificacion_config enable row level security;
alter table public.agente_notificacion_estado enable row level security;

comment on table public.agente_notificacion_config is
  'A quién avisar y de qué, por agente y flota. Es una DECISIÓN del usuario; vive aparte del estado para que el cron no la reescriba en cada corrida.';
comment on table public.agente_notificacion_estado is
  'La huella del anti-ruido: cuánto va de una condición y cuándo se avisó. Se avisa al CRUZAR una marca (1, 5, 20), no por reloj: un agente roto 200 corridas manda 3 correos.';
comment on constraint agente_notif_huella_completa on public.agente_notificacion_estado is
  'Las dos columnas de la huella van juntas o no van: una con fecha pero sin magnitud se leería como magnitud 0 —cualquier cosa es noticia— y el anti-ruido dejaría de existir en silencio.';
