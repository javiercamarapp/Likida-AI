-- ═══════════════════════════════════════════════════════════════════════════
-- 0271 — El servidor MCP deja de confiar en la identidad congelada del token
-- sin que la base la pueda desmentir.
-- Auditoría 21 (modelo de datos), ALTO + MEDIO.
--
-- ── EL ALTO ──────────────────────────────────────────────────────────────
--
-- `mcp_oauth_codigo.user_id`/`mcp_oauth_token.user_id` llevan una FK simple a
-- `app_user(id)`, y `tenant_id` una FK simple e INDEPENDIENTE a `tenant(id)`
-- — nada las ata entre sí. Un INSERT con el usuario de la flota A y el
-- `tenant_id` de la flota B pasa las dos FK (el usuario existe, la flota
-- existe) aunque el trío nunca haya sido cierto. `validarAcceso`
-- (src/lib/mcp/oauth.ts), el camino caliente de CADA llamada MCP, lee
-- `tenant_id`/`rol` DIRECTO de la fila del token y los entrega tal cual a
-- `despacharHerramienta` — sin volver a consultar `app_user`. La única
-- revalidación que existía (`mcp_oauth_usuario_vigente`, 0265) solo corre en
-- `refrescarTokens` al ROTAR, nunca en `validarAcceso`.
--
-- POR QUÉ `app_user` NO ESTÁ EN EL PATRÓN 0028/0145. La técnica correcta para
-- esto ya existe en el repo — la FK compuesta `(col, tenant_id) →
-- tabla(id, tenant_id)` — pero el bloque 112 de `verificaciones.sql` la
-- excluye por diseño de cualquier destino con `tenant_id` NULLABLE, y
-- `app_user.tenant_id` lo es (`0001_init.sql`: "null = superadmin"; la 0105
-- sumó `vendedor`, con el mismo `tenant_id` nulo por ser "rol de LIKIDA"). Una
-- FK compuesta MATCH SIMPLE contra un destino con la columna nula no
-- comprobaría nada para esa fila — por ESO el barrido automático se abstiene
-- de proponerla ahí, no porque el problema no aplique.
--
-- Pero aquí el destino real nunca es un superadmin ni un vendedor:
-- `/mcp/autorizar` (page.tsx) ya rechaza al superadmin explícitamente y exige
-- `sesion.tenantId` no nulo antes de emitir un código — en la práctica, un
-- token MCP SOLO nace para `flota_admin`, `contador` o `encargado`, los tres
-- roles cuyo `app_user.tenant_id` es NOT NULL en los datos reales. Así que la
-- FK compuesta sí puede escribirse aquí, apuntando a las columnas exactas que
-- SÍ importan — con el efecto colateral correcto de que un superadmin o un
-- vendedor (tenant_id NULL en su fila) NUNCA puede satisfacer la comparación
-- contra un `mcp_oauth_token.tenant_id` que es NOT NULL: la base refuerza el
-- mismo candado que ya pone `page.tsx`, no uno nuevo.
--
-- LA FORMA: `unique (id, tenant_id, rol)` en `app_user` (id ya es PK, así que
-- esto no relaja nada — es, como en 0028, el precio de poder apuntarle desde
-- una FK compuesta) y `(user_id, tenant_id, rol) references
-- app_user(id, tenant_id, rol)` en las dos tablas de la 0260. `on delete
-- cascade` iguala lo que la FK simple de `user_id` ya hacía. SIN `on update
-- cascade` a propósito: hoy no existe ningún flujo que cambie
-- `app_user.tenant_id`/`rol` de una fila con tokens MCP vivos (0265 ya lo
-- documentó: "no hay flujo de admin que dé de baja o cambie el rol"), y con
-- esta FK ese UPDATE directo empieza a RECHAZARSE mientras existan tokens que
-- referencien el trío viejo — fallar cerrado, no arrastrar la identidad
-- vieja en silencio. El día que ese flujo exista, tiene que llamar
-- `revocar_mcp_oauth_usuario` (0265) ANTES de tocar `app_user`, y esta FK es
-- la que se encarga de que nadie se salte ese orden sin que la base proteste.
--
-- QUÉ SIGUE SIN ARREGLAR SOLO CON LA FK: la FK impide que un trío INVÁLIDO se
-- ESCRIBA (al emitir el código, al canjearlo, al rotar el refresco) y que un
-- trío VÁLIDO se vuelva inválido por un UPDATE directo a `app_user` mientras
-- el token vive — pero un bug futuro en la resolución de sesión seguiría
-- pudiendo pedir el trío EQUIVOCADO-PERO-VÁLIDO-EN-OTRA-PARTE (un contador
-- real de la flota B, con tenant_id de la flota B, pasado por error al pedir
-- el código de un usuario de la flota A) sin que la FK lo vea — la FK valida
-- que el trío exista en `app_user`, no que sea EL trío de quien de verdad
-- está autorizando. Por eso `validarAcceso` (src/lib/mcp/oauth.ts) se cambia
-- aparte, en el mismo commit, para revalidar contra `app_user` en cada
-- llamada — ver ese archivo para la decisión de por qué es una revalidación
-- LIGERA (un embed anclado a `user_id` en la MISMA consulta, no una llamada
-- RPC extra) y no la `mcp_oauth_usuario_vigente()` completa de la 0265.
--
-- ── EL MEDIO ─────────────────────────────────────────────────────────────
--
-- `mcp_oauth_codigo.rol`/`mcp_oauth_token.rol` son `text not null` SIN CHECK
-- de dominio, a diferencia de `app_user.rol` (`app_user_rol_dominio`, 0044/
-- 0086/0105). El dominio que se abre aquí NO es una copia del de `app_user`
-- (`superadmin, flota_admin, contador, encargado, vendedor`): es el dominio
-- MÁS ESTRECHO de los roles que de verdad pueden consentir un acceso MCP —
-- `flota_admin`, `contador`, `encargado` — porque `/mcp/autorizar` ya
-- rechaza a `superadmin` explícitamente y a `vendedor` de forma indirecta
-- (exige `tenantId` no nulo, y `vendedor` lo tiene NULL — `src/lib/auth/
-- visibilidad.ts` tampoco le da ninguna `Area`). Copiar el dominio completo
-- de `app_user` habría aceptado dos roles que este flujo nunca produce; este
-- CHECK es más estricto porque el problema es más estrecho. Con la FK
-- compuesta de arriba, un rol fuera de este dominio YA rebotaría también por
-- `foreign_key_violation` (ningún `app_user` tiene ese rol) — el CHECK es una
-- segunda capa más barata y con un mensaje más claro (`check_violation`
-- inmediato, antes de que la FK ni se evalúe), igual que la 0025/0044 le
-- dieron su propio CHECK a `app_user.rol` en vez de dejarlo solo a mano de
-- quien inserta.
--
-- ── Idempotencia y reversibilidad ────────────────────────────────────────
-- Cada `alter table` va detrás de un `if not exists` contra `pg_constraint`
-- (patrón de 0028): re-aplicar esta migración no falla ni duplica nada.
-- Reversible: `alter table <t> drop constraint <nombre>;` por cada una de las
-- cinco (la unique de `app_user` y las cuatro de las dos tablas de la 0260).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El destino: app_user necesita el trío como unique para poder ────────
-- recibir una FK compuesta de tres columnas.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_user_id_tenant_rol_key' and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user
      add constraint app_user_id_tenant_rol_key unique (id, tenant_id, rol);
  end if;
end $$;

comment on constraint app_user_id_tenant_rol_key on public.app_user is
  'Precondición de la FK compuesta de mcp_oauth_codigo/mcp_oauth_token (0271): id ya es PK, así que esto no relaja unicidad, es el precio de poder apuntarle desde (user_id, tenant_id, rol).';

-- ── 2. El dominio de rol (MEDIO): más estrecho que app_user_rol_dominio a ──
-- propósito — son los tres roles que /mcp/autorizar de verdad deja consentir.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mcp_oauth_codigo_rol_dominio' and conrelid = 'public.mcp_oauth_codigo'::regclass
  ) then
    alter table public.mcp_oauth_codigo
      add constraint mcp_oauth_codigo_rol_dominio check (rol in ('flota_admin', 'contador', 'encargado'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mcp_oauth_token_rol_dominio' and conrelid = 'public.mcp_oauth_token'::regclass
  ) then
    alter table public.mcp_oauth_token
      add constraint mcp_oauth_token_rol_dominio check (rol in ('flota_admin', 'contador', 'encargado'));
  end if;
end $$;

comment on constraint mcp_oauth_codigo_rol_dominio on public.mcp_oauth_codigo is
  'MEDIO auditoría 21 (modelo de datos): dominio cerrado, MÁS ESTRECHO que app_user_rol_dominio — solo los tres roles que /mcp/autorizar deja consentir (superadmin y vendedor quedan fuera por diseño de ese flujo, no por copia del dominio general).';
comment on constraint mcp_oauth_token_rol_dominio on public.mcp_oauth_token is
  'MEDIO auditoría 21 (modelo de datos): mismo dominio y misma razón que mcp_oauth_codigo_rol_dominio.';

-- ── 3. El ALTO: la FK compuesta que ata (user_id, tenant_id, rol) a una fila ─
-- REAL y VIGENTE de app_user, en las dos tablas de la 0260.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mcp_oauth_codigo_usuario_tenant_rol_fkey' and conrelid = 'public.mcp_oauth_codigo'::regclass
  ) then
    alter table public.mcp_oauth_codigo
      add constraint mcp_oauth_codigo_usuario_tenant_rol_fkey
      foreign key (user_id, tenant_id, rol) references public.app_user (id, tenant_id, rol) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mcp_oauth_token_usuario_tenant_rol_fkey' and conrelid = 'public.mcp_oauth_token'::regclass
  ) then
    alter table public.mcp_oauth_token
      add constraint mcp_oauth_token_usuario_tenant_rol_fkey
      foreign key (user_id, tenant_id, rol) references public.app_user (id, tenant_id, rol) on delete cascade;
  end if;
end $$;

comment on constraint mcp_oauth_codigo_usuario_tenant_rol_fkey on public.mcp_oauth_codigo is
  'ALTO auditoría 21 (modelo de datos): (user_id, tenant_id, rol) tiene que ser una fila REAL de app_user en el instante del INSERT — antes, tenant_id y user_id solo llevaban FK simples e independientes, así que un usuario de la flota A con el tenant_id de la flota B pasaba las dos. on delete cascade iguala la FK simple de user_id que ya existía. Sin on update cascade: si algún día se construye un flujo que cambie tenant_id/rol de app_user con tokens MCP vivos, esa fila tiene que revocarse primero (revocar_mcp_oauth_usuario, 0265) — el UPDATE directo ahora rebota mientras existan tokens que referencien el trío viejo.';
comment on constraint mcp_oauth_token_usuario_tenant_rol_fkey on public.mcp_oauth_token is
  'ALTO auditoría 21 (modelo de datos): misma FK y misma razón que mcp_oauth_codigo_usuario_tenant_rol_fkey — es el camino caliente de validarAcceso el que más la necesita, aunque la FK solo protege la ESCRITURA (emisión/canje/rotación); la revalidación en cada LECTURA vive en src/lib/mcp/oauth.ts (validarAcceso), no en la base.';
