import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import {
  validarConfigAvisos, configAvisosEfectiva, parsearDiasAviso, CONFIG_AVISOS_DEFAULT, INTERRUPTORES,
  PLAZO_MESES_MAX, AVISO_DIAS_MAX, DIAS_GRACIA_MAX,
} from './config_avisos';
import { CONFIG_ATIPICOS_DEFAULT } from './atipicos';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');
const A = await import('./aviso_atipicos');

const T = 'tenant-1';
const OTRO = 'tenant-2';
beforeEach(() => { db = crearDbFalsa({}); });

describe('valores por omisión: todo apagado y sin destinatario', () => {
  it('ningún interruptor nace encendido', () => {
    for (const i of INTERRUPTORES) expect(CONFIG_AVISOS_DEFAULT.interruptores[i]).toBe(false);
    const v = validarConfigAvisos(undefined);
    expect(v.ok && v.valor).toEqual(CONFIG_AVISOS_DEFAULT);
  });
  it('una flota sin fila lee todo apagado, con los umbrales por omisión y sin teléfono', async () => {
    const c = await D.leerConfigPeajes(T);
    expect(c.atipicosActivo).toBe(false);
    expect(c.umbrales).toEqual(CONFIG_ATIPICOS_DEFAULT);
    expect(c.avisos).toEqual(CONFIG_AVISOS_DEFAULT);
    expect(c.telefono).toBeNull();
  });
});

describe('validación con mensajes llanos', () => {
  it.each([
    [{ plazo: { meses: 0 } }, /plazo va de 1 a 24 meses/],
    [{ plazo: { meses: PLAZO_MESES_MAX + 1 } }, /plazo va de 1 a 24 meses/],
    [{ plazo: { meses: 2.5 } }, /número entero de meses/],
    [{ plazo: { meses: 'tres' } }, /número de meses/],
    [{ plazo: { avisoDias: [] } }, /al menos un día de aviso/],
    [{ plazo: { avisoDias: [0] } }, /Cada aviso va de 1 a 365/],
    [{ plazo: { avisoDias: [AVISO_DIAS_MAX + 1] } }, /Cada aviso va de 1 a 365/],
    [{ plazo: { avisoDias: [30, 30] } }, /repetido/],
    [{ plazo: { avisoDias: [1, 2, 3, 4, 5, 6] } }, /Máximo 5 avisos/],
    [{ recordatorio: { diasGracia: -1 } }, /gracia van de 0 a 10/],
    [{ recordatorio: { diasGracia: DIAS_GRACIA_MAX + 1 } }, /gracia van de 0 a 10/],
    [{ interruptores: { aviso_plazo: 'si' } }, /sí o no/],
  ])('rechaza %j', (entrada, patron) => {
    const v = validarConfigAvisos(entrada);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toMatch(patron);
  });

  it('acepta los extremos y ordena los avisos del más lejano al más cercano', () => {
    const v = validarConfigAvisos({ plazo: { meses: 24, avisoDias: [7, 365, 30] }, recordatorio: { diasGracia: 0 } });
    expect(v.ok && v.valor.plazo).toEqual({ meses: 24, avisoDias: [365, 30, 7] });
    expect(v.ok && v.valor.recordatorio.diasGracia).toBe(0);
  });

  it('una configuración corrupta guardada cae a los defaults (nada se enciende solo)', () => {
    expect(configAvisosEfectiva({ interruptores: { aviso_plazo: 'x' }, plazo: { meses: -4 } })).toEqual(CONFIG_AVISOS_DEFAULT);
    expect(configAvisosEfectiva('basura')).toEqual(CONFIG_AVISOS_DEFAULT);
  });

  it('parsea la lista de días escrita a mano y no adivina lo ambiguo', () => {
    expect(parsearDiasAviso('30, 7')).toEqual([30, 7]);
    expect(parsearDiasAviso('30 7;3')).toEqual([30, 7, 3]);
    expect(parsearDiasAviso('')).toBeNull();
    expect(parsearDiasAviso('3x')).toBeNull();
    expect(parsearDiasAviso('2.5')).toBeNull();
    expect(parsearDiasAviso('-7')).toBeNull();
  });
});

describe('guardar y leer', () => {
  it('guarda el plazo y los interruptores, y los relee; la flota ajena no los ve', async () => {
    const r = await D.guardarConfigAvisos(T, { plazo: { meses: 4, avisoDias: [20, 5] }, recordatorio: { diasGracia: 3 }, interruptores: { aviso_plazo: true, recordatorio_archivo: false } });
    expect(r.ok).toBe(true);
    const c = await D.leerConfigPeajes(T);
    expect(c.avisos.plazo).toEqual({ meses: 4, avisoDias: [20, 5] });
    expect(c.avisos.recordatorio.diasGracia).toBe(3);
    expect(c.avisos.interruptores).toEqual({ aviso_plazo: true, recordatorio_archivo: false });
    expect(c.atipicosActivo).toBe(false);
    expect((await D.leerConfigPeajes(OTRO)).avisos).toEqual(CONFIG_AVISOS_DEFAULT);
    expect(db.tablas.peaje_atipico_config).toHaveLength(1);
  });

  it('un valor fuera de rango se rechaza y no escribe nada', async () => {
    const r = await D.guardarConfigAvisos(T, { plazo: { meses: 99 } });
    expect(r.ok).toBe(false);
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });

  it('guardar umbrales conserva el plazo y el destinatario; guardar el plazo conserva umbrales e interruptor del detector', async () => {
    expect((await A.guardarDestinatarioAtipicos(T, '+52 55 0000 0000')).ok).toBe(true); // grep-limpio:ok
    await D.guardarConfigAvisos(T, { plazo: { meses: 5 }, interruptores: { aviso_plazo: true } });
    const u = await D.guardarUmbralesPeajes(T, { activo: true, umbrales: { repeticion_caseta: { activa: true, minCruces: 7, ventanaHoras: 12 } } });
    expect(u.ok).toBe(true);
    let c = await D.leerConfigPeajes(T);
    expect(c.atipicosActivo).toBe(true);
    expect(c.umbrales.repeticion_caseta).toEqual({ activa: true, minCruces: 7, ventanaHoras: 12 });
    expect(c.avisos.plazo.meses).toBe(5);
    expect(c.avisos.interruptores.aviso_plazo).toBe(true);
    expect(c.telefono).toBe('525500000000'); // grep-limpio:ok

    await D.guardarConfigAvisos(T, { plazo: { meses: 6 } });
    c = await D.leerConfigPeajes(T);
    expect(c.atipicosActivo).toBe(true);
    expect(c.umbrales.repeticion_caseta.minCruces).toBe(7);
    expect(c.telefono).toBe('525500000000'); // grep-limpio:ok
    expect(c.avisos.plazo.meses).toBe(6);
    expect(c.avisos.interruptores.aviso_plazo).toBe(false);
    expect(db.tablas.peaje_atipico_config).toHaveLength(1);
  });

  it('vaciar el destinatario deja solo-pantalla y no borra lo demás', async () => {
    await A.guardarDestinatarioAtipicos(T, '5500000000'); // grep-limpio:ok
    await D.guardarConfigAvisos(T, { plazo: { meses: 5 } });
    expect((await A.guardarDestinatarioAtipicos(T, '')).ok).toBe(true);
    const c = await D.leerConfigPeajes(T);
    expect(c.telefono).toBeNull();
    expect(c.avisos.plazo.meses).toBe(5);
  });

  it('umbrales fuera de rango (H <= 0, velocidad < 30, N < 2) se rechazan con mensaje llano', async () => {
    const a = await D.guardarUmbralesPeajes(T, { activo: true, umbrales: { repeticion_caseta: { ventanaHoras: 0 } } });
    const b = await D.guardarUmbralesPeajes(T, { activo: true, umbrales: { secuencia_imposible: { velocidadMaxKmh: 10 } } });
    const c = await D.guardarUmbralesPeajes(T, { activo: true, umbrales: { repeticion_caseta: { minCruces: 1 } } });
    for (const r of [a, b, c]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).not.toMatch(/zod|undefined|\[object/i);
    }
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });

  it('un error de base al leer se lanza (no se lee «apagado» estando ciego) y al guardar falla cerrado', async () => {
    db.fallar('peaje_atipico_config.select', 'boom');
    await expect(D.leerConfigPeajes(T)).rejects.toThrow(/boom/);
    const r = await D.guardarConfigAvisos(T, { plazo: { meses: 4 } });
    expect(r.ok).toBe(false);
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });
});
