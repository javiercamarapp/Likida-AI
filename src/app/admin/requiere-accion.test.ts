import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BandejaEscalaciones, ConteosEscalaciones } from '@/lib/admin/escalaciones';

vi.mock('@/lib/admin/escalaciones', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/escalaciones')>()),
  getBandejaEscalaciones: vi.fn(),
}));

import type { AlertaExtra } from '@/lib/admin/fuentes-alerta-extra';
import type { ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';
import {
  obtenerPanoramaAccion, obtenerRequiereAccion, resumirRequiereAccion, vaciarCacheRequiereAccion, SIN_DATO, TTL_REQUIERE_ACCION_MS,
} from './requiere-accion';

const CERO: ConteosEscalaciones = {
  arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0,
};
const CAIDO: ConteosEscalaciones = {
  arco: null, corridasFallo: null, talachas: null, facturasProveedor: null, ticketsAbiertos: null, ticketsVencidos: null, liquidacionesRevisar: null,
};
const bandeja = (c: Partial<ConteosEscalaciones>) => ({ conteos: { ...CERO, ...c } }) as unknown as BandejaEscalaciones;

const SIN_EXTRAS = async () => [] as AlertaExtra[];
const extra = (id: AlertaExtra['id']): AlertaExtra => ({ id, tipo: 'atencion', texto: id, href: '/admin/crons', items: [] });

beforeEach(() => vaciarCacheRequiereAccion());

const COLA: ResumenBandejaCola = {
  pendientes: 100, urgentes: 0, masViejaCreadaEn: '2026-09-02T00:00:00Z', diasMasVieja: 70, frenaAlRunner: true,
  motivoFreno: 'bandeja sin atender', topeBandeja: 40, diasVencimiento: 7,
};

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
    expect((await obtenerRequiereAccion(1_000, leer, SIN_EXTRAS)).pendientes).toBe(3);
    await obtenerRequiereAccion(1_000 + TTL_REQUIERE_ACCION_MS - 1, leer, SIN_EXTRAS);
    expect(leer).toHaveBeenCalledTimes(1);
    await obtenerRequiereAccion(1_000 + TTL_REQUIERE_ACCION_MS, leer, SIN_EXTRAS);
    expect(leer).toHaveBeenCalledTimes(2);
  });
  it('si la bandeja lanza devuelve «sin dato» y no lo cachea', async () => {
    const leer = vi.fn().mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(bandeja({ talachas: 1 }));
    expect(await obtenerRequiereAccion(5, leer, SIN_EXTRAS)).toEqual(SIN_DATO);
    expect((await obtenerRequiereAccion(6, leer, SIN_EXTRAS)).pendientes).toBe(1);
  });
});

describe('fuentes de alerta extra', () => {
  it('cada alerta extra suma 1 y es urgente', () => {
    const r = resumirRequiereAccion(bandeja({ talachas: 2 }), [extra('cron_sin_latido'), extra('ia_credito_agotado')]);
    expect(r).toEqual({ pendientes: 4, hayUrgente: true });
  });
  it('«crons ilegibles» no suma ni es urgente; con bandeja ciega sigue siendo null', () => {
    expect(resumirRequiereAccion(bandeja({}), [extra('crons_ilegibles')])).toEqual({ pendientes: 0, hayUrgente: false });
    expect(resumirRequiereAccion(bandeja(CAIDO), [extra('crons_ilegibles')]).pendientes).toBeNull();
  });
  it('bandeja ciega pero con alerta real: informa el mínimo legible', () => {
    expect(resumirRequiereAccion(bandeja(CAIDO), [extra('cron_estado_no_ok')]).pendientes).toBe(1);
  });
  it('si leer las extras lanza, la campana sigue con la bandeja sola', async () => {
    const leer = vi.fn().mockResolvedValue(bandeja({ talachas: 2 }));
    const r = await obtenerRequiereAccion(9, leer, () => Promise.reject(new Error('x')));
    expect(r).toEqual({ pendientes: 2, hayUrgente: true });
  });
});

describe('panorama: el estado de la bandeja de aprobación viaja con la misma lectura', () => {
  it('trae la cola junto a la bandeja y la guarda en la misma caché (una lectura por ventana)', async () => {
    const leer = vi.fn().mockResolvedValue(bandeja({ talachas: 1 }));
    const leerCola = vi.fn().mockResolvedValue(COLA);
    const a = await obtenerPanoramaAccion(1_000, leer, SIN_EXTRAS, leerCola);
    expect(a.cola).toEqual(COLA);
    await obtenerPanoramaAccion(1_001, leer, SIN_EXTRAS, leerCola);
    expect(leerCola).toHaveBeenCalledTimes(1);
  });
  it('si leer la cola lanza, la campana y las pestañas siguen: cola null («sin dato»), nunca 0', async () => {
    const leer = vi.fn().mockResolvedValue(bandeja({ talachas: 2 }));
    const p = await obtenerPanoramaAccion(7, leer, SIN_EXTRAS, () => Promise.reject(new Error('red')));
    expect(p.cola).toBeNull();
    expect(p.resumen.pendientes).toBe(2);
  });
  it('si la bandeja entera falla: todo «sin dato»', async () => {
    const p = await obtenerPanoramaAccion(8, vi.fn().mockRejectedValue(new Error('x')), SIN_EXTRAS, async () => COLA);
    expect(p).toEqual({ resumen: SIN_DATO, bandeja: null, cola: null });
  });
});
