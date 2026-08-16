#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# MEJORA DIARIA — el orquestador (16-ago-2026).
#
# Pipeline pedido por Javier: "las auditorías de los modelos baratos que
# traigan errores y bugs se les pasan a agentes de Claude Code y usan mi
# suscripción para mejorar el código todos los días."
#
#  1. auditor.mjs (gpt-oss-120b, centavos) caza hallazgos del área del día.
#  2. Cada hallazgo pasa a `claude -p` (SUSCRIPCIÓN, no API) en un worktree
#     AISLADO — las sesiones de Javier en el repo principal nunca chocan.
#  3. Fix verificado (tsc + pruebas del área) → rama → push → PR. La
#     aprobación es humana: el PR, con el CI de 3 checks encima. JAMÁS se
#     mergea ni se toca master directo desde aquí.
#
# Candados:
#  · touch .mejora-diaria/APAGADO  → kill switch, el pipeline no corre.
#  · MEJORA_TOPE_DIA (default 3)   → techo de fixes/día: protege la bolsa
#    de la suscripción que Javier usa para trabajar.
#  · Corre a las 05:30 (launchd) para no competir con su ventana de uso.
#  · --max-turns acota cada corrida; un hallazgo FALSO se descarta y se
#    registra — el agente tiene prohibido "arreglar" lo que no confirmó.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$HOME/javiercamarapp/likida"
TALLER="$HOME/javiercamarapp/likida-mejoras"       # el worktree aislado
CARPETA="$REPO/.mejora-diaria"
REGISTRO="$CARPETA/registro.jsonl"
TOPE="${MEJORA_TOPE_DIA:-3}"
HOY="$(date +%Y%m%d)"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
registrar() { # hash estado extra_json
  python3 - "$1" "$2" "$3" "$REGISTRO" <<'PY'
import json,sys
h,estado,extra,ruta=sys.argv[1:5]
fila={"hash":h,"estado":estado,"fecha":__import__("datetime").datetime.now().isoformat()}
if extra: fila.update(json.loads(extra))
open(ruta,"a").write(json.dumps(fila,ensure_ascii=False)+"\n")
PY
}

# ── Candados ───────────────────────────────────────────────────────────────
[ -f "$CARPETA/APAGADO" ] && { log "APAGADO existe — kill switch activo, no corro."; exit 0; }
[ -d "$TALLER" ] || { log "No existe el taller $TALLER — corre instalar.sh primero."; exit 2; }
command -v claude >/dev/null || { log "claude CLI no está en PATH."; exit 2; }

# ── 1 · La cacería barata ──────────────────────────────────────────────────
log "Auditor barato sobre el área del día…"
node "$REPO/scripts/mejora-diaria/auditor.mjs" || { log "El auditor falló — sin hallazgos no hay pipeline (fallar cerrado)."; exit 1; }

N=$(python3 -c "import json;print(len(json.load(open('$CARPETA/hoy-hallazgos.json'))['hallazgos']))")
if [ "$N" -eq 0 ]; then
  log "0 hallazgos nuevos hoy — el área está sana o ya todo se reportó. Fin."
  exit 0
fi
log "$N hallazgos nuevos; tope de fixes: $TOPE."

# ── 2 · El taller al día ───────────────────────────────────────────────────
cd "$TALLER"
git fetch origin --quiet || { log "Sin red hacia origin — no arreglo sobre una base vieja."; exit 1; }

ABIERTOS=0
for i in $(seq 0 $((N - 1))); do
  [ "$ABIERTOS" -ge "$TOPE" ] && { log "Tope diario alcanzado ($TOPE) — el resto queda pendiente en el registro."; break; }

  H=$(python3 -c "import json;print(json.dumps(json.load(open('$CARPETA/hoy-hallazgos.json'))['hallazgos'][$i],ensure_ascii=False))")
  HASH=$(echo "$H" | python3 -c "import json,sys;print(json.load(sys.stdin)['hash'])")
  TITULO=$(echo "$H" | python3 -c "import json,sys;print(json.load(sys.stdin)['titulo'])")
  SLUG=$(echo "$TITULO" | iconv -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-40 | sed 's/^-//;s/-$//')
  RAMA="mejora/$HOY-${SLUG:-hallazgo-$i}"
  log "── Fix $((i + 1))/$N: $TITULO → $RAMA"

  git checkout --quiet -B "$RAMA" origin/master

  cat > "$CARPETA/tmp-encargo.txt" <<ENCARGO
Eres el agente de escritura de código de Likida (la mejora diaria). Un auditor
barato reportó este hallazgo en el repo — tu trabajo, EN ESTE ORDEN:

1. VERIFICA el hallazgo leyendo el código real. Los auditores baratos se
   equivocan: si el hallazgo NO es un defecto real (ya está cubierto, lee mal
   el código, es preferencia de estilo), NO toques nada y termina tu respuesta
   con la línea exacta:  VEREDICTO: DESCARTADO — <motivo en una frase>
2. Si es real: el arreglo MÍNIMO que lo corrige, siguiendo el estilo del
   archivo. Añade o ajusta la prueba que lo cubre (el bug sin prueba vuelve).
3. Verifica: npx tsc --noEmit -p . limpio y npx vitest run <las suites del
   área tocada> en verde. Si no logras dejarlo en verde, revierte todo
   (git checkout -- .) y termina con VEREDICTO: DESCARTADO — <por qué>.
4. Commit (conventional, en español, SIN "[deploy]" en el asunto, con el
   pie Co-Authored-By de la casa). NO hagas push. Termina con la línea:
   VEREDICTO: ARREGLADO — <qué cambió en una frase>

Reglas de la casa que no se negocian: nunca inventar una cifra; fallar
cerrado y decirlo; el formato de cifras solo en lib/formato.ts; los errores
de supabase-js se comprueban por valor.

EL HALLAZGO (JSON del auditor):
$H
ENCARGO

  SALIDA=$(claude -p "$(cat "$CARPETA/tmp-encargo.txt")" \
    --permission-mode acceptEdits \
    --allowedTools "Read Edit Write Glob Grep Bash" \
    --max-turns 60 2>&1) || true
  echo "$SALIDA" | tail -5

  if echo "$SALIDA" | grep -q "VEREDICTO: ARREGLADO" && [ -n "$(git log origin/master..HEAD --oneline)" ]; then
    if git push --quiet -u origin "$RAMA"; then
      CUERPO="$(printf 'Hallazgo del auditor barato (gpt-oss-120b), arreglado por Claude Code (suscripción) en el pipeline de mejora diaria.\n\n```json\n%s\n```\n\nVerificado en el taller: tsc limpio + pruebas del área en verde. El CI de 3 checks corre sobre este PR.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' "$H")"
      URL=$(gh pr create --repo "$(git remote get-url origin | sed 's#.*github.com[:/]##;s#\.git$##')" \
        --head "$RAMA" --title "mejora-diaria: $TITULO" --body "$CUERPO" 2>&1 | tail -1)
      log "PR abierto: $URL"
      registrar "$HASH" "pr_abierto" "{\"pr\":\"$URL\",\"rama\":\"$RAMA\"}"
      ABIERTOS=$((ABIERTOS + 1))
    else
      log "Push rechazado para $RAMA — queda el commit local, se reintenta mañana."
      registrar "$HASH" "push_fallido" "{\"rama\":\"$RAMA\"}"
    fi
  elif echo "$SALIDA" | grep -q "VEREDICTO: DESCARTADO"; then
    MOTIVO=$(echo "$SALIDA" | grep "VEREDICTO: DESCARTADO" | tail -1 | sed 's/.*DESCARTADO — //' | cut -c1-200)
    log "Descartado: $MOTIVO"
    registrar "$HASH" "descartado" "{\"motivo\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$MOTIVO")}"
    git checkout --quiet --detach origin/master; git branch -D "$RAMA" 2>/dev/null || true
  else
    log "Sin veredicto claro (¿límite de turnos?) — se limpia el taller y queda pendiente."
    registrar "$HASH" "sin_veredicto" ""
    git checkout --quiet -- . 2>/dev/null; git clean -fdq 2>/dev/null
    git checkout --quiet --detach origin/master; git branch -D "$RAMA" 2>/dev/null || true
  fi
done

rm -f "$CARPETA/tmp-encargo.txt"
log "Fin: $ABIERTOS PRs abiertos hoy."
osascript -e "display notification \"$ABIERTOS PRs de mejora abiertos — revísalos en GitHub\" with title \"Likida · mejora diaria\"" 2>/dev/null || true
