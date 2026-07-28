# Índice del paquete de conocimiento de Likida

> 11 investigaciones + 2 pasadas de verificación, cerradas el **27 de julio de 2026**.
> Todo se levantó contra fuentes primarias (DOF, diputados.gob.mx, sat.gob.mx, periódicos oficiales estatales).
> Lo que no se pudo leer en fuente está marcado **SIN VERIFICAR** dentro de cada archivo.

**Empieza por `00-RESUMEN-EJECUTIVO.md`.** Este índice es para volver después, cuando busques un dato concreto.

---

## Los archivos

| # | Archivo | Qué contiene | Cuándo abrirlo | Lo más valioso que hay adentro |
|---|---|---|---|---|
| 00 | `00-RESUMEN-EJECUTIVO.md` | Síntesis: 10 cosas que cambian el producto, límites de promesa, correcciones, ruta de construcción, riesgos y pendientes | Primero, y antes de cada decisión de producto o de pitch | La lista de lo que NO se puede prometer |
| 01 | `01-cfdi-cff.md` | CFDI 4.0 y Código Fiscal: requisitos, plazos, cancelación, factura global, prácticas indebidas, conciliación de factura, cómo validar de verdad | Cuando toques emisión, validación o cancelación de comprobantes | El plazo real para pedir factura (es el ejercicio fiscal, no 30 días) y el web service público de validación del SAT |
| 02 | `02-carta-porte.md` | Complemento Carta Porte 3.1: vigencia 2026, obligados, excepción de 30 km, los 37 datos mínimos y quién aporta cada uno, sanciones | Cuando diseñes el clasificador "¿este viaje necesita CCP?" o el módulo de viajes | El Apéndice 3 del Instructivo: 19 datos los da el cliente, 18 el transportista, y la responsabilidad se parte por dato |
| 03 | `03-isr-facilidades.md` | ISR, deducciones y RFA 2026 (DOF 17-feb-2026) regla por regla: 8% ciego, 15% de combustible en efectivo, exclusividad del 90% | Cuando calcules ahorro, deducibilidad o des de alta un cliente | El 8% cuesta 16% de ISR definitivo y tiene 3 topes; para PF chicas es pérdida, no ahorro |
| 04 | `04-iva-ieps-estimulos.md` | IVA acreditable, estímulo de IEPS al diésel y estímulo del 50% de casetas (LIF 2026 art. 20, RMF cap. 9.1) | Cuando construyas el motor de estímulos o cotices el ROI | La cuota de IEPS es semanal y varió 3.5x en 2026; el IEPS no viene desglosado en el CFDI y por ley no puede venir |
| 05 | `05-hidrocarburos.md` | Complemento `HidroYPetro`, listado L_CNE del Anexo 29, padrón público de la CNE, control volumétrico | Cuando parsees CFDI de diésel o valides al proveedor de combustible | El complemento va en `cfdi:ComplementoConcepto`, no en `cfdi:Complemento`; y la L_CNE es privada del PAC (no se puede replicar) |
| 06 | `06-estatal.md` | ISN estado por estado, tratamiento estatal de viáticos, retenciones por subcontratación, impuestos vehiculares | Cuando el cliente opere en más de un estado o preguntes por nómina | El viático mal comprobado además de perder ISR e IVA paga ISN (2%–4.25%); solo 13 de 32 tasas están verificadas |
| 07 | `07-no-fiscal.md` | SICT, permisos, licencias, seguros, NOM-068, NOM-087, NOM-012, régimen de tránsito 2026 y multas | Cuando modeles documentos de la unidad y del operador, o gastos por infracción | Toda multa federal se valida aritméticamente: monto = N × UMA ($117.31 en 2026) |
| 08 | `08-competencia.md` | Mapa del mercado en 5 capas + perfiles de Zumma, Clara, FacturaGPT, Fotofacturas y **Mendel** | Antes de escribir pitch, precio o landing | La tabla de "qué robarle a quién" y los 7 huecos que nadie cubre |
| 09 | `09-liquidacion.md` | Cómo se liquida un viaje hoy, el marco fiscal de cada peso del anticipo, el software que existe, y el proceso automático propuesto | Cuando definas el modelo de datos y la máquina de estados | Las 7 reglas duras, los 5 contadores acumulativos y la máquina de estados hasta `EN EXCEPCIÓN` |
| 10 | `10-handle-ai.md` | Handle AI: posicionamiento, anatomía de landing de 20 secciones, vocabulario, precios y sistema visual | Cuando escribas la landing o el guion de venta | El plano de landing sección por sección y el sistema visual sin color de marca |
| 11 | `11-datos-personales.md` | LFPDPPP vigente (DOF 20-mar-2025), consentimiento, oposición a decisiones automatizadas, nube, credenciales y ToS de portales | Antes de mandar un solo dato a un modelo o guardar una credencial | El semáforo verde/ámbar/rojo por portal y la decisión de arrancar SIN bóveda de credenciales |

---

## Todos los archivos tienen la misma estructura

1. **Resumen para el fundador** — 10 líneas, lo esencial.
2. Secciones numeradas con el detalle y las citas.
3. **Qué cambia esto en Likida** — lo accionable.
4. **SIN VERIFICAR** — lo que quedó abierto. Léelo antes de usar cualquier dato del archivo en material comercial.
5. **Fuentes** — con fecha de publicación y de consulta.

---

## Mapa rápido: si necesitas esto, abre esto

| La pregunta | Archivo |
|---|---|
| ¿Qué hace deducible un gasto? | 03 (ISR), 01 (requisitos del CFDI) |
| ¿Cómo valido un CFDI sin credenciales del cliente? | 01 §9, 11 §9 |
| ¿Este viaje necesita Carta Porte? | 02 §5 (radio de 30 km) |
| ¿Cuánto vale el estímulo del diésel esta semana? | 04 §3 (cuota disminuida semanal del DOF) |
| ¿Puedo prometer que valido contra el SAT en tiempo real? | 05 §3 (no, la L_CNE es del PAC) |
| ¿Qué pasa si el operador paga y la empresa le repone? | 03 (RMF 2.7.1.12), 09 §3 |
| ¿Diésel en efectivo es deducible? | 03 (regla 2.9: sí, hasta 15%), 04 (para el estímulo de IEPS: nunca) |
| ¿Qué gastos son viáticos y cuáles no? | 09 §3 (Grupo A vs. Grupo B) |
| ¿Qué me pueden multar y por cuánto? | 02 §9 (fiscal), 07 §10 (tránsito), 11 §12 (datos) |
| ¿Contra quién compito de verdad? | 08 (Mendel), 09 §4 (Uvicuo), 10 (Handle) |
| ¿Puedo entrenar modelos con los comprobantes del cliente? | 11 §4 (no sin consentimiento expreso o disociación) |
| ¿Cómo escribo la landing? | 10 §5 y §10 |

---

## Advertencias de uso

- **Vigencia:** todo está fechado a julio de 2026. Las tasas de ISN cambian cada diciembre, las multas se actualizan cada enero por miscelánea, y la cuota de IEPS cambia cada viernes. Nada de esto se hardcodea sin fecha de vigencia al lado.
- **Los archivos se contradicen en tres puntos.** Están identificados y resueltos en `00-RESUMEN-EJECUTIVO.md`, sección "Correcciones de los verificadores". No promedies: usa la versión corregida.
- **Numeración de anexos:** en la RMF 2026 las fichas de trámite pasaron del Anexo 1-A al **Anexo 2**, y los anexos de controles volumétricos del 30/31/32 al **21/22/23**. Todo material de referencia anterior a 2026 usa la numeración vieja.
