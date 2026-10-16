import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A5-47: `aceptarPorBoton` — el botón «Acepto el viaje». Un solo UPDATE condicionado a lo que la 0058 exige (no hay `aceptado_en` sin
// `avisado_en`), acotado por flota Y operador, con `aceptado_origen = 'chofer'`; y el re-lectura que distingue por qué no cambió nada.

interface Escritura { valores: Record<string, unknown>; filtros: Array<[string, unknown]> }
const escrituras: Escritura[] = [];
let RESULTADO_UPDATE: { data: unknown; error: { message: string } | null } = { data: [{ id: 'v-1' }], error: null };
let PREVIO: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (valores: Record<string, unknown>) => {
        const filtros: Array<[string, unknown]> = [];
        const nodo: Record<string, unknown> = {};
        nodo.eq = (c: string, v: unknown) => { filtros.push([c, v]); return nodo; };
        nodo.is = (c: string, v: unknown) => { filtros.push([`${c} is`, v]); return nodo; };
        nodo.not = (c: string, op: string, v: unknown) => { filtros.push([`${c} not ${op}`, v]); return nodo; };
        nodo.select = () => { escrituras.push({ valores, filtros }); return Promise.resolve(RESULTADO_UPDATE); };
        return nodo;
      },
      select: () => {
        const nodo: Record<string, unknown> = {};
        nodo.eq = () => nodo;
        nodo.maybeSingle = () => Promise.resolve(PREVIO);
        return nodo;
      },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { aceptarPorBoton } = await import('./confirmar_viaje');
const AHORA = new Date('2026-10-16T14:00:00.000Z');

beforeEach(() => {
  escrituras.length = 0;
  RESULTADO_UPDATE = { data: [{ id: 'v-1' }], error: null };
  PREVIO = { data: null, error: null };
  for (const f of Object.values(logger)) f.mockReset();
});

describe('aceptarPorBoton', () => {
  it('escribe aceptado_en con origen «chofer», solo si estaba sin aceptar Y ya avisado (la 0058 nunca se viola), acotado por flota y operador', async () => {
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('aceptado');
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].valores).toEqual({ aceptado_en: AHORA.toISOString(), aceptado_origen: 'chofer' });
    const f = Object.fromEntries(escrituras[0].filtros.map(([c, v]) => [c, v]));
    expect(f).toMatchObject({ id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', 'aceptado_en is': null });
    expect(escrituras[0].filtros.some(([c]) => c === 'avisado_en not is')).toBe(true);
  });

  it('sin filas cambiadas distingue: ya aceptado / nunca avisado / no es suyo o cerrado', async () => {
    RESULTADO_UPDATE = { data: [], error: null };
    PREVIO = { data: { aceptado_en: '2026-10-16T13:00:00Z', avisado_en: '2026-10-16T12:00:00Z' }, error: null };
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('ya_aceptado');
    PREVIO = { data: { aceptado_en: null, avisado_en: null }, error: null };
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('sin_aviso');
    PREVIO = { data: null, error: null };
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('no_encontrado');
    PREVIO = { data: { aceptado_en: null, avisado_en: '2026-10-16T12:00:00Z' }, error: null };
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('no_encontrado');
  });

  it('falla cerrado: un error de la base al escribir o al releer es «fallo», nunca «ya aceptado» ni «aceptado»', async () => {
    RESULTADO_UPDATE = { data: null, error: { message: 'boom' } };
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('fallo');
    RESULTADO_UPDATE = { data: [], error: null };
    PREVIO = { data: null, error: { message: 'timeout' } };
    expect(await aceptarPorBoton('t-1', 'v-1', 'o-1', AHORA)).toBe('fallo');
  });
});
