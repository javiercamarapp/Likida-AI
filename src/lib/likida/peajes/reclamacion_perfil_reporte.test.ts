import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

// T-A2-24: `reporteReclamacion` con `perfilRestringido` NO lee geocercas ni cursos (stand-by) y devuelve las leyendas del perfil;
// sin la opción, todo igual que siempre. Fixtures sintéticos.
let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { reporteReclamacion } = await import('./bitacora_conciliada');
const { LEYENDAS_RECLAMACION } = await import('./reclamacion');
const { TEXTO_CANDIDATO } = await import('./reclamacion_perfil');

const T = 'flota-1';
const linea = (o: Fila): Fila => ({
  tenant_id: T, desglose_id: 'd1', fecha: '2026-08-05', hora: '10:30:00', caseta: 'Caseta Ejemplo Norte', monto: 189, tag: 'IMDM 10000001',
  estatus: 'sin_contraparte', diferencia: null, detalle: null, viaje_id: null, unidad_id: 'u1', caseta_id: 'c1',
  gps_veredicto: null, gps_distancia_m: null, gps_detalle: null, ...o,
});
const tablasLeidas = () => new Set(db.llamadas.map((l) => l.tabla));

beforeEach(() => {
  db = crearDbFalsa({
    desglose_peaje: [{ id: 'd1', tenant_id: T, proveedor: 'PASE', periodo_desde: '2026-08-05', periodo_hasta: '2026-08-07' }],
    unidad: [{ id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: null }],
    peaje_caseta: [{ id: 'c1', tenant_id: T, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: 19.5, lng: -99.2, radio_m: 300, activa: true }],
    desglose_peaje_linea: [
      linea({ indice: 0, gps_veredicto: 'no_coincide', gps_distancia_m: 8000, gps_detalle: { muestras: 2 }, monto: 250 }),
      linea({ indice: 1, gps_veredicto: 'sin_datos', gps_detalle: { motivo: 'sin_posiciones_ventana', muestras: 0 }, monto: 300 }),
    ],
  });
});

describe('reporteReclamacion con perfil restringido', () => {
  it('no lee geocercas ni cursos, y trae las leyendas del perfil con el rótulo «candidato»', async () => {
    const r = await reporteReclamacion(T, 'd1', { perfilRestringido: true });
    expect(r).not.toBeNull();
    const leidas = tablasLeidas();
    for (const t of ['geocerca', 'peaje_curso', 'peaje_curso_caseta']) expect(leidas.has(t), t).toBe(false);
    expect(r!.leyendas).toContain(TEXTO_CANDIDATO);
    expect(r!.leyendas.join(' ')).not.toMatch(/Cruce fuera de curso|Unidad en zona no autorizada/);
    expect(r!.cruces.map((c) => c.motivo)).toEqual(['gps_lejos_de_caseta']);
    expect(r!.resumen.sinDatos).toBe(1);
  });
  it('sin la opción: igual que siempre (lee geocercas y cursos, leyendas completas)', async () => {
    const r = await reporteReclamacion(T, 'd1');
    const leidas = tablasLeidas();
    expect(leidas.has('geocerca')).toBe(true);
    expect(leidas.has('peaje_curso')).toBe(true);
    expect(r!.leyendas).toEqual(LEYENDAS_RECLAMACION);
  });
  it('flota ajena o desglose inexistente: null también con perfil', async () => {
    expect(await reporteReclamacion('flota-2', 'd1', { perfilRestringido: true })).toBeNull();
  });
});
