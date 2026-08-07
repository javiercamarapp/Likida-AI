# Plan de integración por PORTAL — 29-jul-2026

> **La unidad es el portal, no el comercio.** 118 comercios cosechados se
> resuelven con 86 portales, y el de más apalancamiento cubre 17 autopistas solo.
> Modelar por marca —13 entradas en `comercios.ts`, 86 en el catálogo de Clara—
> es multiplicar trabajo idéntico.
>
> | | Qué significa | ¿Se automatiza? |
> |---|---|---|
> | 🟢 **VERDE** | sin cuenta: basta el RFC y los datos del ticket | **sí, hoy** |
> | 🟡 **REGISTRO ÚNICO** | UNA cuenta de la flota, dada de alta una vez | sí, tras el alta |
> | 🔴 **CUENTA PERSONAL** | cuenta del titular, una por usuario | **no sin custodiar credenciales** |
>
> Nada de esto está verificado salvo las dos filas del final. Es material de
> investigación: cada portal se confirma facturando un ticket real.


## 🟢 VERDE · 76 portales, 20 de flota

**Éstos son la cuña**: mismo modelo que ya probamos con Megasur — del ticket al
UUID sin que nadie teclee una contraseña.

| Portal | Comercios | Plazo | Datos del ticket |
|---|---|---|---|
| `tarjetapetro-7.com.mx` | petro-7, petro-seven | — | — |
| `autozone.com.mx` | autozone | 30 días naturales desde la fecha | Número de folio de transacción, Fecha de compra, Monto t |
| `capufe.gob.mx` | capufe | 30 días naturales desde la fecha | Folio de transacción, Fecha del cruce, Monto del peaje,  |
| `facturacion.circlekmexico.com.mx` | circle-k | Mismo mes calendario de la compr | Folio de transacción, Número de tienda, Monto total, Fec |
| `dhl.com` | dhl | 30 días naturales desde la fecha | Número de guía (waybill), Fecha del servicio, Monto tota |
| `estafeta.com` | estafeta | 30 días naturales desde la fecha | Número de guía, Fecha del servicio, Monto total, RFC del |
| `fedex.com` | fedex | 30 días naturales desde la fecha | Número de guía, Fecha del servicio, Monto exacto, RFC de |
| `g500network.com` | g500 | Varía por estación; factura el m | Nombre de la estación y permiso CRE, Folio del ticket, R |
| `iave.capufe.gob.mx` | iave | 30 días naturales desde la fecha | Número de tag IAVE, Periodo de facturación, RFC del rece |
| `mobil.com.mx` | mobil | Varía por operador; factura el m | Operador de la estación, Número de ticket o folio, Estac |
| `www4.oxxo.com:9443` | oxxo | 7 días naturales desde la compra | Folio web (ID Web), Monto total, Fecha de compra, RFC de |
| `facturacion.oxxogas.com` | oxxo-gas | Mismo mes calendario de la carga | Folio de transacción, Fecha de carga, Monto total, Forma |
| `facturaelectronicagfa.mx` | primera-plus | Mismo mes calendario del viaje | Número de boleto o folio, Fecha del viaje, RFC del recep |
| `facturacion.shell.com.mx` | shell | 72 horas tras la carga (varía po | Permiso CRE de la estación, Folio del ticket, Número de  |
| `pase.com.mx` | tag-pase | 30 días naturales desde la fecha | Número de tag TAG PASE, Periodo de cruces, RFC del recep |
| `televia.com.mx` | televia | 30 días naturales desde la fecha | Número de tag TeleVía, Periodo de cruces, RFC del recept |
| `gasolineriabp.com.mx` | bp-gasolineras | — | — |
| `servicioaclientes.g500network.com` | g500-network | — | Folio, Web Id, Llenar el captcha |
| `facturacionelectronica.hidrosina.com.mx` | hidrosina | — | — |
| `migasolina.mx` | migasolina | — | Folio, Web Id, Llenar el captcha |

<details><summary>Los otros 56 verdes (no flota, por si un cliente los pide)</summary>

| Portal | Comercios |
|---|---|
| `alsea.interfactura.com` | alsea, burger-king, dominos, italiannis, pf-changs |
| `facturacion.walmartmexico.com.mx` | bodega-aurrera, sams-club, walmart |
| `tiendas3b.com.mx` | 3b |
| `50friends.pv1.mx` | 50-friends |
| `7-eleven.com.mx` | 7-eleven |
| `ado.com.mx` | ado |
| `aeromexico.com` | aeromexico |
| `benandfrank.com` | ben-and-frank |
| `e-facturate.com` | benavides |
| `bp.com` | bp |
| `facturaciondrive.caffenio.com` | caffenio |
| `facturacion.carlsjrmso.com` | carls-jr |
| `lacasadetono.mx` | casa-de-tono |
| `michedraui.com.mx` | chedraui |
| `cinepolis.com` | cinepolis |
| `citymarket.com.mx` | city-market |
| `comex.com.mx` | comex |
| `facturas.coppel.com` | coppel |
| `costco.com.mx` | costco |
| `facturacion.dequ.mx` | dairy-queen-mexico |
| `fahorro.com` | farmacia-del-ahorro |
| `farmaciasguadalajara.com.mx` | farmacias-guadalajara |
| `sanpablo.com.mx` | farmacias-san-pablo |
| `facturacion.gpupm.com` | farmacias-similares |
| `heb.com.mx` | heb |
| `homedepot.com.mx` | home-depot |
| `v2.dito.com.mx` | ikea |
| `izzi.mx` | izzi |
| `kfc.teagradece.mx` | kfc |
| `facturacion.krispykreme.com.mx` | krispy-kreme |
| `lacomer.com.mx` | la-comer |
| `chopo.com.mx` | laboratorio-chopo |
| `facturacion.littlecaesars.com.mx` | little-caesars |
| `facturacionclientes.liverpool.com.mx` | liverpool |
| `facturacionmcdonalds.com.mx` | mcdonalds |
| `facturacion.officedepot.com.mx` | office-depot |
| `facturacion.officemax.com.mx` | officemax |
| `posap.devlyn.me` | opticas-devlyn |
| `lux.mx` | opticas-lux |
| `facturacion.elpalaciodehierro.com` | palacio-de-hierro |
| `cfdi.esperanza.mx` | pastelerias-esperanza |
| `facturacion.simang8.com` | pastelerias-marisa |
| `facturaelectronica.sears.com.mx` | sears |
| `sodimac.com.mx` | sodimac |
| `soriana.com` | soriana |
| `facturacion.starbucks.com.mx` | starbucks |
| `facturacion.subway.com.mx` | subway |
| `mitelcel.com` | telcel |
| `timhortonsmx.com` | tim-hortons |
| `vivaaerobus.com` | viva-aerobus |
| `factura.volaris.com` | volaris |
| `zara.com` | zara |
| `facturasgas.com` | corpogas |
| `gasofac.com.mx` | gasofac |
| `goodpriceg.com` | goodprice |
| `facturacion.orsan.com.mx` | orsan-en-linea |

</details>


## 🟡 REGISTRO ÚNICO · 4 portales

| Portal | Cubre | Comercios |
|---|--:|---|
| `pinfrafacturacion.com.mx` | 17 | autopista-apizaco-huachinango, autopista-armeria-manzanillo, autopista-atlixco-jantetelco, autopista-ecatepec-piramides, autopista-libramiento-aguascalientes, autopista-mexico-la-marquesa, autopista-penon-texcoco, autopista-san-antonio-virreyes-teziutlan, autopista-san-martin-texmelucan-huejotzingo … |
| `operadoradelasultana.com.mx` | 1 | autopista-monterrey-nuevo-laredo |
| `facturacioncapufe.com.mx` | 1 | capufe |
| `circuitoexterior.mx` | 1 | concesionaria-mexiquense |

**PINFRA es el mejor cambio de esfuerzo por cobertura de todo el catálogo.**
Un alta de la flota (RFC, razón social, domicilio) y quedan cubiertas 17
autopistas de peaje con los MISMOS campos de ticket: caseta, fecha, número Id,
máquina, consecutivo, total, hora.


## 🔴 CUENTA PERSONAL · 6 portales

| Portal | Comercio |
|---|---|
| `amazon.com.mx` | amazon |
| `mercadolibre.com.mx` | mercado-libre |
| `netflix.com` | netflix |
| `rappi.com.mx` | rappi |
| `spotify.com` | spotify |
| `riders.uber.com` | uber |

Ninguno es de flota. **Zumma los declara fuera de alcance en su propio demo**,
y tiene clientes y equipo. Aquí el producto es el aviso, no la automatización.


---

## El orden

1. **Los 20 verdes de flota.** Sin credenciales, sin fricción legal. Ya está probado el patrón.
2. **PINFRA.** Un alta → 17 autopistas.
3. **Los tres sistemas de Pemex** — GORM (Brentec), FacturacionEstacion, FacturaGAS.
   Cubren la mayoría de las 8,000+ estaciones y **ningún directorio publica su
   estructura**: hay que verificarlos facturando.
4. **CAPUFE y Circuito Exterior**, el peaje que queda fuera de PINFRA.


## Lo único verificado por nosotros, facturando de verdad

| Portal | Ticket | Resultado |
|---|---|---|
| `megasur.com.mx:8029` · G500 sureste | folio 1000724 · $839.70 | 🟢 **basta el RFC** · UUID `B0800A68-8565-47D9-90E0-CDA7803C50E4` |
| `facturacion.lagas.com.mx` · La Gas / GES | folio 1670001331723 · $714.75 | 🔴 correo+teléfono+contraseña · folio BOW-2025008 |

Dos gasolineras del mismo estado, dos modelos opuestos, y **ninguno de los tres
directorios tenía bien ninguno de los dos**: Clara manda G500 a `g500network.com`
y el real es `megasur.com.mx:8029`. Por eso esta tabla es de dos filas y no de 86.


## Lo que falta, y por qué

`facturasfacil.com.mx` **bloquea el crawler** — devolvió cero en todas las tandas.
Queda su mapa (~250 páginas) con los nombres pero sin los portales. Es el que más
comercios de flota tiene que nadie más lista:

- **Gasolineras:** Fullgas, Proneg, Enerser, Novogas, Oktan, Rendichicas, COMBURED,
  KPetrom, Sunoco, Black Gold, US Fuel, Combu Express, GoMart, Yligas, Exelgas, x24,
  Fullok, SEMAR 3994, Grupo Lamol, Petro Figues, Calimax, Gemco, Grupo Sirago,
  Decomsa/Grupo Omega, El Florido, 7-24 Mix.
- **Casetas:** Golfo Centro, Guadalajara–Tepic, GMAutopista, Copexa, Fiarum,
  CMayab, Libramiento Toluca, Monterrey–Saltillo (CAMS), Concesionaria Mexiquense,
  Jala–Compostela, La Antigua, MRO Chihuahua, MROnoreste, Metlapil, Plan del Río,
  LIPSA, Arco Norte, OCACSA, Chamapa–La Venta.
- **Carga:** Castores, Paquetexpress, Deprisa, UPS.
- **Y páginas por SISTEMA, lo más valioso:** Brentec, ControlNet, Polcfdi,
  ParrotPOS, Omicrom, ICR — plataformas multi-comercio, o sea más apalancamiento.

El scrape individual sí funciona; hay que ir página por página o cambiar de proxy.
