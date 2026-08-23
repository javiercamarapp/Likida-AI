# Cómo compra diésel una flota mexicana — 14 modalidades y qué soporta Likida (23-ago-2026)

**Corrección de catálogo**: `c_FormaPago` es **05 = monedero electrónico**, 08 = vales de despensa,
28 = tarjeta de débito, 29 = tarjeta de servicios, 30 = aplicación de anticipos. El código de Likida
ya usa las correctas (`engine.ts:113`).

## Las 14 modalidades

| # | Modalidad | Comprobante | FormaPago | ¿Soportado? |
|---|---|---|---|---|
| 1 | **Monedero SAT autorizado** (Edenred, Efectivale, Sí Vale, Toka, Broxel, Pluxee, Shell, Total…) | CFDI **del emisor** con **Complemento ECC 1.2**; la gasolinera tiene PROHIBIDO facturar | 03 o 99 | **A medias — se pierden los litros** |
| 2 | Tarjeta de crédito empresarial | CFDI de la estación | 04 | ✅ |
| 3 | Tarjeta de débito de la empresa | CFDI de la estación | 28 | ✅ |
| 4 | Tarjeta de servicios/flotilla NO autorizada | CFDI de la estación | 29 | ✅, pero no la distingue de la 1 |
| 5 | **Crédito directo con la estación** | CFDI PPD + **REP al liquidar** | 99 → el REP | ❌ **el REP no se ingiere** |
| 6 | Efectivo del chofer con reembolso | CFDI, ticket o nada | 01 | ✅ y bien (matriz RFA 2.9) |
| 7 | Transferencia/SPEI | CFDI de la estación | 03 | ✅ |
| 8 | Cheque nominativo | CFDI de la estación | 02 | ✅ (excluido del estímulo de peaje) |
| 9 | **Diésel propio / tanque / granel** | CFDI de la distribuidora; el consumo por viaje NO genera comprobante | — | ❌ **no existe** |
| 10 | Vales de papel | — | 08 | ✅ correctamente excluidos (no cumplen LISR 27-III) |
| 11 | App/tarjeta de cadena (OXXO Gas, G500, BP…) | depende del padrón | 04/28/29/05 | ❌ no distingue |
| 12 | Ventanilla + factura después en portal | CFDI tardío | el del pago | catalogado, no automatizado |
| 13 | CFDI global (no pidió factura) | al público en general | — | tratado como falta de CFDI |
| 14 | Cuenta maestra de permisionario (RFA 2.4) | CFDI a nombre del contribuyente | 03 | ❌ no modelado |

## Cómo identifica el agente (de la señal más dura a la más blanda)
1. **¿Hay `ecc12:EstadoDeCuentaCombustible`?** → modalidad 1 sin ambigüedad. Ya se parsea
   (`cfdi_xml.ts:247-262`). El `Rfc` de cada línea es la **gasolinera real**, distinta del emisor.
2. **¿El RFC del emisor está en el padrón de monederos?** → confirma modalidad 1 aun sin complemento.
   **Hoy no existe esa lista**; el corpus ya trae 13 RFCs, y el SAT publica **dos listas en dos URLs
   que no coinciden** — hay que leer las dos más el padrón de no renovados.
3. **¿RFC en el padrón CRE?** (`permiso_cre.ts`, 12,625 permisos, 88%) → es estación.
4. **`TipoDeComprobante` + `FormaPago` + `MetodoPago`**: `P` = REP (libera el IVA de la modalidad 5);
   `I`+99 = crédito no pagado (ISR sí, IVA/IEPS todavía no); `I`+01 = efectivo → matriz RFA 2.9.
5. **`ClaveProdServ`**: 15101505 diésel (único con estímulo), 15101514/15 gasolinas.
6. Sólo si no hay XML: OCR — y hay que rotularlo como lectura de papel, no dato timbrado.
7. Por dónde entró: correo→`factura_proveedor`, WhatsApp chofer→gasto, portal→factura tardía.

**El caso mixto funciona sin configuración** porque la clasificación es POR COMPROBANTE, no por flota.
Sólo dos cosas son por flota: la elegibilidad RFA 2.9 y el denominador del 15% — que debe ser TODO el
combustible del ejercicio, **incluidas las cargas con monedero**. Un cliente mixto tiene un denominador
mucho mayor y **más margen de efectivo del que cree**: argumento de venta que hoy nadie le calcula.

## Los 6 errores caros
1. **6.1 — IEPS sobre tarjeta que no es de la empresa.** `ocr.ts:463` convierte cualquier "TARJETA"
   del ticket en `'04'`. La LIF 20-A-IV exige tarjeta *expedida a favor del contribuyente*. Si el
   chofer pagó con la suya y le reembolsaron, el estímulo NO procede. Falta el booleano
   `formaPagoDeXml` (M2.4) para que ningún veredicto de dinero se tome sobre OCR sin decirlo.
2. **6.2 — ⚠️ LA PREGUNTA ABIERTA MÁS IMPORTANTE.** El CFDI del monedero declara cómo la flota le
   pagó AL EMISOR, no cómo se pagó en la bomba. Si es crédito será `99` y `engine.ts:1185` **tira los
   litros de todo el mes**. Es la modalidad más limpia fiscalmente y la que más riesgo tiene de dar
   cero. **Verificar contra un ECC real ANTES de tocar código.**
3. **6.3 — Doble conteo.** El dedup compara `(uuid, orden)` o `concepto|folio|monto`. El ticket no
   trae UUID y su folio es el de la estación; la línea ECC trae el UUID del monedero. **Las llaves no
   se ven como copias** → la carga entra dos veces, se infla el viaje y se le cobra al chofer una
   diferencia que no existe. Regla que falta: si el RFC está en el padrón de monederos, el ticket es
   **evidencia operativa (litros, odómetro, hora), nunca un gasto**.
4. **6.4 — El IVA del crédito se pierde en silencio.** `engine.ts:1148` excluye bien el IVA del `99`
   citando LIVA 5-III… pero **no hay código que ingiera el REP**. El IVA sale y no vuelve nunca:
   16% del gasto de diésel, cada mes. Es el hueco donde el sistema hace lo correcto y aun así le
   cuesta dinero al cliente — más peligroso que un bug ruidoso.
5. **6.5 — Acreditar sin permiso CRE.** El motor avisa (`permiso_cre_no_verificable`) pero no verifica
   contra el padrón; y en el CFDI global el permiso vive en `NoIdentificacion`, no en `HidroYPetro`.
   Encadenado con CFF 111 Bis fr. VI, deducir diésel de un EFOS definitivo es **delito de 3 a 8 años**.
6. **6.6 — Prometer pesos de IEPS.** Cuota íntegra vs. disminuida difieren **3.5×**, la lectura está
   en disputa, y el criterio no vinculativo 1/LIF/PI fr. II alcanza a quien "asesore o participe" —
   o sea a Likida. `iepsAcreditable = 0` fijo y sólo litros en el PDF: **no revertir sin fiscalista**.

## Los huecos por cuántas flotas afectan
1. **Los litros del ECC se tiran.** `cfdi_xml.ts:87` parsea `cantidad` pero `cfdi_consolidado_linea`
   (mig. 0076) **no tiene columna de litros**. Afecta a toda flota con monedero — las medianas y
   grandes, donde el estímulo vale más. Hoy obtienen conciliación y **cero litros acreditables**.
   Es una columna y un mapeo: **el mejor esfuerzo/dinero de toda la lista**.
2. **RMF 3.3.1.7 no se aplica en ningún lado** (sólo se menciona en el ROADMAP) → §6.3.
3. **Sin padrón de emisores ni vigilancia de la ficha 7/ISR.** La autorización se renueva con aviso
   **entre agosto y octubre** — estamos dentro de la ventana. Si el emisor cae, el cliente se queda
   sin comprobante deducible de combustible y nadie le avisa.
4. **`MetodoPago` no se parsea; REP: cero código** → §6.4.
5. **OCR no distingue medios de pago** (`ocr.ts:58` sólo admite efectivo/tarjeta/otro).
6. **Diésel propio sin modelo.** Entre 5 y 8 unidades cargando de tanque propio cruzan los
   **75,714 L/mes** de controles volumétricos (RMF 2.6.1.2 fr. VI b). Multas CFF 81/82 fr. XXV hasta
   **$5.6M más clausura**, con CFF 111 Bis penal encima. Muchas flotas están ahí sin saberlo.
7. `normas/liva-5.yaml` **no transcribe la fracción III** que el motor cita para decidir el IVA.
8. `normas/lisr-27-III.yaml` sigue en `evidencia_corroborante`, no leída en diputados.gob.mx.

También falta: el CHECK de `gasto.forma_pago` (mig. 0025:97) sólo valida `^[0-9]{2}$` —
**un `'77'` inventado por el OCR entra**. Y no hay equivalente de `desglose_peaje_linea` para el
estado de cuenta de un monedero en Excel/CSV: sólo el XML.

## Las 9 preguntas que debe hacer el onboarding
Hoy pregunta **dos booleanos** (`dedicacionExclusivaCarga`, `regimenElegible`) y nada más.
1. ¿Usan monedero? ¿Cuál? → capturar **el RFC del emisor**, no la marca. Es la pregunta de
   calificación #1: define si el pitch es "conectamos tu monedero" o "te salvamos el 15%".
2. ¿A qué correo llega el CFDI mensual del monedero, y lo pueden reenviar? → convierte la
   integración #1 en una regla de reenvío (ya hay buzón por token).
3. ¿Tienen crédito con alguna estación? → activa la espera del REP.
4. ¿Tanque propio? ¿Cuántos litros al mes? → el umbral de 75,714 L. Pregunta de exposición.
5. Cuando el chofer paga en la bomba, ¿con qué paga? → "tarjeta suya" tumba el IEPS y ningún
   ticket lo revela.
6. ¿Las tarjetas están a nombre de la empresa? → requisito literal de LIF 20-A-IV.
7. ¿Qué proporción es carretera vs. ruta corta? → calibra el denominador del 15%.
8. ¿Cargan en alguna cadena? → mapea a portales (GORM, FacturacionEstacion, FacturaGAS cubren la
   mayoría de las 8,000 estaciones Pemex) y a plazos de 24-72 h.
9. ¿Ingresos anuales bajo o sobre $300M? ¿Parte relacionada? → condición que hoy nadie verifica
   antes de aplicar el estímulo de peaje.

Y una que el sistema debe **contestarse solo, no preguntar**: si el emisor de monedero declarado
renovó su autorización este año.
