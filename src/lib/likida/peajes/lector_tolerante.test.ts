import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('el lector no toca la base'); } }));

const { parsearArchivoDesglose, parsearDesgloseHoja } = await import('../intake/desglose_peaje');

// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR TOLERANTE, contra fixtures SINTÉTICOS (ver fixtures/README.md: NO
// son el formato real de PASE — ese archivo es un BLOQUEO externo). Cada fixture
// ejercita un modo de falla del mundo real.
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line security/detect-non-literal-fs-filename -- solo lee los fixtures sintéticos de este directorio
const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n));
const leer = (n: string, opciones = {}) => parsearArchivoDesglose(n, fx(n), opciones);

describe('CSV con «;» y coma decimal — el bug que convertía $189.50 en $18,950', () => {
  it('lee 189,50 como 189.50 y 1.234,00 como 1234 (con hora 12 h en español incluida)', async () => {
    const r = await leer('coma_decimal_punto_y_coma.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas.map((l) => l.monto)).toEqual([189.5, 1234, 189.5]);
    expect(r.lineas.map((l) => l.hora)).toEqual(['10:21:05', '14:03:00', '14:15:00']);
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-08-05', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM 10000001' });
  });
});

describe('«Fecha y hora» en una sola celda', () => {
  it('ISO con T, ISO con espacio y dd/mm/aaaa con segundos', async () => {
    const r = await leer('fecha_hora_combinada.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas.map((l) => [l.fecha, l.hora])).toEqual([
      ['2026-08-05', '10:21:05'], ['2026-08-05', '14:03:00'], ['2026-08-05', '23:59:59'],
    ]);
    expect(r.lineas[1].monto).toBe(1234);
  });
});

describe('encabezado enterrado, filas vacías y fila de TOTAL', () => {
  it('encuentra el encabezado bajo 4 renglones de título y salta el total sin contarlo como cruce', async () => {
    const r = await leer('encabezado_enterrado_con_total.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].monto).toBe(189);
    expect(r.avisos.join(' ')).toMatch(/1 filas de totales/);
  });
});

describe('un formato que no entiende lo DICE, con los encabezados que leyó', () => {
  it('«Improte» → error claro + sugerencia (solo sugiere, no lee)', async () => {
    const r = await leer('typo_importe.csv');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/columna de importe/);
    expect(r.motivo).toMatch(/A=«Dia»/);
    expect(r.motivo).toMatch(/E=«Dispositivo»/);
    expect(r.motivo).toMatch(/¿«Improte»\?/);
    expect(r.motivo).toMatch(/Configuración de peajes/);
  });

  it('encabezados genéricos (Col1…) → nombra lo que faltó y no adivina cuál es cuál', async () => {
    const r = await leer('formato_desconocido.csv');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/fecha ni de caseta ni de importe/);
    expect(r.motivo).toMatch(/«Col1»/);
    expect(r.motivo).toMatch(/no voy a adivinar/);
  });

  it('con el mapeo declarado para el proveedor, el mismo archivo SÍ se lee (por letra de columna)', async () => {
    const r = await leer('formato_desconocido.csv', { mapeo: { fecha: 'A', hora: 'B', caseta: 'C', monto: 'D' }, proveedor: 'PASE' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toEqual([{ indice: 0, fecha: '2026-08-05', caseta: 'Caseta Ejemplo Norte', monto: 189, tag: null, hora: '10:21:00' }]);
  });

  it('con el mapeo por NOMBRE de encabezado del typo', async () => {
    const r = await leer('typo_importe.csv', { mapeo: { fecha: 'Dia', hora: 'Hora', caseta: 'Plaza', monto: 'Improte', tag: 'Dispositivo' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0]).toMatchObject({ monto: 189, tag: 'IMDM10000001', hora: '10:21:00' });
    expect(r.avisos.join(' ')).not.toMatch(/mapeo configurado/);
  });

  it('un mapeo que NO coincide con el archivo cae a la detección por nombre y lo AVISA (no lo calla)', async () => {
    const r = await leer('fecha_hora_combinada.csv', { mapeo: { fecha: 'Fecha de cobro', caseta: 'Plaza', monto: 'Importe' }, proveedor: 'PASE' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisos.join(' ')).toMatch(/mapeo configurado para PASE no coincidió/);
    expect(r.lineas).toHaveLength(3);
  });

  it('mapeo que no coincide Y detección que no alcanza → el error cita lo que el mapeo buscaba', async () => {
    const r = await leer('formato_desconocido.csv', { mapeo: { fecha: 'Fecha de cobro', caseta: 'Plaza', monto: 'Importe' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/mapeo configurado buscaba/);
  });
});

describe('errores mezclados: lo ilegible NO tumba el archivo y NADA desaparece callado', () => {
  it('cuenta fecha ilegible (entra sin fecha), importe ilegible (se salta) y hora ilegible (entra sin hora)', async () => {
    const r = await leer('errores_mezclados.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toHaveLength(4);
    expect(r.lineas[1].fecha).toBeNull(); // 32/13/2026
    expect(r.lineas[1]).not.toHaveProperty('hora');
    expect(r.lineas[3]).toMatchObject({ fecha: '2026-08-07', tag: null });
    expect(r.lineas[3]).not.toHaveProperty('hora');
    const avisos = r.avisos.join(' | ');
    expect(avisos).toMatch(/1 filas sin importe legible/);
    expect(avisos).toMatch(/1 líneas no traen fecha legible/);
    expect(avisos).toMatch(/hora que no pude leer/);
  });
});

describe('latin1 (Excel de Windows) — los acentos no se corrompen', () => {
  it('«Peñón» sobrevive', async () => {
    const r = await leer('latin1_acentos.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0].caseta).toBe('Caseta Ejemplo Peñón');
    expect(r.lineas[0].monto).toBe(189.5);
  });
});

describe('Excel real (xlsx generado): serial con fracción y hora separada', () => {
  const excel = (filas: unknown[][]) => {
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Cruces');
    return Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }));
  };
  const serial = (y: number, m: number, d: number, frac = 0) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000 + frac;

  it('serial de fecha con fracción de día = fecha y hora', async () => {
    const r = await parsearArchivoDesglose('cruces.xlsx', excel([
      ['Fecha y hora', 'Plaza', 'Importe', 'TAG'],
      [serial(2026, 8, 5, 0.4375), 'Caseta Ejemplo Norte', 189, 'IMDM10000001'], // 10:30
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-08-05', hora: '10:30:00', monto: 189 });
  });

  it('columna de hora separada como fracción de día', async () => {
    const r = await parsearArchivoDesglose('cruces.xlsx', excel([
      ['Fecha', 'Hora', 'Plaza', 'Importe'],
      [serial(2026, 8, 5), 0.75, 'Caseta Ejemplo Norte', 189], // 18:00
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-08-05', hora: '18:00:00' });
  });

  it('archivo corrupto con extensión .xlsx → mensaje claro, no excepción', async () => {
    const r = await parsearArchivoDesglose('roto.xlsx', Buffer.from('esto no es un excel'));
    // La librería a veces lo lee como texto: el resultado correcto es o error claro o sin columnas, nunca lanzar.
    expect(r.ok).toBe(false);
  });
});

describe('hostil', () => {
  it('archivo vacío y solo encabezado', async () => {
    expect((await parsearArchivoDesglose('v.csv', Buffer.from(''))).ok).toBe(false);
    const r = await parsearArchivoDesglose('h.csv', Buffer.from('Fecha,Caseta,Importe\n'));
    expect(r.ok && r.lineas).toEqual([]);
  });
  it('un CSV de 6,000 líneas se lee completo (el tope lo aplica el importador, no el parser)', () => {
    const filas: string[][] = [['Fecha', 'Caseta', 'Importe']];
    for (let i = 0; i < 6000; i++) filas.push(['05/08/2026', `Caseta ${i % 7}`, '10.00']);
    const r = parsearDesgloseHoja(filas);
    expect(r.ok && r.lineas.length).toBe(6000);
  });
  it('inyección en celdas (fórmulas, comillas, saltos) se queda como texto', async () => {
    const csv = 'Fecha,Caseta,Importe,Tag\n05/08/2026,"=HYPERLINK(""http://x"")\nsegunda línea",189.00,"IMDM,10000001"\n';
    const r = await parsearArchivoDesglose('x.csv', Buffer.from(csv));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0].caseta).toBe('=HYPERLINK("http://x")\nsegunda línea');
    expect(r.lineas[0].tag).toBe('IMDM,10000001');
  });
  it('una celda gigante en caseta o TAG se acota (no viaja entera a la base ni al CSV de salida)', async () => {
    const csv = `Fecha,Caseta,Importe,Tag\n05/08/2026,${'C'.repeat(50_000)},189.00,${'T'.repeat(50_000)}\n`;
    const r = await parsearArchivoDesglose('x.csv', Buffer.from(csv));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0].caseta).toHaveLength(120);
    expect(r.lineas[0].tag).toHaveLength(60);
  });
  it('un XML se redirige al camino del CFDI consolidado', async () => {
    const r = await parsearArchivoDesglose('cfdi.xml', Buffer.from('<x/>'));
    expect(r.ok).toBe(false);
  });
  it('una extensión desconocida se rechaza diciendo cuáles sí', async () => {
    const r = await parsearArchivoDesglose('foto.png', Buffer.from('x'));
    expect(r.ok).toBe(false);
  });
});
