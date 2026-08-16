#!/bin/bash
# Instala TODAS las rutinas por suscripción: el worktree aislado + los
# launchd de cada cadencia. Idempotente — correrlo dos veces no rompe nada.
#
# Las cadencias (los .plist de esta carpeta):
#  · mejora-diaria      05:30 todos los días — auditor barato caza, claude -p arregla
#  · auditoria-semanal  dom 06:30 — un RUBRO profundo con ataques adversariales
#  · vigilancia-fiscal  vie 21:00 — cuota IEPS del DOF vespertino → PR
#  · visuales-semanal   mar 07:30 — pieza de marca a la cola de aprobación
#  · salud-mensual      día 1 07:00 — deps, advisories, bumps seguros → PR
set -euo pipefail
REPO="$HOME/javiercamarapp/likida"
TALLER="$HOME/javiercamarapp/likida-mejoras"

mkdir -p "$REPO/.mejora-diaria/logs" "$HOME/javiercamarapp/likida-marketing-cola"

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

# 2 · Todos los launchd de la carpeta.
for PLANTILLA in "$REPO"/scripts/mejora-diaria/com.likida.*.plist; do
  NOMBRE="$(basename "$PLANTILLA")"
  DESTINO="$HOME/Library/LaunchAgents/$NOMBRE"
  sed "s#__REPO__#$REPO#g" "$PLANTILLA" > "$DESTINO"
  plutil -lint -s "$DESTINO"
  launchctl unload "$DESTINO" 2>/dev/null || true
  launchctl load "$DESTINO"
  echo "cargado: ${NOMBRE%.plist}"
done

echo ""
echo "Kill switch de TODAS las rutinas: touch $REPO/.mejora-diaria/APAGADO"
echo "Corrida manual de una rutina:      bash $REPO/scripts/mejora-diaria/rutina.sh <nombre>"
echo "Reportes:                          $REPO/.mejora-diaria/reportes/"
