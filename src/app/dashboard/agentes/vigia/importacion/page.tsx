import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ErrorLectorPrograma, leerProgramaCsv } from '@/lib/likida/vigia/programa/lector';
import { normalizarPrograma } from '@/lib/likida/vigia/programa/normalizar';
import { derivarEstatusImportacion, estatusACsv } from '@/lib/likida/vigia/importacion/derivar';
import { sufijoTenant } from '../../../sufijo';
import { VistaImportacionVigia, TOPE_ARCHIVO_IMPORTACION_BYTES, type ResultadoImportacion } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia/importacion';

const MAX_DETALLE = 20;
const TERMINAL_VALIDA = /^[A-Z0-9][A-Z0-9 _-]{0,39}$/;

type Busqueda = { vista?: string; tenant?: string; rol?: string };

/** UTF-8; si el archivo no lo es (un Excel guardado como CSV en Windows), Windows-1252. */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const error = (texto: string): ResultadoImportacion => ({ ok: false, error: texto });

/** Lee el programa subido y calcula el estatus. No guarda nada: no toca la base ni ningún sistema externo. */
async function calcular(fd: FormData): Promise<ResultadoImportacion> {
  const terminal = String(fd.get('terminal') ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!TERMINAL_VALIDA.test(terminal)) return error('Escribe la terminal con su código corto, por ejemplo GDL (letras y números, hasta 40).');

  const archivo = fd.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return error('Elige el archivo del programa (CSV).');
  if (archivo.size > TOPE_ARCHIVO_IMPORTACION_BYTES) {
    return error(`El archivo pesa más de ${TOPE_ARCHIVO_IMPORTACION_BYTES / (1024 * 1024)} MB. Sube solo el programa de los últimos días.`);
  }
  if (/\.(xlsx|xlsm|xls)$/i.test(archivo.name)) {
    return error('Los archivos de Excel (.xlsx) todavía no se pueden leer. En Excel usa «Guardar como» y elige CSV, y vuelve a subirlo.');
  }

  const texto = decodificar(new Uint8Array(await archivo.arrayBuffer()));
  let lector;
  try {
    lector = leerProgramaCsv(texto, { terminal });
  } catch (e) {
    if (e instanceof ErrorLectorPrograma) {
      return error(/encabezados/.test(e.message) ? `El archivo no parece un programa de despacho. ${e.message}` : e.message);
    }
    throw e;
  }
  const normalizado = normalizarPrograma(lector);
  if (normalizado.filas.length === 0) {
    return error('El archivo no parece un programa de despacho: no encontré ninguna fila con caja, unidad o cliente que pueda leer.');
  }

  const d = derivarEstatusImportacion(normalizado.filas);
  return {
    ok: true,
    resumen: {
      terminal,
      totalCajas: d.cajas.length,
      filasImportacion: d.filasImportacion,
      filasOtrasSecciones: d.filasOtrasSecciones,
      sinFecha: d.sinFecha,
      dias: d.dias,
      totalIncoherencias: d.incoherencias.length,
      incoherencias: d.incoherencias.slice(0, MAX_DETALLE),
      comparacion: d.comparacion,
      csv: estatusACsv(d.cajas),
    },
  };
}

/**
 * Tablero de estatus de importación del Vigía (Agente 4, T-A4-37): el estatus de cada caja derivado del programa del
 * día, rotulado como NO verificado contra Track & Trace. Cero pesos; solo lee el archivo, no guarda ni escribe afuera.
 */
export default async function PaginaImportacionVigia({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const { rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  async function calcularAccion(_p: ResultadoImportacion, fd: FormData): Promise<ResultadoImportacion> {
    'use server';
    // La sesión se vuelve a resolver aquí: la acción no confía en lo que decidió el render.
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return error('No tienes permiso para ver esta pantalla.');
    try {
      return await calcular(fd);
    } catch (e) {
      // Nunca el contenido del archivo en el log: solo el mensaje técnico.
      logger.error('vigia.importacion_calculo_fallo', { tenant: s.tenantId, err: e instanceof Error ? e.message : String(e) });
      return error(mensajeParaPantalla(e, 'leer el programa'));
    }
  }

  return <VistaImportacionVigia sufijo={sufijoTenant(sp)} accion={calcularAccion} />;
}
