import { describe, it, expect, vi, afterEach } from 'vitest';
import { extraccionVacia, type Extraccion } from './campos';
import { cv } from './documentos_sinteticos.fixture';
import { prechequear, type ContextoPrechequeo } from './prechequeo';
import type { ConsultaExistencia, Existencia, SalidaTms } from './tms_puerto';
import { crearTmsFalso } from './tms_falso.fixture';

const T = 'tenant-sintetico-1';
const doc = (o: { cliente?: string; caja?: string; folio?: string } = {}): Extraccion => {
  const e = extraccionVacia();
  if (o.cliente) e.campos.numero_cliente_interno = cv(o.cliente);
  if (o.caja) e.campos.caja_numero = cv(o.caja);
  if (o.folio) e.campos.folio_cliente = cv(o.folio);
  return e;
};
type Resp = Existencia | 'lanza' | 'cuelga' | 'raro' | undefined;
function puerto(caja: Resp, reque: Resp) {
  const llamadas: Array<{ op: string; e: ConsultaExistencia }> = [];
  const mk = (op: string, r: Resp) => r === undefined ? undefined : async (e: ConsultaExistencia): Promise<Existencia> => {
    llamadas.push({ op, e });
    if (r === 'lanza') throw new Error('red caída');
    if (r === 'cuelga') return new Promise<Existencia>(() => {});
    if (r === 'raro') return 'quizá' as unknown as Existencia;
    return r;
  };
  const s: SalidaTms = { ...crearTmsFalso('ok'), consultarCaja: mk('caja', caja), consultarReque: mk('reque', reque) };
  return { s, llamadas };
}
const ctx = (s?: SalidaTms, extra: Partial<ContextoPrechequeo> = {}): ContextoPrechequeo => ({ tenantId: T, salida: s, ...extra });

afterEach(() => { vi.useRealTimers(); });

describe('tabla de verdad caja × reque con cliente resuelto', () => {
  const casos: Array<[Existencia, Existencia, string, string]> = [
    ['existe', 'existe', 'enviar', 'ok'],
    ['existe', 'no_existe', 'pendiente_reque', 'falta'],
    ['existe', 'desconocido', 'pendiente_reque', 'desconocido'], // política retener
    ['no_existe', 'existe', 'revisar', 'ok'],
    ['no_existe', 'no_existe', 'revisar', 'falta'], // revisar gana
    ['no_existe', 'desconocido', 'revisar', 'desconocido'],
    ['desconocido', 'existe', 'enviar', 'ok'],
    ['desconocido', 'no_existe', 'pendiente_reque', 'falta'],
    ['desconocido', 'desconocido', 'pendiente_reque', 'desconocido'],
  ];
  it.each(casos)('caja %s, reque %s → %s', async (c, r, accion, estadoReque) => {
    const { s } = puerto(c, r);
    const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s));
    expect(res.accion).toBe(accion);
    expect(res.reque.estado).toBe(estadoReque);
    expect(res.cliente.estado).toBe('ok');
  });
});

describe('política si el TMS es desconocido', () => {
  it('enviar → envía aunque no se pueda verificar el reque', async () => {
    const { s } = puerto('desconocido', 'desconocido');
    const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s, { siTmsDesconocido: 'enviar' }));
    expect(res.accion).toBe('enviar');
    expect(res.motivo).toBeNull();
  });
  it('retener (por omisión) → pendiente_reque con el motivo pedido', async () => {
    const { s } = puerto('existe', 'desconocido');
    const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s));
    expect(res.accion).toBe('pendiente_reque');
    expect(res.motivo).toBe('No se pudo verificar el requerimiento.');
  });
  it('enviar no tapa un reque que SÍ se sabe inexistente', async () => {
    const { s } = puerto('existe', 'no_existe');
    const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s, { siTmsDesconocido: 'enviar' }));
    expect(res.accion).toBe('pendiente_reque');
  });
});

describe('puerto sin consultas opcionales', () => {
  it('sin consultarReque ni consultarCaja → desconocido y se aplica la política', async () => {
    const solo: SalidaTms = { cargarPlantilla: crearTmsFalso('ok').cargarPlantilla };
    const d = doc({ cliente: 'C-100', caja: 'CJ-1' });
    const ret = await prechequear(d, ctx(solo));
    expect(ret.reque.estado).toBe('desconocido');
    expect(ret.caja.estado).toBe('desconocido');
    expect(ret.accion).toBe('pendiente_reque');
    expect((await prechequear(d, ctx(solo, { siTmsDesconocido: 'enviar' }))).accion).toBe('enviar');
  });
  it('sin puerto alguno tampoco lanza', async () => {
    const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(undefined));
    expect(res.reque.estado).toBe('desconocido');
    expect(res.accion).toBe('pendiente_reque');
  });
});

describe('causa 1: cliente que paga', () => {
  it('numero_cliente_interno ausente → revisar aunque el reque exista, y no inventa el número', async () => {
    const { s, llamadas } = puerto('existe', 'existe');
    const res = await prechequear(doc({ caja: 'CJ-1' }), ctx(s));
    expect(res.cliente.estado).toBe('falta');
    expect(res.accion).toBe('revisar');
    expect(llamadas).toEqual([]); // sin cliente no hay a quién consultar
  });
  it('el número del contexto (catálogo) vale igual que el de la extracción', async () => {
    const { s, llamadas } = puerto('existe', 'existe');
    const res = await prechequear(doc({ caja: 'CJ-1' }), ctx(s, { clienteInterno: 'C-777' }));
    expect(res.accion).toBe('enviar');
    expect(llamadas.every((l) => l.e.clienteInterno === 'C-777')).toBe(true);
  });
  it('un número en blanco cuenta como faltante', async () => {
    const e = doc({ caja: 'CJ-1' }); e.campos.numero_cliente_interno = cv('   ');
    expect((await prechequear(e, ctx(puerto('existe', 'existe').s))).cliente.estado).toBe('falta');
  });
});

describe('causa 2: caja', () => {
  it('sin caja_numero → revisar y no se pregunta por ella', async () => {
    const { s, llamadas } = puerto('existe', 'existe');
    const res = await prechequear(doc({ cliente: 'C-100' }), ctx(s));
    expect(res.caja.estado).toBe('falta');
    expect(res.accion).toBe('revisar');
    expect(llamadas.some((l) => l.op === 'caja')).toBe(false);
  });
});

describe('guardias: tenant, timeout, lanzamientos', () => {
  it('sin tenantId no consulta nada y pide revisar', async () => {
    for (const t of ['', '   ']) {
      const { s, llamadas } = puerto('existe', 'existe');
      const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), { tenantId: t, salida: s });
      expect(llamadas).toEqual([]);
      expect(res.accion).toBe('revisar');
    }
  });
  it('todas las consultas llevan el tenantId, el cliente, la caja y el folio', async () => {
    const { s, llamadas } = puerto('existe', 'existe');
    await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1', folio: 'F-9' }), ctx(s));
    expect(llamadas).toHaveLength(2);
    for (const l of llamadas) expect(l.e).toEqual({ tenantId: T, clienteInterno: 'C-100', caja: 'CJ-1', folio: 'F-9' });
  });
  it('el puerto que lanza → desconocido, no excepción', async () => {
    const { s } = puerto('lanza', 'lanza');
    const res = await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s));
    expect(res.reque.estado).toBe('desconocido');
    expect(res.accion).toBe('pendiente_reque');
  });
  it('un valor fuera de contrato → desconocido', async () => {
    const { s } = puerto('raro', 'raro');
    expect((await prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s))).reque.estado).toBe('desconocido');
  });
  it('el puerto que no responde → desconocido a los 5 s por omisión', async () => {
    vi.useFakeTimers();
    const { s } = puerto('cuelga', 'cuelga');
    const p = prechequear(doc({ cliente: 'C-100', caja: 'CJ-1' }), ctx(s));
    let listo = false; void p.then(() => { listo = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(listo).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const res = await p;
    expect(res.reque.estado).toBe('desconocido');
    expect(res.accion).toBe('pendiente_reque');
  });
});
