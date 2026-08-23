# Auditoría "qué tira producción" — reglas para auditores (SOLO LECTURA, no edites nada)

Repo: /Users/javiercamaraportepetit/likida-aud18 (rama escala-dashboard = master desplegado hoy 22-ago-2026).
Next.js 15 App Router en Vercel (serverless, maxDuration por ruta), Supabase Postgres 17 (PostgREST max_rows 1000),
WhatsApp Cloud API (Meta), OpenRouter (LLM), Resend, Stripe, QStash. Multi-tenant por tenant_id + RLS.
Contexto de escala objetivo: clientes de 5,000 a 50,000 viajes/mes (≈ 3.5 gastos/viaje, 12 meses de histórico).
Ya conocidos (NO repetir, solo referenciar si agravan): docs/escala-15k.md §6 (traerTodo en JS con techo de 100k filas),
docs/demo-5k.md §4 (offset O(n²)), docs/auditoria-18/hallazgos.md (83 ya arreglados hoy).

Para CADA hallazgo, en español:
- ID (prefijo de tu lente + número), severidad (CRÍTICO = tira el servicio o pierde dinero/datos o fuga entre flotas;
  ALTO = una pantalla/cron/camino deja de funcionar o miente; MEDIO; BAJO)
- archivo:línea LEÍDO (no adivines), qué hace, escenario concreto de falla con valores (a 50k viajes/mes si aplica)
- cómo verificaste (grep/lectura/cálculo); si no pudiste, dilo
- arreglo propuesto en 1-3 líneas
Ordena por severidad. Intenta refutar cada hallazgo antes de anotarlo. Sé exhaustivo en tu lente, no en otros.
Entrega el reporte como texto final (es tu valor de retorno, no un mensaje para humano).
