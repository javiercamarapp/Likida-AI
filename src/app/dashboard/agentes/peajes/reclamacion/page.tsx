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
  revisionDeDesglose, cierreMensualDeFlota, listarReclamos, crearReclamoDeCategoria, marcarReclamoEnviado, registrarNotaDeCredito, marcarReclamoRechazado, justificarCruce,
  type ReporteRevision, type ReclamoVista,
} from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { CATEGORIAS_COBRO, type CategoriaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { superficiePeajesDeTenant } from '@/lib/likida/peajes/superficie_perfil';
import { listarDecisionesCandidatos, leerMargenLejosM, guardarMargenLejosM } from '@/lib/likida/peajes/datos';
import { MOTIVOS_VISIBLES_CINCO_AGENTES } from '@/lib/likida/peajes/reclamacion_perfil';
import { filasDeCandidatos, filtrosAQuery, normalizarFiltros, tablaDeCandidatos, type TablaCandidatos, type AccionCandidato } from '@/lib/likida/peajes/candidatos_tabla';
import { aplicablesDelFiltro, ejecutarAccionDeFormulario } from '../acciones-candidatos';
import { VistaReclamacionPeajes } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/peajes/reclamacion';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La puerta de cada acción: rol con acceso al área de dinero y, salvo superadmin, la flota de la propia sesión. */
async function puertaReclamos(tenantId: string): Promise<string | null> {
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerArea(sesion.rol, 'dinero')) return 'Tu rol no puede operar reclamos de peaje.';
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Esta flota no es la tuya.';
  return null;
}
const volverReclamos = (sufijo: string, msg: string, desgloseId?: string, filtros?: string): never => {
  const q = new URLSearchParams(sufijo.replace(/^\?/, ''));
  if (desgloseId) q.set('desglose', desgloseId);
  // Los filtros de la tabla de candidatos vuelven saneados (solo claves conocidas, valores validados).
  if (filtros) for (const [k, v] of new URLSearchParams(filtrosAQuery(normalizarFiltros(Object.fromEntries(new URLSearchParams(filtros)))))) q.set(k, v);
  q.set(msg.startsWith('error:') ? 'error' : 'aviso', msg.replace(/^error:/, ''));
  redirect(`${RUTA}?${q.toString()}${filtros !== undefined ? '#candidatos' : ''}`);
};

/**
 * El reporte de reclamación de un desglose de peaje: los cruces que el GPS no
 * respalda, con el porqué y la evidencia, para pedirle al proveedor la revisión.
 * Se lee COMPLETO (primaria, sin `safe` mudo): si no se pudo leer, la pantalla lo
 * dice; jamás «no hay nada que reclamar» estando ciega.
 */
export default async function PaginaReclamacionPeajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; desglose?: string; mes?: string; aviso?: string; error?: string; cat?: string; estado?: string; unidad?: string; caseta?: string; desde?: string; hasta?: string; orden?: string; pag?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  // T-A2-31/T-A2-24: el reporte con evidencia GPS completo es stand-by; con perfil `cinco_agentes` se arma RESTRINGIDO (solo `gps_lejos_de_caseta` y doble cobro,
  // todo como candidato, sin geocercas ni cursos). La revisión de cobros y el seguimiento siempre.
  const superficie = await superficiePeajesDeTenant(tenantId);

  // ── Las acciones del seguimiento: cada una repite su puerta ADENTRO (una action es un endpoint por POST directo). ──
  // `puerta` y `volver` viven a nivel de módulo: una función del cuerpo del componente usada dentro de un 'use server'
  // se captura por closure y Next no puede serializarla. Aquí solo se capturan cadenas (tenantId, sufijo).
  async function accionCrearReclamo(fd: FormData) {
    'use server';
    const no = await puertaReclamos(tenantId);
    const desgloseId = String(fd.get('desglose') ?? '').trim().toLowerCase();
    if (no) volverReclamos(sufijo, `error:${no}`, UUID.test(desgloseId) ? desgloseId : undefined);
    const categoria = String(fd.get('categoria') ?? '');
    if (!UUID.test(desgloseId) || !(CATEGORIAS_COBRO as readonly string[]).includes(categoria)) volverReclamos(sufijo, 'error:Falta el desglose o la categoría del reclamo.');
    const r = await crearReclamoDeCategoria(tenantId, {
      desgloseId, categoria: categoria as CategoriaCobro,
      enviadoEn: String(fd.get('enviado_en') ?? '').trim() || null, referenciaPortal: String(fd.get('referencia') ?? '') || null,
    });
    volverReclamos(sufijo, r.ok ? 'Reclamo registrado. El plazo de 3 meses corre desde el cobro más antiguo.' : `error:${r.motivo}`, desgloseId);
  }
  async function accionMarcarEnviado(fd: FormData) {
    'use server';
    const no = await puertaReclamos(tenantId);
    if (no) volverReclamos(sufijo, `error:${no}`);
    const r = await marcarReclamoEnviado(tenantId, String(fd.get('reclamo') ?? ''), String(fd.get('enviado_en') ?? ''), String(fd.get('referencia') ?? '') || null);
    volverReclamos(sufijo, r.ok ? 'Reclamo marcado como enviado.' : `error:${r.motivo}`);
  }
  async function accionRegistrarNota(fd: FormData) {
    'use server';
    const no = await puertaReclamos(tenantId);
    if (no) volverReclamos(sufijo, `error:${no}`);
    const monto = Number(String(fd.get('monto') ?? '').trim().replace(/[$,\s]/g, ''));
    const r = await registrarNotaDeCredito(tenantId, {
      reclamoId: String(fd.get('reclamo') ?? ''), monto, fecha: String(fd.get('fecha') ?? ''), referencia: String(fd.get('referencia') ?? '') || null,
    });
    volverReclamos(sufijo, r.ok ? 'Nota de crédito registrada.' : `error:${r.motivo}`);
  }
  async function accionJustificarCruce(fd: FormData) {
    'use server';
    const no = await puertaReclamos(tenantId);
    const desgloseId = String(fd.get('desglose') ?? '').trim().toLowerCase();
    if (no) volverReclamos(sufijo, `error:${no}`, UUID.test(desgloseId) ? desgloseId : undefined);
    if (!UUID.test(desgloseId)) volverReclamos(sufijo, 'error:Falta el desglose del cruce.');
    const r = await justificarCruce(tenantId, { desgloseId, indice: Number(String(fd.get('indice') ?? '').trim()), motivo: String(fd.get('motivo') ?? '') });
    volverReclamos(sufijo, r.ok ? 'Cruce justificado. Sigue en el historial, marcado con su motivo.' : `error:${r.motivo}`, desgloseId);
  }
  // T-A2-28b: reclamar / descartar / justificar un candidato (o un lote por filtro). La puerta, el motivo y la idempotencia
  // viven en `acciones-candidatos.ts`; aquí solo se captura la flota y se decide a dónde volver.
  async function accionDecidirCandidato(fd: FormData) {
    'use server';
    const desgloseId = String(fd.get('desglose') ?? '').trim().toLowerCase();
    const r = await ejecutarAccionDeFormulario(tenantId, fd);
    volverReclamos(sufijo, r.ok ? r.mensaje : `error:${r.error}`, UUID.test(desgloseId) ? desgloseId : undefined, String(fd.get('retorno') ?? ''));
  }
  // T-A2-24: el margen «lejos de la caseta» de la flota (el cliente fijará 200 o 500 m). Repite su puerta ADENTRO y valida antes de escribir.
  async function accionGuardarMargen(fd: FormData) {
    'use server';
    const no = await puertaReclamos(tenantId);
    const desgloseId = String(fd.get('desglose') ?? '').trim().toLowerCase();
    const volver = UUID.test(desgloseId) ? desgloseId : undefined;
    if (no) volverReclamos(sufijo, `error:${no}`, volver);
    const texto = String(fd.get('margen') ?? '').trim();
    const r = await guardarMargenLejosM(tenantId, /^\d{1,5}$/.test(texto) ? Number(texto) : null);
    volverReclamos(sufijo, r.ok ? `Margen guardado: ${r.valor} m. Vuelve a conciliar el desglose para que aplique.` : `error:${r.motivo}`, volver);
  }
  async function accionRechazar(fd: FormData) {
    'use server';
    const no = await puertaReclamos(tenantId);
    if (no) volverReclamos(sufijo, `error:${no}`);
    volverReclamos(sufijo, (await marcarReclamoRechazado(tenantId, String(fd.get('reclamo') ?? ''))) ? 'Reclamo marcado como rechazado.' : 'error:No se pudo actualizar el reclamo.');
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
      const [gps, rev] = await Promise.allSettled([
        superficie.gps ? reporteReclamacion(tenantId, desgloseValido) : reporteReclamacion(tenantId, desgloseValido, { perfilRestringido: true }),
        revisionDeDesglose(tenantId, desgloseValido),
      ]);
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
  // La tabla de candidatos (T-A2-28a): una página de la lista, con lo ya decidido. Si no se pudieron leer las decisiones, se dice.
  let tabla: TablaCandidatos | null = null;
  let errorTabla = false;
  const aplicables: Record<AccionCandidato, number> = { reclamado: 0, descartado: 0, justificado: 0 };
  if (estado === 'ok' && desgloseValido && revision) {
    try {
      const filas = filasDeCandidatos(revision.revision.candidatos, revision.atipicos.atipicos, await listarDecisionesCandidatos(tenantId, desgloseValido));
      const filtros = normalizarFiltros(sp);
      tabla = tablaDeCandidatos(filas, filtros);
      for (const a of ['reclamado', 'descartado', 'justificado'] as const) aplicables[a] = aplicablesDelFiltro(filas, filtros, a).length;
    } catch (e) {
      logger.error('peajes.candidatos_tabla_pagina', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      errorTabla = true;
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

  // Perfil `cinco_agentes`: el margen de la flota para mostrarlo y fijarlo. Si no se puede leer se muestra el de siempre (la pantalla no se cae).
  let candidato: { motivos: typeof MOTIVOS_VISIBLES_CINCO_AGENTES; margenLejosM: number; guardarMargen: typeof accionGuardarMargen } | undefined;
  if (!superficie.gps) {
    let margenLejosM = 1000;
    try { margenLejosM = await leerMargenLejosM(tenantId); } catch (e) {
      logger.error('peajes.margen_gps_pagina', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    }
    candidato = { motivos: MOTIVOS_VISIBLES_CINCO_AGENTES, margenLejosM, guardarMargen: accionGuardarMargen };
  }

  return (
    <VistaReclamacionPeajes
      sufijo={sufijo} desglose={desgloseValido} estado={estado} reporte={reporte} candidato={candidato}
      extras={{
        revision, candidatos: { tabla, error: errorTabla, decidir: accionDecidirCandidato, aplicables }, errorGps, mes, cierre, errorCierre, seguimiento, errorSeguimiento,
        acciones: { crearReclamo: accionCrearReclamo, marcarEnviado: accionMarcarEnviado, registrarNota: accionRegistrarNota, rechazar: accionRechazar, justificarCruce: accionJustificarCruce },
        aviso: sp.aviso?.slice(0, 300) ?? null, error: sp.error?.slice(0, 300) ?? null,
      }}
    />
  );
}
