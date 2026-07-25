# DOCUMENTO MAESTRO — Cuadra (guía de dominio + build para Claude Code)

> Este documento transfiere TODO el conocimiento de dominio (proceso + ley + endpoints,
> vigente al 24-jul-2026) para que Claude Code entienda la liquidación de viajes de
> transporte de carga en México y construya el sistema. Sintetiza 6 investigaciones
> profundas. **Lee esto antes de tocar código nuevo.**

---

## 0. Estado actual del repo (qué YA existe)
- ✅ Ingesta WhatsApp (webhook HMAC + idempotencia) · OCR de comprobantes (Gemini visión) · decode QR CFDI (`cfdi.ts`, solo formato/regex, aún sin consulta al SAT).
- ✅ Motor de cuadre **determinístico** (`cuadre/engine.ts`): sobre-política, faltante CFDI, duplicados, diferencia de anticipo. 4 tests.
- ✅ PDF de liquidación · export CSV · contador de costo AI (`llm_costo`) · dashboard · simulador `/demo`.
- **La decisión de dinero es determinística (código), no del LLM.** Mantener ese principio en todo lo nuevo.

## 1. El dominio en una frase
Un viaje de carga genera comprobantes de gasto (diésel, casetas, viáticos) que hoy un
**liquidador** revisa a mano, cuadra contra el anticipo y la política, y captura en el ERP.
Cuadra automatiza ese cierre por WhatsApp. El valor está en **validar fiscalmente cada
comprobante + cuadrar + detectar anomalías** — no en mover dinero (eso es de terceros).

---

## 2. Los 40 pasos — conocimiento, ley y FACTIBILIDAD

Leyenda: ✅ demo-able el 6-ago (determinístico/API, sin credenciales sensibles) ·
⚠️ alcanzable con esfuerzo (semanas) · ❌ fase 2+ (computer-use frágil / e.firma / regulado).

### Fase 1 — Antes del viaje
| Paso | Qué + ley/endpoint | Factib. |
|---|---|---|
| 1.1 Crear viaje | Por WhatsApp (LLM → JSON estricto → validación determinística → confirmación humana). Requiere **catálogos maestros** cargados 1 vez (unidades, operadores, rutas, política). | ⚠️ |
| 1.2 Tabulador diésel | `litros_esp = km / rendimiento_unidad`; tractocamión **2.5-4 km/L**, cargado consume **+20-30%**; diésel **~$27/L** (Profeco). | ✅ |
| 1.3 Casetas esperadas | "Traza tu Ruta" SICT (`app.sct.gob.mx/sibuac_internet`) **NO tiene API** (HTML frágil). Estrategia: **tabla cacheada ruta×casetas×tarifa-por-ejes** (sembrada 1 vez). | ✅ (cacheada) |
| 1.4 Dispersar anticipo | SPEI vía **STP** (IFPE). **NO es de Cuadra** — el cliente tiene la relación regulada y el fondeo. | ❌ (no es tuyo) |
| 1.5 Emitir Carta Porte | CFDI 4.0 + **complemento 3.1** (vigente desde 17-jul-2024) vía **PAC** (Facturama/SW/Finkok). Requiere **CSD**. Multa por mal hecho: hasta ~$97k/CFDI + no deducible. | ⚠️ (3-5 sem) |
| 1.6 Kit al operador | Mensaje WhatsApp con anticipo, topes, casetas esperadas, QR de CP. | ✅ |

### Fase 2 — En ruta
| Paso | Qué + ley/endpoint | Factib. |
|---|---|---|
| 2.1 Foto del comprobante | Webhook WhatsApp. | ✅ (hecho) |
| 2.2 OCR del comprobante | Gemini visión → JSON. | ✅ (hecho) |
| 2.3 Decode QR CFDI | `id`=UUID, `re`=RFC emisor, `rr`=RFC receptor, `tt`=total, `fe`=sello. | ✅ (hecho) |
| 2.4 Validar CFDI vs SAT | **ConsultaCFDIService (SOAP público, SIN credenciales):** `https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?wsdl`, método `Consulta`, input `expresionImpresa` (los 5 campos del QR). Devuelve **Estado (Vigente/Cancelado)** + **ValidacionEFOS** (lista negra 69-B). Serializar/cachear (throttling). | ✅ **quick win 3-5 días** |
| 2.5 RFC receptor ≠ chofer | Comparar `rr` (del QR) vs RFC de la empresa. Antifraude gratis. | ✅ **1 día** |
| 2.6 Auto-facturar ticket gasolinera | **Sin API — solo computer-use por portal de franquicia** (cientos de combinaciones). Ventana dura (fin de mes/72h). **Bloqueante 2026: Complemento Hidrocarburos** obligatorio (24-abr-2026) o no deduce. Es el producto de **Zumma/Fotofacturas**. | ❌ fase 2+ (¿integrar Zumma?) |
| 2.7 CFDI de cruces TAG | IAVE/PASE/TeleVía **sin API**. Palanca robusta: **ingesta por correo** del CFDI mensual (TeleVía postpago lo manda por email), no scraping. | ❌ fase 2 (email) |
| 2.8 POD (evidencia entrega) | Foto sello/firma → Visión. | ✅ |
| 2.9 Odómetro/litros | Foto tablero/bomba → Visión (o telemetría). | ⚠️ |
| 2.10-2.11 Efectivo reparto / incidencias | Conversacional. **Reparto NO se construye para el 6** (blueprint). | ❌ |

### Fase 3 — Liquidación
| Paso | Qué | Factib. |
|---|---|---|
| 3.1 Cerrar viaje + agrupar | Código. | ✅ (hecho) |
| 3.2 Clasificar por concepto/CC | Visión + Código. | ✅ (hecho) |
| 3.3 Duplicados | Mismo UUID/monto/fecha. | ✅ (hecho, ver bug en AUDIT.md: no infle total) |
| 3.4 Cuadrar vs política | Código. | ✅ (hecho) |
| 3.5 Conciliar diésel | litros vs km vs baseline; **alerta si desviación >15%**. Reglas: carga>capacidad tanque, sobreprecio vs zona, suma>esperado. | ✅ **construir para el 6** |
| 3.6 Saldo | anticipo − comprobado. | ✅ (hecho) |
| 3.7 Anomalías | caseta esperada faltante (usa 1.3 cacheado), ticket fuera de ruta, horario imposible. | ✅ (parcial, para el 6) |
| 3.8 Escribir al operador | Conversacional. | ✅ (hecho) |
| 3.9 Aprobar/rechazar | Humano en interfaz + niveles de autorización. | ⚠️ |
| 3.10 PDF | Código. | ✅ (hecho) |

### Fase 4 — Fiscal y contable
| Paso | Qué + ley | Factib. |
|---|---|---|
| 4.1 Validar Carta Porte | API SAT (igual que 2.4). | ✅ |
| 4.2 Descarga masiva CFDI | Web service SAT, **requiere e.firma del cliente** (identidad fiscal completa → riesgo legal/seguridad). **Async: 72h-2 semanas** desde 2025 (no tiempo real). | ❌ fase 3 |
| 4.3 Deducibilidad/IVA | Motor de validación (ver §3). Diésel en efectivo = **NO deducible sin importar monto**; requiere **Complemento Hidrocarburos**. | ⚠️ (motor, para el 6 versión básica) |
| 4.4 Póliza contable | Cargos/abonos cuadrados + código agrupador SAT + centro de costo. | ✅ (construir) |
| 4.5 Subir al ERP | **Escalón 0 = archivo:** CONTPAQi TXT posicional / XLSX; Aspel COI Excel con `FIN_PARTIDAS`. **NO API (fricción TI 3-6 meses).** ⚠️ **Confirmar qué ERP usa cliente_demo ANTES de escribir el layout.** | ⚠️ (archivo, pend. ERP) |

### Fase 5 — Tesorería
| Paso | Qué | Factib. |
|---|---|---|
| 5.1 Dispersar saldo | STP API. **No es de Cuadra.** | ❌ |
| 5.2 Descuento a nómina | **PELIGRO LEGAL (LFT art. 110):** solo con convenio firmado, ≤1 mes salario, ≤30% del excedente del mínimo, nunca sobre el mínimo. **Cuadra calcula/documenta/propone; NUNCA ejecuta el descuento.** | ⚠️ (solo cálculo+guardarraíles) |
| 5.3 Reponer anticipo | API. No es tuyo. | ❌ |
| 5.4 Conciliación bancaria | **Open banking NO existe regulado en MX (2026).** Usar ledger nativo de STP, o computer-use (frágil). | ❌ fase 2 |

### Fase 6 — Inteligencia
| Paso | Qué | Factib. |
|---|---|---|
| 6.1-6.5 km/L, costo/km, ranking operadores, patrones, tabulador recalibrado | Código + LLM. Base en `analytics.ts`. | ⚠️ (incremental) |
| 6.6 Reporte al director por WhatsApp | Conversacional. **Quick win alto impacto.** | ✅ |

---

## 3. Motor de validación fiscal (el diferenciador — §4.3)
Por cada CFDI, validar y marcar lo NO deducible / IVA no acreditable:
- **Vigencia:** UUID no cancelado + emisor no EFOS (ConsultaCFDIService).
- **RFC receptor** == empresa (no el chofer).
- **Diésel:** pagado con medio bancarizado/monedero (efectivo = NO deducible, sin importar monto) + **Complemento Hidrocarburos** presente + permiso CNE válido. Monedero: requiere Complemento ECC.
- **Casetas:** CFDI con IVA 16% desglosado; marcar cruces con TAG para el **estímulo 50% peaje** (requiere pago electrónico).
- **Viáticos:** topes 2026 (alimentación $750/día nacional, hospedaje sin límite nacional con CFDI, auto $850/día); alimentación pagada con tarjeta; fuera de 50 km.
- **IEPS diésel:** contemplar acreditamiento (estímulo LIF 2026) como cuenta separada en la póliza.

---

## 4. 🚩 Banderas rojas (verificar antes de construir)
1. **Complemento Hidrocarburos** obligatorio desde 24-abr-2026 — el CFDI de combustible sin él NO deduce. Verificar versión vigente.
2. **Carta Porte 3.1** — instructivos cambian; el portal del SAT es la fuente de verdad (rechazó conexión en la investigación; revalidar).
3. **Descuento a nómina** — campo minado LFT art. 110. Cuadra documenta, NO ejecuta. Confirmar con abogado laboralista.
4. **e.firma (descarga masiva)** — custodia de la identidad fiscal completa del cliente. No tocar sin política de seguridad + consentimiento explícito.
5. **Portales sin API** (gasolineras, TAG, SICT, banco) cambian HTML sin aviso → computer-use es deuda de mantenimiento perpetua. Preferir tabla cacheada (casetas) e ingesta por correo (TAG).
6. **ERP de cliente_demo: DESCONOCIDO.** No escribir un layout de póliza sin confirmar CONTPAQi vs Aspel vs otro (construir para el ERP equivocado = 3 días tirados).

---

## 5. PLAN DE BUILD PARA EL 6 DE AGOSTO (13 días) — solo lo ✅, en orden
Todo determinístico/API, sin computer-use ni e.firma. Cada uno súbele valor al demo:

1. **Validación de CFDI vs SAT** (`cfdi.ts` + nuevo `sat.ts`): consultar ConsultaCFDIService → Vigente/Cancelado + EFOS. Cachear. Integrar al flujo OCR (marcar factura cancelada/EFOS). *(3-5 días)*
2. **Verificación RFC receptor** == empresa. *(1 día)*
3. **Conciliación de diésel** (`cuadre/diesel.ts`): catálogo de unidades (placa→rendimiento base→capacidad tanque); `litros_esp = km/rendimiento`; alerta >15%; reglas carga>tanque, sobreprecio, suma>esperado. Añadir sus diferencias al motor. *(3-4 días)*
4. **Casetas esperadas** (tabla cacheada Silao–Laredo) → detección "caseta esperada sin comprobante" (3.7). *(2 días)*
5. **Motor de validación fiscal básico** (§3): forma de pago, complemento hidrocarburos presente, topes viáticos. Marcar no-deducible. *(2-3 días)*
6. **Póliza + export CONTPAQi/Aspel** — SOLO tras confirmar el ERP de cliente_demo (paso de campo). Si no se confirma a tiempo, dejar el CSV actual. *(2-3 días)*
7. **Fix del bug de duplicados** (AUDIT.md) + **fallback real de modelos** (AUDIT.md) — bloqueantes del demo. *(2 días)*
8. **Reporte al director por WhatsApp** (6.6) — quick win. *(1 día)*
9. Endurecer el **simulador `/demo`** con el escenario guionado (una diferencia clara + diésel + caseta faltante).

**Resultado el 6:** WhatsApp → OCR → **validación fiscal SAT** → cuadre (política + **diésel** + **casetas**) → liquidación → PDF → **póliza ERP**. Es un salto grande sobre las 5 promesas, todo demo-able sin piezas frágiles.

## 6. Roadmap fase 2/3 (post-demo)
- **Fase 2:** emitir Carta Porte (PAC+CSD) · ingesta de CFDI de TAG por correo · conectores ERP por SDK/API (CONTPAQi Nube, Odoo) · telemetría (Wialon/Geotab) para odómetro real · cálculo+guardarraíles de descuento a nómina · reparto/CEDIS (otro flujo).
- **Fase 3:** descarga masiva SAT con e.firma (conciliación batch) · auto-facturación de gasolineras (construir catálogo de portales o **integrar Zumma/Fotofacturas** — decisión producto vs plataforma) · conciliación bancaria.

## 7. Especificaciones técnicas (para implementar)
- **ConsultaCFDIService:** WSDL `https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?wsdl` · SOAPAction `http://tempuri.org/IConsultaCFDIService/Consulta` · input string `expresionImpresa` con `?re=..&rr=..&tt=..&id=..&fe=..` · respuesta: `Estado`, `EsCancelable`, `ValidacionEFOS`. Sin auth. (Ref: phpcfdi/sat-estado-cfdi.)
- **Diésel:** rendimiento base por unidad (config); `factor_carga ~0.75-0.80` cargado; umbral desviación 15% (amarillo) / 30% (rojo); precio zona (Profeco QQP).
- **CONTPAQi TXT:** registro `P` (encabezado: tipo, fecha yyyyMMdd, tipo póliza 1-4, folio, concepto, sistema "11") + registros `M` (cuenta sin guiones, tipo mov **0=cargo/1=abono**, importe 2 dec, centro de costo). También XLSX.
- **Aspel COI Excel:** datos desde A3; fila 3 encabezado (tipo, número en blanco, concepto, día); fila 4+ partidas (cuenta, depto, concepto, TC, cargo, abono, CC, proyecto); cerrar con `FIN_PARTIDAS`. Fecha DD/MM/AAAA; cuentas deben existir en el catálogo.
- **Casetas:** tabla `ruta → [caseta, clase_ejes, tarifa]` sembrada de Traza tu Ruta + tarifas CAPUFE.

> Fuentes completas y detalle en los 6 reportes de investigación (resumidos aquí).
> Reconfirmar montos de viáticos, cuota IEPS diésel y versión de complementos contra
> RMF/LIF 2026 antes de producción.
