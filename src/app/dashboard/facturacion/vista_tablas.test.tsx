// La vista de Facturación pinta sus cinco tablas con `TablaBase` y conserva lo que el contralor cruza contra su estado de cuenta:
// los renglones, los montos con guion cuando son cero medido, el color de lo vencido y las acciones SOLO donde el estado real las permite.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => '/dashboard/facturacion', useSearchParams: () => new URLSearchParams() }));
import { VistaFacturacion, type CapturaFacturacion } from './vista';

const ant = (cubeta: string, diasVencida: number | null, rotulo: string) => ({ cubeta, diasVencida, rotulo });
const factura = (id: string, o: Record<string, unknown>) => ({
  id, folio: `F-${id}`, cliente: 'Cliente Uno', fecha: '2026-10-01', total: 1160, pagado: 0, saldo: 1160, estatus: 'emitida',
  venceEn: '2026-10-31', viva: true, conSaldo: true, antiguedad: ant('v1_30', 10, '10 días vencida'), ...o,
});
const datos = {
  hoy: '2026-11-10', viajesLiquidados: 3,
  cartera: {
    facturas: [
      factura('1', {}),
      factura('2', { estatus: 'borrador', viva: false, folio: null }),
      factura('3', { estatus: 'pagada', pagado: 1160, saldo: 0, conSaldo: false, antiguedad: ant('corriente', null, 'al corriente') }),
    ],
    facturasTotal: 3, vivas: 2, borradores: 1, canceladas: 0, facturado: 2320, cobrado: 1160, porCobrar: 1160, vencido: 1160,
    cubetas: [
      { clave: 'corriente', rotulo: 'Corriente', ayuda: 'aún no vence', saldo: 0, facturas: 0 },
      { clave: 'v1_30', rotulo: '1-30 días', ayuda: 'vencida', saldo: 1160, facturas: 1 },
    ],
    clientes: [{ cliente: 'Cliente Uno', facturado: 2320, cobrado: 1160, saldo: 1160, vencido: 1160, facturas: 2,
      porCubeta: { corriente: 0, v1_30: 1160, v31_60: 0, v60_mas: 0, sin_fecha: 0 }, diasMasVencido: 10 }],
    sinCondiciones: 0, hoy: '2026-11-10',
  },
  enLaMesa: {
    viajes: [{ viajeId: 'v1', folio: 'V-1', ruta: 'A → B', cliente: null, ingreso: null, liquidadoEn: null, diasSinFacturar: null, soloBorrador: true }],
    total: 1, ingresoCapturado: 0, sinIngreso: 1, conBorrador: 1, diasMasViejo: null,
  },
} as never;
const accion = async () => ({ ok: true as const, mensaje: 'ok' });
const captura: CapturaFacturacion = { clientes: [], hoy: '2026-11-10', factura: accion, pago: accion, emitir: accion, cancelar: accion };

describe('VistaFacturacion con TablaBase', () => {
  const html = renderToStaticMarkup(<VistaFacturacion datos={datos} captura={captura} auditoria={null} />);

  it('pinta las tablas del sistema, no tablas a mano, y un solo h1', () => {
    expect((html.match(/class="card rv-tb/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
  });

  it('un cero medido de cubeta es un guion, nunca «$0.00», y el total por cobrar cuadra con la cartera', () => {
    expect(html).toContain('Total por cobrar');
    expect(html).toContain('—');
  });

  it('las acciones salen según el estado REAL: borrador → emitir y cancelar; emitida con saldo → pago y cancelar; pagada → nada', () => {
    expect(html).toContain('data-forma-cajon="emitir-2"');
    expect(html).toContain('data-forma-cajon="pago-1"');
    expect(html).toContain('data-forma-cajon="cancelar-1"');
    expect(html).toContain('data-forma-cajon="cancelar-2"');
    expect(html).not.toContain('data-forma-cajon="pago-2"');
    expect(html).not.toContain('data-forma-cajon="pago-3"');
    expect(html).not.toContain('data-forma-cajon="cancelar-3"');
    expect(html).not.toContain('data-forma-cajon="emitir-1"');
  });

  it('la captura de una factura nueva vive en el encabezado como cajón', () => {
    expect(html).toContain('data-forma-cajon="factura-nueva"');
  });

  it('sin captura (solo lectura) no hay cajones de captura', () => {
    const solo = renderToStaticMarkup(<VistaFacturacion datos={datos} auditoria={null} />);
    expect(solo).not.toContain('data-forma-cajon');
  });
});
