import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { liberarEnvio, type DependenciasLiberar } from './liberar_envio';
import { CONFIG_CORREO_POR_DEFECTO, type Desglose, type EntregaCorreo, type Excepcion, type NuevaEntrega } from './repo_correo';
import type { LiquidacionExterna } from './repo';

// Datos 100 % sintéticos.
const TENANT = '11111111-1111-4111-8111-111111111111';
const LIQ = '22222222-2222-4222-8222-222222222222';
const OPERADOR = '33333333-3333-4333-8333-333333333333';
const HUELLA = 'a'.repeat(64);
const ADMIN = { userId: 'user-1', rol: 'flota_admin' };

const desglose = (retenidaMotivo: string | null): Desglose => ({
  liquidacionExternaId: LIQ, bitacora: 'B-0001', terminal: 'T1', poliza: 'P-1', unidad: '526', tipoOperador: 'foraneo', dias: 3,
  totalOrigen: 'tms', enviadoOrigenEn: null, retenidaMotivo, creadoEn: '2026-10-14T08:00:00.000Z',
});
const excepcion = (id: number, tipo: Excepcion['tipo']): Excepcion => ({
  id, claveExterna: 'T1-B-0001', tipo, detalle: {}, primeraVez: '2026-10-14T08:00:00.000Z', ultimaVez: '2026-10-14T08:00:00.000Z', resueltaEn: null,
});

function montar(sobre: {
  retenida?: string | null; entregas?: EntregaCorreo[]; excepciones?: Excepcion[]; sinLiquidacion?: boolean; lecturaCaida?: boolean;
  contacto?: { correo: string | null } | null; liberarDevuelve?: boolean;
} = {}) {
  const log = { insertadas: [] as NuevaEntrega[], resueltas: [] as number[], eventos: [] as Array<Record<string, unknown> | undefined>, orden: [] as string[], liberada: 0 };
  const retenida = sobre.retenida === undefined ? 'neto negativo' : sobre.retenida;
  const contacto = sobre.contacto === undefined ? { correo: 'ana.prueba@ejemplo.test' } : sobre.contacto;
  const deps: DependenciasLiberar = {
    leerLiquidacion: async () => (sobre.sinLiquidacion ? null : ({ id: LIQ, tenantId: TENANT, operadorId: OPERADOR, claveExterna: 'T1-B-0001', huella: HUELLA } as unknown as LiquidacionExterna)),
    leerDesglose: async () => (sobre.lecturaCaida ? null : { desglose: desglose(retenida) }),
    leerConfig: async () => ({ ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, rhCorreos: ['rh.prueba@ejemplo.test'] }),
    leerContacto: async () => (contacto ? { operadorId: OPERADOR, correo: contacto.correo, correoRebotadoEn: null, coordinadorId: 'c-1' } : null),
    leerCoordinador: async () => ({ id: 'c-1', nombre: 'Coord Prueba', correo: 'coord.prueba@ejemplo.test', activo: true }),
    entregas: async () => sobre.entregas ?? [],
    excepcionesAbiertas: async () => sobre.excepciones ?? [excepcion(7, 'neto_negativo')],
    insertarEntregas: async (_t, filas) => { log.orden.push('insertar'); log.insertadas.push(...filas); return filas.length; },
    liberarRetencion: async () => { log.orden.push('liberar'); log.liberada++; return sobre.liberarDevuelve ?? true; },
    resolverExcepcion: async (_t, id) => { log.orden.push('resolver'); log.resueltas.push(id); return true; },
    registrarEvento: async (_t, _l, _tipo, detalle) => { log.eventos.push(detalle); },
    ahora: () => new Date('2026-10-14T18:30:00.000Z'),
  };
  return { log, deps };
}

describe('liberarEnvio', () => {
  it('libera un neto negativo ⇒ crea las entregas, quita la retención, resuelve la excepción y registra al actor', async () => {
    const { log, deps } = montar();
    const r = await liberarEnvio(TENANT, LIQ, ADMIN, deps);
    expect(r).toMatchObject({ estado: 'liberado', entregas: 3 });
    expect(log.insertadas.map((e) => e.rol).sort()).toEqual(['coordinador', 'operador', 'rh']);
    expect(log.insertadas.every((e) => e.disparo === 'manual' && e.pedidoPor === 'user-1' && e.generacion === 1)).toBe(true);
    expect(log.insertadas[0]!.xlsxRuta).toMatch(new RegExp(`^${TENANT}/.*\\.xlsx$`));
    expect(log.orden).toEqual(['insertar', 'liberar', 'resolver']);
    expect(log.resueltas).toEqual([7]);
    expect(log.eventos[0]).toMatchObject({ accion: 'liberar_envio', actor: 'user-1', canal: 'correo' });
  });

  it('un tipo sin regla también se libera', async () => {
    const { log, deps } = montar({ excepciones: [excepcion(9, 'tipo_sin_regla')] });
    expect((await liberarEnvio(TENANT, LIQ, ADMIN, deps)).estado).toBe('liberado');
    expect(log.resueltas).toEqual([9]);
  });

  it('segunda pulsación (ya no está retenido) ⇒ rechazo llano y NO crea nada', async () => {
    const { log, deps } = montar({ retenida: null });
    const r = await liberarEnvio(TENANT, LIQ, ADMIN, deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'no_retenida' });
    expect(log.insertadas).toEqual([]);
    expect(log.eventos).toEqual([]);
  });

  it('carrera: otro clic quitó la retención entre la lectura y la escritura ⇒ no registra una liberación que no hizo', async () => {
    const { log, deps } = montar({ liberarDevuelve: false });
    const r = await liberarEnvio(TENANT, LIQ, ADMIN, deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'no_retenida' });
    expect(log.eventos).toEqual([]);
    expect(log.resueltas).toEqual([]);
  });

  it('una liberación anterior cayó a medias (hay entregas, sigue retenido) ⇒ se completa SIN insertar de nuevo', async () => {
    const previa = { id: 'e-1', liquidacionExternaId: LIQ, generacion: 1, rol: 'operador' } as unknown as EntregaCorreo;
    const { log, deps } = montar({ entregas: [previa] });
    const r = await liberarEnvio(TENANT, LIQ, ADMIN, deps);
    expect(r).toMatchObject({ estado: 'liberado', entregas: 0 });
    expect(log.insertadas).toEqual([]);
    expect(log.liberada).toBe(1);
  });

  it('concepto prohibido ⇒ no se libera desde aquí', async () => {
    const { log, deps } = montar({ excepciones: [excepcion(1, 'neto_negativo'), excepcion(2, 'concepto_prohibido')] });
    const r = await liberarEnvio(TENANT, LIQ, ADMIN, deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'no_liberable' });
    expect(log.insertadas).toEqual([]);
  });

  it('solo quien administra', async () => {
    const { log, deps } = montar();
    const r = await liberarEnvio(TENANT, LIQ, { userId: 'u', rol: 'contador' }, deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'sin_permiso' });
    expect(log.insertadas).toEqual([]);
  });

  it('lectura caída ⇒ no_disponible (jamás se interpreta como «no está retenido»)', async () => {
    const { log, deps } = montar({ lecturaCaida: true });
    expect(await liberarEnvio(TENANT, LIQ, ADMIN, deps)).toMatchObject({ estado: 'rechazado', motivo: 'no_disponible' });
    expect(log.insertadas).toEqual([]);
  });

  it('desglose de otra flota o inexistente ⇒ no_encontrada', async () => {
    const { deps } = montar({ sinLiquidacion: true });
    expect(await liberarEnvio(TENANT, LIQ, ADMIN, deps)).toMatchObject({ estado: 'rechazado', motivo: 'no_encontrada' });
  });

  it('sin ningún correo a quién mandar ⇒ rechazo y la retención sigue', async () => {
    const { log, deps } = montar({ contacto: null });
    deps.leerConfig = async () => ({ ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, enviaCoordinador: false, enviaRh: false });
    expect(await liberarEnvio(TENANT, LIQ, ADMIN, deps)).toMatchObject({ estado: 'rechazado', motivo: 'sin_destinatarios' });
    expect(log.liberada).toBe(0);
  });
});
