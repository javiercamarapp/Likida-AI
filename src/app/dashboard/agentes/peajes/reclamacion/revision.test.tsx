import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaReclamacionPeajes, type ExtrasReclamacion } from './vista';
import { MAX_FILAS_POR_CATEGORIA } from './revision';
import { revisarCobros, type LineaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { detectarAtipicos } from '@/lib/likida/peajes/cruces_atipicos';
import { cierreMensual, cierreDosMeses, type LineaCierre, type ArchivoCierre } from '@/lib/likida/peajes/cierre_mensual';
import { evaluarReclamo, resumirSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';

const ID = '11111111-1111-4111-8111-111111111111';
const lin = (p: Partial<LineaCierre>): LineaCierre => ({ fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', monto: 100, ...p });
const archivo = (id: string, desde: string, hasta: string, lineas: LineaCierre[]): ArchivoCierre => ({ id, etiqueta: id, periodoDesde: desde, periodoHasta: hasta, lineas });
const nada = async () => {};
const acciones = { crearReclamo: nada, marcarEnviado: nada, registrarNota: nada, rechazar: nada };
const l = (indice: number, p: Partial<LineaCobro> = {}): LineaCobro => ({
  indice, fecha: '2026-03-05', hora: `10:${String(indice % 60).padStart(2, '0')}:00`, caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', clase: 5, monto: 100, ...p,
});

function reporte(lineas: LineaCobro[], o: Partial<ReporteRevision> = {}): ReporteRevision {
  return {
    desgloseId: ID, proveedor: 'IAVE', archivoNombre: '01 A 10 DE MARZO.xlsx', periodoMedidoDesde: '2026-02-27', periodoMedidoHasta: '2026-03-10',
    periodoOficialDesde: '2026-03-01', periodoOficialHasta: '2026-03-10', periodoOrigen: 'nombre_archivo', noPeriodo: '801',
    calidad: { sinEncabezadoConDatos: ['O', 'P'], noReconocidas: [], columnasFaltantes: [], lineasSinTag: 0, lineasSinUnidad: 3, lineasSinClase: 0, hojaLeida: 'g00', hojasIgnoradas: ['Hoja1'] },
    revision: revisarCobros(lineas, { periodoDesde: '2026-03-01' }), atipicos: detectarAtipicos(lineas), rotulo: 'Candidato: validar con el proveedor', ...o,
  };
}
const extras = (revision: ReporteRevision | null, o: Partial<ExtrasReclamacion> = {}): ExtrasReclamacion => ({
  revision, mes: null, cierre: null, seguimiento: { reclamos: [], resumen: resumirSeguimiento([], '2026-03-20') }, acciones, ...o,
});
const pintar = (e: ExtrasReclamacion, estado: 'ok' | 'sin_desglose' = 'ok') =>
  renderToStaticMarkup(<VistaReclamacionPeajes sufijo="?tenant=f-1" desglose={estado === 'ok' ? ID : null} estado={estado} reporte={null} extras={e} />);

describe('A2P-04: doble cobro entre archivos en pantalla', () => {
  it('se pinta con su monto y el archivo previo', async () => {
    const { revisarDobleEntreArchivos } = await import('@/lib/likida/peajes/doble_entre_archivos');
    const ls = [l(0, { fecha: '2026-02-20', monto: 189.5, hora: '10:15:00' })];
    const previo = { id: 'p1', etiqueta: 'corte-febrero.csv', periodoDesde: '2026-02-11', periodoHasta: '2026-02-20',
      lineas: [{ fecha: '2026-02-20', hora: '10:15:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', monto: 189.5, indice: 3 }] };
    const dobleEntreArchivos = revisarDobleEntreArchivos(ls, [previo], { periodoDesde: '2026-03-01', archivoActualId: ID });
    const html = pintar(extras(reporte(ls, { dobleEntreArchivos })));
    expect(html).toContain('Posible doble cobro entre archivos');
    expect(html).toContain('$189.50');
    expect(html).toContain('corte-febrero.csv');
  });
});

describe('la revisión de cobros en pantalla', () => {
  const lineas = [l(0, { clase: 9, monto: 400 }), l(1, { fecha: '2026-02-27', monto: 250, caseta: 'Plaza <script>x</script>' }), l(2), l(3, { hora: '10:00:00' })];

  it('todo se rotula «candidato: validar con el proveedor» y nada se llama cobro indebido', () => {
    const html = pintar(extras(reporte(lineas)));
    expect(html).toContain('Candidato: validar con el proveedor');
    expect(html).toContain('Son candidatos, no cobros indebidos');
    expect(html.toLowerCase()).not.toMatch(/cobro indebido (confirmado|detectado)|fraude/);
  });

  it('cada categoría con candidatos enseña qué pasó / qué significa / qué hacer, con sus cifras', () => {
    const html = pintar(extras(reporte(lineas)));
    for (const t of ['Clase distinta de 3 y 5', 'Cobro extemporáneo', 'Qué pasó:', 'Qué significa:', 'Qué hacer:', 'clase 9', '$400.00', 'Periodo 2026-03-01 a 2026-03-10']) expect(html).toContain(t);
    expect(html).toContain('/api/export/peajes-revision?desglose=' + ID + '&amp;tenant=f-1');
  });

  it('un texto del proveedor se escapa, no se inyecta', () => {
    const html = pintar(extras(reporte(lineas)));
    expect(html).toContain('Plaza &lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('dice las reglas que no pudo aplicar y los avisos de calidad del archivo', () => {
    const sinPeriodo = reporte(lineas, { periodoOficialDesde: null, periodoOficialHasta: null, periodoOrigen: null, revision: revisarCobros(lineas, {}) });
    const html = pintar(extras(sinPeriodo));
    expect(html).toContain('Reglas que no se pudieron aplicar');
    expect(html).toContain('Sin periodo del archivo no se puede saber qué cobro llegó tarde');
    expect(html).toContain('Periodo del archivo no declarado');
    expect(html).toContain('2 columnas sin encabezado con datos (O, P) no se importan');
    expect(html).toContain('3 líneas sin unidad');
    expect(html).toContain('repite filas y leerla duplicaría cruces');
  });

  it('pinta como máximo ' + MAX_FILAS_POR_CATEGORIA + ' por categoría y manda al Excel por el resto', () => {
    const muchas = Array.from({ length: MAX_FILAS_POR_CATEGORIA + 50 }, (_, i) => l(i, { clase: 9, unidad: `U${i}`, tag: `IMDM${String(i).padStart(8, '0')}`, hora: `10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}` }));
    const html = pintar(extras(reporte(muchas)));
    expect(html).toContain(`Se muestran los primeros ${MAX_FILAS_POR_CATEGORIA} de ${MAX_FILAS_POR_CATEGORIA + 50}; el Excel trae todos.`);
    expect(html.match(/Qué pasó:/g)).toHaveLength(MAX_FILAS_POR_CATEGORIA);
  });

  it('sugiere (no aplica) las casetas de posible tarifa por pasada', () => {
    const pasada = Array.from({ length: 30 }, (_, i) => l(i, { caseta: 'Caseta Pasada Uno', clase: 1, hora: `09:00:${String(i).padStart(2, '0')}` }));
    // Modo «solo las declaradas»: con el default (la clase 1 es tarifa por pasada en todas) ya no se marca ni se sugiere nada.
    const html = pintar(extras(reporte(pasada, { revision: revisarCobros(pasada, { periodoDesde: '2026-03-01', clase1: 'declaradas' }) })));
    expect(html).toContain('¿Tarifa por pasada?');
    expect(html).toContain('Caseta Pasada Uno (30)');
  });
});

describe('el cierre mensual en pantalla', () => {
  it('incompleto se dice incompleto, con la decena que falta', () => {
    const c = cierreMensual('2026-03', [{ id: 'a', etiqueta: 'a', periodoDesde: '2026-03-01', periodoHasta: '2026-03-10', lineas: [{ fecha: '2026-03-02', hora: '10:00:00', caseta: 'X', tag: 'IMDM00000001', monto: 100 }] }]);
    if ('error' in c) throw new Error(c.error);
    const html = pintar(extras(null, { mes: '2026-03', cierre: c }), 'sin_desglose');
    expect(html).toContain('Mes incompleto');
    expect(html).toContain('Falta el archivo');
    expect(html).toContain('Faltan las decenas 11 a 20 y 21 a 31');
    expect(html).toContain('name="mes"');
  });
  it('un fallo al armar el cierre NO se lee como «no hay cobros»', () => {
    const html = pintar(extras(null, { mes: '2026-03', errorCierre: true }), 'sin_desglose');
    expect(html).toContain('No se pudo armar el cierre ahora mismo');
    expect(html).not.toContain('Mes completo');
  });
});

describe('el seguimiento de reclamos en pantalla', () => {
  const vista = (p: Partial<ReclamoVista> & { id: string }, hoy: string): ReclamoVista => {
    const base = { estado: 'enviado' as const, fechaCobroMasAntiguo: '2026-06-15', montoReclamado: 10_000, montoAcreditado: 0, ...p };
    return {
      desgloseId: ID, proveedor: 'IAVE', categoria: 'extemporaneo', nCruces: 12, enviadoEn: '2026-06-20', referenciaPortal: 'P-123', notas: null, ...base,
      evaluacion: evaluarReclamo(base, hoy),
    };
  };
  it('muestra plazo, lo acreditado y lo que falta; por vencer y vencido se distinguen', () => {
    const hoy = '2026-09-10';
    const reclamos = [vista({ id: 'a', montoAcreditado: 4000, estado: 'acreditado_parcial' }, hoy), vista({ id: 'b', fechaCobroMasAntiguo: '2026-05-01' }, hoy)];
    const html = pintar(extras(null, { seguimiento: { reclamos, resumen: resumirSeguimiento(reclamos, hoy) } }), 'sin_desglose');
    expect(html).toContain('Por vencer');
    expect(html).toContain('Vencido');
    expect(html).toContain('vence 2026-09-15');
    expect(html).toContain('Acreditado en parte');
    expect(html).toContain('Registrar nota de crédito');
    expect(html).toContain('Folio P-123');
    expect(html).toContain('por acreditar $16,000.00');
  });
  it('A39-peajes-01: un reclamo solo preparado no entra en «reclamado» ni «por acreditar»; se rotula aparte', () => {
    const hoy = '2026-07-01';
    const reclamos = [vista({ id: 'e', montoReclamado: 10_000 }, hoy), vista({ id: 'p', estado: 'preparado', montoReclamado: 50_000, enviadoEn: null }, hoy)];
    const html = pintar(extras(null, { seguimiento: { reclamos, resumen: resumirSeguimiento(reclamos, hoy) } }), 'sin_desglose');
    expect(html).toContain('por acreditar $10,000.00');
    expect(html).toContain('1 preparados sin enviar');
    expect(html).toContain('$50,000.00');
  });
  it('un reclamo preparado ofrece marcarlo enviado; uno cerrado no ofrece nada', () => {
    const hoy = '2026-07-01';
    const html = pintar(extras(null, { seguimiento: { reclamos: [vista({ id: 'p', estado: 'preparado', enviadoEn: null }, hoy), vista({ id: 'c', estado: 'acreditado', montoAcreditado: 10_000 }, hoy)], resumen: resumirSeguimiento([], hoy) } }), 'sin_desglose');
    expect(html.match(/Marcar como enviado/g)).toHaveLength(1);
    expect(html.match(/Registrar nota de crédito/g)).toBeNull();
  });
  it('un fallo al leer el seguimiento se dice, no se pinta «aún no registras reclamos»', () => {
    const html = pintar(extras(null, { seguimiento: null, errorSeguimiento: true }), 'sin_desglose');
    expect(html).toContain('No se pudo leer el seguimiento ahora mismo');
    expect(html).not.toContain('Aún no registras reclamos');
  });
  it('el formulario de registrar reclamo ofrece solo las categorías con candidatos', () => {
    const rev = reporte([l(0, { clase: 9 }), l(1, { hora: '10:30:00' })]);
    const html = pintar(extras(rev));
    expect(html).toContain('Registrar reclamo de');
    expect(html).toContain('<option value="clase_fuera_de_3_5">');
    expect(html).not.toContain('<option value="tag_dado_de_baja">');
  });
});

describe('A2 ola 1 · la propuesta de a qué reclamo corresponde una nota de crédito', () => {
  const vista = (p: Partial<ReclamoVista> & { id: string }): ReclamoVista => {
    const base = { estado: 'enviado' as const, fechaCobroMasAntiguo: '2026-08-15', montoReclamado: 1000, montoAcreditado: 0, ...p };
    return {
      desgloseId: ID, proveedor: 'IAVE', categoria: 'extemporaneo', nCruces: 4, enviadoEn: '2026-08-20', referenciaPortal: null, notas: null, ...base,
      evaluacion: evaluarReclamo(base, '2026-09-10'),
    };
  };
  const reclamos = [vista({ id: 'aaaaaaaa-1', montoReclamado: 1000, referenciaPortal: 'P-9' }), vista({ id: 'bbbbbbbb-2', montoReclamado: 250.5, categoria: 'duplicado_exacto' }), vista({ id: 'cccccccc-3', montoReclamado: 500, categoria: 'clase_fuera_de_3_5' })];
  const con = (propuestaNota: ExtrasReclamacion['propuestaNota']) =>
    pintar(extras(null, { seguimiento: { reclamos, resumen: resumirSeguimiento(reclamos, '2026-09-10') }, propuestaNota }), 'sin_desglose');

  it('ofrece el formulario GET (no escribe nada) cuando hay reclamos enviados, conservando los parámetros de la flota', () => {
    const html = pintar(extras(null, { seguimiento: { reclamos, resumen: resumirSeguimiento(reclamos, '2026-09-10') } }), 'sin_desglose');
    expect(html).toContain('¿A qué reclamo corresponde una nota de crédito?');
    expect(html).toMatch(/<form[^>]*action="\/dashboard\/agentes\/peajes\/reclamacion" method="get"/);
    expect(html).toContain('name="tenant" value="f-1"');
    expect(html).toContain('name="nota"');
    expect(html).toContain('no registra nada');
  });
  it('sin reclamos enviados no se pinta (no hay contra qué casar)', () => {
    const solo = [vista({ id: 'p', estado: 'preparado' })];
    const html = pintar(extras(null, { seguimiento: { reclamos: solo, resumen: resumirSeguimiento(solo, '2026-09-10') } }), 'sin_desglose');
    expect(html).not.toContain('¿A qué reclamo corresponde una nota de crédito?');
  });
  it('coincidencia exacta con un reclamo: lo nombra y pide confirmación manual', () => {
    const html = con({ texto: '250.50', importe: 250.5, resultado: { tipo: 'seguro', reclamoIds: ['bbbbbbbb-2'], confirmado: false, alertas: [] } });
    expect(html).toContain('Coincide exactamente con');
    expect(html).toContain('Cobro duplicado exacto');
    expect(html).toContain('Confírmalo capturando la nota en ese reclamo');
    expect(html).toContain('value="250.50"');
  });
  it('varias combinaciones: las lista y dice que ninguna se elige sola', () => {
    const html = con({ texto: '1500', importe: 1500, resultado: { tipo: 'sugerido', opciones: [['aaaaaaaa-1', 'cccccccc-3']], ambiguo: false, truncado: false, confirmado: false, alertas: [] } });
    expect(html).toContain('Podría corresponder a la suma de estos reclamos');
    expect(html).toContain('folio P-9');
    const amb = con({ texto: '500', importe: 500, resultado: { tipo: 'sugerido', opciones: [['cccccccc-3'], ['bbbbbbbb-2']], ambiguo: true, truncado: true, confirmado: false, alertas: [] } });
    expect(amb).toContain('ninguna se elige sola');
    expect(amb).toContain('Hay más combinaciones de las que se muestran');
  });
  it('sin coincidencia lo dice y una nota mayor que todo lo pendiente alerta', () => {
    const html = con({ texto: '999', importe: 999, resultado: { tipo: 'sin_casar', confirmado: false, alertas: ['nota_mayor_que_reclamado'] } });
    expect(html).toContain('Ningún reclamo enviado ni combinación de ellos suma $999.00');
    expect(html).toContain('es mayor que todo lo que falta por acreditar');
  });
  it('un importe inválido o un fallo de lectura se dicen; un fallo NO se lee como «sin coincidencia»', () => {
    const malo = con({ texto: '1234,50', importe: null, resultado: null, motivo: 'El monto es ambiguo' });
    expect(malo).toContain('El monto es ambiguo');
    expect(malo).not.toContain('Ningún reclamo');
    const fallo = con({ texto: '100', importe: null, resultado: null, fallo: true });
    expect(fallo).toContain('No se pudo calcular la propuesta');
    expect(fallo).not.toContain('Ningún reclamo');
  });
  it('un texto de la nota se escapa, no se inyecta', () => {
    const html = con({ texto: '"><script>x</script>', importe: null, resultado: null, motivo: 'no es un número' });
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('A2 ola 1 · selector de mes y vista de dos meses', () => {
  const opciones = ['2026-10', '2026-09', '2026-08'];
  it('el mes se elige de una lista (los últimos meses) en vez de teclear la URL, y ofrece «dos meses juntos»', () => {
    const html = pintar(extras(null, { mesesOpciones: opciones }), 'sin_desglose');
    expect(html).toMatch(/<select[^>]*name="mes"/);
    for (const m of opciones) expect(html).toContain(`<option value="${m}"`);
    expect(html).toMatch(/<select[^>]*name="meses"/);
    expect(html).toContain('Dos meses juntos');
  });
  it('un mes fuera de la lista (un cierre viejo pedido por URL) se conserva como opción seleccionada', () => {
    const html = pintar(extras(null, { mesesOpciones: opciones, mes: '2025-01' }), 'sin_desglose');
    expect(html).toContain('<option value="2025-01"');
  });
  it('sin lista de meses queda el campo de texto de siempre', () => {
    const html = pintar(extras(null), 'sin_desglose');
    expect(html).toMatch(/<input[^>]*name="mes"/);
  });
  it('la vista de dos meses pinta la ventana, las seis decenas y separa lo que se acomoda de lo que queda fuera', () => {
    const c = cierreDosMeses('2026-03', [
      archivo('f-a', '2026-02-01', '2026-02-10', [lin({ fecha: '2026-02-03' })]),
      archivo('m-c', '2026-03-21', '2026-03-31', [lin({ fecha: '2026-03-22', tag: 'IMDM00000002' }), lin({ fecha: '2026-02-25', tag: 'IMDM00000003', monto: 70 }), lin({ fecha: '2026-01-20', tag: 'IMDM00000004', monto: 30 })]),
    ]);
    if ('error' in c) throw new Error(c.error);
    const html = pintar(extras(null, { mes: '2026-03', dosMeses: true, cierreDos: c, mesesOpciones: opciones }), 'sin_desglose');
    expect(html).toContain('2026-02 + 2026-03');
    expect(html).toContain('Ventana incompleta');
    expect(html).toContain('Decena 2026-02 · 1 a 10');
    expect(html).toContain('Decena 2026-03 · 21 a 31');
    expect(html).toContain('Cobros tardíos que caen dentro de la ventana (se acomodan): 1');
    expect(html).toContain('Anteriores a 2026-02');
    expect(html).toContain('Ver los dos meses');
  });
});
