# Cosecha del blog de Pulpo (getpulpo.com) — facturación y fiscal de flotas

> Cosechado el **15-ago-2026** desde el sitemap oficial (`getpulpo.com/sitemap.xml`): **124 artículos** en el blog,
> **18 leídos a fondo** por ser fiscales/de facturación o adyacentes. Las fechas son el metadato de publicación
> de cada página (donde consta).
>
> **Regla de uso:** TODO lo de este archivo es **fuente secundaria de un competidor con interés comercial**
> (Pulpo vende PulpoPay). Mismo tratamiento que las cifras de Clara en `normas/politica-portales-plazos.yaml`:
> sirve como pista y como insumo de catálogo, nunca como fundamento fiscal. Donde Pulpo contradice una ficha
> de `normas/` con fuente primaria, manda la ficha — las contradicciones están en la sección 5.

---

## Resumen para el fundador

1. **Lo más valioso no es fiscal, es operativo:** Pulpo publicó en jul-2026 seis guías por gasolinera (BP, G500, Mobil, OXXO Gas, Petro Seven, Repsol) con el portal exacto, los campos que pide cada uno, el plazo y las trampas. Es exactamente el insumo que le falta al catálogo `facturacion/comercios.ts` para pasar más cadenas a `plazoVerificado` (previa verificación en el portal — ver §2).
2. **G500 exige facturar en 72 horas** — Likida ya lo tiene en `true` en el catálogo (leído de ticket); Pulpo lo confirma de forma independiente.
3. **Pulpo repite tres errores fiscales graves** (efectivo "nunca" deducible, IEPS "desglosado en el CFDI", regla de "50 km del domicilio fiscal" para gasolina). Los tres chocan con fichas de `normas/` verificadas en fuente primaria. Son el ángulo de contenido que Pulpo no puede sostener (§6).
4. **PulpoPay ya declara CFDI automático y factura única** en el blog (mar–jul 2026). La nota de `08-competencia.md` §"Pulpo" ("no declaran facturación automática de CFDI en su home") quedó atrás — actualizar el perfil.
5. **El modelo comercial de PulpoPay está desnudo en su propia guía:** 0% comisión por transacción vs. 2–4% de la competencia, ahorro total prometido de 4–22% (desglosado), piloto de 90 días con métricas. Es un molde de propuesta-con-ROI listo para adaptar.

---

## 1. Índice de artículos cosechados (los fiscales/de facturación)

| Artículo | URL | Fecha |
|---|---|---|
| BP Facturación: paso a paso | https://www.getpulpo.com/blog/bp-facturacion-guia | 23-jul-2026 |
| G500 Facturación: paso a paso | https://www.getpulpo.com/blog/g500-facturacion-guia | 18-jul-2026 |
| Mobil Facturación: paso a paso | https://www.getpulpo.com/blog/mobil-facturacion-guia | 23-jul-2026 |
| OXXO Gas Facturación: paso a paso | https://www.getpulpo.com/blog/oxxo-gas-facturacion-guia | 18-jul-2026 |
| Petro Seven Facturación: paso a paso | https://www.getpulpo.com/blog/petro-seven-facturacion-guia | 18-jul-2026 |
| Repsol Facturación: paso a paso | https://www.getpulpo.com/blog/repsol-facturacion-guia | 23-jul-2026 |
| CFDI de Gasolina: deducir el 100% | https://www.getpulpo.com/blog/cfdi-gasolina-deduccion-combustible-mexico | 21-abr-2026 |
| IEPS y deducción de gasolina | https://www.getpulpo.com/blog/ieps-y-deduccion-de-gasolina-en-mexico-como-sacarle-provecho | s/f |
| Tarjeta de gasolina vs efectivo | https://www.getpulpo.com/blog/tarjeta-gasolina-vs-efectivo-flotas | 30-abr-2026 |
| Fraude en combustible empresarial | https://www.getpulpo.com/blog/fraude-combustible-empresarial-como-prevenirlo | 30-abr-2026 |
| Guía completa de tarjetas de combustible | https://www.getpulpo.com/blog/guia-completa-sobre-las-tarjetas-de-combustible-en-mexico | 15-abr-2026 |
| Tarjetas de gasolina para empresas 2026 | https://www.getpulpo.com/blog/tarjetas-de-gasolina-empresas-mexico | 30-mar-2026 |
| Tarjeta de combustible: guía práctica (PulpoPay) | https://www.getpulpo.com/blog/tarjeta-de-combustible-para-empresas-en-mexico-guia-practica-para-ahorrar-y-controlar-el-gasto | 15-abr-2026 |
| Marcas de estaciones de servicio en México | https://www.getpulpo.com/blog/marcas-de-estaciones-de-servicio-en-mexico-cobertura-y-precios-por-marca | 30-abr-2026 |
| Tipos de gasolina en México | https://www.getpulpo.com/blog/tipos-de-gasolina-en-mexico | 23-jul-2026 |
| PulpoPay: cómo funciona | https://www.getpulpo.com/blog/pulpopay-tarjeta-combustible-flotas-mexico | 30-abr-2026 |
| Control de gasto en combustible | https://www.getpulpo.com/blog/control-gasto-combustible-flotas-guia | 30-abr-2026 |
| Impugnar una fotomulta (CDMX) | https://www.getpulpo.com/blog/sabias-que-tienes-derecho-a-impugnar-una-fotomulta-que-consideres-injusta | 15-ene-2026 (contenido de la era "DF", desactualizado) |

---

## 2. Destilado: cómo se factura en cada gasolinera (el insumo para `facturacion/comercios.ts`)

Todo esto es **dicho por Pulpo** (jul-2026). Antes de subir cualquier entrada a `plazoVerificado: true`
hay que leerlo en el portal o en un ticket real — la ficha `politica-portales-plazos.yaml` explica por qué.

| Cadena | Portal | Datos del ticket que pide | Plazo (según Pulpo) | Registro | Particularidades |
|---|---|---|---|---|---|
| **BP** | bp.com.mx → "Facturación electrónica" (BPme Web) | Código del ticket + estación | Mes natural (regla general) | Opcional ("Facturar sin Usuario") | PDF+XML al momento y por correo |
| **G500** | g500network.com → "Facturación en línea" | Folio, fecha, monto, **código CRE de la estación** | **72 horas** desde la compra | No indica | Varias facturas por sesión si son de la misma estación. Coincide con lo ya verificado en ticket por Likida |
| **Mobil** | mobil.com.mx → directorio de operadores | Nº ticket, nº estación, **hora de la compra**, y el **logo/razón social del operador** | Corte mensual | Según operador | **No hay un portal: hay uno por operador** (Orsan, CombuRed, Gasolín, TopGas, Policon, Gasislo…). El error nº 1 es facturar en el portal equivocado. El emisor del CFDI cambia entre estaciones Mobil |
| **OXXO Gas** | facturacion.oxxogas.com | Estación, nº ticket/folio, **monto exacto con centavos** | Mes natural | **Obligatorio** (no hay express) | CFDI en máximo 4 horas. **Portal geobloqueado fuera de México** (VPN corporativa = página en blanco). Alternativa: OXXO GAS App. +500 estaciones |
| **Petro Seven** | petro-7.com.mx/facturacion | Folio, fecha, monto exacto | Mes natural (carga del 28-jul vence el 31-jul) | Opcional (Factura Express) | **Geobloqueado fuera de México.** Petro-7 = Petro Seven = Grupo Petro 7 |
| **Repsol** | factura.repsol.com.mx | Folio + **Web ID** (código propio de Repsol) + estado y sucursal + captcha | Corte mensual | Opcional; app con QR | La app escanea el QR del ticket. Varios tickets de la misma estación por sesión |

**Patrones transversales que Pulpo documenta (todos plausibles, ninguno verificado por nosotros):**
- Todos piden datos de la Constancia de Situación Fiscal y validan contra CFDI 4.0 (razón social/régimen/CP distintos = rechazo).
- Uso del CFDI que recomiendan para combustible de flota: **G03 – Gastos en general**.
- Cada estación emite sus propias facturas: seleccionar la estación equivocada = folio inexistente.
- La regla operativa que Pulpo predica: **facturar cada semana**, nunca acumular al cierre del mes.
- El geobloqueo de OXXO Gas y Petro Seven importa para Likida: **un scraper/agente corriendo fuera de México no va a ver esos portales.**

**Qué cambia esto en Likida:** el catálogo de comercios puede crecer con `portalUrl`, `datosRequeridos`,
`registroObligatorio` y `geobloqueado` por cadena (hoy solo trae plazos). El caso Mobil pide un campo más:
`emisorVariable: true` (el RFC emisor cambia por estación aunque la marca sea la misma) — eso afecta
la conciliación CFDI↔ticket, porque cuadrar por "marca" es incorrecto en Mobil.

---

## 3. Destilado: lo fiscal que Pulpo afirma (y qué tan cierto es)

### 3.1 Deducibilidad del combustible
- **Pulpo:** "El SAT solo permite deducir combustible pagado con medio electrónico. Un ticket pagado en
  efectivo no es deducible aunque lo factures" — repetido en las 6 guías y en 3 artículos más.
- **Realidad (fichas de Likida):** cierto para el contribuyente general (`normas/lisr-27-III.yaml`,
  fuente primaria), **falso como regla absoluta para autotransporte de carga federal**: la RFA 2026
  regla 2.9 (`normas/rfa-2026-2.9.yaml`, DOF 17-feb-2026) permite hasta **15% del total de combustible
  en efectivo** conservando la deducción de ISR. La propia ficha lisr-27-III trae la advertencia:
  "NUNCA citar esta fracción sola…". Pulpo cae exactamente en ese modo de falla.
- Pulpo tampoco menciona nunca el requisito del **permiso de hidrocarburos vigente en el CFDI**
  (LISR 27-III segundo párrafo) — el control que Likida sí valida y nadie más vende.

### 3.2 IEPS
- **Cuotas 2025 que cita Pulpo:** diésel 7.09, Premium 5.45, Magna 6.45 MXN/litro (sin fuente; coinciden
  con las cuotas anuales publicadas). OJO: son las cuotas del art. 2o LIEPS, **no** la cuota disminuida
  semanal del estímulo que usa el motor de Likida (`04-iva-ieps-estimulos.md` §3).
- **Pulpo:** "el CFDI debe incluir IEPS desglosado; sin el desglose no puedes acreditarlo" / "con PulpoPay
  el IEPS queda desglosado para maximizar tu deducción".
- **Realidad (ficha de Likida):** `04-iva-ieps-estimulos.md` línea 11: **la ley prohíbe a la gasolinera
  desglosar el IEPS al consumidor** (LIEPS 19-II); el estímulo del diésel se calcula **litros × cuota
  disminuida semanal del DOF**, no leyendo el ticket. Lo de Pulpo es o error o atajo de marketing
  (su monedero probablemente lo *calcula*, no lo *lee del CFDI*).
- Lo que Pulpo sí dice bien: el acreditamiento IEPS es **solo diésel** (gasolina no se acredita, solo se
  deduce el gasto), en el mismo ejercicio, y **jamás con pago en efectivo** — coincide con `04` y con el
  límite anotado en `rfa-2026-2.9.yaml` ("el efectivo solo salva la deducción, no el estímulo").

### 3.3 Requisitos inventados o mal transplantados (ver §5, contradicciones)
- "Carga a **menos de 50 km de tu domicilio fiscal** para deducir al 100%" — no existe tal regla para
  combustible. Es la faja de 50 km de **viáticos** (LISR 28-V, `normas/lisr-28-V.yaml`) invertida y
  aplicada al dominio equivocado.
- "El vehículo no debe superar **175,000 MXN** (250,000 si es híbrido) para deducir la gasolina" —
  transplante del tope de deducción de **inversión en automóviles** (LISR 36-II); no condiciona la
  deducción de combustible y no aplica a camiones de carga.

### 3.4 Cifras comerciales que Pulpo cita (todas autodeclaradas, SIN VERIFICAR)
- Facturación manual falla en **30–60%** de los casos en flotas sin sistema.
- Flota de 20 vehículos con 300,000 MXN/mes de combustible "pierde hasta 54,000 MXN/mes" sin CFDI (18% — aritmética no explicada).
- Combustible = **25–35%** del costo operativo de una flota (en otro artículo: "hasta un tercio").
- Fraude = **10–25%** del gasto en flotas sin control; GPS+tarjeta lo reduce **80–95%** en 90 días.
- En pilotos de 90 días de PulpoPay "aflora **1–10%** de gasto irregular".
- Control manual en Excel: **15–30%** de tasa de error.
- Costo de un sistema de control: **160–400 MXN por vehículo/mes**, ROI < 60 días en flotas de 15+.
- Estas cifras riman con la que `32-fraude.md` ya trae de Pulpo vía Milenio (80% del fraude de flotilla
  es combustible; detección 95% automatizada vs 20% manual) — misma fuente interesada, mismo trato.

### 3.5 Modelo comercial de PulpoPay (para leerle el pitch)
- Monedero **prepago de red abierta** ("prácticamente cualquier gasolinera con terminal"; en otras piezas:
  "más de 14,000 gasolineras" y "PEMEX, BP y otras marcas seleccionadas" — **inconsistencia interna**:
  ellos mismos citan 12,903 estaciones totales en México según PetroIntelligence).
- Precio: **tarifa fija, 0% comisión por transacción**; atacan el modelo de 2–4% de comisión con la
  fórmula de punto de equilibrio G = F/c (con F=6,000 MXN y c=3% → conviene desde 200,000 MXN/mes de gasto).
- Promesa de ahorro **4–22%** = 2–4% (cero comisión) + 1–8% (mejor precio por red abierta) + 1–10% (fraude).
- Metodología de venta: **piloto de 90 días** con línea base de 30 días, métricas ($/km, km/l,
  incidencias/100 cargas) y cierre contra baseline. Antifraude en 3 capas: reglas duras → detección
  (cruce GPS/odómetro, "rendimientos imposibles") → evidencia (**foto + odómetro + ubicación + timestamp**).
- La "evidencia" de PulpoPay es lo que Likida ya captura por WhatsApp por diseño. El cruce GPS existe en
  esquema (`posicion`, `geocerca`) pero sin escritor.

### 3.6 Mercado gasolinero (datos con fuente nombrada, útiles para landing/contenido)
- **PetroIntelligence** (abr-2025): 12,903 estaciones, 277 marcas. Top: Pemex 8,697; Mobil 607; G500 487;
  BP 358; Valero 296; Chevron 239; Arco 237; Shell 214; Repsol 177; Gulf 103.
- **Profeco** (mar-2025, tope de 24 MXN/L en regular): cumplimiento Hidrosina 100%, G500/Rendichicas 96.6%,
  Pemex 86.7%, Valero 83.6% … Corpogas 71.7%, **Petro-7 37.7%, OXXO Gas 31%**.
- **Nacional Gasolinero** (9-sep-2025): promedio nacional regular $23.628, Premium $25.692, diésel $26.254.
- NOM-016-CRE regula la calidad de los tres combustibles; Magna 87 octanos, Premium 91+, diésel por cetano.

---

## 4. Tabla: qué es nuevo, qué ya tenemos, qué es solo marketing

| Pieza cosechada | Veredicto | Dónde vive / qué haría Likida con ella |
|---|---|---|
| Plazo 72h de G500 | **YA LO TENEMOS** | `facturacion/comercios.ts` (`plazoVerificado: true` por ticket); Pulpo lo confirma |
| Plazo legal = mes natural en portales | **YA LO TENEMOS** (con matiz superior) | `politica-portales-plazos.yaml`: el plazo LEGAL es el ejercicio; el del comercio es política privada. Pulpo presenta la política como si fuera la regla |
| Portales, campos, registro y geobloqueo por cadena (BP/Mobil/OXXO/Petro-7/Repsol) | **NUEVO — accionable** | Enriquecer el catálogo de comercios: `portalUrl`, `datosRequeridos`, `registroObligatorio`, `geobloqueado`. Fuente secundaria → verificar en portal antes de `plazoVerificado: true` |
| Mobil = emisor variable por operador (Orsan, CombuRed…) | **NUEVO — accionable** | Conciliación CFDI↔ticket: no cuadrar por marca; el RFC emisor cambia entre estaciones Mobil |
| Geobloqueo de OXXO Gas y Petro Seven | **NUEVO — accionable** | Cualquier verificación/scrape de esos portales debe correr desde IP mexicana |
| Uso CFDI G03 para combustible de flota | **YA LO TENEMOS** | `01-cfdi-cff.md` (requisitos CFDI); consistente |
| "Efectivo nunca deducible" | **CONTRADICCIÓN** | Ver §5.1 — `rfa-2026-2.9.yaml` (15% para carga federal) |
| "IEPS desglosado en el CFDI" | **CONTRADICCIÓN** | Ver §5.2 — `04-iva-ieps-estimulos.md` (LIEPS 19-II lo prohíbe) |
| "50 km del domicilio fiscal" para gasolina | **CONTRADICCIÓN** | Ver §5.3 — `lisr-28-V.yaml` (es de viáticos, y al revés) |
| Tope de valor del vehículo condiciona la gasolina | **CONTRADICCIÓN** | Ver §5.4 — LISR 36-II es de inversión en automóviles |
| Cuotas IEPS anuales 2025 (7.09/5.45/6.45) | **YA LO TENEMOS** (mejor) | `04` §3: el motor usa la cuota disminuida SEMANAL del DOF, que es la que vale dinero |
| Acreditamiento IEPS solo diésel, mismo ejercicio, nunca en efectivo | **YA LO TENEMOS** | `04-iva-ieps-estimulos.md`; `rfa-2026-2.9.yaml` (límite anotado) |
| Tipología de fraude (ficticio, particular, colusión, reventa) | **YA LO TENEMOS** | `32-fraude.md` §2.1–2.7 cubre lo mismo y más (casetas, viáticos) |
| Señales numéricas: consumo >20% sobre media del modelo, cargas fuera de horario/ruta, frecuencia > capacidad del tanque | **NUEVO — accionable (parcial)** | Umbrales candidatos para el motor de reglas; `litros_excede_tope_generico` ya existe; las de ruta/horario esperan escritor de `posicion`/`geocerca` |
| PulpoPay declara CFDI automático + factura única | **NUEVO — accionable** | Actualizar perfil Pulpo en `08-competencia.md` §"Pulpo" (la nota "no declaran CFDI automático" quedó vieja) |
| Pricing 0% comisión + fórmula de equilibrio + piloto 90 días | **NUEVO — solo marketing** | Molde para propuesta-con-ROI de Likida; no cambia producto |
| Evidencia foto+odómetro+timestamp como capa antifraude | **YA LO TENEMOS** (es el producto) | El flujo WhatsApp de Likida ES esa capa; útil como vocabulario de venta |
| Datos PetroIntelligence/Profeco/Nacional Gasolinero | **NUEVO — solo marketing** | Cifras citables (con su fuente) para landing/blog; no entran al motor |
| Estado de cuenta del monedero (ECC) como comprobante | **YA LO TENEMOS** (más profundo) | `00-OPORTUNIDAD.md` §17: para flota con monedero, la foto del ticket de diésel no sirve; Pulpo ni menciona el complemento ECC |
| Guías CAE, tacógrafo, tiempos de conducción | **N/A** | Regulación de España (Pulpo opera Madrid); no aplica a MX |
| Impugnación de fotomultas CDMX | **NUEVO — solo marketing (con cautela)** | El artículo de Pulpo está desactualizado (era "DF"); si se escribe, verificar el tribunal y plazos vigentes |

---

## 5. Contradicciones (no adoptar la versión de Pulpo)

### 5.1 Efectivo y deducción
- **Pulpo (6 guías + 3 artículos):** "El SAT solo permite deducir combustible pagado con medio electrónico.
  Un ticket pagado en efectivo no es deducible aunque lo factures."
- **Likida (fuente primaria):** `normas/rfa-2026-2.9.yaml` (DOF 17-feb-2026): dedicados exclusivamente al
  autotransporte de carga federal pueden pagar **hasta 15%** del combustible del ejercicio en efectivo y
  conservar la deducción (no el estímulo IEPS). `normas/lisr-27-III.yaml` trae la advertencia explícita
  contra la versión absoluta. Para el público general de Pulpo (flotillas de reparto) su frase funciona;
  para el cliente de Likida es falsa y le quita una deducción.

### 5.2 IEPS "desglosado en el CFDI"
- **Pulpo:** "El CFDI debe incluir IEPS desglosado explícitamente; sin desglose no puedes acreditarlo";
  "el IEPS queda desglosado para maximizar tu deducción" (claim de PulpoPay).
- **Likida (fuente primaria):** `04-iva-ieps-estimulos.md`: LIEPS 19-II **prohíbe** el desglose al no
  contribuyente del IEPS; el CFDI de la gasolinera no lo trae ni puede traerlo; el estímulo se calcula
  litros × cuota disminuida semanal (RMF cap. 9.1). Si un CFDI de diésel "trae IEPS desglosado", eso es
  una bandera de revisión, no un requisito cumplido.

### 5.3 Los 50 km
- **Pulpo (2 artículos):** "Carga el combustible en estaciones a menos de 50 km de tu domicilio fiscal
  para deducirlo al 100%."
- **Likida (fuente primaria):** no existe regla de distancia para deducir combustible.
  `normas/lisr-28-V.yaml`: la faja de 50 km es de **viáticos** y opera al revés — los viáticos solo son
  deducibles **fuera** de la faja de 50 km que circunda el establecimiento. Pulpo tomó la regla de
  viáticos, la invirtió y la aplicó a gasolina.

### 5.4 El valor del vehículo
- **Pulpo (2 artículos):** "el vehículo no debe superar 175,000 MXN (250,000 si es híbrido)" como
  requisito de deducción del combustible.
- **Realidad:** es el tope de deducción de la **inversión** en automóviles (LISR 36-II), con efecto
  proporcional sobre sus gastos (LISR 28-II) — aplica a automóviles, **no a camiones de carga**, y no es
  un requisito del combustible en sí. Likida no tiene ficha de 36-II (no la necesita para carga); si algún
  día entra el segmento de flotillas ligeras, abrir ficha antes de citar nada.

### 5.5 Menor: plazos presentados como regla fiscal
- **Pulpo:** "¿Cuánto tiempo tengo para facturar? Dentro del mismo mes natural" (como si fuera la norma).
- **Likida:** `politica-portales-plazos.yaml` — el plazo legal es **todo el ejercicio**; negar la factura
  por corte de mes es práctica indebida listada por el SAT, con remedio en la Conciliación de Factura.
  El corte mensual es política del comercio y así hay que nombrarlo. (La distinción es el momento de
  producto de Likida: "te aviso del corte del comercio Y te digo tu derecho legal".)

---

## 6. Qué le copiamos a Pulpo en contenido (los 5 temas, con el ángulo que ellos no pueden sostener)

El molde de Pulpo funciona: guía por gasolinera + FAQ + CTA al producto. SEO de cola larga
("facturar ticket [marca]") que captura al administrador de flota en el momento del dolor. Los 5 para Likida:

1. **"Cómo facturar tu ticket de [gasolinera] — y qué hacer si ya se te pasó el plazo."** Misma serie
   (BP, G500, OXXO Gas, Petro-7, Repsol, Mobil, + Pemex que Pulpo no cubrió), pero con el remate que Pulpo
   no tiene: el plazo del portal es política privada, **el derecho legal dura todo el ejercicio**, y existe
   la Conciliación de Factura del SAT. Pulpo no puede decirlo porque su producto vive de "el ticket vence".
2. **"Pagaste diésel en efectivo: cuándo SÍ es deducible (la regla 2.9 que tu tarjeta no te cuenta)."**
   El 15% de la RFA 2026 para carga federal, con el DOF citado. Pulpo no puede publicarlo: su pitch entero
   es "el efectivo nunca deduce". Es la pieza que más separa a Likida en su segmento real.
3. **"El IEPS de tu diésel NO viene en la factura — y está bien: así se calcula el estímulo de verdad."**
   LIEPS 19-II + cuota disminuida semanal del DOF + quién puede acreditar. Desarma el claim de "IEPS
   desglosado" de todos los monederos y posiciona el motor de Likida como el que calcula bien.
4. **"El CFDI de combustible que el SAT te va a tumbar: permiso de hidrocarburos, complemento y clave."**
   LISR 27-III (permiso vigente y no suspendido), RMF 2.7.1.48 (complemento HidroYPetro) y ClaveProdServ
   correcta — el control que Likida ya valida y que ni Pulpo ni Clara venden como control activo
   (`08-competencia.md` §7.2).
5. **"Tu flota usa monedero: la foto del ticket de diésel ya no te sirve (el ECC sí)."** El estado de
   cuenta del emisor con Complemento de Estado de Cuenta de Combustibles como el comprobante real
   (`00-OPORTUNIDAD.md` §17). Pulpo, siendo emisor de monedero, nunca educa sobre el ECC; Likida puede,
   porque no vende tarjeta — concilia lo que sea que use la flota.

Bonus de formato: la **calculadora de punto de equilibrio** (Pulpo la usa para comisiones) y el
**piloto de 90 días con línea base** son mecánicas de venta reutilizables en `propuesta-con-roi`.

---

## 7. Los artículos NO fiscales del blog (una línea cada uno)

**Producto Pulpo / comparativas:** `que-es-pulpo-y-por-que-deberia-ser-tu-software-de-gestion-de-flotas` (pitch PulpoFleet) · `que-es-pulpo-insights-y-por-que-debe-ser-tu-software-de-inteligencia` (módulo BI) · `pulpomatic-la-solucion-para-gestionar-tu-flota-de-manera-eficiente` y `sabes-todo-lo-que-te-ofrece-pulpomatic` (nombre viejo del producto) · `pulpo-movildata-integracion-telemetria` (partnership GPS España) · `software-gestion-de-flotas-guia` (guía-embudo 2026) · `software-para-control-de-vehiculos-adios-excel-hola-smartphone` (anti-Excel) · `vs-edenred`, `vs-toka`, `vs-competidores` están fuera del blog pero son landings comparativas que conviene mirar aparte.

**Combustible operativo (no fiscal):** `10-consejos-para-ahorrar-en-combustible` · `calculo-de-rendimiento-de-combustible-para-principiantes` · `como-sacar-el-rendimiento-de-combustible-en-la-gestion-de-tu-flota` · `sabes-como-calcular-el-rendimiento-de-tu-flota-de-vehiculos` · `pautas-para-el-correcto-control-y-consumo-de-combustible-en-la-gestion-de-flotas` · `control-de-combustible-por-que-es-tan-importante-para-la-operativa-de-una-flota` · `las-4-cs-para-empezar-una-bitacora-de-combustible` · `conviene-tener-una-planilla-de-excel-para-el-control-de-combustible` · `gps-telemetria-reducir-consumo-combustible-flota` · `vehiculos-a-gas-natural-una-opcion-mas-para-ahorrar-en-tu-flota-vehicular`.

**Mantenimiento:** `3-secretos-de-tener-una-bitacora-de-mantenimiento` · `4-factores-que-elevan-tus-gastos-de-mantenimiento` · `5-beneficios-del-mantenimiento-preventivo-en-los-vehiculos-de-empresa` · `como-planificar-los-tiempos-correctos-para-un-mantenimiento-efectivo` · `como-se-debe-hacer-el-mantenimiento-preventivo-de-una-flota-vehicular` · `guia-para-llevar-el-control-de-mantenimiento-preventivo-de-tu-flota` · `mantenimiento-correctivo-de-vehiculos-e-importancia-para-las-empresas` · `mantenimiento-preventivo-flotas-guia` · `mantenimiento-preventivo-y-correctivo-la-diferencia-esta-en-el-coste` · `plan-de-mantenimiento-preventivo-de-vehiculos-livianos` · `plantilla-de-excel-para-el-control-de-costes-de-mantenimientos` · `que-considerar-para-el-mantenimiento-de-camiones-y-pipas-de-agua` · `que-se-debe-comprobar-en-un-mantenimiento-preventivo-de-un-vehiculo`.

**Gestión de flota / KPIs / rol del gestor:** `gestion-de-flotas` (pilar) · `5-indicadores-clave-de-gestion-de-flota-vehicular-para-directivos-de-empresas-de-transporte` · `6-indicadores-clave-de-la-gestion-de-flota` · `6-indicadores-para-medir-el-rendimiento-de-tus-vehiculos` · `5-tips-para-mejorar-la-gestion-de-tu-flota-vehicular` · `las-10-mejores-practicas-en-la-gestion-de-flotas` · `gestion-de-flotas-problemas-mas-comunes-y-soluciones-para-el-gestor-de-flotas` · `que-datos-analizar-para-administrar-tu-flota-de-vehiculos` · `como-reducir-costos-flota` · `como-reducir-los-gastos-en-la-gestion-de-una-flota-de-vehiculos` · `consejos-para-controlar-y-reducir-costos-en-la-gestion-de-flotas-en-2025` · `costes-relacionados-con-la-gestion-de-flotillas` · `como-calcular-el-presupuesto-2022-para-tu-flota-de-vehiculos` · `como-elaborar-un-presupuesto-efectivo-para-la-gestion-de-flotas-de-vehiculos` · `que-es-el-analisis-tco-aprende-como-calcularlo` · `eficiencia-operativa-en-la-gestion-de-flotas` · `que-es-una-flota` · `que-es-una-flotilla` · `tipos-de-flotas-que-considerar-para-gestionarlas-segun-su-giro` · `que-es-fleet-manager` · `como-ser-el-mejor-gestor-de-flotas` · `conviertete-en-el-mejor-fleet-manager-y-domina-el-control-de-flotas` · `como-crear-el-perfil-de-puesto-para-un-gestor-de-flota` · `la-importancia-de-la-gestion-de-conductores-para-el-control-de-flota` · `gestion-renting-leasing-vehiculos-flotas` · `cual-es-la-mejor-manera-de-evaluar-tus-operaciones-internas` · `reticencia-al-cambio-en-una-organizacion-y-como-superarla` · `disminuye-las-cargas-de-trabajo-con-ayuda-de-la-tecnologia` · `5-caracteristicas-que-un-ceo-debe-tener`. (Varios traen el año en el slug — `presupuesto-2022`, `costos-2025` — el blog recicla SEO viejo sin actualizar.)

**GPS / telemetría / tecnología:** `que-es-la-telemetria-vehicular` · `telematica-vs-telemetria-diferencias` · `beneficios-software-gestion-flotas-telemetria` · `como-elegir-un-proveedor-de-gps-para-el-control-de-tu-flota` · `gps-para-flotas-como-elegir` · `como-integrar-gps-software-gestion-flotas` · `beneficios-de-asegurar-tu-flota-con-seguros-basados-en-el-uso-ubi` · `como-la-inteligencia-artificial-transforma-la-gestion-de-flotas` · `aplicaciones-del-machine-learning-en-la-logistica-y-el-transporte` · `las-6-ventajas-del-big-data-en-el-sector-del-transporte` · `6-niveles-de-automatizacion-de-vehiculos-los-conoces` · `vehiculos-autonomos-en-la-industria-del-transporte`.

**Logística / rutas:** `5-mejores-practicas-logisticas-para-las-empresas` · `optimizacion-rutas-flotas` · `sistema-de-optimizacion-de-rutas-5-claves-para-una-disrupcion` · `tips-para-planificar-tus-rutas-logisticas` · `como-optimizar-tus-rutas-de-reparto-con-google-maps` · `herramientas-y-tacticas-para-optimizar-tu-logistica-de-almacenaje` · `que-diferencias-hay-entre-la-logistica-y-el-supply-chain` · `que-es-logistica-inversa-y-cual-es-su-importancia-en-la-cadena-de-suministro` · `diferencia-entre-logistica-inversa-y-verde-en-el-medio-ambiente` · `desafios-y-oportunidades-de-la-logistica-inversa-en-la-era-digital` · `la-cadena-de-frio-recomendaciones-para-no-romperla` · `dia-mundial-de-la-logistica-conoce-los-tipos-que-la-componen` · `entregas-con-amor-logistica-detras-de-san-valentin`.

**Seguridad vial / conductores:** `5-sistemas-de-seguridad-activa-mas-utilizados-en-los-vehiculos` · `5-sistemas-de-seguridad-pasiva-mas-utilizados-en-los-vehiculos` · `6-habitos-para-mejorar-la-salud-de-los-conductores` · `la-importancia-de-la-postura-al-manejar` · `reducir-5-la-velocidad-de-manejo-reduce-la-cantidad-de-accidentes-mortales-en-un-30`.

**Excel / plantillas (lead magnets):** `configura-tu-plantilla-de-excel-para-el-control-de-kilometraje` · `excel-y-transporte-5-datos-clave-que-podemos-obtener-de-manera-inmediata` · `plantilla-excel-y-transporte-los-articulos-mas-leidos` · `7-tips-para-una-gestion-de-documentos-eficiente` · `gestion-de-documentos-en-la-logistica-4-0-y-ventajas-de-la-digitalizacion`.

**España (no aplica a MX):** `cae-certificados-ahorro-energetico-flotas` y `cae-preguntas-frecuentes-guia-completa` (Certificados de Ahorro Energético: monetizan el ahorro de combustible — modelo interesante, regulación española) · `tacografo-inteligente-obligatorio-2026` · `tabla-tiempos-conduccion-descanso` · `como-analizar-los-costes-de-combustible-y-mantenimiento-de-los-vehiculos`.

**Curiosidades:** `sabias-que-el-primer-coche-fue-electrico` · `sabias-que-las-direccionales-y-la-luz-de-freno-las-invento-una-mujer`.

---

## SIN VERIFICAR

- **Todos los plazos y campos de portales del §2** vienen del blog de Pulpo (jul-2026), no de los portales.
  Para subirlos a `plazoVerificado: true` hace falta leerlos en el portal o en un ticket, como se hizo con
  Office Depot y G500. El geobloqueo de OXXO Gas/Petro-7 implica hacerlo desde IP mexicana.
- **Todas las cifras del §3.4** (30–60%, 10–25%, 4–22%, etc.) son autodeclaradas por Pulpo sin fuente.
  No citarlas como estadística; a lo sumo como "un proveedor declara…", igual que hace `32-fraude.md`.
- Las fechas de publicación son metadatos de página (pueden ser fechas de re-publicación; el blog recicla
  contenido viejo — el de fotomultas habla del "Distrito Federal").
- La cobertura real de PulpoPay (¿14,000 estaciones? ¿solo "marcas seleccionadas"?) es inconsistente entre
  sus propios artículos; no usar ninguna de las dos versiones.

## Fuentes

- Sitemap: https://www.getpulpo.com/sitemap.xml (consultado 15-ago-2026; 124 URLs de blog).
- Artículos: las 18 URLs de la tabla del §1 (consultados 15-ago-2026).
- Cruce interno: `normas/lisr-27-III.yaml`, `normas/rfa-2026-2.9.yaml`, `normas/lisr-28-V.yaml`,
  `normas/politica-portales-plazos.yaml`, `docs/conocimiento/04-iva-ieps-estimulos.md`,
  `docs/conocimiento/32-fraude.md`, `docs/conocimiento/08-competencia.md` (§Pulpo y §7),
  `docs/conocimiento/00-OPORTUNIDAD.md` (§17 ECC).
- Fuentes terciarias que Pulpo cita y que valdría leer directo: PetroIntelligence (petrointelligence.com),
  Profeco (monitoreo de precios), Nacional Gasolinero.
