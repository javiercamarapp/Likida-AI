# Deploy a Vercel — runbook

El demo del 6 es **WhatsApp REAL** → necesita una URL HTTPS pública (webhook). Sin
deploy no hay webhook. Este repo está listo (build de prod pasa en local); lo único
que falta es **tu autenticación de Vercel** — ninguna tool automática puede setear
los secrets ni conectar el repo a git por mí.

## El bloqueo (honesto)
- No tengo token de Vercel, y no hay MCP tool que cree env vars en Vercel.
- `deploy_to_vercel` (la única tool de deploy) no acepta env vars ni conecta git,
  y exige transcribir los ~50 archivos fuente a mano → inviable para este repo.
- **Conclusión:** el deploy necesita el Vercel CLI (o el dashboard), y ambos
  requieren tu login. Es UNA acción interactiva; el resto lo automatizo.

## Camino recomendado (yo manejo casi todo)
1. **Tú, una vez** (interactivo, abre el navegador):
   ```
   npm i -g vercel && vercel login
   ```
   Elige el scope `javiercamaraportepetit-2721's projects`.
2. **Yo** corro `bash scripts/deploy-vercel.sh`, que:
   - vincula/crea el proyecto `likida`,
   - empuja TODAS las envs de `.env.local` a production + preview (incluidos los 3
     flags y `CUADRA_INTAKE_ESPERA_MS`; salta las `WHATSAPP_*` vacías),
   - despliega a producción y fija `NEXT_PUBLIC_APP_URL` al dominio real.
3. **Yo** reporto: dominio, **tier real + si Fluid Compute está disponible**
   (`vercel project inspect`), y decido maxDuration 120 vs QStash.
4. **Yo** corro contra el dominio real: flujo del simulador, prueba de ráfaga, y
   confirmo que los flags están activos en prod. Reporto qué cambió vs local.

## Alternativa (dashboard, si prefieres)
Vercel → Add New → Project → Import `javiercamarapp/cuadra` → pega las envs de
`.env.example` (con los valores de `.env.local`) → Deploy. Conecta git para
auto-deploys. Luego avísame el dominio y sigo desde el paso 3.

## Variables que deben quedar en Vercel
Todas las de `.env.example` con valor real (están en `.env.local`):
Supabase (URL + anon + **service_role**), `OPENROUTER_API_KEY`, `DASHBOARD_PASSCODE`,
`DASHBOARD_SECRET`, `DEMO_TENANT_ID`, y los flags
(`CUADRA_INTAKE_GRACE_MS`, `CUADRA_RECUPERAR_CIERRE_PARCIAL`, `CUADRA_DEDUP_FOTOS`,
`CUADRA_INTAKE_ESPERA_MS`). Las `WHATSAPP_*` cuando tengas las creds de Meta.

## Meta / WhatsApp (cuando haya dominio)
- Webhook URL: `https://<dominio>/api/webhook/whatsapp`
- Verify token: el valor de `WHATSAPP_VERIFY_TOKEN`.
- El `GET` del webhook responde el challenge; el `POST` valida HMAC con `WHATSAPP_APP_SECRET`.
