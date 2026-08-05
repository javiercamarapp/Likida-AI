#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy de Likida a Vercel — automatiza link + envs + deploy a producción.
#
# REQUIERE una acción interactiva TUYA primero (una sola vez):
#     npm i -g vercel && vercel login
#
# Luego:  bash scripts/deploy-vercel.sh
#
# Empuja TODAS las variables de .env.local a Vercel (production + preview),
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

push_env() {  # name value environment
  local name="$1" val="$2" env="$3"
  [ -z "$val" ] && return 0
  vercel env rm "$name" "$env" -y >/dev/null 2>&1 || true   # idempotente
  printf '%s' "$val" | vercel env add "$name" "$env" >/dev/null
  echo "  ✓ $name → $env"
}

echo "▸ Empujando variables de entorno…"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  name="${line%%=*}"
  val="${line#*=}"
  val="${val%%#*}"                                   # quita comentario inline
  val="$(printf '%s' "$val" | sed 's/[[:space:]]*$//')"  # quita espacios finales
  [ "$name" = "NEXT_PUBLIC_APP_URL" ] && continue     # se fija al dominio canónico abajo
  [ "$name" = "DASHBOARD_PASSCODE" ] && continue      # muerto (passcode borrado 5-ago)
  [ "$name" = "DASHBOARD_SECRET" ] && continue        # muerto (passcode borrado 5-ago)
  push_env "$name" "$val" production
  push_env "$name" "$val" preview
done < .env.local

echo "▸ Deploy a producción…"
url="$(vercel --prod --yes)"
echo "✅ Desplegado: $url"

echo "▸ Fijando NEXT_PUBLIC_APP_URL=$APP_URL_PRODUCCION …"
vercel env rm NEXT_PUBLIC_APP_URL production -y >/dev/null 2>&1 || true
printf '%s' "$APP_URL_PRODUCCION" | vercel env add NEXT_PUBLIC_APP_URL production >/dev/null
echo "  ✓ (redeploy para que tome el valor:  vercel --prod --yes)"

cat <<EOF

── SIGUIENTE ──────────────────────────────────────────────────────────────────
1) Webhook de Meta →  $url/api/webhook/whatsapp   (usa WHATSAPP_VERIFY_TOKEN)
2) Confirma el plan:  vercel project inspect  (o el dashboard → Settings → Functions)
   - Si Pro + Fluid Compute: sube maxDuration a 120 en route.ts.
   - Si Hobby: queda en 60; el peor caso va por QStash (FASE 3).
3) Reportar tier + probar flujo/ráfaga contra el dominio real.
EOF
