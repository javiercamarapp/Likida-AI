// ═══════════════════════════════════════════════════════════════════════════
// OpenAPI (3.1) del contrato SUPUESTO del adaptador TMS, DERIVADO de `contrato.supuesto.json` y de sus mapeos. Es lo que Likida
// ASUME hoy del sistema del cliente y lo que se le entrega para que lo corrija; NO es su especificación ni describe un servicio
// de Likida. Todo lleva `x-supuesto: true`. Se publica como archivo (`docs/operacion/conexion-tms-openapi.json`) y una prueba
// obliga a que coincida con lo que genera esta función. No hay ruta HTTP: cada `route.ts` nuevo exige revisión en el inventario de rutas.
// ═══════════════════════════════════════════════════════════════════════════
import type { CampoMapeo, MapeoTms } from './mapeo';
import { MAPEOS_REGISTRADOS, mapeoDe, mapeoLiquidacionesDe, type ContratoTms, type RecursoContrato } from './contrato';

type Obj = Record<string, unknown>;

function tipoDe(c: CampoMapeo): Obj {
  const t = typeof c === 'string' ? 'texto' : (c.transformar ?? 'texto');
  if (t === 'numero') return { type: 'number', 'x-supuesto': true };
  if (t === 'booleano') return { type: 'boolean', 'x-supuesto': true };
  if (t === 'fecha_local') {
    const d = typeof c === 'string' ? {} : c;
    return { type: 'string', description: `Fecha sin zona${d.formato ? `, formato ${d.formato}` : ''}${d.zona ? `, zona ${d.zona}` : ''} (SUPUESTO).`, 'x-supuesto': true };
  }
  return { type: 'string', 'x-supuesto': true };
}

/** Esquema de una fila CRUDA del origen: las claves son las `fuente` del mapeo (la raíz de cada ruta puntuada). */
function esquemaFila(m: MapeoTms): Obj {
  const props: Obj = {};
  for (const c of Object.values(m.campos)) {
    const fuente = typeof c === 'string' ? c : c.fuente;
    if (!/^[^.[\]]+$/.test(fuente)) continue; // rutas anidadas: no se aplanan, se dejan fuera del esquema
    props[fuente] = tipoDe(c);
  }
  return { type: 'object', properties: props, 'x-supuesto': true };
}

function operacion(nombre: string, m: MapeoTms): Obj {
  const parametros: Obj[] = Object.entries(m.params).map(([clave, nombreParam]) => ({
    name: nombreParam, in: 'query', required: clave === 'desde' || clave === 'hasta',
    schema: { type: clave === 'pagina' || clave === 'tam' ? 'integer' : 'string' }, 'x-supuesto': true,
  }));
  const raiz = m.raiz === '' ? null : m.raiz.split('.');
  let respuesta: Obj = { type: 'array', items: esquemaFila(m) };
  if (raiz) for (let i = raiz.length - 1; i >= 0; i -= 1) respuesta = { type: 'object', properties: { [raiz[i]]: respuesta } };
  return {
    summary: `${nombre} (SUPUESTO)`,
    description: `Clave externa (idempotencia): ${m.clave_externa.join(' + ')}. Obligatorios: ${m.obligatorios.join(', ')}. Solo lectura.`,
    parameters: parametros,
    security: [{ sesion: [] }],
    responses: {
      '200': { description: 'Filas. Una respuesta 200 con HTML o con un error de sesión se trata como sesión caída (un solo re-login).', content: { 'application/json': { schema: respuesta } } },
      '401': { description: 'Sesión vencida o inválida: Likida hace UN re-login y UN reintento; si vuelve a fallar, se detiene.' },
      '429': { description: 'Límite de tasa. Se espera `Retry-After` (segundos o fecha; tope 30 s) y se reintenta hasta 3 veces.' },
    },
    'x-supuesto': true,
  };
}

/** Documento OpenAPI 3.1 derivado del contrato. Determinista: mismo contrato, mismo documento. */
export function openapiDeContrato(c: ContratoTms, registro: Readonly<Record<string, unknown>> = MAPEOS_REGISTRADOS): Obj {
  const paths: Obj = {
    [c.auth.login.ruta]: {
      post: {
        summary: 'Login de cuenta de servicio (SUPUESTO)',
        description: `Cuerpo: ${Object.keys(c.auth.login.cuerpo).join(', ')}. El token vuelve en «${c.auth.login.campo_token}» y se manda en «${c.auth.login.encabezado ?? 'Authorization'}» con prefijo «${c.auth.login.prefijo ?? 'Bearer '}».`,
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: Object.fromEntries(Object.keys(c.auth.login.cuerpo).map((k) => [k, { type: 'string' }])) } } } },
        responses: { '200': { description: 'Token.' }, '401': { description: 'Credencial rechazada: Likida se detiene y alerta, no insiste.' } },
        'x-supuesto': true,
      },
    },
  };
  const agregar = (ruta: string, nombre: string, m: MapeoTms, r: RecursoContrato) => {
    const op = operacion(nombre, m);
    op['x-paginacion'] = c.recursos[r].paginacion;
    op['x-orden-estable'] = c.recursos[r].orden_estable;
    paths[ruta] = { [m.metodo.toLowerCase()]: op };
  };
  for (const r of ['viajes', 'peajes', 'posiciones'] as const) agregar(mapeoDe(c, r, registro).ruta, r, mapeoDe(c, r, registro), r);
  const liq = mapeoLiquidacionesDe(c, registro);
  for (const t of ['nomina', 'operadores', 'conceptos'] as const) agregar(liq[t].ruta, `liquidaciones / ${t}`, liq[t], 'liquidaciones');

  return {
    openapi: '3.1.0',
    info: {
      title: 'Contrato SUPUESTO del adaptador TMS de Likida',
      version: c.version,
      description: 'Lo que Likida ASUME del sistema de transporte del cliente. NO es su especificación: cada ruta, campo, formato y límite debe confirmarse o corregirse. Nada de esto describe una conexión existente. Solo lectura (más el login). Texto en UTF-8; si llega con mojibake, Likida lo repara.',
    },
    servers: [{ url: 'https://SUPUESTO-base-url-del-tms', description: 'Por conectar: la dirección real viene de la credencial de la flota.' }],
    security: [{ sesion: [] }],
    paths,
    webhooks: {
      loteFirmado: {
        post: {
          summary: 'Modo push (alternativa, apagado): el cliente empuja lotes firmados',
          description: `Encabezados: ${c.modos.push.encabezado_marca} (segundos epoch; tolerancia ${c.modos.push.tolerancia_marca_s} s), ${c.modos.push.encabezado_firma} (HMAC-SHA256 hex de «marca.cuerpo»), ${c.modos.push.encabezado_idempotencia}. Máximo ${c.modos.push.max_bytes} bytes. Respuestas: 200, 400 sin llave, 401 firma, 403 marca, 409 repetido, 413 tamaño, 422 cuerpo, 503 apagado. Sin endpoint publicado.`,
          responses: { '200': { description: 'Lote recibido.' } },
          'x-supuesto': true,
        },
      },
    },
    components: { securitySchemes: { sesion: { type: 'apiKey', in: 'header', name: c.auth.login.encabezado ?? 'Authorization', description: 'Token obtenido con el login (SUPUESTO).' } } },
    'x-estado': c.estado,
    'x-fecha-de-corte': c.corte.fecha ?? 'sin fijar',
    'x-modos': { api: c.modos.api.activo, archivos: c.modos.archivos.activo, push: c.modos.push.activo },
  };
}
