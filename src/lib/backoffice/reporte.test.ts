import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: dobles.from, rpc: vi.fn() }) }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: vi.fn() }));
vi.mock('./gastos', () => ({ getGastosDelMes: vi.fn() }));
vi.mock('./comisiones', () => ({ leerComisionesDelMes: vi.fn() }));
vi.mock('./contabilidad', () => ({ leerMovimientosDelMes: vi.fn() }));

import { trAdminBackofficeEs as tr } from '@/lib/i18n/tr_admin';
import {
  armarUpdateInversionistas, cifrasDelCierre, clientesConCobro, diasDeCierre, guardarBorradorUpdate, leerUpdateInversionistas, numerosFueraDelCierre,
  SECCIONES_UPDATE,
} from './reporte';
import { ErrorCierre, type CierreMes } from './cierre';

const cierre = (o: Partial<CierreMes> = {}): CierreMes => ({
  periodo: '2026-10-01',
  cobradoTotalCent: 116000, ingresosCobradosCent: 100000, ingresosFacturadosCent: 100000, ivaTrasladadoCent: 16000,
  cogsIaCent: 1000, gastosCent: 20000, comisionesDevengadasCent: 5000, clawbackCent: 0, netoCent: 74000,
  tipoCambio: 17.25, nCobradas: 1, pagadasSinEvidencia: { n: 0, totalCent: 0 },
  margenes: [{ tenantId: 't1', nombre: 'Flota Uno', ingresosCent: 100000, costoIaCent: 1000, margenCent: 99000 }],
  faltantes: [], ...o,
});

describe('armarUpdateInversionistas', () => {
  it('lleva las siete secciones en el orden fijo TL;DR · MÉTRICAS · CONSTRUIDO · APRENDIDO · VIENE · ASKS · GRACIAS', () => {
    const r = armarUpdateInversionistas(cierre(), tr);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const encabezados = r.markdown.split('\n').filter((l) => l.startsWith('## '));
    expect(encabezados).toEqual(SECCIONES_UPDATE.map((s) => `## ${tr(`reporte.h_${s}` as Parameters<typeof tr>[0])}`));
    expect(encabezados.map((h) => h.slice(3))).toEqual(['TL;DR', 'MÉTRICAS', 'CONSTRUIDO', 'APRENDIDO', 'VIENE', 'ASKS', 'GRACIAS']);
    expect(r.secciones).toEqual([...SECCIONES_UPDATE]);
  });

  it('las cifras del texto son las del cierre, formateadas con el formato del producto', () => {
    const r = armarUpdateInversionistas(cierre(), tr);
    if (!r.ok) throw new Error('debía ofrecerse');
    expect(r.markdown).toContain('$1,160.00');
    expect(r.markdown).toContain('$1,000.00');
    expect(r.markdown).toContain('$740.00');
    expect(r.markdown).toContain('17.25');
  });

  it('lo que el sistema no sabe queda como «por completar», no inventado', () => {
    const r = armarUpdateInversionistas(cierre(), tr);
    if (!r.ok) throw new Error('debía ofrecerse');
    expect(r.markdown.split(tr('reporte.por_completar')).length - 1).toBe(4);
  });

  it('un neto sin dato se dice «no disponible» con lo que falta, y no se pinta como cero', () => {
    const r = armarUpdateInversionistas(cierre({ netoCent: null, gastosCent: null, faltantes: ['gastos', 'tipo_cambio'] }), tr);
    if (!r.ok) throw new Error('debía ofrecerse');
    expect(r.markdown).toContain(tr('reporte.tldr_neto_nd', { faltantes: `${tr('reporte.falta_gastos')}, ${tr('reporte.falta_tipo_cambio')}` }));
    expect(r.markdown).toContain(`${tr('reporte.r_gastos')}: ${tr('reporte.no_disponible')}`);
    expect(r.markdown).toContain(`${tr('reporte.r_neto')}: ${tr('reporte.no_disponible')}`);
    expect(r.markdown).not.toContain('$0.00');
  });

  it('«0 clientes» no se pinta como crecimiento: ni variación ni frase de avance', () => {
    const sinClientes = cierre({ cobradoTotalCent: 0, ingresosCobradosCent: 0, ivaTrasladadoCent: 0, nCobradas: 0, margenes: [], netoCent: -21000 });
    const r = armarUpdateInversionistas(sinClientes, tr, { cobradoMesAnteriorCent: 50000 });
    if (!r.ok) throw new Error('debía ofrecerse');
    expect(r.markdown).toContain(tr('reporte.tldr_sin_clientes'));
    expect(r.markdown).toContain(tr('reporte.tldr_sin_cobro', { mes: 'octubre de 2026' }));
    expect(r.markdown).not.toContain(tr('reporte.r_variacion'));
  });

  it('la variación solo aparece con una base mayor que cero y al menos un cliente con cobro', () => {
    const con = armarUpdateInversionistas(cierre(), tr, { cobradoMesAnteriorCent: 100000 });
    if (!con.ok) throw new Error('debía ofrecerse');
    expect(con.markdown).toContain(`${tr('reporte.r_variacion')}: 16.0%`);
    for (const base of [0, null, undefined]) {
      const sin = armarUpdateInversionistas(cierre(), tr, { cobradoMesAnteriorCent: base });
      if (!sin.ok) throw new Error('debía ofrecerse');
      expect(sin.markdown).not.toContain(tr('reporte.r_variacion'));
    }
  });

  it('guardia de números: un texto con una cifra que NO está en el cierre hace que el borrador no se ofrezca', () => {
    const r = armarUpdateInversionistas(cierre(), tr, { textos: { construido: 'Lanzamos 999 integraciones nuevas' } });
    expect(r).toEqual({ ok: false, motivo: 'cifras_fuera_del_cierre', fuera: ['999'] });
  });

  it('guardia de números: un texto que cita cifras del propio cierre sí pasa', () => {
    const r = armarUpdateInversionistas(cierre(), tr, { textos: { aprendido: 'Cobramos 1160 y gastamos 200' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markdown).toContain('Cobramos 1160 y gastamos 200');
  });

  it('en inglés usa el formato en inglés y la misma estructura', () => {
    const r = armarUpdateInversionistas(cierre(), tr, { idioma: 'en' });
    if (!r.ok) throw new Error('debía ofrecerse');
    expect(r.markdown).toContain('$1,160.00 MXN');
    expect(r.markdown).toContain('October 2026');
  });
});

describe('numerosFueraDelCierre y cifrasDelCierre', () => {
  it('cifrasDelCierre incluye montos en pesos, conteos, el tipo de cambio y el año y mes del periodo', () => {
    const s = cifrasDelCierre(cierre());
    for (const v of [1160, 1000, 160, 10, 200, 50, 740, 17.25, 2026, 10, 1, 0]) expect(s.has(Math.round(v * 100) / 100), String(v)).toBe(true);
    expect(s.has(999)).toBe(false);
  });

  it('un número con signo o con separadores se compara por su valor absoluto', () => {
    const s = cifrasDelCierre(cierre());
    expect(numerosFueraDelCierre('Neto -$740.00 y $1,160.00', s)).toEqual([]);
    expect(numerosFueraDelCierre('Neto $741.00', s)).toEqual(['$741.00']);
  });
});

describe('clientesConCobro', () => {
  it('cuenta clientes con ingreso o con ingreso sin desglose; no cuenta los que solo tienen costo de IA', () => {
    const m = (tenantId: string, ingresosCent: number | null) => ({ tenantId, nombre: null, ingresosCent, costoIaCent: 0, margenCent: null });
    expect(clientesConCobro(cierre({ margenes: [m('a', 100), m('b', null), m('c', 0)] }))).toBe(2);
    expect(clientesConCobro(cierre({ margenes: [] }))).toBe(0);
    expect(clientesConCobro(cierre({ margenes: null }))).toBeNull();
  });
});

describe('diasDeCierre', () => {
  it('cuenta los días hábiles entre el último día del mes y el día de México en que se cerró', () => {
    // Octubre termina el sábado 31. Cerrado el miércoles 4 de noviembre al mediodía de México: lunes 2, martes 3 y miércoles 4 = 3.
    expect(diasDeCierre('2026-10-01', '2026-11-04T18:00:00Z')).toBe(3);
    // El mismo lunes 2 de noviembre = 1 día hábil.
    expect(diasDeCierre('2026-10-01', '2026-11-02T16:00:00Z')).toBe(1);
  });
  it('un cierre sin fecha o ilegible es null, no 0', () => {
    expect(diasDeCierre('2026-10-01', null)).toBeNull();
    expect(diasDeCierre('2026-10-01', 'ayer')).toBeNull();
  });
  it('cerrar antes de que termine el mes no da un número negativo', () => {
    expect(diasDeCierre('2026-10-01', '2026-10-20T16:00:00Z')).toBe(0);
  });
});

describe('persistencia del borrador', () => {
  beforeEach(() => dobles.from.mockReset());
  const cadena = (resultado: Record<string, unknown>) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) q[m] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => resultado);
    q.upsert = vi.fn(async () => resultado);
    return q;
  };

  it('leerUpdateInversionistas: tabla ausente es no_disponible; sin fila es ok con null; con fila se mapea', async () => {
    dobles.from.mockReturnValueOnce(cadena({ data: null, error: { code: '42P01', message: 'does not exist' } }));
    expect(await leerUpdateInversionistas('2026-10-01')).toEqual({ estado: 'no_disponible' });
    dobles.from.mockReturnValueOnce(cadena({ data: null, error: null }));
    expect(await leerUpdateInversionistas('2026-10-01')).toEqual({ estado: 'ok', dato: null });
    dobles.from.mockReturnValueOnce(cadena({ data: { periodo: '2026-10-01', borrador_md: '# x', aprobado_por: null, aprobado_en: null, actualizado_en: 't' }, error: null }));
    expect(await leerUpdateInversionistas('2026-10-01')).toEqual({ estado: 'ok', dato: { periodo: '2026-10-01', borradorMd: '# x', aprobadoPor: null, aprobadoEn: null, actualizadoEn: 't' } });
  });

  it('guardarBorradorUpdate: hace upsert por periodo; sin cierre (FK) dice sin_borrador; tabla ausente dice no disponible', async () => {
    const ok = cadena({ error: null });
    dobles.from.mockReturnValueOnce(ok);
    await guardarBorradorUpdate('2026-10-01', '# x');
    expect((ok.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ periodo: '2026-10-01', borrador_md: '# x' });
    dobles.from.mockReturnValueOnce(cadena({ error: { code: '23503', message: 'foreign key' } }));
    await expect(guardarBorradorUpdate('2026-10-01', '# x')).rejects.toBeInstanceOf(ErrorCierre);
    dobles.from.mockReturnValueOnce(cadena({ error: { code: '23503', message: 'foreign key' } }));
    await expect(guardarBorradorUpdate('2026-10-01', '# x')).rejects.toMatchObject({ codigo: 'sin_borrador' });
    dobles.from.mockReturnValueOnce(cadena({ error: { code: '42P01', message: 'does not exist' } }));
    await expect(guardarBorradorUpdate('2026-10-01', '# x')).rejects.toMatchObject({ codigo: 'tabla_no_disponible' });
  });
});
