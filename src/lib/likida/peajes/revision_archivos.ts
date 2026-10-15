// ═══════════════════════════════════════════════════════════════════════════
// LA REVISIÓN DE COBROS, COMO EXCEL — para validar con el proveedor por su portal.
//
// Mismo contenido que la pantalla: el resumen por categoría, TODOS los candidatos
// con «qué pasó / qué significa / qué hacer», el reporte de calidad del archivo y los
// cruces atípicos. Arriba de cada hoja, el rótulo: son candidatos para validar con el
// proveedor, no cobros indebidos confirmados. Determinista (sin fechas de creación).
// Los textos del proveedor se escriben como TEXTO (jamás fórmula).
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import type { ReporteRevision } from './revision_cobros';
import { CATEGORIAS_COBRO, ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO } from './reglas_cobro';
import { ETIQUETA_SENAL } from './cruces_atipicos';

type Fila = Array<string | number | null>;

/** Excel evalúa como fórmula el texto que empieza con = + - @: se neutraliza con un apóstrofo visible. */
const texto = (v: string | null | undefined): string => {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export function revisionAExcel(r: ReporteRevision): Uint8Array {
  const libro = XLSX.utils.book_new();
  const rev = r.revision;

  const resumen: Fila[] = [
    ['Revisión de cobros del proveedor de peaje'],
    [ROTULO_CANDIDATO],
    [`Archivo: ${texto(r.archivoNombre) || 'sin nombre'} · Proveedor: ${texto(r.proveedor) || 'no declarado'}`],
    [r.periodoOficialDesde && r.periodoOficialHasta
      ? `Periodo del archivo: ${r.periodoOficialDesde} a ${r.periodoOficialHasta} (${r.periodoOrigen === 'declarado' ? 'declarado al subirlo' : 'tomado del nombre del archivo'})`
      : 'Periodo del archivo: NO SE SABE (sin periodo no se revisan los cobros extemporáneos)'],
    [`Líneas revisadas: ${rev.lineasRevisadas} · Importe revisado (MXN): ${rev.montoRevisado}`],
    [`Líneas con al menos un candidato: ${rev.lineasConCandidato} · Importe (MXN): ${rev.montoConCandidato}`],
    [],
    ['Categoría', 'Candidatos', 'Importe (MXN)'],
    ...CATEGORIAS_COBRO.map((c): Fila => [ETIQUETA_CATEGORIA_COBRO[c], rev.porCategoria[c].n, rev.porCategoria[c].monto]),
    [],
    ['Reglas que NO se pudieron aplicar a este archivo'],
    ...(rev.reglasNoAplicadas.length === 0 ? [['(todas se aplicaron)']] : rev.reglasNoAplicadas.map((x): Fila => [ETIQUETA_CATEGORIA_COBRO[x.regla], x.motivo])),
    [],
    ['Cruces por clase', 'Cruces', 'Importe (MXN)'],
    ...rev.porClase.map((c): Fila => [c.clase === null ? 'sin clase' : `clase ${c.clase}`, c.n, c.monto]),
  ];
  if (rev.sugerenciasPasada.length > 0) {
    resumen.push([], ['Casetas donde la clase 1 domina (probable tarifa por pasada; decláralo en «Reglas de cobro»)', 'Cruces clase 1', 'Importe (MXN)']);
    for (const s of rev.sugerenciasPasada) resumen.push([texto(s.caseta), s.cruces, s.monto]);
  }
  const hRes = XLSX.utils.aoa_to_sheet(resumen);
  hRes['!cols'] = [{ wch: 60 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(libro, hRes, 'Resumen');

  const cabeceras = ['Línea', 'Categoría', 'Fecha del cruce', 'Hora', 'Caseta', 'TAG', 'Unidad (archivo)', 'Clase', 'Importe (MXN)', 'Qué pasó', 'Qué significa', 'Qué hacer', 'Referencia', 'Estado'];
  const filas: Fila[] = [[ROTULO_CANDIDATO], [], cabeceras];
  for (const c of rev.candidatos) {
    filas.push([
      c.indice + 1, ETIQUETA_CATEGORIA_COBRO[c.categoria], c.fecha, c.hora, texto(c.caseta), texto(c.tag), texto(c.unidad), c.clase, c.monto,
      texto(c.quePaso), texto(c.queSignifica), texto(c.queHacer), texto(c.referencia), ROTULO_CANDIDATO,
    ]);
  }
  const hCand = XLSX.utils.aoa_to_sheet(filas);
  hCand['!cols'] = [6, 26, 12, 9, 26, 18, 14, 7, 13, 70, 70, 60, 30, 30].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(libro, hCand, 'Candidatos');

  const calidad = r.calidad as Record<string, unknown> | null;
  const filasCal: Fila[] = [['Calidad del archivo (qué se leyó y qué NO se reconoció)']];
  if (!calidad) filasCal.push(['Este desglose se importó antes del reporte de calidad: vuelve a subirlo para tenerlo.']);
  else {
    const simple = ['filasLeidas', 'lineasImportadas', 'saltadasSinImporte', 'saltadasTotales', 'lineasSinTag', 'lineasSinUnidad', 'lineasSinClase', 'lineasSinFecha', 'lineasSinHora', 'lineasImporteDistinto', 'noPeriodo', 'hojaLeida'];
    for (const k of simple) filasCal.push([k, (calidad[k] as string | number | null) ?? null]);
    for (const k of ['hojasIgnoradas', 'sinEncabezadoConDatos', 'noReconocidas', 'columnasFaltantes']) {
      const v = calidad[k];
      filasCal.push([k, Array.isArray(v) ? v.map((x) => texto(String(x))).join(', ') : '']);
    }
    const cols = calidad.columnas;
    if (Array.isArray(cols)) {
      filasCal.push([], ['Columna', 'Encabezado', 'Campo asignado', 'Trae datos']);
      for (const c of cols as Array<{ letra: string; encabezado: string | null; campo: string | null; conDatos: boolean }>) {
        filasCal.push([c.letra, texto(c.encabezado), c.campo ?? '(no se usa)', c.conDatos ? 'sí' : 'no']);
      }
    }
  }
  const hCal = XLSX.utils.aoa_to_sheet(filasCal);
  hCal['!cols'] = [{ wch: 30 }, { wch: 40 }, { wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(libro, hCal, 'Calidad del archivo');

  const filasAt: Fila[] = [['Cruces atípicos — candidatos para revisar con el despacho, no cobros indebidos'], [], ['Señal', 'Unidad', 'Fecha', 'Caseta', 'Importe (MXN)', 'Líneas', 'Qué pasó', 'Qué significa', 'Qué hacer']];
  for (const a of r.atipicos.atipicos) {
    filasAt.push([ETIQUETA_SENAL[a.senal], texto(a.unidad), a.fecha, texto(a.caseta), a.monto, a.indices.map((i) => i + 1).join(', '), texto(a.quePaso), texto(a.queSignifica), texto(a.queHacer)]);
  }
  if (r.atipicos.noAplicadas.length > 0) {
    filasAt.push([], ['Señales que no se pudieron aplicar']);
    for (const n of r.atipicos.noAplicadas) filasAt.push([ETIQUETA_SENAL[n.senal], n.motivo]);
  }
  const hAt = XLSX.utils.aoa_to_sheet(filasAt);
  hAt['!cols'] = [30, 14, 12, 26, 13, 14, 70, 70, 60].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(libro, hAt, 'Atípicos');

  return XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as Uint8Array;
}
