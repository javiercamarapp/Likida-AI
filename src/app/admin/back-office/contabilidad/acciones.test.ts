import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUENTAS_PROPUESTAS } from '@/lib/backoffice/cuentas';
import { OK } from '@/lib/backoffice/lectura';

// Las cuatro acciones: puerta de superadmin, paso extra donde mueve el libro, validación (también la partida doble), idempotencia por la clave
// del formulario, huella en la bitácora y el aviso si la bitácora no pudo escribir. El SAT no entra en ninguna: «presentada» la marca una persona.
const dobles = vi.hoisted(() => {
  class ErrorLibro extends Error {
    constructor(public readonly codigo: string, public readonly detalle: string) { super(detalle); }
  }
  return {
    ErrorLibro,
    requireSuperadmin: vi.fn(), paso: vi.fn(), anotar: vi.fn(), revalidar: vi.fn(),
    leerEntidad: vi.fn(), leerObligaciones: vi.fn(), leerCuentas: vi.fn(), leerPaqueteDelMes: vi.fn(),
    marcarPresentada: vi.fn(), marcarPaqueteListo: vi.fn(), registrarAsiento: vi.fn(), reversarAsiento: vi.fn(),
  };
});

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidar }));
vi.mock('@/lib/admin/acciones_riesgo', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/acciones_riesgo')>()),
  pasoExtraSuperadmin: dobles.paso,
  anotarAccionAdmin: dobles.anotar,
}));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-16' }));
vi.mock('@/lib/backoffice/contabilidad', () => ({
  ErrorLibro: dobles.ErrorLibro,
  leerEntidad: dobles.leerEntidad, leerObligaciones: dobles.leerObligaciones, leerCuentas: dobles.leerCuentas, leerPaqueteDelMes: dobles.leerPaqueteDelMes,
  marcarPresentada: dobles.marcarPresentada, marcarPaqueteListo: dobles.marcarPaqueteListo, registrarAsiento: dobles.registrarAsiento, reversarAsiento: dobles.reversarAsiento,
}));

import { AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { accionGenerarPaquete, accionMarcarPresentada, accionRegistrarAsientoManual, accionReversarAsiento } from './acciones';

const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const CUENTAS = CUENTAS_PROPUESTAS.map((c) => ({ ...c }));
const CON_RFC = OK({ rfc: 'ABC010101AB1', razonSocial: 'Likida SAPI', constituidaEl: '2026-10-01' });
const SIN_RFC = OK({ rfc: null, razonSocial: null, constituidaEl: null });
const IVA = { clave: 'iva_mensual', nombre: 'IVA: declaración mensual', periodicidad: 'mensual', diaLimite: 17, mesLimite: null, mesesDesfase: 1, requiereEntidad: true, estadoCatalogo: 'pendiente_de_contador' };
const EVENTO = { ...IVA, clave: 'conservacion_5_anios', periodicidad: 'evento', diaLimite: null };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin', nombre: 'Javier' });
  dobles.paso.mockResolvedValue(null);
  dobles.anotar.mockResolvedValue(true);
  dobles.leerEntidad.mockResolvedValue(CON_RFC);
  dobles.leerObligaciones.mockResolvedValue(OK([IVA, EVENTO]));
  dobles.leerCuentas.mockResolvedValue(OK(CUENTAS));
  dobles.marcarPresentada.mockResolvedValue('marcada');
  dobles.registrarAsiento.mockResolvedValue({ id: 'asiento-uuid' });
  dobles.reversarAsiento.mockResolvedValue({ id: 'reversa-uuid' });
  dobles.marcarPaqueteListo.mockResolvedValue(['contabilidad_electronica', 'diot', 'iva_mensual']);
});

describe('accionMarcarPresentada', () => {
  const forma = (extra: Record<string, string> = {}) => fd({ obligacion: 'iva_mensual|2026-10-01', acuseRef: 'ACUSE-0001', presentadaEn: '2026-11-16', ...extra });

  it('marca presentada con el acuse, asienta la bitácora y revalida la pantalla', async () => {
    const r = await accionMarcarPresentada(null, forma());
    expect(r?.ok).toContain('presentada');
    expect(dobles.marcarPresentada).toHaveBeenCalledWith({ clave: 'iva_mensual', periodo: '2026-10-01', presentadaPor: 'Javier', presentadaEn: '2026-11-16', acuseRef: 'ACUSE-0001', nota: null });
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_obligacion.presentada', entidad: 'bo_obligacion', entidadId: 'iva_mensual:2026-10-01' }));
    expect(dobles.revalidar).toHaveBeenCalledWith('/admin/back-office/contabilidad');
  });

  it('sin RFC propio no hay nada que presentar: no escribe nada', async () => {
    dobles.leerEntidad.mockResolvedValue(SIN_RFC);
    const r = await accionMarcarPresentada(null, forma());
    expect(r?.error).toContain('RFC');
    expect(dobles.marcarPresentada).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('sin acuse, con fecha futura, con obligación inválida o de evento: error y sin escritura', async () => {
    expect((await accionMarcarPresentada(null, forma({ acuseRef: '  ' })))?.error).toContain('acuse');
    expect((await accionMarcarPresentada(null, forma({ presentadaEn: '2026-12-31' })))?.error).toContain('fecha');
    expect((await accionMarcarPresentada(null, forma({ obligacion: 'iva_mensual|2026-10-15' })))?.error).toContain('obligación');
    expect((await accionMarcarPresentada(null, forma({ obligacion: 'conservacion_5_anios|2026-10-01' })))?.error).toContain('obligación');
    expect(dobles.marcarPresentada).not.toHaveBeenCalled();
  });

  it('el catálogo sin aplicar se dice «No disponible», no se supone', async () => {
    dobles.leerObligaciones.mockResolvedValue({ estado: 'no_disponible' });
    expect((await accionMarcarPresentada(null, forma()))?.error).toContain('No disponible');
  });

  it('repetir con el mismo acuse es idempotente y lo dice; otro acuse sobre una presentada se rechaza', async () => {
    dobles.marcarPresentada.mockResolvedValue('ya_estaba');
    expect((await accionMarcarPresentada(null, forma()))?.ok).toContain('ya estaba');
    dobles.marcarPresentada.mockRejectedValue(new dobles.ErrorLibro('42501', 'x'));
    expect((await accionMarcarPresentada(null, forma({ acuseRef: 'OTRO-ACUSE' })))?.error).toContain('otro acuse');
  });

  it('si la bitácora no pudo escribir, lo dice sin deshacer el acto', async () => {
    dobles.anotar.mockResolvedValue(false);
    const r = await accionMarcarPresentada(null, forma());
    expect(r?.ok).toContain(AVISO_SIN_BITACORA.trim().slice(0, 20));
  });
});

describe('accionRegistrarAsientoManual', () => {
  const forma = (extra: Record<string, string> = {}) => fd({
    claveIdem: 'asiento-abcdefgh', fecha: '2026-11-10', descripcion: 'Aportación inicial', motivo: 'Capital de arranque', soporte: 'ninguno',
    cuenta_1: '1110', debe_1: '1000.50', cuenta_2: '3110', haber_2: '1000.50', ...extra,
  });

  it('asienta la póliza en centavos, con la clave del formulario y el motivo en la descripción', async () => {
    const r = await accionRegistrarAsientoManual(null, forma());
    expect(r?.ok).toContain('2 renglones');
    expect(dobles.paso).toHaveBeenCalledWith('dinero_saas', expect.objectContaining({ userId: 'u-1' }));
    expect(dobles.registrarAsiento).toHaveBeenCalledWith({
      claveIdem: 'asiento-abcdefgh', fecha: '2026-11-10', descripcion: 'Aportación inicial · Capital de arranque', actor: 'u-1', soporte: 'ninguno', soporteRef: null,
      lineas: [{ cuenta: '1110', debeCent: 100050, haberCent: 0 }, { cuenta: '3110', debeCent: 0, haberCent: 100050 }],
    });
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_asiento.registrado', entidad: 'bo_asiento', entidadId: 'asiento-uuid' }));
    expect(dobles.revalidar).toHaveBeenCalledWith('/admin/back-office/contabilidad');
  });

  it('descuadrado: lo rechaza ANTES de tocar la base y dice cuánto', async () => {
    const r = await accionRegistrarAsientoManual(null, forma({ haber_2: '900' }));
    expect(r?.error).toContain('no cuadra');
    expect(r?.error).toContain('$1,000.50');
    expect(dobles.registrarAsiento).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('cuenta inexistente o inactiva, importe ilegible y un solo renglón se rechazan', async () => {
    expect((await accionRegistrarAsientoManual(null, forma({ cuenta_2: '9999' })))?.error).toContain('no existe en el plan');
    expect((await accionRegistrarAsientoManual(null, forma({ cuenta_2: '7100' })))?.error).toContain('inactiva');
    expect((await accionRegistrarAsientoManual(null, forma({ debe_1: '50,000' })))?.error).toContain('renglón 1');
    expect((await accionRegistrarAsientoManual(null, forma({ cuenta_2: '', haber_2: '' })))?.error).toContain('al menos dos');
    expect(dobles.registrarAsiento).not.toHaveBeenCalled();
  });

  it('motivo, clave, fecha y soporte son obligatorios y válidos', async () => {
    expect((await accionRegistrarAsientoManual(null, forma({ motivo: 'x' })))?.error).toContain('motivo');
    expect((await accionRegistrarAsientoManual(null, forma({ claveIdem: 'corta' })))?.error).toContain('clave');
    expect((await accionRegistrarAsientoManual(null, forma({ fecha: '2027-01-01' })))?.error).toContain('fecha');
    expect((await accionRegistrarAsientoManual(null, forma({ soporte: 'cfdi' })))?.error).toContain('UUID');
    expect((await accionRegistrarAsientoManual(null, forma({ soporte: 'inventado' })))?.error).toContain('soporte');
    expect(dobles.registrarAsiento).not.toHaveBeenCalled();
  });

  it('con CFDI guarda su referencia', async () => {
    await accionRegistrarAsientoManual(null, forma({ soporte: 'cfdi', soporteRef: 'UUID-123' }));
    expect(dobles.registrarAsiento).toHaveBeenCalledWith(expect.objectContaining({ soporte: 'cfdi', soporteRef: 'UUID-123' }));
  });

  it('sin segundo factor no hace nada ni asienta nada', async () => {
    dobles.paso.mockResolvedValue('Falta el segundo factor.');
    const r = await accionRegistrarAsientoManual(null, forma());
    expect(r).toEqual({ error: 'Falta el segundo factor.' });
    expect(dobles.registrarAsiento).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('la base rechaza por periodo cerrado o por tabla ausente: se dice en lenguaje de persona', async () => {
    dobles.registrarAsiento.mockRejectedValue(new dobles.ErrorLibro('P0431', 'x'));
    expect((await accionRegistrarAsientoManual(null, forma()))?.error).toContain('aprobado o publicado');
    dobles.registrarAsiento.mockRejectedValue(new dobles.ErrorLibro('ausente', 'x'));
    expect((await accionRegistrarAsientoManual(null, forma()))?.error).toContain('No disponible');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('si la bitácora no pudo escribir, el asiento queda y se avisa', async () => {
    dobles.anotar.mockResolvedValue(false);
    expect((await accionRegistrarAsientoManual(null, forma()))?.ok).toContain('OJO');
  });
});

describe('accionReversarAsiento', () => {
  const ID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
  const forma = (extra: Record<string, string> = {}) => fd({ asientoId: ID, motivo: 'Captura duplicada', claveIdem: 'reversa-abcdefgh', ...extra });

  it('reversa con motivo, la clave del formulario y la fecha de hoy; deja huella', async () => {
    const r = await accionReversarAsiento(null, forma());
    expect(r?.ok).toContain('reversado');
    expect(dobles.reversarAsiento).toHaveBeenCalledWith({ asientoId: ID, motivo: 'Captura duplicada', actor: 'u-1', claveIdem: 'reversa-abcdefgh', fecha: '2026-11-16' });
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_asiento.reversado', entidad: 'bo_asiento', entidadId: 'reversa-uuid' }));
  });

  it('sin motivo, con id inválido o sin segundo factor: error y sin escritura', async () => {
    expect((await accionReversarAsiento(null, forma({ motivo: '' })))?.error).toContain('motivo');
    expect((await accionReversarAsiento(null, forma({ asientoId: 'no-es-uuid' })))?.error).toContain('asiento');
    dobles.paso.mockResolvedValue('Falta el segundo factor.');
    expect(await accionReversarAsiento(null, forma())).toEqual({ error: 'Falta el segundo factor.' });
    expect(dobles.reversarAsiento).not.toHaveBeenCalled();
  });
});

describe('accionGenerarPaquete', () => {
  const forma = () => fd({ periodo: '2026-10-01' });
  const listo = { candado: { bloqueado: false, rfc: 'ABC010101AB1' }, paquete: { bloqueado: false, listo: true, motivosNoListo: [], advertencias: ['movimientos_sin_cfdi'], movimientos: [1, 2], movimientosSinCfdi: 2 } };

  it('con el paquete listo marca las obligaciones, deja huella y NO presenta nada', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue(listo);
    const r = await accionGenerarPaquete(null, forma());
    expect(r?.ok).toContain('3 obligaciones');
    expect(r?.ok).toContain('No se presentó nada');
    expect(dobles.marcarPaqueteListo).toHaveBeenCalledWith('2026-10-01');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_obligacion.paquete_listo', entidad: 'bo_obligacion', entidadId: '2026-10-01' }));
  });

  it('sin RFC el paquete queda bloqueado y no se marca nada', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue({ candado: { bloqueado: true, motivo: 'sin_rfc' }, paquete: { bloqueado: 'sin_rfc' } });
    expect((await accionGenerarPaquete(null, forma()))?.error).toContain('RFC');
    expect(dobles.marcarPaqueteListo).not.toHaveBeenCalled();
  });

  it('una comprobación bloqueante en rojo o un mes vacío: «el paquete no está listo» con el motivo', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue({ ...listo, paquete: { ...listo.paquete, listo: false, motivosNoListo: ['comprobacion_bloqueante', 'sin_movimientos'] } });
    const r = await accionGenerarPaquete(null, forma());
    expect(r?.error).toContain('no está listo');
    expect(r?.error).toContain('bloqueante');
    expect(r?.error).toContain('no tiene movimientos');
    expect(dobles.marcarPaqueteListo).not.toHaveBeenCalled();
  });

  it('libro ilegible o periodo inválido: error honesto', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue({ candado: { bloqueado: false, rfc: 'X' }, paquete: null });
    expect((await accionGenerarPaquete(null, forma()))?.error).toContain('No disponible');
    expect((await accionGenerarPaquete(null, fd({ periodo: '2026-10-15' })))?.error).toContain('periodo');
  });
});
