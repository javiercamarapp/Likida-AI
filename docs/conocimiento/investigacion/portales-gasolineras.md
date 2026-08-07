# Portales de facturación de gasolineras en México — 61 marcas

**Fuente:** `gastosdeviaje.mx` (Focaltec), leída con navegador el 29-jul-2026.
Es el directorio marca → portal más completo que se encontró, y el único que da
la URL exacta en vez de la del sitio corporativo.

> **Focaltec también es competencia**: su producto es control de gastos de viaje
> con "Obtención de Tickets". Este directorio es su contenido de captación.

## Lo que esta tabla demuestra, y es lo que rompe el modelo por marca

**Cualli aparece CUATRO veces, con CUATRO portales distintos** — ArangoCorp,
Dagal, EfectiFactura y Megasur. La misma marca, cuatro sistemas según la región.
Si `comercios.ts` tuviera una entrada "Cualli" con un portal, estaría mal en tres
de cada cuatro tickets.

Y hay portales que solo existen así:

| Patrón | Ejemplos |
|---|---|
| **IP desnuda** | Fullgas `74.208.68.158:8060` · Permergas `201.99.114.19:9090` |
| **DNS dinámico** | Grupo Octano `octano9603.dyndns.org` · Gasoil `gasoilcorporativo.dyndns.org:8000` · Estaciones Ruta `grupoperc-wczttwhrtn.dynamic-m.com:8086` |
| **Puertos raros** | Megasur `:8085` · GASOMAX `:9400` · Servifácil `:3001` |
| **Hospedaje ajeno** | SEMAR 3994 en `azurewebsites.net` · GasoSur en `timexcard.com` |
| **Roto y admitido** | Grupo Gende: *"No funciona su portal de facturación 🙁"* |

Una IP desnuda con puerto no se puede reconocer por dominio ni sobrevive a un
cambio de proveedor. Para esos casos el único identificador estable del ticket es
el **permiso CRE**, que es por lo que vale la tabla CRE → marca.

## Plataformas multi-marca (aquí está el apalancamiento)

| Plataforma | Marcas que la usan |
|---|---|
| **EfectiFactura** | EfectiFactura, Cualli, **MOBIL** (`mobil.efectifactura.com`) |
| **ArangoCorp** | ArangoCorp, Cualli |
| **Dagal** | Dagal, Cualli |
| **Tu Gasolinería** | PEMEX, TOTAL (`tugasolineria.com/pemex`, `/total`) |
| **ControlNet** | ControlNet + (según otra fuente) Walmart, Alsea, OXXO |

## OJO: discrepancia con nuestra propia verificación

| | Esta tabla | Lo que facturamos |
|---|---|---|
| **Megasur** | `facturacion.megasur.com.mx:8085` | `megasur.com.mx:8029` ✅ |

Dos puertos distintos. **El nuestro está verificado timbrando un CFDI**; el de la
tabla puede ser una instancia vieja o de otra región. Gana el nuestro, y la
discrepancia queda anotada porque es la cuarta fuente que se equivoca sobre G500.

La Gas sí coincide: `facturacion.lagas.com.mx/autenticacion`.

## La tabla completa

| Marca | Portal |
|---|---|
| AmiGas | `gasolinerasamigas.com/facturacion.php` |
| ArangoCorp | `arangocorp.com.mx` |
| ASA (Aeropuerto CDMX) | `asa-recuperacion.clickfactura.mx` |
| BP Gasolineras | `gasolineriabp.com.mx/facturagasbpme/` |
| Cexdai | `facturacion.cexdai.com` |
| Control Gas | `atio.com.mx/estacionesFE/Default.aspx` |
| ControlNet | `controlnet.com.mx/NetInvoice` |
| CorpoGas | `facturasgas.com/ccgen/autofactura.php` |
| Cualli (ArangoCorp) | `arangocorp.com.mx` |
| Cualli (Dagal) | `dagal.com.mx/servicios/prefacturador/` |
| Cualli (EfectiFactura) | `efectifactura.com` |
| Cualli (Megasur) | `megasur.com.mx` |
| Dagal | `dagal.com.mx/servicios/prefacturador/` |
| EfectiFactura | `efectifactura.com` |
| eRFC | `erfc.com.mx` |
| Estaciones Ecológicas | `ecologicas.com.mx/facturacion/` |
| Estaciones Ruta | `grupoperc-wczttwhrtn.dynamic-m.com:8086/perc/` |
| FacturaGAS (App) | `facturagas.net/#facturar` |
| Fullgas | `74.208.68.158:8060` |
| G500 | `g500network.com/#facturacion` |
| Gas Manager | `gasmanager.com/factura/` |
| Gasfar | `gasfar.com/#facturacion` |
| Gasofac | `gasofac.com.mx` |
| Gasolineras Eficientes | `gefactura.com/fe/Facturas` |
| Gasomarshal | `facturaweb.gasomarshal.biz/v3/` |
| GASOMAX | `clientes.gasomaxgp.com.mx:9400/ES-AFWeb/` |
| Gasomex | `gasomex.mx/facturacion.html` |
| Gasopolis | `gasopolis.com/facturacion.php` |
| GasoSur | `timexcard.com/gasosurfacturacion/facturacion.aspx` |
| Grupo Cyma | `grupocyma.com.mx/facturacion.php` |
| Grupo Gasolinero Peñasco (GGP) | `gasolinasggp.com.mx/estaciones-de-servicio.htm` |
| **Grupo Gende** | ⚠️ *portal de facturación NO funciona* |
| Grupo Octano | `octano9603.dyndns.org/bajatufactura/` |
| Hidrosina | `facturacionelectronica.hidrosina.com.mx/FacturacionTranseunte/` |
| **La Gas** | `facturacion.lagas.com.mx/autenticacion` ✅ verificado |
| LodemoRed | `fact.lodemored.net` |
| MAAC | `crm.maacsa.com` |
| **Megasur** | tabla: `facturacion.megasur.com.mx:8085` · **verificado: `megasur.com.mx:8029`** |
| MiGasolina | `migasolina.mx/facturacion/` |
| MOBIL | `mobil.efectifactura.com` |
| OLEUM (Gasocentro) | `oleum.com.mx` |
| Operadora Gasoil | `gasoilcorporativo.dyndns.org:8000/facturacion/` |
| Orsan | `facturacion.orsan.com.mx/NuevaFacturacion/Orsan/Login` |
| Oxxo Gas | `facturacion.oxxogas.com` |
| Permergas (CDMX) | `201.99.114.19:9090/df/` |
| Permergas (Toluca) | `201.99.114.19:9090/toluca/` |
| Petro 7 | `tarjetapetro-7.com.mx/ControlgasFE_new/` |
| PETROL | `s1.adfsa.com.mx/facturacion/facturacionpetrol/` |
| Poligas | `poligas.com.mx` |
| RedGasolín | `redgasolin.com.mx/Facturacion.html` |
| Repsol México | `repsol.com.mx/es/estaciones-servicio/facturacion-electronica/` |
| SAGAS / Sistemas Pro | `sistemaspro.mx/efactura/` |
| SAIGSA | `mifacturadegasolina.com.mx` |
| SEMAR 3994 | `semar3994.azurewebsites.net` |
| Servifácil | `servifacil.ecsmexico.com:3001/facturacionweb/welcome` |
| Shell México | `shell.com.mx/conductores/facturacion-electronica.html` |
| Top Gas | `topgasmexico.com/facturacion/` |
| TOTAL | `total.com.mx/estaciones-de-servicio/bonjour/facturacion` |
| Tu Gasolinería (PEMEX) | `tugasolineria.com/pemex` |
| Tu Gasolinería (TOTAL) | `tugasolineria.com/total` |

**Sin verificar salvo las dos marcadas.** El directorio es de 2020 con
actualizaciones; los puertos y las IPs son exactamente lo que cambia sin avisar.
