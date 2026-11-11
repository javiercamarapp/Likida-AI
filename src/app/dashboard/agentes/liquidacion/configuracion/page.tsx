import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { logger } from '@/lib/logger';
import { dejarFlash, leerFlash } from '@/lib/likida/mensaje_flash';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  leerConfigCorreo, guardarConfigCorreo, exigirContactosParaActivar, CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo,
} from '@/lib/likida/liquidacion_externa/repo_correo';
import { VistaConfiguracionLiquidacion, leerFormularioConfig } from './vista';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('agentes');
  return { title: t('rest.configuracion_del_desglose') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/liquidacion/configuracion';

/** La puerta de TODA action: una action es un endpoint alcanzable por POST directo, no un botón.
 *  Cambiar a quién le llega el desglose es administrar (dueño), no solo ver dinero. */
async function puerta(sp: { vista?: string; tenant?: string; rol?: string } | undefined, tenantId: string): Promise<{ por: string } | { error: string }> {
  const { t: tx } = await getT('agentes');
  const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerArea(sesion.rol, 'administracion')) return { error: tx('rest.solo_el_dueno_de_la_flota_3') };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: tx('rest.esta_configuracion_no_es_de_tu') };
  return { por: sesion.userId };
}

async function volver(sufijo: string, msg: string): Promise<never> {
  // A37-S13-08 / A37-S14-07: el mensaje viaja en una cookie de servidor, no como texto libre en la URL.
  await dejarFlash(RUTA, msg.startsWith('error:') ? { error: msg.slice(6) } : { aviso: msg });
  redirect(`${RUTA}${sufijo}`);
}

/** Nombres de los campos que cambiaron (jamás sus valores: llevan correos). Para la bitácora de auditoría. */
function camposCambiados(antes: ConfigCorreo, despues: ConfigCorreo): string[] {
  return (Object.keys(despues) as Array<keyof ConfigCorreo>)
    .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));
}

/**
 * Configuración de la entrega del desglose por correo (Agente 1).
 * Sin fila guardada, la flota sigue en modo WhatsApp y no se manda nada por correo: el formulario nace apagado
 * y guardar es lo único que escribe.
 */
export default async function PaginaConfiguracionLiquidacion({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string }>;
}) {
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');
  const flash = await leerFlash(RUTA);

  // Primaria (sin `safe` mudo): si no se pudo leer, la pantalla lo dice; jamás muestra el defecto como si fuera lo guardado.
  let config: ConfigCorreo = { ...CONFIG_CORREO_POR_DEFECTO };
  let disponible = true;
  let hayFila = false;
  let errorLectura: string | null = null;
  try {
    const l = await leerConfigCorreo(tenantId);
    if (l.ok) { config = l.valor; hayFila = JSON.stringify(l.valor) !== JSON.stringify(CONFIG_CORREO_POR_DEFECTO); } else disponible = false;
  } catch (e) {
    logger.error('liqext.config_pagina_lectura', { err: e instanceof Error ? e.message : String(e) });
    disponible = false;
    errorLectura = tx('rest.no_se_pudo_leer_la_configuracion');
  }

  async function accionGuardar(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const p = await puerta(sp, tenantId);
    if ('error' in p) return volver(sufijo, `error:${p.error}`);
    const f = leerFormularioConfig(fd);
    if (!f.ok) return volver(sufijo, `error:${f.error}`);
    let cambios: string[] = [];
    try {
      const previa = await leerConfigCorreo(tenantId);
      if (!previa.ok) return volver(sufijo, tx('rest.error_la_configuracion_de_la_entrega'));
      cambios = camposCambiados(previa.valor, f.config);
      await exigirContactosParaActivar(tenantId, f.config);
      await guardarConfigCorreo(tenantId, f.config, p.por);
    } catch (e) {
      // `redirect` lanza: se deja pasar. Lo demás se dice llano, sin correos ni detalles de base.
      if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
      if (typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
      return volver(sufijo, `error:${mensajeParaPantalla(e, tx('rest.guardar_la_configuracion'))}`);
    }
    logger.info('liqext.config_correo_guardada', { tenantId, por: p.por, campos: cambios, activa: f.config.activa, canal: f.config.canal });
    return volver(sufijo, f.config.activa
      ? tx('rest.configuracion_guardada_el_envio_por_correo')
      : tx('rest.configuracion_guardada_el_envio_por_correo_2'));
  }

  return (
    <VistaConfiguracionLiquidacion
      sufijo={sufijo} aviso={flash.aviso ?? null} error={flash.error ?? errorLectura}
      config={config} hayFila={hayFila} disponible={disponible} puedeAdministrar={puedeAdministrar}
      acciones={{ guardar: accionGuardar }}
    />
  );
}
