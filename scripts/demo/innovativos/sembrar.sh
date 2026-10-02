#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Siembra el DEMO «Innovativos (demo)» en una base LOCAL. IDEMPOTENTE: correrlo
# dos veces deja exactamente las mismas filas (ids deterministas + ON CONFLICT).
#
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/sembrar.sh
#   ... --reiniciar          borra el tenant demo y vuelve a sembrar (cambiar la ancla)
#   ... --ancla '2026-10-20 09:00:00-06'   «ahora» del demo (default: ese)
#   ... --solo-limpiar       solo borra
#
# NUNCA PRODUCCIÓN. Tres guardas: (1) exige DEMO_DATABASE_URL explícita (no usa
# DATABASE_URL ni SUPABASE_DB_URL a propósito); (2) rechaza hosts que no sean
# socket/localhost/red privada y cualquier *.supabase.* ; (3) el SQL se niega si
# el servidor no escucha en loopback/red privada.
# La base debe tener YA el esquema migrado (andamio + migraciones).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

URL="${DEMO_DATABASE_URL:-}"
ANCLA='2026-10-20 09:00:00-06'
REINICIAR=0; SOLO_LIMPIAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --reiniciar) REINICIAR=1 ;;
    --solo-limpiar) SOLO_LIMPIAR=1 ;;
    --ancla) shift; ANCLA="${1:?falta el valor de --ancla}" ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v psql >/dev/null 2>&1 || { echo "Falta psql." >&2; exit 2; }
[ -n "$URL" ] || { echo "Define DEMO_DATABASE_URL (p. ej. postgresql:///likida_demo). Este seed no adivina la base." >&2; exit 2; }

# Guarda de host: se extrae el host de la URL (o de PGHOST) y se exige local/privado.
host="$(printf '%s' "$URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]*).*#\2#')"
[ -n "$host" ] || host="${PGHOST:-}"
case "$URL" in
  *supabase.co*|*supabase.com*|*pooler.*|*neon.tech*|*amazonaws.com*|*vercel*) echo "RECHAZADO: la URL parece una base remota/de producción." >&2; exit 3 ;;
esac
case "$host" in
  ""|localhost|127.*|::1|\[::1\]|host.docker.internal|/*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) : ;;
  *) echo "RECHAZADO: el host '$host' no es local. El demo solo se siembra en una base local." >&2; exit 3 ;;
esac

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
P=(psql "$URL" -v ON_ERROR_STOP=1 -q)
if [ "$SOLO_LIMPIAR" = 1 ] || [ "$REINICIAR" = 1 ]; then
  "${P[@]}" -f limpiar.sql
  [ "$SOLO_LIMPIAR" = 1 ] && exit 0
fi
"${P[@]}" -v ancla="$ANCLA" -f sembrar.sql
