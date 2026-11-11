import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ErrorLectorPrograma, leerProgramaCsv } from '@/lib/likida/vigia/programa/lector';
import { normalizarPrograma } from '@/lib/likida/vigia/programa/normalizar';
import { derivarEstatusImportacion, estatusACsv } from '@/lib/likida/vigia/importacion/derivar';
import { sufijoTenant } from '../../../sufijo';
import { VistaImportacionVigia, TOPE_ARCHIVO_IMPORTACION_BYTES, type ResultadoImportacion } from './vista';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('agentes');
  return { title: t('rest.estatus_de_importacion') };
}

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
  const { t: tx } = await getT('agentes');
  const terminal = String(fd.get('terminal') ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!TERMINAL_VALIDA.test(terminal)) return error(tx('rest.escribe_la_terminal_con_su_codigo'));

  const archivo = fd.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return error(tx('rest.elige_el_archivo_del_programa_csv'));
  if (archivo.size > TOPE_ARCHIVO_IMPORTACION_BYTES) {
    return error(tx('rest.el_archivo_pesa_mas_de_mb_2', { v: TOPE_ARCHIVO_IMPORTACION_BYTES / (1024 * 1024) }));
  }
  if (/\.(xlsx|xlsm|xls)$/i.test(archivo.name)) {
    return error(tx('rest.los_archivos_de_excel_xlsx_todavia'));
  }

  const texto = decodificar(new Uint8Array(await archivo.arrayBuffer()));
  let lector;
  try {
    lector = leerProgramaCsv(texto, { terminal });
  } catch (e) {
    if (e instanceof ErrorLectorPrograma) {
      return error(/encabezados/.test(e.message) ? tx('rest.el_archivo_no_parece_un_programa', { message: e.message }) : e.message);
    }
    throw e;
  }
  const normalizado = normalizarPrograma(lector);
  if (normalizado.filas.length === 0) {
    return error(tx('rest.el_archivo_no_parece_un_programa_2'));
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
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const { rol, tenantId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  async function calcularAccion(_p: ResultadoImportacion, fd: FormData): Promise<ResultadoImportacion> {
    'use server';
    const { t: tx } = await getT('agentes');
    // La sesión se vuelve a resolver aquí: la acción no confía en lo que decidió el render.
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return error(tx('rest.no_tienes_permiso_para_ver_esta'));
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
