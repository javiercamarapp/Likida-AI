import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { aHoraLocalMx, posicionesConDespacho } from './fuente_despacho';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const R = await import('./repo');

const T = 'tenant-1';
const NORTE = { nombre: 'Caseta Ejemplo Norte', lat: 19.5, lng: -99.2, radioM: 300 };
const SUR = { nombre: 'Caseta Ejemplo Sur', lat: 19.0, lng: -99.0, radioM: 300 };

describe('aHoraLocalMx', () => {
  it('UTC → hora local de México (sin zona)', () => {
    expect(aHoraLocalMx('2026-09-03T14:15:00Z')).toBe('2026-09-03T08:15');
  });
  it('un instante ilegible es null', () => {
    expect(aHoraLocalMx('ayer')).toBeNull();
  });
});

describe('posicionesConDespacho (puro)', () => {
  const unidades = new Map([['u1', '101']]);
  const fila = (o = {}) => ({ unidadId: 'u1', lat: 19.5005, lng: -99.2, medidaEn: '2026-09-03T14:15:00Z', despachoRef: 'D-1', ...o });

  it('deduce la caseta por cercanía dentro de su radio y arma la posición con Icident', () => {
    const r = posicionesConDespacho([fila()], unidades, [SUR, NORTE]);
    expect(r.posiciones).toEqual([{ unidad: '101', icident: 'D-1', puntoInteres: 'Caseta Ejemplo Norte', fechaHoraLocal: '2026-09-03T08:15', lat: 19.5005, lng: -99.2 }]);
  });
  it('una posición fuera del radio de toda caseta se descarta (y se cuenta), no se inventa caseta', () => {
    const r = posicionesConDespacho([fila({ lat: 19.3 })], unidades, [NORTE, SUR]);
    expect(r.posiciones).toEqual([]);
    expect(r.descartadas.sinCaseta).toBe(1);
  });
  it('sin unidad con número, con coordenadas imposibles o sin referencia: descartadas con su motivo', () => {
    const r = posicionesConDespacho([fila({ unidadId: 'zz' }), fila({ lat: 95 }), fila({ despachoRef: '  ' })], unidades, [NORTE]);
    expect(r.posiciones).toEqual([]);
    expect(r.descartadas).toEqual({ sinUnidad: 1, sinCaseta: 0, invalidas: 2 });
  });
});

describe('fuenteLocal: lee viaje.despacho_ref y posicion.despacho_ref (A2 ola 1)', () => {
  beforeEach(() => {
    db = crearDbFalsa({
      unidad: [{ id: 'u1', tenant_id: T, numero_economico: '101' }],
      viaje: [
        { id: 'v1', tenant_id: T, folio: 'F-1', unidad_id: 'u1', fecha_inicio: '2026-09-02', fecha_fin: '2026-09-04', origen: null, destino: null, despacho_ref: 'D-1' },
        { id: 'v2', tenant_id: T, folio: 'F-2', unidad_id: 'u1', fecha_inicio: '2026-09-05', fecha_fin: '2026-09-06', origen: null, destino: null, despacho_ref: null },
      ],
      peaje_caseta: [{ id: 'c1', tenant_id: T, nombre: NORTE.nombre, nombre_norm: 'caseta ejemplo norte', alias: [], lat: NORTE.lat, lng: NORTE.lng, radio_m: 300, activa: true, fuente: null }],
      posicion: [
        { id: 1, tenant_id: T, unidad_id: 'u1', lat: 19.5004, lng: -99.2, medida_en: '2026-09-03T14:15:00Z', despacho_ref: 'D-1' },
        { id: 2, tenant_id: T, unidad_id: 'u1', lat: 19.5004, lng: -99.2, medida_en: '2026-09-03T15:15:00Z', despacho_ref: null },
        { id: 3, tenant_id: 'otro', unidad_id: 'ux', lat: 19.5004, lng: -99.2, medida_en: '2026-09-03T14:15:00Z', despacho_ref: 'D-X' },
      ],
    });
  });

  it('el viaje trae su Icident (despacho_ref) y la posición con despacho su caseta deducida', async () => {
    const { viajes, posiciones } = await R.fuenteLocal.cargar(T, { desde: '2026-09-01', hasta: '2026-09-30' });
    expect(viajes.find((v) => v.id === 'v1')?.icident).toBe('D-1');
    expect(viajes.find((v) => v.id === 'v2')?.icident).toBeNull();
    expect(posiciones).toHaveLength(1);
    expect(posiciones[0]).toMatchObject({ unidad: '101', icident: 'D-1', puntoInteres: NORTE.nombre });
  });

  it('sin casetas con coordenadas no hay posiciones útiles: [] y el cruce sigue por ventana', async () => {
    db.tablas.peaje_caseta[0].lat = null;
    db.tablas.peaje_caseta[0].lng = null;
    const { posiciones } = await R.fuenteLocal.cargar(T, { desde: '2026-09-01', hasta: '2026-09-30' });
    expect(posiciones).toEqual([]);
  });

  it('toda consulta lleva el filtro de la flota', async () => {
    await R.fuenteLocal.cargar(T, { desde: '2026-09-01', hasta: '2026-09-30' });
    for (const l of db.llamadas.filter((x) => ['posicion', 'viaje', 'unidad', 'peaje_caseta'].includes(x.tabla))) {
      expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T)).toBe(true);
    }
  });
});

describe('vincularDesglose con el Icident del cobro', () => {
  it('liga por el Icident de la línea aunque no haya posiciones ni hora', async () => {
    db = crearDbFalsa({
      peaje_vinculo_config: [{ tenant_id: T, activo: true }],
      unidad: [{ id: 'u1', tenant_id: T, numero_economico: '101' }],
      viaje: [{ id: 'v1', tenant_id: T, folio: 'F-1', unidad_id: 'u1', fecha_inicio: '2026-09-02', fecha_fin: '2026-09-04', origen: null, destino: null, despacho_ref: 'D-1' }],
      desglose_peaje: [{ id: 'd1', tenant_id: T }],
      desglose_peaje_linea: [{ id: 'l1', tenant_id: T, desglose_id: 'd1', indice: 0, fecha: '2026-09-03', caseta: 'Caseta Ejemplo Norte', hora: null, unidad_archivo: 'CAMIONETA', icident: 'D-1' }],
    });
    const r = await R.vincularDesglose(T, 'd1');
    expect(r).toMatchObject({ estado: 'ok', ligados: 1 });
    expect(db.tablas.peaje_cruce_viaje[0]).toMatchObject({ linea_id: 'l1', viaje_id: 'v1', estado: 'ligado', via: 'icident', icident: 'D-1' });
  });

  it('si la base aún no tiene la columna icident (0935 sin aplicar) cae a unidad + ventana y no se rompe', async () => {
    db = crearDbFalsa({
      peaje_vinculo_config: [{ tenant_id: T, activo: true }],
      unidad: [{ id: 'u1', tenant_id: T, numero_economico: '101' }],
      viaje: [{ id: 'v1', tenant_id: T, folio: 'F-1', unidad_id: 'u1', fecha_inicio: '2026-09-02', fecha_fin: '2026-09-04', origen: null, destino: null, despacho_ref: null }],
      desglose_peaje: [{ id: 'd1', tenant_id: T }],
      desglose_peaje_linea: [{ id: 'l1', tenant_id: T, desglose_id: 'd1', indice: 0, fecha: '2026-09-03', caseta: 'X', hora: null, unidad_archivo: '101' }],
    });
    const original = db.cliente.from;
    // Postgres sin la 0935: pedir la columna icident falla; pedir las demás funciona.
    const fallido: unknown = new Proxy({}, {
      get: (_o, p) => (p === 'then' ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: 'column desglose_peaje_linea.icident does not exist' } }) : () => fallido),
    });
    db.cliente.from = (t: string) => {
      const q = original(t) as Record<string, (...a: unknown[]) => unknown>;
      if (t !== 'desglose_peaje_linea') return q;
      return new Proxy(q, {
        get: (obj, prop: string) => (prop === 'select'
          ? (cols: string, ...resto: unknown[]) => (/icident/.test(cols) ? fallido : obj.select(cols, ...resto))
          : obj[prop].bind(obj)),
      });
    };
    const r = await R.vincularDesglose(T, 'd1');
    expect(r).toMatchObject({ estado: 'ok', ligados: 1 });
    expect(db.tablas.peaje_cruce_viaje[0]).toMatchObject({ via: 'unidad_ventana', viaje_id: 'v1' });
  });
});
