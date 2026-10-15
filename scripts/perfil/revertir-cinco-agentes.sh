#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Quita el perfil `cinco_agentes` (mig. 0770) de UNA flota y vuelve a encender los pipelines `ocr` y `cuadre`
# que `aplicar-cinco-agentes.sh` apagó.
#
#   DATABASE_URL="postgres://..." scripts/perfil/revertir-cinco-agentes.sh [--produccion] <UUID-del-tenant>
#   scripts/perfil/revertir-cinco-agentes.sh --env-file <ruta> [--produccion] <UUID>             # DATABASE_URL leído del archivo
#
# Igual que aplicar: se NIEGA contra un host no local salvo --produccion + confirmación interactiva (escribir el UUID);
# escribe el estado previo en ~/likida-respaldos/perfil/<fecha>-<tenant>.json antes de borrar; imprime el comando de re-aplicar.
#
# SOLO borra las filas que puso el perfil: la de `tenant_perfil` y las de `interruptor_tenant` (ocr, cuadre) cuyo motivo
# empieza con «Perfil cinco_agentes». Si alguien apagó `ocr` o `cuadre` por otra razón, esa palanca NO se toca.
# La flota recupera el comportamiento de siempre. No borra datos de la flota. Este script NO se ejecuta solo.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# shellcheck source=scripts/perfil/_comun-cinco-agentes.sh
. "$(dirname "$0")/_comun-cinco-agentes.sh"

PRODUCCION=0
ENV_FILE=""
TENANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --produccion) PRODUCCION=1 ;;
    --env-file) shift; ENV_FILE="${1:-}"; [ -n "$ENV_FILE" ] || perfil_uso_error "❌ --env-file pide una ruta." ;;
    -*) perfil_uso_error "❌ Opción desconocida: $1" ;;
    *) [ -z "$TENANT" ] || perfil_uso_error "❌ Sobra el argumento: $1"; TENANT="$1" ;;
  esac
  shift
done
if [ -z "$TENANT" ]; then
  echo "Uso: DATABASE_URL=... $0 [--produccion] [--env-file RUTA] <UUID-del-tenant>" >&2
  exit 2
fi
perfil_validar_uuid "$TENANT"
if [ -n "$ENV_FILE" ]; then perfil_cargar_env_file "$ENV_FILE"; fi
perfil_requerir_db

perfil_guardia_host "$PRODUCCION" "$TENANT" "REVERTIR el perfil cinco_agentes"
perfil_respaldar "$TENANT"
HUELLA_ANTES="$(perfil_huella "$TENANT")"

psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
begin;

delete from public.interruptor_tenant
 where tenant_id = :'tenant'::uuid
   and pipeline in ('ocr', 'cuadre')
   and motivo like 'Perfil cinco_agentes%';

delete from public.tenant_perfil where tenant_id = :'tenant'::uuid;

select 'perfil' as que, count(*)::text as valor from public.tenant_perfil where tenant_id = :'tenant'::uuid;
select 'pipeline' as que, pipeline as valor, case when apagado then 'APAGADO' else 'encendido' end as estado
  from public.interruptor_tenant where tenant_id = :'tenant'::uuid order by pipeline;

commit;
SQL
echo "huella antes=$HUELLA_ANTES despues=$(perfil_huella "$TENANT")"
if [ -n "$ENV_FILE" ]; then ARG_ENV="--env-file $ENV_FILE"; PREFIJO=""; else ARG_ENV=""; PREFIJO='DATABASE_URL="$DATABASE_URL" '; fi
if [ "$PRODUCCION" = "1" ]; then ARG_PROD=" --produccion"; else ARG_PROD=""; fi
echo "Para RE-APLICAR (comando exacto):"
echo "  ${PREFIJO}scripts/perfil/aplicar-cinco-agentes.sh${ARG_PROD}${ARG_ENV:+ $ARG_ENV} $TENANT"
echo "✔ Perfil cinco_agentes revertido. La flota vuelve al comportamiento de siempre en menos de un minuto."
