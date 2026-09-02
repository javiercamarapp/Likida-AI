-- ═══════════════════════════════════════════════════════════════════════════
-- 0232 · EL ESTADO DEL VÍNCULO CON CADA PORTAL DE FACTURACIÓN.
--
-- Tres palabras por (flota, portal) —vinculado / sin vincular / sesión
-- caducada— con su fecha y su motivo, para que el contralor sepa cuál de sus
-- portales necesita que entre él y cuál se está facturando solo.
--
-- ── POR QUÉ HACE FALTA UNA TABLA Y NO SE DERIVA DEL COFRE ─────────────────
--
-- La sesión ya iniciada de un portal vive CIFRADA en `conector_credencial`
-- (fila `<conector>#sesion`, ver `src/lib/likida/facturacion/sesion_portal.ts`):
-- es un token de acceso vivo y ahí tiene que quedarse. Pero la pantalla
-- necesita tres cosas que NO son secretas —el estado, la fecha del último
-- login y el porqué de la última caducidad— y derivarlas del cofre obligaría
-- al panel a DESCIFRAR sesiones para pintar una píldora. Esa es la peor razón
-- posible para tocar una llave de cifrado.
--
-- Aquí se guarda el resumen en claro. Sin una sola cookie, sin un byte del
-- `storageState`, y con un CHECK que impide que alguien meta uno por error
-- (`portal_estado_motivo_sin_json`, abajo).
--
-- ── LAS TRES PALABRAS, Y POR QUÉ SON TRES Y NO DOS ────────────────────────
--
--   · sin_vincular — nadie ha entrado nunca a ese portal desde Likida. El
--     ticket va con el encargado, como siempre. No es un error: es el estado
--     inicial de todo portal con cuenta.
--   · vinculado — hay una sesión guardada que el portal aceptó. El robot entra
--     solo.
--   · caducada — HABÍA una y el portal la rechazó. Es lo que separa «esto
--     nunca ha funcionado» de «esto funcionaba y hay que renovarlo», que son
--     dos mensajes distintos para la misma persona. Sin este estado, un
--     portal que se acaba de caer se leería igual que uno que nunca se
--     configuró, y el contralor no sabría si perdió algo.
--
-- LA AUSENCIA DE FILA ES `sin_vincular`. Se escribe fila solo cuando pasó
-- algo, así que una flota que nunca ha vinculado nada no paga trece filas de
-- «no» — y la pantalla no tiene que distinguir «no hay fila» de «hay fila que
-- dice no», porque las dos significan lo mismo.
--
-- ── POR QUÉ NO CUELGA DE `conector_credencial` ────────────────────────────
--
-- Sería la FK compuesta obvia y está DESCARTADA a propósito, por dos razones:
--
--   1. Hay portales SIN cuenta (CAPUFE, Megasur: se entra con RFC y nada más)
--      que igual tienen vínculo: su sesión existe y caduca. Colgar el estado
--      de la credencial dejaría a esos fuera de la pantalla.
--   2. Desactivar la credencial APAGA la sesión (`credenciales.ts`, Auditoría
--      1) — y ese es justo el momento en que la pantalla más necesita seguir
--      diciendo «caducada, el 9 de agosto». Con un `on delete cascade` el
--      renglón desaparecería en silencio; con un `set null` habría que
--      explicar una FK nula que no significa nada.
--
-- Lo que sí se lleva es el `unique (id, tenant_id)` de la casa (0028/0145):
-- la llave que hace posible colgar una FK compuesta de aquí el día que algo
-- tenga que apuntar a un vínculo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El estado del vínculo, por flota y portal ───────────────────────────
create table if not exists public.portal_estado (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- La CLAVE del comercio en `src/lib/likida/facturacion/comercios.ts`
  -- ('capufe', 'la_gas', 'g500'…). Texto y no enum por lo mismo que
  -- `conector_credencial.conector_id`: el catálogo vive en TypeScript y crece
  -- con cada pre-vuelo; un enum en la base obligaría a una migración por
  -- gasolinera nueva.
  comercio       text not null,
  estado         text not null,
  -- El último login humano que sí produjo sesión. Es la fecha que la pantalla
  -- enseña junto a «vinculado».
  vinculada_en   timestamptz,
  -- Cuándo el portal rechazó la sesión guardada. Se CONSERVA aunque después se
  -- vuelva a vincular: «vinculado el 3, se cayó el 9, vinculado otra vez el 9»
  -- es la historia que hace que el contralor entienda que esto ya le pasó.
  caducada_en    timestamptz,
  -- En palabras, para la pantalla: qué se vio. NUNCA una cookie ni un secreto
  -- — lo impide el CHECK de abajo y lo garantiza el escritor
  -- (`anotarVinculo`, que solo pasa evidencia de `vinculo_senales.ts`).
  motivo         text,
  actualizado_en timestamptz not null default now(),

  constraint portal_estado_unico unique (tenant_id, comercio),
  constraint portal_estado_comercio_no_vacio
    check (btrim(comercio) <> '' and char_length(comercio) <= 64),
  constraint portal_estado_dominio
    check (estado in ('vinculado', 'sin_vincular', 'caducada')),
  -- EL CANDADO DEL DISEÑO, dos veces: un estado sin su fecha es una píldora
  -- que no se puede pintar. «Vinculado» sin saber desde cuándo no le dice
  -- nada a nadie, y «caducada» sin fecha no distingue lo de hace diez minutos
  -- de lo del mes pasado.
  constraint portal_estado_vinculado_con_fecha
    check (estado <> 'vinculado' or vinculada_en is not null),
  constraint portal_estado_caducada_con_fecha
    check (estado <> 'caducada' or caducada_en is not null),
  constraint portal_estado_motivo_acotado
    check (motivo is null or char_length(motivo) <= 400),
  -- AQUÍ NO ENTRA UNA SESIÓN. `storageState` es un JSON que empieza por `{`,
  -- y el mismo CHECK que `conector_credencial_no_en_claro` usa para impedir
  -- que una credencial se guarde sin cifrar sirve aquí para lo contrario: que
  -- nadie meta una bolsa de cookies en la columna que la pantalla lee en
  -- claro. El motivo es una frase en español, no un objeto.
  constraint portal_estado_motivo_sin_json
    check (motivo is null or motivo !~ '^\s*[\{\[]'),
  -- La llave que hace posibles las FK compuestas de la casa (0028/0145).
  constraint portal_estado_id_tenant_key unique (id, tenant_id)
);

comment on table public.portal_estado is
  'El estado del vínculo con cada portal de facturación, por flota (0232). Resumen EN CLARO de algo cuyo contenido vive cifrado: la sesión de Playwright está en conector_credencial (fila #sesion, sesion_portal.ts) y aquí solo hay el estado, las fechas y el motivo en palabras. La pantalla nunca se acerca al cofre. La AUSENCIA de fila significa sin_vincular.';
comment on column public.portal_estado.comercio is
  'Clave del comercio en src/lib/likida/facturacion/comercios.ts. Texto y no enum: el catálogo crece con cada pre-vuelo y un enum obligaría a una migración por gasolinera.';
comment on column public.portal_estado.estado is
  'vinculado = hay sesión guardada que el portal aceptó, el robot entra solo; caducada = HABÍA una y el portal la rechazó, hay que volver a entrar UNA vez; sin_vincular = nadie ha entrado nunca (también es lo que significa no tener fila).';
comment on column public.portal_estado.motivo is
  'La evidencia en español de lo último que pasó, tal como la escribió vinculo_senales.ts ("el portal enseña un campo de contraseña (#pass)"). Acaba en una pantalla y en un WhatsApp: por eso está acotado a 400 y por eso el CHECK impide que alguien meta aquí un JSON.';
comment on constraint portal_estado_motivo_sin_json on public.portal_estado is
  'Ninguna cookie en claro. El motivo es una frase para una persona; un valor que empiece por { o [ sería un storageState o un volcado, y esta columna la lee el panel sin descifrar nada.';

-- El panel pinta la pantalla de portales de UNA flota: se lee por tenant y se
-- cruza contra el catálogo en memoria. Con `unique (tenant_id, comercio)` ya
-- hay índice para eso, así que no se agrega otro — un índice de más es una
-- escritura de más en cada corrida del cron.

-- Mismo doble candado que 0196/0198/0207/0215/0229: RLS deny-all + solo
-- service_role. La pantalla lo lee desde un server component con
-- `supabaseAdmin()`, igual que `listarCredenciales`; ninguna sesión de
-- navegador toca esta tabla directamente.
alter table public.portal_estado enable row level security;
revoke all on table public.portal_estado from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_estado to service_role;
