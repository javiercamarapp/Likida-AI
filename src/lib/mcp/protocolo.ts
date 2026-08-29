// ═══════════════════════════════════════════════════════════════════════════
// EL PROTOCOLO — JSON-RPC 2.0 sobre Streamable HTTP, SIN estado.
//
// Implementado a mano y no con el SDK oficial a propósito: este servidor
// necesita CINCO métodos contestados con JSON simple y cada línea bajo el
// control del repo (fail-closed, español, cero dependencias nuevas).
// Streamable HTTP permite contestar un POST con `application/json` a secas;
// los streams del servidor no se ofrecen (405 en GET), que es exactamente el
// rumbo que la revisión 2026-07-28 hizo obligatorio al retirar el GET.
//
// ── LAS DOS GENERACIONES DE CLIENTES, Y CÓMO SE ATIENDEN A LA VEZ ────────
//
// · Los clientes de HOY (Claude y ChatGPT en producción) hablan las
//   revisiones 2025-03-26 / 2025-06-18: abren con `initialize`, mandan
//   `notifications/initialized` y usan `ping`. Todo eso se contesta.
// · La revisión VIGENTE (2026-07-28, changelog verificado el 28-ago-2026)
//   quitó el handshake: cada petición trae su versión en `_meta`, el
//   descubrimiento es `server/discover` (obligatorio para el servidor), cada
//   result lleva `resultType`, y `tools/list` lleva `ttlMs`/`cacheScope`.
//   Este servidor ya es stateless por construcción, así que servir a las dos
//   generaciones no cuesta estado: `server/discover` está implementado,
//   TODOS los results llevan `resultType: 'complete'` (los clientes viejos
//   ignoran campos que no conocen, y la propia spec les ordena tratar la
//   ausencia como 'complete'), y `tools/list` lleva sus campos de caché.
//
// SIN ESTADO A PROPÓSITO: no se emite `Mcp-Session-Id` ni se exige. Cada
// petición trae su Bearer y el Bearer trae la flota; una «sesión» solo
// agregaría un segundo lugar donde equivocarse sobre de quién son los datos.
// ═══════════════════════════════════════════════════════════════════════════

/** Revisiones que este servidor sabe atender, de la más nueva a la más
 *  vieja. Para lo que este servidor expone (solo tools, con
 *  `structuredContent`), las formas de 2025-03-26 → 2025-11-25 son
 *  idénticas; 2026-07-28 se atiende con los añadidos de arriba. */
export const VERSIONES_SOPORTADAS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'] as const;

/** Las que llegan por `initialize` (la 2026-07-28 ya no tiene handshake, así
 *  que jamás se contesta a un initialize con ella: un cliente que llama
 *  initialize es, por definición, de la generación anterior). */
export const VERSIONES_CON_INITIALIZE = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

export const INFO_SERVIDOR = {
  name: 'likida',
  title: 'Likida — los datos de tu flota',
  version: '1.0.0',
} as const;

export const INSTRUCCIONES_SERVIDOR =
  'Servidor de SOLO LECTURA sobre los datos de UNA flota de Likida (la de la credencial con la que te conectaste). ' +
  'Las cifras salen de los mismos motores que el panel; cuando un dato no existe, las herramientas lo dicen — nunca lo rellenan con ceros. ' +
  'Nada se puede escribir, cerrar, timbrar ni enviar desde aquí: esas acciones se firman en el panel de Likida.';

/** Cuánto puede cachear un cliente 2026-07-28 el `tools/list` (el catálogo
 *  solo cambia con un deploy) — y `private` porque la respuesta viaja con
 *  credencial: ningún intermediario compartido debe guardarla. */
export const TOOLS_LIST_TTL_MS = 3_600_000;

// ── JSON-RPC 2.0 ───────────────────────────────────────────────────────────

export interface PeticionRpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export type RespuestaRpc =
  | { jsonrpc: '2.0'; id: string | number; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } };

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** 2026-07-28 (política de códigos): versión de protocolo no soportada. */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

export function respuestaOk(id: string | number, result: Record<string, unknown>): RespuestaRpc {
  // `resultType` es obligatorio en 2026-07-28 y los clientes anteriores
  // deben ignorar campos desconocidos (y tratar su ausencia como
  // 'complete'): ponerlo SIEMPRE sirve a las dos generaciones.
  return { jsonrpc: '2.0', id, result: { ...result, resultType: 'complete' } };
}

export function respuestaError(id: string | number | null, code: number, message: string): RespuestaRpc {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * ¿El cuerpo es UNA petición JSON-RPC bien formada?
 *
 * Los lotes (arrays) se rechazan a propósito: la revisión 2025-06-18 los
 * quitó del protocolo, y aceptarlos «por si acaso» sería mantener un camino
 * que ningún cliente vigente ejercita y ninguna prueba cubre.
 */
export function leerPeticion(cuerpo: unknown):
  | { ok: true; peticion: PeticionRpc; esNotificacion: boolean }
  | { ok: false; error: RespuestaRpc } {
  if (Array.isArray(cuerpo)) {
    return { ok: false, error: respuestaError(null, RPC.INVALID_REQUEST, 'Este servidor no acepta lotes JSON-RPC (retirados del protocolo en 2025-06-18). Manda una petición por POST.') };
  }
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { ok: false, error: respuestaError(null, RPC.INVALID_REQUEST, 'El cuerpo tiene que ser un objeto JSON-RPC 2.0.') };
  }
  const p = cuerpo as Record<string, unknown>;
  if (p.jsonrpc !== '2.0' || typeof p.method !== 'string') {
    return { ok: false, error: respuestaError(null, RPC.INVALID_REQUEST, 'Falta `jsonrpc: "2.0"` o `method`.') };
  }
  const id = p.id;
  const esNotificacion = id === undefined;
  if (!esNotificacion && typeof id !== 'string' && typeof id !== 'number') {
    return { ok: false, error: respuestaError(null, RPC.INVALID_REQUEST, '`id` tiene que ser string o número.') };
  }
  return {
    ok: true,
    peticion: { jsonrpc: '2.0', id: esNotificacion ? undefined : (id as string | number), method: p.method, params: p.params },
    esNotificacion,
  };
}

/**
 * La versión declarada en `_meta` de una petición 2026-07-28, si viene.
 * `null` = no la declaró (cliente de la generación del handshake, o laxo).
 */
export function versionDeclarada(params: unknown): string | null {
  if (typeof params !== 'object' || params === null) return null;
  const meta = (params as Record<string, unknown>)._meta;
  if (typeof meta !== 'object' || meta === null) return null;
  const v = (meta as Record<string, unknown>)['io.modelcontextprotocol/protocolVersion'];
  return typeof v === 'string' ? v : null;
}

/** La versión que se le contesta a un `initialize` (generación 2025). */
export function negociarVersion(pedida: unknown): string {
  if (typeof pedida === 'string' && (VERSIONES_CON_INITIALIZE as readonly string[]).includes(pedida)) {
    return pedida;
  }
  // Desacuerdo: se ofrece la más nueva de la MISMA generación. Ofrecer
  // 2026-07-28 a un cliente que acaba de llamar initialize sería ofrecerle
  // una revisión en la que initialize no existe.
  return VERSIONES_CON_INITIALIZE[0];
}

export function resultadoInitialize(versionPedida: unknown): Record<string, unknown> {
  return {
    protocolVersion: negociarVersion(versionPedida),
    capabilities: {
      // Solo tools, y sin `listChanged`: el catálogo es estático por deploy.
      tools: {},
    },
    serverInfo: INFO_SERVIDOR,
    instructions: INSTRUCCIONES_SERVIDOR,
  };
}

/** `server/discover` — obligatorio en 2026-07-28: qué versiones, qué
 *  capacidades y quién soy, sin handshake. */
export function resultadoDiscover(): Record<string, unknown> {
  return {
    protocolVersions: [...VERSIONES_SOPORTADAS],
    capabilities: { tools: {} },
    serverInfo: INFO_SERVIDOR,
    instructions: INSTRUCCIONES_SERVIDOR,
  };
}
