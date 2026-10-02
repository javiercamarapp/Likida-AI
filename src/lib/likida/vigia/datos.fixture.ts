// Datos de prueba compartidos del Vigía. SOLO para pruebas (`.fixture.ts` queda
// fuera de los barridos de producción).
import type { EstatusViaje, ResumenViaje } from './estatus_viaje';

export const T1 = '11111111-1111-4111-8111-111111111111'; // flota A
export const T2 = '22222222-2222-4222-8222-222222222222'; // flota B
export const CLIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CLIENTE_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'; // otro cliente de la misma flota
export const CLIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const VIAJE_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
export const VIAJE_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
export const VIAJE_AJENO = 'cccccccc-cccc-4ccc-8ccc-cccccccccc99';

export const AHORA = new Date('2026-10-01T18:00:00.000Z');

export function estatus(extra: Partial<EstatusViaje> = {}): EstatusViaje {
  return {
    viajeId: VIAJE_1, folio: 'F-1042', origen: 'Guadalajara', destino: 'Monterrey',
    etapa: 'en_curso', ultimoHito: null,
    posicion: { lat: 21.1619, lng: -101.6921, medidaEn: new Date(AHORA.getTime() - 12 * 60_000).toISOString() },
    etaIso: null, etaFuente: null, citaCarga: null, enAnden: null, adjuntos: [],
    documentos: [{ nombre: 'Carta porte', estado: 'entregado' }, { nombre: 'Remisión firmada', estado: 'pendiente' }],
    podRecibido: false, facturaEmitida: false,
    ...extra,
  };
}

export function resumen(folio: string | null, id = VIAJE_1): ResumenViaje {
  return { viajeId: id, folio, origen: 'Guadalajara', destino: 'Monterrey' };
}
