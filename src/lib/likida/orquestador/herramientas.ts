import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import type { ToolExecutor } from '@/lib/llm/openrouter';
import { ahoraMs } from '@/lib/saludo';
import { fuentes } from './fuentes';
import { resolverNombre } from './filtros';
import { rolPuedeUsar } from './permisos';
import { resumirAutofactura, resumirBuzon, resumirCobranza, resumirVigia, nombreSeguro } from './resumenes';
import { resumirSalud } from './salud_agentes';
import { armarTableroViajes, textoAntiguedad, type FilaViaje, type TableroViajes } from './tablero_viajes';
import { ETIQUETA_DESTINO, DESTINOS, MOTIVOS, MAX_RESUMEN, validarEscalacion } from './escalamiento';

// ═══════════════════════════════════════════════════════════════════════════
// LAS HERRAMIENTAS DEL ORQUESTADOR — la «pestaña tipo chat» sobre las fuentes
// nuevas (Conductor, Vigía, buzón, cobranza, autofactura) + la salud de los
// agentes + UNA acción: escalar a una persona.
//
// Doctrina (la misma de `agents/chat-tools.ts`, ampliada con cuidado):
//  1. SOLO LECTURA, salvo `escalar_a_persona`, que únicamente abre una tarea.
//  2. ANCLADAS a `ctx.tenantId`: ninguna herramienta tiene parámetro de flota; el
//     tenant lo fijó el servidor al autorizar la sesión.
//  3. POR ROL: cada herramienta declara su área (`permisos.ts`) y se niega dentro
//     del handler aunque el modelo la invente (defensa en profundidad: además no
//     se le ofrece, y el executor envuelto con `conPermisos` la rechaza).
//  4. El texto del modelo NUNCA llega a una consulta. Los únicos strings son: dos
//     nombres (terminal, cliente) que se buscan EN MEMORIA contra el catálogo de
//     la flota; un folio, que se busca en memoria contra el tablero (y, para
//     escalar, con un patrón estricto y `.eq` parametrizado); y el `resumen` de
//     una escalación, que va a una persona y no a una consulta.
//  5. SIN PII DE MÁS: el recorte vive en `resumenes.ts` (puro, probado).
//  6. Un dato que no se pudo leer se DICE; nunca se devuelve como cero.
// ═══════════════════════════════════════════════════════════════════════════

const SIN_PARAMS = { type: 'object', properties: {}, additionalProperties: false } as const;
const TOPE_FILAS = 15;

const ahora = (): Date => new Date(ahoraMs());

function sinPermiso(nombre: string, rol: string | undefined) {
  return {
    error: 'sin_permiso',
    mensaje: `Tu rol (${rol ?? 'desconocido'}) no tiene acceso a esta información. No la inventes ni la deduzcas: dile a la persona que se la pida a quien lleve esa área, o usa escalar_a_persona si es urgente.`,
    herramienta: nombre,
  };
}

/**
 * Envuelve el executor y FALLA CERRADO: solo corre una herramienta que está en el mapa de áreas y que el
 * rol puede ver (o una de `siempre`, p. ej. la tool terminal que entrega la respuesta). Cualquier otra —una
 * registrada para otro agente (`guardar_liquidacion`), una inventada, una de otra área— se rechaza SIN ejecutarse.
 */
export function conPermisos(rol: string | undefined, base: ToolExecutor, siempre: readonly string[] = []): ToolExecutor {
  return async (name, args, signal) => {
    if (!siempre.includes(name) && !rolPuedeUsar(rol, name)) {
      return { success: true, result: sinPermiso(name, rol), durationMs: 0 };
    }
    return base(name, args, signal);
  };
}

type Handler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
function registrar(nombre: string, descripcion: string, parametros: object, handler: Handler): void {
  registerTool(nombre, {
    schema: { type: 'function', function: { name: nombre, description: descripcion, parameters: parametros as Record<string, unknown> } },
    handler: async (args, ctx) => (rolPuedeUsar(ctx.rol, nombre) ? handler(args, ctx) : sinPermiso(nombre, ctx.rol)),
  });
}

const redondea = (n: number): number => Math.round(n * 100) / 100;

/** Lo que el modelo ve de un viaje: sin ids internos, posición aproximada (~1 km), sin contactos ni fotos. */
function vistaFila(f: FilaViaje) {
  return {
    folio: f.folio ?? 'sin folio',
    ruta: f.origen || f.destino ? `${f.origen ?? '?'} → ${f.destino ?? '?'}` : null,
    chofer: nombreSeguro(f.chofer),
    terminal: nombreSeguro(f.terminal),
    cliente: nombreSeguro(f.cliente),
    semaforo: f.semaforo,
    motivoSemaforo: f.motivo,
    ultimoHito: f.ultimoHito ? { hito: f.ultimoHito.etiqueta, estado: f.ultimoHito.estado, cuando: f.ultimoHito.cuando } : null,
    hitoQueToca: f.hitoActivo,
    gps: f.posicion
      ? { latAprox: redondea(f.posicion.lat), lngAprox: redondea(f.posicion.lng), antiguedadMin: f.posicion.antiguedadMin, antiguedad: textoAntiguedad(Math.max(0, f.posicion.antiguedadMin)), frescura: f.posicion.frescura }
      : null,
    senalDeVida: f.senalDeVida,
    escaladoATrafico: f.escalado,
    excepciones: f.excepciones.map((x) => ({ tipo: x.tipo, gravedad: x.gravedad, desde: x.desde, texto: x.texto })),
  };
}

async function tablero(args: Record<string, unknown>, tenantId: string): Promise<{ t: TableroViajes } | { aclarar: unknown }> {
  const entrada = await fuentes().entradaTablero(tenantId, ahora());
  const term = resolverNombre(args.terminal, entrada.terminales);
  const cli = resolverNombre(args.cliente, entrada.clientes);
  for (const [campo, r] of [['terminal', term], ['cliente', cli]] as const) {
    if (r.tipo === 'ambiguo' || r.tipo === 'no_encontrado') {
      return { aclarar: { error: 'filtro_sin_resolver', campo, motivo: r.tipo === 'ambiguo' ? 'hay varias coincidencias' : 'no existe en el catálogo de la flota', opciones: r.opciones, instruccion: 'Pregúntale a la persona cuál de las opciones quiere; no adivines.' } };
    }
  }
  const t = armarTableroViajes({
    ...entrada,
    filtros: { terminalId: term.tipo === 'ok' ? term.id : null, clienteId: cli.tipo === 'ok' ? cli.id : null, soloExcepciones: args.vista === 'solo_excepciones' },
  });
  return { t };
}

registrar('tablero_viajes',
  'El tablero de viajes EN VIVO de la flota: cada viaje en curso con su último hito del Conductor, la última posición del tractor y qué tan vieja es (antigüedad del GPS), y las EXCEPCIONES que piden a una persona (llegada sin confirmar por ubicación, sin señal de vida, escalado al jefe de tráfico, estadía excedida, GPS obsoleto). Ordenado: lo más urgente primero. Filtros opcionales por terminal y cliente (por nombre) y `vista` (todos | solo_excepciones). Máx. 15 viajes por respuesta; `total` es el conteo real tras los filtros. SOLO LECTURA.',
  {
    type: 'object',
    properties: {
      terminal: { type: 'string', maxLength: 80, description: 'Nombre de la terminal (se busca en el catálogo de la flota). Omítelo para todas.' },
      cliente: { type: 'string', maxLength: 80, description: 'Nombre del cliente (se busca en el catálogo de la flota). Omítelo para todos.' },
      vista: { type: 'string', enum: ['todos', 'solo_excepciones'], description: 'solo_excepciones = solo los viajes con al menos una excepción (por omisión, todos).' },
    },
    additionalProperties: false,
  },
  async (args, ctx) => {
    const r = await tablero(args, ctx.tenantId);
    if ('aclarar' in r) return r.aclarar;
    const { t } = r;
    return {
      generadoEn: t.generadoEn,
      gpsDisponible: t.gpsDisponible,
      ...(t.gpsDisponible ? {} : { notaGps: 'No se pudieron leer las posiciones del GPS: NO afirmes que los tractores están sin señal; di que no se pudo consultar.' }),
      total: t.total, mostrando: Math.min(t.total, TOPE_FILAS), hayMasViajesActivosQueElTablero: t.hayMas,
      conteos: t.conteos,
      viajes: t.filas.slice(0, TOPE_FILAS).map(vistaFila),
      ver: '/dashboard/viajes-en-vivo',
    };
  });

registrar('detalle_viaje',
  'El detalle de UN viaje en curso por su folio: la línea de sus cinco hitos (qué ya pasó, qué falta), citas y ETA, última posición con su antigüedad y sus excepciones. Si el folio no es de un viaje en curso, lo dice. SOLO LECTURA.',
  { type: 'object', properties: { folio: { type: 'string', maxLength: 40, description: 'El folio del viaje tal como aparece en el tablero.' } }, required: ['folio'], additionalProperties: false },
  async (args, ctx) => {
    const folio = typeof args.folio === 'string' ? args.folio.trim().slice(0, 40) : '';
    if (!folio) return { error: 'folio_vacio', instruccion: 'Pídele a la persona el folio del viaje.' };
    const entrada = await fuentes().entradaTablero(ctx.tenantId, ahora());
    const t = armarTableroViajes(entrada);
    const f = t.filas.find((x) => x.folio !== null && x.folio.toLowerCase() === folio.toLowerCase());
    if (!f) return { encontrado: false, folio, nota: 'No hay un viaje EN CURSO con ese folio (puede estar liquidado, cancelado o no ser de esta flota). No inventes su estado.' };
    return {
      encontrado: true, gpsDisponible: t.gpsDisponible, ...vistaFila(f),
      linea: f.linea.map((h) => ({ hito: h.etiqueta, estado: h.estado, cuando: h.cuando, validacion: h.validacion, escaladoNivel: h.escaladoNivel || null })),
      citas: f.citas,
      ver: '/dashboard/agentes/conductores',
    };
  });

registrar('estado_vigia',
  'El estado del Vigía (servicio al cliente por WhatsApp): conversaciones esperando respuesta y cuáles ya pasaron su plazo (más corto para clientes con grupo crítico), clientes molestos, respuestas pendientes de aprobación, envíos que fallaron, tiempo de primera respuesta y los grupos de clientes. NO trae nombres de personas del cliente ni el texto de sus mensajes. SOLO LECTURA.',
  SIN_PARAMS,
  async (_a, ctx) => {
    const { datos, grupos } = await fuentes().vigia(ctx.tenantId, ahora());
    return resumirVigia(datos, grupos, ahora());
  });

registrar('estado_buzon',
  'El estado del buzón de facturas de proveedores (últimos 30 días): recibidas por estado, facturas por revisar, con error, hace cuánto llegó la última y las entregas al contador (entregadas, fallidas, rebotadas). SOLO LECTURA.',
  SIN_PARAMS,
  async (_a, ctx) => {
    const { conteo, entregas } = await fuentes().buzon(ctx.tenantId, ahora());
    return resumirBuzon(conteo, entregas, ahora());
  });

registrar('estado_cobranza',
  'El estado de la cobranza de comprobantes a choferes: viajes vigilados, cuántos se contactarán en la próxima corrida, cuántos no tienen teléfono, por nivel (tier), los más atrasados (folio y días) y, si existe, la efectividad de la cobranza por gasto. No trae teléfonos. SOLO LECTURA.',
  SIN_PARAMS,
  async (_a, ctx) => {
    const { cola, gastos } = await fuentes().cobranza(ctx.tenantId, ahora());
    return resumirCobranza(cola, gastos);
  });

registrar('estado_autofactura',
  'El estado de la autofactura de tickets: si la emisión real está encendida y sus topes, lotes por confirmar (monto, por vencer) y la fase de cada portal (supervisada o autónoma). SOLO LECTURA; confirmar un lote lo hace una persona en el panel.',
  SIN_PARAMS,
  async (_a, ctx) => {
    const { control, lotes, fases } = await fuentes().autofactura(ctx.tenantId);
    return resumirAutofactura(control, lotes, fases, ahora());
  });

registrar('salud_agentes',
  'La salud de los agentes: por cada uno (Conductor, Vigía, buzón, cobranza, peajes, autofactura, liquidación) si el proceso que lo despierta sigue latiendo, cómo terminó su última corrida de esta flota y los envíos que no salieron. ÚSALA cuando algo parezca no estar pasando (un aviso que no llegó, un tablero sin movimiento) o cuando te pregunten si todo funciona; si un agente falla, díselo a la persona. SOLO LECTURA.',
  SIN_PARAMS,
  async (_a, ctx) => resumirSalud(await fuentes().salud(ctx.tenantId, ahora())));

registrar('escalar_a_persona',
  `ÚNICA acción del orquestador: deja una TAREA para una persona que sí decide. Úsala SIEMPRE que el tema sea delicado y NO lo resuelvas tú: una posible emergencia (chofer o tractor sin señal), una diferencia o disputa de liquidación, un cliente molesto, una duda fiscal, o la falla de un agente. No manda mensajes, no cambia el viaje ni mueve dinero: solo avisa a la persona. Destinos: ${DESTINOS.join(', ')}. Después de escalar, dile a quien preguntó a quién se lo pasaste.`,
  {
    type: 'object',
    properties: {
      destino: { type: 'string', enum: [...DESTINOS], description: 'Quién debe decidir: mesa_de_control (emergencias y operación), liquidacion, jefe_de_trafico, contador.' },
      motivo: { type: 'string', enum: [...MOTIVOS], description: 'La categoría del tema.' },
      viaje_folio: { type: 'string', maxLength: 40, description: 'Folio del viaje, si aplica y lo conoces por una herramienta; no lo inventes.' },
      resumen: { type: 'string', maxLength: MAX_RESUMEN, description: 'Una o dos frases: qué pasa y qué necesita decidir la persona. Sin teléfonos ni datos personales.' },
    },
    required: ['destino', 'motivo', 'resumen'],
    additionalProperties: false,
  },
  async (args, ctx) => {
    const v = validarEscalacion(args);
    if (!v.ok) return { creada: false, error: v.error };
    const r = await fuentes().crearEscalacion(ctx.tenantId, v.valor, { rol: ctx.rol ?? 'desconocido', usuarioId: ctx.usuarioId ?? null });
    const quien = ETIQUETA_DESTINO[v.valor.destino];
    switch (r.estado) {
      case 'creada': return { creada: true, destino: v.valor.destino, mensajeParaLaPersona: `Dejé la tarea para ${quien}. Queda abierta en el tablero de viajes en vivo hasta que alguien la atienda.` };
      case 'ya_abierta': return { creada: false, yaAbierta: true, abiertaEn: r.creadaEn, destino: v.valor.destino, mensajeParaLaPersona: `Ya había una tarea abierta para ${quien} por esto mismo (desde ${r.creadaEn}); no abrí otra.` };
      case 'folio_no_encontrado': return { creada: false, error: 'folio_no_encontrado', instruccion: 'Ese folio no es de un viaje de esta flota. Pídele el folio correcto o escala sin folio.' };
      case 'no_disponible': return { creada: false, error: 'escalamiento_no_disponible', mensajeParaLaPersona: `No pude dejar la tarea: el escalamiento aún no está activo en esta cuenta. Avisa tú directamente a ${quien}.` };
    }
  });
