// ═══════════════════════════════════════════════════════════════════════════
// GENERADOR DE FIXTURES SINTÉTICOS con la FORMA del estado de cuenta decenal de
// un proveedor de telepeaje (el que el cliente sube «tal cual»), sin un solo dato real:
//
//   · hoja principal con cabeceras CON espacios al final («Clave de Red », «Tarjeta IDMX »,
//     «No. economico », «Fecha de cruce », «Hora de cruce », «Clase », «Nombre de caseta »,
//     «Importe al 100% », «Importe facturado »…);
//   · fecha como SERIAL de Excel y hora como FRACCIÓN de día, en columnas separadas;
//   · 5 columnas SIN encabezado con datos (que el lector debe ignorar y avisar);
//   · la unidad como número, «TC####» o «CAMIONETA»; los nombres de caseta rellenos con
//     espacios a ancho fijo;
//   · UNA hoja secundaria («Hoja1») con filas REPETIDAS de la principal y una fila de total:
//     leerla duplicaría cruces.
//
// Es DETERMINISTA (misma semilla → mismo libro) y devuelve la VERDAD (`esperado`) para que
// las pruebas comparen el lector contra cifras que el generador conoce de antemano.
// Se usa desde las pruebas y desde `scripts/generar-fixture-peajes.mjs` (que lo escribe a disco).
// Los nombres de casetas, TAGs y unidades son INVENTADOS; ninguna coincide con un archivo real.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';

export interface OpcionesFixtureIave {
  /** Cuántos cruces de la hoja principal (default 9 000). */
  filas?: number;
  /** Primer día del periodo (ISO), default 2026-03-01. El periodo dura 10 días. */
  inicio?: string;
  /** Cuántos cruces extemporáneos (fecha anterior al inicio del periodo). Default 40. */
  extemporaneos?: number;
  /** Cuántos pares de renglones idénticos (mismo TAG, segundo, caseta e importe) inyectar. Default 0. */
  duplicadosExactos?: number;
  /** ¿Agregar la hoja secundaria con filas repetidas? Default true. */
  hojaSecundaria?: boolean;
  /** Semilla del generador pseudoaleatorio. */
  semilla?: number;
  /** Nombre de la hoja principal. */
  nombreHoja?: string;
  /** Número de periodo del proveedor (consecutivo). */
  noPeriodo?: number;
}

export interface EsperadoFixtureIave {
  cruces: number;
  /** Suma del importe facturado en pesos (entera: los importes del generador son enteros). */
  monto: number;
  extemporaneos: number;
  montoExtemporaneos: number;
  duplicadosExactos: number;
  porClase: Record<string, number>;
  unidades: number;
  inicio: string;
  fin: string;
}

export const ENCABEZADOS_IAVE = [
  'Clave de Red ', ' Clave de Fideicomiso ', ' No. de periodo ', ' Tipo de periodo ', ' Clave de empresa ', ' Tarjeta IDMX ',
  ' No. economico ', ' Fecha de cruce ', ' Hora de cruce ', ' Clase ', ' Nombre de caseta ', ' Nombre de carril ',
  ' Importe al 100% ', ' Importe facturado ', '', '', '', '', '',
] as const;

/** Casetas INVENTADAS. Las dos primeras cobran por pasada (clase 1) en el fixture. */
export const CASETAS_FIXTURE = [
  { nombre: 'CASETA PASADA UNO', tarifa: 180, porPasada: true },
  { nombre: 'CASETA PASADA DOS', tarifa: 95, porPasada: true },
  { nombre: 'CASETA EJEMPLO NORTE', tarifa: 240, porPasada: false },
  { nombre: 'CASETA EJEMPLO SUR', tarifa: 310, porPasada: false },
  { nombre: 'PLAZA ORIENTE', tarifa: 130, porPasada: false },
  { nombre: 'PLAZA PONIENTE', tarifa: 205, porPasada: false },
  { nombre: 'LIBRAMIENTO CENTRO', tarifa: 88, porPasada: false },
  { nombre: 'PUENTE DEL VALLE', tarifa: 420, porPasada: false },
] as const;

/** PRNG determinista (mulberry32). */
function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO → serial de Excel (días desde 1899-12-30). */
export function serialExcel(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const pad = (s: string, n: number) => s.padEnd(n, ' ');

export function generarFilasIave(op: OpcionesFixtureIave = {}): { filas: Array<Array<string | number>>; esperado: EsperadoFixtureIave } {
  const n = op.filas ?? 9000;
  const inicio = op.inicio ?? '2026-03-01';
  const fin = sumarDias(inicio, 9);
  const extem = Math.min(op.extemporaneos ?? 40, n);
  const dups = op.duplicadosExactos ?? 0;
  const noPeriodo = op.noPeriodo ?? 801;
  const r = prng(op.semilla ?? 7);

  // 60 vehículos inventados: números económicos, «TC####» y una «CAMIONETA».
  const vehiculos = Array.from({ length: 60 }, (_, i) => ({
    tag: `IMDM9${String(1000000 + i * 37).padStart(7, '0')}..`,
    unidad: i < 30 ? 100 + i : i < 59 ? `TC${String(2000 + i).padEnd(4, ' ')}`.padEnd(10, ' ') : 'CAMIONETA',
  }));

  const filas: Array<Array<string | number>> = [[...ENCABEZADOS_IAVE]];
  const claseDe = (c: (typeof CASETAS_FIXTURE)[number]): number => {
    if (c.porPasada) return 1;
    const x = r();
    if (x < 0.82) return 5;
    if (x < 0.92) return 3;
    if (x < 0.95) return 2;
    if (x < 0.97) return 4;
    if (x < 0.985) return 6;
    return 9;
  };

  const porClase: Record<string, number> = {};
  let monto = 0;
  let montoExtem = 0;
  const unidades = new Set<string>();
  const datos: Array<{ fila: Array<string | number>; fecha: string }> = [];
  for (let i = 0; i < n; i++) {
    const esExt = i < extem;
    const dia = esExt ? -1 - Math.floor(r() * 12) : Math.floor(r() * 10);
    const fecha = sumarDias(inicio, dia);
    const v = vehiculos[Math.floor(r() * vehiculos.length)];
    const c = CASETAS_FIXTURE[Math.floor(r() * CASETAS_FIXTURE.length)];
    const clase = claseDe(c);
    const importe = Math.round(c.tarifa * (clase === 1 ? 1 : clase === 3 ? 0.55 : clase === 5 ? 1 : 1.3));
    const hora = r(); // fracción de día
    porClase[String(clase)] = (porClase[String(clase)] ?? 0) + 1;
    monto += importe;
    if (esExt) montoExtem += importe;
    unidades.add(String(v.unidad).trim());
    datos.push({
      fecha,
      fila: [
        0, 6, noPeriodo, 'I', 99001, v.tag, v.unidad, serialExcel(fecha), hora, clase,
        pad(c.nombre, 20), pad(`${c.nombre} ${1 + Math.floor(r() * 6)}`, 20), importe, importe,
        // 5 columnas sin encabezado, con datos (códigos internos del proveedor)
        100 + (i % 97), 0, 999, `${100 + (i % 97)}C1`, i % 7 === 0 ? 'G41' : 600 + (i % 13),
      ],
    });
  }
  // Duplicados exactos: copia idéntica de los primeros no extemporáneos (mismo TAG, segundo, caseta, importe).
  let extra = 0;
  let montoDup = 0;
  for (let d = 0; d < dups; d++) {
    const original = datos[extem + d]?.fila;
    if (!original) break;
    datos.push({ fila: [...original], fecha: datos[extem + d].fecha });
    extra++;
    montoDup += Number(original[13]);
  }
  // Orden por fecha y hora (como el archivo real) — estable.
  datos.sort((a, b) => (Number(a.fila[7]) - Number(b.fila[7])) || (Number(a.fila[8]) - Number(b.fila[8])));
  for (const d of datos) filas.push(d.fila);

  return {
    filas,
    esperado: {
      cruces: n + extra, monto: monto + montoDup, extemporaneos: extem, montoExtemporaneos: montoExtem, duplicadosExactos: extra,
      porClase: extra > 0 ? recontar(datos.map((d) => d.fila)) : porClase, unidades: unidades.size, inicio, fin,
    },
  };
}

function recontar(filas: Array<Array<string | number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filas) out[String(f[9])] = (out[String(f[9])] ?? 0) + 1;
  return out;
}

/** El libro completo (xlsx) listo para subir «tal cual». */
export function generarLibroIave(op: OpcionesFixtureIave = {}): { buffer: Buffer; esperado: EsperadoFixtureIave } {
  const { filas, esperado } = generarFilasIave(op);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), op.nombreHoja ?? 'g00I99001.801');
  if (op.hojaSecundaria !== false) {
    // La hoja secundaria REPITE filas de la principal (las primeras 60) y trae una fila de total sin fecha.
    const repetidas = filas.slice(1, 61);
    const total = ['', '', '', '', '', '', '', '', '', '', '', '', repetidas.reduce((s, f) => s + Number(f[13]), 0), repetidas.reduce((s, f) => s + Number(f[13]), 0)];
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([filas[0], ...repetidas, total]), 'Hoja1');
  }
  const buffer = Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx', compression: true }));
  return { buffer, esperado };
}
