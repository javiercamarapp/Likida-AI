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
function lector(filas: LiquidacionSintetica[]) {
  const s = crearServidorTmsFalso({ datos: { liquidaciones: filas, peajes: [], viajes: [], posiciones: [] }, reloj: () => AHORA, vigenciaTokenMs: 3_600_000 });
  const sesion = new SesionTms({
    http: comoHttpDeConector(s), base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
    credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined },
  });
  return crearLectorDesglosesTms({ sesion, ahora: () => AHORA });
}

/** Como `lector`, pero el TMS además devuelve `n` filas crudas SIN fecha de cursor utilizable (el servidor falso las filtra por fecha). */
function lectorConSinFecha(filas: LiquidacionSintetica[], n: number) {
  const s = crearServidorTmsFalso({ datos: { liquidaciones: filas, peajes: [], viajes: [], posiciones: [] }, reloj: () => AHORA, vigenciaTokenMs: 3_600_000 });
  const base = comoHttpDeConector(s);
  const http: typeof base = async (pet) => {
    const r = await base(pet);
    if (!pet.url.includes('/api/liquidaciones')) return r;
    const cuerpo = JSON.parse(r.cuerpo) as { data: { items: unknown[] } };
    for (let i = 1; i <= n; i++) cuerpo.data.items.push({ bitacora: `X-${i}`, terminal: 'T1', de: 'sin fecha' });
    return { ...r, cuerpo: JSON.stringify(cuerpo) };
  };
  const sesion = new SesionTms({
    http, base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
    credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined },
  });
  return crearLectorDesglosesTms({ sesion, ahora: () => AHORA });
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

  it('A37-S38-08: una fila sin fecha utilizable NO mueve el cursor (ni a 1970): el cursor queda en la última fila CON fecha', async () => {
    const l = lectorConSinFecha([fila('B-1', '2026-10-14T08:00:00.000Z')], 2);
    const p = await l.listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.items.map((d) => d.bitacora)).toEqual(['B-1']);
    expect(p.siguiente).toEqual({ desde: '2026-10-14T08:00:00.000Z', despuesDe: 'BIT-T1-B-1' });
    expect(p.rechazadas).toHaveLength(2); // siguen siendo visibles
  });

  it('A37-S38-08: las filas sin fecha no ocupan páginas ni mandan el cursor a 1970; se reportan en la última página', async () => {
    const l = lectorConSinFecha([fila('B-1', '2026-10-14T08:00:00.000Z')], 3);
    const p = await l.listar({ tenantId: 't', cursor: null, limite: 2 });
    expect(p.items.map((d) => d.bitacora)).toEqual(['B-1']);
    expect(p.rechazadas).toHaveLength(3);
    expect(p.siguiente).toEqual({ desde: '2026-10-14T08:00:00.000Z', despuesDe: 'BIT-T1-B-1' });
    expect(p.hayMas).toBe(false);
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
