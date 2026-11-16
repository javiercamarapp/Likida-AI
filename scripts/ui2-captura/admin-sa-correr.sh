#!/bin/bash
# Arnés admin-sa: render real de /admin -> CSS -> capturas PNG. UN proceso pesado a la vez.
# Uso: scripts/ui2-captura/admin-sa-correr.sh DESTINO [prefijos,de,pantallas]   (p. ej. ... /tmp/capturas 01,05)
set -e
cd "$(dirname "$0")/../.."
T="${SA_TRABAJO:-$HOME/likida-loop/frontend-plan/.arnes-admin-sa}"
export SA_TRABAJO="$T"; mkdir -p "$T"
[ -n "$2" ] && export SA_SOLO="$2"
npx vitest run --config scripts/ui2-captura/admin-sa.vitest.config.mts --maxWorkers=1
[ -n "$SA_SIN_CSS" ] || node scripts/ui2-captura/admin-sa-compilar-css.mjs "$T"
node scripts/ui2-captura/admin-sa-capturar.mjs "$T" "$1" "$2"
