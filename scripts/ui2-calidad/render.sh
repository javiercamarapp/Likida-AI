#!/bin/bash
# Renderiza (HTML estático, componentes REALES + fixtures sintéticos) las pantallas del arnés de capturas y compila su CSS v2.
# Uso: scripts/ui2-calidad/render.sh [TRABAJO]      TRABAJO por omisión: ~/likida-loop/frontend-plan/rovaq-method/.trabajo
# Un proceso pesado a la vez, siempre bajo heavy.sh. Si la carga de la Mac es > 25 se detiene.
set -e
cd "$(dirname "$0")/../.."
T="${1:-$HOME/likida-loop/frontend-plan/rovaq-method/.trabajo}"
CARGA=$(sysctl -n vm.loadavg | awk '{print int($2)}')
if [ "$CARGA" -gt 25 ]; then echo "load $CARGA > 25: me detengo" >&2; exit 3; fi
H="$HOME/likida-loop/heavy.sh"
mkdir -p "$T/a/vistas" "$T/c/vistas" "$T/x/vistas" "$T/png-no-usado"
CFG=scripts/ui2-captura/vitest.config.mts

# A · 12 vistas del arnés original, con el chrome v2 real
UI2_OUT="$T/a" UI2_CHROME=v2 "$H" npx vitest run --config $CFG --maxWorkers=2 vistas.harness
# C · Resumen, asistente y conexiones (chrome v2)
UI2_TRABAJO="$T/c" UI2_C_OUT="$T/png-no-usado" UI2_SOLO_HTML=1 "$H" npx vitest run --config $CFG --maxWorkers=2 captura-c.harness
# C2 · A1/A2/A3 y conexiones (chrome v2)
UI2_TRABAJO="$T/c" UI2_C2_MODO=v2 UI2_C2_CSS=v2full UI2_C2_OUT="$T/png-no-usado" UI2_SOLO_HTML=1 "$H" npx vitest run --config $CFG --maxWorkers=2 captura-c2.harness
# X · la carga actual (layout + loading.tsx)
UI2_TRABAJO="$T" "$H" npx vitest run --config scripts/ui2-calidad/vitest.config.mts --maxWorkers=2

# CSS (Tailwind 4 sobre globals.css + toda la capa ui-v2). Tailwind escanea SOLO $T/<x>/vistas.
for d in a c x; do node scripts/ui2-captura/compilar-css.mjs "$T/$d" >/dev/null; done
echo "render listo en $T"
