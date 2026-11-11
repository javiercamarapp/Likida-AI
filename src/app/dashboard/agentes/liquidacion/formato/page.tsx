import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { logger } from '@/lib/logger';
import { dejarFlash, leerFlash } from '@/lib/likida/mensaje_flash';
import { DatoInvalido, mensajeParaPantalla } from '@/lib/likida/errores';
import { matrizDeArchivoCatalogo, MAX_CATALOGO_BYTES } from '@/lib/likida/peajes/archivo';
import { derivarFormatoDeMatriz } from '@/lib/likida/liquidacion_externa/formato_flota';
import { leerTelefonos, aplicarAjustes } from '@/lib/likida/liquidacion_externa/formato_form';
import {
  leerFormatoFlota, leerVersionFormato, guardarFormatoFlota, borrarFormatoFlota, leerTelefonosFlota, guardarTelefonosFlota,
  type ConfigFormatoFlota, type TelefonosFlota,
} from '@/lib/likida/liquidacion_externa/repo';
import { VistaFormatoLiquidacion } from './vista';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('agentes');
  return { title: t('rest.formato_de_las_liquidaciones') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/liquidacion/formato';

/** La puerta de TODA action: una action es un endpoint alcanzable por POST directo, no un botón.
 *  Guardar el formato y a quién se copia es administrar (dueño), no solo ver dinero. */
async function puerta(sp: { vista?: string; tenant?: string; rol?: string } | undefined, tenantId: string): Promise<{ por: string } | { error: string }> {
  const { t: tx } = await getT('agentes');
  const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerArea(sesion.rol, 'administracion')) return { error: tx('rest.solo_el_dueno_de_la_flota_4') };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: tx('rest.esta_configuracion_no_es_de_tu') };
  return { por: sesion.userId };
}

async function volver(sufijo: string, msg: string): Promise<never> {
  // A37-S13-08 / A37-S14-07: el mensaje viaja en una cookie de servidor, no como texto libre en la URL.
  await dejarFlash(RUTA, msg.startsWith('error:') ? { error: msg.slice(6) } : { aviso: msg });
  redirect(`${RUTA}${sufijo}`);
}

/**
 * El formato de las liquidaciones de la flota (Agente 1, modo «solo entrega»).
 * La flota calcula en su sistema; aquí se define CÓMO se ve lo que recibe el
 * operador (columnas y encabezados de «su formatito», derivados de un Excel de
 * muestra), qué documento viaja por WhatsApp, a quién se le manda copia y a
 * quién se avisa cuando un operador responde «No coincide».
 */
export default async function PaginaFormatoLiquidacion({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');
  const flash = await leerFlash(RUTA);

  // Primaria (sin `safe` mudo): si no se pudo leer, la pantalla lo dice; jamás «no hay formato».
  let config: ConfigFormatoFlota | null = null;
  let errorLectura: string | null = null;
  let telefonos: TelefonosFlota | null = null;
  try { [config, telefonos] = await Promise.all([leerFormatoFlota(tenantId), leerTelefonosFlota(tenantId)]); } catch (e) {
    logger.error('liqext.formato_pagina_lectura', { err: e instanceof Error ? e.message : String(e) });
    errorLectura = tx('rest.no_se_pudo_leer_el_formato');
  }

  async function accionSubirMuestra(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const p = await puerta(sp, tenantId);
    if ('error' in p) return volver(sufijo, `error:${p.error}`);
    const a = fd.get('archivo');
    if (!(a instanceof File) || a.size === 0) return volver(sufijo, tx('rest.error_elige_el_excel_de_muestra'));
    if (a.size > MAX_CATALOGO_BYTES) return volver(sufijo, tx('rest.error_ese_archivo_pesa_demasiado_para'));
    const matriz = matrizDeArchivoCatalogo(a.name, new Uint8Array(await a.arrayBuffer()));
    if (!matriz.ok) return volver(sufijo, `error:${matriz.motivo}`);
    const d = derivarFormatoDeMatriz(matriz.matriz);
    if (!d.ok) return volver(sufijo, `error:${d.motivo}`);
    try {
      // Los teléfonos pueden existir SIN formato (0645): se leen aparte, o subir la muestra los borraría.
      // A37-S14-10: la versión se lee ANTES que el resto; si otra persona guarda entretanto, el guardado se rechaza (no pisa).
      const version = await leerVersionFormato(tenantId);
      const [previa, previos] = await Promise.all([leerFormatoFlota(tenantId), leerTelefonosFlota(tenantId)]);
      await guardarFormatoFlota(tenantId, {
        formato: { ...d.formato, salida: previa?.formato.salida ?? d.formato.salida },
        nombreMuestra: a.name.slice(0, 200),
        copiaTelefonos: previos?.copia ?? [], discrepanciaTelefonos: previos?.discrepancia ?? [],
      }, p.por, version);
    } catch (e) {
      logger.error('liqext.formato_subir', { err: e instanceof Error ? e.message : String(e) });
      return volver(sufijo, e instanceof DatoInvalido ? `error:${e.message}` : tx('rest.error_no_se_pudo_guardar_el'));
    }
    const notas = [
      d.sinMapear.length > 0 ? tx('rest.no_reconoci_estas_columnas_y_no', { d: d.sinMapear.join(', ') }) : '',
      ...d.advertencias,
    ].filter(Boolean).join(' ');
    return volver(sufijo, tx('rest.formato_guardado_desde_columnas_revisalo_abajo', { name: a.name, length: d.formato.columnas.length, notas }).trim());
  }

  async function accionGuardarAjustes(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const p = await puerta(sp, tenantId);
    if ('error' in p) return volver(sufijo, `error:${p.error}`);
    let actual: ConfigFormatoFlota | null = null;
    let version: string | null = null;
    try { version = await leerVersionFormato(tenantId); actual = await leerFormatoFlota(tenantId); } catch (e) {
      return volver(sufijo, `error:${mensajeParaPantalla(e, 'leer el formato guardado')}`);
    }
    if (!actual) return volver(sufijo, tx('rest.error_primero_sube_el_excel_de'));
    const previo = actual;
    try {
      const lista = (prefijo: string, n: number): string[] => {
        const r: string[] = [];
        for (let i = 0; i < n; i++) r.push(String(fd.get(`${prefijo}${i}`) ?? ''));
        return r;
      };
      const formato = aplicarAjustes(previo.formato, {
        salida: String(fd.get('salida') ?? ''), fechas: String(fd.get('fechas') ?? ''),
        titulo: String(fd.get('titulo') ?? ''), mostrarTotal: fd.get('mostrarTotal') === 'on',
        etiquetaTotal: String(fd.get('etiquetaTotal') ?? ''),
        encabezados: lista('col_', previo.formato.columnas.length), etiquetasDatos: lista('dato_', previo.formato.datos.length),
      });
      await guardarFormatoFlota(tenantId, {
        formato, nombreMuestra: previo.nombreMuestra,
        copiaTelefonos: leerTelefonos(String(fd.get('copia') ?? ''), tx('rest.la_copia_al_jefe_de_flota')),
        discrepanciaTelefonos: leerTelefonos(String(fd.get('discrepancia') ?? ''), tx('rest.el_aviso_de_no_coincide')),
      }, p.por, version);
    } catch (e) {
      return volver(sufijo, `error:${mensajeParaPantalla(e, 'guardar el formato')}`);
    }
    return volver(sufijo, tx('rest.cambios_guardados_aplican_a_las_liquidaciones'));
  }

  /** Los teléfonos de la copia y del aviso de discrepancia SIN formato de Excel (flotas con el PDF genérico). */
  async function accionGuardarTelefonos(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const p = await puerta(sp, tenantId);
    if ('error' in p) return volver(sufijo, `error:${p.error}`);
    try {
      await guardarTelefonosFlota(tenantId, {
        copia: leerTelefonos(String(fd.get('copia') ?? ''), tx('rest.la_copia_al_jefe_de_flota')),
        discrepancia: leerTelefonos(String(fd.get('discrepancia') ?? ''), tx('rest.el_aviso_de_no_coincide')),
      }, p.por);
    } catch (e) {
      return volver(sufijo, `error:${mensajeParaPantalla(e, tx('rest.guardar_los_telefonos'))}`);
    }
    return volver(sufijo, tx('rest.telefonos_guardados_la_copia_y_el'));
  }

  async function accionQuitar() {
    'use server';
    const { t: tx } = await getT('agentes');
    const p = await puerta(sp, tenantId);
    if ('error' in p) return volver(sufijo, `error:${p.error}`);
    try { await borrarFormatoFlota(tenantId); } catch (e) {
      logger.error('liqext.formato_quitar', { err: e instanceof Error ? e.message : String(e) });
      return volver(sufijo, tx('rest.error_no_se_pudo_quitar_el'));
    }
    // Los teléfonos sobreviven al formato (0645): se dice lo que de verdad quedó, no lo que se supone.
    let quedan = false;
    try { const t = await leerTelefonosFlota(tenantId); quedan = !!t && (t.copia.length > 0 || t.discrepancia.length > 0); } catch { /* el aviso es informativo */ }
    return volver(sufijo, quedan
      ? tx('rest.formato_quitado_las_liquidaciones_nuevas_salen')
      : tx('rest.formato_quitado_las_liquidaciones_nuevas_salen_2'));
  }

  return (
    <VistaFormatoLiquidacion
      sufijo={sufijo} aviso={flash.aviso ?? null} error={flash.error ?? errorLectura}
      config={config} telefonos={telefonos} puedeAdministrar={puedeAdministrar}
      acciones={{ subirMuestra: accionSubirMuestra, guardarAjustes: accionGuardarAjustes, quitar: accionQuitar, guardarTelefonos: accionGuardarTelefonos }}
    />
  );
}
