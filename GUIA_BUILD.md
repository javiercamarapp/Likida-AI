# GUÍA DE BUILD — Cuadra (para Claude Code)
### Todo lo que falta para el demo del 6-ago-2026, en orden ejecutable

> Conocimiento de dominio (leyes, endpoints, factibilidad de los 40 pasos): ver
> **`DOCUMENTO_MAESTRO.md`**. Esta guía es el **plan de ejecución**: qué construir,
> en qué orden, con qué reglas. Lee ambos.

---

## 0. DECISIONES FIJAS (no negociables — respétalas en todo)
1. **CERO dependencia de datos de campo de cliente_demo antes del 6.** Política de gastos, ERP, tabulador y rendimiento por unidad **NO se tendrán** antes del demo; se preguntan en la sala el día 6.
2. **Todo lo configurable es PARAMETRIZABLE POR TENANT desde archivo de config, con defaults de demo realistas. NADA hardcodeado a un cliente.** Configurable: política de gastos, tabulador/rendimiento por unidad, catálogo de cuentas contables, formato de salida (ERP), RFC de la empresa, precio de diésel por zona.
3. **El motor de cuadre es 100% determinístico (código).** El LLM solo extrae/redacta — NUNCA cuadra, decide deducibilidad ni aprueba.
4. **Demo-safe:** ninguna llamada de red (SAT, WhatsApp, LLM) puede tumbar la liquidación. Timeout + fallback siempre. Los pasos que no dependen de red deben funcionar aunque todo esté caído el día 6.
5. **Acuse consolidado, no por foto.** Los mensajes ENTRANTES de WhatsApp son gratis; solo se cobran los SALIENTES → capturar comprobantes en silencio y responder una sola vez.
6. **OCR se calibra con tickets reales de Mérida** (Pemex franquicia, G500, Oxxo Gas, Mobil) — mismos POS que Silao. No depende de cliente_demo.

---

## 1. ESTADO DEL REPO (qué YA existe)
| Módulo | Archivo | Estado |
|---|---|---|
| Webhook WhatsApp + HMAC + idempotencia | `src/app/api/webhook/whatsapp/route.ts`, `meta/client.ts`, `conv.ts:claimMessage` | ✅ |
| OCR visión (fusiona visión+JSON) | `intake/ocr.ts` | ✅ |
| Parser QR CFDI (formato/regex) | `intake/cfdi.ts` | ✅ |
| **Cliente SAT ConsultaCFDIService (fallback grácil)** | `intake/sat.ts` | ✅ (falta wire) |
| Motor de cuadre determinístico | `cuadre/engine.ts` | ✅ (ver §3.2 fixes) |
| PDF liquidación | `liquidacion/pdf.ts` | ✅ |
| Export CSV | `cuadra/export.ts` | ✅ |
| Contador de costo (LLM + **fase whatsapp**) | `cuadra/costos.ts` | ✅ (falta wire whatsapp) |
| Dashboard / demo simulador | `app/dashboard`, `app/demo` | ✅ |

---

## 2. FASE 1 — ORDEN EXACTO DE BUILD (el del founder)

### Paso 1 — Parser QR CFDI ✅ (hecho, `cfdi.ts`)
Extrae `re` (RFC emisor), `rr` (RFC receptor), `tt` (total), `id` (UUID). Sin red.
**Falta:** que `ocr.ts` capture también `rr` (rfcReceptor) en el `Gasto` (hoy solo toma emisor/uuid/total).

### Paso 2 — Regla RFC receptor = empresa ❌ (construir, sin red, 1 día)
- Agregar `rfcReceptor?: string` y `estadoSat?` a `Gasto` (`types/cuadra.ts`).
- En el pipeline: comparar `gasto.rfcReceptor` vs `config.empresa.rfc` (del config por tenant). Si no coincide → marcar el gasto y que el motor lo emita como diferencia `tipo: 'rfc_receptor'` ("factura timbrada a RFC distinto — no deducible").
- Normalizar (mayúsculas, sin espacios). Manejar flotas con varias RFC (lista en config).

### Paso 3 — Deduplicación por UUID ❌ (construir, sin red)
- En `cuadre/engine.ts`: además del dedup por folio+monto, **dedup fuerte por `cfdiUuid`** (dos gastos con el mismo UUID = duplicado, regla dura).
- **FIX del bug de AUDIT.md:** el duplicado NO debe sumarse a `totalComprobado` (hoy sí infla el total). Excluirlo. Agregar test.

> Pasos 1-3 NO dependen de red → deben funcionar aunque el SAT esté caído el día 6.

### Paso 4 — Consulta ConsultaCFDIService ✅ cliente hecho (`sat.ts`), ❌ falta wire
- En el pipeline OCR (`processor.ts`), tras extraer el CFDI: llamar `consultarCFDI({re,rr,tt,id})`.
- Guardar `estadoSat` en el gasto: `vigente | cancelado | no_encontrado | pendiente`.
- Si `cancelado` o `efos===true` → diferencia dura ("CFDI cancelado / emisor EFOS — no deducible").

### Paso 5 — Fallback si el SAT no responde ✅ (ya en `sat.ts`)
- Ante timeout/error → `estado: 'pendiente'`. El gasto se marca **"pendiente de validación SAT"** y **la liquidación CONTINÚA**. Nunca tumbar por timeout. (El motor trata 'pendiente' como advertencia, no como bloqueo.)

### + Acuse consolidado ❌ (construir en `processor.ts`)
Refactor de `processInbound`:
- **Imagen entrante:** descargar → OCR → validar (RFC/UUID/SAT) → `addGasto` → registrar costo OCR. **NO correr el agente, NO responder** (silencioso). Solo en el **primer comprobante** de la conversación, enviar UN mensaje: *"📸 Recibiendo tus comprobantes. Mándalos todos y escribe 'listo' cuando termines."* (+ registrar 1 costo whatsapp).
- **Texto entrante (ej. "listo"/"ciérralo"):** correr el agente UNA vez → responde consolidado (resumen del cuadre + diferencias) → si cierra, mandar PDF. Registrar costo del agente + costos whatsapp (solo salientes).
- Resultado: de ~12 mensajes salientes y ~12 llamadas LLM → **2-3 mensajes y 1-2 llamadas LLM** por liquidación.

### + Fase whatsapp en el contador ✅ (parcial en `costos.ts`), ❌ falta wire
- Llamar `registrarCostoWhatsApp(tenantId, viajeId)` por cada `sendText`/`sendDocument` saliente en `processor.ts`. (Entrantes = gratis, no contar.)

---

## 3. CONFIG PARAMETRIZABLE (construir — §0.2)
Crear `src/lib/cuadra/config.ts` con **defaults de demo** y override por tenant:
```ts
export interface CuadraConfig {
  empresa: { rfc: string; rfcsAdicionales?: string[] };
  politica: PoliticaGasto[];                 // topes por concepto/ruta
  tabulador: { rendimientoPorDefecto: number; factorCarga: number; precioDieselPorZona: Record<string,number> };
  unidades: Record<string, { rendimientoBase: number; capacidadTanque: number }>; // placa → params
  catalogoCuentas: Record<string, string>;   // concepto → cuenta contable
  salida: 'csv' | 'contpaqi_txt' | 'aspel_xls';
}
```
- `DEMO_CONFIG` con valores realistas (política Silao-Laredo genérica, diésel $27/L, rendimiento 3 km/L, etc.) — **marcados como demo, no de un cliente**.
- `getConfig(tenantId)`: lee override del tenant (DB `tenant_config` jsonb o archivo); si no hay, usa `DEMO_CONFIG`.
- Migrar `getPolitica` (repo) y la política hardcodeada de `/api/demo` a leer de `getConfig`.
- El día 6: se captura la config real de cliente_demo en la sala → se guarda como override del tenant. Cero código nuevo.

## 3.2 Fixes del audit (bloqueantes del demo)
- **Duplicado que no infle total** (§2 paso 3).
- **Fallback real de modelos** en `generateStructured`/`generateWithTools` (hoy solo `generateResponse`, que está muerto) — para que un hipo de OpenRouter no tumbe el OCR/agente en vivo. Plan B: llaves directas Google/Anthropic.
- **Reads del dashboard vía `supabaseServer` (RLS)**, no service-role.

---

## 4. LO QUE SÍ SUMA AL DEMO (además de FASE 1)
- **Conciliación de diésel** (`cuadre/diesel.ts`): `litros_esp = km/rendimiento` (config), alerta >15%, reglas carga>tanque / sobreprecio vs zona (precios CRE `datos.gob.mx`) / suma>esperado. Determinístico.
- **Casetas esperadas** (tabla cacheada, parametrizable por ruta) → detección "caseta esperada sin comprobante".
- **Reporte al director por WhatsApp** (6.6) — quick win.

## 5. FUERA DE FASE 1 (roadmap, con razón)
Autofacturación de gasolineras (RPA/CAPTCHA/sin API → recomendar tarjeta de flotilla o integrar Mendel/Clara) · Emisión de Carta Porte (PAC+CSD) · Descarga masiva SAT (e.firma personalísima, async 72h-2sem) · CFDI de TAG (ingesta por correo) · Dispersión SPEI (STP, no es de Cuadra) · Descuento a nómina (LFT art. 110 — calcular y proponer convenio, NUNCA ejecutar) · Conciliación bancaria (open banking no existe → agregadores) · Telemetría · ERP nativo (empezar por archivo Contpaqi TXT).

---

## 6. REGLAS DE INGENIERÍA (para cada paso)
- Validaciones en código; el LLM nunca decide dinero/deducibilidad/aprobación.
- Todo I/O de red con timeout + fallback; nunca tumbar la liquidación.
- Manejar: `N-601`/`N-602` del SAT, foto ilegible (pedir reenvío), CFDI cancelado/EFOS, combustible en efectivo → no deducible, SAT 'pendiente'.
- Nada hardcodeado a un cliente — todo por `getConfig(tenantId)`.
- Typecheck 0 + tests antes de cada push. Commit atómico por incremento.
- Verificar antes de producción (§CAVEATS de DOCUMENTO_MAESTRO): rate card WhatsApp, modelo Gemini vigente, endpoint SAT, catálogos Carta Porte, layout Contpaqi.

## 7. RESULTADO ESPERADO EL 6
WhatsApp (operador manda 12 fotos) → OCR silencioso → **validación fiscal (RFC + UUID + SAT con fallback)** → operador escribe "listo" → cuadre determinístico (política + **diésel** + **casetas** + diferencias fiscales) → **un** mensaje consolidado + PDF + CSV/póliza. Todo parametrizable, demo-safe, sin datos de campo previos.
