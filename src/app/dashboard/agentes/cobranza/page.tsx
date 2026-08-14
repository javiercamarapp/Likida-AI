import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  colaCobranza, bitacoraCobranza, leerConfigCobranza, guardarConfigCobranza,
  ejecutarCobranza, dentroDeVentana,
} from '@/lib/likida/agentes/cobranza';
import { logger } from '@/lib/logger';
import { VistaAgenteCobranza } from './vista';

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/** El gateo que TODA action de esta página repite adentro (patrón del
 *  repo): alcanzables por POST directo, re-verifican sesión y permiso, y
 *  cruzan el tenant del closure contra el de la sesión. Es helper de módulo
 *  y no closure: una action solo puede capturar VALORES serializables
 *  (tenantId), no funciones. */
async function exigirPermiso(tenantId: string): Promise<string | null> {
  const sesion = await requireSessionTenant('/dashboard/agentes/cobranza');
  if (!puedeVerArea(sesion.rol, 'dinero')) return 'Tu rol no puede operar este agente.';
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Este agente no es de tu flota.';
  return null;
}

/**
 * Agente de Cobranza de comprobantes — la página del motor 0089 (Fase 1 del
 * plan, docs/conocimiento/00-PLAN-CONSTRUCCION.md). La anatomía es la de
 * Handle: cola honesta (a quién va, a quién NO puede y por qué), bitácora,
 * estrategia configurable con vista previa del mensaje, y Ejecutar ahora.
 *
 * La cola y la config fallan CERRADO: base caída = página caída, no un
 * "nadie debe comprobantes" ciego. La bitácora degrada a su leyenda.
 */
export default async function PaginaAgenteCobranza({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/cobranza', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/cobranza')) redirect('/dashboard');

  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

  const [cola, config, bitacora] = await Promise.all([
    colaCobranza(tenantId),
    leerConfigCobranza(tenantId),
    safe(() => bitacoraCobranza(tenantId)),
  ]);

  async function guardarEstrategia(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) return { error: negado };

    // `activo` no viene del formulario a propósito: pausar/reanudar es el
    // botón dedicado, y guardar la estrategia no debe despausar en silencio.
    const actual = await leerConfigCobranza(tenantId);
    const r = await guardarConfigCobranza(tenantId, {
      activo: actual.activo,
      tiers: String(fd.get('tiers') ?? '').split(/[,\s]+/).filter(Boolean).map(Number),
      horaInicio: Number(fd.get('horaInicio')),
      horaFin: Number(fd.get('horaFin')),
      diasSemana: fd.getAll('dias').map(Number),
      instrucciones: typeof fd.get('instrucciones') === 'string' ? (fd.get('instrucciones') as string) : '',
      firma: typeof fd.get('firma') === 'string' ? (fd.get('firma') as string) : '',
    });
    if (r.error) return { error: r.error };
    logger.info('agente_cobranza.config_guardada', { tenantId });
    redirect(`/dashboard/agentes/cobranza${sufijo}`);
  }

  async function alternarPausa(_prev: { error?: string } | null, _fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) return { error: negado };

    const actual = await leerConfigCobranza(tenantId);
    const r = await guardarConfigCobranza(tenantId, { ...actual, activo: !actual.activo });
    if (r.error) return { error: r.error };
    logger.info('agente_cobranza.pausa', { tenantId, activo: !actual.activo });
    redirect(`/dashboard/agentes/cobranza${sufijo}`);
  }

  async function ejecutarAhora(
    _prev: { error?: string; resultado?: Awaited<ReturnType<typeof ejecutarCobranza>> } | null,
    _fd: FormData,
  ): Promise<{ error?: string; resultado?: Awaited<ReturnType<typeof ejecutarCobranza>> } | null> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) return { error: negado };

    // `ignorarVentana`: el humano que aprieta ES la autorización de contactar
    // fuera de horario. Un agente pausado no corre ni a mano (lo dice el motor).
    const resultado = await ejecutarCobranza(tenantId, new Date(), { ignorarVentana: true });
    return { resultado };
  }

  return (
    <VistaAgenteCobranza
      cola={cola}
      config={config}
      bitacora={bitacora}
      extra={{
        enVentana: dentroDeVentana(config, new Date()),
        ejemplo: cola.paraContactar[0]
          ? { folio: cola.paraContactar[0].folio, dias: cola.paraContactar[0].dias }
          : null,
      }}
      acciones={{ guardarEstrategia, alternarPausa, ejecutarAhora }}
    />
  );
}
