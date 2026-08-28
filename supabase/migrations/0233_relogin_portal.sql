-- ═══════════════════════════════════════════════════════════════════════════
-- 0233 · EL PERMISO PARA RECONECTAR SOLA — consentimiento, candado y bitácora
-- del re-login automático de portales.
--
-- Encargo del 27-ago-2026: «si vuelve a pedir contraseña quiero que el agente
-- pueda resolverlo». El mismo día, el #146 había RETIRADO el auto-tecleo de
-- contraseñas porque se descifraban en cada ticket dentro del camino de
-- facturar. Las dos cosas conviven porque esta tabla existe:
--
--   · Sin fila, o con `permitido = false`, NO PASA NADA NUEVO. La sesión
--     caduca, `portal_estado` (0232) dice «caducada» y entra una persona,
--     exactamente como hoy. No hay default silencioso.
--   · Con `permitido = true`, y SOLO entonces, `relogin.ts` abre el cofre —una
--     vez por caducidad, no una por ticket— y vuelve a entrar.
--
-- ── POR QUÉ EL CONSENTIMIENTO ES UNA FILA Y NO UNA VARIABLE DE ENTORNO ────
--
-- Porque es de la FLOTA, no de Likida, y porque hay que poder contestar «¿quién
-- autorizó que guardáramos la contraseña de esta cuenta, y cuándo?» un año
-- después. Una palanca global lo activaría para clientes que no lo pidieron;
-- una columna booleana sin autor sería un permiso que nadie dio. Por eso el
-- CHECK `portal_relogin_permiso_firmado` hace IMPOSIBLE guardar `permitido =
-- true` sin quién y sin cuándo: el consentimiento sin firma no entra a la base.
--
-- ── POR QUÉ NO SON COLUMNAS DE `portal_estado` ───────────────────────────
--
-- `portal_estado` lo reescribe el cron en CADA corrida (`anotarVinculo` hace
-- upsert). Meter ahí un consentimiento —un dato legal, que se da una vez y dura
-- años— junto a un estado que se pisa cada quince minutos es cómo se pierde un
-- consentimiento por un upsert mal escrito. Van aparte a propósito, con la
-- misma llave lógica `(tenant_id, comercio)` para que se crucen en memoria.
--
-- ── POR QUÉ NO CUELGA DE `portal_estado` NI DE `conector_credencial` ──────
--
-- Mismo razonamiento que la 0232, y la conclusión también es la misma:
--
--   1. Una FK a `portal_estado (tenant_id, comercio)` obligaría a que exista
--      una fila de estado ANTES de poder autorizar. Pero la 0232 declara que
--      la AUSENCIA de fila es `sin_vincular`, y crear una para poder guardar un
--      permiso obligaría a escribir un estado que nadie observó.
--   2. Una FK a `conector_credencial` desaparecería el permiso el día que la
--      flota desactive la credencial — y ese es justo el momento en que hay
--      que poder enseñar «lo autorizaste el 3 de agosto y lo revocaste el 9».
--
-- Lo que sí se lleva es el `unique (id, tenant_id)` de la casa (0028/0145): la
-- llave compuesta con tenant que hace posible colgar una FK de aquí el día que
-- algo tenga que apuntar a un permiso, sin que ese algo pueda cruzar flotas.
--
-- ── LO QUE AQUÍ NO ENTRA ─────────────────────────────────────────────────
--
-- NI UNA CONTRASEÑA, ni un pedazo de una, ni una cookie. La contraseña vive
-- cifrada en `conector_credencial` (cofre AES-256-GCM) y la sesión en su fila
-- `#sesion`. Aquí solo hay el permiso, los contadores y el motivo del último
-- corte EN PALABRAS — lo que la pantalla enseña sin descifrar nada. El CHECK
-- `portal_relogin_motivo_sin_json` lo defiende igual que en la 0232.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.portal_relogin (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  -- La CLAVE del comercio en `src/lib/likida/facturacion/comercios.ts`. Texto
  -- y no enum por lo mismo que en la 0232: el catálogo vive en TypeScript.
  comercio          text not null,

  -- ── EL CONSENTIMIENTO ────────────────────────────────────────────────────
  -- Default `false`: un portal sin fila y un portal con fila sin permiso
  -- significan lo mismo, y es lo que pasa hoy.
  permitido         boolean not null default false,
  -- Quién lo dio (correo, o el id si no hubiera correo) y cuándo. El CHECK de
  -- abajo los exige cuando `permitido` es true.
  permitido_por     text,
  permitido_en      timestamptz,
  -- Y quién lo quitó. Se CONSERVA: «lo autorizó Ana el 3, lo quitó Luis el 9»
  -- es la historia que hace auditable un permiso, y borrarla al revocar dejaría
  -- la tabla diciendo solo que hoy no hay permiso.
  revocado_por      text,
  revocado_en       timestamptz,

  -- ── EL CANDADO ANTIBLOQUEO ───────────────────────────────────────────────
  -- Cuántos re-logins automáticos se han gastado en `dia_de_intentos`. La
  -- ventana es el DÍA DE MÉXICO y la calcula TypeScript (`diaMx`): el servidor
  -- corre en UTC y una ventana en UTC partiría el día de la flota a las 18:00.
  intentos_dia      integer not null default 0,
  dia_de_intentos   date,
  -- El reloj del backoff. Se escribe ANTES de intentar, no después: si la
  -- función muere a media sesión, el contador ya se movió y la corrida
  -- siguiente no vuelve a gastarle un intento a la cuenta del cliente.
  ultimo_intento_en timestamptz,

  -- ── LA BITÁCORA VISIBLE ──────────────────────────────────────────────────
  -- «Reconecté sola el 9 de agosto a las 15:04». Es la frase que la pantalla
  -- cita, y sin esta columna sería una afirmación sin respaldo.
  ultimo_exito_en   timestamptz,
  -- Por qué se detuvo la última vez, EN ESPAÑOL y para una persona.
  ultimo_motivo     text,
  ultima_clase      text,

  -- ── EL CANDADO INNEGOCIABLE ──────────────────────────────────────────────
  -- `true` = el re-login de este portal está DETENIDO hasta que una persona
  -- intervenga. Lo enciende exactamente un caso: el portal contestó
  -- «credenciales inválidas». Reintentar con una contraseña mala es la forma
  -- más rápida de que el portal bloquee la cuenta del cliente, y ese daño no
  -- lo paga Likida: lo paga la flota, con su facturación del mes.
  bloqueado         boolean not null default false,

  actualizado_en    timestamptz not null default now(),

  constraint portal_relogin_unico unique (tenant_id, comercio),
  -- La llave compuesta con tenant de la casa (0028/0145).
  constraint portal_relogin_id_tenant_key unique (id, tenant_id),

  constraint portal_relogin_comercio_no_vacio
    check (btrim(comercio) <> '' and char_length(comercio) <= 64),

  -- UN CONSENTIMIENTO SIN FIRMA NO ES UN CONSENTIMIENTO.
  constraint portal_relogin_permiso_firmado
    check (not permitido or (permitido_por is not null and btrim(permitido_por) <> '' and permitido_en is not null)),

  -- Un candado sin motivo es un candado que nadie sabe cómo abrir.
  constraint portal_relogin_bloqueo_con_clase
    check (not bloqueado or ultima_clase is not null),

  -- El tope real lo pone TypeScript (`TOPE_INTENTOS_DIA = 3`); esto es la red:
  -- un contador negativo o desbocado significa que algo se rompió, y es mejor
  -- que el INSERT reviente ruidoso a que la base guarde un número que apagaría
  -- el freno.
  constraint portal_relogin_intentos_sanos
    check (intentos_dia >= 0 and intentos_dia <= 1000),

  -- El catálogo CERRADO de cortes, el mismo de `relogin_cortes.ts`. Cerrado a
  -- propósito: la pantalla enseña un texto distinto por clase, y una clase
  -- inventada se pintaría como un hueco.
  constraint portal_relogin_clase_dominio
    check (ultima_clase is null or ultima_clase in (
      'captcha', 'segundo_factor', 'pregunta_seguridad', 'cambio_contrasena',
      'cuenta_bloqueada', 'credencial_invalida',
      'sin_campos', 'portal_no_contesto', 'reconectado'
    )),

  constraint portal_relogin_motivo_acotado
    check (ultimo_motivo is null or char_length(ultimo_motivo) <= 400),

  -- NI UNA COOKIE NI UN VOLCADO. Mismo CHECK que `portal_estado_motivo_sin_json`
  -- (0232): el motivo es una frase para una persona, y esta columna la lee el
  -- panel en claro. Un valor que empiece por { o [ sería otra cosa.
  constraint portal_relogin_motivo_sin_json
    check (ultimo_motivo is null or ultimo_motivo !~ '^\s*[\{\[]')
);

comment on table public.portal_relogin is
  'El permiso de una flota para que Likida guarde su contraseña de un portal y vuelva a entrar sola cuando la sesión caduque (0233), más el candado antibloqueo y la bitácora del último intento. NI UNA CONTRASEÑA AQUÍ: la contraseña vive cifrada en conector_credencial y la sesión en su fila #sesion. Sin fila, o con permitido=false, el comportamiento es el de siempre — la sesión caduca y entra una persona.';
comment on column public.portal_relogin.permitido is
  'La casilla «guardar mi contraseña para reconectar sola», por flota y por portal. false (o sin fila) = comportamiento de siempre: caducada -> humano. Nunca se enciende sola ni por una palanca global: la autoriza una persona de la flota y queda firmada.';
comment on column public.portal_relogin.permitido_por is
  'Quién autorizó, por correo. El CHECK portal_relogin_permiso_firmado impide que permitido=true entre sin autor y sin fecha: un consentimiento sin firma no es auditable, y este es el dato que hay que poder enseñar un año después.';
comment on column public.portal_relogin.bloqueado is
  'El candado innegociable. true = el re-login de este portal está DETENIDO hasta que una persona intervenga. Lo enciende un solo caso: el portal contestó que la credencial no sirve. Reintentar con una contraseña mala es lo que hace que el portal bloquee la cuenta del cliente.';
comment on column public.portal_relogin.intentos_dia is
  'Re-logins automáticos gastados en dia_de_intentos (tope 3, en TypeScript). Se anota ANTES de intentar: si la corrida muere a media sesión el intento ya está contado, que es lo contrario de un bucle que gasta los intentos de la cuenta.';
comment on column public.portal_relogin.ultimo_exito_en is
  'Cuándo reconectó sola por última vez. Es la frase citable de la pantalla ("reconecté sola el 9 de agosto a las 15:04").';
comment on column public.portal_relogin.ultima_clase is
  'El corte exacto, del catálogo cerrado que comparte con relogin_cortes.ts: captcha, segundo_factor, pregunta_seguridad, cambio_contrasena, cuenta_bloqueada, credencial_invalida (los cinco muros + el rechazo), o sin_campos/portal_no_contesto/reconectado.';
comment on constraint portal_relogin_motivo_sin_json on public.portal_relogin is
  'Ninguna cookie ni contraseña en claro. El motivo es una frase para una persona; un valor que empiece por { o [ sería un storageState o un volcado.';

-- No se agrega índice: el panel lee por tenant y el cron por (tenant, comercio),
-- y `portal_relogin_unico` ya cubre las dos. Un índice de más es una escritura
-- de más en cada corrida.

-- Mismo doble candado que 0196/0198/0207/0215/0229/0232: RLS deny-all + solo
-- service_role. La pantalla lo lee desde un server component con
-- `supabaseAdmin()`; ninguna sesión de navegador toca esta tabla.
alter table public.portal_relogin enable row level security;
revoke all on table public.portal_relogin from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_relogin to service_role;
