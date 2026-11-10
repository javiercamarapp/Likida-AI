import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BandejaEscalaciones, ConteosEscalaciones } from '@/lib/admin/escalaciones';

vi.mock('@/lib/admin/escalaciones', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/escalaciones')>()),
  getBandejaEscalaciones: vi.fn(),
}));

import {
  obtenerRequiereAccion, resumirRequiereAccion, vaciarCacheRequiereAccion, SIN_DATO, TTL_REQUIERE_ACCION_MS,
} from './requiere-accion';

const CERO: ConteosEscalaciones = {
  arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0,
};
const CAIDO: ConteosEscalaciones = {
  arco: null, corridasFallo: null, talachas: null, facturasProveedor: null, ticketsAbiertos: null, ticketsVencidos: null, liquidacionesRevisar: null,
};
const bandeja = (c: Partial<ConteosEscalaciones>) => ({ conteos: { ...CERO, ...c } }) as unknown as BandejaEscalaciones;

beforeEach(() => vaciarCacheRequiereAccion());

describe('resumirRequiereAccion', () => {
  it('0 pendientes: número 0 (se leyó y no hay nada), sin urgencia', () => {
    expect(resumirRequiereAccion(bandeja({}))).toEqual({ pendientes: 0, hayUrgente: false });
  });
  it('3 pendientes: suma las fuentes', () => {
    expect(resumirRequiereAccion(bandeja({ talachas: 2, liquidacionesRevisar: 1 })).pendientes).toBe(3);
  });
  it('12 pendientes: suma todas, sin contar dos veces los tickets vencidos (subconjunto de los abiertos)', () => {
    const r = resumirRequiereAccion(bandeja({ arco: 1, corridasFallo: 2, talachas: 3, facturasProveedor: 1, ticketsAbiertos: 4, ticketsVencidos: 2, liquidacionesRevisar: 1 }));
    expect(r.pendientes).toBe(12);
    expect(r.hayUrgente).toBe(true);
  });
  it('lectura caída total: null, nunca 0', () => {
    expect(resumirRequiereAccion(bandeja(CAIDO)).pendientes).toBeNull();
  });
  it('lectura caída parcial sin pendientes legibles: null (no 0); con pendientes legibles informa el mínimo', () => {
    expect(resumirRequiereAccion(bandeja({ arco: null })).pendientes).toBeNull();
    expect(resumirRequiereAccion(bandeja({ arco: null, talachas: 2 })).pendientes).toBe(2);
  });
  it('el aviso de «no se pudo leer» no cuenta como urgencia', () => {
    expect(resumirRequiereAccion(bandeja(CAIDO)).hayUrgente).toBe(false);
  });
});

describe('obtenerRequiereAccion', () => {
  it('guarda el resultado en caché corta y lo recalcula al vencer', async () => {
    const leer = vi.fn().mockResolvedValue(bandeja({ talachas: 3 }));
    expect((await obtenerRequiereAccion(1_000, leer)).pendientes).toBe(3);
    await obtenerRequiereAccion(1_000 + TTL_REQUIERE_ACCION_MS - 1, leer);
    expect(leer).toHaveBeenCalledTimes(1);
    await obtenerRequiereAccion(1_000 + TTL_REQUIERE_ACCION_MS, leer);
    expect(leer).toHaveBeenCalledTimes(2);
  });
  it('si la bandeja lanza devuelve «sin dato» y no lo cachea', async () => {
    const leer = vi.fn().mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(bandeja({ talachas: 1 }));
    expect(await obtenerRequiereAccion(5, leer)).toEqual(SIN_DATO);
    expect((await obtenerRequiereAccion(6, leer)).pendientes).toBe(1);
  });
});
