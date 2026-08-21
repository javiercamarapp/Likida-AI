#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Repara las 6 variables de Vercel que quedaron con el valor literal
# "[SENSITIVE]" (lote del 12-ago-2026: alguien re-guardó los valores
# ENMASCARADOS del dashboard en vez de los reales).
#
# Cómo se encontró: llm_costo.modelo de la fase ocr medía length()=11 EN
# POSTGRES — la base guardaba literalmente "[SENSITIVE]" como nombre de
# modelo. OpenRouter recibía eso como slug → 400 inmediato → todo fallo de
# foto salía como fallo_tecnico con tokens 0. El cuadre funcionaba porque su
# variable no estaba en el lote.
#
# Valores: los documentados en .env.example y models.ts (la elección medida
# del 4-ago para el OCR). Nada inventado.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

fix() {
  local nombre="$1" valor="$2"
  vercel env rm "$nombre" production -y >/dev/null 2>&1 || true
  printf '%s' "$valor" | vercel env add "$nombre" production
  echo "✔ $nombre = $valor"
}

fix LIKIDA_MODEL_OCR               'google/gemini-3.1-flash-lite'
fix LIKIDA_WHATSAPP_MSG_USD        '0.008'
fix LIKIDA_INTAKE_GRACE_MS         '2000'
fix LIKIDA_INTAKE_ESPERA_MS        '20000'
fix LIKIDA_DEDUP_FOTOS             '1'
fix LIKIDA_RECUPERAR_CIERRE_PARCIAL '1'

echo
echo "Las variables solo aplican en un deployment NUEVO. Redespliega el último:"
echo "  vercel redeploy \$(vercel ls --prod 2>/dev/null | grep Ready | head -1 | awk '{print \$3}')"
echo "o desde el panel de Vercel: Deployments → último Ready → Redeploy."
