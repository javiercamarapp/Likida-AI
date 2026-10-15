import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { logger } from '@/lib/logger';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { hoyMx } from '@/lib/formato';
import { reporteReclamacion } from '@/lib/likida/peajes/bitacora_conciliada';
import type { ReporteReclamacion } from '@/lib/likida/peajes/reclamacion';
import {
  revisionDeDesglose, cierreMensualDeFlota, listarReclamos, crearReclamoDeCategoria, marcarReclamoEnviado, registrarNotaDeCredito, marcarReclamoRechazado,
  type ReporteRevision, type ReclamoVista,
} from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { CATEGORIAS_COBRO, type CategoriaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { VistaReclamacionPeajes } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/peajes/reclamacion';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El reporte de reclamación de un desglose de peaje: los cruces que el GPS no
 * respalda, con el porqué y la evidencia, para pedirle al proveedor la revisión.
 * Se lee COMPLETO (primaria, sin `safe` mudo): si no se pudo leer, la pantalla lo
 * dice; jamás «no hay nada que reclamar» estando ciega.
 */
export default async function PaginaReclamacionPeajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; desglose?: string; mes?: string; aviso?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  // ── Las acciones del seguimiento: cada una repite su puerta ADENTRO (una action es un endpoint por POST directo). ──
  async function puerta(): Promise<string | null> {
    const sesion = await requireSessionTenant(RUTA);
    if (!puedeVerArea(sesion.rol, 'dinero')) return 'Tu rol no puede operar reclamos de peaje.';
    if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Esta flota no es la tuya.';
    return null;
  }
  const volver = (msg: string, desgloseId?: string): never => {
    const q = new URLSearchParams(sufijo.replace(/^\?/, ''));
    if (desgloseId) q.set('desglose', desgloseId);
    q.set(msg.startsWith('error:') ? 'error' : 'aviso', msg.replace(/^error:/, ''));
    redirect(`${RUTA}?${q.toString()}`);
  };
  async function accionCrearReclamo(fd: FormData) {
    'use server';
    const no = await puerta();
    const desgloseId = String(fd.get('desglose') ?? '').trim().toLowerCase();
    if (no) volver(`error:${no}`, UUID.test(desgloseId) ? desgloseId : undefined);
    const categoria = String(fd.get('categoria') ?? '');
    if (!UUID.test(desgloseId) || !(CATEGORIAS_COBRO as readonly string[]).includes(categoria)) volver('error:Falta el desglose o la categoría del reclamo.');
    const r = await crearReclamoDeCategoria(tenantId, {
      desgloseId, categoria: categoria as CategoriaCobro,
      enviadoEn: String(fd.get('enviado_en') ?? '').trim() || null, referenciaPortal: String(fd.get('referencia') ?? '') || null,
    });
    volver(r.ok ? 'Reclamo registrado. El plazo de 3 meses corre desde el cobro más antiguo.' : `error:${r.motivo}`, desgloseId);
  }
  async function accionMarcarEnviado(fd: FormData) {
    'use server';
    const no = await puerta();
    if (no) volver(`error:${no}`);
    const r = await marcarReclamoEnviado(tenantId, String(fd.get('reclamo') ?? ''), String(fd.get('enviado_en') ?? ''), String(fd.get('referencia') ?? '') || null);
    volver(r.ok ? 'Reclamo marcado como enviado.' : `error:${r.motivo}`);
  }
  async function accionRegistrarNota(fd: FormData) {
    'use server';
    const no = await puerta();
    if (no) volver(`error:${no}`);
    const monto = Number(String(fd.get('monto') ?? '').trim().replace(/[$,\s]/g, ''));
    const r = await registrarNotaDeCredito(tenantId, {
      reclamoId: String(fd.get('reclamo') ?? ''), monto, fecha: String(fd.get('fecha') ?? ''), referencia: String(fd.get('referencia') ?? '') || null,
    });
    volver(r.ok ? 'Nota de crédito registrada.' : `error:${r.motivo}`);
  }
  async function accionRechazar(fd: FormData) {
    'use server';
    const no = await puerta();
    if (no) volver(`error:${no}`);
    volver((await marcarReclamoRechazado(tenantId, String(fd.get('reclamo') ?? ''))) ? 'Reclamo marcado como rechazado.' : 'error:No se pudo actualizar el reclamo.');
  }

  const desglose = (sp.desglose ?? '').trim();
  const desgloseValido = UUID.test(desglose) ? desglose.toLowerCase() : null;
  let reporte: ReporteReclamacion | null = null;
  let revision: ReporteRevision | null = null;
  let estado: 'sin_desglose' | 'no_existe' | 'error' | 'ok' = 'sin_desglose';
  let errorGps = false;
  if (desglose) {
    if (!desgloseValido) estado = 'no_existe';
    else {
      // Los dos reportes son independientes: que falle el del GPS no esconde la revisión de cobros (ni al revés).
      const [gps, rev] = await Promise.allSettled([reporteReclamacion(tenantId, desgloseValido), revisionDeDesglose(tenantId, desgloseValido)]);
      if (gps.status === 'fulfilled') reporte = gps.value;
      else { errorGps = true; logger.error('peajes.reclamacion_pagina', { tenant: tenantId, err: gps.reason instanceof Error ? gps.reason.message : String(gps.reason) }); }
      if (rev.status === 'fulfilled') revision = rev.value;
      else logger.error('peajes.revision_pagina', { tenant: tenantId, err: rev.reason instanceof Error ? rev.reason.message : String(rev.reason) });
      if (reporte || revision) estado = 'ok';
      else if (gps.status === 'rejected' || rev.status === 'rejected') estado = 'error';
      else estado = 'no_existe';
    }
  }

  // El cierre mensual (solo si se pide un mes) y el seguimiento de reclamos (siempre: los plazos corren aunque nadie mire).
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test((sp.mes ?? '').trim()) ? (sp.mes as string).trim() : null;
  let cierre: CierreMensual | null = null;
  let errorCierre = false;
  if (mes) {
    try {
      const c = await cierreMensualDeFlota(tenantId, mes);
      if ('error' in c) errorCierre = true; else cierre = c;
    } catch (e) {
      logger.error('peajes.cierre_mensual_pagina', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      errorCierre = true;
    }
  }
  let seguimiento: { reclamos: ReclamoVista[]; resumen: ResumenSeguimiento } | null = null;
  let errorSeguimiento = false;
  try {
    seguimiento = await listarReclamos(tenantId, hoyMx());
  } catch (e) {
    logger.error('peajes.seguimiento_pagina', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    errorSeguimiento = true;
  }

  return (
    <VistaReclamacionPeajes
      sufijo={sufijo} desglose={desgloseValido} estado={estado} reporte={reporte}
      extras={{
        revision, errorGps, mes, cierre, errorCierre, seguimiento, errorSeguimiento,
        acciones: { crearReclamo: accionCrearReclamo, marcarEnviado: accionMarcarEnviado, registrarNota: accionRegistrarNota, rechazar: accionRechazar },
        aviso: sp.aviso?.slice(0, 300) ?? null, error: sp.error?.slice(0, 300) ?? null,
      }}
    />
  );
}
