#!/bin/bash
# Pre-check del loop de render (etapas 5-6): corre a diario, pero solo LANZA
# una corrida de claude -p si hay sequences con `estado: aprobada` sin su
# clip — el chequeo es un grep local que cuesta cero; la bolsa de la
# suscripción no se gasta en preguntarse si hay trabajo.
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COLA="$(dirname "$REPO")/likida-marketing-cola"

[ -f "$REPO/.mejora-diaria/APAGADO" ] && exit 0

PENDIENTES=0
for MD in "$COLA"/video-*/sequences/*.md; do
  [ -e "$MD" ] || continue
  if grep -q '^estado: aprobada' "$MD"; then
    CLIP="$(dirname "$MD")/../clips/$(basename "${MD%.md}").mp4"
    [ -f "$CLIP" ] || PENDIENTES=$((PENDIENTES + 1))
  fi
done

if [ "$PENDIENTES" -eq 0 ]; then
  echo "[render-video] nada aprobado pendiente — no se gasta corrida."
  exit 0
fi
echo "[render-video] $PENDIENTES sequences aprobadas sin clip — lanzando el render."
exec bash "$REPO/scripts/mejora-diaria/rutina.sh" render-video "mcp__higgsfield mcp__elevenlabs"
