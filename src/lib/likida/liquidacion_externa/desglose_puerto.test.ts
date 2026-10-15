import { describe, it, expect } from 'vitest';
import { DESGLOSE_SINTETICO } from './desglose.fixture';
import { validarDesgloseBitacora, claveDeBitacora, type DesgloseBitacora } from './desglose_contrato';
import {
  lectorEnMemoria, reLeerDesdeDeCursor, TmsCredenciales, TmsLimite, TmsNoDisponible,
  type CursorDesglose, type FilaEnMemoria, type LectorDesglosesPuerto,
} from './desglose_puerto';

function bitacora(n: number, poliza: string | null = `P${n}`): DesgloseBitacora {
  const f = DESGLOSE_SINTETICO;
  return validarDesgloseBitacora({
    terminal: 'TERM1',
    bitacora: `B-${String(n).padStart(4, '0')}`,
    poliza,
    operador: { numeroEmpleado: '900001' },
    desde: f.desde,
    hasta: f.hasta,
    percepciones: [{ concepto: 'Pago de viaje', monto: 100 }],
    deducciones: [],
  });
}

const fila = (n: number, modificadoEn: string, poliza: string | null = `P${n}`): FilaEnMemoria => ({
  modificadoEn, desglose: bitacora(n, poliza),
});

const FILAS = [
  fila(1, '2026-10-10T08:00:00.000Z'),
  fila(2, '2026-10-10T09:00:00.000Z'),
  fila(3, '2026-10-10T09:00:00.000Z', null), // mismo instante que la 2: desempata por id; sin póliza
  fila(4, '2026-10-11T10:00:00.000Z'),
  fila(5, '2026-10-12T10:00:00.000Z'),
  fila(6, '2026-10-12T11:00:00.000Z'),
  fila(7, '2026-10-13T12:00:00.000Z'),
];

async function leerTodo(l: LectorDesglosesPuerto, limite: number) {
  const paginas: DesgloseBitacora[][] = [];
  let cursor: CursorDesglose | null = null;
  for (let i = 0; i < 20; i++) {
    const r = await l.listar({ tenantId: 't1', cursor, limite });
    paginas.push(r.items);
    cursor = r.siguiente;
    if (!r.hayMas) break;
  }
  return { paginas, cursor };
}

describe('lectorEnMemoria: paginación y orden', () => {
  it('pagina 7 filas en 3 páginas (3+3+1) con hayMas correcto y orden ascendente', async () => {
    // se pasan desordenadas a propósito
    const l = lectorEnMemoria([...FILAS].reverse());
    const p1 = await l.listar({ tenantId: 't1', cursor: null, limite: 3 });
    expect(p1.items.map((d) => d.bitacora)).toEqual(['B-0001', 'B-0002', 'B-0003']);
    expect(p1.hayMas).toBe(true);
    const p2 = await l.listar({ tenantId: 't1', cursor: p1.siguiente, limite: 3 });
    expect(p2.items.map((d) => d.bitacora)).toEqual(['B-0004', 'B-0005', 'B-0006']);
    expect(p2.hayMas).toBe(true);
    const p3 = await l.listar({ tenantId: 't1', cursor: p2.siguiente, limite: 3 });
    expect(p3.items.map((d) => d.bitacora)).toEqual(['B-0007']);
    expect(p3.hayMas).toBe(false);
    expect(p3.siguiente).toEqual({ desde: '2026-10-13T12:00:00.000Z', despuesDe: 'BIT-TERM1-B-0007' });
  });

  it('incluye las bitácoras sin póliza para poder contarlas', async () => {
    const { paginas } = await leerTodo(lectorEnMemoria(FILAS), 100);
    const todas = paginas.flat();
    expect(todas.filter((d) => d.poliza === null).map((d) => d.bitacora)).toEqual(['B-0003']);
  });

  it('el cursor desempata filas con el mismo instante (no salta ni repite la 3 tras la 2)', async () => {
    const l = lectorEnMemoria(FILAS);
    const p1 = await l.listar({ tenantId: 't1', cursor: null, limite: 2 });
    expect(p1.siguiente?.despuesDe).toBe('BIT-TERM1-B-0002');
    const p2 = await l.listar({ tenantId: 't1', cursor: p1.siguiente, limite: 1 });
    expect(p2.items.map((d) => d.bitacora)).toEqual(['B-0003']);
  });

  it('página vacía conserva el cursor recibido y hayMas=false', async () => {
    const l = lectorEnMemoria(FILAS);
    const fin: CursorDesglose = { desde: '2026-10-13T12:00:00.000Z', despuesDe: 'BIT-TERM1-B-0007' };
    const r = await l.listar({ tenantId: 't1', cursor: fin, limite: 5 });
    expect(r.items).toEqual([]);
    expect(r.siguiente).toEqual(fin);
    expect(r.hayMas).toBe(false);
  });

  it('rechaza un límite inválido', async () => {
    const l = lectorEnMemoria(FILAS);
    await expect(l.listar({ tenantId: 't1', cursor: null, limite: 0 })).rejects.toThrow(RangeError);
    await expect(l.listar({ tenantId: 't1', cursor: null, limite: 1.5 })).rejects.toThrow(RangeError);
  });
});

describe('traslape de 24 h', () => {
  it('reLeerDesdeDeCursor resta 24 h al desde del cursor y es indefinido sin cursor', () => {
    expect(reLeerDesdeDeCursor({ desde: '2026-10-13T12:00:00.000Z', despuesDe: 'x' })).toBe('2026-10-12T12:00:00.000Z');
    expect(reLeerDesdeDeCursor(null)).toBeUndefined();
  });

  it('repite filas dentro de la ventana y las claves, deduplicadas, no se duplican', async () => {
    const l = lectorEnMemoria(FILAS);
    const { paginas, cursor } = await leerTodo(l, 3);
    const primera = paginas.flat();
    expect(primera).toHaveLength(7);

    const re = await l.listar({ tenantId: 't1', cursor, limite: 50, reLeerDesde: reLeerDesdeDeCursor(cursor) });
    // ventana: desde 2026-10-12T12:00Z => solo la fila 7 (la 6 es 12-oct 11:00, anterior a la ventana)
    expect(re.items.map((d) => d.bitacora)).toEqual(['B-0007']);

    const claves = new Set<string>();
    for (const d of [...primera, ...re.items]) claves.add(claveDeBitacora(d.terminal, d.bitacora));
    expect(claves.size).toBe(7);
  });

  it('una póliza que llega tarde reaparece dentro de la ventana con su póliza', async () => {
    const filas = [...FILAS, fila(3, '2026-10-13T13:00:00.000Z', 'P3-TARDE')];
    const l = lectorEnMemoria(filas);
    const cursor: CursorDesglose = { desde: '2026-10-13T12:00:00.000Z', despuesDe: 'BIT-TERM1-B-0007' };
    const re = await l.listar({ tenantId: 't1', cursor, limite: 10, reLeerDesde: reLeerDesdeDeCursor(cursor) });
    expect(re.items.map((d) => [d.bitacora, d.poliza])).toEqual([['B-0007', 'P7'], ['B-0003', 'P3-TARDE']]);
  });
});

describe('marcarEnviadas es opcional', () => {
  it('ausente por defecto: el consumidor puede preguntar y seguir sin romper', async () => {
    const l: LectorDesglosesPuerto = lectorEnMemoria(FILAS);
    expect(l.marcarEnviadas).toBeUndefined();
    const r = await l.listar({ tenantId: 't1', cursor: null, limite: 2 });
    expect(r.items).toHaveLength(2);
    const marcado = l.marcarEnviadas ? await l.marcarEnviadas(['x']) : null;
    expect(marcado).toBeNull();
  });

  it('presente con conMarcar: separa ok de fallidas con motivo', async () => {
    const l = lectorEnMemoria(FILAS, { conMarcar: true });
    const r = await l.marcarEnviadas!(['BIT-TERM1-B-0001', 'BIT-TERM1-NOEXISTE']);
    expect(r.ok).toEqual(['BIT-TERM1-B-0001']);
    expect(r.fallidas).toEqual([{ clave: 'BIT-TERM1-NOEXISTE', motivo: 'clave desconocida' }]);
    expect([...l.enviadas]).toEqual(['BIT-TERM1-B-0001']);
  });
});

describe('errores tipados', () => {
  it('son distinguibles por clase y por name', () => {
    const es = [new TmsNoDisponible(), new TmsCredenciales(), new TmsLimite('x', 30)];
    expect(es.map((e) => e.name)).toEqual(['TmsNoDisponible', 'TmsCredenciales', 'TmsLimite']);
    expect(es[0]).toBeInstanceOf(TmsNoDisponible);
    expect(es[0]).not.toBeInstanceOf(TmsLimite);
    expect((es[2] as TmsLimite).reintentarEnSegundos).toBe(30);
    expect(es.every((e) => e instanceof Error)).toBe(true);
  });
});
