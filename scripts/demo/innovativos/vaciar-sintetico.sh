#!/usr/bin/env bash
# Quita el dato SINTÉTICO de un conjunto del demo para cargar el real de Innovativos.
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/vaciar-sintetico.sh gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo
# Mismas guardas de host que sembrar.sh. Solo toca el tenant «Innovativos (demo)».
set -euo pipefail
cd "$(dirname "$0")"
QUE="${1:?uso: vaciar-sintetico.sh gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo}"
case "$QUE" in gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo) : ;; *) echo "conjunto desconocido: $QUE (gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo)" >&2; exit 2 ;; esac
URL="${DEMO_DATABASE_URL:-}"
[ -n "$URL" ] || { echo "Define DEMO_DATABASE_URL." >&2; exit 2; }
host="$(printf '%s' "$URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]*).*#\2#')"; [ -n "$host" ] || host="${PGHOST:-}"
case "$URL" in *supabase.co*|*supabase.com*|*pooler.*|*neon.tech*|*amazonaws.com*|*vercel*) echo "RECHAZADO: base remota." >&2; exit 3 ;; esac
case "$host" in ""|localhost|127.*|::1|\[::1\]|host.docker.internal|/*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) : ;; *) echo "RECHAZADO: el host '$host' no es local." >&2; exit 3 ;; esac
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql "$URL" -v ON_ERROR_STOP=1 -q -v que="$QUE" -f vaciar.sql
