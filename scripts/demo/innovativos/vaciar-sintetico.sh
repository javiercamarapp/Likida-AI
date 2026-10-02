#!/usr/bin/env bash
# Quita el dato SINTÉTICO de un conjunto del demo para cargar el real de Innovativos.
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/vaciar-sintetico.sh gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo
# Mismas guardas de host que sembrar.sh. Solo toca el tenant «Innovativos (demo)» y solo las filas que SEMBRÓ el demo.
set -euo pipefail
cd "$(dirname "$0")"
QUE="${1:?uso: vaciar-sintetico.sh gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo}"
case "$QUE" in gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo) : ;; *) echo "conjunto desconocido: $QUE (gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo)" >&2; exit 2 ;; esac
URL="${DEMO_DATABASE_URL:-}"
[ -n "$URL" ] || { echo "Define DEMO_DATABASE_URL." >&2; exit 2; }
# Misma guarda de host que sembrar.sh (antes de abrir ninguna conexión).
node "$(dirname "$0")/guarda-host.mjs" || exit $?
RED_PRIVADA=0; [ "${DEMO_PERMITIR_RED_PRIVADA:-}" = "1" ] && RED_PRIVADA=1
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql "$URL" -v ON_ERROR_STOP=1 -q -v que="$QUE" -v red_privada="$RED_PRIVADA" -f vaciar.sql
