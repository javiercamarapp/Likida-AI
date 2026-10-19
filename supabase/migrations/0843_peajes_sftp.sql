-- 0843 — Conciliación de peajes (Agente 2): el CUARTO canal de entrada, SFTP.
--
-- `docs/operacion/conciliacion-peajes.md` listaba el SFTP como bloqueo #6: «no
-- construido, requiere una librería SFTP (hoy no hay ninguna en el repo)». Esa
-- librería YA ESTABA: `ssh2`, instalada para el modo `csv_sftp` de la «tabla
-- propia» del cliente (0500-algo; `src/lib/likida/conectores/tabla_propia/
-- sftp.ts`), que lee UN archivo de texto (CSV de posiciones/geocercas/cursos)
-- con huella de host OBLIGATORIA y SSRF-safe (el host se re-resuelve y se
-- descarta si cualquier dirección es interna, EN CADA conexión, no solo al
-- guardar). Ese cliente ahora tiene una segunda envoltura (`crearClienteSftpBinario`,
-- mismo archivo) que devuelve los bytes SIN decodificar a texto — la decodificación
-- a UTF-8 de `crearClienteSftp` perdería el Excel/PDF del corte de peajes. La
-- huella de host, el SSRF y la clasificación de errores viven en un solo lugar
-- compartido (`leerBytesSftp`, privada del módulo); nada se duplicó.
--
-- EL CANAL (`peajes/ingesta_sftp.ts`, mismo molde que `peajes/pull.ts` — Likida
-- consulta, la flota publica, igual de independiente de los otros tres):
--   · La flota da host, puerto, usuario, credencial (contraseña O llave
--     privada+frase) y RUTA de un archivo fijo en su servidor — el proveedor
--     sobrescribe ese archivo cada corte decenal. La huella SHA256 del HOST es
--     obligatoria, igual que en `tabla_propia` (sin «confiar en el primer
--     contacto»).
--   · La credencial (clave y/o llave+frase) va UN SOLO blob cifrado con el
--     cofre de la app (`conectores/cofre.ts`, AES-256-GCM): igual que
--     `pull_credencial_cifrada` de la 0563, nunca en claro.
--   · El cron la consulta cada `sftp_intervalo_min` con el MISMO claim-con-lease
--     que el pull (`peaje_sftp_reclamar`, FOR UPDATE SKIP LOCKED): dos corridas
--     no leen la misma flota a la vez.
--   · Lo que descarga entra a la MISMA cola que los otros tres canales
--     (`peaje_ingesta_archivo`, origen `sftp`) y lo procesa el MISMO importador
--     — la huella sha256 del CONTENIDO vuelve inocuo que el archivo no haya
--     cambiado entre dos corridas (el mismo corte dos veces es la misma fila).
--
-- Los CUATRO canales son INDEPENDIENTES (activar uno no enciende ni enseña la
-- credencial de otro), como ya dejó dicho la 0563 para los tres de entonces.
alter table public.peaje_ingesta_archivo drop constraint if exists peaje_ingesta_archivo_origen_dominio;
alter table public.peaje_ingesta_archivo
  add constraint peaje_ingesta_archivo_origen_dominio check (origen in ('api', 'panel', 'correo', 'pull', 'sftp'));

alter table public.peaje_ingesta_config
  add column if not exists sftp_host               text,
  add column if not exists sftp_puerto              int not null default 22,
  add column if not exists sftp_usuario             text,
  add column if not exists sftp_ruta                text,
  add column if not exists sftp_huellas             text[] not null default '{}',
  add column if not exists sftp_credencial_cifrada  text,
  add column if not exists sftp_activo              boolean not null default false,
  add column if not exists sftp_intervalo_min       int not null default 60,
  add column if not exists sftp_proximo_en          timestamptz not null default now(),
  add column if not exists sftp_ultimo_en           timestamptz,
  add column if not exists sftp_ultimo_error        text;

alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_host_forma;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_host_forma check (sftp_host is null or (sftp_host ~ '^[A-Za-z0-9.:_-]{1,253}$' and char_length(sftp_host) <= 253));
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_puerto_sano;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_puerto_sano check (sftp_puerto between 1 and 65535);
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_ruta_forma;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_ruta_forma check (sftp_ruta is null or (char_length(sftp_ruta) between 1 and 1024 and sftp_ruta !~ '[[:cntrl:]]' and sftp_ruta !~ '/$'));
-- Hasta 5 huellas «SHA256:<43 base64url sin relleno>», igual que `huella_host` de tabla_propia (HUELLA_SHA256 en sftp.ts).
-- Un CHECK no admite subconsultas (ni `unnest` dentro de un `exists`): se valida uniendo el arreglo con comas y
-- aplicando UN regex que exige la forma en cada elemento Y limita a lo más 5 (1 + hasta 4 repeticiones).
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_huellas_forma;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_huellas_forma check (
    cardinality(sftp_huellas) = 0
    or array_to_string(sftp_huellas, ',') ~ '^SHA256:[A-Za-z0-9+/]{43}(,SHA256:[A-Za-z0-9+/]{43}){0,4}$'
  );
-- La credencial va CIFRADA por el cofre (`v1.<iv>.<tag>.<cifrado>`), igual que `pull_credencial_cifrada` (0563).
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_credencial_cifrada;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_credencial_cifrada check (sftp_credencial_cifrada is null or sftp_credencial_cifrada ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_intervalo;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_intervalo check (sftp_intervalo_min between 15 and 1440);
-- Activo exige TODO lo necesario para conectar: host, usuario, ruta, al menos una huella y una credencial guardada.
alter table public.peaje_ingesta_config drop constraint if exists peaje_ingesta_config_sftp_coherente;
alter table public.peaje_ingesta_config
  add constraint peaje_ingesta_config_sftp_coherente check (
    not sftp_activo or (
      sftp_host is not null and sftp_usuario is not null and sftp_ruta is not null
      and cardinality(sftp_huellas) > 0 and sftp_credencial_cifrada is not null
    )
  );

create index if not exists peaje_ingesta_config_sftp_trabajo_idx
  on public.peaje_ingesta_config (sftp_proximo_en) where sftp_activo;

comment on column public.peaje_ingesta_config.sftp_credencial_cifrada is
  '0843: contraseña y/o llave privada+frase del SFTP de la flota, UN SOLO blob JSON cifrado con el cofre (AES-256-GCM, LIKIDA_COFRE_LLAVE). Nunca en claro.';
comment on column public.peaje_ingesta_config.sftp_huellas is
  '0843: huellas SHA256 del host aceptadas (hasta 5, para rotar la llave del servidor sin cortar la lectura) — mismo formato que huella_host de tabla_propia. Sin huella no se guarda activo: no hay «confiar en el primer contacto».';

-- El claim del SFTP: MISMO molde que `peaje_pull_reclamar` (0563) — toma hasta
-- p_limite flotas cuyo turno ya llegó y les pone un lease (sftp_proximo_en =
-- ahora + p_lease_segundos) para que otra corrida no las consulte a la vez.
create or replace function public.peaje_sftp_reclamar(p_limite int default 5, p_lease_segundos int default 600)
returns table (
  tenant_id uuid, sftp_host text, sftp_puerto int, sftp_usuario text, sftp_ruta text,
  sftp_huellas text[], sftp_credencial_cifrada text, sftp_ultimo_en timestamptz, sftp_intervalo_min int
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'peaje_sftp_reclamar: p_limite fuera de rango (1-50)';
  end if;
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 3600 then
    raise exception 'peaje_sftp_reclamar: p_lease_segundos fuera de rango (30-3600)';
  end if;
  return query
  with elegibles as (
    select c.tenant_id
      from public.peaje_ingesta_config c
     where c.sftp_activo and c.sftp_host is not null and c.sftp_proximo_en <= now()
     order by c.sftp_proximo_en, c.tenant_id
     limit p_limite
       for update skip locked
  )
  update public.peaje_ingesta_config c
     set sftp_proximo_en = now() + make_interval(secs => p_lease_segundos)
    from elegibles e
   where c.tenant_id = e.tenant_id
  returning c.tenant_id, c.sftp_host, c.sftp_puerto, c.sftp_usuario, c.sftp_ruta, c.sftp_huellas, c.sftp_credencial_cifrada, c.sftp_ultimo_en, c.sftp_intervalo_min;
end;
$$;
comment on function public.peaje_sftp_reclamar(int, int) is
  '0843: claim del canal SFTP de peajes: toma flotas con sftp activo y turno vencido, FOR UPDATE SKIP LOCKED, y les pone un lease. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_sftp_reclamar(int, int) from public, anon, authenticated;
grant execute on function public.peaje_sftp_reclamar(int, int) to service_role;
