// ═══════════════════════════════════════════════════════════════════════════
// SESIONES MCP: LISTAR Y CORTAR (H3, auditoría de dashboards 29-ago-2026).
//
// Lo que se fija aquí NO es que el mock de Supabase funcione: es lo que el
// motor le MANDA y cómo reacciona a lo que vuelve —
//   · la lista solo trae lo VIVO (ni revocado ni expirado) y del tenant;
//   · «mis» clientes se filtran EN LA CONSULTA por user_id, no en memoria:
//     lo que no se pide no viaja, y lo que no viaja no se puede pintar de más;
//   · varias rotaciones de un mismo consentimiento son UNA conexión (familia);
//   · la revocación llama a `revocar_mcp_oauth_usuario` (0265) con el tenant
//     de la SESIÓN, y 0 filas tocadas NO es éxito (patrón `revocarLlaveApi`);
//   · un error de lectura LANZA en vez de volverse "no tienes nada conectado".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Registro = {
  tabla: string;
  select: string | null;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  gt: Array<[string, unknown]>;
  in: Array<[string, unknown]>;
  orden: Array<[string, unknown]>;
};

type Rpc = { nombre: string; args: unknown };

const llamadas: Registro[] = [];
const rpcs: Rpc[] = [];
const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();
let respuestaRpc: { data: unknown; error: { message: string } | null } = { data: 0, error: null };

function builder(tabla: string) {
  const r: Registro = { tabla, select: null, eq: [], is: [], gt: [], in: [], orden: [] };
  llamadas.push(r);
  const respuesta = () => respuestas.get(tabla) ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  b.select = (cols: string) => { r.select = cols; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.is = (c: string, v: unknown) => { r.is.push([c, v]); return b; };
  b.gt = (c: string, v: unknown) => { r.gt.push([c, v]); return b; };
  b.in = (c: string, v: unknown) => { r.in.push([c, v]); return b; };
  b.order = (c: string, o: unknown) => { r.orden.push([c, o]); return b; };
  // El builder de supabase-js es "thenable": las cadenas se esperan directo
  // (y `acotada` les hace Promise.race encima).
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(respuesta()).then(res, rej);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => builder(t),
    rpc: (nombre: string, args: unknown) => {
      rpcs.push({ nombre, args });
      return Promise.resolve(respuestaRpc);
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const bitacora = vi.fn(async () => undefined);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => bitacora(...(a as [])) }));

const { listarSesionesMcp, listarMisClientesMcp, revocarSesionesMcp } = await import('./sesiones');
const { DatoInvalido } = await import('@/lib/likida/errores');

const TENANT = 'flota-1';
const USUARIO = '11111111-2222-4333-8444-555555555555';
const OTRO = '99999999-8888-4777-8666-555555555555';

/** Un token vivo con los campos que la consulta lee. */
function token(p: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: USUARIO,
    rol: 'contador',
    familia: 'fam-1',
    emitido_en: '2026-08-20T10:00:00Z',
    expira_en: '2026-10-19T10:00:00Z',
    ultimo_uso_en: null,
    mcp_oauth_cliente: { nombre: 'Claude' },
    ...p,
  };
}

function consultaDeTokens(): Registro {
  return llamadas.find((l) => l.tabla === 'mcp_oauth_token')!;
}

beforeEach(() => {
  llamadas.length = 0;
  rpcs.length = 0;
  respuestas.clear();
  bitacora.mockClear();
  respuestaRpc = { data: 0, error: null };
});

describe('listarMisClientesMcp — el aislamiento va en la consulta', () => {
  it('pide SOLO lo vivo, de MI tenant y de MI user_id', async () => {
    respuestas.set('mcp_oauth_token', { data: [token()], error: null });
    await listarMisClientesMcp(TENANT, USUARIO);

    const q = consultaDeTokens();
    expect(q.eq).toContainEqual(['tenant_id', TENANT]);
    // EL ancla del hallazgo: sin este eq, las filas de los demás usuarios de
    // la flota viajarían hasta aquí y bastaría un renglón mal pintado.
    expect(q.eq).toContainEqual(['user_id', USUARIO]);
    // Vivo = las DOS: ni revocado ni expirado.
    expect(q.is).toContainEqual(['revocado_en', null]);
    expect(q.gt.map(([c]) => c)).toContain('expira_en');
    // El hash NO se lee: no se enseña, no se compara, no tiene por qué viajar.
    expect(q.select).not.toContain('token_hash');
  });

  it('varias rotaciones del mismo consentimiento son UNA conexión', async () => {
    // Dos pares (acceso + refresco) de la misma familia: el consentimiento se
    // dio una vez y el cliente ya rotó. Son un renglón, no cuatro.
    respuestas.set('mcp_oauth_token', {
      data: [
        token({ emitido_en: '2026-08-25T10:00:00Z', expira_en: '2026-10-24T10:00:00Z', ultimo_uso_en: '2026-08-28T09:00:00Z' }),
        token({ emitido_en: '2026-08-25T10:00:00Z', expira_en: '2026-08-25T11:00:00Z' }),
        token({ emitido_en: '2026-08-20T10:00:00Z', expira_en: '2026-10-19T10:00:00Z', ultimo_uso_en: '2026-08-22T09:00:00Z' }),
      ],
      error: null,
    });

    const r = await listarMisClientesMcp(TENANT, USUARIO);
    expect(r).toHaveLength(1);
    expect(r[0].cliente).toBe('Claude');
    // «Otorgado» es la fecha MÁS VIEJA (cuándo empezó esto)…
    expect(r[0].otorgadoEn).toBe('2026-08-20T10:00:00Z');
    // …y «vence» la MÁS LEJANA (hasta cuándo alcanza sin refrescar).
    expect(r[0].expiraEn).toBe('2026-10-24T10:00:00Z');
    // El último uso es el más reciente de toda la familia.
    expect(r[0].ultimoUsoEn).toBe('2026-08-28T09:00:00Z');
  });

  it('dos clientes distintos son dos renglones, el más nuevo arriba', async () => {
    respuestas.set('mcp_oauth_token', {
      data: [
        token({ familia: 'fam-2', emitido_en: '2026-08-26T10:00:00Z', mcp_oauth_cliente: { nombre: 'ChatGPT' } }),
        token({ familia: 'fam-1', emitido_en: '2026-08-20T10:00:00Z' }),
      ],
      error: null,
    });

    const r = await listarMisClientesMcp(TENANT, USUARIO);
    expect(r.map((c) => c.cliente)).toEqual(['ChatGPT', 'Claude']);
  });

  it('sin nombre declarado el renglón existe igual — y `nunca` se queda null', async () => {
    respuestas.set('mcp_oauth_token', { data: [token({ mcp_oauth_cliente: null })], error: null });
    const r = await listarMisClientesMcp(TENANT, USUARIO);
    expect(r[0].cliente).toBeNull();
    expect(r[0].ultimoUsoEn).toBeNull();
  });

  it('un error de lectura LANZA — no se disfraza de "no tienes nada conectado"', async () => {
    respuestas.set('mcp_oauth_token', { data: null, error: { message: 'fetch failed' } });
    await expect(listarMisClientesMcp(TENANT, USUARIO)).rejects.toThrow(/listarMisClientesMcp: fetch failed/);
  });
});

describe('listarSesionesMcp — la vista de la flota, agrupada por usuario', () => {
  it('agrupa por usuario y resuelve nombre/correo del padrón DEL MISMO tenant', async () => {
    respuestas.set('mcp_oauth_token', {
      data: [
        token({ user_id: USUARIO, ultimo_uso_en: '2026-08-28T09:00:00Z' }),
        token({ user_id: OTRO, familia: 'fam-9', rol: 'encargado', mcp_oauth_cliente: [{ nombre: 'ChatGPT' }] }),
      ],
      error: null,
    });
    respuestas.set('app_user', {
      data: [
        { id: USUARIO, nombre: 'Ana Contadora', email: 'ana@flota.mx' },
        { id: OTRO, nombre: 'Beto Tráfico', email: 'beto@flota.mx' },
      ],
      error: null,
    });

    const r = await listarSesionesMcp(TENANT);
    expect(r).toHaveLength(2);
    // Quien usó su acceso más recientemente, arriba; el que nunca lo usó, al final.
    expect(r[0].userId).toBe(USUARIO);
    expect(r[0].nombre).toBe('Ana Contadora');
    expect(r[0].email).toBe('ana@flota.mx');
    expect(r[0].rol).toBe('contador');
    expect(r[1].userId).toBe(OTRO);
    // El embed llega como objeto o como arreglo de uno según la cardinalidad;
    // las dos formas dicen lo mismo.
    expect(r[1].clientes[0].cliente).toBe('ChatGPT');

    const q = consultaDeTokens();
    expect(q.eq).toContainEqual(['tenant_id', TENANT]);
    // Sin `user_id`: aquí SÍ se piden los de todos… pero solo los de ESTA flota.
    expect(q.eq.map(([c]) => c)).not.toContain('user_id');

    // El padrón se lee anclado al MISMO tenant: un id que no sea de esta flota
    // no resuelve nombre, y por tanto no se puede pintar prestado.
    const padron = llamadas.find((l) => l.tabla === 'app_user')!;
    expect(padron.eq).toContainEqual(['tenant_id', TENANT]);
    expect(padron.in).toContainEqual(['id', [USUARIO, OTRO]]);
  });

  it('sin tokens vivos no se consulta el padrón siquiera', async () => {
    respuestas.set('mcp_oauth_token', { data: [], error: null });
    expect(await listarSesionesMcp(TENANT)).toEqual([]);
    expect(llamadas.some((l) => l.tabla === 'app_user')).toBe(false);
  });

  it('un usuario que ya no está en el padrón se enseña igual — con el acceso vivo', async () => {
    // Si no se pintara, el acceso quedaría vivo y ADEMÁS invisible: justo el
    // hallazgo que esta pantalla existe para cerrar.
    respuestas.set('mcp_oauth_token', { data: [token()], error: null });
    respuestas.set('app_user', { data: [], error: null });

    const r = await listarSesionesMcp(TENANT);
    expect(r).toHaveLength(1);
    expect(r[0].userId).toBe(USUARIO);
    expect(r[0].nombre).toBeNull();
    expect(r[0].clientes).toHaveLength(1);
  });

  it('un error de lectura LANZA', async () => {
    respuestas.set('mcp_oauth_token', { data: null, error: { message: 'fetch failed' } });
    await expect(listarSesionesMcp(TENANT)).rejects.toThrow(/listarSesionesMcp: fetch failed/);
  });
});

describe('revocarSesionesMcp — el primer llamador de la 0265', () => {
  it('llama a la RPC con el tenant de la sesión y el usuario pedido', async () => {
    respuestaRpc = { data: 3, error: null };
    const n = await revocarSesionesMcp(TENANT, USUARIO, 'actor-1');

    expect(n).toBe(3);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nombre).toBe('revocar_mcp_oauth_usuario');
    // EL ancla del aislamiento: `p_tenant` sale de la sesión, no del formulario.
    expect(rpcs[0].args).toEqual({ p_tenant: TENANT, p_usuario: USUARIO });
    expect(bitacora).toHaveBeenCalledTimes(1);
  });

  it('AISLAMIENTO: con el uuid de un usuario de OTRA flota la RPC toca 0 filas y esto LANZA', async () => {
    // La 0265 filtra por `tenant_id = p_tenant` en su propio `where`, así que
    // un id ajeno devuelve 0. Sin mirar el conteo, la pantalla diría "cortado"
    // sobre un acceso que sigue vivo — y sobre credenciales esa es la peor
    // mentira posible (mismo patrón que `revocarLlaveApi`).
    respuestaRpc = { data: 0, error: null };
    await expect(revocarSesionesMcp(TENANT, OTRO)).rejects.toThrow(DatoInvalido);
    // Y no queda una anotación de bitácora que afirme algo que no pasó.
    expect(bitacora).not.toHaveBeenCalled();
  });

  it('un bigint devuelto como cadena cuenta igual', async () => {
    respuestaRpc = { data: '2', error: null };
    expect(await revocarSesionesMcp(TENANT, USUARIO)).toBe(2);
  });

  it('un error de la RPC lanza como fallo del sistema, no como DatoInvalido', async () => {
    respuestaRpc = { data: null, error: { message: 'permission denied' } };
    await expect(revocarSesionesMcp(TENANT, USUARIO)).rejects.toThrow(/revocarSesionesMcp: permission denied/);
  });

  it('un id que ni es uuid se rechaza sin gastar un viaje a la base', async () => {
    await expect(revocarSesionesMcp(TENANT, 'basura')).rejects.toThrow(DatoInvalido);
    expect(rpcs).toHaveLength(0);
  });
});
