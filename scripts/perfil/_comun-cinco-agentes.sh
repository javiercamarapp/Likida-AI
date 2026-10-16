#!/usr/bin/env bash
# Funciones compartidas por aplicar / revertir / verificar `cinco_agentes`. Se hace `source`; no se ejecuta solo.
# Nunca imprime DATABASE_URL (lleva la contraseña): solo el host, y la ruta del archivo de entorno si se usó.

perfil_uso_error() { echo "$1" >&2; exit 2; }

# Lee DATABASE_URL de un archivo de entorno SIN ejecutarlo (ni imprimirlo). Acepta `DATABASE_URL=...` o `export DATABASE_URL=...`.
perfil_cargar_env_file() {
  local ruta="$1" linea
  [ -f "$ruta" ] || perfil_uso_error "❌ No existe el archivo de entorno: $ruta"
  linea="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$ruta" | tail -1 || true)"
  [ -n "$linea" ] || perfil_uso_error "❌ $ruta no define DATABASE_URL."
  linea="${linea#*DATABASE_URL=}"
  linea="${linea%\"}"; linea="${linea#\"}"; linea="${linea%\'}"; linea="${linea#\'}"
  DATABASE_URL="$linea"
}

perfil_validar_uuid() {
  printf '%s' "$1" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' \
    || perfil_uso_error "❌ '$1' no es un UUID."
}

perfil_requerir_db() {
  DB="${DATABASE_URL:-}"
  [ -n "$DB" ] || perfil_uso_error "❌ Falta DATABASE_URL (o --env-file <ruta>)."
  command -v psql >/dev/null 2>&1 || perfil_uso_error "❌ Falta psql."
  perfil_rechazar_url_ambigua   # antes de leer el host: cubre aplicar, revertir y verificar (también en solo lectura)
}

# Host de la URL (sin usuario ni contraseña): postgres://u:p@HOST:5432/db -> HOST
perfil_host() {
  local h="${DB#*://}"
  h="${h#*@}"; h="${h%%/*}"; h="${h%%\?*}"
  case "$h" in \[*\]*) h="${h%%\]*}"; h="${h#\[}" ;; *) h="${h%%:*}" ;; esac
  printf '%s' "$h"
}

# Rehúsa (exit 4) toda URL cuyo host real pueda diferir del que lee perfil_host: libpq deja que host=, hostaddr= y service=
# en la query manden sobre el authority, y que el authority lleve varios hosts separados por coma. Solo se acepta
# postgres:// o postgresql:// (una cadena `clave=valor` tampoco se interpreta aquí).
perfil_rechazar_url_ambigua() {
  local sin_esquema authority resto query decodificada
  case "$DB" in postgres://*|postgresql://*) ;; *)
    echo "❌ DATABASE_URL debe ser una URL postgres:// o postgresql:// (otras formas pueden esconder el host real)." >&2; exit 4 ;;
  esac
  sin_esquema="${DB#*://}"
  authority="${sin_esquema%%[/?]*}"
  case "$authority" in *,*)
    echo "❌ La URL lista varios hosts; se rechaza porque el host real puede no ser el local." >&2; exit 4 ;;
  esac
  case "$sin_esquema" in *\?*) query="${sin_esquema#*\?}" ;; *) query="" ;; esac
  if [ -n "$query" ]; then
    decodificada="$(printf '%b' "$(printf '%s' "$query" | sed 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$decodificada" | grep -Eq '(^|&)[[:space:]]*(host|hostaddr|service)[[:space:]]*='; then
      echo "❌ La URL trae host=, hostaddr= o service= en la query: libpq se conectaría a un host distinto del que se valida. Quítalo." >&2
      exit 4
    fi
  fi
  resto="${authority#*@}"
  case "$resto" in *@*) echo "❌ La URL tiene más de un '@' en el authority; ambigua." >&2; exit 4 ;; esac
}

# Rehúsa host no local salvo --produccion Y confirmación interactiva (escribir el UUID de la flota).
# $1 = 0|1 (se pasó --produccion), $2 = UUID, $3 = acción para el mensaje.
perfil_guardia_host() {
  local produccion="$1" tenant="$2" accion="$3" host respuesta
  host="$(perfil_host)"
  case "$host" in
    127.0.0.1|localhost|::1) echo "Base LOCAL ($host): $accion sin confirmación extra."; return 0 ;;
  esac
  if [ "$produccion" != "1" ]; then
    echo "❌ El host '$host' no es local. Este script rehúsa $accion contra una base remota sin --produccion." >&2
    exit 4
  fi
  if [ ! -t 0 ]; then
    echo "❌ Base remota ('$host') con --produccion: se exige confirmación interactiva y no hay terminal." >&2
    exit 4
  fi
  echo "⚠️  Vas a $accion en la base REMOTA '$host' para la flota $tenant." >&2
  printf 'Para confirmar, escribe el UUID de la flota: ' >&2
  read -r respuesta
  if [ "$respuesta" != "$tenant" ]; then echo "❌ Confirmación distinta. No se hizo nada." >&2; exit 4; fi
}

# Escribe el estado previo (tenant_perfil + interruptor_tenant de ESA flota) en ~/likida-respaldos/perfil/<fecha>-<tenant8>.json
# y deja la ruta en $RESPALDO. Se hace ANTES de cambiar nada; si falla, el script aborta.
perfil_respaldar() {
  local tenant="$1" dir="$HOME/likida-respaldos/perfil" fecha
  fecha="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"; chmod 700 "$dir"
  RESPALDO="$dir/${fecha}-${tenant%%-*}.json"
  psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$tenant" -tA > "$RESPALDO" <<'SQL'
select json_build_object(
  'tenant_id', :'tenant'::text,
  'respaldado_en', now(),
  'tenant_perfil', (select coalesce(json_agg(t order by t.tenant_id), '[]'::json) from public.tenant_perfil t where t.tenant_id = :'tenant'::uuid),
  'interruptor_tenant', (select coalesce(json_agg(i order by i.pipeline), '[]'::json) from public.interruptor_tenant i where i.tenant_id = :'tenant'::uuid),
  -- Puede faltar (migración 0785 sin aplicar): to_regclass la trata como «sin tabla», nunca como error.
  'liquidacion_correo_config', (case when to_regclass('public.liquidacion_correo_config') is null then null
    else (select coalesce(json_agg(c), '[]'::json) from public.liquidacion_correo_config c where c.tenant_id = :'tenant'::uuid) end)
);
SQL
  chmod 600 "$RESPALDO"
  [ -s "$RESPALDO" ] || { echo "❌ El respaldo quedó vacío: $RESPALDO. No se cambia nada." >&2; exit 5; }
  echo "Respaldo del estado previo: $RESPALDO"
}

# Huella del estado de la flota (para comparar antes/después): md5 de tenant_perfil + interruptor_tenant, sin el instante.
perfil_huella() {
  psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$1" -tA <<'SQL'
select md5(
  coalesce((select string_agg(perfil, ',' order by tenant_id) from public.tenant_perfil where tenant_id = :'tenant'::uuid), '')
  || '|' ||
  coalesce((select string_agg(pipeline || ':' || apagado::text || ':' || coalesce(motivo, ''), ',' order by pipeline)
              from public.interruptor_tenant where tenant_id = :'tenant'::uuid), '')
  || '|' ||
  -- Puede faltar (migración 0785 sin aplicar): to_regclass la trata como «sin tabla» (cadena fija), nunca como error.
  (case when to_regclass('public.liquidacion_correo_config') is null then 'sin-0785'
    else coalesce((select string_agg(canal || ':' || activa::text, ',' order by tenant_id)
                     from public.liquidacion_correo_config where tenant_id = :'tenant'::uuid), '') end)
);
SQL
}
