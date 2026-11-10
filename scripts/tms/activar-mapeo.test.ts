import { describe, expect, it } from 'vitest';
import { cambiarRecurso, decidirEntorno, parsearArgs, validarArchivo, huella } from './activar-mapeo.mjs';
import { validarMapeo } from '../../src/lib/likida/conectores/tms/mapeo';
import viajes from '../../src/lib/likida/conectores/tms/mapeos/viajes.supuesto.json';
import liquidaciones from '../../src/lib/likida/conectores/tms/mapeos/liquidaciones.supuesto.json';

const T = '11111111-2222-4333-8444-555555555555';

// Cliente pg en memoria: una tabla tms_mapeo y un registro de las sentencias de escritura.
function pgFalso(inicial: Array<{ recurso: string; version: number; activo: boolean; mapeo: unknown }>) {
  const filas = inicial.map((f) => ({ ...f }));
  const sentencias: string[] = [];
  return {
    filas, sentencias,
    async query(sql: string, p: unknown[] = []) {
      const s = sql.trim().toLowerCase();
      if (s.startsWith('select id, version, mapeo')) return { rows: filas.filter((f) => f.recurso === p[1] && f.activo).map((f) => ({ id: 'x', ...f })) };
      if (s.startsWith('select coalesce(max')) return { rows: [{ m: Math.max(0, ...filas.filter((f) => f.recurso === p[1]).map((f) => f.version)) }] };
      sentencias.push(s.split(' ').slice(0, 3).join(' '));
      if (s.startsWith('update public.tms_mapeo')) filas.filter((f) => f.recurso === p[1]).forEach((f) => { f.activo = false; });
      if (s.startsWith('insert into public.tms_mapeo')) filas.push({ recurso: String(p[1]), mapeo: JSON.parse(String(p[2])), version: Number(p[3]), activo: true });
      return { rows: [], rowCount: 1 };
    },
  };
}

describe('activar-mapeo: argumentos y entorno', () => {
  it('exige UUID y recurso válido; rechaza opciones desconocidas', () => {
    expect(parsearArgs(['--tenant', 'x', '--recurso', 'viajes', '--mapeo', 'a.json'])).toHaveProperty('error');
    expect(parsearArgs(['--tenant', T, '--recurso', 'otro', '--mapeo', 'a.json'])).toHaveProperty('error');
    expect(parsearArgs(['--tenant', T, '--recurso', 'viajes', '--mapeo', 'a.json', '--raro'])).toHaveProperty('error');
    expect(parsearArgs(['--tenant', T, '--desactivar'])).toHaveProperty('error');
    expect(parsearArgs(['--tenant', T, '--desactivar', '--todos'])).not.toHaveProperty('error');
  });
  it('se niega contra una base no local sin --produccion y el UUID; con ambos deja pasar', () => {
    const remoto = { DATABASE_URL: 'postgresql://u:p@db.ejemplo.supabase.co:5432/postgres' };
    const base = parsearArgs(['--tenant', T, '--recurso', 'viajes', '--mapeo', 'a.json', '--aplicar']) as never;
    expect(decidirEntorno(base, remoto).ok).toBe(false);
    const sinUuid = parsearArgs(['--tenant', T, '--recurso', 'viajes', '--mapeo', 'a.json', '--produccion']) as never;
    expect(decidirEntorno(sinUuid, remoto).ok).toBe(false);
    const malUuid = parsearArgs(['--tenant', T, '--recurso', 'viajes', '--mapeo', 'a.json', '--produccion', '--confirmar', '99999999-2222-4333-8444-555555555555']) as never;
    expect(decidirEntorno(malUuid, remoto).ok).toBe(false);
    const bien = parsearArgs(['--tenant', T, '--recurso', 'viajes', '--mapeo', 'a.json', '--produccion', '--confirmar', T]) as never;
    expect(decidirEntorno(bien, remoto)).toEqual({ ok: true, local: false });
    expect(decidirEntorno(base, { DATABASE_URL: 'postgresql:///likida_demo' })).toEqual({ ok: true, local: true });
  });
});

describe('activar-mapeo: validación', () => {
  it('acepta los mapeos supuestos y rechaza uno roto o de otro recurso', () => {
    expect(validarArchivo('viajes', viajes, validarMapeo)).toEqual([]);
    expect(validarArchivo('liquidaciones', liquidaciones, validarMapeo)).toEqual([]);
    expect(validarArchivo('peajes', viajes, validarMapeo).join(' ')).toMatch(/recurso/);
    expect(validarArchivo('viajes', { ...viajes, ruta: 'http://x' }, validarMapeo).length).toBeGreaterThan(0);
    expect(validarArchivo('liquidaciones', { nomina: viajes }, validarMapeo).length).toBeGreaterThan(0);
  });
});

describe('activar-mapeo: cambio de recurso', () => {
  it('ensayo: no escribe nada, dice la versión nueva', async () => {
    const pg = pgFalso([{ recurso: 'viajes', version: 2, activo: true, mapeo: { a: 1 } }]);
    const r = await cambiarRecurso(pg, { tenant: T, recurso: 'viajes', mapeo: viajes, desactivar: false, aplicar: false });
    expect(r).toMatchObject({ aplicado: false, versionActiva: 2, versionNueva: 3, sinCambio: false });
    expect(pg.sentencias).toEqual([]);
  });
  it('aplicar: desactiva la activa e inserta la siguiente versión en una transacción; reaplicar lo mismo no cambia nada', async () => {
    const pg = pgFalso([{ recurso: 'viajes', version: 1, activo: true, mapeo: { a: 1 } }]);
    const r = await cambiarRecurso(pg, { tenant: T, recurso: 'viajes', mapeo: viajes, desactivar: false, aplicar: true });
    expect(r).toMatchObject({ aplicado: true, versionNueva: 2 });
    expect(pg.sentencias).toEqual(['begin', 'update public.tms_mapeo set', 'insert into public.tms_mapeo', 'commit']);
    expect(pg.filas.filter((f) => f.activo).map((f) => f.version)).toEqual([2]);
    const otra = await cambiarRecurso(pg, { tenant: T, recurso: 'viajes', mapeo: viajes, desactivar: false, aplicar: true });
    expect(otra).toMatchObject({ aplicado: false, sinCambio: true });
    expect(huella(viajes)).toBe(huella(JSON.parse(JSON.stringify(viajes))));
  });
  it('desactivar frena la lectura sin borrar historia; sin activa no hace nada', async () => {
    const pg = pgFalso([{ recurso: 'viajes', version: 1, activo: true, mapeo: {} }]);
    expect(await cambiarRecurso(pg, { tenant: T, recurso: 'viajes', mapeo: null, desactivar: true, aplicar: true })).toMatchObject({ aplicado: true });
    expect(pg.filas).toHaveLength(1);
    expect(pg.filas[0].activo).toBe(false);
    expect(await cambiarRecurso(pg, { tenant: T, recurso: 'viajes', mapeo: null, desactivar: true, aplicar: true })).toMatchObject({ aplicado: false, sinCambio: true });
  });
  it('un fallo a mitad de la transacción hace rollback', async () => {
    const pg = pgFalso([]);
    const q = pg.query.bind(pg);
    pg.query = async (sql: string, p?: unknown[]) => { if (sql.trim().toLowerCase().startsWith('insert')) throw new Error('boom'); return q(sql, p); };
    await expect(cambiarRecurso(pg, { tenant: T, recurso: 'viajes', mapeo: viajes, desactivar: false, aplicar: true })).rejects.toThrow('boom');
    expect(pg.sentencias).toContain('rollback');
  });
});
