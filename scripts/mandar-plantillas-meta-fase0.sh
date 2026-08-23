#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# FASE 0 del plan de asistencia/siniestros (docs/asistencia/PLAN-FASES.md):
# manda a aprobación de Meta las dos plantillas nuevas que bloquean la Fase 5
# (escalamiento). Tardan días en aprobarse y no dependen de código — por eso
# van el día 1, en paralelo a todo lo demás.
#
# `siniestro_reportado_v1` y `siniestro_sin_atender_v1`. NO se reusa
# `recordatorio_cierre` (su texto aprobado habla de otro evento — ver
# escalar_viaje.ts). Ninguna lleva botones: el texto invita a responder, que
# es lo que reabre la ventana de 24 h (ver PLANO-TECNICO.md, "Ventana de 24h").
#
# Uso:
#   bash scripts/mandar-plantillas-meta-fase0.sh
#   vercel env run --environment production -- bash scripts/mandar-plantillas-meta-fase0.sh
#
# Credenciales, en este orden (la primera que esté no-vacía gana):
#   1. WHATSAPP_ACCESS_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID del entorno
#      (así `vercel env run --environment production` inyecta las de prod).
#   2. las mismas llaves en .env.local, si el archivo existe.
# El token se usa SOLO en este proceso, nunca se imprime ni se escribe a archivo.
#
# Después de correrlo: revisar el estado en Meta Business Manager → WhatsApp
# Manager → Plantillas de mensaje (queda en PENDING hasta que Meta resuelva).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

leer_env_local() {
  local clave="$1"
  [ -f .env.local ] || return 0
  grep "^${clave}=" .env.local | head -1 | cut -d= -f2-
}

TOKEN="${WHATSAPP_ACCESS_TOKEN:-$(leer_env_local WHATSAPP_ACCESS_TOKEN)}"
WABA_ID="${WHATSAPP_BUSINESS_ACCOUNT_ID:-$(leer_env_local WHATSAPP_BUSINESS_ACCOUNT_ID)}"

[ -n "$TOKEN" ] || { echo "Falta WHATSAPP_ACCESS_TOKEN (entorno o .env.local). En prod: vercel env run --environment production -- bash scripts/mandar-plantillas-meta-fase0.sh"; exit 2; }
[ -n "$WABA_ID" ] || { echo "Falta WHATSAPP_BUSINESS_ACCOUNT_ID (entorno o .env.local). En prod: vercel env run --environment production -- bash scripts/mandar-plantillas-meta-fase0.sh"; exit 2; }

mandar() {
  local nombre="$1" cuerpo="$2" ejemplo_json="$3"
  echo "→ $nombre"
  curl -sS -X POST "https://graph.facebook.com/v21.0/${WABA_ID}/message_templates" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"${nombre}\",
      \"language\": \"es_MX\",
      \"category\": \"UTILITY\",
      \"components\": [
        {
          \"type\": \"BODY\",
          \"text\": \"${cuerpo}\",
          \"example\": { \"body_text\": [${ejemplo_json}] }
        }
      ]
    }" | tee /dev/stderr | grep -q '"id"' && echo "  ✔ enviada a aprobación" || echo "  ✘ revisar error arriba"
  echo
}

mandar \
  "siniestro_reportado_v1" \
  "{{1}} reportó una incidencia en carretera. Tipo: {{2}}. Última ubicación conocida: {{3}}. Responde este mensaje para coordinar la atención." \
  '["Juan Pérez", "choque", "Carretera 180, km 45, cerca de Valladolid"]'

mandar \
  "siniestro_sin_atender_v1" \
  "La incidencia de {{1}} sigue sin atenderse desde hace {{2}}. Último estado: {{3}}. Responde este mensaje ahora para tomar el caso." \
  '["Juan Pérez", "10 minutos", "N2, sin respuesta del jefe"]'

echo "Listo. Estado de aprobación: Meta Business Manager → WhatsApp Manager → Plantillas de mensaje."
