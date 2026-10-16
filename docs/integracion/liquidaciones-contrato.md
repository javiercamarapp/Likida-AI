# Contrato de la API de liquidaciones

Documento para la persona de sistemas. Describe qué datos de cada liquidación necesita Likida y de qué dos maneras pueden llegar. Todo lo que aparece aquí es de ejemplo: los folios, nombres y cifras son inventados.

## 1. Qué es una liquidación para este contrato

Una liquidación es el pago a **una unidad** por un periodo. Puede juntar **varias bitácoras** de esa misma unidad. Likida **no recalcula nada**: manda al operador exactamente los renglones y el neto que reciba. Los renglones llegan ya agregados y separados en dos bloques, `percepciones` y `deducciones`. Cada renglón es un concepto con su valor, siempre mayor que cero: el signo lo da el bloque.

## 2. Campos

Reglas generales: JSON en UTF-8; fechas `AAAA-MM-DD` (días en hora del Centro de México, inclusivos); importes como número en pesos con dos decimales; sin saltos de línea dentro de los textos. **Un campo que no esté en estas tablas se rechaza** (no se ignora en silencio).

**Liquidación**

| Campo | Obligatorio | Qué es |
|---|---|---|
| `bitacora` | sí | Folio de la bitácora principal (hasta 40 caracteres). |
| `bitacoras` | no | Todos los folios que junta la liquidación; debe incluir `bitacora`. Cada elemento es el folio o `{ "bitacora", "unidad" }`. Bitácoras de unidades distintas se rechazan. |
| `numeroLiquidacion` | no, recomendado | Consecutivo de la liquidación en el sistema de origen. Si viene, es la clave de idempotencia. |
| `numeroPago` | no, recomendado | Número del pago con el que se cubrió. |
| `terminal` | no | Terminal u oficina de origen. |
| `poliza` | sí (puede ir `null`) | Folio de la póliza. Sin póliza la liquidación no se envía y queda esperando. |
| `operador` | sí | Objeto con `numeroEmpleado` (obligatorio) y `nombre` (opcional). |
| `unidad` | no, recomendado | Número económico de la unidad. |
| `tipoOperador` | no | `foraneo`, `local` o `permisionario`. |
| `desde`, `hasta` | sí | Periodo cubierto. |
| `dias` | no | Días del periodo (si falta, se calcula desde-hasta, inclusivo). |
| `percepciones` | sí* | Lista de renglones (ver abajo). |
| `deducciones` | sí* | Lista de renglones (ver abajo). |
| `neto` | no, recomendado | Neto que calculó el sistema de origen. Si viene, debe ser percepciones menos deducciones; si no cuadra, se rechaza. Sin él, Likida suma los renglones y lo marca como «calculado». |
| `enviadoOrigen` | no | `true` si el sistema de origen ya marcó la liquidación como enviada. |

\* Debe haber al menos un renglón entre los dos bloques; hasta 100 renglones por bloque.

**Renglón** (en `percepciones` y en `deducciones`)

| Campo | Obligatorio | Qué es |
|---|---|---|
| `concepto` | sí | Descripción del concepto, tal como la debe leer el operador (hasta 120 caracteres). |
| `monto` | sí | Valor en pesos, mayor que cero. |
| `vale` | no | Número de vale, en los anticipos. |

## 3. Cómo llega: dos modos

**Modo push (Likida recibe).** El sistema de origen manda cada liquidación a `POST /api/v1/liquidaciones-externas/desgloses`, al procesar los pagos o cuando se sube la bitácora. El cuerpo es una liquidación suelta o `{ "desgloses": [ ... ] }` (de 1 a 100). Se valida todo antes de guardar: si un elemento está mal, no se guarda ninguno. Autenticación: `Authorization: Bearer <llave>`, con una llave por flota que entrega Likida. El cliente nunca manda su identificador de flota: sale de la llave.

**Modo pull (Likida lee).** Sistemas expone una lectura y Likida la consulta cada cierto tiempo:

- `GET <base>/liquidaciones?desde=<instante>&despuesDe=<id>&limite=<n>` devuelve, en orden ascendente por `(instante de modificación, id)`, objetos con la misma forma de la sección 2 y `{ "items": [...], "siguiente": { "desde", "despuesDe" }, "hayMas": true|false }`. Debe incluir también las liquidaciones sin póliza (`poliza: null`).
- `POST <base>/liquidaciones/marcar-enviadas` con `{ "claves": [ ... ] }` registra la marca «enviado». Es opcional y de cortesía: la verdad del envío la lleva Likida. Responde `{ "ok": [...], "fallidas": [{ "clave", "motivo" }] }`.
- En el sistema de origen el desglose puede vivir en una columna `desglose` de la liquidación, con dos nodos (`percepciones` y `deducciones`), y una columna de marca «enviado».
- Autenticación: usuario y contraseña que producen un token; Likida usa el token y lo renueva cuando vence.
- Likida re-lee una ventana de 24 horas antes de su último cursor, porque la póliza puede llegar tarde; las repetidas no duplican nada.

## 4. Quién llama a quién

| Modo | Quién inicia | Quién expone el servicio | Cuándo | Credencial |
|---|---|---|---|---|
| Push | Sistema de origen | Likida | Al procesar pagos o al subir la bitácora | Llave por flota (Bearer) |
| Pull | Likida | Sistema de origen | Cada cierto tiempo, desde el último cursor | Usuario y contraseña a token |

## 5. Idempotencia

La clave de una liquidación es su `numeroLiquidacion` (o, sin él, la terminal más la bitácora). Mandar lo mismo dos veces no duplica ni reenvía nada. Mandar **otro contenido** con la misma clave **no sobrescribe**: queda una excepción `correccion_pendiente` para que una persona decida, porque el operador pudo haber recibido ya la primera versión. Reintentar toda una petición que falló a la mitad es seguro.

## 6. Respuestas y errores

Respuesta del push: `{ "datos": { "recibidas", "idempotentes", "retenidas", "excepciones": [ { "clave", "motivo" } ] } }`, con `201` si se guardó al menos una liquidación y `200` si todo ya existía o solo hubo excepciones. Los errores llevan `{ "error": { "codigo", "mensaje" } }`; ramifiquen sobre `codigo`.

| Estado | `codigo` | Qué hacer |
|---|---|---|
| 400 | `parametro_invalido` | El mensaje dice qué campo y en qué posición; corregir y reenviar. No se guardó nada. |
| 401 | `no_autenticado` | Llave ausente o inválida. |
| 403 | `sin_permiso` | La llave no tiene permiso para este recurso. |
| 429 | `demasiadas_peticiones` | Esperar y reintentar. |
| 500 / 503 | `error_interno` / `dependencia_no_disponible` | Reintentar la petición completa. |

## 7. Ejemplo (sintético)

```json
{
  "terminal": "T01",
  "bitacora": "B-0001",
  "bitacoras": ["B-0001", "B-0002"],
  "numeroLiquidacion": "L-0001",
  "numeroPago": "P-0001",
  "poliza": "POL-0001",
  "operador": { "numeroEmpleado": "E-0001", "nombre": "Operador Ejemplo Uno" },
  "unidad": "0001",
  "tipoOperador": "foraneo",
  "desde": "2026-10-09",
  "hasta": "2026-10-14",
  "dias": 6,
  "percepciones": [
    { "concepto": "Sueldo", "monto": 4000 },
    { "concepto": "Viáticos", "monto": 1500.5 }
  ],
  "deducciones": [
    { "concepto": "Retención uno", "monto": 300.25 },
    { "concepto": "Anticipo Ciudad Ejemplo", "monto": 1000, "vale": "100001" }
  ],
  "neto": 4200.25,
  "enviadoOrigen": false
}
```

## 8. Preguntas abiertas para sistemas

1. ¿Prefieren push, pull o los dos? ¿En qué fecha podrían tener listo el que elijan?
2. En pull, ¿qué campo usan como «instante de modificación» y qué id estable tiene cada liquidación?
3. ¿Pueden llenar `numeroLiquidacion` y `numeroPago`? Sin ellos la clave es la bitácora y varias bitácoras por unidad no se agrupan.
4. ¿Cuál es el catálogo de conceptos (nombre exacto de cada percepción y deducción) para que el operador lea siempre lo mismo?
5. ¿El usuario y la contraseña de lectura serán una cuenta de servicio sin correo asociado?
6. ¿La marca «enviado» la pueden escribir ustedes o la lleva Likida por su cuenta?
