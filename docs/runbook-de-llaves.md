# El runbook de llaves — qué está configurado y qué falta, con dueño (16-ago-2026)

Auditado comparando `.env.example` (54 vars) contra Vercel production (31) y
`.env.local` (26) — solo NOMBRES, ningún valor se leyó. Regla de lectura: una
var ausente con default en código NO es un hueco; una ausente que apaga una
función SÍ, y se dice cuál.

## ✅ COMPLETO en producción (nada que hacer)

- **WhatsApp Cloud API**: token, phone id, verify token, app secret.
- **Supabase**: URL, anon, service role.
- **OpenRouter** (todo el stack de modelos + override del OCR barato).
- **QStash entero**: `UPSTASH_QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` +
  `QSTASH_NEXT_SIGNING_KEY` + URL — la cola de facturación firma y verifica.
- **Resend** (envío + secret del webhook), **Sentry**, **CRON_SECRET** (los 5
  crons), **cofre** (`LIKIDA_COFRE_LLAVE`), `LIKIDA_DEDUP_FOTOS`,
  `NEXT_PUBLIC_APP_URL`.

## 🔴 Falta en Vercel y APAGA algo — dueño: Javier (minutos)

| Var | Qué apaga | De dónde sale |
|---|---|---|
| `GITHUB_TOKEN` | `/admin/actividad-codigo` (el heatmap de puntitos) muere en prod | github.com → Settings → Developer settings → Fine-grained token, READ-only del repo likida.ai |
| ~~`UPSTASH_REDIS_REST_URL` + `_TOKEN`~~ | **YA ESTÁ EN PRODUCCIÓN** (verificado 22-ago-2026, auditoría prod SEG-1). Se deja el renglón tachado, no borrado, porque el estado se puede perder al recrear el proyecto: sin ellas el rate limit vuelve al modo LOCAL POR INSTANCIA (cada lambda cuenta por su lado — quien insiste reparte y multiplica el techo) y el piso de una hora de `alertarOperador` también. Cómo comprobarlo sin entrar a Vercel: `curl -s https://app.likida.ai/api/health` → `"ratelimit":"redis"`. | upstash.com → Redis → Create database (free) → REST API |

Además, **no es env pero es config pendiente**: el webhook de entrega de
Resend debe apuntar a `https://app.likida.ai/api/correo/eventos` (panel de
Resend → Webhooks) — sin eso `entrega_estado` de la cola nunca se llena.

## 🟡 Falta y ESPERA su momento (no se configura antes de tiempo)

| Var | Espera a | Nota |
|---|---|---|
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Activar cobro (primer cliente) | Sin ellas no hay botón de pago — el panel lo dice |
| `FACTURAPI_SECRET_KEY` | La ENTIDAD LEGAL con RFC (Fase C) | Timbrado de la mensualidad SaaS |
| `META_ADS_TOKEN` | Tener campañas de ads | Solo lectura de gasto + pausar |
| `FACTURACION_MODO` + `FACTURACION_MANDATO_ACEPTADO` | Mandato firmado con revisión legal | **Ausentes = emisión APAGADA = correcto por diseño** (el candado de dos llaves) |

## ⚪ Ausentes con DEFAULT en código (opcionales, cero urgencia)

Los tunables `LIKIDA_TOPE_*` (7 de tiempos + correo frío + runner ×2),
`LIKIDA_CHAT_TOPE_DIA_USD` (default $1), `LIKIDA_COPILOTO_TOPE_TURNOS_DIA`
(default 300), `LLM_RAZONAMIENTO_OCR`, `RATELIMIT_REDIS_FALLA_CERRADO`,
`LIKIDA_CAPTURAS_DIR`/`LIKIDA_CHROMIUM_PATH` (solo dev local). Se declaran en
`.env.example` para que el override exista; su ausencia usa el default.

## 💻 `.env.local` (la Mac) — estado

Tiene lo que las 21 rutinas y el dev necesitan (Supabase, OpenRouter,
WhatsApp, `LIKIDA_WA_JAVIER`). Los que le "faltan" contra el example son de
SERVIDOR (webhooks firmados, Sentry, QStash) y no aplican en local — los
webhooks nunca llegan a la laptop. Sin acción.

## 🔑 La llave que desbloquea TODO lo demás (Supabase)

Las migraciones 0115–0125 están escritas y verificadas en CI; producción no
las tiene y cada cierre de liquidación ya grita `corridas.no_registrada`.
La secuencia completa es UN comando una vez que exista la credencial:

    SUPABASE_ACCESS_TOKEN=sbp_xxx bash scripts/aplicar-migraciones-y-humos.sh

(o con `SUPABASE_DB_URL='postgresql://...'` — cualquiera de las dos). El
script: aplica → verifica cada pieza nueva contra la base real → corre humos
→ imprime el comando del `[deploy]`. El token se usa solo en ese proceso y
se revoca al terminar.
