# Liquidación externa (Agente 1, modo «solo entrega»)

**Qué es.** Transportes Innovativos ya calcula la liquidación de su chofer en su
SAP/TMS. Lo que pidió (llamada del 31-ago) es que Likida **la entregue** al
chofer por WhatsApp, no que la recalcule. Este modo es el opuesto exacto del de
fotos: aquí la cifra **no es nuestra**.

- Likida **no recalcula** nada. Lo único que verifica al recibirla es que
  `total` sea la suma de los renglones (percepciones − deducciones, en
  centavos). Si no cuadra: 400 con la diferencia.
- Vive en tablas propias (`liquidacion_externa`, mig. 0370). **No se mezcla**
  con `liquidacion` (el cierre que cuadró el motor y firmó una persona) ni sale
  por `GET /v1/liquidaciones`.
- El modo de fotos no se toca.

## Flujo

```
SAP/TMS ──POST /v1/liquidaciones-externas──▶ Likida
                                              │ valida (estricto) · resuelve chofer · PDF (adjunto o generado) · guarda
                                              ▼
                              pendiente ──▶ en_cola ──▶ enviada ──▶ acusada
                                  │            │ (wa_outbox reintenta)   (el chofer aprieta un botón)
                                  └────────────┴──▶ fallida ──(panel: Reintentar)──▶ pendiente
```

| Estado | Significa |
|---|---|
| `pendiente` | Recibida; todavía no entra a la cola de WhatsApp (o espera un reintento con backoff). |
| `en_cola` | Vive en `wa_outbox`, la cola durable que reintenta contra Meta. |
| `enviada` | Meta aceptó el mensaje (hay `wamid`). El chofer todavía no responde. |
| `acusada` | El chofer apretó **Recibida** o **No coincide**. |
| `fallida` | Se agotaron los reintentos o Meta la rechazó sin remedio. Se dice por qué. |

El **201 del POST significa «recibida»**, no «entregada»: la entrega es
asíncrona. Un fallo de entrega **no** convierte una recepción exitosa en error.

## `POST /v1/liquidaciones-externas`

Llave de API con área `administracion`. Cuerpo máx. ~1.4 MB (el PDF adjunto,
opcional, pesa hasta 1 MB ya decodificado).

```json
{
  "claveExterna": "SAP-LIQ-000123",
  "sistemaOrigen": "SAP",
  "operador": { "telefono": "5512345678" },
  "viajes": ["VJ-100", "VJ-101"],
  "periodo": { "desde": "2026-09-01", "hasta": "2026-09-07" },
  "conceptos": [
    { "clave": "P010", "descripcion": "Sueldo base", "tipo": "percepcion", "monto": 3500 },
    { "clave": "D010", "descripcion": "Anticipo", "tipo": "deduccion", "monto": 1000.25 }
  ],
  "total": 2499.75,
  "moneda": "MXN"
}
```

- **Estricto**: cualquier campo desconocido es 400 (incluido `tenant_id`: la
  flota sale de la credencial). Más de dos decimales se rechaza, no se
  redondea. Un renglón sin `monto` no es un renglón de cero. Textos largos o con
  saltos de línea se rechazan.
- **`operador`**: al menos `id`, `telefono` o `numeroEmpleado`. Si mandas
  varios, todos tienen que apuntar al **mismo** chofer; un chofer dado de baja
  se rechaza.
- **`pdf`** (opcional) `{ base64, nombre? }`: se entrega **el tuyo**, comprobado
  por sus bytes (`%PDF-`, `%%EOF`, sin `/JavaScript`, `/Launch`, archivos
  incrustados). Es una heurística, no un sandbox. Sin `pdf`, Likida genera uno
  con tus cifras.
- **Idempotencia por `claveExterna`**: mismo folio + mismo contenido → `200`
  `idempotente: true`; mismo folio + otro contenido → `409` (no se sobrescribe:
  el chofer pudo haberla visto; una corrección va con otra clave, p. ej.
  `…-R1`). `Idempotency-Key` es opcional.

## `GET /v1/liquidaciones-externas`

Área `dinero`. Paginación **solo por cursor** (`despues`). Filtros: `estado`,
`respuestaChofer` (`recibida` | `no_coincide`), `operadorId`, `claveExterna`,
`desde`, `hasta`. La respuesta nunca trae la ruta del PDF, URLs firmadas ni el
teléfono del chofer, y el error de WhatsApp sale como `fallo: { codigo, texto }`
(nunca el cuerpo crudo de Meta).

## Tablero y exportación

`/dashboard/agentes/liquidacion` → sección **Liquidaciones externas**: fichas
(No coincide · Fallaron · Pendientes · En cola · Enviadas · Con respuesta), tabla
con estado, vía (sesión/plantilla) y respuesta del chofer, descarga del PDF,
**Reintentar** (solo en `fallida`) y **Exportar CSV** por periodo (máx. 3 meses,
`GET /api/export/liquidaciones-externas`; el CSV neutraliza fórmulas de Excel).

## Entrega por WhatsApp

1. **Sesión** (dentro de las 24 h del último mensaje del chofer): un solo
   mensaje interactivo con el PDF como encabezado, el resumen (periodo y total
   con moneda) y dos botones: **Recibida** / **No coincide**.
2. Si Meta contesta *ventana cerrada* (131047 / 131026 / 131042), **cae a la
   plantilla** `liquidacion_externa_v1` (una sola vez).
3. Todo viaja por `wa_outbox` (llave de deduplicación `liqext:<id>:g<n>:<canal>`):
   encolarlo dos veces es la misma fila.
4. El botón llega al webhook (`interactive.button_reply` en sesión, `button.payload`
   en plantilla) y el processor lo atiende **antes** del agente y **aunque el
   chofer no tenga viaje abierto**. El operador sale de su teléfono, no del id
   del botón: un id ajeno no acusa la liquidación de otro chofer.
5. `/api/cron/liquidaciones-externas` (cada 5 min, latido propio) reencola lo que
   no se pudo encolar (backoff 2/4/8/16 min, 5 intentos) y concilia contra el
   outbox.

### Interfaz con el selector de otra rama

`EntregaWhatsApp.enviarConFallback(msg)` (`src/lib/likida/liquidacion_externa/entrega.ts`)
es una interfaz fina e **idempotente**. La implementación por omisión
(`entregaPorOutbox`) prueba la sesión y cae a plantilla ante el rechazo. Cuando
exista el selector real de la rama de WhatsApp de producción (con registro de la
ventana de 24 h), basta un adaptador que cumpla esa interfaz y se cambia en
`dependenciasPorOmision` de `servicio.ts`.

## BLOQUEOS EXTERNOS (no cerrables por código)

1. **Plantilla Meta `liquidacion_externa_v1`** (categoría *utility*, idioma
   `es_MX`) — dar de alta y esperar aprobación (2–5 días hábiles o más). Hasta
   entonces, las liquidaciones a choferes **fuera de la ventana de 24 h** quedan
   `fallida` con `fallo.codigo = plantilla_no_aprobada`. Definición a registrar:
   - Encabezado: **documento** (PDF).
   - Cuerpo: `Hola {{1}}, esta es tu liquidación de {{4}}. Periodo: {{2}}. Total: {{3}}. El detalle va en el PDF. ¿Te cuadra? Responde con un botón.`
   - Variables: `{{1}}` primer nombre · `{{2}}` periodo · `{{3}}` total con moneda · `{{4}}` sistema de origen.
   - Botones de respuesta rápida: `Recibida`, `No coincide`.
2. **Número real de WhatsApp (WABA verificada)**. Con el número de prueba, Meta
   solo entrega a teléfonos dados de alta a mano (131030).
3. **Contrato real de API de Meta**: el payload de plantilla con encabezado de
   documento y botones `quick_reply` y el de sesión con encabezado de documento en
   botones siguen la documentación de Cloud API, pero **no se verificaron contra
   Meta real**; las pruebas usan dobles de contrato.
4. **Aplicar la migración 0370 en producción** (y luego `[deploy]`): la compuerta
   de despliegue no construye si la base va atrás de la última migración.
5. **Integración del lado de Innovativos**: su SAP/TMS tiene que llamar al
   endpoint (acceso bajo Zero Trust, llave de API de área `administracion`).

## Límites conocidos (pendientes)

- No hay **anulación/corrección** de una liquidación ya recibida: se manda una
  nueva con otra `claveExterna`.
- «No coincide» queda **marcado en el panel**; no se avisa por WhatsApp a la
  oficina.
- La URL firmada del PDF dentro del mensaje vive 24 h (la cola reintenta con
  backoff); cada reintento manual la renueva.
- La cancelación ARCO del operador no anonimiza `liquidacion_externa`
  (retención laboral/fiscal): decisión de política pendiente.
- El selector `enviarConFallback` real y el registro de ventana de 24 h son de
  la rama de WhatsApp de producción.
