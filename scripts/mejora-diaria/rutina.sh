#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# MOTOR GENÉRICO DE RUTINAS POR SUSCRIPCIÓN (16-ago-2026).
#
# Una rutina = un encargo en encargos/<nombre>.md que corre con `claude -p`
# (la suscripción de Javier) en el taller aislado. Si el encargo deja
# commits → rama + PR a aprobación; si no, solo veredicto y notificación.
# Las cadencias viven en los .plist (launchd); este motor es el mismo para
# todas — mejora-diaria/correr.sh es la ÚNICA distinta (trae el paso previo
# del auditor barato).
#
# Candados compartidos: kill switch .mejora-diaria/APAGADO, --max-turns,
# jamás merge (la aprobación es el PR con su CI), red obligatoria antes de
# trabajar sobre una base vieja.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TALLER="$(dirname "$REPO")/likida-mejoras"
CARPETA="$REPO/.mejora-diaria"
RUTINA="${1:?uso: rutina.sh <nombre-de-encargo> [tools-extra]}"
EXTRA_TOOLS="${2:-}"   # p.ej. "mcp__higgsfield" para la rutina de visuales
ENCARGO="$REPO/scripts/mejora-diaria/encargos/$RUTINA.md"
HOY="$(date +%Y%m%d)"

log() { echo "[$(date '+%H:%M:%S')] [$RUTINA] $*"; }

[ -f "$CARPETA/APAGADO" ] && { log "APAGADO existe — kill switch activo."; exit 0; }
[ -f "$ENCARGO" ] || { log "No existe el encargo $ENCARGO."; exit 2; }
[ -d "$TALLER" ] || { log "No existe el taller — corre instalar.sh."; exit 2; }
command -v claude >/dev/null || { log "claude CLI fuera de PATH."; exit 2; }
mkdir -p "$CARPETA/reportes"

cd "$TALLER"
git fetch origin --quiet || { log "Sin red hacia origin — no trabajo sobre base vieja."; exit 1; }
RAMA="mejora/$RUTINA-$HOY"
git checkout --quiet -B "$RAMA" origin/master
CENTINELA="$(mktemp)"   # todo archivo creado por la corrida es más nuevo que esto

# El bus de mando (0127): la corrida queda visible en /admin/tu-turno desde
# que arranca. Si el bus no contesta, la rutina sigue igual (bus.sh jamás
# rompe a quien lo llama).
BUS="$REPO/scripts/mejora-diaria/bus.sh"
BUS_ID="$(bash "$BUS" corrida-inicio "$RUTINA" 2>/dev/null || true)"

log "claude -p con el encargo…"
# --output-format json: veredicto del campo `result` + telemetría de turnos
# (patrón headless de Anthropic: salida estructurada, no grep de texto libre).
CRUDO=$(claude -p "$(cat "$ENCARGO")" \
  --permission-mode acceptEdits \
  --allowedTools "Read Edit Write Glob Grep Bash Task ToolSearch $EXTRA_TOOLS" \
  --max-turns 100 --output-format json 2>&1) || true
SALIDA=$(echo "$CRUDO" | python3 -c "
import json,sys
crudo=sys.stdin.read()
try:
    d=json.loads(crudo[crudo.index('{'):])
    print(d.get('result',''))
    print(f\"[meta] turnos={d.get('num_turns','?')} dur_s={round(d.get('duration_ms',0)/1000)} error={d.get('is_error',False)}\", file=sys.stderr)
except Exception:
    print(crudo)
")
echo "$SALIDA" | tail -8

RESUMEN="sin veredicto"
echo "$SALIDA" | grep -q "VEREDICTO:" && RESUMEN=$(echo "$SALIDA" | grep "VEREDICTO:" | tail -1 | cut -c1-140)

if [ -n "$(git log origin/master..HEAD --oneline)" ]; then
  if git push --quiet -u origin "$RAMA"; then
    URL=$(gh pr create --head "$RAMA" --title "$RUTINA: $(date +%F)" \
      --body "$(printf 'Rutina automatizada `%s` (Claude Code por suscripción, taller aislado).\n\n%s\n\nLa aprobación es este PR con su CI de 3 checks — nada se mergea solo.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' "$RUTINA" "$RESUMEN")" 2>&1 | tail -1)
    log "PR abierto: $URL"
  else
    log "Push rechazado — el commit queda en la rama local $RAMA."
  fi
else
  log "Sin commits — $RESUMEN"
  git checkout --quiet --detach origin/master; git branch -D "$RAMA" 2>/dev/null || true
fi

# ── WhatsApp al personal de Javier: veredicto + reportes + piezas nuevas ──
WA="$REPO/scripts/mejora-diaria/wa-notificar.sh"
MSG="🤖 $RUTINA — $RESUMEN"
[ -n "${URL:-}" ] && MSG="$MSG
PR: $URL"
bash "$WA" "$MSG" || true
# Reportes que esta corrida dejó (documento adjunto):
find "$CARPETA/reportes" -type f -newer "$CENTINELA" 2>/dev/null | head -2 | while read -r F; do
  bash "$WA" "📄 $RUTINA: $(basename "$F")" "$F" || true
done
# Piezas nuevas en la cola de marketing (hasta 4 imágenes + el copy):
COLA="$(dirname "$REPO")/likida-marketing-cola"
find "$COLA" -type f \( -name '*.png' -o -name '*.jpg' \) -newer "$CENTINELA" 2>/dev/null | head -4 | while read -r F; do
  bash "$WA" "🖼 $RUTINA: $(basename "$(dirname "$F")")/$(basename "$F")" "$F" || true
done
find "$COLA" -type f \( -name 'post.md' -o -name '*-guion*.md' -o -name 'guion.md' \) -newer "$CENTINELA" 2>/dev/null | head -2 | while read -r F; do
  bash "$WA" "📝 $RUTINA: para tu tap — $(basename "$(dirname "$F")")" "$F" || true
done
# Cierre en el bus: veredicto + PR, y el espejo de las piezas nuevas de la
# cola (las mismas que se acaban de mandar por WhatsApp — /admin/tu-turno
# las enseña como tarjeta con su tap).
if [ -n "${BUS_ID:-}" ]; then
  bash "$BUS" corrida-fin "$BUS_ID" 0 "${URL:-}" "$RESUMEN" 2>/dev/null || true
fi
find "$COLA" -type d -mindepth 2 -maxdepth 2 -newer "$CENTINELA" 2>/dev/null | head -6 | while read -r D; do
  bash "$BUS" pieza "$RUTINA" "$D" 2>/dev/null || true
done

rm -f "$CENTINELA"

osascript -e "display notification \"$RESUMEN\" with title \"Likida · $RUTINA\"" 2>/dev/null || true
log "Fin."
