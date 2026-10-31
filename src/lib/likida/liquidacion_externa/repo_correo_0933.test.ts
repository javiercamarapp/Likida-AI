import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// repo_correo.ts — lo que añade la migración 0933: correo emisor, modo primer mes y revisores. Misma técnica que `repo_correo.test.ts`
// (la base es un registrador de cadenas). Todo sintético.
// ═══════════════════════════════════════════════════════════════════════════

type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
const llamadas: Llamada[] = [];
let respuestas: Resp[] = [];

function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'gte', 'gt', 'lt', 'or', 'is', 'not', 'order', 'range', 'limit', 'neq']) {
    b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  }
  const resolver = (): Resp => respuestas.shift() ?? { data: [], error: null, count: 0 };
  b.maybeSingle = async () => { ll.ops.push(['maybeSingle']); return resolver(); };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: constructor }) }));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } }));
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => (globalThis as { __perfilPrueba?: string | null }).__perfilPrueba ?? null }));

const r = await import('./repo_correo');
const { DatoInvalido } = await import('../errores');

const T = 'tenant-sintetico-1';
const sinColumna = { data: null, error: { message: 'column liquidacion_correo_config.revisores does not exist', code: '42703' } };
const select = (l: Llamada) => String(l.ops.find((o) => o[0] === 'select')?.[1]);
const upsert = (l: Llamada) => l.ops.find((o) => o[0] === 'upsert')?.[1] as Record<string, unknown>;

beforeEach(() => { llamadas.length = 0; respuestas = []; warn.mockClear(); });

describe('lectura de la configuración con las columnas de la 0933', () => {
  it('traduce el correo emisor, los revisores y la fecha del modo primer mes', async () => {
    respuestas = [{ data: {
      canal: 'correo', activa: true, remitente_correo: 'emisor@ejemplo.test', primer_mes_hasta: '2026-11-14',
      revisores: [{ departamento: 'nomina', correo: 'nomina@ejemplo.test' }, { raro: 1 }, 'x'],
    }, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor).toMatchObject({
      remitenteCorreo: 'emisor@ejemplo.test', primerMesHasta: '2026-11-14', revisores: [{ departamento: 'nomina', correo: 'nomina@ejemplo.test' }],
    });
    expect(select(llamadas[0])).toContain('revisores');
  });

  it('sin fila ⇒ el defecto: modo primer mes apagado, sin correo emisor', async () => {
    respuestas = [{ data: null, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor).toMatchObject({ remitenteCorreo: null, revisores: [], primerMesHasta: null });
  });

  it('una base SIN la 0933 (columna inexistente) ⇒ vuelve a leer con las columnas de siempre, lo avisa, y el modo queda apagado', async () => {
    respuestas = [sinColumna, { data: { canal: 'correo', activa: true, responder_a: 'nomina@ejemplo.test' }, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor).toMatchObject({ canal: 'correo', activa: true, responderA: 'nomina@ejemplo.test', remitenteCorreo: null, revisores: [], primerMesHasta: null });
    expect(llamadas).toHaveLength(2);
    expect(select(llamadas[1])).not.toContain('revisores');
    expect(warn).toHaveBeenCalledWith('liqcorreo.config_sin_0933', expect.anything());
  });

  it('otro error de base (no la columna) sigue lanzando: nunca se lee como «sin configuración»', async () => {
    respuestas = [{ data: null, error: { message: 'conexión rota' } }];
    await expect(r.leerConfigCorreo(T)).rejects.toThrow(/conexión rota/);
  });
});

describe('guardar la configuración con revisores y correo emisor', () => {
  const base = { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'correo' as const };
  const REV = [{ departamento: ' Nomina ', correo: ' NOMINA@Ejemplo.TEST ' }, { departamento: 'rh', correo: 'rh@ejemplo.test' }];

  it('upsert anclado al tenant, con departamento y correos normalizados', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...base, remitenteCorreo: ' Emisor@Ejemplo.test ', revisores: REV, primerMesHasta: '2026-11-14' }, 'oficina');
    expect(upsert(llamadas[0])).toMatchObject({
      tenant_id: T, remitente_correo: 'emisor@ejemplo.test', primer_mes_hasta: '2026-11-14',
      revisores: [{ departamento: 'nomina', correo: 'nomina@ejemplo.test' }, { departamento: 'rh', correo: 'rh@ejemplo.test' }],
    });
  });

  it('validaciones: más de 5, departamento sin forma, correo sin forma, repetido, fecha mala, fecha sin revisores', async () => {
    const mk = (revisores: Array<{ departamento: string; correo: string }>, primerMesHasta: string | null = null) =>
      r.guardarConfigCorreo(T, { ...base, revisores, primerMesHasta }, null);
    const seis = Array.from({ length: 6 }, (_, i) => ({ departamento: `dep${'abcdef'[i]}`.replace(/\d/g, ''), correo: `r${i}@ejemplo.test` }));
    await expect(mk(seis)).rejects.toBeInstanceOf(DatoInvalido);
    await expect(mk([{ departamento: 'nómina 1', correo: 'a@ejemplo.test' }])).rejects.toBeInstanceOf(DatoInvalido);
    await expect(mk([{ departamento: 'nomina', correo: 'sin-arroba' }])).rejects.toBeInstanceOf(DatoInvalido);
    await expect(mk([{ departamento: 'nomina', correo: '' }])).rejects.toBeInstanceOf(DatoInvalido);
    await expect(mk([{ departamento: 'nomina', correo: 'a@ejemplo.test' }, { departamento: 'NOMINA', correo: 'b@ejemplo.test' }])).rejects.toThrow(/un solo revisor/);
    await expect(mk(REV, '14/11/2026')).rejects.toBeInstanceOf(DatoInvalido);
    await expect(mk([], '2026-11-14')).rejects.toThrow(/al menos un revisor/);
    expect(llamadas).toHaveLength(0);
  });

  it('«Responder a» deja de ser obligatorio si hay correo emisor; sin ninguno de los dos, activar sigue rechazándose', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }, { data: [], error: null }];
    await r.guardarConfigCorreo(T, { ...base, activa: true, responderA: null, remitenteCorreo: 'emisor@ejemplo.test' }, 'oficina');
    // y las entregas que esperaban la configuración se adelantan, como con «Responder a»
    expect(llamadas.some((l) => l.tabla === 'liquidacion_entrega_correo')).toBe(true);
    await expect(r.guardarConfigCorreo(T, { ...base, activa: true, responderA: null, remitenteCorreo: null }, null)).rejects.toThrow(/responder_a/);
  });

  it('base SIN la 0933: lo de siempre se guarda como antes; con valores nuevos se dice y NO se finge haber guardado', async () => {
    respuestas = [sinColumna, { data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, base, 'oficina');
    expect(llamadas).toHaveLength(2);
    expect(upsert(llamadas[1])).not.toHaveProperty('revisores');
    expect(upsert(llamadas[1])).toMatchObject({ tenant_id: T, canal: 'correo' });

    llamadas.length = 0;
    respuestas = [sinColumna];
    await expect(r.guardarConfigCorreo(T, { ...base, revisores: REV, primerMesHasta: '2026-11-14' }, null)).rejects.toThrow(/0933/);
    expect(llamadas).toHaveLength(1);
  });
});

describe('funciones puras', () => {
  it('responderAEfectivo: «Responder a» > correo emisor > nada (fail-cerrado)', () => {
    expect(r.responderAEfectivo({ responderA: 'a@ejemplo.test', remitenteCorreo: 'b@ejemplo.test' })).toBe('a@ejemplo.test');
    expect(r.responderAEfectivo({ responderA: null, remitenteCorreo: 'b@ejemplo.test' })).toBe('b@ejemplo.test');
    expect(r.responderAEfectivo({ responderA: '  ', remitenteCorreo: ' ' })).toBeNull();
    expect(r.responderAEfectivo({ responderA: null, remitenteCorreo: null })).toBeNull();
  });

  it('modoPrimerMesVigente: necesita fecha Y revisores; el último día es inclusivo', () => {
    const rev = [{ departamento: 'rh', correo: 'rh@ejemplo.test' }];
    expect(r.modoPrimerMesVigente({ revisores: rev, primerMesHasta: '2026-11-14' }, '2026-11-14')).toBe(true);
    expect(r.modoPrimerMesVigente({ revisores: rev, primerMesHasta: '2026-11-14' }, '2026-11-15')).toBe(false);
    expect(r.modoPrimerMesVigente({ revisores: rev, primerMesHasta: null }, '2026-10-01')).toBe(false);
    expect(r.modoPrimerMesVigente({ revisores: [], primerMesHasta: '2026-11-14' }, '2026-10-01')).toBe(false);
  });
});
