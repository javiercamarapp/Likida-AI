// A37-A3-03: lo que la lectura DEJA FUERA (embarques, páginas, filas) debe verse y bloquear la aprobación,
// no quedar en `meta.avisos` sin pantalla. Datos sintéticos.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: async () => null }));

import { estado, reset } from './repo_falso.fixture';
import { A, lecturaAtlas, sembrarFlotas, subirYProcesar } from './escenario.fixture';
import { llmFalso } from './llm_falso.fixture';
import { detectarFormato, prepararContenido, MAX_FILAS_HOJA } from './contenido';
import { ENCABEZADOS_ATLAS, EMBARQUE_ATLAS, filaAtlas } from './documentos_sinteticos.fixture';

beforeEach(() => { reset(); sembrarFlotas(); });

const fila = (folio: string) => filaAtlas({ ...EMBARQUE_ATLAS, folio });

describe('A37-A3-03: embarques que no se leyeron BLOQUEAN la aprobación', () => {
  it('un libro con 2 embarques y datos en otra hoja: se lee el primero, y el documento queda con un bloqueo `lectura_incompleta` visible', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENCABEZADOS_ATLAS, fila('ATL-1'), fila('ATL-2')]), 'Embarques');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['folio', 'nota'], ['ATL-1', 'frágil']]), 'Detalle');
    const bytes = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const r = await subirYProcesar(A, bytes, llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1')), 'libro.xlsx');
    expect(r.proceso).toMatchObject({ ok: true, estado: 'por_revisar' });
    const d = estado.docs.get(r.documentoId)!;
    const h = d.validacion!.hallazgos.find((x) => x.codigo === 'lectura_incompleta');
    expect(h?.severidad).toBe('bloqueo');
    expect(h?.mensaje).toMatch(/Se leyó el primero/);
    expect(d.validacion!.listoParaAprobar).toBe(false);
    expect(d.extraccion!.meta!.lecturaIncompleta).toHaveLength(1);
  });

  it('control: un archivo de un solo embarque no trae `lectura_incompleta`', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENCABEZADOS_ATLAS, fila('ATL-1')]), 'Embarques');
    const bytes = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const r = await subirYProcesar(A, bytes, llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1')), 'uno.xlsx');
    const d = estado.docs.get(r.documentoId)!;
    expect(d.validacion!.hallazgos.some((x) => x.codigo === 'lectura_incompleta')).toBe(false);
  });
});

describe('A37-A3-03: el contenido marca como PÉRDIDA lo que recorta', () => {
  it('una hoja con más filas que el tope: aviso + pérdida que bloquea', async () => {
    const filas = [ENCABEZADOS_ATLAS, ...Array.from({ length: MAX_FILAS_HOJA + 5 }, (_, i) => fila(`ATL-${i}`))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Embarques');
    const bytes = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'csv' }));
    const d = detectarFormato(bytes);
    if (!d.ok) throw new Error(d.motivo);
    const c = await prepararContenido(bytes, d.clase);
    expect(c.perdidas?.some((p) => p.bloquea && /filas/.test(p.mensaje))).toBe(true);
  });
});
