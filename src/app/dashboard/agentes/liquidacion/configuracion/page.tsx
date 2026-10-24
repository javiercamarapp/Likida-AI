import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  leerConfigCorreo, guardarConfigCorreo, exigirContactosParaActivar, CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo,
} from '@/lib/likida/liquidacion_externa/repo_correo';
import { VistaConfiguracionLiquidacion, leerFormularioConfig } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/liquidacion/configuracion';

/** La puerta de TODA action: una action es un endpoint alcanzable por POST directo, no un botón.
 *  Cambiar a quién le llega el desglose es administrar (dueño), no solo ver dinero. */
async function puerta(tenantId: string): Promise<{ por: string } | { error: string }> {
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerArea(sesion.rol, 'administracion')) return { error: 'Solo el dueño de la flota cambia la configuración de la entrega del desglose.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Esta configuración no es de tu flota.' };
  return { por: sesion.userId };
}

function volver(sufijo: string, msg: string): never {
  const param = msg.startsWith('error:') ? `error=${encodeURIComponent(msg.slice(6))}` : `aviso=${encodeURIComponent(msg)}`;
  redirect(`${RUTA}${sufijo}${sufijo ? '&' : '?'}${param}`);
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
  searchParams: Promise<{ tenant?: string; rol?: string; aviso?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');

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
    errorLectura = 'No se pudo leer la configuración guardada. Inténtalo de nuevo en un momento; no se cambió nada.';
  }

  async function accionGuardar(fd: FormData) {
    'use server';
    const p = await puerta(tenantId);
    if ('error' in p) volver(sufijo, `error:${p.error}`);
    const f = leerFormularioConfig(fd);
    if (!f.ok) volver(sufijo, `error:${f.error}`);
    let cambios: string[] = [];
    try {
      const previa = await leerConfigCorreo(tenantId);
      if (!previa.ok) volver(sufijo, 'error:La configuración de la entrega por correo todavía no está disponible en esta base.');
      cambios = camposCambiados(previa.valor, f.config);
      await exigirContactosParaActivar(tenantId, f.config);
      await guardarConfigCorreo(tenantId, f.config, p.por);
    } catch (e) {
      // `redirect` lanza: se deja pasar. Lo demás se dice llano, sin correos ni detalles de base.
      if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
      if (typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
      volver(sufijo, `error:${mensajeParaPantalla(e, 'guardar la configuración')}`);
    }
    logger.info('liqext.config_correo_guardada', { tenantId, por: p.por, campos: cambios, activa: f.config.activa, canal: f.config.canal });
    volver(sufijo, f.config.activa
      ? 'Configuración guardada. El envío por correo está ACTIVO: los desgloses nuevos saldrán según estas reglas.'
      : 'Configuración guardada. El envío por correo sigue apagado: no sale ningún correo hasta que lo actives.');
  }

  return (
    <VistaConfiguracionLiquidacion
      sufijo={sufijo} aviso={sp.aviso ?? null} error={sp.error ?? errorLectura}
      config={config} hayFila={hayFila} disponible={disponible} puedeAdministrar={puedeAdministrar}
      acciones={{ guardar: accionGuardar }}
    />
  );
}
