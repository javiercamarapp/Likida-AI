#!/bin/bash
# El canal de WhatsApp de los agentes → el número PERSONAL de Javier.
#
# Uso:  wa-notificar.sh "texto"                → mensaje de texto
#       wa-notificar.sh "caption" archivo.png  → imagen con caption
#       wa-notificar.sh "caption" archivo.pdf  → documento con caption
#
# Cómo funciona con el número de PRUEBA de Meta (el bloqueante conocido no
# aplica aquí): el número de prueba SÍ puede enviar a destinatarios
# registrados en el panel de Meta — el personal de Javier lo está. La
# ventana de 24h manda: si Javier no le ha escrito al bot en 24h, la API
# rechaza el mensaje libre (error 131047) y este script cae a la plantilla
# hello_world — el "toque en el hombro" que le avisa que abra la ventana
# contestando cualquier cosa.
#
# Config (en .env.local del repo, NO en .env.example — el runbook.test solo
# escanea lecturas del código TS):
#   WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID  (las del producto)
#   LIKIDA_WA_JAVIER  → su número personal en E.164, ej. 5218112345678
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRAPH="https://graph.facebook.com/v21.0"   # la misma versión que src/lib/meta/client.ts

leer() { grep "^$1=" "$REPO/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d '"' | tr -d "'" | xargs; }
TOKEN="$(leer WHATSAPP_ACCESS_TOKEN)"
PHONE_ID="$(leer WHATSAPP_PHONE_NUMBER_ID)"
DESTINO="$(leer LIKIDA_WA_JAVIER)"

TEXTO="${1:?uso: wa-notificar.sh \"texto\" [archivo]}"
ARCHIVO="${2:-}"

if [ -z "$TOKEN" ] || [ -z "$PHONE_ID" ] || [ -z "$DESTINO" ]; then
  echo "[wa] sin configurar (falta WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID/LIKIDA_WA_JAVIER en .env.local) — no se manda." >&2
  exit 2
fi

enviar_json() { curl -sS -X POST "$GRAPH/$PHONE_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1"; }

if [ -n "$ARCHIVO" ] && [ -f "$ARCHIVO" ]; then
  # 1) subir el media, 2) mandarlo con caption. Tipo por extensión.
  EXT="${ARCHIVO##*.}"
  case "$(echo "$EXT" | tr '[:upper:]' '[:lower:]')" in
    png)  MIME="image/png";  TIPO="image" ;;
    jpg|jpeg) MIME="image/jpeg"; TIPO="image" ;;
    mp4)  MIME="video/mp4";  TIPO="video" ;;
    pdf)  MIME="application/pdf"; TIPO="document" ;;
    *)    MIME="text/plain"; TIPO="document" ;;   # .md y demás van como documento
  esac
  MEDIA_ID=$(curl -sS -X POST "$GRAPH/$PHONE_ID/media" \
    -H "Authorization: Bearer $TOKEN" \
    -F "messaging_product=whatsapp" -F "type=$MIME" -F "file=@$ARCHIVO;type=$MIME" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  if [ -z "$MEDIA_ID" ]; then
    echo "[wa] no se pudo subir $ARCHIVO — mando solo el texto." >&2
  else
    CUERPO=$(python3 - "$TIPO" "$MEDIA_ID" "$DESTINO" "$TEXTO" "$ARCHIVO" <<'PY'
import json,sys,os
tipo,mid,to,cap,ruta=sys.argv[1:6]
m={"id":mid}
if tipo=="document": m["filename"]=os.path.basename(ruta)
if tipo in ("image","video","document"): m["caption"]=cap[:1000]
print(json.dumps({"messaging_product":"whatsapp","to":to,"type":tipo,tipo:m}))
PY
)
    R=$(enviar_json "$CUERPO")
    echo "$R" | grep -q '"messages"' && { echo "[wa] $TIPO enviado: $(basename "$ARCHIVO")"; exit 0; }
    echo "[wa] fallo media: $(echo "$R" | head -c 300)" >&2
  fi
fi

# Texto (o el fallback si el media falló).
CUERPO=$(python3 - "$DESTINO" "$TEXTO" <<'PY'
import json,sys
print(json.dumps({"messaging_product":"whatsapp","to":sys.argv[1],"type":"text",
  "text":{"preview_url":False,"body":sys.argv[2][:4000]}}))
PY
)
R=$(enviar_json "$CUERPO")
echo "$R" | grep -q '"messages"' && { echo "[wa] texto enviado."; exit 0; }

if echo "$R" | grep -q "131047"; then
  # Ventana de 24h cerrada: el toque en el hombro con la plantilla de prueba.
  enviar_json "{\"messaging_product\":\"whatsapp\",\"to\":\"$DESTINO\",\"type\":\"template\",\"template\":{\"name\":\"hello_world\",\"language\":{\"code\":\"en_US\"}}}" >/dev/null
  echo "[wa] ventana de 24h cerrada — mandé hello_world; contesta al bot para abrirla." >&2
  exit 3
fi
echo "[wa] fallo: $(echo "$R" | head -c 300)" >&2
exit 1
