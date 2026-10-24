#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# VERIFICA (solo lectura) el perfil `cinco_agentes` de UNA flota. No escribe nada.
#
#   DATABASE_URL="postgres://..." scripts/perfil/verificar-cinco-agentes.sh [opciones] <UUID-del-tenant>
#
# Opciones:
#   --esperado con|sin   «con» (por defecto): debe haber perfil y ocr/cuadre apagados por el perfil.
#                        «sin»: no debe haber perfil ni interruptores puestos por el perfil (tras revertir).
#   --produccion         permite una base no local (solo lectura, sin confirmación; los cambios sí la exigen).
#   --env-file RUTA      lee DATABASE_URL de ese archivo (no se ejecuta ni se imprime).
#   --base-url URL       además prueba rutas por curl contra la app (sin seguir redirecciones); con --cookie "…".
#   --cookie "nombre=valor"   cookie de sesión de un usuario de la flota (no se imprime).
#
# Imprime: la fila de `tenant_perfil`, los interruptores `ocr` y `cuadre`, (opcional) las rutas probadas y un RESUMEN.
# Código de salida: 0 = coincide con lo esperado, 1 = no coincide, 2 = uso, 3 = la flota no existe.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
# shellcheck source=scripts/perfil/_comun-cinco-agentes.sh
. "$(dirname "$0")/_comun-cinco-agentes.sh"

ESPERADO="con"
PRODUCCION=0
ENV_FILE=""
BASE_URL=""
COOKIE=""
TENANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --esperado) shift; ESPERADO="${1:-}" ;;
    --produccion) PRODUCCION=1 ;;
    --env-file) shift; ENV_FILE="${1:-}"; [ -n "$ENV_FILE" ] || perfil_uso_error "❌ --env-file pide una ruta." ;;
    --base-url) shift; BASE_URL="${1:-}" ;;
    --cookie) shift; COOKIE="${1:-}" ;;
    -*) perfil_uso_error "❌ Opción desconocida: $1" ;;
    *) [ -z "$TENANT" ] || perfil_uso_error "❌ Sobra el argumento: $1"; TENANT="$1" ;;
  esac
  shift
done
case "$ESPERADO" in con|sin) ;; *) perfil_uso_error "❌ --esperado es «con» o «sin»." ;; esac
[ -n "$TENANT" ] || perfil_uso_error "Uso: DATABASE_URL=... $0 [--esperado con|sin] [--produccion] [--env-file RUTA] [--base-url URL --cookie C] <UUID-del-tenant>"
perfil_validar_uuid "$TENANT"
if [ -n "$ENV_FILE" ]; then perfil_cargar_env_file "$ENV_FILE"; fi
# A37-S04-05: sin cookie las rutas redirigen al login sea cual sea el perfil: la sección no prueba nada y NO puede
# terminar en «VERIFICACIÓN OK». Se rechaza el uso (exit 2) en vez de imprimir códigos que parecen una prueba.
if [ -n "$BASE_URL" ] && [ -z "$COOKIE" ]; then perfil_uso_error "❌ --base-url exige --cookie: sin sesión de un usuario de la flota las rutas solo redirigen al login y no prueban el perfil."; fi
perfil_requerir_db

HOST="$(perfil_host)"
# A37-S04-08: «local» = loopback Y puerto de la pila local (ver perfil_es_local); un túnel a producción en localhost no pasa.
if ! perfil_es_local && [ "$PRODUCCION" != "1" ]; then
  echo "❌ El host '$HOST:$(perfil_puerto)' no es local; para leer una base remota pasa --produccion." >&2; exit 4
fi
echo "Base: $HOST · flota: $TENANT · esperado: $ESPERADO perfil"

EXISTE="$(psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA <<'SQL'
select count(*) from public.tenant where id = :'tenant'::uuid;
SQL
)"
if [ "$EXISTE" != "1" ]; then echo "❌ La flota $TENANT no existe en esta base." >&2; exit 3; fi

echo "── tenant_perfil"
psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
select tenant_id, perfil, cambiado_en from public.tenant_perfil where tenant_id = :'tenant'::uuid;
SQL
echo "── interruptor_tenant (ocr, cuadre)"
psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
select pipeline, apagado, motivo from public.interruptor_tenant
 where tenant_id = :'tenant'::uuid and pipeline in ('ocr', 'cuadre') order by pipeline;
SQL

# Hechos que se comparan: perfil presente (0/1) y cuántos de ocr/cuadre están apagados POR EL PERFIL (motivo «Perfil cinco_agentes…»).
HECHOS="$(psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA -F ' ' <<'SQL'
select (select count(*) from public.tenant_perfil where tenant_id = :'tenant'::uuid),
       (select count(*) from public.interruptor_tenant
         where tenant_id = :'tenant'::uuid and pipeline in ('ocr', 'cuadre') and apagado and motivo like 'Perfil cinco_agentes%');
SQL
)"
N_PERFIL="${HECHOS% *}"; N_PIPES="${HECHOS#* }"

FALLAS=0
chequear() { # $1 = descripción, $2 = 0|1 (cumple)
  if [ "$2" = "1" ]; then echo "  ✔ $1"; else echo "  ✘ $1"; FALLAS=$((FALLAS + 1)); fi
}
echo "── comprobaciones"
if [ "$ESPERADO" = "con" ]; then
  chequear "hay fila de perfil" "$([ "$N_PERFIL" = "1" ] && echo 1 || echo 0)"
  chequear "ocr y cuadre apagados por el perfil (2 de 2)" "$([ "$N_PIPES" = "2" ] && echo 1 || echo 0)"
else
  chequear "no hay fila de perfil" "$([ "$N_PERFIL" = "0" ] && echo 1 || echo 0)"
  chequear "ningún interruptor puesto por el perfil" "$([ "$N_PIPES" = "0" ] && echo 1 || echo 0)"
fi

if [ -n "$BASE_URL" ]; then
  echo "── rutas por curl (sin seguir redirecciones; el perfil niega redirigiendo a /dashboard)"
  for ruta in /dashboard/agentes/liquidacion /dashboard/agentes/peajes /dashboard/agentes/carta-porte /dashboard/reglas /dashboard/rentabilidad; do
    if [ -n "$COOKIE" ]; then
      salida="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "Cookie: $COOKIE" "${BASE_URL%/}$ruta" || echo 'error')"
    else
      salida="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "${BASE_URL%/}$ruta" || echo 'error')"
    fi
    echo "  $ruta -> $salida"
    # Con perfil, cada ruta restringida tiene que NEGARSE (3xx a /dashboard o 403) y cuenta en FALLAS. Sin perfil
    # («sin») no se exige nada por ruta: un rol puede ser redirigido por otras razones; solo se imprime.
    if [ "$ESPERADO" = "con" ]; then
      codigo_http="${salida%% *}"; destino_http=""; case "$salida" in *" "*) destino_http="${salida#* }" ;; esac
      if perfil_ruta_negada "$codigo_http" "$destino_http"; then chequear "$ruta está cerrada para el perfil" 1; else chequear "$ruta está cerrada para el perfil (respondió: $salida)" 0; fi
    fi
  done
fi

echo "── RESUMEN"
echo "perfil=$N_PERFIL pipelines_del_perfil=$N_PIPES fallas=$FALLAS"
if [ "$FALLAS" = "0" ]; then echo "VERIFICACIÓN OK (esperado: $ESPERADO perfil)"; exit 0; fi
echo "VERIFICACIÓN FALLÓ (esperado: $ESPERADO perfil)"; exit 1
