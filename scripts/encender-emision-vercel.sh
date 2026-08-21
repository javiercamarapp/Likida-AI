#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# ENCIENDE LA EMISIÓN REAL DE CFDI.
#
# Pone las DOS llaves que `facturacion/modo.ts` exige para que el robot APRIETE
# el botón de emitir en un portal (en vez de solo llenarlo y detenerse):
#
#   FACTURACION_MODO=emitir            → la decisión de encender el cron.
#   FACTURACION_MANDATO_ACEPTADO=si    → la confirmación de que la cláusula de
#                                        mandato ya existe y la empresa autorizó.
#
# ⚠️ AL CORRER ESTO, un ticket cuyo portal tenga adaptador escrito (hoy: solo
#    CAPUFE) se timbra SOLO, sin que nadie mire, a nombre de la flota. Es la
#    decisión de Javier, tomada el 20-ago-2026. Un portal con cuenta o CAPTCHA
#    (G500/Megasur) NO se emite solo: se le pasa al encargado con la liga lista.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

fix() {
  local nombre="$1" valor="$2"
  vercel env rm "$nombre" production -y >/dev/null 2>&1 || true
  printf '%s' "$valor" | vercel env add "$nombre" production
  echo "✔ $nombre = $valor"
}

fix FACTURACION_MODO             'emitir'
fix FACTURACION_MANDATO_ACEPTADO 'si'

echo
echo "Las variables solo aplican en un deployment NUEVO. Redespliega:"
echo "  vercel redeploy \$(vercel ls --prod 2>/dev/null | grep Ready | head -1 | awk '{print \$3}')"
