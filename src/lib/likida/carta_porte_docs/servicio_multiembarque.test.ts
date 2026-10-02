import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));

import { estado, reset } from './repo_falso.fixture';
import { A, B, lecturaAtlas, sembrarFlotas, sinAgenteApagado, subir } from './escenario.fixture';
import { DIAS_RETENCION, procesarDocumento } from './servicio';
import { llmFalso } from './llm_falso.fixture';
import { eliminarDocumento } from './bandeja';
import { EMBARQUE_ATLAS, ENCABEZADOS_ATLAS, excelAtlas, filaAtlas } from './documentos_sinteticos.fixture';
import * as XLSX from 'xlsx';
import * as repo from './repo';

beforeEach(() => { reset(); sembrarFlotas(); });

const fila = (folio: string, producto = 'Botellas de vidrio vacías') => filaAtlas({ ...EMBARQUE_ATLAS, folio, producto });
const tipos = (docId: string) => estado.eventos.filter((e) => e.documentoId === docId).map((e) => e.tipo);
const hijosDe = (padreId: string) => estado.embarques.filter((e) => e.padreId === padreId).sort((a, b) => a.indice - b.indice);

/** Sube un Excel con N embarques y lo procesa SIN modelo (si lo llama, la prueba falla). */
async function subirYDividir(tenantId = A, filas = [fila('ATL-1'), fila('ATL-1', 'Tapas'), fila('ATL-2', 'Cajas'), fila('ATL-3', 'Etiquetas')]) {
  const r = await subir(tenantId, excelAtlas(filas), 'plan-del-dia.xlsx');
  const llm = llmFalso(() => { throw new Error('el modelo no debía llamarse para partir el archivo'); });
  const proceso = await procesarDocumento(tenantId, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
  return { ...r, proceso, llm };
}

describe('un Excel con N embarques se parte en N documentos hijos', () => {
  it('el original queda `dividido` y cada embarque nace `recibido`, sin gastar un solo token', async () => {
    const r = await subirYDividir();
    expect(r.proceso).toMatchObject({ ok: true, estado: 'dividido', embarques: 3, yaExistian: 0 });
    expect(r.llm.llamadas).toHaveLength(0);
    const padre = estado.docs.get(r.documentoId)!;
    expect(padre.estado).toBe('dividido');
    expect(padre.procesandoHasta).toBeNull();
    const hijos = hijosDe(r.documentoId);
    expect(hijos.map((h) => [h.indice, h.total, h.clave])).toEqual([[1, 3, 'ATL-1'], [2, 3, 'ATL-2'], [3, 3, 'ATL-3']]);
    for (const h of hijos) {
      const d = estado.docs.get(h.documentoId)!;
      expect(d).toMatchObject({ tenantId: A, estado: 'recibido', formato: 'csv', canal: 'manual', intentos: 0 });
      expect(d.nombreArchivo).toBe(`plan-del-dia · embarque ${h.clave}.csv`);
      expect(d.storageRuta).toBe(`${A}/${d.sha256}`);
      expect(estado.archivos.has(d.storageRuta!)).toBe(true);
      expect(tipos(d.id)).toEqual(['recibido']);
    }
  });

  it('todos los hermanos comparten la HUELLA BASE: el sha256 del archivo original', async () => {
    const r = await subirYDividir();
    const huella = estado.docs.get(r.documentoId)!.sha256;
    expect(new Set(hijosDe(r.documentoId).map((h) => h.huellaBase))).toEqual(new Set([huella]));
    // y cada uno tiene SU propia huella (la de su archivo derivado)
    const propias = hijosDe(r.documentoId).map((h) => estado.docs.get(h.documentoId)!.sha256);
    expect(new Set(propias).size).toBe(3);
    expect(propias).not.toContain(huella);
  });

  it('la retención del original es la de lo «cerrado» y la de los hijos la de lo recibido', async () => {
    const r = await subirYDividir();
    const dias = (iso: string) => (new Date(iso).getTime() - Date.now()) / 86_400_000;
    expect(dias(estado.docs.get(r.documentoId)!.retenerHasta)).toBeCloseTo(DIAS_RETENCION.cerrado, 0);
    for (const h of hijosDe(r.documentoId)) expect(dias(estado.docs.get(h.documentoId)!.retenerHasta)).toBeCloseTo(DIAS_RETENCION.recibido, 0);
  });

  it('la bitácora: el original deja «dividido» con el conteo; cada hijo nace con su «recibido» marcado como división', async () => {
    const r = await subirYDividir();
    expect(tipos(r.documentoId)).toEqual(['recibido', 'extraccion_iniciada', 'dividido']);
    const ev = estado.eventos.find((e) => e.documentoId === r.documentoId && e.tipo === 'dividido')!;
    expect(ev.detalle).toEqual({ embarques: 3, nuevos: 3, ya_existian: 0 });
    const primero = estado.eventos.find((e) => e.documentoId === hijosDe(r.documentoId)[0].documentoId)!;
    expect(primero.detalle).toMatchObject({ division: true, indice: 1, total: 3 });
  });

  it('cada hijo se lee después como UN embarque con su folio, sus renglones y SU extracción', async () => {
    const r = await subirYDividir();
    const [h1, h2] = hijosDe(r.documentoId);
    const llm1 = llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1'));
    const p1 = await procesarDocumento(A, h1.documentoId, { ...sinAgenteApagado, llm: () => llm1 });
    expect(p1).toMatchObject({ ok: true, estado: 'por_revisar' });
    const d1 = estado.docs.get(h1.documentoId)!;
    expect(d1.extraccion?.campos.folio_cliente.valor).toBe('ATL-1');
    // El modelo vio SOLO las filas de este embarque (dos renglones), no las de los demás.
    expect(llm1.llamadas[0].texto).toContain('ATL-1');
    expect(llm1.llamadas[0].texto).not.toContain('ATL-2');
    expect(llm1.llamadas[0].texto).not.toContain('ATL-3');
    const llm2 = llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-2'));
    await procesarDocumento(A, h2.documentoId, { ...sinAgenteApagado, llm: () => llm2 });
    expect(llm2.llamadas[0].texto).not.toContain('ATL-1');
    expect(estado.docs.get(h2.documentoId)!.extraccion?.campos.folio_cliente.valor).toBe('ATL-2');
    // Un hijo no se vuelve a partir (un solo folio).
    expect(estado.docs.get(h2.documentoId)!.estado).toBe('por_revisar');
  });

  it('reprocesar el original ya dividido no hace nada (nadie lo reclama) y NO duplica hijos', async () => {
    const r = await subirYDividir();
    const otra = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado });
    expect(otra).toMatchObject({ ok: false, motivo: 'no_reclamable' });
    expect(hijosDe(r.documentoId)).toHaveLength(3);
    expect([...estado.docs.values()].filter((d) => d.tenantId === A)).toHaveLength(4);
  });

  it('subir DE NUEVO el mismo Excel es un duplicado (huella del original): no se parte dos veces', async () => {
    const r = await subirYDividir();
    const otra = await subir(A, excelAtlas([fila('ATL-1'), fila('ATL-1', 'Tapas'), fila('ATL-2', 'Cajas'), fila('ATL-3', 'Etiquetas')]), 'otra-copia.xlsx');
    expect(otra).toMatchObject({ duplicado: true, documentoId: r.documentoId, estado: 'dividido' });
    expect(hijosDe(r.documentoId)).toHaveLength(3);
  });

  it('un Excel corregido con un embarque más reutiliza los hijos idénticos y solo crea los nuevos', async () => {
    const a = await subirYDividir(A, [fila('ATL-1'), fila('ATL-2')]);
    const b = await subirYDividir(A, [fila('ATL-1'), fila('ATL-2'), fila('ATL-3')]);
    expect(b.proceso).toMatchObject({ ok: true, estado: 'dividido', embarques: 3, yaExistian: 2 });
    // Los dos iguales apuntan a los documentos que ya existían (no se duplican); solo el 3.º cuelga del nuevo original.
    expect(hijosDe(b.documentoId).map((h) => h.clave)).toEqual(['ATL-3']);
    expect(hijosDe(a.documentoId)).toHaveLength(2);
    expect([...estado.docs.values()].filter((d) => d.formato === 'csv' && d.tenantId === A)).toHaveLength(3);
    expect(estado.eventos.find((e) => e.documentoId === b.documentoId && e.tipo === 'dividido')!.detalle).toEqual({ embarques: 3, nuevos: 1, ya_existian: 2 });
  });

  it('aislamiento: la misma planilla en OTRA flota se parte aparte y sus hijos no se mezclan', async () => {
    const a = await subirYDividir(A);
    const b = await subirYDividir(B);
    expect(hijosDe(a.documentoId).every((h) => h.tenantId === A)).toBe(true);
    expect(hijosDe(b.documentoId).every((h) => h.tenantId === B)).toBe(true);
    expect(await repo.hijosDeDocumento(B, a.documentoId)).toEqual([]);
    expect((await repo.hijosDeDocumento(A, a.documentoId)).map((h) => h.indice)).toEqual([1, 2, 3]);
  });

  it('el linaje: el hijo apunta al padre y el padre sabe cuántos hijos tiene', async () => {
    const r = await subirYDividir();
    const [h1] = hijosDe(r.documentoId);
    const l = await repo.linajeDeDocumentos(A, [r.documentoId, h1.documentoId]);
    expect(l.get(r.documentoId)).toMatchObject({ rol: 'padre', total: 3 });
    expect(l.get(h1.documentoId)).toMatchObject({ rol: 'hijo', padreId: r.documentoId, indice: 1, total: 3, clave: 'ATL-1' });
    expect((await repo.linajeDeDocumentos(B, [r.documentoId])).size).toBe(0);
  });
});

describe('lo que NO se parte, o no se puede', () => {
  it('un Excel de UN folio sigue el camino de siempre (una sola extracción)', async () => {
    const r = await subir(A, excelAtlas([fila('ATL-1'), fila('ATL-1', 'Tapas')]), 'uno.xlsx');
    const llm = llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1'));
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar' });
    expect(estado.embarques).toHaveLength(0);
    // Una sola extracción del documento entero (el nivel 2 puede repetirla, pero siempre con el MISMO texto de un solo folio).
    expect(new Set(llm.llamadas.map((l) => String(l.texto).match(/ATL-\d+/g)?.join(',')))).toEqual(new Set(['ATL-1,ATL-1']));
  });

  it('SIN la 0670/0671 (la base no tiene la RPC) se lee el primero y se AVISA, como hasta hoy: no se pierde el documento', async () => {
    estado.sinDivision = true;
    const r = await subir(A, excelAtlas([fila('ATL-1'), fila('ATL-2')]), 'plan.xlsx');
    const llm = llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1'));
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar' });
    expect(estado.docs.get(r.documentoId)!.extraccion?.meta?.avisos.join(' ')).toMatch(/2 embarques pero esta base aún no sabe partirlos/);
  });

  it('más de 100 embarques: no se parte, se lee el primero y el aviso dice cuántos eran', async () => {
    const filas = Array.from({ length: 101 }, (_, i) => fila(`ATL-${i + 1}`));
    const r = await subir(A, excelAtlas(filas), 'volcado.xlsx');
    const llm = llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1'));
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar' });
    expect(estado.embarques).toHaveLength(0);
    expect(estado.docs.get(r.documentoId)!.extraccion?.meta?.avisos.join(' ')).toMatch(/101 embarques \(más de 100\)/);
  });

  it('si el lease se perdió (otro lo terminó) no se parte nada: «perdí el lease» y cero hijos', async () => {
    const r = await subir(A, excelAtlas([fila('ATL-1'), fila('ATL-2')]), 'plan.xlsx');
    // Simula que, entre el claim y la división, otra invocación subió la versión del documento.
    estado.antesDeDividir = () => { estado.docs.get(r.documentoId)!.version += 1; };
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado });
    expect(p).toMatchObject({ ok: false, motivo: 'perdi_el_lease' });
    expect(estado.embarques).toHaveLength(0);
    expect(estado.docs.get(r.documentoId)!.estado).toBe('procesando');
  });
});

describe('eliminar un archivo dividido (cancelación ARCO)', () => {
  it('se llevan también los hijos y sus archivos en Storage, no solo la fila del original', async () => {
    const r = await subirYDividir();
    const rutas = hijosDe(r.documentoId).map((h) => estado.docs.get(h.documentoId)!.storageRuta!);
    expect(rutas.every((x) => estado.archivos.has(x))).toBe(true);
    await eliminarDocumento(A, r.documentoId, { id: null });
    expect(rutas.some((x) => estado.archivos.has(x))).toBe(false);
    expect(estado.archivos.has(`${A}/${estado.docs.get(r.documentoId)?.sha256 ?? 'x'}`)).toBe(false);
    expect([...estado.docs.values()].filter((d) => d.tenantId === A)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 15, M2: Excel de varias hojas. Los hijos son CSV de UNA tabla: partir se llevaba solo la hoja del folio.
// ═══════════════════════════════════════════════════════════════════════════
describe('libros de varias hojas (M2, ronda 15)', () => {
  const libro = (hojaExtra: string[][] | null): Buffer => {
    const aoa = [['PLAN'], [], ENCABEZADOS_ATLAS, fila('ATL-1'), fila('ATL-2')];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Embarques');
    if (hojaExtra) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaExtra), 'Detalle');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  };

  it('con datos en otra hoja NO se parte: se lee el libro entero y el aviso dice por qué', async () => {
    const r = await subir(A, libro([['folio', 'nota'], ['ATL-1', 'frágil'], ['ATL-2', 'refrigerado']]), 'plan-con-detalle.xlsx');
    const llm = llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1'));
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm });
    expect(p).toMatchObject({ ok: true, estado: 'por_revisar' });
    expect(estado.embarques).toHaveLength(0);
    expect(estado.docs.get(r.documentoId)!.extraccion?.meta?.avisos.join(' ')).toMatch(/2 embarques en la hoja «Embarques» y además datos en otra\(s\) hoja\(s\) \(«Detalle»\)/);
  });

  it('una segunda hoja VACÍA no impide partir', async () => {
    const r = await subir(A, libro([[]]), 'plan-hoja-vacia.xlsx');
    const p = await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado });
    expect(p).toMatchObject({ ok: true, estado: 'dividido', embarques: 2 });
  });
});
