import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaReclamacionPeajes, type ExtrasReclamacion } from './vista';
import { MAX_FILAS_POR_CATEGORIA } from './revision';
import { revisarCobros, type LineaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { detectarAtipicos } from '@/lib/likida/peajes/cruces_atipicos';
import { cierreMensual } from '@/lib/likida/peajes/cierre_mensual';
import { evaluarReclamo, resumirSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';

const ID = '11111111-1111-4111-8111-111111111111';
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
    const html = pintar(extras(reporte(pasada)));
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
