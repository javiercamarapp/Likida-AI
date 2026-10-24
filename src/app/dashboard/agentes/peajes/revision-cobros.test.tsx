import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevisionCobros, estadoRevisionCobros, type DatosRevisionCobros } from './revision-cobros';
import { VistaAgentePeajes } from './vista';
import { PALABRAS_PROHIBIDAS_INSIGHTS } from '@/lib/likida/peajes/insights_cobros';
import type { ResumenDesglose } from '@/lib/likida/intake/desglose_peaje';
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// T-A2-27: tarjetas y KPIs de la revisión de cobros en la pantalla del agente de peajes.
// Fixtures sintéticos: ninguna cifra ni nombre es de un cliente real.

const HOY = '2026-10-15';
const accionOk = async () => null;

const resumenCat = { n: 0, monto: 0 };
function reporte(over: Partial<ReporteRevision['revision']> = {}, hallazgos = 2): ReporteRevision {
  return {
    desgloseId: 'd1', proveedor: 'PROVEEDOR', archivoNombre: 'corte.csv',
    periodoMedidoDesde: null, periodoMedidoHasta: null, periodoOficialDesde: '2026-07-01', periodoOficialHasta: '2026-07-10',
    periodoOrigen: 'declarado', noPeriodo: null, calidad: null,
    revision: {
      candidatos: [
        { indice: 1, categoria: 'duplicado_exacto', fecha: '2026-07-02', hora: null, caseta: 'C1', tag: 'T1', unidad: 'U1', clase: 5, monto: 100 },
        { indice: 2, categoria: 'duplicado_exacto', fecha: '2026-07-02', hora: null, caseta: 'C1', tag: 'T1', unidad: 'U1', clase: 5, monto: 100 },
        { indice: 3, categoria: 'extemporaneo', fecha: '2026-06-20', hora: null, caseta: 'C2', tag: 'T2', unidad: 'U2', clase: 5, monto: 250, justificacion: 'servicio especial' },
        { indice: 4, categoria: 'extemporaneo', fecha: '2026-06-21', hora: null, caseta: 'C2', tag: 'T2', unidad: 'U2', clase: 5, monto: 250 },
      ],
      porCategoria: {
        ...({} as ReporteRevision['revision']['porCategoria']),
        unidad_inmovilizada: resumenCat, clase_fuera_de_3_5: resumenCat, extemporaneo: { n: 2, monto: 500 },
        duplicado_exacto: { n: 2, monto: 200 }, tag_dado_de_baja: resumenCat, caseta_no_debe_cruzarse: resumenCat,
      },
      lineasConCandidato: 4, montoConCandidato: 700, lineasRevisadas: 100, montoRevisado: 9000,
      reglasNoAplicadas: [], sinClase: 10, porClase: [], sugerenciasPasada: [],
      ...over,
    },
    atipicos: { atipicos: Array.from({ length: hallazgos }, () => ({}) as never), noAplicadas: [] },
    rotulo: 'Candidato: validar con el proveedor',
  } as ReporteRevision;
}

function reclamo(over: Partial<ReclamoVista> = {}): ReclamoVista {
  return {
    id: 'r1', desgloseId: 'd1', proveedor: 'PROVEEDOR', categoria: 'duplicado_exacto', estado: 'enviado', nCruces: 2,
    montoReclamado: 200, montoAcreditado: 50, fechaCobroMasAntiguo: '2026-07-02', enviadoEn: '2026-07-20',
    referenciaPortal: null, notas: null,
    evaluacion: {} as ReclamoVista['evaluacion'], ...over,
  };
}

const datos = (over: Partial<DatosRevisionCobros> = {}): DatosRevisionCobros => ({
  reporte: reporte(), reclamos: [reclamo()], tarifas: 3, vinculos: [{ estado: 'ligado' }, { estado: 'sin_viaje' }, { estado: 'sin_viaje' }], hoy: HOY, ...over,
});

describe('estadoRevisionCobros (de los datos de la base a lo que se pinta)', () => {
  it('arma tarjetas por categoria con n y monto del reporte', () => {
    const e = estadoRevisionCobros(datos());
    expect(e.tipo).toBe('ok');
    if (e.tipo !== 'ok') return;
    expect(e.insights.tarjetas.map((t) => [t.id, t.n, t.monto])).toEqual([['extemporaneo', 2, 500], ['duplicado_exacto', 2, 200]]);
  });

  it('atendidos = reclamados de ese desglose y categoria + justificados', () => {
    const e = estadoRevisionCobros(datos());
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    // duplicado: 2 reclamados de 2; extemporaneo: 1 justificado de 2 => 3 de 4 candidatos = 75 %
    expect(e.insights.kpis.pctRevisado.valor).toBe(75);
  });

  it('A37-A2-04: los KPI Reclamado y Pendiente son de ESTE archivo y sin preparados ni rechazados', () => {
    const e = estadoRevisionCobros(datos({
      reclamos: [
        reclamo({ id: 'e1', estado: 'enviado', montoReclamado: 200, montoAcreditado: 50 }),
        reclamo({ id: 'p1', estado: 'preparado', montoReclamado: 40000, montoAcreditado: 0 }),
        reclamo({ id: 'x1', estado: 'rechazado', montoReclamado: 25000, montoAcreditado: 0 }),
        reclamo({ id: 'o1', desgloseId: 'otro', estado: 'enviado', montoReclamado: 9000, montoAcreditado: 0 }),
      ],
    }));
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.insights.kpis.reclamado.valor).toBe(200);
    expect(e.insights.kpis.acreditado.valor).toBe(50);
    expect(e.insights.kpis.pendiente.valor).toBe(150);
  });

  it('un reclamo de OTRO desglose no cuenta como revisado', () => {
    const e = estadoRevisionCobros(datos({ reclamos: [reclamo({ desgloseId: 'otro' })] }));
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.insights.kpis.pctRevisado.valor).toBe(25);
  });

  it('el estado del reclamo por categoria sale del reclamo; sin reclamo dice «Sin reclamar»', () => {
    const e = estadoRevisionCobros(datos());
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.estadoReclamo.duplicado_exacto).toBe('Enviado al proveedor');
    expect(e.estadoReclamo.extemporaneo).toBe('Sin reclamar');
  });

  it('reclamado vs acreditado vs pendiente sale de los reclamos de ESTE archivo (A37-A2-04: no mezcla otros archivos)', () => {
    const e = estadoRevisionCobros(datos({ reclamos: [reclamo(), reclamo({ id: 'r2', desgloseId: 'otro', montoReclamado: 100, montoAcreditado: 0 })] }));
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.insights.kpis.reclamado.valor).toBe(200);
    expect(e.insights.kpis.acreditado.valor).toBe(50);
    expect(e.insights.kpis.pendiente.valor).toBe(150);
  });

  it('por vencer: solo candidatos de categorias SIN reclamar y con plazo de 3 meses corriendo desde la fecha del cruce', () => {
    // extemporaneo (sin reclamo): cruces del 20 y 21 de junio => limite 20/21 de septiembre: ya vencidos al 15 de octubre.
    // Con hoy = 2026-09-01 estan por vencer (a 19-20 dias).
    const e = estadoRevisionCobros(datos({ hoy: '2026-09-01' }));
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.insights.kpis.porVencer.valor).toBe(2);
    expect(e.insights.kpis.porVencer.monto).toBe(500);
  });

  it('sin viaje se cuenta de los vinculos; sin vinculos guardados es «sin dato» y se marca el cruce como no disponible', () => {
    const con = estadoRevisionCobros(datos());
    if (con.tipo !== 'ok') throw new Error('esperaba ok');
    expect(con.insights.kpis.sinViaje.valor).toBe(2);
    expect(con.sinViajes).toBe(false);
    const sin = estadoRevisionCobros(datos({ vinculos: [] }));
    if (sin.tipo !== 'ok') throw new Error('esperaba ok');
    expect(sin.insights.kpis.sinViaje.valor).toBeNull();
    expect(sin.sinViajes).toBe(true);
  });

  it('los cruces atipicos del reporte salen en su KPI', () => {
    const e = estadoRevisionCobros(datos());
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.insights.kpis.atipicosNuevos.valor).toBe(2);
  });

  it('sin tarifas configuradas se marca sinTarifa', () => {
    const e = estadoRevisionCobros(datos({ tarifas: 0 }));
    if (e.tipo !== 'ok') throw new Error('esperaba ok');
    expect(e.sinTarifa).toBe(true);
  });

  it('sin desglose abierto: sin_archivo', () => {
    expect(estadoRevisionCobros(datos({ reporte: null, hayDesglose: false })).tipo).toBe('sin_archivo');
  });

  it('desglose abierto pero la revision no se pudo leer: error (no «sin archivo»)', () => {
    expect(estadoRevisionCobros(datos({ reporte: null, hayDesglose: true })).tipo).toBe('error');
  });

  it('reclamos ilegibles: error, no un cero que parezca medicion', () => {
    expect(estadoRevisionCobros(datos({ reclamos: null })).tipo).toBe('error');
  });

  it('si el calculo truena, devuelve error en vez de lanzar', () => {
    const roto = reporte();
    (roto.revision as unknown as { porCategoria: unknown }).porCategoria = null;
    expect(() => estadoRevisionCobros(datos({ reporte: roto }))).not.toThrow();
    expect(estadoRevisionCobros(datos({ reporte: roto })).tipo).toBe('error');
  });
});

describe('RevisionCobros: render', () => {
  const pintarEstado = (d: DatosRevisionCobros) => renderToStaticMarkup(<RevisionCobros estado={estadoRevisionCobros(d)} />);

  it('con datos: franjas, tarjetas con monto, n y estado del reclamo, y el rotulo de candidato visible', () => {
    const html = pintarEstado(datos());
    expect(html).toContain('Qué pasó');
    expect(html).toContain('Plazo');
    expect(html).toContain('Recuperado vs reclamado');
    expect(html).toContain('% revisado');
    expect(html).toContain('Candidato: validar con el proveedor');
    expect(html).toContain('$500.00');
    expect(html).toContain('Enviado al proveedor');
    expect(html).toContain('Sin reclamar');
  });

  it('el % revisado y los cruces evaluados por el sistema van en KPIs separados y rotulados', () => {
    const html = pintarEstado(datos());
    expect(html).toContain('Candidatos revisados por una persona');
    expect(html).toContain('Cruces evaluados automáticamente');
  });

  it('accesibilidad: la tabla de categorias tiene caption y encabezados de columna y de fila', () => {
    const html = pintarEstado(datos());
    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    expect(html).toMatch(/<th scope="col"[^>]*>Categoría/);
    expect(html).toMatch(/<th scope="row"[^>]*>/);
  });

  it('vacio sin archivo: «sube el archivo del proveedor»', () => {
    const html = renderToStaticMarkup(<RevisionCobros estado={{ tipo: 'sin_archivo' }} />);
    expect(html).toContain('sube el archivo del proveedor');
  });

  it('vacio sin tarifa: las diferencias de importe quedan como candidatos', () => {
    expect(pintarEstado(datos({ tarifas: 0 }))).toContain('las diferencias de importe quedan como candidatos');
  });

  it('vacio sin viajes: cruce con viajes no disponible', () => {
    expect(pintarEstado(datos({ vinculos: [] }))).toContain('cruce con viajes no disponible');
  });

  it('dato inexistente se pinta «sin dato», nunca 0', () => {
    const html = pintarEstado(datos({ vinculos: [] }));
    expect(html).toContain('sin dato');
  });

  it('error: mensaje en lenguaje llano, sin palabras tecnicas', () => {
    const html = renderToStaticMarkup(<RevisionCobros estado={{ tipo: 'error' }} />);
    expect(html).toContain('No se pudo calcular la revisión de cobros');
    expect(html).toContain('role="status"');
  });

  it('ningun texto pintado contiene palabras prohibidas', () => {
    for (const html of [pintarEstado(datos()), pintarEstado(datos({ tarifas: 0, vinculos: [] })), renderToStaticMarkup(<RevisionCobros estado={{ tipo: 'error' }} />), renderToStaticMarkup(<RevisionCobros estado={{ tipo: 'sin_archivo' }} />)]) {
      const texto = html.replace(/<[^>]+>/g, ' ').toLowerCase();
      for (const p of PALABRAS_PROHIBIDAS_INSIGHTS) expect(texto).not.toContain(p);
    }
  });

  it('el «~3 %» del cliente no aparece como cifra y el ahorro de tiempo no se rotula como dato', () => {
    const html = pintarEstado(datos());
    expect(html).not.toContain('3 %');
    expect(html).not.toMatch(/ahorro de tiempo[^<]*\d/i);
  });
});

describe('cableado en la pantalla del agente', () => {
  const desglose: ResumenDesglose = {
    desgloseId: 'd1', proveedor: 'PASE', archivoNombre: 'corte.csv', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10',
    creadoEn: '2026-08-11T00:00:00Z', total: 10, cuadra: 6, noCuadra: 1, sinContraparte: 3, pctCuadra: 60,
  };
  const pintarVista = (cobros: Parameters<typeof VistaAgentePeajes>[0]['revisionCobros']) => renderToStaticMarkup(
    <VistaAgentePeajes
      conciliacion={null} lineas={null} desgloses={null} peajeAcreditable={null} sufijo=""
      subirDesglose={accionOk} ejecutarAhora={accionOk}
      desglosesProveedor={[desglose]} desgloseSeleccionado={desglose}
      detalleSeleccionado={{ cuadra: [], noCuadra: [], sinContraparte: [] }}
      evidenciaGps={null} verificacion={null} importarDesglose={accionOk} conciliarDesglose={accionOk}
      revisionCobros={cobros}
    />,
  );

  it('la vista pinta la revision de cobros que le pasa la pagina', () => {
    const html = pintarVista(estadoRevisionCobros(datos()));
    expect(html).toContain('Recuperado vs reclamado');
    expect(html).toContain('Candidato: validar con el proveedor');
  });

  it('un error del calculo NO tumba la pagina: el resto (subir, anular, conciliar) sigue pintado', () => {
    const html = pintarVista({ tipo: 'error' });
    expect(html).toContain('No se pudo calcular la revisión de cobros');
    expect(html).toContain('Subir estado de cuenta');
    expect(html).toContain('Conciliar');
  });

  it('sin la prop (otras pantallas y pruebas) la vista sigue pintando como antes', () => {
    const html = pintarVista(undefined);
    expect(html).toContain('Subir estado de cuenta');
  });
});
