import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';

type Accion = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(), paso: vi.fn(), anotar: vi.fn(), revalidar: vi.fn(),
  generarBorrador: vi.fn(), marcarListo: vi.fn(), cerrarMes: vi.fn(), reabrirMes: vi.fn(), guardarTipoCambio: vi.fn(),
  leerVistaCierre: vi.fn(), cobradoDelMesAnterior: vi.fn(), armar: vi.fn(), guardarUpdate: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidar }));
vi.mock('@/lib/admin/acciones_riesgo', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/acciones_riesgo')>()),
  pasoExtraSuperadmin: dobles.paso,
  anotarAccionAdmin: dobles.anotar,
}));
vi.mock('@/lib/backoffice/cierre', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/cierre')>()),
  generarBorrador: dobles.generarBorrador, marcarListo: dobles.marcarListo, cerrarMes: dobles.cerrarMes, reabrirMes: dobles.reabrirMes,
  guardarTipoCambio: dobles.guardarTipoCambio, leerVistaCierre: dobles.leerVistaCierre, cobradoDelMesAnterior: dobles.cobradoDelMesAnterior,
}));
vi.mock('@/lib/backoffice/reporte', async (importar) => {
  const real = await importar<typeof import('@/lib/backoffice/reporte')>();
  dobles.armar.mockImplementation(real.armarUpdateInversionistas);
  return { ...real, armarUpdateInversionistas: dobles.armar, guardarBorradorUpdate: dobles.guardarUpdate };
});

import {
  accionCerrarMes, accionGenerarBorrador, accionGuardarTipoCambio, accionGuardarUpdate, accionMarcarListo, accionReabrirMes,
} from './acciones';
import { AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { ErrorCierre, type CierreMes, type Comprobacion } from '@/lib/backoffice/cierre';

const P = '2024-03-01';
const fd = (o: Record<string, string> = {}): FormData => { const f = new FormData(); f.set('periodo', P); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const correr = (a: Accion, datos: FormData = fd()) => a(null, datos);

const cierre: CierreMes = {
  periodo: P, cobradoTotalCent: 116000, ingresosCobradosCent: 100000, ingresosFacturadosCent: 100000, ivaTrasladadoCent: 16000, cogsIaCent: 0, gastosCent: 0,
  comisionesDevengadasCent: 0, clawbackCent: 0, netoCent: 100000, tipoCambio: 17, nCobradas: 1, pagadasSinEvidencia: { n: 0, totalCent: 0 },
  margenes: [{ tenantId: 't1', nombre: 'Flota Uno', ingresosCent: 100000, costoIaCent: 0, margenCent: 100000 }], faltantes: [],
};
const comprobacion = (o: Partial<Comprobacion> = {}): Comprobacion => ({ clave: 'cobrado_dos_vias', bloqueante: true, estado: 'falla', aCent: 1, bCent: 2, diffCent: -1, n: 1, ...o });

beforeEach(() => {
  for (const [k, d] of Object.entries(dobles)) if (k !== 'armar') d.mockReset();
  dobles.armar.mockClear();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u1', email: 'javier@example.com', rol: 'superadmin' });
  dobles.paso.mockResolvedValue(null);
  dobles.anotar.mockResolvedValue(true);
  dobles.generarBorrador.mockResolvedValue({ cierre, comprobaciones: [] });
  dobles.marcarListo.mockResolvedValue({ cierre, comprobaciones: [] });
  dobles.cerrarMes.mockResolvedValue({ cierre, comprobaciones: [] });
  dobles.reabrirMes.mockResolvedValue(undefined);
  dobles.guardarTipoCambio.mockResolvedValue(undefined);
  dobles.leerVistaCierre.mockResolvedValue({ periodo: P, guardado: { estado: 'ok', dato: null }, origen: 'en_vivo', cierre, comprobaciones: [] });
  dobles.cobradoDelMesAnterior.mockResolvedValue(null);
  dobles.guardarUpdate.mockResolvedValue(undefined);
});

describe('puerta y huella común a todas las acciones del cierre', () => {
  const todas: Array<[string, Accion]> = [
    ['generar borrador', accionGenerarBorrador], ['marcar listo', accionMarcarListo], ['cerrar', accionCerrarMes],
    ['reabrir', accionReabrirMes], ['tipo de cambio', accionGuardarTipoCambio], ['update', accionGuardarUpdate],
  ];

  it.each(todas)('%s: sin superadmin no hace ni anota nada', async (_n, accion) => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(correr(accion, fd({ motivo: 'un motivo largo', tipoCambio: '17' }))).rejects.toThrow('NEXT_REDIRECT');
    for (const k of ['generarBorrador', 'marcarListo', 'cerrarMes', 'reabrirMes', 'guardarTipoCambio', 'guardarUpdate', 'anotar'] as const) expect(dobles[k], k).not.toHaveBeenCalled();
  });

  it.each(todas)('%s: si la bitácora no pudo escribir, lo dice (el acto ya ocurrió)', async (_n, accion) => {
    dobles.anotar.mockResolvedValue(false);
    const r = await correr(accion, fd({ motivo: 'un motivo largo', tipoCambio: '17' }));
    expect(r?.ok).toContain(AVISO_SIN_BITACORA);
  });
});

describe('accionGenerarBorrador', () => {
  it('genera, revalida y deja su huella con el mes como entidad', async () => {
    const r = await correr(accionGenerarBorrador);
    expect(r?.ok).toContain('Borrador generado y guardado');
    expect(dobles.generarBorrador).toHaveBeenCalledWith(P);
    expect(dobles.revalidar).toHaveBeenCalledWith('/admin/back-office/cierre');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_cierre.borrador', entidad: 'bo_cierre', entidadId: P, tenantId: null }));
  });

  it('un mes cerrado se rechaza con su texto y no deja huella', async () => {
    dobles.generarBorrador.mockRejectedValue(new ErrorCierre('ya_cerrado'));
    const r = await correr(accionGenerarBorrador);
    expect(r?.error).toContain('Ese mes ya está cerrado');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('un error desconocido no filtra el mensaje de la base', async () => {
    dobles.generarBorrador.mockRejectedValue(new Error('relation "bo_cierre_mes" boom'));
    const r = await correr(accionGenerarBorrador);
    expect(typeof r?.error).toBe('string');
    expect(r?.error).not.toContain('boom');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });
});

describe('accionMarcarListo', () => {
  it('marca listo y anota; con bloqueantes pendientes dice cuáles', async () => {
    expect((await correr(accionMarcarListo))?.ok).toContain('quedó listo para cerrar');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_cierre.listo', entidadId: P }));
    dobles.anotar.mockClear();
    dobles.marcarListo.mockRejectedValue(new ErrorCierre('bloqueantes', [comprobacion(), comprobacion({ clave: 'usd_con_tipo_cambio' })]));
    const r = await correr(accionMarcarListo);
    expect(r?.error).toContain('Cobrado, dos vías');
    expect(r?.error).toContain('Dólares con tipo de cambio');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('un mes que no ha terminado se rechaza', async () => {
    dobles.marcarListo.mockRejectedValue(new ErrorCierre('mes_en_curso'));
    expect((await correr(accionMarcarListo))?.error).toContain('aún no termina');
  });
});

describe('accionCerrarMes', () => {
  it('sin el segundo factor no se cierra ni se anota nada', async () => {
    dobles.paso.mockResolvedValue('Necesitas tu segundo factor.');
    const r = await correr(accionCerrarMes);
    expect(r).toEqual({ error: 'Necesitas tu segundo factor.' });
    expect(dobles.cerrarMes).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('cierra firmando con el usuario y anota neto y cobrado', async () => {
    const r = await correr(accionCerrarMes);
    expect(r?.ok).toContain('Mes cerrado');
    expect(dobles.paso).toHaveBeenCalledWith('dinero_saas', expect.objectContaining({ userId: 'u1' }));
    expect(dobles.cerrarMes).toHaveBeenCalledWith(P, 'u1');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_cierre.cerrado', detalle: expect.objectContaining({ neto_cent: 100000, cobrado_cent: 116000 }) }));
  });

  it('si otro ya movió el mes, conflicto con su texto', async () => {
    dobles.cerrarMes.mockRejectedValue(new ErrorCierre('conflicto'));
    expect((await correr(accionCerrarMes))?.error).toContain('Alguien más cambió el mes');
  });
});

describe('accionReabrirMes', () => {
  it('sin el segundo factor no reabre', async () => {
    dobles.paso.mockResolvedValue('Necesitas tu segundo factor.');
    expect(await correr(accionReabrirMes, fd({ motivo: 'corregir un gasto' }))).toEqual({ error: 'Necesitas tu segundo factor.' });
    expect(dobles.reabrirMes).not.toHaveBeenCalled();
  });

  it('reabre con el motivo recortado y lo deja en la bitácora', async () => {
    const r = await correr(accionReabrirMes, fd({ motivo: '  corregir un gasto  ' }));
    expect(r?.ok).toContain('Mes reabierto');
    expect(dobles.reabrirMes).toHaveBeenCalledWith(P, 'corregir un gasto', 'u1');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_cierre.reabierto', detalle: { motivo: 'corregir un gasto' } }));
  });

  it('un motivo corto se rechaza con su texto', async () => {
    dobles.reabrirMes.mockRejectedValue(new ErrorCierre('motivo_corto'));
    expect((await correr(accionReabrirMes, fd({ motivo: 'ab' })))?.error).toContain('El motivo es obligatorio');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });
});

describe('accionGuardarTipoCambio', () => {
  it('acepta coma decimal y lo pasa como número', async () => {
    const r = await correr(accionGuardarTipoCambio, fd({ tipoCambio: ' 17,5 ' }));
    expect(r?.ok).toContain('Tipo de cambio guardado');
    expect(dobles.guardarTipoCambio).toHaveBeenCalledWith(P, 17.5);
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_cierre.tipo_cambio', detalle: { tipo_cambio: 17.5 } }));
  });

  it('un valor inválido se rechaza con su texto', async () => {
    dobles.guardarTipoCambio.mockRejectedValue(new ErrorCierre('tipo_cambio_invalido'));
    expect((await correr(accionGuardarTipoCambio, fd({ tipoCambio: 'abc' })))?.error).toContain('El tipo de cambio debe ser');
  });
});

describe('accionGuardarUpdate', () => {
  it('recalcula con el cierre del servidor, pasa la guardia y guarda el markdown; nunca envía', async () => {
    const r = await correr(accionGuardarUpdate);
    expect(r?.ok).toContain('Borrador guardado');
    expect(dobles.leerVistaCierre).toHaveBeenCalledWith(P);
    expect(dobles.guardarUpdate).toHaveBeenCalledTimes(1);
    const [periodo, md] = dobles.guardarUpdate.mock.calls[0];
    expect(periodo).toBe(P);
    expect(md).toContain('TL;DR');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'bo_cierre.update_guardado', entidadId: P }));
  });

  it('si el texto trae una cifra que no está en el cierre, no se guarda y se dice cuál', async () => {
    dobles.armar.mockReturnValueOnce({ ok: false, motivo: 'cifras_fuera_del_cierre', fuera: ['999'] });
    const r = await correr(accionGuardarUpdate);
    expect(r?.error).toContain('999');
    expect(dobles.guardarUpdate).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('un periodo inválido se rechaza antes de leer nada', async () => {
    const r = await correr(accionGuardarUpdate, fd({ periodo: '2024-03-15' }));
    expect(r?.error).toContain('El mes no es válido');
    expect(dobles.leerVistaCierre).not.toHaveBeenCalled();
  });

  it('sin cierre guardado (llave foránea) dice que falta el borrador', async () => {
    dobles.guardarUpdate.mockRejectedValue(new ErrorCierre('sin_borrador'));
    expect((await correr(accionGuardarUpdate))?.error).toContain('aún no tiene borrador');
  });
});
