// Datos 100 % SINTÉTICOS y genéricos para las pruebas de validaciones. Ningún valor es de una flota, cliente o persona real.
import { huellaFicha } from './cambios';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable } from './tipos';

export const AHORA = '2026-11-23T10:00'; // lunes

export function fichaBase(): FichaValidable {
  return {
    ref: 'REF-0001',
    cita: '2026-11-24T09:00',
    caja: { linea: 'LIN', numero: 'XX-2150', placas: 'AAA123', estado: 'ZZ', tipo: 'seca' },
    unidad: { eco: 'T-10', placa: 'BBB456', tag: 'TAG-1' },
    operador: {
      nombre: 'Operador Uno Apellido Dos', licencia: 'LIC-0001', vigenciaLicencia: '2027-06-30', celular: '5550001111',
      estado: 'disponible', gafete: 'GAF-1',
    },
    blindado: false,
    tipoTracto: 'regular',
    sello: '49085',
    ce: { url: 'https://ejemplo.test/ce/1', venceEn: '2026-11-25T12:00' },
    eta: { valor: '2026-11-24T08:30', punto: 'planta', zona: 'Centro', actualizadoEn: '2026-11-23T09:30' },
    planta: 'PLANTA-A',
    origenCcp: 'PLANTA-A',
    avc: { operador: 'Operador Uno Apellido Dos', gafete: 'GAF-1', tag: 'TAG-1' },
  };
}

export function contextoBase(): ContextoValidacion {
  const f = fichaBase();
  return {
    ahora: AHORA,
    catalogoCajas: [
      { numero: 'XX-2150', linea: 'LIN', placas: 'AAA123', estado: 'ZZ', ubicacion: 'PATIO-1' },
      { numero: 'XX-2151', linea: 'LIN', placas: 'AAA124', estado: 'ZZ', ubicacion: 'PATIO-1' },
    ],
    catalogoUnidades: [{ eco: 'T-10', placa: 'BBB456', tag: 'TAG-1' }, { eco: 'T-11', placa: 'BBB457' }],
    cajaAsignada: 'XX-2150',
    ubicacionEsperada: 'PATIO-1',
    equivalencias: [{ ref: 'REF-0001', caja: 'XX-2150' }, { ref: 'REF-0002', caja: 'XX-2151' }],
    ci: { tipoCaja: 'seca', tipoTracto: 'regular', planta: 'PLANTA-A' },
    prealerta: { enviadaEn: '2026-11-23T08:00', huella: huellaFicha(f), sello: '49085' },
    documentos: [{ tipo: 'ccp', ref: 'REF-0001', caja: 'XX-2150', placasCaja: 'AAA123', sello: '49085' }],
    vigencias: [{ tipo: 'poliza', hasta: '2027-08-01' }],
    evidenciaSalida: {
      fotos: ['sello', 'candado_electronico', 'gps_caja', 'bol_firmado', 'caja_numero_visible'].map((tipo) => ({ tipo, legible: true })),
    },
    correo: { de: 'sac@flota.test', para: ['cliente@cliente.test'], cc: ['cruces@flota.test'] },
    destinatario: { id: 'contacto-1', verificado: true },
    listaBlancaDatosOperador: ['contacto-1'],
  };
}

export const CONFIG_PRUEBA: Partial<ConfigValidaciones> = { buzonCompartido: 'cruces@flota.test' };

/** Copia profunda JSON de un objeto de prueba. */
export function clonar<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
