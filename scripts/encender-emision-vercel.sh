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
#
# A37-S03-04: ES GLOBAL — el interruptor del cron de facturación es por agente, no por flota
# (cron/facturar/route.ts), así que esto vale para TODAS las flotas con adaptador a la vez. Por eso
# exige confirmación escrita explícita y no corre de forma desatendida. El interruptor POR FLOTA queda
# como decisión de producto pendiente (requiere dato por flota que hoy no existe).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${CONFIRMO_EMISION_REAL:-}" != "EMITIR_CFDI_REAL_PARA_TODAS_LAS_FLOTAS" ]; then
  echo "❌ Esto habilita la emisión REAL de CFDI a nombre de TODAS las flotas con adaptador."
  echo "   Para continuar, confirma con:  CONFIRMO_EMISION_REAL=EMITIR_CFDI_REAL_PARA_TODAS_LAS_FLOTAS bash $0"
  exit 1
fi

fix() {
  local nombre="$1" valor="$2"
  # A37-S03-04: agregar ANTES de borrar; si ya existe, se reemplaza, y si el re-add falla se avisa en voz alta.
  if ! printf '%s' "$valor" | vercel env add "$nombre" production >/dev/null 2>&1; then
    vercel env rm "$nombre" production -y >/dev/null 2>&1 || true
    printf '%s' "$valor" | vercel env add "$nombre" production >/dev/null \
      || { echo "❌ No se pudo agregar $nombre y la anterior quedó borrada: re-agrégala a mano."; exit 1; }
  fi
  echo "✔ $nombre = $valor"
}

fix FACTURACION_MODO             'emitir'
fix FACTURACION_MANDATO_ACEPTADO 'si'

echo
echo "Las variables solo aplican en un deployment NUEVO. Redespliega:"
echo "  vercel redeploy \$(vercel ls --prod 2>/dev/null | grep Ready | head -1 | awk '{print \$3}')"
