import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { TZ_MX } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { zonaOCdmx } from '@/lib/likida/conductor/config';
import { armarListaConv, ESTADOS_CONV, type EstadoConv } from '@/lib/likida/conductor/conversaciones';
import { leerConversacion, leerListaConversaciones, type DatosConversacion } from '@/lib/likida/conductor/repo_conversaciones';
import { leerCatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { getZonaHorariaTenant } from '@/lib/likida/repo';
import { ahoraMs } from '@/lib/saludo';
import { sufijoTenant } from '../../../sufijo';
import { VistaConversaciones } from './vista';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('agentes');
  return { title: t('cop.titulo') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/conductores/conversaciones';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conversaciones con operadores: el chat del agente con cada operador (avisos, respuestas con su hora, validación contra la
 * ubicación y escalaciones), con los que NO responden arriba. Solo lee; no envía nada. Cero pesos (área `operacion`).
 */
export default async function PaginaConversaciones({ searchParams }: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; estado?: string; terminal?: string; chofer?: string; viaje?: string }>;
}) {
  const sp = await searchParams;
  const { t: tx } = await getT('agentes');
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const uuidONada = (v: string | undefined) => (v && UUID.test(v) ? v.toLowerCase() : '');
  const filtros = {
    estado: ((ESTADOS_CONV as readonly string[]).includes(sp.estado ?? '') ? sp.estado : '') as EstadoConv | '',
    terminalId: uuidONada(sp.terminal), operadorId: uuidONada(sp.chofer),
  };
  const seleccion = uuidONada(sp.viaje);

  const zona = await getZonaHorariaTenant(tenantId).then(zonaOCdmx).catch(() => null) ?? TZ_MX;
  const catalogos = await leerCatalogosFiltro(tenantId).catch(() => null);
  let filas: ReturnType<typeof armarListaConv> = [];
  let hayMas = false;
  let error: string | null = null;
  try {
    const datos = await leerListaConversaciones(tenantId, { terminalId: filtros.terminalId || undefined, operadorId: filtros.operadorId || undefined });
    filas = armarListaConv(datos.viajes, datos.hitos, new Date(ahoraMs()));
    hayMas = datos.hayMas;
  } catch (e) {
    logger.error('conversaciones.lista_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    error = tx('cop.lista.error');
  }

  let hilo: DatosConversacion | null = null;
  let hiloError = false;
  if (seleccion && !error) {
    try { hilo = await leerConversacion(tenantId, seleccion); } catch (e) {
      hiloError = true;
      logger.error('conversaciones.hilo_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  const ocultos: Record<string, string> = {};
  if (sp.tenant) ocultos.tenant = sp.tenant; else if (sp.vista) ocultos.vista = sp.vista;
  if (sp.rol) ocultos.rol = sp.rol;

  return (
    <VistaConversaciones sufijo={sufijoTenant(sp)} filtros={filtros} catalogos={catalogos} filas={filas} hayMas={hayMas} error={error}
      seleccion={seleccion} hilo={hilo} hiloError={hiloError} ocultos={ocultos} zonaHoraria={zona} />
  );
}
