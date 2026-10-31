#!/bin/bash
# Arnés de capturas UI v2: render -> CSS -> capturas.
# Uso: scripts/ui2-captura/correr.sh <v1|v1-tokens|v2> <inter|hanken|sistema> <destino>
set -e
cd "$(dirname "$0")/../.."
~/likida-loop/heavy.sh npx vitest run --config scripts/ui2-captura/vitest.config.mts --maxWorkers=2 >/dev/null
node scripts/ui2-captura/compilar-css.mjs >/dev/null
node scripts/ui2-captura/capturar.mjs --modo="$1" --fuente="$2" --dest="$3"
