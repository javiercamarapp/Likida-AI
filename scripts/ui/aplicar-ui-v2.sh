#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Enciende / apaga el rediseño (UI v2) para UNA flota: fila de `tenant_ui` (migración 0939 o la que la sustituya).
#
#   DATABASE_URL="postgres://..." scripts/ui/aplicar-ui-v2.sh [--produccion] <UUID>              # v2 para la flota
#   DATABASE_URL="postgres://..." scripts/ui/aplicar-ui-v2.sh --revertir [--produccion] <UUID>   # borra la fila (= v1)
#   DATABASE_URL="postgres://..." scripts/ui/aplicar-ui-v2.sh --verificar <UUID>                 # solo lee
#   scripts/ui/aplicar-ui-v2.sh --env-file <ruta> ...                                            # DATABASE_URL desde archivo
#
# SEGURIDAD (la misma de scripts/perfil/): contra un host que no sea la pila local se NIEGA salvo --produccion más
# confirmación interactiva (escribir el UUID). Antes de cambiar nada escribe el estado previo en
# ~/likida-respaldos/ui/<fecha>-<tenant>.json y al final imprime el comando EXACTO de reversa. No imprime la URL.
# 0 builds: es un INSERT/UPDATE/DELETE; la app lo nota en <30 s (caché de 30 s). Este script NO se ejecuta solo.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
# shellcheck source=scripts/perfil/_comun-cinco-agentes.sh
. "$(dirname "$0")/../perfil/_comun-cinco-agentes.sh"

MODO=aplicar; PRODUCCION=0; ENV_FILE=""; TENANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --revertir) MODO=revertir ;;
    --verificar) MODO=verificar ;;
    --produccion) PRODUCCION=1 ;;
    --env-file) shift; ENV_FILE="${1:-}"; [ -n "$ENV_FILE" ] || perfil_uso_error "❌ --env-file pide una ruta." ;;
    -*) perfil_uso_error "❌ Opción desconocida: $1" ;;
    *) [ -z "$TENANT" ] || perfil_uso_error "❌ Sobra el argumento: $1"; TENANT="$1" ;;
  esac
  shift
done
[ -n "$TENANT" ] || perfil_uso_error "Uso: DATABASE_URL=... $0 [--revertir|--verificar] [--produccion] [--env-file RUTA] <UUID-del-tenant>"
perfil_validar_uuid "$TENANT"
if [ -n "$ENV_FILE" ]; then perfil_cargar_env_file "$ENV_FILE"; fi
perfil_requerir_db

# La tabla la crea la migración 0939: sin ella nada de lo siguiente tiene sentido (el respaldo saldría vacío y el error
# sería críptico). Solo lectura; se comprueba antes de respaldar o cambiar cualquier cosa.
exigir_tabla_tenant_ui() {
  local hay
  hay="$(psql "$DB" -X -v ON_ERROR_STOP=1 -tA -c "select to_regclass('public.tenant_ui') is not null" 2>/dev/null || true)"
  if [ "$hay" != "t" ]; then
    echo "❌ La tabla public.tenant_ui no existe en esta base (o no se pudo comprobar). Aplica primero la migración 0939 (supabase/migrations/0939_tenant_ui.sql). No se cambió nada." >&2
    exit 6
  fi
}

if [ "$MODO" = "verificar" ]; then
  exigir_tabla_tenant_ui
  psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
select 'tenant' as que, id::text as valor, nombre from public.tenant where id = :'tenant';
select 'ui' as que, version as valor, cambiado_en::text from public.tenant_ui where tenant_id = :'tenant';
SQL
  exit 0
fi

perfil_guardia_host "$PRODUCCION" "$TENANT" "$([ "$MODO" = revertir ] && echo 'REVERTIR UI v2' || echo 'ACTIVAR UI v2')"

exigir_tabla_tenant_ui

# Respaldo del estado previo ANTES de cambiar nada.
DIR="$HOME/likida-respaldos/ui"; mkdir -p "$DIR"; chmod 700 "$DIR"
RESPALDO="$DIR/$(date +%Y%m%d-%H%M%S)-${TENANT%%-*}.json"
psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA > "$RESPALDO" <<'SQL'
select json_build_object('tenant_id', :'tenant'::text, 'respaldado_en', now(),
  'tenant_ui', (select coalesce(json_agg(t), '[]'::json) from public.tenant_ui t where t.tenant_id = :'tenant'::uuid));
SQL
chmod 600 "$RESPALDO"
[ -s "$RESPALDO" ] || { echo "❌ El respaldo quedó vacío: $RESPALDO. No se cambia nada." >&2; exit 5; }
echo "Respaldo del estado previo: $RESPALDO"

if [ "$MODO" = "aplicar" ]; then
  EXISTE="$(psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA <<'SQL'
select count(*) from public.tenant where id = :'tenant'::uuid;
SQL
)"
  [ "$EXISTE" = "1" ] || { echo "❌ La flota $TENANT no existe en esta base." >&2; exit 3; }
  psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
begin;
insert into public.tenant_ui (tenant_id, version, cambiado_por, cambiado_en)
values (:'tenant'::uuid, 'v2', null, now())
on conflict (tenant_id) do update set version = 'v2', cambiado_por = null, cambiado_en = now();
select 'ui' as que, version as valor, cambiado_en::text from public.tenant_ui where tenant_id = :'tenant'::uuid;
commit;
SQL
  echo "✔ UI v2 activada. Se nota en menos de 30 s (caché)."
  ACCION_REVERSA="--revertir"
else
  psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
begin;
delete from public.tenant_ui where tenant_id = :'tenant'::uuid;
select 'ui' as que, count(*)::text as valor from public.tenant_ui where tenant_id = :'tenant'::uuid;
commit;
SQL
  echo "✔ UI v2 revertida (la flota vuelve a v1)."
  ACCION_REVERSA=""
fi
if [ -n "$ENV_FILE" ]; then ARG_ENV=" --env-file $ENV_FILE"; PREFIJO=""; else ARG_ENV=""; PREFIJO='DATABASE_URL="$DATABASE_URL" '; fi
[ "$PRODUCCION" = "1" ] && ARG_PROD=" --produccion" || ARG_PROD=""
echo "Para ${ACCION_REVERSA:+REVERTIR}${ACCION_REVERSA:-RE-ACTIVAR} (comando exacto):"
echo "  ${PREFIJO}scripts/ui/aplicar-ui-v2.sh${ACCION_REVERSA:+ $ACCION_REVERSA}${ARG_PROD}${ARG_ENV} $TENANT"
