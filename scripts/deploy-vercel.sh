#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy de Likida a Vercel — automatiza link + envs + deploy a producción.
#
# REQUIERE una acción interactiva TUYA primero (una sola vez):
#     npm i -g vercel && vercel login
#
# Luego:  bash scripts/deploy-vercel.sh
#
# Empuja las variables de .env.local a Vercel PRODUCCIÓN (y las de .env.preview, si existe, a preview),
# saltando las vacías (p. ej. WHATSAPP_* si aún no tienes las creds de Meta),
# NEXT_PUBLIC_APP_URL (se fija al dominio CANÓNICO https://app.likida.ai, no a
# la URL efímera del deployment — ver CLAUDE.md: la cookie de Supabase Auth se
# escribe en el dominio que esta variable diga, y un subdominio aleatorio deja
# a nadie con sesión) y las dos del passcode muerto (DASHBOARD_PASSCODE /
# DASHBOARD_SECRET, borradas con /acceso el 5-ago: empujarlas las perpetuaría).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

command -v vercel >/dev/null || { echo "❌ Falta Vercel CLI:  npm i -g vercel"; exit 1; }
[ -f .env.local ] || { echo "❌ Falta .env.local"; exit 1; }

# AUDITORÍA 12, MEDIO (operabilidad): el dominio CANÓNICO, no $url del deploy.
# DEPLOY.md lo documenta y el script lo violaba: horneaba el subdominio efímero
# en el bundle del cliente y el login quedaba fuera de la cuenta sin un error.
APP_URL_PRODUCCION='https://app.likida.ai'

echo "▸ Vinculando el proyecto (crea 'likida' si no existe)…"
vercel link

# A37-S03-02: SOLO para entornos NUEVOS. Sobre un proyecto vivo este script publicaría código saltándose
# la compuerta de migraciones y la bandera [deploy] (ver DEPLOY.md). Se aborta si ya hay deployments.
if [ "${FORZAR_ENTORNO_VIVO:-}" != "si" ] && vercel ls 2>/dev/null | grep -qE 'Ready|Building|Queued'; then
  echo "❌ Este proyecto YA tiene deployments: el script es solo para entornos nuevos."
  echo "   Publica con un commit con [deploy] (tras las migraciones). Para forzarlo: FORZAR_ENTORNO_VIVO=si"
  exit 1
fi

# A37-S03-01: lee un valor de dotenv respetando comillas. Sin comillas solo se quita un comentario
# precedido de espacio (' #…'), de modo que 'pa#ss' en una contraseña NO se trunca.
valor_dotenv() {  # texto-tras-el-igual
  local v="$1"
  case "$v" in
    \"*) v="${v#\"}"; v="${v%%\"*}" ;;
    \'*) v="${v#\'}"; v="${v%%\'*}" ;;
    *) v="$(printf '%s' "$v" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')" ;;
  esac
  printf '%s' "$v"
}

existe_env() {  # name environment
  vercel env ls "$2" 2>/dev/null | awk '{print $1}' | grep -qx "$1"
}

push_env() {  # name value environment
  local name="$1" val="$2" env="$3"
  [ -z "$val" ] && return 0
  # A37-S03-01: AGREGAR antes de borrar. Si ya existe, se reemplaza solo cuando el nuevo `add` es posible:
  # se intenta primero el add; si choca con el existente, se borra y se vuelve a agregar, y si ESE add
  # falla se aborta con aviso (la variable quedó sin valor: re-agrégala a mano) en vez de seguir en silencio.
  if ! printf '%s' "$val" | vercel env add "$name" "$env" >/dev/null 2>&1; then
    vercel env rm "$name" "$env" -y >/dev/null 2>&1 || true
    printf '%s' "$val" | vercel env add "$name" "$env" >/dev/null \
      || { echo "❌ No se pudo agregar $name en $env y la anterior quedó borrada: re-agrégala a mano."; exit 1; }
  fi
  existe_env "$name" "$env" || { echo "❌ $name no aparece en 'vercel env ls $env' tras agregarla."; exit 1; }
  echo "  ✓ $name → $env"
}

# A37-S03-03: el dominio canónico se fija ANTES del build (la variable se hornea en el bundle).
echo "▸ Fijando NEXT_PUBLIC_APP_URL=$APP_URL_PRODUCCION (antes del build)…"
push_env NEXT_PUBLIC_APP_URL "$APP_URL_PRODUCCION" production

echo "▸ Empujando variables de entorno a PRODUCCIÓN (desde .env.local)…"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  name="${line%%=*}"
  val="$(valor_dotenv "${line#*=}")"
  [ "$name" = "NEXT_PUBLIC_APP_URL" ] && continue     # ya fijada arriba
  [ "$name" = "DASHBOARD_PASSCODE" ] && continue      # muerto (passcode borrado 5-ago)
  [ "$name" = "DASHBOARD_SECRET" ] && continue        # muerto (passcode borrado 5-ago)
  push_env "$name" "$val" production
done < .env.local

# A37-S03-02: Preview NUNCA recibe los secretos de producción. Solo si existe un `.env.preview`
# (otra base/credenciales de staging) se empuja a preview.
if [ -f .env.preview ]; then
  echo "▸ Empujando .env.preview → preview…"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    push_env "${line%%=*}" "$(valor_dotenv "${line#*=}")" preview
  done < .env.preview
else
  echo "(sin .env.preview: Preview queda sin variables; no se copian los secretos de producción)"
fi

echo "▸ Deploy a producción…"
url="$(vercel --prod --yes)"
echo "✅ Desplegado: $url"

cat <<EOF

── SIGUIENTE ──────────────────────────────────────────────────────────────────
1) Webhook de Meta →  $url/api/webhook/whatsapp   (usa WHATSAPP_VERIFY_TOKEN)
2) Confirma el plan:  vercel project inspect  (o el dashboard → Settings → Functions)
   - Si Pro + Fluid Compute: sube maxDuration a 120 en route.ts.
   - Si Hobby: queda en 60; el peor caso va por QStash (FASE 3).
3) Reportar tier + probar flujo/ráfaga contra el dominio real.
EOF
