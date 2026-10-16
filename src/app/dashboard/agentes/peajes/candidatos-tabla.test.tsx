import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TablaCandidatosCobros } from './candidatos-tabla';
import { VistaReclamacionPeajes, type ExtrasReclamacion } from './reclamacion/vista';
import { filasDeCandidatos, normalizarFiltros, tablaDeCandidatos, type DecisionGuardada } from '@/lib/likida/peajes/candidatos_tabla';
import type { CandidatoCobro } from '@/lib/likida/peajes/reglas_cobro';
import type { CruceAtipico } from '@/lib/likida/peajes/cruces_atipicos';
import { revisarCobros } from '@/lib/likida/peajes/reglas_cobro';
import { detectarAtipicos } from '@/lib/likida/peajes/cruces_atipicos';
import { resumirSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';

const ID = '11111111-1111-4111-8111-111111111111';
const nada = async () => {};
const cand = (indice: number, p: Partial<CandidatoCobro> = {}): CandidatoCobro => ({
  indice, categoria: 'clase_fuera_de_3_5', fecha: '2026-03-05', hora: '10:00:00', caseta: 'Plaza Ejemplo Sur', tag: `TAG${indice}`, unidad: 'TC9001',
  clase: 9, monto: 100, quePaso: `Cruce ${indice} con clase 9`, queSignifica: 'Puede ser un error de clase', queHacer: 'Validar con el proveedor', referencia: 'r', ...p,
});
const atip = (): CruceAtipico => ({ senal: 'repeticion_caseta', unidad: 'TC9002', indices: [20, 21], fecha: '2026-03-06', caseta: 'Caseta Ejemplo Norte', monto: 180, quePaso: 'Repetición', queSignifica: 's', queHacer: 'h' });
const dec = (indice: number, accion: DecisionGuardada['accion'], motivo: string | null): DecisionGuardada => ({ indice, categoria: 'clase_fuera_de_3_5', accion, motivo, actor: 'panel:flota_admin', creadoEn: '2026-03-20T10:00:00Z' });
const aplic = { reclamado: 2, descartado: 3, justificado: 3 };

const tabla = (q: Record<string, string> = {}, decisiones: DecisionGuardada[] = []) =>
  tablaDeCandidatos(filasDeCandidatos([cand(1), cand(2), cand(3, { fecha: null })], [atip()], decisiones), normalizarFiltros(q));
const pintar = (t = tabla(), conAcciones = true) => renderToStaticMarkup(
  <TablaCandidatosCobros tabla={t} error={false} desglose={ID} sufijo="?tenant=f-1" decidir={conAcciones ? nada : undefined} aplicables={conAcciones ? aplic : undefined} />);

describe('la tabla de candidatos en pantalla', () => {
  it('trae las columnas con «qué pasó», los totales y el rótulo de candidato', () => {
    const html = pintar();
    expect(html).toContain('Cruce 1 con clase 9');
    expect(html).toContain('Qué pasó');
    expect(html).toContain('Candidato');
    expect(html).toContain('Por revisar · 4');
    expect(html).toContain('Atípico · ');
  });

  it('cada fila pendiente trae sus tres acciones; el descartar y el justificar piden motivo; reclamar no', () => {
    const html = pintar();
    expect(html.match(/Marcar como reclamado<\/button>/g)).toHaveLength(2); // el atípico y el sin fecha no se reclaman
    expect(html.match(/>Descartar<\/button>/g)).toHaveLength(4);
    expect(html.match(/>Justificar<\/button>/g)).toHaveLength(4);
    expect(html).toContain('name="indice" value="1"');
    expect(html).toContain('name="categoria" value="atipico_repeticion_caseta"');
    expect(html).toContain('minLength="3"');
    expect(html).toContain(`name="desglose" value="${ID}"`);
  });

  it('una fila decidida no vuelve a ofrecer acciones: muestra su estado, motivo, quién y cuándo', () => {
    const html = pintar(tabla({}, [dec(1, 'descartado', 'Ya cobrado antes')]));
    expect(html).toContain('Descartado');
    expect(html).toContain('Ya cobrado antes');
    expect(html).toContain('panel:flota_admin');
    expect(html).toContain('20 mar 2026');
    expect(html.match(/>Descartar<\/button>/g)).toHaveLength(3);
  });

  it('la fecha de la decisión es la de México: 02:30 UTC del 2 de septiembre es el 1 de septiembre', () => {
    const d: DecisionGuardada = { ...dec(1, 'descartado', 'Ya cobrado antes'), creadoEn: '2026-09-02T02:30:00Z' };
    const html = pintar(tabla({}, [d]));
    expect(html).toContain('01 sep 2026');
    expect(html).not.toContain('02 sep 2026');
    expect(html).not.toContain('2026-09-02');
  });

  it('el motivo escrito por alguien se escapa', () => {
    const html = pintar(tabla({}, [dec(1, 'justificado', '<script>x</script>')]));
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('el lote pide confirmación con el número exacto y arrastra el filtro actual', () => {
    const html = pintar(tabla({ cat: 'clase_fuera_de_3_5', unidad: 'TC9001' }));
    expect(html).toContain('Acciones en lote');
    expect(html).toContain('Confirmo: marcar como reclamados 2 cruces');
    expect(html).toContain('name="esperado" value="2"');
    expect(html).toContain('type="checkbox" required="" name="confirmar"');
    expect(html).toContain('name="f_cat" value="clase_fuera_de_3_5"');
    expect(html).toContain('name="f_unidad" value="TC9001"');
  });

  it('sin acción (solo lectura) no hay botones ni lote', () => {
    const html = pintar(tabla(), false);
    expect(html).not.toContain('Descartar');
    expect(html).not.toContain('Acciones en lote');
  });

  it('los filtros reflejan la URL y sin resultados la pantalla lo dice', () => {
    const html = pintar(tabla({ unidad: 'no-existe', cat: 'extemporaneo', desde: '2026-03-01' }));
    expect(html).toContain('Ningún candidato cumple este filtro');
    expect(html).toContain('value="no-existe"');
    expect(html).toContain('Quitar filtros');
  });

  it('la paginación enlaza conservando filtro y flota; una sola página no pinta navegación', () => {
    const muchas = tablaDeCandidatos(filasDeCandidatos(Array.from({ length: 120 }, (_, i) => cand(i, { monto: i + 1 })), [], []), normalizarFiltros({ unidad: 'TC9001', pag: '2' }));
    const html = renderToStaticMarkup(<TablaCandidatosCobros tabla={muchas} error={false} desglose={ID} sufijo="?tenant=f-1" />);
    expect(html).toContain('Página 2 de 3');
    expect(html).toContain('Mostrando 51–100 de 120');
    expect(html).toMatch(/href="\?tenant=f-1&amp;desglose=[^"]*&amp;unidad=TC9001&amp;pag=3#candidatos"/);
    expect(html).toMatch(/href="\?tenant=f-1&amp;desglose=[^"]*&amp;unidad=TC9001#candidatos"/); // «anterior» a la página 1 no lleva pag
    expect(pintar()).not.toContain('Páginas de candidatos');
  });

  it('si no se pudo leer, lo dice (no pinta «sin candidatos»)', () => {
    const html = renderToStaticMarkup(<TablaCandidatosCobros tabla={null} error desglose={ID} sufijo="" />);
    expect(html).toContain('No se pudo leer la tabla de candidatos');
    expect(html).not.toContain('no tiene candidatos');
  });
});

describe('cableado: la pantalla de reclamación la pinta', () => {
  const lineas = [0, 1, 2].map((i) => ({ indice: i, fecha: '2026-03-05', hora: `10:0${i}:00`, caseta: 'Plaza Ejemplo Sur', tag: `TAG0000000${i}`, unidad: 'TC9002', clase: 9, monto: 100 }));
  const extras = (conTabla: boolean): ExtrasReclamacion => ({
    revision: {
      desgloseId: ID, proveedor: 'Proveedor Ejemplo', archivoNombre: 'prueba.xlsx', periodoMedidoDesde: '2026-03-01', periodoMedidoHasta: '2026-03-10',
      periodoOficialDesde: '2026-03-01', periodoOficialHasta: '2026-03-10', periodoOrigen: 'nombre_archivo', noPeriodo: '801', calidad: null,
      revision: revisarCobros(lineas, { periodoDesde: '2026-03-01' }), atipicos: detectarAtipicos(lineas), rotulo: 'Candidato: validar con el proveedor',
    },
    mes: null, cierre: null, seguimiento: { reclamos: [], resumen: resumirSeguimiento([], '2026-03-20') },
    acciones: { crearReclamo: nada, marcarEnviado: nada, registrarNota: nada, rechazar: nada },
    candidatos: conTabla ? { tabla: tablaDeCandidatos(filasDeCandidatos([cand(1)], [], []), normalizarFiltros({})), error: false, decidir: nada, aplicables: aplic } : undefined,
  });
  const vista = (e: ExtrasReclamacion) => renderToStaticMarkup(<VistaReclamacionPeajes sufijo="?tenant=f-1" desglose={ID} estado="ok" reporte={null} extras={e} />);

  it('con la tabla armada, la sección «Candidatos del archivo» aparece con sus acciones', () => {
    const html = vista(extras(true));
    expect(html).toContain('id="candidatos"');
    expect(html).toContain('Candidatos del archivo');
    expect(html).toContain('Marcar como reclamado');
  });
  it('sin tabla armada la pantalla de siempre no cambia', () => {
    expect(vista(extras(false))).not.toContain('id="candidatos"');
  });
});
