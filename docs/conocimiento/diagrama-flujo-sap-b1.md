# Facturas de proveedor → SAP Business One — el flujo, con la verdad de cada tramo

Material de venta interna (Plaud #3, sesión con Transportes Innovativos).
Regla del documento: cada caja dice si **ya corre hoy** o si es **escalón 3,
pendiente de credenciales del cliente**. Nada de este diagrama se enseña como
vivo si aquí no lo dice.

Lo que pidió el cliente, en sus palabras: la factura del taller/refaccionaria
llega (correo o foto), la IA extrae los datos, los valida y los manda a
aprobación — y su SAP Business One se alimenta solo. **No quiere un ERP
nuevo.** Los escalones honran eso: primero el archivo que su SAP ya sabe
importar, después la escritura directa cuando nos den acceso.

```mermaid
flowchart TD
    subgraph ENTRADA["ENTRADA — vivo hoy"]
        C["Correo al buzón de la flota<br/>(dirección única por tenant, firma Svix,<br/>idempotencia por email_id)"]
        P["Panel: subir XML<br/>(dato duro del CFDI)"]
        F["Panel: subir FOTO<br/>(visión + QR — la fila queda marcada<br/>con su confianza OCR)"]
    end

    subgraph EXTRACCION["EXTRACCIÓN Y VALIDACIÓN — vivo hoy"]
        X["parseCfdiXml<br/>UUID, RFCs, totales, conceptos"]
        O["extraerComprobante (OCR)<br/>exige el UUID del QR:<br/>sin llave no hay dedup"]
        V["Validaciones al ingerir:<br/>· receptor vs RFC de la flota<br/>· estatus SAT (vigente/cancelado)<br/>· dedup por UUID (unique en la base)"]
    end

    subgraph APROBACION["APROBACIÓN — vivo hoy"]
        B["Bandeja por estatus<br/>pendiente / aprobada / rechazada"]
        H["Decisión HUMANA<br/>quién y cuándo, siempre<br/>(LFPDPPP 26-II: el agente marca,<br/>la persona decide)"]
    end

    subgraph EXPORT["EXPORT — vivo hoy (escalón 2)"]
        E1["CSV layout SAP B1<br/>(campos del import Excel/DTW:<br/>DocDate, CardName, FederalTaxID,<br/>NumAtCard, DocTotal, líneas)"]
        E2["CSV variante CONTPAQi<br/>(español, fecha dd/mm/aaaa)"]
        M["Marca exportada_en<br/>anti-doble-import visible en la bandeja"]
    end

    subgraph SAP["ESCALÓN 3 — NO construido: pendiente de credenciales"]
        SL["Escritura directa al Service Layer<br/>POST /b1s/v1/PurchaseInvoices"]
        RED["Ruta de red que abre SU área de sistemas<br/>(SAP recomienda NO exponer el Service<br/>Layer a internet: VPN / túnel / proxy)"]
    end

    IMP["El contador importa el CSV<br/>a SAP B1 / CONTPAQi<br/>(minutos, sin retecleo)"]

    C --> X
    P --> X
    F --> O
    X --> V
    O --> V
    V --> B
    B --> H
    H -->|aprobada| E1
    H -->|aprobada| E2
    H -->|rechazada| B
    E1 --> M
    E2 --> M
    M --> IMP

    H -.->|"cuando el cliente dé usuario de SAP,<br/>CompanyDB y la ruta de red"| SL
    RED -.-> SL

    style SAP stroke-dasharray: 5 5
```

## Qué está vivo hoy (verificable en el repo)

| Tramo | Dónde vive | Estado |
| --- | --- | --- |
| Buzón de correo por flota | `api/correo/entrante` + `buzon_escritura.ts` | Vivo: firma, tenant por destinatario, idempotencia, reintentos seguros |
| XML por panel | `dashboard/agentes/proveedores` | Vivo |
| Foto por panel (OCR) | `ingresarFacturaDesdeFoto` | Vivo; la fila carga `ocr_confianza` y la pantalla manda a revisar contra el papel |
| Estatus SAT al ingerir | `estadoSatDeCfdi` (ConsultaCFDIService) | Vivo; SAT caído → 'pendiente', nunca tumba el flujo |
| Aprobación humana con actor | `decidirFacturaProveedor` | Vivo; quién y cuándo en cada fila, candado anti-carrera |
| CSV SAP B1 / CONTPAQi | `/api/export/facturas-proveedor?formato=` | Vivo; marca `exportada_en` y anota la corrida del agente |
| Bitácora de corridas | `agente_corrida` (disparo `correo`/`manual`) | Vivo |

## Qué es escalón 3 y qué exige (no prometer sin esto)

1. **Credenciales del cliente**: dirección del Service Layer, `CompanyDB`,
   usuario y contraseña de SAP (el conector ya sabe probarlas:
   `conectores/erp.ts`, `SAP_B1.probar`).
2. **Ruta de red**: SAP documenta que el Service Layer es para llamadas
   internas — en un B1 instalado en la oficina, SU área de sistemas tiene que
   abrir VPN/túnel/proxy. Es trabajo de ellos, no nuestro, y se dice en la
   primera reunión, no en la segunda.
3. **Mapeo con su consultor**: `CardCode` (su catálogo de proveedores) y
   `TaxCode` (su catálogo fiscal) viven en SU SAP. En el CSV salen vacíos a
   propósito; en la escritura directa se resuelven contra sus catálogos
   leídos por el mismo Service Layer.

## Las frases para la venta (todas verdad)

- "Tu SAP no se toca: te damos HOY el archivo que tu SAP ya sabe importar."
- "La IA extrae y valida; la aprobación es de tu gente, siempre, con nombre
  y fecha."
- "Un CFDI cancelado ante el SAT no llega callado a tu contabilidad: la
  bandeja lo grita antes de que alguien lo apruebe."
- "La escritura directa a tu SAP es el siguiente paso y se activa con
  accesos que tú controlas — no la vendemos como si ya corriera."
