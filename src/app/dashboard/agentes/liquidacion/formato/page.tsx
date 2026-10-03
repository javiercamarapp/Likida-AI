import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { matrizDeArchivoCatalogo, MAX_CATALOGO_BYTES } from '@/lib/likida/peajes/archivo';
import { derivarFormatoDeMatriz } from '@/lib/likida/liquidacion_externa/formato_flota';
import { leerTelefonos, aplicarAjustes } from '@/lib/likida/liquidacion_externa/formato_form';
import {
  leerFormatoFlota, guardarFormatoFlota, borrarFormatoFlota, leerTelefonosFlota, guardarTelefonosFlota,
  type ConfigFormatoFlota, type TelefonosFlota,
} from '@/lib/likida/liquidacion_externa/repo';
import { VistaFormatoLiquidacion } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/liquidacion/formato';

/** La puerta de TODA action: una action es un endpoint alcanzable por POST directo, no un botón.
 *  Guardar el formato y a quién se copia es administrar (dueño), no solo ver dinero. */
async function puerta(tenantId: string): Promise<{ por: string } | { error: string }> {
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerArea(sesion.rol, 'administracion')) return { error: 'Solo el dueño de la flota cambia el formato de las liquidaciones y a quién se le copian.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Esta configuración no es de tu flota.' };
  return { por: sesion.userId };
}

function volver(sufijo: string, msg: string): never {
  const param = msg.startsWith('error:') ? `error=${encodeURIComponent(msg.slice(6))}` : `aviso=${encodeURIComponent(msg)}`;
  redirect(`${RUTA}${sufijo}${sufijo ? '&' : '?'}${param}`);
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
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; aviso?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');

  // Primaria (sin `safe` mudo): si no se pudo leer, la pantalla lo dice; jamás «no hay formato».
  let config: ConfigFormatoFlota | null = null;
  let errorLectura: string | null = null;
  let telefonos: TelefonosFlota | null = null;
  try { [config, telefonos] = await Promise.all([leerFormatoFlota(tenantId), leerTelefonosFlota(tenantId)]); } catch (e) {
    logger.error('liqext.formato_pagina_lectura', { err: e instanceof Error ? e.message : String(e) });
    errorLectura = 'No se pudo leer el formato guardado. Inténtalo de nuevo en un momento; no se cambió nada.';
  }

  async function accionSubirMuestra(fd: FormData) {
    'use server';
    const p = await puerta(tenantId);
    if ('error' in p) volver(sufijo, `error:${p.error}`);
    const a = fd.get('archivo');
    if (!(a instanceof File) || a.size === 0) volver(sufijo, 'error:Elige el Excel de muestra (un .xlsx con el formato que hoy mandas a tus operadores).');
    if (a.size > MAX_CATALOGO_BYTES) volver(sufijo, 'error:Ese archivo pesa demasiado para ser una muestra (máximo 4 MB).');
    const matriz = matrizDeArchivoCatalogo(a.name, new Uint8Array(await a.arrayBuffer()));
    if (!matriz.ok) volver(sufijo, `error:${matriz.motivo}`);
    const d = derivarFormatoDeMatriz(matriz.matriz);
    if (!d.ok) volver(sufijo, `error:${d.motivo}`);
    try {
      // Los teléfonos pueden existir SIN formato (0645): se leen aparte, o subir la muestra los borraría.
      const [previa, previos] = await Promise.all([leerFormatoFlota(tenantId), leerTelefonosFlota(tenantId)]);
      await guardarFormatoFlota(tenantId, {
        formato: { ...d.formato, salida: previa?.formato.salida ?? d.formato.salida },
        nombreMuestra: a.name.slice(0, 200),
        copiaTelefonos: previos?.copia ?? [], discrepanciaTelefonos: previos?.discrepancia ?? [],
      }, p.por);
    } catch (e) {
      logger.error('liqext.formato_subir', { err: e instanceof Error ? e.message : String(e) });
      volver(sufijo, 'error:No se pudo guardar el formato. Inténtalo de nuevo.');
    }
    const notas = [
      d.sinMapear.length > 0 ? `No reconocí estas columnas y NO se imprimirán: ${d.sinMapear.join(', ')}.` : '',
      ...d.advertencias,
    ].filter(Boolean).join(' ');
    volver(sufijo, `Formato guardado desde «${a.name}»: ${d.formato.columnas.length} columnas. ${notas} Revísalo abajo; las liquidaciones nuevas ya salen con este formato.`.trim());
  }

  async function accionGuardarAjustes(fd: FormData) {
    'use server';
    const p = await puerta(tenantId);
    if ('error' in p) volver(sufijo, `error:${p.error}`);
    let actual: ConfigFormatoFlota | null = null;
    try { actual = await leerFormatoFlota(tenantId); } catch (e) {
      volver(sufijo, `error:${mensajeParaPantalla(e, 'leer el formato guardado')}`);
    }
    if (!actual) volver(sufijo, 'error:Primero sube el Excel de muestra: sin formato no hay nada que ajustar.');
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
        copiaTelefonos: leerTelefonos(String(fd.get('copia') ?? ''), 'La copia al jefe de flota'),
        discrepanciaTelefonos: leerTelefonos(String(fd.get('discrepancia') ?? ''), 'El aviso de «No coincide»'),
      }, p.por);
    } catch (e) {
      volver(sufijo, `error:${mensajeParaPantalla(e, 'guardar el formato')}`);
    }
    volver(sufijo, 'Cambios guardados. Aplican a las liquidaciones que lleguen desde ahora.');
  }

  /** Los teléfonos de la copia y del aviso de discrepancia SIN formato de Excel (flotas con el PDF genérico). */
  async function accionGuardarTelefonos(fd: FormData) {
    'use server';
    const p = await puerta(tenantId);
    if ('error' in p) volver(sufijo, `error:${p.error}`);
    try {
      await guardarTelefonosFlota(tenantId, {
        copia: leerTelefonos(String(fd.get('copia') ?? ''), 'La copia al jefe de flota'),
        discrepancia: leerTelefonos(String(fd.get('discrepancia') ?? ''), 'El aviso de «No coincide»'),
      }, p.por);
    } catch (e) {
      volver(sufijo, `error:${mensajeParaPantalla(e, 'guardar los teléfonos')}`);
    }
    volver(sufijo, 'Teléfonos guardados. La copia y el aviso de «No coincide» salen a estos números desde ahora.');
  }

  async function accionQuitar() {
    'use server';
    const p = await puerta(tenantId);
    if ('error' in p) volver(sufijo, `error:${p.error}`);
    try { await borrarFormatoFlota(tenantId); } catch (e) {
      logger.error('liqext.formato_quitar', { err: e instanceof Error ? e.message : String(e) });
      volver(sufijo, 'error:No se pudo quitar el formato. Inténtalo de nuevo.');
    }
    // Los teléfonos sobreviven al formato (0645): se dice lo que de verdad quedó, no lo que se supone.
    let quedan = false;
    try { const t = await leerTelefonosFlota(tenantId); quedan = !!t && (t.copia.length > 0 || t.discrepancia.length > 0); } catch { /* el aviso es informativo */ }
    volver(sufijo, quedan
      ? 'Formato quitado: las liquidaciones nuevas salen con el PDF de siempre. Los teléfonos de la copia y del aviso se conservan.'
      : 'Formato quitado: las liquidaciones nuevas salen con el PDF de siempre y ya no se manda copia.');
  }

  return (
    <VistaFormatoLiquidacion
      sufijo={sufijo} aviso={sp.aviso ?? null} error={sp.error ?? errorLectura}
      config={config} telefonos={telefonos} puedeAdministrar={puedeAdministrar}
      acciones={{ subirMuestra: accionSubirMuestra, guardarAjustes: accionGuardarAjustes, quitar: accionQuitar, guardarTelefonos: accionGuardarTelefonos }}
    />
  );
}
