-- ═══════════════════════════════════════════════════════════════════════════
-- 0852 — Reuso de foto de evidencia ENTRE VIAJES, a nivel de FLOTA.
--
-- HALLAZGO ALTO CONFIRMADO (auditoría A5 Conductor). La evidencia fotográfica
-- de un hito se clasifica ÚNICAMENTE por el texto exacto del pie de foto
-- (`src/lib/likida/conductor/evidencia.ts:21-39`,
-- `documentos_cierre.ts:113-118`); no hay analizador de imagen real en
-- Fase 1. El candado anti-duplicado es por HITO Y CICLO, NO a nivel tenant:
-- `viaje_hito_evidencia_unica unique (viaje_hito_id, ciclo, sha256)` (0385:207).
-- La MISMA foto (mismo sha256) de un sello/recibido de un viaje anterior se
-- puede reenviar como evidencia "nueva" de OTRO viaje/hito sin que ningún
-- candado lo detecte, con solo poner el caption correcto.
--
-- QUÉ HACE ESTA MIGRACIÓN. NO bloquea el registro — un falso positivo
-- legítimo (la misma rampa, el mismo sello físico que el cliente reusa entre
-- viajes) es raro pero posible, y bloquear de más rompería un flujo real del
-- chofer sin que nadie lo revisara. En vez de eso, MARCA: cuando se inserta
-- una evidencia cuyo sha256 ya apareció en la MISMA flota (otra combinación
-- de hito+ciclo — la generalización "a nivel tenant" que pide el hallazgo,
-- no solo "a nivel viaje") dentro de los últimos `v_dias` días,
-- `reuso_tenant_evidencia_id` queda apuntando a la evidencia MÁS ANTIGUA con
-- ese match. Visible en el tablero (`tablero.ts`/`tablero-hitos.tsx`) para
-- que un humano la revise.
--
-- POR QUÉ UN TRIGGER Y NO CÓDIGO EN CADA CAMINO DE ESCRITURA. Hay TRES
-- funciones en `repo_validacion.ts` que insertan en `viaje_hito_evidencia`
-- (`guardarEvidencia`, `guardarEvidenciaDocumentoCierre`,
-- `guardarEvidenciaDocumentoCierreSinCategoria`). Un trigger BEFORE INSERT lo
-- calcula UNA sola vez, para las tres, y para cualquier camino nuevo que se
-- agregue después — la misma razón por la que el candado de hito+ciclo ya es
-- un constraint de la base y no una comprobación repetida en TypeScript.
--
-- POR QUÉ NO SE FILTRA POR `ruta is not null`: una evidencia ya purgada por
-- retención (ruta = null) SIGUE siendo prueba de que ese sha256 ya se usó
-- antes — la huella (sha256) sobrevive a la purga del archivo a propósito
-- (0385: "la ruta y SU HUELLA").
--
-- VENTANA DE 180 DÍAS: para no escanear histórico infinito en cada INSERT
-- (el índice de abajo lo hace barato, pero una ventana acotada es la defensa
-- de fondo si la tabla crece mucho). Reversible:
--   drop trigger conductor_detectar_evidencia_reuso_tenant on public.viaje_hito_evidencia;
--   drop function public.conductor_detectar_evidencia_reuso_tenant();
--   alter table public.viaje_hito_evidencia drop column reuso_tenant_evidencia_id;
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.viaje_hito_evidencia
  add column if not exists reuso_tenant_evidencia_id uuid;

-- La FK de abajo es COMPUESTA con tenant_id a propósito (nunca (id) a secas): un `id` de evidencia es único
-- globalmente, así que una FK de una sola columna NO impediría que una fila de la flota A apuntara al `id` de
-- una evidencia de la flota B — exactamente el hueco que `FKS_CON_TENANT_0145` (supabase/verificaciones.sql)
-- vigila para toda FK de una tabla con tenant. Postgres exige un UNIQUE/PK exacto sobre las columnas
-- referenciadas: (id) ya es PK, pero (id, tenant_id) necesita su propio UNIQUE (mismo patrón que
-- `viaje_hito_id_tenant_key`, 0380).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'viaje_hito_evidencia_id_tenant_key' and conrelid = 'public.viaje_hito_evidencia'::regclass
  ) then
    alter table public.viaje_hito_evidencia add constraint viaje_hito_evidencia_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'viaje_hito_evidencia_reuso_fkey' and conrelid = 'public.viaje_hito_evidencia'::regclass
  ) then
    -- `on delete set null (reuso_tenant_evidencia_id)` (sintaxis de columna, PG15+) para que al borrarse la
    -- evidencia referida solo se limpie ESTA columna — un `set null` sin lista intentaría poner `tenant_id`
    -- en NULL también (es parte de la FK compuesta) y chocaría con su NOT NULL.
    alter table public.viaje_hito_evidencia add constraint viaje_hito_evidencia_reuso_fkey
      foreign key (reuso_tenant_evidencia_id, tenant_id) references public.viaje_hito_evidencia (id, tenant_id)
      on delete set null (reuso_tenant_evidencia_id);
  end if;
end $$;

comment on column public.viaje_hito_evidencia.reuso_tenant_evidencia_id is
  '0852: si NO es NULL, esta foto (mismo sha256) ya se había usado como evidencia de la MISMA flota en otra combinación de hito+ciclo (típicamente, de OTRO viaje) dentro de la ventana de reuso — apunta a la evidencia MÁS ANTIGUA con ese match. No bloquea el registro: solo lo marca para revisión humana (tablero).';

-- Acelera la búsqueda del trigger: por flota + huella, de la más reciente a la más vieja.
create index if not exists viaje_hito_evidencia_sha_tenant_idx
  on public.viaje_hito_evidencia (tenant_id, sha256, created_at desc);

create or replace function public.conductor_detectar_evidencia_reuso_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Ventana para no escanear histórico infinito (ver cabecera de la 0852).
  v_dias constant integer := 180;
  v_match uuid;
begin
  select id into v_match
    from public.viaje_hito_evidencia
   where tenant_id = new.tenant_id
     and sha256 = new.sha256
     -- La MISMA (hito, ciclo) ya la bloquea viaje_hito_evidencia_unica (0385) como
     -- 23505 antes de que el INSERT llegue a comprometerse; excluirla aquí evita
     -- marcar como "reuso" lo que en realidad es el candado existente rechazando
     -- el duplicado exacto.
     and not (viaje_hito_id = new.viaje_hito_id and ciclo = new.ciclo)
     and created_at >= now() - make_interval(days => v_dias)
   order by created_at asc
   limit 1;
  new.reuso_tenant_evidencia_id := v_match;
  return new;
end $$;
revoke all on function public.conductor_detectar_evidencia_reuso_tenant() from public, anon, authenticated;

drop trigger if exists conductor_detectar_evidencia_reuso_tenant on public.viaje_hito_evidencia;
create trigger conductor_detectar_evidencia_reuso_tenant
  before insert on public.viaje_hito_evidencia
  for each row execute function public.conductor_detectar_evidencia_reuso_tenant();

comment on trigger conductor_detectar_evidencia_reuso_tenant on public.viaje_hito_evidencia is
  '0852: antes de insertar, busca si el MISMO sha256 ya se usó en la MISMA flota en otra combinación de hito+ciclo (≤180 días) y deja la marca en reuso_tenant_evidencia_id. No bloquea.';
