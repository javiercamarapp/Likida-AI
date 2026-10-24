import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { crearDbFalsa, type DbFalsa } from '../peajes/db_falsa.test.util';

// A37-S47-02: la subida manual del MISMO archivo no crea un segundo desglose (huella SHA-256, 0916), y dos desgloses de periodos
// traslapados no cuadran el mismo gasto: el más antiguo conserva lo que ya reclamó. Todo sintético.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => {});
vi.mock('../agentes/corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const { importarDesglose, conciliarDesglose, cruzarLineasDesglose } = await import('./desglose_peaje');

const T = 'tenant-1';
const csv = 'Fecha de cobro;Hora;Plaza;Importe;No. TAG\n05/08/2026;10:30:00;Caseta Ejemplo Norte;189,50;IMDM 10000001\n06/08/2026;;Caseta Ejemplo Sur;100,00;\n';
const huella = createHash('sha256').update(Buffer.from(csv)).digest('hex');

describe('importarDesglose: el mismo archivo no se importa dos veces (huella, 0916)', () => {
  beforeEach(() => { db = crearDbFalsa({}); });

  it('la primera subida guarda la huella del contenido', async () => {
    const r = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from(csv), proveedor: 'PASE' });
    expect(r.ok).toBe(true);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ archivo_sha256: huella, tenant_id: T });
  });

  it('el doble clic / la resubida (aunque con OTRO nombre) devuelve el desglose existente y no duplica nada', async () => {
    const a = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from(csv), proveedor: 'PASE' });
    const b = await importarDesglose(T, { nombre: 'pase (copia).csv', buffer: Buffer.from(csv), proveedor: 'PASE' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.desgloseId).toBe(a.desgloseId);
      expect(b.avisos.join(' ')).toMatch(/mismo archivo.*ya estaba importado/i);
    }
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(2);
  });

  it('un archivo distinto sí entra; otra flota con el mismo contenido también', async () => {
    await importarDesglose(T, { nombre: 'a.csv', buffer: Buffer.from(csv) });
    await importarDesglose(T, { nombre: 'b.csv', buffer: Buffer.from(csv + '07/08/2026;;Caseta Ejemplo Sur;50,00;\n') });
    await importarDesglose('tenant-2', { nombre: 'a.csv', buffer: Buffer.from(csv) });
    expect(db.tablas.desglose_peaje).toHaveLength(3);
  });

  it('un desglose ANULADO libera la huella: re-subir tras corregir es el flujo normal', async () => {
    await importarDesglose(T, { nombre: 'a.csv', buffer: Buffer.from(csv) });
    db.tablas.desglose_peaje[0].anulado_en = '2026-09-01T00:00:00Z';
    const r = await importarDesglose(T, { nombre: 'a.csv', buffer: Buffer.from(csv) });
    expect(r.ok).toBe(true);
    expect(db.tablas.desglose_peaje).toHaveLength(2);
  });

  it('una cáscara sin líneas (el worker murió a medias) se limpia y se rehace', async () => {
    db = crearDbFalsa({ desglose_peaje: [{ id: 'cascara', tenant_id: T, archivo_sha256: huella, anulado_en: null }] });
    const r = await importarDesglose(T, { nombre: 'a.csv', buffer: Buffer.from(csv) });
    expect(r.ok).toBe(true);
    expect(db.tablas.desglose_peaje.some((d) => d.id === 'cascara')).toBe(false);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(2);
  });

  it('la carrera de dos clics: el 23505 del índice único devuelve el desglose ganador, no un error', async () => {
    // El segundo INSERT choca: el fake no impone índices, así que se simula con un cliente que falla UNA vez con 23505.
    const real = crearDbFalsa({ desglose_peaje_linea: [{ id: 'x1', tenant_id: T, desglose_id: 'ganador', indice: 0, monto: 1 }] });
    let primera = true;
    const ganador = { id: 'ganador', tenant_id: T, archivo_sha256: huella, anulado_en: null };
    const clienteFalso = {
      ...real.cliente,
      from: (t: string) => {
        const q = real.cliente.from(t) as Record<string, unknown>;
        if (t !== 'desglose_peaje') return q;
        return new Proxy(q, {
          get(obj, prop: string) {
            if (prop === 'insert' && primera) {
              primera = false;
              real.tablas.desglose_peaje = [ganador]; // el otro request ya insertó
              return () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) });
            }
            const v = (obj as Record<string, unknown>)[prop];
            return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(obj) : v;
          },
        });
      },
    };
    db = { ...real, cliente: clienteFalso as DbFalsa['cliente'] };
    const r = await importarDesglose(T, { nombre: 'a.csv', buffer: Buffer.from(csv) });
    expect(r).toMatchObject({ ok: true, desgloseId: 'ganador' });
  });

  it('tolera que la 0916 no esté aplicada: la columna no existe → se importa como antes', async () => {
    // Un cliente cuya select/insert por `archivo_sha256` falla con "columna inexistente".
    const base = crearDbFalsa({});
    db = {
      ...base,
      cliente: {
        ...base.cliente,
        from: (t: string) => {
          const q = base.cliente.from(t) as Record<string, (...a: unknown[]) => unknown>;
          if (t !== 'desglose_peaje') return q;
          return new Proxy(q, {
            get(obj, prop: string) {
              if (prop === 'insert') {
                return (fila: Record<string, unknown>) => (
                  'archivo_sha256' in fila
                    ? { select: () => ({ single: async () => ({ data: null, error: { code: 'PGRST204', message: "Could not find the 'archivo_sha256' column of 'desglose_peaje' in the schema cache" } }) }) }
                    : (obj.insert as (f: unknown) => unknown).call(obj, fila));
              }
              if (prop === 'select') {
                return (...a: unknown[]) => {
                  const c = (obj.select as (...x: unknown[]) => Record<string, (...x: unknown[]) => unknown>).apply(obj, a);
                  return new Proxy(c, {
                    get(o2, p2: string) {
                      if (p2 === 'eq') {
                        return (col: string, v: unknown) => {
                          if (col === 'archivo_sha256') return { is: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column desglose_peaje.archivo_sha256 does not exist' } }) }) };
                          return (o2.eq as (...x: unknown[]) => unknown)(col, v);
                        };
                      }
                      const f = o2[p2];
                      return typeof f === 'function' ? (f as (...x: unknown[]) => unknown).bind(o2) : f;
                    },
                  });
                };
              }
              const v = obj[prop];
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(obj) : v;
            },
          });
        },
      } as DbFalsa['cliente'],
    };
    const r = await importarDesglose(T, { nombre: 'a.csv', buffer: Buffer.from(csv) });
    expect(r.ok).toBe(true);
    expect(base.tablas.desglose_peaje).toHaveLength(1);
    expect('archivo_sha256' in base.tablas.desglose_peaje[0]).toBe(false);
  });
});

describe('cruzarLineasDesglose: gastos ya reclamados por otro desglose', () => {
  const gasto = (id: string, monto: number, fecha: string) => ({ id, viajeId: 'v1', monto, fecha });
  it('un gasto reclamado no se vuelve a cuadrar: la línea queda sin contraparte (contraparte_ya_reclamada)', () => {
    const r = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], [gasto('g1', 189, '2026-08-05')], new Set(['g1']));
    expect(r[0]).toMatchObject({ estatus: 'sin_contraparte', detalle: { motivo: 'contraparte_ya_reclamada' } });
  });
  it('sin reclamados, cuadra como siempre; y otro gasto del mismo monto SÍ se asigna', () => {
    const gastos = [gasto('g1', 189, '2026-08-05'), gasto('g2', 189, '2026-08-05')];
    expect(cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], [gasto('g1', 189, '2026-08-05')])[0].estatus).toBe('cuadra');
    const r = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], gastos, new Set(['g1']));
    expect(r[0]).toMatchObject({ estatus: 'cuadra', gastoId: 'g2' });
  });
});

describe('conciliarDesglose: dos desgloses traslapados no cuadran el mismo gasto', () => {
  const fixture = () => ({
    desglose_peaje: [
      { id: 'vieja', tenant_id: T, proveedor: 'PASE', creado_en: '2026-09-01T10:00:00Z', anulado_en: null },
      { id: 'nueva', tenant_id: T, proveedor: 'PASE', creado_en: '2026-09-02T10:00:00Z', anulado_en: null },
    ],
    desglose_peaje_linea: [
      { id: 'lv', tenant_id: T, desglose_id: 'vieja', indice: 0, fecha: '2026-08-05', monto: 189, caseta: 'Caseta Ejemplo Norte', tag: null, cruce_en: null, estatus: 'cuadra', detalle: { gastoId: 'g1' } },
      { id: 'ln', tenant_id: T, desglose_id: 'nueva', indice: 0, fecha: '2026-08-05', monto: 189, caseta: 'Caseta Ejemplo Norte', tag: null, cruce_en: null },
    ],
    gasto: [{ id: 'g1', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 189, fecha: '2026-08-05' }],
    viaje: [{ id: 'v1', tenant_id: T, unidad_id: 'u1' }],
  });

  it('la NUEVA no cuadra el gasto que la vieja ya reclamó; la vieja conserva el suyo al re-correrse', async () => {
    db = crearDbFalsa(fixture());
    await conciliarDesglose(T, 'nueva', 'manual');
    expect(db.tablas.desglose_peaje_linea.find((l) => l.id === 'ln')).toMatchObject({ estatus: 'sin_contraparte', detalle: { motivo: 'contraparte_ya_reclamada' } });
    await conciliarDesglose(T, 'vieja', 'manual');
    expect(db.tablas.desglose_peaje_linea.find((l) => l.id === 'lv')).toMatchObject({ estatus: 'cuadra' });
    expect((db.tablas.desglose_peaje_linea.find((l) => l.id === 'lv')?.detalle as Record<string, unknown>).gastoId).toBe('g1');
  });

  it('si la vieja se ANULA, la nueva ya puede cuadrar ese gasto', async () => {
    const f = fixture();
    f.desglose_peaje[0].anulado_en = '2026-09-03T00:00:00Z' as never;
    db = crearDbFalsa(f);
    await conciliarDesglose(T, 'nueva', 'manual');
    expect(db.tablas.desglose_peaje_linea.find((l) => l.id === 'ln')?.estatus).toBe('cuadra');
  });

  it('sin desgloses anteriores el cruce es el de siempre', async () => {
    const f = fixture();
    f.desglose_peaje = f.desglose_peaje.slice(1);
    f.desglose_peaje_linea = f.desglose_peaje_linea.slice(1);
    db = crearDbFalsa(f);
    await conciliarDesglose(T, 'nueva', 'manual');
    expect(db.tablas.desglose_peaje_linea[0].estatus).toBe('cuadra');
  });
});
