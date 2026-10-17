// ═══════════════════════════════════════════════════════════════════════════
// PROGRAMA DE DESPACHO SINTÉTICO PARA EL DEMO DEL VIGÍA (A4).
//
// Lo que se enseña: el aviso proactivo al cliente, que sale del programa de despacho con la regla provisional
// («proxy»: CAJA + UNIDAD + CCP en listo/despachado) y que va a SERVICIO AL CLIENTE cuando falta un dato.
// Todo está SIMULADO y rotulado así en la columna COMENTARIOS; clientes y claves son inventados.
//
// Es la misma forma que escribe `vigia/programa/fixtures.ts` (títulos de sección, encabezados repetidos,
// «;», fecha dentro del título) pero con filas escritas A MANO, porque el guion necesita casos exactos
// (el generador aleatorio no garantiza cuáles quedan listos). Lo lee el lector real del Vigía.
//
// `construirProgramaDemo(1)` es el archivo `programa/programa_despacho_sintetico.csv` de la muestra (se genera con
// `scripts/demo/cinco-agentes/generar-programa-sintetico.mjs`; una prueba exige que sean idénticos).
// `construirProgramaDemo(2)` es el segundo corte del día: la unidad de una caja ya lista cambia (el guion lo hace
// en vivo al volver a subir el archivo, para enseñar el reenvío «actualización»).
// SOLO demo y pruebas: no se importa desde código de producción.
// ═══════════════════════════════════════════════════════════════════════════

import { ENCABEZADOS_PROGRAMA } from '../vigia/programa/fixtures';

/** Martes 20 de octubre de 2026 (día del demo). */
export const FECHA_PROGRAMA_DEMO = '2026-10-20';
const COLUMNAS = 25;
const TERMINAL = 'GDL';

interface CasoDemo {
  tipo: 'IMPO' | 'EXPO';
  origenDestino: string;
  cliente: string;
  caja: string;
  unidad: string;
  cita: string;
  transito: string;
  ccp: string;
  /** Qué enseña la fila (va en COMENTARIOS, junto al rótulo SIMULADO). */
  caso: string;
}

const CASOS: readonly CasoDemo[] = [
  { tipo: 'IMPO', origenDestino: 'NLD-GDL', cliente: 'CLIENTE SINT 01', caja: 'ZC1001', unidad: 'ZU2001', cita: '20/10/2026 14:00', transito: 'PATIO NLD', ccp: 'LISTO', caso: 'aviso listo' },
  { tipo: 'IMPO', origenDestino: 'MTY-GDL', cliente: 'CLIENTE SINT 02', caja: 'ZC1002', unidad: 'ZU2002', cita: '20/10/2026 16:30', transito: 'EN RUTA', ccp: 'DESPACHADO', caso: 'aviso listo' },
  { tipo: 'IMPO', origenDestino: 'NLD-GDL', cliente: 'CLIENTE SINT 03', caja: 'ZC1003', unidad: 'ZU2003', cita: '20/10/2026 18:00', transito: 'PATIO NLD', ccp: 'PEND CCP', caso: 'incompleto: falta CCP' },
  { tipo: 'IMPO', origenDestino: 'JRZ-GDL', cliente: 'CLIENTE SINT 04', caja: 'ZC1004', unidad: 'ZU2004', cita: '20/10/2026 09:30', transito: 'PATIO NLD', ccp: 'LISTO', caso: 'cambio de unidad en el segundo corte' },
  { tipo: 'IMPO', origenDestino: 'MTY-GDL', cliente: 'CLIENTE SINT 05', caja: '', unidad: 'ZU2005', cita: '20/10/2026 11:00', transito: 'PATIO NLD', ccp: 'LISTO', caso: 'sin caja: no se avisa (si el cliente pregunta, escala a servicio al cliente)' },
  { tipo: 'EXPO', origenDestino: 'GDL-NLD', cliente: 'CLIENTE SINT 01', caja: 'ZC1006', unidad: '', cita: '20/10/2026 15:00', transito: 'PATIO NLD', ccp: 'LISTO', caso: 'sin unidad: no se avisa' },
];

const fila = (celdas: string[]): string => `${celdas.join(';')}${';'.repeat(Math.max(0, COLUMNAS - celdas.length))}`;

export function construirProgramaDemo(corte: 1 | 2 = 1): string {
  const casos = CASOS.map((c) => (corte === 2 && c.caja === 'ZC1004' ? { ...c, unidad: 'ZU2099' } : c));
  const lineas: string[] = [];
  let n = 0;
  for (const tipo of ['IMPO', 'EXPO'] as const) {
    const delTipo = casos.filter((c) => c.tipo === tipo);
    lineas.push(fila([tipo === 'IMPO'
      ? `IMPORTACION MARTES 20 DE OCTUBRE 2026 /// ${delTipo.length} UNIDADES DISPONIBLES // SALEN HOY`
      : 'EXPORTACION MARTES 20 DE OCTUBRE 2026']));
    lineas.push(fila([...ENCABEZADOS_PROGRAMA]));
    for (const c of delTipo) {
      n++;
      lineas.push(fila([String(n), TERMINAL, c.tipo, c.origenDestino, c.cliente, 'CONSIG SINT A', 'LNA', c.caja, `SIMULADO · ${c.caso}`, c.cita, '', c.unidad, '', c.transito, c.ccp, '', '']));
    }
  }
  return `${lineas.join('\n')}\n`;
}
