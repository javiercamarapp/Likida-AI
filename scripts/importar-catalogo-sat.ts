// Importa un catálogo SAT de Carta Porte a `cp_sat_catalogo` (migración 0793) desde un archivo LOCAL.
//
//   npx tsx scripts/importar-catalogo-sat.ts <archivo.xls|.xlsx|.csv> [--catalogo c_ClaveProdServCP]
//
// · Lee SOLO el archivo que se le pasa (el catálogo oficial del SAT o la exportación del TMS). Nunca descarga
//   nada de la red.
// · El nombre del catálogo sale de la primera columna del encabezado oficial (c_ClaveProdServCP, c_Pais…);
//   `--catalogo` lo fija a mano si el archivo no trae encabezado `c_…`.
// · Carga por lotes de 1 000 con upsert por (catalogo, clave): reimportar el mismo archivo no duplica.
// · Filas con la clave vacía se RECHAZAN (se cuentan y se listan con su número de fila); las demás se cargan.
// · Imprime el conteo por catálogo. Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
import { existsSync, readFileSync } from 'node:fs';
import { read as leerLibro, utils as xlsxUtils } from 'xlsx';

export const TAMANO_LOTE = 1000;

export interface FilaCatalogo {
  catalogo: string;
  clave: string;
  descripcion: string;
  extra: Record<string, string>;
  vigente_desde: string | null;
  vigente_hasta: string | null;
}

export interface Rechazo { fila: number; motivo: string }

export interface ResultadoLectura {
  catalogo: string;
  filas: FilaCatalogo[];
  rechazos: Rechazo[];
}

/** Destino de la carga. En producción es Supabase (service_role); en pruebas, un arreglo en memoria. */
export interface DestinoCatalogo {
  upsert(lote: FilaCatalogo[]): Promise<void>;
}

export class ErrorImportacion extends Error {}

const NOMBRE_CATALOGO = /^c_[A-Za-z0-9_]{1,60}$/;

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** dd/mm/yyyy, yyyy-mm-dd (con o sin hora) o fecha de Excel ya convertida → yyyy-mm-dd; vacío → null. */
export function normalizarFecha(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  const t = String(valor ?? '').trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function esColumnaVigenciaInicio(h: string): boolean {
  const n = sinAcentos(h);
  return n.startsWith('fecha inicio') || n.startsWith('fecha de inicio');
}
function esColumnaVigenciaFin(h: string): boolean {
  const n = sinAcentos(h);
  return n.startsWith('fecha fin') || n.startsWith('fecha de fin');
}

/**
 * Convierte una matriz (filas × columnas) en filas de catálogo. El encabezado es la primera fila cuya primera
 * celda empieza con `c_` (el archivo oficial trae renglones de título arriba); si no hay, se exige `catalogoForzado`
 * y la primera fila es el encabezado.
 */
export function filasDesdeMatriz(matriz: unknown[][], catalogoForzado?: string): ResultadoLectura {
  let idxEnc = matriz.findIndex((f) => /^c_/i.test(String(f?.[0] ?? '').trim()));
  if (idxEnc < 0) {
    if (!catalogoForzado) {
      throw new ErrorImportacion(
        'No encontré el encabezado del catálogo (una primera columna llamada c_Algo, como c_ClaveProdServCP). ' +
          'Indica el catálogo con --catalogo c_NombreDelCatalogo.',
      );
    }
    idxEnc = 0;
  }
  const encabezado = (matriz[idxEnc] ?? []).map((c) => String(c ?? '').trim());
  const catalogo = (catalogoForzado ?? encabezado[0]).trim();
  if (!NOMBRE_CATALOGO.test(catalogo)) {
    throw new ErrorImportacion(`El nombre de catálogo «${catalogo}» no es válido: debe empezar con c_ y llevar solo letras, números o guion bajo.`);
  }

  const idxDesc = encabezado.findIndex((h, i) => i > 0 && /^descripci[oó]n$/i.test(h));
  const idxDesde = encabezado.findIndex(esColumnaVigenciaInicio);
  const idxHasta = encabezado.findIndex(esColumnaVigenciaFin);
  const idxDescripcion = idxDesc >= 0 ? idxDesc : (encabezado.length > 1 ? 1 : -1);

  const filas = new Map<string, FilaCatalogo>();
  const rechazos: Rechazo[] = [];
  for (let i = idxEnc + 1; i < matriz.length; i++) {
    const celdas = matriz[i] ?? [];
    if (celdas.every((c) => String(c ?? '').trim() === '')) continue; // renglón en blanco
    const numeroFila = i + 1;
    const clave = String(celdas[0] ?? '').trim();
    if (!clave) { rechazos.push({ fila: numeroFila, motivo: 'clave vacía' }); continue; }
    if (clave.length > 40) { rechazos.push({ fila: numeroFila, motivo: 'clave de más de 40 caracteres' }); continue; }

    const desde = idxDesde >= 0 ? normalizarFecha(celdas[idxDesde]) : null;
    const hasta = idxHasta >= 0 ? normalizarFecha(celdas[idxHasta]) : null;
    if (desde && hasta && hasta < desde) { rechazos.push({ fila: numeroFila, motivo: 'vigencia fin anterior al inicio' }); continue; }

    const extra: Record<string, string> = {};
    encabezado.forEach((h, c) => {
      if (c === 0 || c === idxDescripcion || c === idxDesde || c === idxHasta || !h) return;
      const v = String(celdas[c] ?? '').trim();
      if (v) extra[h] = v;
    });
    const descripcion = idxDescripcion >= 0 ? String(celdas[idxDescripcion] ?? '').trim().slice(0, 1000) : '';

    // Si la clave se repite en el archivo gana la última fila (la PK es (catalogo, clave)).
    filas.set(clave, { catalogo, clave, descripcion, extra, vigente_desde: desde, vigente_hasta: hasta });
  }
  return { catalogo, filas: [...filas.values()], rechazos };
}

/** Lee un .xls/.xlsx/.csv local. Falla con un mensaje llano si el archivo no existe. */
export function leerArchivoCatalogo(ruta: string, catalogoForzado?: string): ResultadoLectura {
  if (!ruta) throw new ErrorImportacion('Falta el archivo. Uso: npx tsx scripts/importar-catalogo-sat.ts <archivo.xls|.xlsx|.csv>');
  if (!existsSync(ruta)) throw new ErrorImportacion(`No existe el archivo «${ruta}». Revisa la ruta; el importador solo lee archivos locales.`);
  let libro;
  try {
    // Un CSV se decodifica como UTF-8 a mano: leído como buffer, xlsx lo toma por Latin-1 y rompe los acentos.
    libro = /\.csv$/i.test(ruta)
      ? leerLibro(readFileSync(ruta, 'utf8').replace(/^\uFEFF/, ''), { type: 'string', cellDates: true })
      : leerLibro(readFileSync(ruta), { type: 'buffer', cellDates: true });
  } catch {
    throw new ErrorImportacion(`No pude leer «${ruta}» como hoja de cálculo o CSV.`);
  }
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new ErrorImportacion(`El archivo «${ruta}» no tiene hojas.`);
  const matriz = xlsxUtils.sheet_to_json(hoja, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' }) as unknown[][];
  return filasDesdeMatriz(matriz, catalogoForzado);
}

/** Carga por lotes de TAMANO_LOTE. Devuelve cuántas filas envió. */
export async function cargarCatalogo(filas: FilaCatalogo[], destino: DestinoCatalogo): Promise<number> {
  let enviadas = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    await destino.upsert(lote);
    enviadas += lote.length;
  }
  return enviadas;
}

export async function importarCatalogo(
  ruta: string,
  destino: DestinoCatalogo,
  catalogoForzado?: string,
): Promise<{ catalogo: string; cargadas: number; rechazos: Rechazo[] }> {
  const { catalogo, filas, rechazos } = leerArchivoCatalogo(ruta, catalogoForzado);
  const cargadas = await cargarCatalogo(filas, destino);
  return { catalogo, cargadas, rechazos };
}

async function destinoSupabase(): Promise<DestinoCatalogo> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) {
    throw new ErrorImportacion('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno; no hay a dónde cargar.');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const cliente = createClient(url, llave, { auth: { persistSession: false } });
  return {
    async upsert(lote) {
      const { error } = await cliente.from('cp_sat_catalogo').upsert(lote, { onConflict: 'catalogo,clave' });
      if (error) throw new ErrorImportacion(`Supabase rechazó el lote: ${error.message}`);
    },
  };
}

async function principal(argv: string[]): Promise<number> {
  const ruta = argv.find((a) => !a.startsWith('--'));
  const i = argv.indexOf('--catalogo');
  const catalogo = i >= 0 ? argv[i + 1] : undefined;
  try {
    // Se valida el archivo ANTES de pedir credenciales: un archivo que no existe es el error más común.
    const lectura = leerArchivoCatalogo(ruta ?? '', catalogo);
    const destino = await destinoSupabase();
    const cargadas = await cargarCatalogo(lectura.filas, destino);
    console.log(`${lectura.catalogo}: ${cargadas} filas cargadas, ${lectura.rechazos.length} rechazadas`);
    for (const r of lectura.rechazos) console.log(`  fila ${r.fila}: ${r.motivo}`);
    return 0;
  } catch (e) {
    console.error(e instanceof ErrorImportacion ? e.message : `Error inesperado: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && /importar-catalogo-sat\.ts$/.test(process.argv[1])) {
  principal(process.argv.slice(2)).then((c) => process.exit(c));
}
