/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// repo_correo.ts — el acceso a datos de la liquidación por correo (T-A1-13).
//
// Misma técnica que `repo.test.ts`: la base es un registrador de cadenas. Cada `.from()` anota los verbos aplicados y
// contesta lo que el caso programó (cola `respuestas`, o la función `comportamiento` cuando el caso necesita estado,
// como el índice único de las entregas). Todo es sintético: ningún nombre, correo ni importe reales.
// ═══════════════════════════════════════════════════════════════════════════

type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
const llamadas: Llamada[] = [];
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
let respuestas: Resp[] = [];
let comportamiento: ((l: Llamada) => Resp) | null = null;

function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'gte', 'gt', 'lt', 'or', 'is', 'not', 'order', 'range', 'limit', 'neq']) {
    b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  }
  const resolver = (): Resp => (comportamiento ? comportamiento(ll) : (respuestas.shift() ?? { data: [], error: null, count: 0 }));
  b.maybeSingle = async () => { ll.ops.push(['maybeSingle']); return resolver(); };
  b.single = async () => { ll.ops.push(['single']); return resolver(); };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
const upload = vi.fn(async (..._a: unknown[]): Promise<{ error: { message: string } | null }> => ({ error: null }));
const createSignedUrl = vi.fn(async (..._a: unknown[]): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> => ({ data: { signedUrl: 'https://firmada' }, error: null }));
const bucketsUsados: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: constructor,
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return respuestas.shift() ?? { data: [], error: null }; },
    storage: { from: (b: string) => { bucketsUsados.push(b); return { upload, createSignedUrl }; } },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const r = await import('./repo_correo');
const { DatoInvalido } = await import('../errores');

const T = 'tenant-sintetico-1';
const OTRO = 'tenant-sintetico-2';
const LIQ = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const AHORA = new Date('2026-10-14T18:00:00.000Z');
const tieneEq = (l: Llamada, col: string, v: unknown) => l.ops.some((o) => o[0] === 'eq' && o[1] === col && o[2] === v);
const ausente = { data: null, error: { message: 'relation "x" does not exist', code: '42P01' } };

beforeEach(() => {
  llamadas.length = 0; rpcs.length = 0; respuestas = []; comportamiento = null; bucketsUsados.length = 0;
  upload.mockReset(); upload.mockResolvedValue({ error: null });
  createSignedUrl.mockReset(); createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://firmada' }, error: null });
});

describe('configuración de la flota', () => {
  it('sin fila ⇒ el defecto: WhatsApp, inactiva (cero cambio para quien no configuró nada)', async () => {
    respuestas = [{ data: null, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c).toEqual({ ok: true, valor: expect.objectContaining({ canal: 'whatsapp', activa: false, rhCorreos: [], netoNegativo: 'retener' }) });
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
  });

  it('con fila ⇒ la traduce', async () => {
    respuestas = [{ data: { canal: 'correo', activa: true, rh_correos: ['rh@ejemplo.test'], envia_rh: false, enviar_desde_hora: 12, neto_negativo: 'enviar' }, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor).toMatchObject({ canal: 'correo', activa: true, rhCorreos: ['rh@ejemplo.test'], enviaRh: false, enviarDesdeHora: 12, netoNegativo: 'enviar' });
  });

  it('tabla ausente (42P01) o fuera del esquema (PGRST205) ⇒ no_disponible, sin lanzar', async () => {
    respuestas = [ausente];
    expect(await r.leerConfigCorreo(T)).toEqual({ ok: false, motivo: 'no_disponible' });
    respuestas = [{ data: null, error: { message: 'x', code: 'PGRST205' } }];
    expect(await r.leerConfigCorreo(T)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('A37-S49-01: al activar el envío con «Responder a», las entregas pendientes de la flota se adelantan a ya', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }, { data: [], error: null }];
    await r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, responderA: 'nomina@ejemplo.test' }, 'oficina');
    const adelanto = llamadas.find((l) => l.tabla === 'liquidacion_entrega_correo')!;
    expect(adelanto).toBeDefined();
    expect(tieneEq(adelanto, 'tenant_id', T)).toBe(true);
    expect(tieneEq(adelanto, 'estado', 'pendiente')).toBe(true);
    expect(adelanto.ops.some((o) => o[0] === 'update')).toBe(true);
  });

  it('A37-S49-01: apagado no adelanta nada', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: false }, 'oficina');
    expect(llamadas.some((l) => l.tabla === 'liquidacion_entrega_correo')).toBe(false);
  });

  it('un error que NO es ausencia (base caída) LANZA: no se lee como «sin configuración»', async () => {
    respuestas = [{ data: null, error: { message: 'conexión rota' } }];
    await expect(r.leerConfigCorreo(T)).rejects.toThrow(/conexión rota/);
  });

  it('guardar: upsert anclado al tenant, correos normalizados; más de 3 RH o correo inválido ⇒ DatoInvalido', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'ambos', rhCorreos: ['  RH@Ejemplo.TEST '] }, 'oficina');
    const up = llamadas[0].ops.find((o) => o[0] === 'upsert')!;
    expect(up[1]).toMatchObject({ tenant_id: T, canal: 'ambos', rh_correos: ['rh@ejemplo.test'], actualizado_por: 'oficina' });
    await expect(r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, rhCorreos: ['a@e.test', 'b@e.test', 'c@e.test', 'd@e.test'] }, null)).rejects.toBeInstanceOf(DatoInvalido);
    await expect(r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, archivoCorreo: 'sin-arroba' }, null)).rejects.toBeInstanceOf(DatoInvalido);
    await expect(r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, enviarDesdeHora: 24 }, null)).rejects.toBeInstanceOf(DatoInvalido);
    // A37-A1-04: no se activa el envío por correo sin «Responder a» (las respuestas del operador caerían en el buzón de campañas)
    await expect(r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, responderA: null }, null)).rejects.toThrow(/responder_a/);
    await expect(r.guardarConfigCorreo(T, { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'ambos', activa: true, responderA: '  ' }, null)).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('guardar contra una base sin migraciones LANZA y nombra la migración (nunca finge haber guardado)', async () => {
    respuestas = [ausente];
    await expect(r.guardarConfigCorreo(T, r.CONFIG_CORREO_POR_DEFECTO, null)).rejects.toThrow(/0785-0787/);
  });
});

describe('contacto del operador y coordinadores', () => {
  it('leer: filtra por tenant e id; operador inexistente ⇒ null; tabla ausente ⇒ no_disponible', async () => {
    respuestas = [{ data: { id: 'op-1', correo: 'op@ejemplo.test', correo_rebotado_en: null, coordinador_id: 'co-1' }, error: null }];
    const c = await r.leerContactoOperador(T, 'op-1');
    expect(c).toEqual({ ok: true, valor: { operadorId: 'op-1', correo: 'op@ejemplo.test', correoRebotadoEn: null, coordinadorId: 'co-1' } });
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
    expect(tieneEq(llamadas[0], 'id', 'op-1')).toBe(true);
    respuestas = [{ data: null, error: null }];
    expect(await r.leerContactoOperador(T, 'op-9')).toEqual({ ok: true, valor: null });
    respuestas = [ausente];
    expect(await r.leerContactoOperador(T, 'op-1')).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('guardar: correo nuevo normalizado y borra el rebote anterior; ancla tenant+id; operador ajeno ⇒ DatoInvalido', async () => {
    respuestas = [{ data: [{ id: 'op-1' }], error: null }];
    await r.guardarContactoOperador(T, 'op-1', { correo: ' OP@Ejemplo.test ' });
    const set = llamadas[0].ops.find((o) => o[0] === 'update')![1];
    expect(set).toEqual({ correo: 'op@ejemplo.test', correo_rebotado_en: null });
    expect(tieneEq(llamadas[0], 'tenant_id', T) && tieneEq(llamadas[0], 'id', 'op-1')).toBe(true);
    respuestas = [{ data: [], error: null }];
    await expect(r.guardarContactoOperador(T, 'op-de-otra-flota', { coordinadorId: 'co-1' })).rejects.toBeInstanceOf(DatoInvalido);
    await expect(r.guardarContactoOperador(T, 'op-1', { correo: 'no es correo' })).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('coordinadores: lista anclada al tenant; correo repetido ⇒ DatoInvalido, no un 500', async () => {
    respuestas = [{ data: [{ id: 'co-1', nombre: null, correo: 'co@ejemplo.test', activo: true }], error: null }];
    const l = await r.listarCoordinadores(T);
    expect(l).toEqual({ ok: true, valor: [{ id: 'co-1', nombre: null, correo: 'co@ejemplo.test', activo: true }] });
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
    respuestas = [{ data: null, error: { message: 'duplicate key value', code: '23505' } }];
    await expect(r.guardarCoordinador(T, { correo: 'co@ejemplo.test' })).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('coordinadores: editar ancla tenant+id; el de otra flota (sin fila) ⇒ DatoInvalido', async () => {
    respuestas = [{ data: null, error: null }];
    await expect(r.guardarCoordinador(T, { id: 'co-de-otra-flota', correo: 'co@ejemplo.test' })).rejects.toBeInstanceOf(DatoInvalido);
    expect(tieneEq(llamadas[0], 'tenant_id', T) && tieneEq(llamadas[0], 'id', 'co-de-otra-flota')).toBe(true);
  });
});

describe('encabezado del desglose', () => {
  it('insertar: una fila por liquidación; reintento (clave duplicada) ⇒ false, sin lanzar ni pisar', async () => {
    respuestas = [{ data: [{ liquidacion_externa_id: LIQ }], error: null }, { data: null, error: { message: 'duplicate', code: '23505' } }];
    const meta = { liquidacionExternaId: LIQ, bitacora: '1228', terminal: 'T1', totalOrigen: 'tms' as const };
    expect(await r.insertarDesglose(T, meta)).toBe(true);
    expect(await r.insertarDesglose(T, meta)).toBe(false);
    const fila = llamadas[0].ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>;
    expect(fila).toMatchObject({ tenant_id: T, bitacora: '1228', terminal: 'T1', poliza: null, total_origen: 'tms' });
  });

  it('listar: keyset, pide limite+1 para saber si hay más y entrega el cursor; todo anclado al tenant', async () => {
    const f = (i: number) => ({ liquidacion_externa_id: `id-${i}`, bitacora: String(i), total_origen: 'tms', created_at: `2026-10-0${i}T00:00:00Z` });
    respuestas = [{ data: [f(3), f(2), f(1)], error: null }];
    const p = await r.listarDesgloses(T, { limite: 2, soloRetenidos: true });
    expect(p.ok && p.valor.items.map((d) => d.bitacora)).toEqual(['3', '2']);
    expect(p.ok && p.valor.siguiente).toEqual({ creadoEn: '2026-10-02T00:00:00Z', id: 'id-2' });
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
    expect(llamadas[0].ops).toContainEqual(['limit', 3]);
    expect(llamadas[0].ops.some((o) => o[0] === 'not' && o[1] === 'retenida_motivo')).toBe(true);
    respuestas = [{ data: [f(1)], error: null }];
    const ultima = await r.listarDesgloses(T, {}, { creadoEn: '2026-10-02T00:00:00Z', id: 'id-2' });
    expect(ultima.ok && ultima.valor.siguiente).toBeNull();
    expect(llamadas[1].ops.some((o) => o[0] === 'or' && String(o[1]).includes('2026-10-02T00:00:00Z'))).toBe(true);
    respuestas = [ausente];
    expect(await r.listarDesgloses(T)).toEqual({ ok: false, motivo: 'no_disponible' });
  });
});

describe('entregas por correo', () => {
  /** Una «tabla» con el índice único (liquidación, generación, rol, lower(correo)) de la 0787. */
  function tablaConIndiceUnico() {
    const filas: Array<Record<string, unknown>> = [];
    const llave = (f: Record<string, unknown>) => [f.liquidacion_externa_id, f.generacion, f.rol, String(f.correo).toLowerCase()].join('|');
    comportamiento = (l) => {
      const ins = l.ops.find((o) => o[0] === 'insert');
      if (!ins) return { data: [], error: null };
      const lote = (Array.isArray(ins[1]) ? ins[1] : [ins[1]]) as Array<Record<string, unknown>>;
      const claves = new Set(filas.map(llave));
      const nuevas = new Set<string>();
      for (const f of lote) { const k = llave(f); if (claves.has(k) || nuevas.has(k)) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }; nuevas.add(k); }
      filas.push(...lote);
      return { data: lote.map((_, i) => ({ id: `e-${filas.length}-${i}` })), error: null };
    };
    return filas;
  }

  const destinos = [
    { liquidacionExternaId: LIQ, rol: 'operador' as const, correo: 'Op@Ejemplo.test' },
    { liquidacionExternaId: LIQ, rol: 'coordinador' as const, correo: 'co@ejemplo.test' },
    { liquidacionExternaId: LIQ, rol: 'rh' as const, correo: 'rh@ejemplo.test' },
    { liquidacionExternaId: LIQ, rol: 'archivo' as const, correo: 'archivo@ejemplo.test' },
  ];

  it('insertarEntregas dos veces ⇒ UNA fila por destinatario (la segunda crea 0)', async () => {
    const filas = tablaConIndiceUnico();
    expect(await r.insertarEntregas(T, destinos)).toBe(4);
    expect(await r.insertarEntregas(T, destinos)).toBe(0);
    expect(filas).toHaveLength(4);
    expect(filas.every((f) => f.tenant_id === T)).toBe(true);
    expect(filas.map((f) => f.correo)).toContain('op@ejemplo.test'); // normalizado: mayúsculas no abren otro destinatario
  });

  it('un lote que choca por UN destinatario no tira a los nuevos', async () => {
    const filas = tablaConIndiceUnico();
    await r.insertarEntregas(T, destinos.slice(0, 2));
    expect(await r.insertarEntregas(T, destinos)).toBe(2);
    expect(filas).toHaveLength(4);
  });

  it('lote vacío ⇒ 0 sin tocar la base; correo vacío ⇒ DatoInvalido', async () => {
    expect(await r.insertarEntregas(T, [])).toBe(0);
    expect(llamadas).toHaveLength(0);
    await expect(r.insertarEntregas(T, [{ liquidacionExternaId: LIQ, rol: 'rh', correo: '  ' }])).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('reclamarEntregas: RPC 0787 con límite, instante y lease; tabla/función ausente ⇒ no_disponible', async () => {
    respuestas = [{ data: [{ id: 'e-1', tenant_id: T, liquidacion_externa_id: LIQ, generacion: 1, rol: 'rh', correo: 'rh@ejemplo.test', estado: 'enviando', intentos: 0, proximo_intento_en: 'x', claim_token: 'tok', disparo: 'auto', created_at: 'x' }], error: null }];
    const l = await r.reclamarEntregas(20, AHORA);
    expect(rpcs).toEqual([{ fn: 'reclamar_entregas_correo', args: { p_limite: 20, p_ahora: AHORA.toISOString(), p_lease_seg: 120 } }]);
    expect(l.ok && l.valor[0]).toMatchObject({ id: 'e-1', tenantId: T, rol: 'rh', claimToken: 'tok' });
    respuestas = [{ data: null, error: { message: 'function does not exist', code: '42883' } }];
    expect(await r.reclamarEntregas(20, AHORA)).toEqual({ ok: false, motivo: 'no_disponible' });
    respuestas = [{ data: null, error: { message: 'p_limite fuera de 1..500' } }];
    await expect(r.reclamarEntregas(0, AHORA)).rejects.toThrow(/p_limite/);
  });

  it('marcarEnviada: UPDATE condicionado a tenant, id, estado enviando Y el token del lease; sin fila ⇒ false', async () => {
    respuestas = [{ data: [{ id: 'e-1' }], error: null }, { data: [], error: null }];
    expect(await r.marcarEnviada(T, 'e-1', 'tok', 're_123', AHORA)).toBe(true);
    const l = llamadas[0];
    expect(tieneEq(l, 'tenant_id', T) && tieneEq(l, 'id', 'e-1') && tieneEq(l, 'claim_token', 'tok')).toBe(true);
    expect(l.ops).toContainEqual(['in', 'estado', ['enviando']]);
    expect(l.ops.find((o) => o[0] === 'update')![1]).toMatchObject({ estado: 'enviada', resend_id: 're_123', claim_token: null, claim_expira_en: null });
    expect(await r.marcarEnviada(T, 'e-1', 'token-viejo', 're_9', AHORA)).toBe(false);
  });

  it('entregada/rebotada/fallida/omitida/reprogramar: cada una con SU conjunto de estados de partida y el tenant', async () => {
    respuestas = Array.from({ length: 6 }, () => ({ data: [{ id: 'e-1' }], error: null }));
    await r.marcarEntregada(T, 'e-1', AHORA);
    await r.marcarRebotada(T, 'e-1', AHORA, 'buzón lleno');
    await r.marcarFallida(T, 'e-1', 'tok', 'x'.repeat(5000));
    await r.marcarOmitida(T, 'e-1', 'archivo desactivado');
    await r.reprogramarEntrega(T, 'e-1', 'tok', 2, new Date('2026-10-14T18:04:00Z'), 'HTTP 429');
    const desde = llamadas.map((l) => l.ops.find((o) => o[0] === 'in')![2]);
    expect(desde).toEqual([['enviada'], ['enviada', 'entregada'], ['enviando', 'pendiente'], ['pendiente', 'enviando'], ['enviando']]);
    expect(llamadas.every((l) => tieneEq(l, 'tenant_id', T))).toBe(true);
    expect((llamadas[2].ops.find((o) => o[0] === 'update')![1] as { ultimo_error: string }).ultimo_error).toHaveLength(1000);
    expect(llamadas[4].ops.find((o) => o[0] === 'update')![1]).toMatchObject({ estado: 'pendiente', intentos: 2, claim_token: null });
  });

  it('entregasDe: anclada a tenant Y liquidación', async () => {
    respuestas = [{ data: [{ id: 'e-1', tenant_id: T, liquidacion_externa_id: LIQ, generacion: 1, rol: 'rh', correo: 'rh@ejemplo.test', estado: 'enviada', intentos: 1, proximo_intento_en: 'x', disparo: 'auto', created_at: 'x' }], error: null }];
    const l = await r.entregasDe(T, LIQ);
    expect(l.ok && l.valor).toHaveLength(1);
    expect(tieneEq(llamadas[0], 'tenant_id', T) && tieneEq(llamadas[0], 'liquidacion_externa_id', LIQ)).toBe(true);
    respuestas = [ausente];
    expect(await r.entregasDe(T, LIQ)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('una escritura con error de base LANZA (no devuelve false como si «ya estaba»)', async () => {
    respuestas = [{ data: null, error: { message: 'timeout' } }];
    await expect(r.marcarEntregada(T, 'e-1', AHORA)).rejects.toThrow(/timeout/);
  });
});

describe('excepciones', () => {
  it('abrir: si ya hay una abierta solo refresca ultima_vez (no crea otra)', async () => {
    respuestas = [{ data: [{ id: 7 }], error: null }];
    expect(await r.abrirExcepcion(T, 'T1-1228', 'sin_poliza', { motivo: 'sin póliza' }, AHORA)).toEqual({ id: 7, nueva: false });
    expect(llamadas).toHaveLength(1);
    const l = llamadas[0];
    expect(tieneEq(l, 'tenant_id', T) && tieneEq(l, 'clave_externa', 'T1-1228') && tieneEq(l, 'tipo', 'sin_poliza')).toBe(true);
    expect(l.ops.some((o) => o[0] === 'is' && o[1] === 'resuelta_en' && o[2] === null)).toBe(true);
  });

  it('abrir: sin abierta previa inserta; si otra corrida la abrió en medio (23505) refresca esa', async () => {
    respuestas = [{ data: [], error: null }, { data: [{ id: 8 }], error: null }];
    expect(await r.abrirExcepcion(T, 'T1-1', 'neto_negativo', {}, AHORA)).toEqual({ id: 8, nueva: true });
    expect(llamadas[1].ops.find((o) => o[0] === 'insert')![1]).toMatchObject({ tenant_id: T, clave_externa: 'T1-1', tipo: 'neto_negativo' });
    llamadas.length = 0;
    respuestas = [{ data: [], error: null }, { data: null, error: { message: 'duplicate', code: '23505' } }, { data: [{ id: 9 }], error: null }];
    expect(await r.abrirExcepcion(T, 'T1-1', 'neto_negativo', {}, AHORA)).toEqual({ id: 9, nueva: false });
  });

  it('resolver: solo una abierta de ESTA flota; listar: por defecto solo abiertas', async () => {
    respuestas = [{ data: [{ id: 7 }], error: null }, { data: [], error: null }];
    expect(await r.resolverExcepcion(T, 7, AHORA)).toBe(true);
    expect(await r.resolverExcepcion(OTRO, 7, AHORA)).toBe(false);
    expect(tieneEq(llamadas[0], 'tenant_id', T) && tieneEq(llamadas[1], 'tenant_id', OTRO)).toBe(true);
    respuestas = [{ data: [{ id: 7, clave_externa: 'T1-1', tipo: 'sin_poliza', detalle: {}, primera_vez: 'a', ultima_vez: 'b', resuelta_en: null }], error: null }];
    const l = await r.listarExcepciones(T);
    expect(l.ok && l.valor[0]).toMatchObject({ id: 7, tipo: 'sin_poliza' });
    expect(llamadas[2].ops.some((o) => o[0] === 'is' && o[1] === 'resuelta_en')).toBe(true);
    respuestas = [ausente];
    expect(await r.listarExcepciones(T)).toEqual({ ok: false, motivo: 'no_disponible' });
  });
});

describe('cursor del pull', () => {
  it('leer: sin fila ⇒ estado vacío con cursor null; con fila ⇒ cursor válido', async () => {
    respuestas = [{ data: null, error: null }, { data: { cursor: { desde: '2026-10-13T00:00:00Z', despuesDe: 'b-9' }, leidas: 5, importadas: 4, excepciones: 1 }, error: null }];
    const vacio = await r.leerCursorPull(T);
    expect(vacio.ok && vacio.valor).toMatchObject({ cursor: null, leidas: 0 });
    const lleno = await r.leerCursorPull(T);
    expect(lleno.ok && lleno.valor).toMatchObject({ cursor: { desde: '2026-10-13T00:00:00Z', despuesDe: 'b-9' }, leidas: 5, importadas: 4 });
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
  });

  it('guardar: éxito avanza el cursor; una corrida FALLIDA no lo toca (se re-lee)', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }, { data: [{ tenant_id: T }], error: null }];
    await r.guardarCursorPull(T, { cursor: { desde: 'd', despuesDe: 'x' }, ahora: AHORA, exito: true, leidas: 3, importadas: 3, excepciones: 0 });
    await r.guardarCursorPull(T, { cursor: { desde: 'NO', despuesDe: 'NO' }, ahora: AHORA, exito: false, error: 'TMS caído', leidas: 0, importadas: 0, excepciones: 0 });
    const ok = llamadas[0].ops.find((o) => o[0] === 'upsert')![1] as Record<string, unknown>;
    const mal = llamadas[1].ops.find((o) => o[0] === 'upsert')![1] as Record<string, unknown>;
    expect(ok).toMatchObject({ tenant_id: T, cursor: { desde: 'd', despuesDe: 'x' }, ultimo_error: null, ultimo_exito: AHORA.toISOString() });
    expect(mal).toMatchObject({ tenant_id: T, ultimo_error: 'TMS caído' });
    expect('cursor' in mal).toBe(false);
    expect('ultimo_exito' in mal).toBe(false);
  });
});

describe('conteos para insights', () => {
  it('cuenta desgloses, entregas por estado y excepciones abiertas; todo con tenant y periodo', async () => {
    respuestas = [
      { data: null, error: null, count: 12 },
      { data: [{ estado: 'enviada' }, { estado: 'enviada' }, { estado: 'rebotada' }], error: null, count: 3 },
      { data: null, error: null, count: 2 },
    ];
    const c = await r.contarParaInsights(T, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'));
    expect(c).toEqual({ ok: true, valor: { desgloses: 12, entregasPorEstado: { enviada: 2, rebotada: 1 }, excepcionesAbiertas: 2 } });
    expect(llamadas.map((l) => tieneEq(l, 'tenant_id', T))).toEqual([true, true, true]);
    expect(llamadas[0].ops.some((o) => o[0] === 'gte' && o[1] === 'created_at')).toBe(true);
    expect(llamadas[0].ops.some((o) => o[0] === 'lt' && o[1] === 'created_at')).toBe(true);
  });

  it('tabla ausente ⇒ no_disponible; error real ⇒ lanza', async () => {
    respuestas = [ausente];
    expect(await r.contarParaInsights(T, AHORA, AHORA)).toEqual({ ok: false, motivo: 'no_disponible' });
    respuestas = [{ data: null, error: { message: 'timeout' } }];
    await expect(r.contarParaInsights(T, AHORA, AHORA)).rejects.toThrow(/timeout/);
  });
});

describe('Storage del Excel', () => {
  it('la ruta cuelga de la carpeta del tenant, direccionada por contenido, y una clave hostil no se sale', async () => {
    const ruta = await r.subirXlsx(T, '../../' + OTRO + '/x', 'a'.repeat(64), new Uint8Array([1, 2, 3]));
    expect(ruta.startsWith(`${T}/`)).toBe(true);
    expect(ruta.endsWith('.xlsx')).toBe(true);
    expect(ruta).not.toContain('..');
    expect(ruta).not.toContain(OTRO);
    expect(ruta).toBe(r.rutaXlsxDesglose(T, '../../' + OTRO + '/x', 'a'.repeat(64)));
    expect(r.rutaXlsxDesglose(T, 'T1-1228', 'a'.repeat(64))).not.toBe(r.rutaXlsxDesglose(T, 'T1-1228', 'b'.repeat(64)));
    expect(bucketsUsados).toEqual(['liquidaciones']);
    expect(upload.mock.calls[0][0]).toBe(ruta);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: expect.stringContaining('spreadsheetml') });
  });

  it('firmar: rutas de otra flota, con «..» o que no son .xlsx se rechazan SIN llamar a Storage', async () => {
    await expect(r.firmarXlsx(T, `${OTRO}/externas/a.xlsx`, 60)).rejects.toBeInstanceOf(DatoInvalido);
    await expect(r.firmarXlsx(T, `${T}/../${OTRO}/externas/a.xlsx`, 60)).rejects.toBeInstanceOf(DatoInvalido);
    await expect(r.firmarXlsx(T, `${T}/externas/a.pdf`, 60)).rejects.toBeInstanceOf(DatoInvalido);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(await r.firmarXlsx(T, `${T}/externas/a.xlsx`, 60, 'desglose.xlsx')).toBe('https://firmada');
    expect(createSignedUrl).toHaveBeenCalledWith(`${T}/externas/a.xlsx`, 60, { download: 'desglose.xlsx' });
  });

  it('un fallo de subida LANZA (sin ruta, sin fila: el llamador no inserta nada)', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'bucket caído' } });
    await expect(r.subirXlsx(T, 'T1-1', 'c'.repeat(64), new Uint8Array([1]))).rejects.toThrow(/bucket caído/);
  });
});

describe('noticia de entrega del proveedor (T-A1-18)', () => {
  const ENT = (estado: string, rol = 'operador') => ({
    id: 'ent-1', tenant_id: T, liquidacion_externa_id: LIQ, generacion: 1, rol, correo: 'Operador@Ejemplo.test', estado, intentos: 0,
    proximo_intento_en: AHORA.toISOString(), claim_token: null, claim_expira_en: null, resend_id: 're_1', ultimo_error: null,
    disparo: 'auto', xlsx_ruta: null, xlsx_sha256: null, enviada_en: null, entregada_en: null, rebotada_en: null, created_at: AHORA.toISOString(),
  });
  const LIQUIDACION = { id: LIQ, tenant_id: T, clave_externa: 'BIT-SINT-1', operador_id: 'op-1' };
  const sets = (l: Llamada) => l.ops.find((o) => o[0] === 'update')?.[1] as Record<string, unknown> | undefined;

  /** Base en memoria mínima: la entrega, la liquidación, el operador y las excepciones; el UPDATE respeta `.in('estado')`. */
  function base(estadoInicial: string, rol = 'operador', operadorCasa = true) {
    const e = ENT(estadoInicial, rol) as Record<string, unknown>;
    const excepciones: Array<Record<string, unknown>> = [];
    const operador = { marcado: null as string | null };
    comportamiento = (l) => {
      const eq = (c: string) => l.ops.find((o) => o[0] === 'eq' && o[1] === c)?.[2];
      if (l.tabla === 'liquidacion_entrega_correo') {
        if (l.ops.some((o) => o[0] === 'update')) {
          const desde = (l.ops.find((o) => o[0] === 'in')?.[2] as string[]) ?? [];
          if (!desde.includes(e.estado as string)) return { data: [], error: null };
          Object.assign(e, sets(l)); return { data: [{ id: 'ent-1' }], error: null };
        }
        return { data: e, error: null };
      }
      if (l.tabla === 'liquidacion_externa') return { data: LIQUIDACION, error: null };
      if (l.tabla === 'operador') {
        if (!operadorCasa) return { data: [], error: null };
        operador.marcado = String(sets(l)?.correo_rebotado_en); return { data: [{ id: eq('id') }], error: null };
      }
      if (l.tabla === 'liquidacion_excepcion') {
        if (l.ops.some((o) => o[0] === 'insert')) { excepciones.push(l.ops.find((o) => o[0] === 'insert')![1] as Record<string, unknown>); return { data: [{ id: 7 }], error: null }; }
        return { data: [], error: null };
      }
      return { data: [], error: null };
    };
    return { e, excepciones, operador };
  }

  it('id que no es de una entrega ⇒ sin_entrega, sin escribir nada', async () => {
    respuestas = [{ data: null, error: null }];
    expect(await r.confirmarEntregaCorreo('re_x', 'entregada', AHORA)).toEqual({ resultado: 'sin_entrega' });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].ops.some((o) => o[0] === 'update')).toBe(false);
  });

  it('sin la migración 0787 ⇒ sin_entrega (el webhook sigue su flujo de siempre), no lanza', async () => {
    respuestas = [ausente];
    expect(await r.confirmarEntregaCorreo('re_x', 'rebotada', AHORA)).toEqual({ resultado: 'sin_entrega' });
  });

  it('entregada: escribe solo sobre «enviada» y la repetición no cambia nada', async () => {
    const b = base('enviada');
    expect(await r.confirmarEntregaCorreo('re_1', 'entregada', AHORA)).toMatchObject({ resultado: 'aplicada', rol: 'operador' });
    expect(b.e).toMatchObject({ estado: 'entregada', entregada_en: AHORA.toISOString() });
    expect(await r.confirmarEntregaCorreo('re_1', 'entregada', AHORA)).toMatchObject({ resultado: 'sin_cambio' });
  });

  it('entregada tardía NO pisa a una rebotada ni a una queja', async () => {
    for (const malo of ['rebotada', 'queja']) {
      const b = base(malo);
      expect(await r.confirmarEntregaCorreo('re_1', 'entregada', AHORA)).toMatchObject({ resultado: 'sin_cambio' });
      expect(b.e.estado).toBe(malo);
    }
  });

  it('rebotada pisa a entregada; la queja también', async () => {
    const b = base('entregada', 'rh');
    expect(await r.confirmarEntregaCorreo('re_1', 'rebotada', AHORA)).toMatchObject({ resultado: 'aplicada' });
    expect(b.e).toMatchObject({ estado: 'rebotada', rebotada_en: AHORA.toISOString() });
    const c = base('entregada', 'rh');
    await r.confirmarEntregaCorreo('re_1', 'queja', AHORA);
    expect(c.e.estado).toBe('queja');
  });

  it('rebote del OPERADOR: marca operador.correo_rebotado_en (solo si es SU correo vigente) y abre operador_sin_correo', async () => {
    const b = base('enviada');
    const res = await r.confirmarEntregaCorreo('re_1', 'rebotada', AHORA);
    expect(res).toEqual({ resultado: 'aplicada', rol: 'operador', operadorMarcado: true });
    expect(b.operador.marcado).toBe(AHORA.toISOString());
    const llOp = llamadas.find((l) => l.tabla === 'operador')!;
    expect(tieneEq(llOp, 'tenant_id', T)).toBe(true);
    expect(tieneEq(llOp, 'id', 'op-1')).toBe(true);
    expect(tieneEq(llOp, 'correo', 'operador@ejemplo.test')).toBe(true);
    expect(b.excepciones).toHaveLength(1);
    expect(b.excepciones[0]).toMatchObject({ tenant_id: T, clave_externa: 'BIT-SINT-1', tipo: 'operador_sin_correo' });
    expect(JSON.stringify(b.excepciones[0])).not.toContain('Operador@Ejemplo');
    expect(JSON.stringify(b.excepciones[0])).not.toContain('operador@ejemplo');
  });

  it('rebote viejo (el operador ya cambió de correo): la entrega se marca, pero ni se marca al operador ni hay excepción', async () => {
    const b = base('enviada', 'operador', false);
    expect(await r.confirmarEntregaCorreo('re_1', 'rebotada', AHORA)).toEqual({ resultado: 'aplicada', rol: 'operador', operadorMarcado: false });
    expect(b.excepciones).toHaveLength(0);
  });

  it('rebote del coordinador o de RH: no toca al operador ni abre excepción', async () => {
    for (const rol of ['coordinador', 'rh']) {
      llamadas.length = 0;
      const b = base('enviada', rol);
      expect(await r.confirmarEntregaCorreo('re_1', 'rebotada', AHORA)).toMatchObject({ resultado: 'aplicada', rol });
      expect(llamadas.some((l) => l.tabla === 'operador')).toBe(false);
      expect(b.excepciones).toHaveLength(0);
    }
  });

  it('reintento de Resend sobre una entrega ya rebotada: completa los efectos del operador (idempotentes)', async () => {
    const b = base('rebotada');
    expect(await r.confirmarEntregaCorreo('re_1', 'rebotada', AHORA)).toEqual({ resultado: 'sin_cambio', rol: 'operador', operadorMarcado: true });
    expect(b.excepciones).toHaveLength(1);
  });

  it('todo UPDATE posterior a encontrar la entrega va anclado a SU tenant', async () => {
    base('enviada');
    await r.confirmarEntregaCorreo('re_1', 'rebotada', AHORA);
    for (const l of llamadas.slice(1)) {
      const alta = l.ops.find((o) => o[0] === 'insert');
      if (alta) expect((alta[1] as Record<string, unknown>).tenant_id, l.tabla).toBe(T);
      else expect(tieneEq(l, 'tenant_id', T), l.tabla).toBe(true);
    }
  });

  it('base caída al escribir: LANZA (el webhook contesta 500 y Resend reintenta)', async () => {
    comportamiento = (l) => (l.ops.some((o) => o[0] === 'update') ? { data: null, error: { message: 'conexión rota' } } : { data: ENT('enviada'), error: null });
    await expect(r.confirmarEntregaCorreo('re_1', 'entregada', AHORA)).rejects.toThrow(/conexión rota/);
  });
});

describe('guardias del archivo', () => {
  it('toda consulta `.from()` de las funciones por flota lleva tenant_id', async () => {
    // Recorre una llamada de cada función por flota con respuestas vacías/válidas y exige el filtro en TODAS las consultas.
    comportamiento = () => ({ data: [], error: null, count: 0 });
    await r.leerConfigCorreo(T); await r.leerContactoOperador(T, 'o'); await r.listarCoordinadores(T);
    await r.listarDesgloses(T); await r.entregasDe(T, LIQ); await r.listarExcepciones(T); await r.leerCursorPull(T);
    await r.resolverExcepcion(T, 1, AHORA); await r.marcarEntregada(T, 'e', AHORA); await r.marcarFallida(T, 'e', null, 'x');
    await r.contarParaInsights(T, AHORA, AHORA);
    await r.abrirExcepcion(T, 'c', 'sin_poliza', {}, AHORA).catch(() => undefined);
    expect(llamadas.length).toBeGreaterThan(10);
    for (const l of llamadas) {
      const escritura = l.ops.find((o) => o[0] === 'insert' || o[0] === 'upsert');
      // Las altas llevan el tenant en la propia fila; todo lo demás, en el filtro.
      if (escritura) expect((escritura[1] as Record<string, unknown>).tenant_id, `${l.tabla} alta sin tenant_id`).toBe(T);
      else expect(tieneEq(l, 'tenant_id', T), `${l.tabla} sin tenant_id`).toBe(true);
    }
  });

  it('sin select(\'*\') y ningún otro archivo nuevo del frente importa supabaseAdmin', () => {
    const dir = new URL('.', import.meta.url).pathname;
    expect(readFileSync(`${dir}repo_correo.ts`, 'utf8')).not.toMatch(/select\(\s*['"`]\*['"`]/);
    const nuevos = readdirSync(dir).filter((f) => /^(correo_|desglose_|repo_correo|entrega_correo|recibir)/.test(f) && f.endsWith('.ts')
      && !/\.(test|fixture)\.ts$/.test(f) && f !== 'repo_correo.ts');
    expect(nuevos.length).toBeGreaterThan(0);
    for (const f of nuevos) expect(readFileSync(`${dir}${f}`, 'utf8'), f).not.toMatch(/supabase\/admin/);
  });
});

describe('recepción atómica del desglose (RPC 0857, hallazgo A35-A1-01)', () => {
  const pedido = () => ({
    liquidacion: {
      tenantId: T, huella: 'a'.repeat(64), operadorId: 'op-1', viajeIds: [], pdfRuta: null, pdfOrigen: 'generado' as const, pdfSha256: null,
      datos: {
        claveExterna: 'K-1', sistemaOrigen: 'desglose-bitacora', viajes: ['B-1'], periodo: { desde: '2026-10-01', hasta: '2026-10-07' },
        conceptos: [{ descripcion: 'x', tipo: 'percepcion' as const, monto: 10 }], total: 10, moneda: 'MXN' as const,
      },
    },
    meta: { bitacora: 'B-1', totalOrigen: 'tms' as const, retenidaMotivo: null },
    evento: { canal: 'correo' },
    entregas: [{ rol: 'operador' as const, correo: ' Op@Ejemplo.TEST ', xlsxRuta: 'r.xlsx', xlsxSha256: 'b'.repeat(64) }],
  });

  it('llama a la RPC UNA vez con el tenant, la liquidación, el encabezado, el evento y las entregas (correo normalizado)', async () => {
    respuestas = [{ data: { liquidacion_id: LIQ, creada: true, reparada: false, entregas: 1 }, error: null }];
    const res = await r.recibirDesgloseAtomico(T, pedido() as unknown as Parameters<typeof r.recibirDesgloseAtomico>[1]);
    expect(res).toEqual({ ok: true, valor: { liquidacionId: LIQ, creada: true, reparada: false, entregas: 1 } });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe('recibir_desglose_atomico');
    expect(rpcs[0].args.p_tenant).toBe(T);
    expect(rpcs[0].args.p_liquidacion).toMatchObject({ clave_externa: 'K-1', operador_id: 'op-1', total: 10 });
    expect(rpcs[0].args.p_desglose).toMatchObject({ bitacora: 'B-1', total_origen: 'tms', retenida_motivo: null });
    expect(rpcs[0].args.p_entregas).toEqual([{ rol: 'operador', correo: 'op@ejemplo.test', xlsx_ruta: 'r.xlsx', xlsx_sha256: 'b'.repeat(64), disparo: 'auto' }]);
    expect(llamadas).toHaveLength(0); // nada de escrituras sueltas
  });

  it('la función no existe todavía (42883 / PGRST202) => no_disponible, no lanza', async () => {
    respuestas = [{ data: null, error: { message: 'function public.recibir_desglose_atomico does not exist', code: '42883' } }];
    expect(await r.recibirDesgloseAtomico(T, pedido() as unknown as Parameters<typeof r.recibirDesgloseAtomico>[1])).toEqual({ ok: false, motivo: 'no_disponible' });
    respuestas = [{ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } }];
    expect(await r.recibirDesgloseAtomico(T, pedido() as unknown as Parameters<typeof r.recibirDesgloseAtomico>[1])).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('cualquier otro error (corte, restricción, otra huella) LANZA: jamás se confunde con «no hay RPC»', async () => {
    respuestas = [{ data: null, error: { message: 'la clave ya existe con otro contenido', code: 'P0001' } }];
    await expect(r.recibirDesgloseAtomico(T, pedido() as unknown as Parameters<typeof r.recibirDesgloseAtomico>[1])).rejects.toThrow('recibir_atomico');
  });

  it('un correo sin forma de correo se rechaza antes de llamar a la base', async () => {
    const p = pedido();
    p.entregas[0].correo = 'no-es-correo';
    await expect(r.recibirDesgloseAtomico(T, p as unknown as Parameters<typeof r.recibirDesgloseAtomico>[1])).rejects.toBeInstanceOf(DatoInvalido);
    expect(rpcs).toHaveLength(0);
  });

  it('desgloseIncompleto: sin encabezado => true; retenido => false; sin retención y sin entregas => true; con entregas => false', async () => {
    comportamiento = (l) => (l.tabla === 'liquidacion_desglose' ? { data: null, error: null } : { data: [], error: null });
    expect(await r.desgloseIncompleto(T, LIQ)).toBe(true);
    const fila = (motivo: string | null) => ({ liquidacion_externa_id: LIQ, bitacora: 'B-1', total_origen: 'tms', retenida_motivo: motivo, created_at: '2026-10-01T00:00:00Z' });
    comportamiento = (l) => (l.tabla === 'liquidacion_desglose' ? { data: fila('neto negativo'), error: null } : { data: [], error: null });
    expect(await r.desgloseIncompleto(T, LIQ)).toBe(false);
    comportamiento = (l) => (l.tabla === 'liquidacion_desglose' ? { data: fila(null), error: null } : { data: [], error: null });
    expect(await r.desgloseIncompleto(T, LIQ)).toBe(true);
    comportamiento = (l) => (l.tabla === 'liquidacion_desglose' ? { data: fila(null), error: null }
      : { data: [{ id: 'e1', liquidacion_externa_id: LIQ, tenant_id: T, generacion: 1, rol: 'operador', correo: 'a@b.test', estado: 'pendiente', intentos: 0, disparo: 'auto', created_at: '2026-10-01T00:00:00Z' }], error: null });
    expect(await r.desgloseIncompleto(T, LIQ)).toBe(false);
    comportamiento = () => ausente;
    expect(await r.desgloseIncompleto(T, LIQ)).toBe(false);
  });
});


describe('A37-A1-01: carga de contactos y guardia de activar', () => {
  beforeEach(() => { llamadas.length = 0; respuestas = []; comportamiento = null; });

  it('contarOperadoresConCorreo cuenta solo los de la flota que tienen correo', async () => {
    respuestas = [{ data: null, error: null, count: 3 }];
    expect(await r.contarOperadoresConCorreo(T)).toBe(3);
    expect(llamadas[0].tabla).toBe('operador');
    expect(llamadas[0].ops).toContainEqual(['eq', 'tenant_id', T]);
    expect(llamadas[0].ops).toContainEqual(['not', 'correo', 'is', null]);
  });

  it('activar el envío por correo sin ningún correo de operador cargado se rechaza con el camino para cargarlos', async () => {
    respuestas = [{ data: null, error: null, count: 0 }];
    await expect(r.exigirContactosParaActivar(T, { activa: true, canal: 'correo' })).rejects.toThrow(/contactos/);
    respuestas = [{ data: null, error: null, count: 12 }];
    await expect(r.exigirContactosParaActivar(T, { activa: true, canal: 'ambos' })).resolves.toBeUndefined();
  });

  it('no consulta nada si el envío sigue apagado o el canal es WhatsApp', async () => {
    await r.exigirContactosParaActivar(T, { activa: false, canal: 'correo' });
    await r.exigirContactosParaActivar(T, { activa: true, canal: 'whatsapp' });
    expect(llamadas).toHaveLength(0);
  });

  it('el puerto real busca operadores solo de la flota y por tandas, y nunca toca el teléfono', async () => {
    respuestas = [{ data: [{ id: 'op-1', numero_empleado: 'E-1', correo: null, coordinador_id: null }], error: null }];
    const mapa = await r.puertoContactosReal(T).buscarOperadores(['E-1']);
    expect(mapa.get('E-1')).toEqual([{ id: 'op-1', correo: null, coordinadorId: null }]);
    expect(llamadas[0].ops).toContainEqual(['eq', 'tenant_id', T]);

    llamadas.length = 0; respuestas = [{ data: [{ id: 'op-1' }], error: null }];
    await r.puertoContactosReal(T).guardarContacto('op-1', { correo: 'op@ejemplo.test' });
    const set = llamadas[0].ops.find((o) => o[0] === 'update')![1] as Record<string, unknown>;
    expect(set).toMatchObject({ correo: 'op@ejemplo.test', correo_rebotado_en: null });
    expect(Object.keys(set)).not.toContain('telefono');
  });

  it('asegurarCoordinador reutiliza el que ya existe por correo y crea el que no', async () => {
    respuestas = [{ data: { id: 'c-1', nombre: 'Ya Tenía' }, error: null }];
    expect(await r.puertoContactosReal(T).asegurarCoordinador({ correo: 'Coord@Ejemplo.test', nombre: null })).toEqual({ id: 'c-1', creado: false });
    expect(llamadas[0].ops).toContainEqual(['eq', 'correo', 'coord@ejemplo.test']);

    llamadas.length = 0;
    respuestas = [{ data: null, error: null }, { data: { id: 'c-2', nombre: 'Nuevo', correo: 'n@ejemplo.test', activo: true }, error: null }];
    expect(await r.puertoContactosReal(T).asegurarCoordinador({ correo: 'n@ejemplo.test', nombre: 'Nuevo' })).toEqual({ id: 'c-2', creado: true });
  });
});
