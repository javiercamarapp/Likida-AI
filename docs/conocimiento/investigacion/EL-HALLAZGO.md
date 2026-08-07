# El hallazgo de la investigación de competencia — 29-jul-2026

> Se cosecharon cuatro directorios de facturación mexicanos y el blog del
> competidor principal. La conclusión no es una lista de comercios: es que
> **el catálogo está modelado en la unidad equivocada.**

## La unidad correcta es el PORTAL, no el comercio

`comercios.ts` tiene 13 entradas, una por marca. Clara tiene 86, una por marca.
Los dos están mal por la misma razón, y se ve en los datos:

**Casetas.** De las 22 autopistas que se cosecharon con portal identificado,
**18 usan `pinfrafacturacion.com.mx`**. Autopista Monterrey–Nuevo Laredo,
Tlaxcala–Puebla, Ecatepec–Pirámides, Armería–Manzanillo, Atlixco–Jantetelco…
todas son concesiones distintas con el MISMO sistema de facturación. Modelar
122 casetas es escribir 122 veces la misma integración.

**Gasolineras.** El blog de Zumma —el competidor con clientes— ya escribe por
portal, no por marca. Su propio título lo dice: *"¿Cómo facturar un gasto de
gasolinera que use el portal Enerser?"*, y enumera dentro *"Servicio Efigas,
Autoservicio Palmira, Bahía Asunción"*. Tres marcas, un portal, un tutorial.

**Y Pemex es el caso extremo.** No tiene portal centralizado: son 8,000+
estaciones en franquicia y cada franquiciatario elige su sistema. Los tres que
concentran el mercado, según `gasolinerasmx.mx`:

| Sistema | Patrón de URL | Quién lo usa |
|---|---|---|
| **GORM** (Brentec) | `gorm.gasolinamexico.net/facturacion_[nombre]` | grupos medianos y grandes |
| **FacturacionEstacion** | `[nombre].facturacionestacion.com` | El Roble, Los Pinos, La Morena |
| **FacturaGAS** | `app.facturagas.net` | independientes, con selector de estación |

Tres integraciones cubren la mayoría de las 8,000 estaciones Pemex. Trece
entradas de marca cubren trece marcas.

## Lo que esto cambia en el plan

**Antes:** "hay que catalogar 86 comercios para competir con Clara". Meses de
trabajo, siempre por detrás.

**Después:** los portales que de verdad hacen falta para una flota son del orden
de **una docena**, y cada uno cubre decenas o miles de puntos de venta:

```
PINFRA                pinfrafacturacion.com.mx        ~18+ autopistas de peaje
CAPUFE                facturacioncapufe.com.mx        red federal
Circuito Exterior     circuitoexterior.mx             CDMX
GORM (Brentec)        gorm.gasolinamexico.net/…       Pemex franquicias
FacturacionEstacion   [nombre].facturacionestacion.com Pemex franquicias
FacturaGAS            app.facturagas.net              Pemex independientes
Megasur / G500 SE     megasur.com.mx:8029             G500 sureste  ← ya verificado
OXXO Gas              facturacion.oxxogas.com         cadena
Shell                 facturacion.shell.com.mx        cadena
BP                    gasolineriabp.com.mx            cadena
Hidrosina             facturacionelectronica.hidrosina.com.mx
Petro-7 / Petromax    tarjetapetro-7.com.mx
```

Eso es alcanzable antes del segundo cliente. Ochenta y seis marcas no.

## Los plazos reales son mucho más cortos de lo que cree cualquiera

De `gasolinerasmx.mx`, verificado por ellos en abril de 2026 — **hay que
reverificarlo, pero el patrón importa**:

| Marca | Plazo | ¿Registro? |
|---|---|---|
| OXXO Gas | **48 horas** | obligatorio |
| Oktan | **el mismo día** | obligatorio |
| Rendichicas | **24 horas** | opcional |
| G500 | 24–72 h *(nuestra medición: mes de emisión)* | opcional |
| Shell / Pemex | 72 h (varía por estación) | varía |
| BP, Hidrosina, Novogas, Repsol, ARCO… | mismo mes | opcional |

Dos cosas que se leen aquí y valen para el producto:

1. **La discrepancia con nuestra propia medición de G500** (ellos dicen 24–72 h,
   el ticket y el portal dicen mes de emisión) confirma que estos directorios
   NO son fuente de verdad. Son pistas.
2. **Un plazo de 24–48 horas convierte el aviso en el producto.** Si OXXO Gas da
   dos días y el operador vuelve a base el viernes, el ticket del martes ya está
   muerto. Eso no lo resuelve facturar mejor: lo resuelve avisar el mismo día.

## La evidencia de que los portales se caen

Los comentarios de `facturaelectronicamexico.mx` son un registro público de
fallas. De la página de Monterrey–Nuevo Laredo, textual:

> *"TENGO TODO EL DIA TRATADO DE FACTURAR, YA LLAME Y ME DICEN QUE INTENTE EN
> OTRO HORARIO. PERO ES PURA MENTIRA."*
>
> *"buenas noches no puedo facturar mis tickes de monterrey nuevo ladero y las
> de michoacan"*

Cualquier automatización sobre estos portales necesita reintento, ventana de
mantenimiento y un camino de escape humano. No es un detalle de robustez: es la
mitad del trabajo.

## Los directorios cosechados

| Fuente | Tamaño | Qué aporta |
|---|---|---|
| `recuperafacturas.com` (Clara) | **86 fichas** | campos estructurados: portal, plazo, datos, ¿cuenta?, reimprimir |
| `facturaelectronicamexico.mx` | **1,259 páginas** · 122 casetas | portales reales, campos exactos del ticket, teléfonos, quejas |
| `gasolinerasmx.mx` | 25 marcas + 3 sistemas Pemex | la tabla de plazos y registro por marca |
| `facturasfacil.com.mx` | cientos | gasolineras y casetas regionales que nadie más lista |
| `facturacion-ticket.com.mx` | 35 tiendas | 23 con facturación asistida |
| `zummafinancial.com/blog` | 11 páginas de índice | **tutoriales POR PORTAL**, no por marca |

Datos crudos: `comercios-clara.json`, `portales-casetas-gasolineras.json`,
`catalogo-clara.md`.

## Lo que NO se hizo, y hay que decirlo

- De las 1,259 páginas de `facturaelectronicamexico.mx` se cosecharon **32**.
  Se priorizó casetas y gasolineras; el resto (restaurantes, ropa, farmacias)
  no aporta a una flota de carga.
- Las páginas de `facturasfacil.com.mx` y `rfacturacion.com` **no se
  cosecharon**, solo se midieron. Ahí están las gasolineras y casetas
  regionales (SEMAR, COMBURED, Copexa, GMAutopista, Caseta La Antigua).
- **Nada de esto está verificado.** La única ficha verificada del repo es G500,
  y se verificó facturando un ticket real. Ver `plazoVerificado` en
  `comercios.ts`.
