# DOCUMENTO MAESTRO DE INGENIERÍA — SISTEMA "CUADRA"
### Liquidación de viajes de flota en México vía agente de IA por WhatsApp
*Vigencia de la investigación: 24 de julio de 2026 · Redactado para Claude Code · Español mexicano*

---

## 0. MAPA AL REPO (dónde vive cada cosa — leer junto con la PARTE B)
Estado actual y a dónde va cada paso de la FASE 1:
| Paso | Archivo en el repo | Estado |
|---|---|---|
| 2.1 Webhook + HMAC + idempotencia | `src/app/api/webhook/whatsapp/route.ts`, `src/lib/meta/client.ts`, `conv.ts:claimMessage` | ✅ |
| 2.2 OCR visión | `src/lib/cuadra/intake/ocr.ts` | ✅ |
| 2.3 Parser QR CFDI | `src/lib/cuadra/intake/cfdi.ts` | ✅ (solo formato) |
| 2.4 Consulta SAT (ConsultaCFDIService) | **NUEVO `src/lib/cuadra/intake/sat.ts`** + wire en `ocr.ts` | ❌ construir |
| 2.5 RFC receptor = empresa | `cfdi.ts` / motor | ❌ construir (1 día) |
| 3.1-3.6 cuadre determinístico | `src/lib/cuadra/cuadre/engine.ts` | ✅ (ver AUDIT.md: fix duplicados) |
| 3.5 Conciliación diésel | **NUEVO `src/lib/cuadra/cuadre/diesel.ts`** | ❌ construir |
| 3.7 Anomalías (precios CRE) | `analytics.ts` + `diesel.ts` | ⚠️ parcial |
| 3.10 PDF | `src/lib/cuadra/liquidacion/pdf.ts` | ✅ |
| 4.x export CSV / póliza | `src/lib/cuadra/export.ts` (CSV ✅); póliza Contpaqi ❌ pend. ERP |
| Costo | `src/lib/cuadra/costos.ts` (LLM ✅; **falta costo WhatsApp** — ver KEY FINDING 2) |

**Regla de oro (respetar en todo lo nuevo):** el motor de cuadre es determinístico (código), el LLM solo extrae/redacta — NUNCA cuadra, decide deducibilidad ni aprueba.

---

## TL;DR

- **El complemento Carta Porte vigente al 24 de julio de 2026 es la versión 3.1** (obligatoria desde julio 2024; el SAT actualizó sus catálogos el 13 de enero de 2026), la **RMF 2026 se publicó en el DOF el 28 de diciembre de 2025**, y **WhatsApp cobra por mensaje desde el 1 de julio de 2025**. Estos tres hechos anclan el alcance del demo del 6 de agosto.
- **La FASE 1 debe ser quirúrgica:** WhatsApp (webhook + HMAC) → OCR con Gemini → parser de QR + validación de CFDI contra el SAT (`ConsultaCFDIService` SOAP) → motor determinístico de cuadre → PDF + CSV. **NO** autofacturación de gasolineras, descarga masiva con e.firma, ni dispersión bancaria: roadmap por riesgo legal/técnico.
- **El mayor riesgo legal es el uso de la e.firma del cliente por un tercero y el RPA sobre portales del SAT/gasolineras/bancos.** Se resuelven con figura de tercero autorizado vía PAC y con tarjetas de flotilla que emiten CFDI consolidado (Clara, Mendel, Edenred), nunca con scraping.

---

## KEY FINDINGS (lo que ancla las decisiones de arquitectura)

1. **Carta Porte 3.1 sigue siendo el único esquema válido.** El 13 de enero de 2026 el SAT liberó actualización de **catálogos** (no del XSD) para 2026; sin catálogos actualizados los PAC rechazan el timbrado. Multa por CFDI sin Carta Porte: **$19,700 a $112,650 MXN por comprobante** (CFF art. 84 fr. IV).

2. **WhatsApp tiene un cambio de precio que afecta el modelo de costos.** Desde el 1-jul-2025 se cobra por mensaje. Las plantillas *utility* y mensajes de servicio dentro de la ventana de 24h **son gratis solo hasta el 30-sep-2026**; Meta cobra desde el **1-oct-2026**. Tarifa base México: *utility* **USD 0.0080**, *authentication* USD 0.0207, *marketing* USD 0.0436 por mensaje. **→ El costo por liquidación debe incluir mensajes de WhatsApp, no solo LLM.**

3. **El motor de cuadre debe ser 100% determinístico.** La LFPDPPP 2025 da al trabajador derecho a oponerse a decisiones únicamente automatizadas que afecten su economía/rendimiento; la deducibilidad exige reglas auditables.

4. **Tres integraciones legalmente delicadas, fuera de FASE 1:** (a) autofacturación de gasolineras (sin API, CAPTCHA, franquicias), (b) descarga masiva con e.firma (personalísima), (c) dispersión SPEI (requiere IFPE). El open banking regulado **no existe operativamente** a julio 2026.

---

## DETAILS

### PARTE A — MARCO NORMATIVO Y DE VIGENCIA

**A.1 RMF 2026.** DOF **28-dic-2025**, vigente todo 2026. Novedad al giro: nueva obligación de CFDI para enajenación de gasolinas/diésel/hidrocarburos. *Verificar redacción de reglas 2.7.x antes de codificar.*

**A.2 Carta Porte 3.1.** Obligatoria desde jul-2024; único esquema. Catálogos `c_` actualizados 13-ene-2026. Autotransporte federal (permiso SICT). Infracciones: CFF 84-IV ($19,700–$112,650/CFDI) y 103 (presunción de contrabando).

**A.3 WhatsApp Business Platform.** Cobro por mensaje desde 1-jul-2025 (API on-premise deprecada oct-2025; todo Cloud API). Categorías: marketing, utility, authentication, service. **Fin de gratuidad de utility/servicio: 1-oct-2026** (junto al Meta Business Agent, 1-ago-2026). *Verificar rate card MX en developers.facebook.com.*

**A.4 Deducibilidad de combustible — LISR 27-III.** Combustible **debe** pagarse con transferencia/cheque nominativo/tarjeta/monedero autorizado, **aun si no excede $2,000**. Efectivo = **NO deducible en ningún monto**. Reglas RMF 3.3.1.7 y 3.3.1.10 (monederos). **→ marcar NO deducible toda carga en efectivo.**

**A.5 Descuentos a nómina — LFT 110/111/517.** 110-I (lista taxativa): deudas con el patrón (anticipos, errores, pérdidas, averías) con topes **acumulativos**: ≤ un mes de salario y descuento periódico ≤ **30% del excedente del salario mínimo**, con convenio. 111 prohíbe intereses. 517: prescripción **un mes**. **→ Cuadra calcula el tope legal y exige aprobación humana + convenio; nunca automático.**

**A.6 LFPDPPP 2025.** DOF 20-mar-2025, vigente 21-mar-2025. Desaparece el INAI; autoridad: Secretaría Anticorrupción y Buen Gobierno. Derecho a **oponerse a tratamientos automatizados** y a **revisión humana**. **→ ranking de operadores/fraude requiere aviso de privacidad + revisión humana, no puede ser única base de una decisión que afecte al trabajador.**

**A.7 Open banking.** Ley Fintech 2018 art. 76 obliga APIs, pero a jul-2026 solo hay regulación de datos abiertos (cajeros/sucursales). Datos transaccionales **sin regulación operativa** (amparo ene-2026). **→ conciliación bancaria vía agregadores privados, no APIs reguladas.**

**A.8 Conservación — CFF 30.** Contabilidad y comprobantes 5 años; conservar Carta Porte y soporte.

---

### PARTE B — LOS 40 PASOS

#### FASE 1 — ANTES DEL VIAJE
**1.1 Creación del viaje.** Maestros: unidad (placas, config, rendimiento), operador (RFC/CURP/licencia), origen-destino (**CP + coordenadas** exige CP 3.1), cliente, mercancía (clave producto SAT). TMS MX: Kepler, Drivin, SimpliRoute, Beetrack, Anceti. **Construir tabla propia; NO integrar TMS en FASE 1.**
**1.2 Tabulador.** km × rendimiento; usar **histórico por unidad** (configurable). Banda inicial: CANACAR/ANTP/SICT.
**1.3 Casetas esperadas.** "Traza tu Ruta" SICT/CAPUFE **sin API pública**. **Tabla de tarifas propia; NO scraping.**
**1.4 Anticipo.** STP (IFPE, dispersión SPEI REST `/ordenPago/registra`, RSA-SHA256, sandbox `demo.stpmex.com`). Tarjetas de flotilla: Edenred, Pluxee, **Mendel**, **Clara** (CFDI consolidado + complemento hidrocarburos), Solvento. **FASE 1: solo registrar; no dispersar.**
**1.5 Emisión Carta Porte 3.1.** PACs con API: Facturama (sandbox `apisandbox.facturama.mx`), Facturapi (~$299/mes, playground), Finkok, SW/Sapien, Factura.com, Fiscalapi (SDKs), FacturoPorTi. Requiere CSD. **FASE 1: solo validar; emisión = roadmap.**
**1.6 Kit por WhatsApp.** Requiere **plantillas utility aprobadas** + verificación de negocio.

#### FASE 2 — EN RUTA
**2.1 Webhook.** HMAC `X-Hub-Signature-256` con App Secret + idempotencia por message id. ✅ hecho.
**2.2 OCR.** Gemini (extraer a JSON). Modelo: **Gemini 2.5 Flash deprecado 16-oct-2026** → usar **3 Flash / 3.1 Flash-Lite** (ya migrado a 3.6 Flash en el repo). El LLM **solo extrae**.
**2.3 QR CFDI.** Anexo 20: `re`,`rr`,`tt`,`id`. ✅ hecho.
**2.4 Consulta SAT.** SOAP **`ConsultaCFDIService`**, WSDL `https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?WSDL`, método `Consulta(expresionImpresa)`, **público sin auth**. Devuelve `Estado` (Vigente/Cancelado), `ValidacionEFOS` (200/201=limpio), `EstatusCancelacion`. Códigos: `S`=ok, `N-601`=expresión inválida, `N-602`=no encontrado, `100`=EFOS. **Aceptar solo si Vigente + EFOS limpio.**
**2.5 RFC receptor = empresa.** `rr` debe ser el RFC de la empresa (no el chofer). Regla dura.
**2.6 Autofacturación gasolineras.** Sin portal único (cada estación = franquicia, emisor real ≠ Pemex/G500; URL en ticket). Sistemas: GORM/Brentec, FacturacionEstacion, FacturaGAS. Plazo seguro: **mismo mes calendario**. Requiere complemento **Hidrocarburos**. Sin API, con CAPTCHA. Agregadores: **Mendel, Clara**. **FASE 1 fuera; recomendar tarjeta de flotilla. Roadmap: integrar agregador.**
**2.7 TAG casetas.** IAVE/PASE/TeleVía/ViaPass/EasyTrip/SITAG. CFDI lo emite el **proveedor del TAG** (mensual consolidado desde el 5º día hábil). Efectivo en caseta: facturar en **30 días**. IVA 16% acreditable. **FASE 1: capturar CFDI que descargue el cliente.**
**2.8 POD.** Foto sello/firma, evidencia auditable.
**2.9 Odómetro/litros.** Foto o telemetría (Geotab/Samsara/Wialon/Ituran/Detektor). FASE 1: foto.
**2.10 Efectivo COD (reparto).** CFDI + complemento REP si PPD. **Construir registro + conciliación — clave para Nadro.**
**2.11 Incidencias.** NOM-087-SCT-2-2017 (tiempos de conducción). Captura tipificada.

#### FASE 3 — LIQUIDACIÓN (corazón determinístico)
- 3.1 cierre+agrupación · 3.2 clasificación (LLM sugiere) · 3.3 duplicados (UUID dura) · 3.4 cuadre vs política (100% código) · 3.5 conciliación diésel (litros vs km vs histórico) · 3.6 saldo · **3.7 anomalías**: carga>tanque, fuera de ruta, horario imposible, **sobreprecio vs precio de zona (datos abiertos CRE/CNE en `datos.gob.mx`/`cne.gob.mx`, XML/CSV/JSON diario ~18:00, Acuerdo A/041/2018)**; agregadores PetroIntelligence/GasMapa · 3.8 aclaración (LLM redacta, reglas deciden) · 3.9 aprobación con niveles (segregación de funciones) · 3.10 PDF.

#### FASE 4 — FISCAL Y CONTABLE
- **4.1** Validar Carta Porte vs SAT.
- **4.2 Descarga masiva.** e.firma (`.cer`+`.key`+pass, regla RMF 2.7.2.4). Flujo Autenticación→Solicitud→Verificación→Descarga (ZIP ≤200k CFDI), **v1.5** (29-may-2025), `cfdidescargamasivasolicitud.clouda.sat.gob.mx`. Libs `phpcfdi/sat-ws-descarga-masiva`. **RIESGO: e.firma personalísima → FASE 1 fuera; roadmap vía PAC o consentimiento cifrado.**
- **4.3 Deducibilidad/IVA.** LISR 27/28, LIVA 5. Motor determinístico marca deducible/no + IVA acreditable/no.
- **4.4 Póliza — Contabilidad electrónica Anexo 24** (DOF 13-ene-2026; CFF 28-IV). XML: catálogo (código agrupador SAT), balanza (1_3), pólizas (1_3, UUID por mov). Pólizas solo **a requerimiento**. RESICO PM sí, PF no.
- **4.5 ERP.** SAP (OData/BAPI/IDoc → proyecto TI, fuera). Odoo (XML/JSON-RPC, `account.move`). **Contpaqi (v14.2.7+)**: TXT (`P` encabezado + `M` movimientos + `AD` UUID) o **SDK** (genera GUID → ADD/SQL Server). `P`: tipo, fecha yyyyMMdd, TipoPol (1 Ingreso/2 Egreso/3 Diario/4 Orden), folio, SisOrig, impresa, ajuste, concepto. `M`: cuenta, tipoMov, importe, idDiario, importeME, concepto, idSegNeg. **Aspel COI** (10 vigente, 11 en 2026): Integración de pólizas, layout con `FIN_PARTIDAS`, fecha DD/MM/AAAA. **FASE 1: CSV/PDF; roadmap Contpaqi TXT.**

#### FASE 5 — TESORERÍA
- 5.1 Dispersión SPEI (STP) — roadmap. · **5.2** saldo en contra a nómina (LFT 110/111/517, ver A.5): calcular tope, exigir convenio, nunca automático. · 5.3 reposición anticipo. · 5.4 conciliación bancaria: agregadores **Belvo** (IFPE CNBV), Prometeo, Finerio, Paybook/Syncfy — roadmap.

#### FASE 6 — INTELIGENCIA
- 6.1 km/L · 6.2 costo/km (metodología CANACAR) · **6.3 ranking operadores (LFPDPPP: aviso + revisión humana)** · 6.4 patrones de fraude · 6.5 tabulador recalibrado · 6.6 reporte al director por WhatsApp.

---

### PARTE C — TRANSVERSALES
- **C.1 RPA** sobre portales de terceros: alto riesgo ToS + frágil (CAPTCHA). Preferir APIs oficiales/agregadores + tarjetas de flotilla. **Sin scraping en FASE 1.**
- **C.2 Datos:** Cuadra es **encargado del tratamiento**; aviso de privacidad, contrato de encargado, cifrado, ARCO (LFPDPPP 2025).
- **C.3 Conservación:** CFF 30.
- **C.4 Costos LLM:** Gemini Flash + batching + prompt caching. Verificar deprecación (2.5 Flash 16-oct-2026).
- **C.5 Panorama competitivo (jul-2026):**
  - **Solvento** — fintech de pagos/liquidez para autotransporte, integrada al SAT, motor de auditoría con IA ("Solvento Audita", con API); **USD 25M con BBVA Spark, 13-feb-2026** (Series B). "78% del carga en México va por carretera."
  - **Mendel** — tarjeta flotilla + IA que recupera/valida CFDI ante el SAT.
  - **Clara** — Clara Fleet Card (monedero SAT, CFDI consolidado).
  - **Edenred** — Ticket Car. · **Nowports** — freight forwarding. · **Kepler/Anceti** — TMS/ERP. · Zumma, Trato.
  - **Qué NO cubren:** nadie hace la **liquidación conversacional por WhatsApp** (foto → cuadre determinístico → PDF + póliza) reemplazando al liquidador/cajero. **Ese es el hueco de Cuadra.**

---

## RECOMMENDATIONS

### Plan FASE 1 quirúrgica — 12 días, demo Transportes Innovativos 6-ago-2026
Construir en este orden:
1. Webhook WhatsApp + HMAC + idempotencia (2.1). ✅
2. OCR Gemini → JSON (2.2); el LLM solo extrae. ✅
3. Parser QR (2.3) ✅ + **`ConsultaCFDIService` SOAP (2.4)** + validación RFC receptor y EFOS (2.5). ❌
4. Motor determinístico: agrupación (3.1)✅, duplicados por UUID (3.3)✅, cuadre vs política (3.4)✅, **conciliación diésel litros/km (3.5)**❌, saldo (3.6)✅, **anomalías con precios CRE (3.7)**❌.
5. PDF (3.10)✅ + CSV para ERP.
6. Validación de Carta Porte vs SAT (4.1).

**Para Nadro (reparto):** priorizar registro de efectivo cobrado (2.10) + conciliación contra entregas.

**Fuera de FASE 1 (con razón):** autofacturación gasolineras (RPA/CAPTCHA), descarga masiva (e.firma personalísima), dispersión SPEI (IFPE), ERP nativo (proyecto TI → empezar CSV), telemetría/open banking (sin APIs estándar).

**Reglas de oro:** validaciones en código; el LLM nunca cuadra/decide/aprueba; manejar errores (`N-601`/`N-602`, foto ilegible, CFDI cancelado/EFOS, combustible en efectivo→no deducible); probar con tickets reales de **Silao, Guadalajara, Nuevo Laredo**.

### Benchmarks que cambian el plan
- Meta cobra utility desde 1-oct-2026 → maximizar la ventana de servicio de 24h, minimizar plantillas iniciadas por el negocio.
- Nueva versión de esquema Carta Porte (>3.1) → congelar validación hasta actualizar catálogos.
- Cliente exige póliza automática → empezar por Contpaqi TXT (no SAP).

---

## CAVEATS (verificar antes de codificar)
1. Catálogos Carta Porte 3.1 vigentes (última: 13-ene-2026).
2. Modelo Gemini vigente/no deprecado (2.5 Flash → 16-oct-2026).
3. Rate card WhatsApp MX y fecha de fin de gratuidad utility/servicio (1-oct-2026).
4. Endpoint/WSDL de `ConsultaCFDIService` (el SAT cambia rutas sin aviso).
5. Reglas RMF 2026 citadas (2.7.x, 2.8.1.x, 3.3.1.x) — confirmar en DOF.
6. Versiones XSD de contabilidad electrónica (catálogo 1_1 vs balanza/pólizas 1_3).
7. Layout TXT exacto de Contpaqi por versión (usar el **SDK** por robustez).
8. Firma RSA-SHA256 de STP (`/ordenPago/registra`) — confirmar en onboarding.
9. Figura legal para descarga masiva con e.firma de terceros — validar con fiscalista; preferir vía PAC.

**Fuentes conflictivas:** plazo de autofacturación de gasolineras varía (48h–30 días) → usar "mismo mes calendario". Rendimientos km/L de industria varían → usar histórico por unidad como verdad.
