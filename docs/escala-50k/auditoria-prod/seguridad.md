# Auditoría prod — SEGURIDAD (22-ago-2026) — sin CRÍTICOS
Verificado en base viva: 15 RPC security definer (4 ejecutables por authenticated: is_superadmin, get_user_tenant_ids, administra_flota, ve_finanzas — solo leen app_user del propio uid); 79/79 tablas con RLS; factura_saldo security_invoker; buckets privados salvo avatares (2 MB/mime). Webhooks Meta/Stripe/Resend/QStash/Auth fail-closed sin secreto. npm audit --omit=dev: 0.
## MEDIO
- SEG-1 ratelimit.ts:1-70 cae a Map por instancia sin UPSTASH_REDIS_REST_URL/TOKEN (login 10/5min, wa 40/min, v1, lead, export). Fix: verificar en Vercel; añadir a SILENCIOSAS de arranque.ts:44; /api/health expone ratelimit: redis|memoria.
- SEG-2 api/lead/route.ts:190-203 público: update de empresa/contacto_nombre/telefono/unidades/urgencia/atribucion por correo existente. Fix: solo rellenar nulos; resto a notas.
- SEG-3 cookies Supabase httpOnly:false por default (@supabase/ssr), CSP 'unsafe-inline' (proxy.ts:79-81). Fix: cookieOptions { httpOnly: true } en createServerClient (no hay createBrowserClient); nonce en CSP.
- SEG-4 contactos.ts:55-74 + oficina_wa.ts:157-165: texto de oficina al analista sin marca de no confiable; teléfono de flota_admin en app_user = lectura de dinero por WA sin MFA. Fix: marcar dato no confiable en prompt; OTP la primera vez que un teléfono actúa como oficina.
## BAJO
- SEG-5 CRON_SECRET comparado con !== en 5 crons → timingSafeEqual.
- SEG-6 worker/llaves.ts:45 últimos 6 chars de la llave en evento_seguridad → hash.slice(0,8).
- SEG-7 meta/client.ts:490-515 y conv.ts:285,303 loguean telefono; regex del redactor no cubre espacios → normalizar antes de loguear.
- SEG-8 vendor/xlsx sin procedencia documentada → vendor/README; unaccent en public (WARN advisor).
- SEG-9 CSRF: /api/admin/palette POST, /v1/* por cookie, mapa-prospectos/mensaje sin check de Origin (mitigado por sameSite lax) → verificar Origin/Sec-Fetch-Site.
