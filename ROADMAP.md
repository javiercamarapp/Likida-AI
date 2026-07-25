# Roadmap — Cuadra

Prioridades post-demo. Ver `AUDIT.md` para los hallazgos de la auditoría senior.

## ✅ Hecho
- Núcleo agéntico (gateway, agente liquidación, motor de cuadre determinístico).
- OCR + CFDI (QR), WhatsApp end-to-end, PDF, export CSV, dashboard.
- Idempotencia de webhook, middleware de seguridad.
- **Contador de costo real de AI por liquidación y por tenant** (tabla `llm_costo`).

## 🔜 Optimizaciones de costo — ANOTADAS, NO construidas aún
> Decisión explícita: no construir hasta después del demo. El costo no es el
> cuello de botella a escala temprana; la calidad y la corrección sí.

- **Batch API (−50%)** para el OCR de comprobantes subidos "en lote" y para la
  generación de resúmenes que toleren segundos de latencia. No aplica al chat en
  vivo. Requiere reestructurar el intake a un flujo diferido.
- **Prompt caching de la política de gastos** (hasta −90% del input repetido en
  Claude/Gemini) — el cuadre reenvía la misma política en cada llamada.
- **Tier económico** (config "Balanceado/Piso"): Gemini Flash-Lite en OCR y chat,
  Sonnet (no Opus) en cuadre, o pesos abiertos (Qwen3-VL / DeepSeek) vía host
  occidental para clientes de alto volumen y bajo margen. Ya es un cambio de env
  (los slugs son override-able); falta el selector por plan/tenant.
- **Ruteo por niveles** (clasificador → chat barato → cuadre caro): hoy cada turno
  usa el modelo de cuadre. Implementar el router para bajar costo por turno trivial.
- **Cascada por confianza en OCR**: Flash-Lite primero, escalar a Flash/Opus solo
  el comprobante con baja confianza (~<15% de casos).

## 🔜 Correctness / seguridad (de AUDIT.md, priorizado)
- Fallback real en OCR y agente (hoy declarado pero no activo).
- Duplicado que no infle el total del cuadre.
- Reads del dashboard vía RLS (no service-role).
- Lock de conversación (race de mensajes concurrentes).
- Verificación CFDI contra el SAT + RFC receptor == flota.

## 🔜 Enterprise
- Observabilidad (Sentry) + alertas + persistencia de costo (✅ base hecha).
- Cola/retry del LLM, rate-limit, `requireEnv`, `/login`.
- Cumplimiento: DPA, aviso de privacidad, registro de tratamiento LFPDPPP.
- PDF multi-página, multi-comprobante por foto, caseta esperada faltante.
- CI (typecheck + test + build), más cobertura de tests.
