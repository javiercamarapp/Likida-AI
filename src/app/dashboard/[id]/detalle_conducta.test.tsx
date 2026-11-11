import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetalleLiquidacion, type PropsDetalle } from './detalle';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import type { LiquidacionDetalle } from '@/lib/likida/analytics';
import type { RevisionDetalle } from '@/lib/likida/revision';

// ═══════════════════════════════════════════════════════════════════════════
// El DETALLE DE LIQUIDACIÓN es una pantalla de DINERO y FISCAL: lo que el contralor cruza contra su PDF. Esta prueba fija su
// conducta VISIBLE antes y después de migrarla al sistema ui-v2 (montos, estados, PDF, acciones y su puerta, retenciones y
// leyendas). No fija el marcado: fija el contrato — qué cifra aparece, con qué texto, y qué botón existe solo cuando su acción
// llegó por props (la puerta vive en `page.tsx`, que solo pasa la acción si el rol puede).
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const D: LiquidacionDetalle = {
  id: 'liq-1', viajeId: 'viaje-1', folio: 'V-1041', estatus: 'cuadrada',
  operadorId: 'op-1', operadorNombre: 'Juan Pérez',
  creadoEn: '2026-08-25T18:00:00+00:00',
  totalComprobado: 5200, totalAnticipo: 6000, diferencia: 800,
  ieps: 0, litrosDiesel: 410.5, iva: 320, peaje: 150,
  diferencias: [
    { tipo: 'sin_cfdi', nota: 'La caseta de Querétaro no trae factura', monto: 600, gastoId: 'g-2' },
    { tipo: 'sobre_politica', nota: 'Alimentación sobre el tope de la política', monto: 120, gastoId: 'g-3' },
  ],
  gastos: [
    { id: 'g-1', concepto: 'diesel', monto: 3500, folio: 'A-77', fecha: '2026-08-20', formaPago: '03', cfdiUuid: 'AAAA-BBBB-CCCC', estadoSat: 'vigente', cfdiValido: true },
    { id: 'g-2', concepto: 'caseta', monto: 600, formaPago: '01', imagenUrl: 'x' },
    { id: 'g-3', concepto: 'alimentacion', monto: 1100, formaPago: '01', cfdiUuid: 'DDDD', cfdiValido: false },
  ],
  viaje: {
    estatus: 'liquidado', origen: 'Monterrey', destino: 'Guadalajara', fechaInicio: '2026-08-19T12:00:00+00:00', creadoEn: null,
    unidadEco: 'ECO-12', unidadPlacas: 'ABC-123', clienteNombre: 'Grupo Boreal', operadorTelefono: '5512345678',
    avisadoEn: '2026-08-19T10:00:00+00:00', aceptadoEn: null, llegadaEn: null, descargaEn: null, regresoEn: null,
  },
  comprobantesEntre: { primero: '2026-08-20T12:00:00+00:00', ultimo: '2026-08-21T12:00:00+00:00', n: 3 },
  comprobantesExcluidos: 0, comprobantesCuadran: true,
  deducibilidad: { totalDeducible: 3500, totalNoDeducible: 600, totalPorConfirmar: 1100 },
  laboral: { texto: 'Se le reembolsan los $600.00 aunque no sean deducibles.', montoPagadero: 600, fundamento: [] },
  pdfPath: 'flota/viaje.pdf',
};

const BASE: Omit<PropsDetalle, 'd'> = {
  sufijo: '?tenant=abc', estatus: { label: 'Cuadrada', estado: 'ok' }, etiqueta: (g) => g.concepto,
  pdfHref: null, wa: null, reasignar: null, reabrir: null, revision: null,
};
const pintar = (sobre: Partial<PropsDetalle> = {}, d: LiquidacionDetalle = D) => renderToStaticMarkup(<DetalleLiquidacion {...BASE} d={d} {...sobre} />);
const accion = async () => null;
const estado = (s: Partial<RevisionDetalle> = {}): RevisionDetalle => ({
  revision: 'pendiente', revisadaPor: null, revisadaEn: null, motivo: null, ajustes: [], viajeEstatus: 'liquidado', firmable: true, ...s,
});

describe('detalle de liquidación · estructura', () => {
  it('un solo h1 con el folio, el estatus visible y el regreso a Viajes con la flota elegida', () => {
    const h = pintar();
    expect(h.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(h).toContain('Liquidación del viaje V-1041');
    expect(h).toContain('Cuadrada');
    expect(h).toContain('href="/dashboard/viajes?tenant=abc"');
  });

  it('la ficha del viaje dice ruta, operador, unidad, cliente y cuántos comprobantes; lo que falta es guion, no un valor inventado', () => {
    const h = pintar();
    for (const t of ['Monterrey → Guadalajara', 'Juan Pérez', 'ECO-12', 'ABC-123', 'Grupo Boreal', '3 comprobantes']) expect(h).toContain(t);
    const vacio = pintar({}, { ...D, viaje: { ...D.viaje, origen: null, destino: null, unidadEco: null, clienteNombre: null, fechaInicio: null }, comprobantesEntre: { primero: null, ultimo: null, n: 0 } });
    expect(vacio).toContain('Sin ruta capturada');
    expect(vacio).toContain('Sin unidad');
    expect(vacio).toContain('Sin cliente');
  });
});

describe('detalle de liquidación · montos', () => {
  it('anticipo, comprobado y diferencia con su nota (sobrante a favor de la empresa)', () => {
    const h = pintar();
    expect(h).toContain('$6,000.00');
    expect(h).toContain('$5,200.00');
    expect(h).toContain('$800.00');
    expect(h).toMatch(/sobrante · a favor de la empresa/);
  });

  it('faltante: a favor del operador; cero: «Cuadra exacto»', () => {
    expect(pintar({}, { ...D, diferencia: -250 })).toMatch(/faltante · a favor del operador/);
    const cero = pintar({}, { ...D, diferencia: 0 });
    expect(cero).toContain('Cuadra exacto');
    expect(cero).toContain('anticipo = comprobado');
  });

  it('«Sin CFDI» suma solo lo cruzable por comprobante y «Sobre tope» el excedente', () => {
    const h = pintar();
    expect(h).toMatch(/1 comprobante sin factura/);
    expect(h).toMatch(/excedente en 1 comprobante/);
    expect(h).toContain('$120.00');
  });

  it('una diferencia sin gastoId no inventa el monto sin CFDI: guion y la nota dice por qué', () => {
    const h = pintar({}, { ...D, diferencias: [{ tipo: 'sin_cfdi', nota: 'Vieja', monto: 500 }] });
    expect(h).toMatch(/monto no cruzable/);
  });

  it('acreditable: litros de diésel, IVA y peaje 50 %; IEPS en guion si no hay', () => {
    const h = pintar();
    expect(h).toContain('410.5');
    expect(h).toContain('$320.00');
    expect(h).toContain('$150.00');
    expect(h).toMatch(/IEPS de diésel/);
    expect(h).toMatch(/Peaje 50 %/);
    expect(h).toMatch(/que el motor no verifica/);
  });

  it('sin nada acreditable lo dice, no pinta ceros como medición', () => {
    const h = pintar({}, { ...D, litrosDiesel: 0, ieps: 0, iva: 0, peaje: 0 });
    expect(h).toMatch(/no encontró conceptos acreditables/);
  });
});

describe('detalle de liquidación · fiscal y retenciones', () => {
  it('deducibilidad: las tres cubetas suman el total comprobado y llevan la nota de que la determinación es del contador', () => {
    const h = pintar();
    expect(h).toContain('De lo comprobado, cuánto es deducible');
    expect(h).toContain('$3,500.00');
    expect(h).toContain('$1,100.00');
    expect(h).toMatch(/la determinación final es de su contador/);
  });

  it('si las cubetas no cuadran con el total no se pinta un desglose que contradice al total', () => {
    const h = pintar({}, { ...D, deducibilidad: { totalDeducible: 1, totalNoDeducible: 1, totalPorConfirmar: 1 } });
    expect(h).not.toContain('De lo comprobado, cuánto es deducible');
  });

  it('lo pagadero al operador (LFT) va en pantalla con el texto del motor y su monto', () => {
    const h = pintar();
    expect(h).toContain('Lo que se le reembolsa al operador');
    expect(h).toContain('Se le reembolsan los $600.00');
    expect(h).toMatch(/LFT 110 y 111/);
  });

  it('la leyenda de que no es un dictamen siempre acompaña a la hoja', () => {
    expect(pintar()).toContain(LEYENDA_CORTA);
  });
});

describe('detalle de liquidación · comprobantes y estados', () => {
  it('cada renglón con folio, UUID, forma de pago y monto; foto archivada sin miniatura ni enlace', () => {
    const h = pintar({ etiqueta: (g) => ({ diesel: 'Diésel', caseta: 'Caseta', alimentacion: 'Alimentación' })[g.concepto] ?? g.concepto });
    for (const t of ['Diésel', 'Caseta', 'Alimentación', 'A-77', 'AAAA-BBBB-CCCC', 'Transferencia', 'Efectivo', '$3,500.00', '$600.00', '$1,100.00']) expect(h).toContain(t);
    expect(h).toContain('Foto archivada');
    expect(h).not.toMatch(/<img/);
  });

  it('el estado de cada renglón sale del motor: vigente, sin CFDI, sobre tope', () => {
    const h = pintar();
    expect(h).toContain('CFDI vigente');
    expect(h).toContain('Sin CFDI');
    expect(h).toContain('Sobre tope');
  });

  it('el pie dice «Total comprobado» cuando cuadra y «Suma de los renglones» con su aviso cuando no', () => {
    expect(pintar()).toContain('Total comprobado');
    const h = pintar({}, { ...D, comprobantesCuadran: false });
    expect(h).toContain('Suma de los renglones');
    expect(h).toMatch(/no se pudo reconstruir la liquidación/);
    expect(h).toContain('$5,200.00');
  });

  it('sin renglones individuales dice qué pasó y cuánto se cerró, no una tabla vacía', () => {
    const h = pintar({}, { ...D, gastos: [] });
    expect(h).toMatch(/no hay comprobantes\s+individuales registrados/);
    expect(h).toContain('$5,200.00');
  });

  it('los excluidos del total se explican', () => {
    expect(pintar({}, { ...D, comprobantesExcluidos: 2 })).toMatch(/2 comprobantes excluidos del total/);
    expect(pintar({}, { ...D, comprobantesExcluidos: 1 })).toMatch(/1 comprobante excluido del total/);
  });

  it('las diferencias se listan con su nota y monto, y «Aprobar / Descontar» está deshabilitado con su razón', () => {
    const h = pintar();
    expect(h).toContain('La caseta de Querétaro no trae factura');
    expect(h).toContain('Alimentación sobre el tope de la política');
    expect(h).toMatch(/<button[^>]*disabled[^>]*>[^<]*Aprobar \/ Descontar|<button[^>]*>[^<]*Aprobar \/ Descontar/);
    expect(h).toMatch(/Todavía no se puede aprobar ni descontar desde el panel/);
    expect(pintar({}, { ...D, diferencias: [] })).not.toContain('Diferencias detectadas');
  });

  it('la línea de tiempo no estima horas: un hito sin sello lo dice', () => {
    const h = pintar();
    expect(h).toContain('Sin confirmación registrada');
    expect(h).toContain('Viaje avisado al chofer');
    expect(h).toContain('Cuadre del motor');
    expect(h).toContain('Disponible para descargar');
    expect(pintar({}, { ...D, pdfPath: null })).toContain('Sin generar');
  });
});

describe('detalle de liquidación · PDF y acciones (la puerta vive en la página; aquí, lo que se ofrece según lo que llega)', () => {
  it('con pdfHref ofrece la descarga; sin él (rechazada, ilegible o sin permiso) no hay botón', () => {
    expect(pintar({ pdfHref: '/api/export/pdf/liq-1' })).toContain('href="/api/export/pdf/liq-1"');
    expect(pintar()).not.toContain('/api/export/pdf/');
  });

  it('WhatsApp solo si hay enlace, y se abre sin dar la ventana de origen', () => {
    const h = pintar({ wa: 'https://wa.me/525512345678' });
    expect(h).toContain('href="https://wa.me/525512345678"');
    expect(h).toMatch(/rel="noopener noreferrer"/);
    expect(pintar()).not.toContain('wa.me');
  });

  it('revisión ilegible: avisa en rojo y no afirma que la liquidación esté vigente', () => {
    const h = pintar({ revisionIlegible: true });
    expect(h).toContain('No se pudo leer el estado de revisión de esta liquidación.');
    expect(h).toMatch(/No se ofrece la descarga del PDF/);
  });

  it('PDF pendiente tras un ajuste: botón «Reintentar PDF» solo si la acción llegó', () => {
    expect(pintar({ reintentarPdf: accion })).toContain('Reintentar PDF');
    expect(pintar({ reintentarPdf: accion })).toMatch(/Reintentar no cambia tu firma ni las cifras/);
    expect(pintar()).not.toContain('Reintentar PDF');
  });

  it('reasignar chofer solo existe con su acción', () => {
    const r = { buscar: async () => [], total: 12, actual: 'op-1', actualNombre: 'Juan Pérez', accion };
    expect(pintar({ reasignar: r })).toContain('Reasignar chofer');
    expect(pintar()).not.toContain('Reasignar chofer');
  });

  it('reabrir es destructivo: exige la casilla de confirmación con el folio y dice que borra la liquidación y el PDF', () => {
    const h = pintar({ reabrir: accion });
    expect(h).toContain('Reabrir viaje');
    expect(h).toMatch(/name="confirmar"/);
    expect(h).toContain('Entiendo que se borra la liquidación V-1041 y su PDF.');
    expect(h).toMatch(/Borra la liquidación actual y su PDF/);
    expect(pintar()).not.toContain('Reabrir viaje');
  });

  it('la firma humana: el panel de revisión aparece con el estado y sus tres decisiones; sin acción dice que el rol no firma', () => {
    const con = pintar({ revision: { estado: estado(), gastos: [{ id: 'g-1', etiqueta: 'Diésel', monto: 3500 }], accion } });
    for (const t of ['Revisión', 'Espera tu firma', 'Aprobar', 'Ajustar montos', 'Rechazar']) expect(con).toContain(t);
    const sin = pintar({ revision: { estado: estado(), gastos: [], accion: null } });
    expect(sin).toContain('Tu rol no firma liquidaciones');
    expect(sin).not.toContain('Ajustar montos');
    expect(pintar()).not.toContain('Espera tu firma');
  });

  it('un comprobante disputado por el operador se muestra con lo que se leyó y lo que dijo', () => {
    const h = pintar({
      revision: {
        estado: estado(), accion,
        gastos: [{ id: 'g-1', etiqueta: 'Diésel', monto: 800, disputa: { montoLeido: 800, dijo: '8000', en: '2026-08-25T18:00:00+00:00' } as never }],
      },
    });
    expect(h).toContain('El operador dice que este monto está mal');
    expect(h).toContain('$800.00');
    expect(h).toContain('8000');
  });
});
