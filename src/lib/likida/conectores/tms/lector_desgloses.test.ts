import { describe, it, expect, vi } from 'vitest';
import { crearServidorTmsFalso, comoHttpDeConector } from './falso/servidor';
import type { LiquidacionSintetica } from './falso/datos';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { crearLectorDesglosesTms, lectoresDesglosesTms } = await import('./lector_desgloses');
const { SesionTms } = await import('./sesion');

const AHORA = Date.parse('2026-10-15T18:00:00.000Z');
const fila = (n: string, de: string, extra: Partial<LiquidacionSintetica> = {}): LiquidacionSintetica => ({
  operador: 'Operador Ejemplo', operador_numero: 'E-1', unidad: '526', bitacora: n, de, a: '2026-10-14T20:00:00.000Z', dias: 6, poliza: `P-${n}`,
  tipo_operador: 'foraneo', terminal: 'T1', percepciones: [{ concepto: 'Sueldo', valor: 100 }], deducciones: [], desglose: { texto: 'x', renglones: 1 },
  enviado: false, ...extra,
});
function lector(filas: LiquidacionSintetica[], config?: import('../../liquidacion_externa/desglose_tms_supuesto').ConfigApiDesglose) {
  const s = crearServidorTmsFalso({ datos: { liquidaciones: filas, peajes: [], viajes: [], posiciones: [] }, reloj: () => AHORA, vigenciaTokenMs: 3_600_000 });
  const sesion = new SesionTms({
    http: comoHttpDeConector(s), base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
    credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined },
  });
  return crearLectorDesglosesTms({ sesion, ahora: () => AHORA, ...(config ? { config } : {}) });
}

describe('lector de desgloses sobre el TMS', () => {
  it('primer arranque sin cursor: solo la ventana inicial, no el historial', async () => {
    const l = lector([fila('B-1', '2026-09-01T08:00:00.000Z'), fila('B-2', '2026-10-14T08:00:00.000Z')]);
    const p = await l.listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.items.map((d) => d.bitacora)).toEqual(['B-2']);
  });

  it('ordena por (instante, clave), respeta el cursor y marca hayMas', async () => {
    const l = lector([fila('B-2', '2026-10-14T09:00:00.000Z'), fila('B-1', '2026-10-14T08:00:00.000Z'), fila('B-3', '2026-10-14T10:00:00.000Z')]);
    const p1 = await l.listar({ tenantId: 't', cursor: null, limite: 2 });
    expect(p1.items.map((d) => d.bitacora)).toEqual(['B-1', 'B-2']);
    expect(p1.hayMas).toBe(true);
    const p2 = await l.listar({ tenantId: 't', cursor: p1.siguiente, limite: 2 });
    expect(p2.items.map((d) => d.bitacora)).toEqual(['B-3']);
  });

  it('una fila que no se puede mapear viene en `rechazadas` con el campo (sin valores) y el cursor la cubre', async () => {
    const l = lector([fila('B-1', '2026-10-14T08:00:00.000Z', { percepciones: [{ concepto: 'Sueldo', valor: '1,5' as unknown as number }] })]);
    const p = await l.listar({ tenantId: 't', cursor: null, limite: 5 });
    expect(p.items).toEqual([]);
    expect(p.rechazadas).toEqual([{ clave: 'BIT-T1-B-1', campo: 'percepciones[0].monto' }]);
    expect(p.siguiente).toEqual({ desde: '2026-10-14T08:00:00.000Z', despuesDe: 'BIT-T1-B-1' });
  });

  it('A37-S38-06: sin total_paginas en la respuesta sigue paginando y no da por completa la primera página', async () => {
    const { CONFIG_API_DESGLOSE } = await import('../../liquidacion_externa/desglose_tms_supuesto');
    const filas = ['B-1', 'B-2', 'B-3', 'B-4', 'B-5'].map((b, i) => fila(b, `2026-10-14T0${i + 1}:00:00.000Z`));
    // La API real nombra distinto el total: la ruta configurada no existe en la respuesta.
    const l = lector(filas, { ...CONFIG_API_DESGLOSE, tamano: 2, rutaTotalPaginas: 'data.no_existe' });
    const p = await l.listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.items.map((d) => d.bitacora)).toEqual(['B-1', 'B-2', 'B-3', 'B-4', 'B-5']);
    expect(p.hayMas).toBe(false);
  });

  it('A37-S38-06: sin total_paginas y sin fin decidible (tope de páginas) lanza y no avanza el cursor', async () => {
    const { CONFIG_API_DESGLOSE } = await import('../../liquidacion_externa/desglose_tms_supuesto');
    const filas = ['B-1', 'B-2', 'B-3', 'B-4', 'B-5'].map((b, i) => fila(b, `2026-10-14T0${i + 1}:00:00.000Z`));
    const l = lector(filas, { ...CONFIG_API_DESGLOSE, tamano: 2, rutaTotalPaginas: 'data.no_existe', maxPaginas: 2 });
    await expect(l.listar({ tenantId: 't', cursor: null, limite: 10 })).rejects.toThrow();
  });

  it('credencial mala: lanza TmsCredenciales y no filtra la clave', async () => {
    const s = crearServidorTmsFalso({ reloj: () => AHORA });
    const sesion = new SesionTms({
      http: comoHttpDeConector(s), base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
      credenciales: { usuario: 'x', clave: 'clave-secreta' }, reloj: { ahora: () => AHORA, dormir: async () => undefined },
    });
    const err = await crearLectorDesglosesTms({ sesion, ahora: () => AHORA }).listar({ tenantId: 't', cursor: null, limite: 1 }).catch((e: Error) => e);
    expect((err as Error).name).toBe('TmsCredenciales');
    expect(String((err as Error).message)).not.toContain('clave-secreta');
  });
});

// Un servidor que devuelve EXACTAMENTE estas filas crudas (el falso filtra por fecha y no deja probar un campo de cursor ilegible).
function lectorCrudo(items: unknown[]) {
  const s = crearServidorTmsFalso({ datos: { liquidaciones: [], peajes: [], viajes: [], posiciones: [] }, reloj: () => AHORA, vigenciaTokenMs: 3_600_000 });
  const base = comoHttpDeConector(s);
  const http: typeof base = async (sol) => (new URL(sol.url).pathname === '/api/liquidaciones'
    ? { estado: 200, encabezados: { 'content-type': 'application/json' }, cuerpo: JSON.stringify({ data: { items, total_paginas: 1 } }) }
    : base(sol));
  const sesion = new SesionTms({
    http, base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
    credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined },
  });
  return crearLectorDesglosesTms({ sesion, ahora: () => AHORA });
}

describe('A37-A1-liquidaciones-18: una fila sin instante de cursor utilizable NO desaparece en la relectura', () => {
  const sinCursor = { ...fila('B-9', '2026-10-14T08:00:00.000Z'), de: null };
  const normal = fila('B-1', '2026-10-14T09:00:00.000Z');
  it('primera corrida (sin cursor): se reporta en `rechazadas`', async () => {
    const p = await lectorCrudo([sinCursor, normal]).listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.rechazadas).toEqual([{ clave: 'BIT-T1-B-9', campo: 'de' }]);
  });
  it('corridas siguientes (con cursor ⇒ reLeerDesde): se SIGUE reportando, no se filtra por la ventana', async () => {
    const p = await lectorCrudo([sinCursor, normal]).listar({
      tenantId: 't', cursor: { desde: '2026-10-14T09:00:00.000Z', despuesDe: 'BIT-T1-B-1' }, limite: 10, reLeerDesde: '2026-10-13T09:00:00.000Z',
    });
    expect(p.rechazadas).toEqual([{ clave: 'BIT-T1-B-9', campo: 'de' }]);
  });
  it('una fila con instante válido anterior a la ventana de relectura sigue fuera (la ventana se respeta)', async () => {
    const vieja = fila('B-0', '2026-10-01T09:00:00.000Z');
    const p = await lectorCrudo([vieja, normal]).listar({
      tenantId: 't', cursor: { desde: '2026-10-14T09:00:00.000Z', despuesDe: 'BIT-T1-B-1' }, limite: 10, reLeerDesde: '2026-10-13T09:00:00.000Z',
    });
    expect(p.items.map((d) => d.bitacora)).toEqual(['B-1']);
  });
});

describe('A37-A1-liquidaciones-16: el instante de cursor sin zona se interpreta como hora de México, no la del servidor', () => {
  it('«2026-10-14T08:00:00» (sin zona) ⇒ 14:00Z; con «Z» se respeta', async () => {
    const sinZona = { ...fila('B-1', '2026-10-14T08:00:00.000Z'), de: '2026-10-14T08:00:00' };
    const conZona = { ...fila('B-2', '2026-10-14T09:00:00.000Z'), de: '2026-10-14T09:00:00Z' };
    const p = await lectorCrudo([sinZona, conZona]).listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.siguiente).toEqual({ desde: '2026-10-14T14:00:00.000Z', despuesDe: 'BIT-T1-B-1' });
  });
});

describe('qué flotas leen', () => {
  const base = (c: object | null, canal: 'correo' | 'whatsapp' = 'correo') => lectoresDesglosesTms({
    ahora: () => AHORA, tenantsConEnvioActivo: async () => ['t1'], canalDeEntrega: async () => canal, credencial: async () => c as never,
  });
  const ok = { valores: { base_url: 'https://tms.ejemplo.test', usuario: 'u', clave: 'c' }, probadaEn: '2026-10-01T00:00:00Z', ultimoError: null };
  it('entra con credencial probada, sana y https', async () => { expect(await base(ok)).toHaveLength(1); });
  it('no entra sin credencial, sin probar, con error, con base http o con canal que no es correo', async () => {
    expect(await base(null)).toHaveLength(0);
    expect(await base({ ...ok, probadaEn: null })).toHaveLength(0);
    expect(await base({ ...ok, ultimoError: 'x' })).toHaveLength(0);
    expect(await base({ ...ok, valores: { ...ok.valores, base_url: 'http://tms.ejemplo.test' } })).toHaveLength(0);
    expect(await base(ok, 'whatsapp')).toHaveLength(0);
  });
});
