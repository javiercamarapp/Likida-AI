#!/bin/bash
# Instala TODAS las rutinas por suscripción: el worktree aislado + los
# launchd de cada cadencia. Idempotente — correrlo dos veces no rompe nada.
#
# Las cadencias (los .plist de esta carpeta):
# El mapa completo de cadencias vive en ESQUELETO-AUTONOMIA.md — esta
# carpeta es la fuente: cada com.likida.*.plist de aquí se instala, y los
# que ya no existan aquí se DESCARGAN (una rutina retirada que sigue
# corriendo es el peor drift).
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

# 3 · Descargar rutinas RETIRADAS: instaladas pero ya sin plantilla aquí.
#     (cazador-censo vive en el repo del censo — se excluye a propósito.)
for INSTALADO in "$HOME"/Library/LaunchAgents/com.likida.*.plist; do
  [ -e "$INSTALADO" ] || continue
  NOMBRE="$(basename "$INSTALADO")"
  [ "$NOMBRE" = "com.likida.cazador-censo.plist" ] && continue
  if [ ! -f "$REPO/scripts/mejora-diaria/$NOMBRE" ]; then
    launchctl unload "$INSTALADO" 2>/dev/null || true
    rm "$INSTALADO"
    echo "retirado: ${NOMBRE%.plist}"
  fi
done

echo ""
echo "Kill switch de TODAS las rutinas: touch $REPO/.mejora-diaria/APAGADO"
echo "Corrida manual de una rutina:      bash $REPO/scripts/mejora-diaria/rutina.sh <nombre>"
echo "Reportes:                          $REPO/.mejora-diaria/reportes/"
