#!/bin/bash
# Instala la mejora diaria: el worktree aislado + el launchd de las 05:30.
# Idempotente — correrlo dos veces no rompe nada.
set -euo pipefail
REPO="$HOME/javiercamarapp/likida"
TALLER="$HOME/javiercamarapp/likida-mejoras"
PLIST="$HOME/Library/LaunchAgents/com.likida.mejora-diaria.plist"

mkdir -p "$REPO/.mejora-diaria/logs"

# 1 · El taller: worktree del mismo repo (comparte .git — menos disco que un
#     clon) donde los fixes corren SIN chocar con las sesiones del principal.
if [ ! -d "$TALLER" ]; then
  git -C "$REPO" fetch origin --quiet
  git -C "$REPO" worktree add --detach "$TALLER" origin/master
  echo "Worktree creado en $TALLER"
fi
if [ ! -d "$TALLER/node_modules" ]; then
  echo "npm ci en el taller (una sola vez, tarda)…"
  (cd "$TALLER" && npm ci --silent)
fi

# 2 · El launchd — 05:30 diario, cuando la bolsa de la suscripción no compite
#     con el trabajo de Javier.
sed "s#__REPO__#$REPO#g" "$REPO/scripts/mejora-diaria/com.likida.mejora-diaria.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "launchd cargado: com.likida.mejora-diaria (05:30 diario)."
echo "Kill switch: touch $REPO/.mejora-diaria/APAGADO"
echo "Corrida manual: bash $REPO/scripts/mejora-diaria/correr.sh"
