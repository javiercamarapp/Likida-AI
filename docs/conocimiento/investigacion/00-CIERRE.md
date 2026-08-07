# Investigación de competencia y portales — CIERRE

**29-jul-2026.** Cinco directorios cosechados por completo, más dos verificaciones
propias facturando CFDI reales. Ésta es la nota de cierre; el detalle vive en los
otros archivos de esta carpeta.

## Los números

```
1,993 páginas cosechadas   → 1,740 fichas de comercio (253 eran blog/glosario/autor)
319 portales distintos      → 267 sin cuenta · 52 con registro
5,228 pasos de proceso documentados
86 portales cubren MÁS DE UN comercio ← el apalancamiento
61 portales son de flota (combustible, peaje, transporte, refacciones)

4,015 estaciones con permiso CRE (28% de 14,301, sigue corriendo)
1510 marcas de gasolinera distintas
```

## HALLAZGO 1 — la unidad es el portal, y los datos lo demuestran cuatro veces

| Evidencia | Qué prueba |
|---|---|
| **Cualli usa CUATRO portales** (ArangoCorp, Dagal, EfectiFactura, Megasur) | la misma marca cambia de sistema por región |
| **1510 marcas en 4,015 estaciones** | la cola es de ~mil marcas; un catálogo por marca es inmantenible |
| **PEMEX es el 40%** y no tiene portal central | 8,000+ franquicias, cada una elige sistema |
| **Seis plataformas de PDV cubren ~890 comercios** | una integración toca cientos |

`comercios.ts` ya iba en esa dirección —`enerser` agrupa Efigas, Palmira y Bahía
Asunción— y en esta ronda pasó de 13 a 33 entradas modelando portales.

## HALLAZGO 2 — las plataformas de punto de venta son el apalancamiento real

| Comercios | Portal | Estado |
|--:|---|---|
| 315 | `facturamos.com.mx` | 🟢 sin cuenta |
| 308 | `nationalsoft-cloud.com` | 🟢 sin cuenta |
| 148 | `e-facpos.com` | ✅ verificado: selector de empresa |
| 57 | `pospac.mx` | 🟢 sin cuenta |
| 42 | `eos.zetus.mx` | 🟢 sin cuenta |
| 32 | `facturacioncapufe.com.mx` | 🟡 pide registro |
| 27 | `webportal.edicomgroup.com` | 🟢 sin cuenta |
| 24 | `facturacion.sevafusa.mx` | 🟢 sin cuenta |
| 19 | `facturacion.cmr.mx` | 🟢 sin cuenta |
| 16 | `alsea.interfactura.com` | 🟢 sin cuenta |
| 14 | `rapidofactura.com` | 🟢 sin cuenta |
| 12 | `facturacion.walmartmexico.com.mx` | 🟡 pide registro |

**`e-facpos.com` está verificado abriéndolo**: *"Portal de Autofacturación —
Seleccione la empresa de la cual desea generar su factura con su ticket de
consumo"*. Un selector de empresa: una integración, 148 comercios.

## HALLAZGO 3 — cinco "hallazgos" resultaron artefactos, y así se detectan

| Salía como portal de | Qué era |
|--:|---|
| 889 comercios · `facturaenlineamexico.com` | sitio hermano del mismo dueño, enlazado en la plantilla |
| 221 · `stats.g.doubleclick.net` | rastreador de Google |
| 158 · `static.wixstatic.com` | CDN de imágenes |
| 107 · `comofacturar.com` | otro directorio SEO |
| 98 · `rapidofactura.com` | otro directorio SEO |

Los cinco tenían la misma causa —fichas de blog, autor y glosario sin comercio
detrás, donde el extractor tomaba el primer enlace externo— y se filtraron uno
por uno hasta atacar la raíz: **una ficha sin comercio no puede aportar un
portal**. Con eso desaparecieron los cinco de golpe.

**La regla que queda: un portal que aparece en cientos de fichas es sospechoso
POR ESO MISMO, no interesante.** Costó cinco correcciones aprenderla.

## HALLAZGO 4 — el parque nacional de gasolineras

Con 4,015 estaciones leídas (permiso CRE → marca → ubicación):

| Marca | Estaciones | % |
|---|--:|--:|
| PEMEX | 1,533 | 38.7% |
| OXXO GAS | 76 | 1.9% |
| BP | 76 | 1.9% |
| G500 | 58 | 1.5% |
| PETRO SEVEN | 55 | 1.4% |
| CHEVRON | 45 | 1.1% |
| REPSOL | 43 | 1.1% |
| SHELL | 41 | 1.0% |
| ARCO | 40 | 1.0% |
| MOBIL | 15 | 0.4% |
| TOTALGAS | 14 | 0.4% |
| CIUDAD/MUNICIPIO | 14 | 0.4% |

**El permiso CRE viene impreso en el ticket** —el de G500 Megasur decía
`PL/22384/EXP/ES/2019`—, así que esta tabla convierte un dato del papel en la
identidad de la estación. Es el único identificador estable cuando el portal es
una IP con puerto, y eso pasa de verdad: Fullgas factura en `74.208.68.158:8060`.

## HALLAZGO 5 — la competencia, y dónde no puede seguirte

| Quién | Qué es | Su límite |
|---|---|---|
| **Clara** (`recuperafacturas.com`) | **confirmado: es Clara.com, la fintech de tarjetas** — `claraintelligence.ai` dice *"Home of Clara.com's AI"* | vende plástico; una flota que ya tiene banco no migra |
| **Zumma / Zummi** | WhatsApp + IA + equipo humano; Arcos Dorados, Italian Coffee | declara fuera de alcance los portales con cuenta personal |
| **FactuBot** | WhatsApp, pero le vende al COMERCIO para que sus clientes se autofacturen | wedge opuesto: no toca al comprador |
| **Focaltec** (`gastosdeviaje.mx`) | control de gastos de viaje con obtención de tickets | su directorio de 61 gasolineras es captación |
| **factura.com** | WhatsApp para EMITIR cuando tú vendes | dirección contraria, no compite |
| **dirind.com** | directorio de PACs (timbradores) | lado de la oferta de software |

**Ninguno tiene motor fiscal.** Todos entregan el papel; ninguno dice si el papel
sostiene la deducción. Zumma promete "hasta 95% de deducibilidad" y se refiere a
conseguir la factura, no a que el SAT la acepte.

## Lo verificado por nosotros: sigue siendo DOS

| Portal | Ticket | Resultado |
|---|---|---|
| `megasur.com.mx:8029` · G500 Sureste | 1000724 · $839.70 | 🟢 basta el RFC · UUID `B0800A68-8565-47D9-90E0-CDA7803C50E4` |
| `facturacion.lagas.com.mx` · La Gas | 1670001331723 · $714.75 | 🔴 correo+teléfono+contraseña · folio BOW-2025008 |

**Cuatro fuentes distintas tenían mal el de G500** — Clara lo manda a
`g500network.com`, el catálogo nuestro también, `gastosdeviaje` lo pone en el
puerto `:8085` y su índice dice "3 días" cuando el ticket dice mes de emisión.
Por eso esta tabla tiene dos filas y no 319.

## Qué NO se cosechó, y por qué

- **Estaciones CRE: al 27%.** Sigue corriendo; el script es reanudable
  (`node scripts/cosecha/estaciones.mjs`). El análisis ya está saturado —Pemex al
  40%, cola de mil marcas— lo que falta es cobertura de la tabla de búsqueda.
- **107 fallos** de las primeras tandas, casi todos timeouts. Una segunda pasada
  recupera la mayoría.
- **`dirind.com`**: descartado a propósito, es el lado de la oferta.
- **Los campos del ticket** salen como cadena sin separar en muchas fichas
  (`"Código de Facturación Folio Rfc"`). Legible para investigación; hay que
  partirlos antes de usarlos en un prompt.
