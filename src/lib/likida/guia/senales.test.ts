import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SenalesAsistente } from '../asistente/pasos_cinco_agentes';
import { leerSenalesGuia, puedeLeerSenal, REGISTRO_SENALES, senalesDeAsistente } from './senales';
import { IDS_SENAL } from './tipos';

const base: SenalesAsistente = {
  tms: { activa: true, probadaEn: '2026-11-01', ultimoError: null }, archivosRecibidos: 2, correoPlataforma: true,
  correoDesglose: { activa: true, usaCorreo: true, remitenteCapturado: true }, operadores: { activos: 5, conCorreo: 3 }, unidadesActivas: 4,
  patios: 1, coordinadores: 0, supervisores: 1, revisorCartaPorte: false,
};

/** Cliente falso: `.from(t).select().eq().eq().limit()` resuelve con las filas de `tablas[t]`; registra los filtros. */
function dbFalso(tablas: Record<string, unknown[] | 'error'>, filtros: Array<[string, string, unknown]> = []): SupabaseClient {
  return {
    from: (t: string) => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push([t, c, v]); return q; },
        limit: async () => (tablas[t] === 'error' ? { data: null, error: { message: 'x' } } : { data: tablas[t] ?? [], error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}
const dep = (db: SupabaseClient, s: SenalesAsistente | Error = base) => ({ db, leerAsistente: async () => { if (s instanceof Error) throw s; return s; } });

describe('registro', () => {
  it('toda señal de la lista tiene registro con al menos un lector', () => {
    for (const id of IDS_SENAL) expect(REGISTRO_SENALES[id].lectores.length, id).toBeGreaterThan(0);
  });
  it('una pista no lee lo que no es suyo', () => {
    expect(puedeLeerSenal('dueno_ca', 'tms_probada')).toBe(true);
    expect(puedeLeerSenal('contador', 'tms_probada')).toBe(false);
    expect(puedeLeerSenal('nomina', 'llave_emitida')).toBe(false);
  });
});

describe('senalesDeAsistente', () => {
  it('traduce las señales ya medidas', () => {
    const r = senalesDeAsistente(base);
    expect(r.coordinadores).toEqual({ estado: 'no', n: 0 });
    expect(r.archivos_recibidos).toEqual({ estado: 'si', n: 2 });
    expect(r.tms_probada).toEqual({ estado: 'si' });
    expect(r.operadores_con_correo).toEqual({ estado: 'si', n: 3 });
    expect(r.revisor_cp).toEqual({ estado: 'no' });
    expect(r.correo_desglose_activo).toEqual({ estado: 'si' });
  });
  it('una credencial con error o sin prueba NO cuenta como probada; sin credencial es no', () => {
    expect(senalesDeAsistente({ ...base, tms: { activa: true, probadaEn: '2026-11-01', ultimoError: 'timeout' } }).tms_probada?.estado).toBe('no');
    expect(senalesDeAsistente({ ...base, tms: { activa: true, probadaEn: null, ultimoError: null } }).tms_probada?.estado).toBe('no');
    expect(senalesDeAsistente({ ...base, tms: 'sin_credencial' }).tms_probada?.estado).toBe('no');
  });
  it('null es sin_dato, nunca 0', () => {
    const r = senalesDeAsistente({ ...base, tms: null, archivosRecibidos: null, operadores: null, revisorCartaPorte: null, correoDesglose: null });
    for (const k of ['tms_probada', 'archivos_recibidos', 'operadores_con_correo', 'revisor_cp', 'correo_desglose_activo'] as const) expect(r[k]?.estado, k).toBe('sin_dato');
  });
});

describe('leerSenalesGuia', () => {
  it('lee del asistente y de tablas, siempre acotado por tenant', async () => {
    const filtros: Array<[string, string, unknown]> = [];
    const db = dbFalso({ cp_documento: [{ tenant_id: 't1' }], tenant_api_key: [] }, filtros);
    const r = await leerSenalesGuia(['tms_probada', 'documento_aprobado', 'llave_emitida'], 't1', 'dueno_ca', dep(db));
    expect(r.tms_probada.estado).toBe('si');
    expect(r.documento_aprobado.estado).toBe('si');
    expect(r.llave_emitida.estado).toBe('no');
    expect(filtros).toContainEqual(['cp_documento', 'tenant_id', 't1']);
    expect(filtros).toContainEqual(['cp_documento', 'estado', 'aprobado']);
    expect(filtros.filter(([, c]) => c === 'tenant_id')).toHaveLength(2);
  });
  it('una señal no permitida para la pista, desconocida o sin lector devuelve sin_dato (sin tocar la base)', async () => {
    const filtros: Array<[string, string, unknown]> = [];
    const r = await leerSenalesGuia(['tms_probada', 'no_existe', 'mfa_activo'], 't1', 'contador', dep(dbFalso({}, filtros)));
    expect(r.tms_probada.estado).toBe('sin_dato');
    expect(r.no_existe.estado).toBe('sin_dato');
    expect(r.mfa_activo.estado).toBe('sin_dato');
    expect(filtros).toHaveLength(0);
  });
  it('si falla una lectura cae a sin_dato por separado, sin tumbar las demás', async () => {
    const r = await leerSenalesGuia(['llave_emitida', 'programa_vigia'], 't1', 'dueno_ca', dep(dbFalso({ tenant_api_key: 'error', programa_despacho_carga: [{ tenant_id: 't1' }] })));
    expect(r.llave_emitida.estado).toBe('sin_dato');
    expect(r.programa_vigia.estado).toBe('si');
  });
  it('si el asistente lanza, sus señales caen a sin_dato y las de tabla siguen', async () => {
    const r = await leerSenalesGuia(['coordinadores', 'llave_emitida'], 't1', 'dueno_ca', dep(dbFalso({ tenant_api_key: [{ tenant_id: 't1' }] }), new Error('caído')));
    expect(r.coordinadores.estado).toBe('sin_dato');
    expect(r.llave_emitida.estado).toBe('si');
  });
  it('lee a lo más 10 señales distintas por llamada', async () => {
    const r = await leerSenalesGuia([...IDS_SENAL], 't1', 'dueno_ca', dep(dbFalso({})));
    expect(Object.keys(r).length).toBeLessThanOrEqual(10);
  });
});
