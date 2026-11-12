// ═══════════════════════════════════════════════════════════════════════════
// Piezas del documento OpenAPI de `POST /v1/liquidaciones-externas/desgloses` para el formato `muestra-tms`, el resultado por bitácora y
// el modo simulación (piloto del webhook, 11-nov-2026). Viven aquí (y no dentro de `app/api/v1/openapi/route.ts`) porque son TEXTO DE
// DOCUMENTACIÓN de la API, no de interfaz; la ruta solo las integra. La prueba `openapi/route.test.ts` fija que el documento las trae.
// ═══════════════════════════════════════════════════════════════════════════

export const DESCRIPCION_MUESTRA_TMS =
  'RESULTADO POR BITÁCORA: la respuesta trae `resultados`, una entrada por bitácora con su `estado` (`recibida`, `retenida`, `idempotente`, `correccion_pendiente`, `en_revision`, `no_guardada`). Regla del integrador: entregada = `recibida`, `retenida`, `idempotente` o `correccion_pendiente`; lo demás se corrige y se reenvía con el mismo identificador. Los campos anteriores no cambian.\n\n'
  + 'MODO SIMULACIÓN: con la cabecera `Likida-Simular: si` se valida y se responden los mismos `resultados` (y `simulada: true`) SIN escribir nada: ni liquidaciones, ni archivos, ni entregas, ni excepciones ni revisiones. Siempre 200. Cualquier otro valor distinto de `si`/`no` es 400.\n\n'
  + 'FORMATO `muestra-tms` (un objeto por bitácora; el sistema de transporte del cliente): se elige solo por su forma, con el sobre `{ "formato": "muestra-tms", "version": 1, "bitacoras": [ … ] }` (1 a 100) o UNA bitácora suelta. Cada bitácora: `BitacoraID` (entero > 0 o texto `[A-Za-z0-9._-]` de hasta 40: el identificador ÚNICO por flota y llave de idempotencia, nunca reutilizado), `Operador` (nombre), `Unidad`, `Fecha { Inicia, Termina }` (`yyyy-MM-dd HH:mm:ss`, hora de México), `Percepciones[]` y `Deducciones[]` (`{ Descripcion, Monto }`, montos positivos con hasta 2 decimales; el catálogo de conceptos es cerrado: un concepto desconocido deja la bitácora `en_revision`). Opcionales: `NumeroEmpleado` (texto o entero, hasta 40; si viene MANDA sobre el nombre y, si además viene `Operador` y no coincide con el del padrón, la bitácora queda `en_revision`), `TipoOperador` (`local`|`foraneo`|`permisionario`|`rabon`|`posturero`|`cargador`; el tipo va en cada bitácora, no en el padrón), `Poliza` (texto hasta 40 o null), `NumeroPago` (`[A-Za-z0-9._/-]`, hasta 40), `Neto` (número con hasta 2 decimales; si viene y no cuadra con los renglones, `en_revision`) y `Folio` (texto o entero, hasta 40: el número de bitácora que conoce el operador; es lo que se muestra en el Excel, el asunto del correo y el panel). `NumeroLiquidacion` se ignora. Un valor inválido deja SOLO esa bitácora `en_revision`; nunca tumba el lote. Apagado por omisión (403 hasta que Likida lo habilite para la flota). `Poliza`, `TipoOperador` y `NumeroPago` deben ir desde el primer envío: agregarlos después a una bitácora ya recibida no la modifica.';

export const PARAMETRO_SIMULAR = { name: 'Likida-Simular', in: 'header', required: false, description: '`si`: modo simulación, valida y responde los mismos `resultados` sin escribir nada. `no` o ausente: envío normal.', schema: { type: 'string', enum: ['si', 'no'] } };

export const ESQUEMAS_MUESTRA_TMS = {
  BitacoraMuestraTms: {
    type: 'object',
    description: 'Una bitácora del formato `muestra-tms`. Los campos opcionales de abajo se leen si vienen; un valor inválido deja SOLO esa bitácora en revisión.',
    properties: {
      BitacoraID: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[A-Za-z0-9._-]{1,40}$' }], description: 'Identificador ÚNICO por flota, que no se reutiliza ni cambia. Es la llave de idempotencia (`BIT-<BitacoraID>`).' },
      Operador: { type: 'string', description: 'Nombre del operador. Sin `NumeroEmpleado`, se cruza por nombre exacto (sin acentos, mayúsculas ni puntuación; el orden de las palabras cuenta).' },
      NumeroEmpleado: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'integer', minimum: 0 }], description: 'Manda sobre el nombre. Si además viene `Operador` y no coincide con el del padrón, la bitácora queda en revisión.' },
      TipoOperador: { type: 'string', enum: ['local', 'foraneo', 'permisionario', 'rabon', 'posturero', 'cargador'], description: 'Se aceptan mayúsculas y acentos («Foráneo», «Rabón»). Solo foráneo y local reciben la liquidación por correo mientras la flota no habilite los demás; el resto queda retenido (tipo_sin_regla). Va en cada bitácora, no en el padrón.' },
      Poliza: { type: 'string', nullable: true, maxLength: 40 },
      NumeroPago: { type: 'string', pattern: '^[A-Za-z0-9._/-]{1,40}$' },
      Neto: { type: 'number', description: 'Hasta 2 decimales; si viene y no cuadra con Percepciones − Deducciones, la bitácora queda en revisión.' },
      Folio: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'integer', minimum: 0 }], description: 'El número de bitácora que conoce el operador; se muestra en el Excel, el asunto del correo y el panel.' },
      Unidad: { type: 'string' },
      Fecha: { type: 'object', properties: { Inicia: { type: 'string', description: '`yyyy-MM-dd HH:mm:ss`, hora de México.' }, Termina: { type: 'string', description: '`yyyy-MM-dd HH:mm:ss`, hora de México.' } }, required: ['Inicia', 'Termina'] },
      Percepciones: { type: 'array', maxItems: 100, items: { type: 'object', properties: { Descripcion: { type: 'string' }, Monto: { type: 'number', minimum: 0 } }, required: ['Descripcion', 'Monto'] } },
      Deducciones: { type: 'array', maxItems: 100, items: { type: 'object', properties: { Descripcion: { type: 'string' }, Monto: { type: 'number', minimum: 0 } }, required: ['Descripcion', 'Monto'] } },
    },
    required: ['BitacoraID', 'Fecha'],
  },
  SobreMuestraTms: {
    type: 'object',
    properties: { formato: { type: 'string', enum: ['muestra-tms'] }, version: { type: 'integer', enum: [1] }, bitacoras: { type: 'array', minItems: 1, maxItems: 100, items: { $ref: '#/components/schemas/BitacoraMuestraTms' } } },
    required: ['formato', 'bitacoras'],
    additionalProperties: false,
  },
};

export const PROPIEDADES_RESULTADO_MUESTRA = {
  enRevision: { type: 'array', description: 'SOLO formato `muestra-tms`: bitácoras que NO se guardaron porque un dato no pasó la validación. Se corrigen en tu sistema y se reenvían con el mismo `BitacoraID`.', items: { type: 'object', properties: { indice: { type: 'integer' }, bitacora: { type: 'string', nullable: true }, motivos: { type: 'array', items: { type: 'object', properties: { codigo: { type: 'string' }, campo: { type: 'string' } }, required: ['codigo', 'campo'] } } }, required: ['indice', 'bitacora', 'motivos'] } },
  resultados: { type: 'array', description: 'UNA entrada por bitácora del lote, en el orden en que se mandaron. ENTREGADA (no reenviar) = `recibida`, `retenida`, `idempotente` o `correccion_pendiente`. `en_revision` y `no_guardada` se corrigen en tu sistema y se reenvían con el mismo identificador.', items: { type: 'object', properties: {
    indice: { type: 'integer', description: 'Posición en el lote enviado (0 = primera).' },
    bitacora: { type: 'string', nullable: true, description: 'El identificador (`BitacoraID` o `bitacora`); null si no se pudo leer.' },
    folio: { type: 'string', description: 'El `Folio` que mandaste, si lo mandaste.' },
    estado: { type: 'string', enum: ['recibida', 'retenida', 'idempotente', 'correccion_pendiente', 'en_revision', 'no_guardada'], description: '`recibida`: guardada y programada. `retenida`: guardada, no sale hasta que una persona la libere. `idempotente`: ya estaba igual. `correccion_pendiente`: ya estaba con otro contenido, una persona decide (Likida ya tiene una versión). `en_revision`: no se guardó, algún dato no pasó la validación. `no_guardada`: no se guardó (operador sin alta, sin póliza o bitácora duplicada).' },
    motivos: { type: 'array', items: { type: 'object', properties: { codigo: { type: 'string' }, campo: { type: 'string', description: 'Solo en `en_revision`: la ruta del campo (jamás su valor).' } }, required: ['codigo'] } },
  }, required: ['indice', 'bitacora', 'estado'] } },
  simulada: { type: 'boolean', enum: [true], description: 'Solo con la cabecera `Likida-Simular: si`: nada se escribió.' },
};

export const PROPIEDAD_FOLIO = { type: 'string', maxLength: 40, description: 'El número de bitácora que conoce el operador: solo se guarda y se muestra; no entra en la clave ni en la huella.' };
