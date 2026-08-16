# F7 — Las dos piezas del chasis que exigen infraestructura externa

> 14-ago-2026. Conexiones y /seguridad quedaron CONSTRUIDAS. Estas dos NO se
> construyeron a propósito: ambas dependen de infraestructura que no existe
> todavía, y fingirlas con una pantalla sería violar la regla del repo.
> Este doc deja el diseño listo para que cada una sea un bloque corto cuando
> su prerequisito exista.

## 1. Intake por correo (facturas@<flota>.likida.ai)

**Qué es:** cada cliente recibe una dirección propia; lo que llega
(XML de proveedores, desgloses de peaje) entra al mismo pipeline que
WhatsApp y las subidas del panel.

**Prerequisito real:** correo ENTRANTE — un dominio con MX y un receptor
(las opciones serias: Resend Inbound / Postmark Inbound / SES). Hoy Likida
no tiene ninguno configurado; el análisis del 29-jul (encabezado de
`intake/consolidado.ts`) ya había pospuesto esto a propósito porque WhatsApp
cubre el 90% del caso.

**Diseño (cuando haya receptor):**
- Dirección por tenant: `docs-<slug>@in.likida.ai`; el slug vive en `tenant`
  (columna nueva) y la pantalla de Conexiones lo enseña como conector con
  salud (último correo recibido = la medición).
- Webhook del proveedor → ruta `api/inbound/correo` con verificación de firma
  del proveedor (mismo patrón que el webhook de WhatsApp: HMAC + rate limit +
  tope de cuerpo) → despacho por tipo de adjunto:
  - XML CFDI de un concepto → `guardarFacturaProveedor` (bandeja F6).
  - XML consolidado → `guardarYConciliarConsolidado` (peajes F5).
  - CSV/XLSX → `interpretarDesglose` (peajes) o `interpretarFilasViajes`
    (import), según encabezados detectados; lo irreconocible se guarda y se
    lista en una bandeja "correo sin clasificar" — nunca se tira.
- Remitentes: allowlist por tenant (los correos del proveedor de peaje y de
  los talleres), editable en Conexiones. Sin allowlist no se procesa: un
  buzón público que ejecuta pipelines es superficie de ataque.
- El costo del OCR/parseo se registra con fase propia (`correo`).

## 2. API por agente

**Qué es:** el cliente enterprise (Transportes Innovativos tiene TMS propio +
SAP B1) lee la cola/bitácora de cada agente desde sus sistemas.

**Prerequisito real:** gestión de llaves por tenant (emitir, rotar, revocar,
scoping) — hoy no existe tabla de API keys ni pantalla para gestionarlas.

**Diseño:**
- Tabla `api_llave` (tenant_id, hash de la llave — NUNCA la llave en claro —,
  scopes jsonb, creada/revocada_en, último_uso_en). Deny-all + service role.
- Endpoints v1 SOLO LECTURA, uno por agente, espejo de lo que sus páginas ya
  leen (cero lógica nueva): `/api/v1/cobranza/cola`, `/api/v1/peajes/estado`,
  `/api/v1/proveedores/aprobadas` (el mismo layout del CSV), `/api/v1/viajes`.
- Autorización: `Authorization: Bearer <llave>` → hash → tenant + scopes; el
  tenant queda anclado por la llave, jamás por parámetro. Rate limit por
  llave. `ultimo_uso_en` alimenta la salud del conector en Conexiones.
- Escritura (crear viajes desde su TMS, empujar a SAP B1) es fase 2 y se
  diseña CON el cliente — exactamente lo que la propuesta comercial promete
  ("diseñamos el flujo de integración").

**Por qué no hoy:** emitir llaves sin pantalla de revocación es peor que no
emitirlas; y el primer consumidor real (el TMS de Innovativos) todavía no
existe como contraparte. Cuando el PoC avance, esto es ~1 día de trabajo
con este diseño.
