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

> ⚠️ **ESTADO DE EJECUCIÓN REAL (25-jul-2026) — el ✅ significa "código escrito", NO "corrió".**
> Hasta el 24-jul los tests solo cubrían el **motor determinístico** (funciones puras). El
> webhook, el repositorio, el mutex, RLS, el acuse consolidado y la persistencia **NUNCA se
> habían ejecutado**. La auditoría de 5 agentes **leyó código, no observó un sistema corriendo.**
> Por eso la etiqueta "FASE 1 completa" era engañosa: **FASE 1 está CODIFICADA y con tests de
> motor verdes, pero no probada de punta a punta.**
>
> **Lo que YA se ejecutó contra la base real** (proyecto Supabase `Likida` creado 25-jul, nube):
> migraciones 0001–0006 aplicadas y verificadas; **CR-1** (`unique(viaje_id)` + upsert → 1 sola
> liquidación); **AL-1** (mutex `try_lock_viaje`: true→false→true); **RLS** (lectura anónima →
> `[]`). **Lo que sigue SIN correr end-to-end:** el flujo de la app (webhook → OCR → cuadre →
> `guardar_liquidacion` → PDF) — bloqueado por `SUPABASE_SERVICE_ROLE_KEY` + `OPENROUTER_API_KEY`
> + credenciales de WhatsApp (pendientes de pegar). El **ensayo** (NIVEL 4) con red degradada es
> la primera vez que el sistema completo se ejerce.

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

## 3.2 Fixes del audit (bloqueantes del demo) — ✅ HECHO (ver `AUDIT_V2.md`)
Auditoría de 5 expertos (frontend, agentificación, seguridad, backend, arquitectura)
consolidada en `AUDIT_V2.md`. Bloque "antes del 6-ago" resuelto en 4 oleadas:
- ✅ **Duplicado que no infla total** + `no_encontrado` no deducible + `monto≤0` + RFC genérico no falsea receptor + EFOS whitelist (oleada 1).
- ✅ **Fallback cross-provider REAL** en `generateStructured` y `generateWithTools` (antes solo en `generateResponse`, muerto). El fallback nunca re-ejecuta mutaciones (oleada 2).
- ✅ **Concurrencia:** `unique(viaje_id)` + upsert idempotente + mutex por viaje + at-least-once (release del claim si crashea) — migración `0005` (oleada 2). **Requiere aplicar `0005_concurrencia.sql` antes de probar el cierre por WhatsApp.**
- ✅ **Prompt sin tools fantasma**, `ROLE_PARAMS` aplicado (cuadre a temp 0), `maxDuration`, middleware fail-closed, pulido de UI del demo (oleadas 1/3/4).
- ⏳ **Reads del dashboard vía RLS** (no service-role) → movido a FASE 2 / post-demo (AL-5).

---

## 4. LO QUE SÍ SUMA AL DEMO (además de FASE 1)
- **Conciliación de diésel** (`cuadre/diesel.ts`): `litros_esp = km/rendimiento` (config), alerta >15%, reglas carga>tanque / sobreprecio vs zona (precios **CNE** —ex-CRE, ver §8 bloque 6— desde snapshot cacheado, nunca red) / suma>esperado. Determinístico.
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
WhatsApp (operador manda 12 fotos) → **clasificación de entrada** → OCR silencioso → **validación fiscal (RFC + UUID + SAT + complemento hidrocarburos, con fallback)** → cierre por **intención/timeout/manual** → cuadre determinístico (política + **diésel** + **casetas** + diferencias fiscales) → **un** mensaje consolidado + PDF + CSV/póliza. Todo parametrizable, demo-safe, sin datos de campo previos.

---

## 8. FASE 2 — PLAN ACTUALIZADO (post-auditoría, orden nuevo)

> Actualización del founder (24-jul-2026). El orden cambió: apareció un hueco de
> **cumplimiento fiscal** más grave que los anteriores. Producto se llamará
> **Likida.ai** (solo en docs nuevos; NO renombrar código todavía).
>
> **Reglas vigentes (recordatorio):** nada hardcodeado a un cliente (todo por
> `getConfig(tenantId)`); el LLM **clasifica intención y extrae datos, NUNCA cuadra,
> decide deducibilidad ni aprueba**; todo I/O de red con timeout + fallback, nunca
> tumbar la liquidación; typecheck 0 + tests verdes antes de cada push; commit
> atómico por incremento.
>
> **Orden de arranque:** 1 (verificando fuente oficial primero) → 2 → 3 → 4 → 5 …

### Bloque 1 — COMPLEMENTO DE HIDROCARBUROS (bloqueante, fiscal) ✅ HECHO
Verificado contra **fuente primaria** (RMF 2026, DOF 28-dic-2025; regla **2.7.1.48**;
regla 2.7.1.8 §2; Transitorio Décimo Tercero; CFF **29-A** último párrafo):
- **Nombre oficial:** "Complemento Concepto para la facturación de Hidrocarburos y
  Petrolíferos" v1.0, **a nivel concepto**, nodo `HidrocarburosPetroliferos`.
- **Vigencia 24-abr-2026** = publicación en Portal (25-mar-2026) + 30 días naturales
  (regla 2.7.1.8 §2). No es fecha dura en la RMF; es consecuencia del mecanismo.
- **Claves confirmadas:** 15101505 diésel, 15101514 magna, 15101515 premium (la 15101506
  quedó obsoleta). **Solo tipos I y E.**
- **Unidad LTR: NO es requisito legal** (la regla solo obliga `ClaveProdServ`) → NO se
  usa como gate duro (era falso negativo).
- **A quién obliga:** emisor **permisionario CNE** que enajena gasolina/diésel (2.6.1.1
  fr.II / 2.6.1.2), no "todo CFDI con combustible". Las **estaciones de servicio SÍ son
  permisionarias** → el ticket de la flota sí cae. **Excluidos: monedero electrónico
  (ECC) y Carta Porte** (esquemas distintos) → el parser los detecta y el motor no aplica.
- **No deducibilidad:** CFF 29-A último párrafo (el complemento es requisito fiscal del CFDI).

**Implementado (modelo de dos niveles, el QR NO trae el complemento → requiere el XML):**
- **NIVEL 1** (foto/QR): factura de combustible con UUID sin XML → `complemento_no_verificable`
  → bandeja del liquidador. **Nunca no deducible sin verificar** (criterio EFOS).
- **NIVEL 2** (XML reenviado por WhatsApp, sin e.firma): `cfdi_xml.ts` parsea claves/unidad/
  tipo/complemento/esquema-alterno; el motor emite `complemento_hidrocarburos` (DURA, no
  deducible) si falta el complemento en un CFDI de combustible I/E vigente y no-alterno.
- Archivos: `intake/cfdi_xml.ts`, `engine.ts` (regla), `config.ts` (catálogo), `processor.ts`
  (rama documento acepta XML), migración `0006`. Config parametrizable por tenant. +13 tests.

### Bloque 2 — CIERRE DE CONVERSACIÓN ROBUSTO (bloqueante)
Hoy todo depende de que el operador escriba exactamente "listo". **Tres vías, cualquiera
dispara el cuadre:**
- **(a) Por intención, no por string.** Clasificar el texto entrante como
  `CERRAR | SEGUIR | PREGUNTA`. Reconocer "ya", "terminé", "ya está jefe", "eso es todo",
  "ya quedó", "acabé". **Aquí SÍ puede usar LLM** (clasificar intención ≠ decidir dinero);
  barato, con **fallback a keywords** si el LLM no responde.
- **(b) Por timeout.** N minutos sin comprobantes nuevos (`cierreTimeoutMin`, default **45**,
  configurable) → cierra y notifica.
- **(c) Manual.** Botón en el dashboard para que el liquidador fuerce el cierre.

**Casos límite obligatorios (con test):** comprobante que llega justo al dispararse el
timeout; operador que corrige un dato tras el acuse; foto que llega mientras se genera el
PDF; mensajes fuera de orden. (El mutex por viaje de la migración 0005 ya serializa parte
de esto.)

**Feature flag:** el refactor del acuse consolidado (`processInbound`) va **detrás de un
flag** que permita volver al modo mensaje-por-mensaje si algo rompe en vivo (ver bloque 8).

### Bloque 3 — RESOLUCIÓN DE `viaje_id` (bloqueante)
`addGasto` asume que el viaje es obvio; no lo es. **Regla determinística (test por caso):**
- **Cero viajes abiertos** → crear viaje o pedir número al operador.
- **Exactamente uno** → asignar a ese.
- **Varios abiertos** → preguntar al operador con opciones.
- **Comprobante tardío a un viaje cerrado → DECISIÓN DE PRODUCTO VALIDADA (founder):**
  **ventana de reapertura configurable.** Si el cierre fue hace **menos de `reaperturaMin`
  (default 60, configurable) Y la liquidación NO se ha exportado al ERP ni aprobado** →
  **reabrir**, re-cuadrar y re-emitir el PDF (con nota de corrección / versión). Pasada la
  ventana o ya exportada → registrar como **`extemporáneo`** en la bandeja del dashboard
  para el liquidador; **NO tocar la liquidación ya emitida.**

### Bloque 4 — CLASIFICADOR DE ENTRADA ANTES DEL OCR
En campo llegan audios, stickers, selfies, capturas. Hoy el OCR intentaría sacar litros de
la foto de un perro. **Clasificar antes de procesar:** `COMPROBANTE | NO_COMPROBANTE | ILEGIBLE`.
- `NO_COMPROBANTE` → **ignorar en silencio**, sin gastar OCR ni contar costo.
- `ILEGIBLE` → pedir reenvío **una sola vez**, sin spam (marca en `wa_conversacion`).

### Bloque 5 — DEDUP POR HASH DE IMAGEN (nuevo)
El dedup por UUID no cubre los tickets **sin factura** (no traen UUID). Si el operador
reenvía la misma foto por mala señal → gasto duplicado. Agregar:
- **Hash** (perceptual o criptográfico) de la imagen entrante.
- **Dedup secundario** por tupla `(monto, fecha, emisor/estación)`.
- Igual que con UUID: el duplicado **NO suma** a `totalComprobado`.

### Bloque 6 — PRECIOS DE COMBUSTIBLE CACHEADOS (corrige violación de §0.4)
**OJO: la CRE ya no existe. La sustituyó la Comisión Nacional de Energía (CNE) en marzo
2025.** Usar la fuente vigente de la **CNE**, no la CRE.
- **Snapshot persistido** (DB o archivo en repo) con **fecha de corte**.
- Un **job separado** lo actualiza; el motor **SOLO lee del snapshot** — **nunca** hace red
  para calcular una diferencia.
- Mostrar la **fecha de corte del snapshot en el PDF** de liquidación.
- **Mismo criterio para el catálogo de casetas esperadas por ruta.**

### Bloque 7 — CICLO DE VIDA DEL ESTADO `PENDIENTE` (nuevo)
El fallback que marca `pendiente de validación SAT` está bien, pero hoy el gasto se queda
pendiente **para siempre**. Agregar **job de reintento con backoff** que reconsulte el SAT
y actualice el estado. Definir: cuántos reintentos, ventana de backoff, y qué pasa si nunca
resuelve (p. ej. tras N intentos → queda `pendiente_definitivo` visible para el liquidador).

### Bloque 8 — CALENDARIO, FEATURE FLAG Y ENSAYO
- **Refactor del acuse consolidado va TEMPRANO**, no al final: toca el corazón del flujo.
  Detrás de **feature flag** (`CUADRA_ACUSE_CONSOLIDADO`) que permita volver a
  mensaje-por-mensaje si rompe en vivo.
- **El último día NO se programa: se ENSAYA** el demo completo de punta a punta, varias
  veces. **Congelamiento de código 24 h antes.**
- El ensayo **DEBE incluir red degradada:** tumbar a propósito el **SAT, WhatsApp y el LLM**,
  uno por uno y en combinación. *La regla demo-safe solo se prueba forzando fallos: si nunca
  forzaste el fallback, no sabes si funciona.*

**CALENDARIO CON FECHAS REALES (hoy 25-jul-2026 · demo 6-ago-2026 · 12 días).**
Demo es **WhatsApp REAL** → las credenciales de Meta son dependencia de camino crítico.

| Fecha | Fase | Foco |
|---|---|---|
| **25–27 jul** | Build | Cerrar NIVEL 0: **0.3 rate limiting**, 0.6 SAT (al llegar UUID). **Dependencia dura: dar de alta el número de Meta / WhatsApp Cloud API** (token, webhook, plantillas). Sin esto no hay demo WhatsApp. |
| **28–30 jul** | Integración | Cablear el flujo E2E por WhatsApp real (número de prueba). Primeros runs completos. Verificar que el agente **cierra confiable** (llama las tools) en el canal real. Plantillas Meta aprobadas si se inicia conversación. |
| **31 jul–2 ago** | Hardening + dry-runs | Corridas E2E completas por WhatsApp; arreglar lo que truene. Dashboard read-only pulido. Contador/ráfaga con fotos reales entrando. |
| **3–4 ago** | Ensayo (subir el ritmo) | E2E completo ×varias. **Empezar los drills de red degradada.** Congelar features nuevas (solo fixes). |
| **5 ago (D-1)** | 🧊 **CONGELAMIENTO DE CÓDIGO** (24 h antes) + **ENSAYO FORMAL** | Ver checklist ↓. Después de este día NO se programa. |
| **6 ago (D-0)** | 🎤 **DEMO** | No se programa. Solo correr. **PASO 1 del día: migraciones aplicadas + base despierta.** |

**Checklist del ensayo (5-ago, en orden):**
1. **PASO 1 — migraciones aplicadas y base despierta.** Si el proyecto Supabase se pausó por inactividad, **despertarlo** (una consulta lo reactiva). Confirmar las 12 migraciones + seed cargado + `envHealth` en verde.
2. **Flujo completo por WhatsApp real ×3 seguidas sin fallo:** operador manda fotos (ráfaga) → "listo" → cuadre → PDF entregado → dashboard lo muestra.
3. **Prueba con la red del lugar / WiFi** (no solo la de la oficina).
4. **Drills de red degradada — forzar los fallos, uno por uno y combinados:**
   - **SAT caído/timeout** → los CFDI deben quedar `pendiente` y la liquidación CONTINÚA (nunca tumba). Se avisa "se revisa después".
   - **Meta/WhatsApp caído** → el envío saliente falla; el claim se libera (at-least-once) y Meta reintenta; el operador reenvía. Verificar que no se pierde la liquidación (ya está en la DB).
   - **LLM/OpenRouter caído** → el fallback cross-provider entra; si todo cae, el agente responde "se me trabó, reenvía" sin inventar nada (la guardia de cifras protege el número).
   - **Combinados** (SAT + LLM, Meta + SAT): la regla demo-safe SOLO se valida forzando fallos. *Si no forzaste el fallback, no sabes si funciona.*
5. **Plan B en la sala:** si Meta se cae en vivo y no vuelve, tener el **simulador `/demo`** listo como respaldo visual (motor determinístico, sin red).

### Bloque 9 — MENORES
- **`casetasEsperadas`** se menciona en §4 pero **no está en la interfaz `CuadraConfig`** de §3
  → agregarlo (catálogo por ruta, parametrizable).
- **Plantillas de WhatsApp aprobadas por Meta:** para el demo por simulador no estorban, pero
  el trámite tarda. **Documentar** cuáles harían falta el día que el sistema **inicie** la
  conversación (kit del viaje, reporte al director) — son mensajes *business-initiated* que
  requieren plantilla aprobada.
- **Nombre del producto: Likida.ai** — solo en documentos nuevos; **NO renombrar código** aún.

### ✅ DECISIÓN CERRADA — NO van colas (QStash) antes del 6-ago
El hallazgo de la ráfaga cerró el debate. Se temía que 12 fotos × ~6.8s de OCR =
~82s serializados excedieran el presupuesto de la función y forzaran una cola.
**Ese escenario nunca existió:** cada foto es su **propia invocación del webhook**
con su **propio presupuesto de 60s** (`maxDuration`), y con la barrera de intake las
fotos corren en **PARALELO**, no serializadas. Medido contra la base real: 8 fotos
+ "listo" → **3.5s en paralelo vs 24s serializados**, "listo" esperó a que el
contador llegara a 0 y vio los 8 gastos. La cola (QStash) queda como deuda técnica
post-piloto (at-least-once con estado durable), **no** como bloqueante del demo.

### Bloque 10 — DEUDA TÉCNICA (documentar, NO construir ahora)
- **Observabilidad:** `correlation-id` por comprobante que una foto entrante → clasificación
  → OCR → validación SAT → cuadre → línea del PDF.
- **Concurrencia (más allá del mutex 0005):** bloqueo optimista si dos comprobantes llegan
  casi simultáneos al mismo viaje, o si llega uno mientras el viaje se cierra.
- **Bóveda de secretos:** el día que existan credenciales (e.firma, contraseñas de portales)
  **NUNCA** van en el config del tenant. Requieren cifrado con **claves separadas por tenant**.
  El config es solo para parámetros de negocio.
- **AL-5:** reads del dashboard/analytics vía RLS (hoy service-role con `.eq('tenant_id')` a mano).
- **CR-2 completo:** cola QStash para el procesamiento (at-least-once con estado, no solo release del claim).
