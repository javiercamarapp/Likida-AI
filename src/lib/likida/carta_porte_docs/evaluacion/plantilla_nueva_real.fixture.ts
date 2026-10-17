// Generador SINTÉTICO de la plantilla «nueva» del TMS con la FORMA real (análisis 17 §1.3): ni un valor de las muestras.
//
// Se escribe a mano, con coordenadas literales y SIN importar el layout, para contrastar el layout contra la forma real.
//   · `plantillaNuevaEnBlanco()`: 5 hojas (Datos, Origenes, Destinos, Mercancias, Guia de Llenado) con solo encabezados y
//     una Guía de llenado genérica (campo, tipo, Obligatorio/Opcional/Dependiente).
//   · `plantillaNuevaLlena()`: el caso real con valores inventados: UN embarcador con DOS razones sociales y el mismo
//     domicilio ⇒ 2 orígenes, 2 destinos idénticos, 2 mercancías (una por par) con fracciones de último dígito distinto.
//   · `verificarReglasGuiaNueva(bytes)`: las reglas de la Guía que se pueden comprobar sobre el libro (IDs únicos y existentes,
//     largos, > 0, dependencias). Devuelve la lista de incumplimientos (vacía = cumple).
import * as XLSX from 'xlsx';
import { rfcValido } from '../documentos_sinteticos.fixture';

export const RFC_ORIGEN_SINTETICO = rfcValido('AAA010101XXX'); // grep-limpio:ok
export const RFC_DESTINO_SINTETICO = rfcValido('XEXX010101XXX'); // grep-limpio:ok

export const HOJAS_NUEVA = ['Datos', 'Origenes', 'Destinos', 'Mercancias', 'Guia de Llenado'] as const;

export const ENCABEZADOS_DATOS = ['Regimen Aduanero', 'Referencia Interna Cliente', 'Cliente', 'Numero de Caja'] as const;
export const ENCABEZADOS_ORIGENES = ['ID Origen', 'Razon Social', 'RFC', 'Calle', 'Num Int', 'Num Ext', 'Clave Colonia', 'CP', 'Clave Localidad', 'Clave Municipio', 'Clave Estado', 'Pais'] as const;
export const ENCABEZADOS_DESTINOS = ['ID Destino', 'Distancia', 'Razon Social', 'RFC', 'Calle', 'Num Ext', 'Num Int', 'Clave Colonia', 'Colonia', 'CP',
  'Clave Localidad', 'Localidad', 'Clave Municipio', 'Municipio', 'Clave Estado', 'Estado', 'Pais', 'Contacto', 'Telefono', 'Correo'] as const;
export const ENCABEZADOS_MERCANCIAS_NUEVA = ['ID Destino', 'ID Origen', 'Bienes Transportados', 'Descripcion', 'Cantidad', 'Clave Unidad', 'Unidad', 'Embalaje',
  'Descripcion del embalaje', 'Peso en Kilogramos', 'Fraccion Arancelaria', 'Numero de Pedimento', 'Material Peligroso', 'Clave Material Peligroso',
  'Tipo de Materia', 'Descripcion de la Materia', 'RFC Importador'] as const;

const GUIA: Array<[string, string, string]> = [
  ['Numero de Caja', 'Texto (max 15)', 'Obligatorio'], ['Referencia Interna Cliente', 'Texto (max 30)', 'Opcional'],
  ['ID Origen', 'OR + 6 digitos, unico y existente', 'Obligatorio'], ['ID Destino', 'DE + 6 digitos, unico y existente', 'Obligatorio'],
  ['Embalaje', 'Clave SAT', 'Dependiente: solo si Material Peligroso = Si'], ['Numero de Pedimento', 'Texto', 'Dependiente: solo en importacion'],
];

type Hoja = Array<Array<string | number>>;
const libro = (hojas: Record<string, Hoja>): Uint8Array => {
  const wb = XLSX.utils.book_new();
  for (const [n, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

export function plantillaNuevaEnBlanco(): Uint8Array {
  return libro({
    Datos: [[...ENCABEZADOS_DATOS]], Origenes: [[...ENCABEZADOS_ORIGENES]], Destinos: [[...ENCABEZADOS_DESTINOS]],
    Mercancias: [[...ENCABEZADOS_MERCANCIAS_NUEVA]], 'Guia de Llenado': [['Campo', 'Tipo', 'Regla'], ...GUIA],
  });
}

/** Origen sintético N (1 o 2): dos razones sociales con el mismo domicilio. */
const origen = (n: number): Array<string | number> => [`OR00000${n}`, `Embarcador Sintetico ${n === 1 ? 'Uno' : 'Dos'} SA`, RFC_ORIGEN_SINTETICO, 'Calle Uno', '', '10', '0001', '44100', '01', '039', 'JAL', 'MEX'];
const destino = (n: number): Array<string | number> => [`DE00000${n}`, 874, 'Destino Sintetico LLC', RFC_DESTINO_SINTETICO, 'Street Two', '20', '', '', 'Zona Dos', '78040', '', 'Ciudad Dos', '', 'Condado Dos', 'NLE', 'Nuevo León', 'USA', '', '', ''];

export function plantillaNuevaLlena(): Uint8Array {
  return libro({
    Datos: [[...ENCABEZADOS_DATOS], ['EXD', 'LP-0001', 123, 'CAJA-0001']],
    Origenes: [[...ENCABEZADOS_ORIGENES], origen(1), origen(2)],
    Destinos: [[...ENCABEZADOS_DESTINOS], destino(1), destino(2)],
    Mercancias: [[...ENCABEZADOS_MERCANCIAS_NUEVA],
      ['DE000001', 'OR000001', '43211500', 'Equipo de computo', 20, 'H87', 'Pieza', '', '', 14130, '8471500100', '', 'No', '', '05', 'Materia sintetica', ''], // grep-limpio:ok
      ['DE000002', 'OR000002', '43211500', 'Equipo de computo', 10, 'H87', 'Pieza', '', '', 7000, '8471500101', '', 'No', '', '05', 'Materia sintetica', '']], // grep-limpio:ok
    'Guia de Llenado': [['Campo', 'Tipo', 'Regla'], ...GUIA],
  });
}

const celdaTxt = (ws: XLSX.WorkSheet | undefined, a1: string): string => { const v = ws?.[a1]?.v; return v === undefined || v === null ? '' : String(v); };

/** Filas de datos de una hoja con encabezado en la fila 1, como objetos por letra de columna (solo filas con algún valor). */
export function filasDeHoja(ws: XLSX.WorkSheet | undefined): Array<{ fila: number; c: Record<string, string> }> {
  if (!ws?.['!ref']) return [];
  const r = XLSX.utils.decode_range(ws['!ref']);
  const out: Array<{ fila: number; c: Record<string, string> }> = [];
  for (let i = 1; i <= r.e.r; i++) {
    const c: Record<string, string> = {};
    for (let j = 0; j <= r.e.c; j++) { const l = XLSX.utils.encode_col(j); const v = celdaTxt(ws, `${l}${i + 1}`); if (v !== '') c[l] = v; }
    if (Object.keys(c).length > 0) out.push({ fila: i + 1, c });
  }
  return out;
}

/** Reglas de la Guía (sintética) comprobables sobre el libro. Vacío = cumple. */
export function verificarReglasGuiaNueva(bytes: Uint8Array): string[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const malas: string[] = [];
  const datos = wb.Sheets.Datos;
  const caja = celdaTxt(datos, 'D2'); const ref = celdaTxt(datos, 'B2'); const cliente = celdaTxt(datos, 'C2');
  if (caja === '' || caja.length > 15) malas.push('Datos!D2: la caja es obligatoria y de máximo 15 caracteres');
  if (ref.length > 30) malas.push('Datos!B2: la referencia admite máximo 30 caracteres');
  if (cliente === '' || !/^\d+$/.test(cliente)) malas.push('Datos!C2: el cliente es un número entero');
  const unicos = (hoja: string, prefijo: string): Set<string> => {
    const ids = new Set<string>();
    for (const { fila, c } of filasDeHoja(wb.Sheets[hoja])) {
      const id = c.A ?? '';
      if (!new RegExp(`^${prefijo}\\d{6}$`).test(id)) malas.push(`${hoja}!A${fila}: «${id}» no es ${prefijo} + 6 dígitos`);
      else if (ids.has(id)) malas.push(`${hoja}!A${fila}: ID repetido ${id}`);
      ids.add(id);
    }
    return ids;
  };
  const origenes = unicos('Origenes', 'OR');
  const destinos = unicos('Destinos', 'DE');
  const importacion = new Set(['IMD', 'ITR', 'ITE', 'DFI', 'RFE']);
  const regimen = celdaTxt(datos, 'A2');
  for (const { fila, c } of filasDeHoja(wb.Sheets.Mercancias)) {
    const donde = (l: string) => `Mercancias!${l}${fila}`;
    if (!destinos.has(c.A ?? '')) malas.push(`${donde('A')}: el ID Destino «${c.A ?? ''}» no existe en Destinos`);
    if (!origenes.has(c.B ?? '')) malas.push(`${donde('B')}: el ID Origen «${c.B ?? ''}» no existe en Origenes`);
    if (!(Number(c.E) > 0)) malas.push(`${donde('E')}: la cantidad debe ser mayor que 0`);
    if (!(Number(c.J) > 0)) malas.push(`${donde('J')}: el peso debe ser mayor que 0`);
    if (/[^A-Za-z0-9 ]/.test(c.D ?? '')) malas.push(`${donde('D')}: la descripción no admite caracteres especiales`);
    const peligroso = (c.M ?? 'No') === 'Sí';
    if (!peligroso && (c.H || c.I)) malas.push(`${donde('H')}: embalaje solo si es material peligroso`);
    if (!importacion.has(regimen) && (c.L || c.Q)) malas.push(`${donde('L')}: pedimento y RFC importador solo en importación`);
    if (c.O === '05' && !c.P) malas.push(`${donde('P')}: tipo de materia 05 exige descripción`);
  }
  return malas;
}
