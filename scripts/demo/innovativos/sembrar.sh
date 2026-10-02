#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Siembra el DEMO «Innovativos (demo)» en una base LOCAL. IDEMPOTENTE: correrlo
# dos veces deja exactamente las mismas filas (ids deterministas + ON CONFLICT).
#
#   DEMO_DATABASE_URL='postgresql:///likida_demo' bash scripts/demo/innovativos/sembrar.sh
#   ... --reiniciar          borra el tenant demo y vuelve a sembrar de cero
#   ... --reiniciar --ancla '2026-10-20 09:00:00-06'   «ahora» del demo (default: ese). --ancla EXIGE --reiniciar:
#                            sembrar encima de otra ancla mezclaría dos «ahora» (viajes, posiciones y pases a medias)
#   ... --solo-limpiar       solo borra
#   ... --encender-agentes   enciende el Vigía y el Conductor del tenant demo (vienen APAGADOS: ningún cron les escribe a nadie).
#                            Aun encendidos, el envío rechaza los teléfonos 28999… del demo.
#
# NUNCA PRODUCCIÓN. Tres guardas: (1) exige DEMO_DATABASE_URL explícita (no usa
# DATABASE_URL ni SUPABASE_DB_URL a propósito); (2) guarda-host.mjs: solo socket/localhost/127.x/[::1]; rechaza
# ?host=, ?hostaddr=, ?service=, dominios, IPs públicas y Supabase, y las redes privadas (10/8, 172.16/12,
# 192.168/16) salvo DEMO_PERMITIR_RED_PRIVADA=1; (3) el SQL repite la comprobación sobre la dirección REAL del servidor.
# La base debe tener YA el esquema migrado (andamio + migraciones).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

URL="${DEMO_DATABASE_URL:-}"
ANCLA='2026-10-20 09:00:00-06'
REINICIAR=0; SOLO_LIMPIAR=0; ANCLA_EXPLICITA=0; ENCENDER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --reiniciar) REINICIAR=1 ;;
    --solo-limpiar) SOLO_LIMPIAR=1 ;;
    --encender-agentes) ENCENDER=1 ;;
    --ancla) shift; ANCLA="${1:?falta el valor de --ancla}"; ANCLA_EXPLICITA=1 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$ANCLA_EXPLICITA" = 1 ] && [ "$REINICIAR" != 1 ]; then
  echo "--ancla requiere --reiniciar: sembrar encima de una base con otra ancla mezclaría dos «ahora» (viajes, posiciones y pases a medias). Usa:  sembrar.sh --reiniciar --ancla '$ANCLA'" >&2; exit 2
fi
command -v psql >/dev/null 2>&1 || { echo "Falta psql." >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "Falta node." >&2; exit 2; }
[ -n "$URL" ] || { echo "Define DEMO_DATABASE_URL (p. ej. postgresql:///likida_demo). Este seed no adivina la base." >&2; exit 2; }

# Guarda de host (antes de abrir NINGUNA conexión): una sola implementación, probada contra cada bypass.
node ./guarda-host.mjs || exit $?
RED_PRIVADA=0; [ "${DEMO_PERMITIR_RED_PRIVADA:-}" = "1" ] && RED_PRIVADA=1

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
P=(psql "$URL" -v ON_ERROR_STOP=1 -q -v red_privada="$RED_PRIVADA")
if [ "$SOLO_LIMPIAR" = 1 ] || [ "$REINICIAR" = 1 ]; then
  "${P[@]}" -f limpiar.sql
  [ "$SOLO_LIMPIAR" = 1 ] && exit 0
fi
"${P[@]}" -v ancla="$ANCLA" -f sembrar.sql
# Los veredictos de ubicación NO se escriben a mano: los calcula el motor real del Conductor sobre lo sembrado.
node generar-veredictos.mjs
if [ "$ENCENDER" = 1 ]; then
  "${P[@]}" -c "update vigia_config set habilitado = true where tenant_id = 'eeeeeeee-0620-4000-8000-000000000250'; update agente_conductor_config set activo = true where tenant_id = 'eeeeeeee-0620-4000-8000-000000000250'"
  echo "Vigía y Conductor del tenant demo ENCENDIDOS (los teléfonos 28999… siguen rechazados por el envío)." >&2
fi
