import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { sufijoTenant } from '../../sufijo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  colaCobranza, bitacoraCobranza, leerConfigCobranza, guardarConfigCobranza,
  ejecutarCobranza, dentroDeVentana, corridaDeCobranza,
} from '@/lib/likida/agentes/cobranza';
import { colaPorGasto, tableroGastos, guardarConfigGasto } from '@/lib/likida/agentes/cobranza_gasto';
import { logger } from '@/lib/logger';
import { ahoraMs } from '@/lib/saludo';
import { registrarCorrida, ultimasCorridas, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { VistaAgenteCobranza } from './vista';
import { SeccionPorGasto } from './seccion-por-gasto';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';

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
 * plan): cola honesta (a quién va, a quién NO puede y por qué), bitácora,
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

  const sufijo = sufijoTenant(sp);

  const [cola, config, bitacora, corridas, porGasto, tableroPorGasto] = await Promise.all([
    colaCobranza(tenantId),
    leerConfigCobranza(tenantId),
    safe(() => bitacoraCobranza(tenantId)),
    // `null` = no se pudo leer, y la ficha lo DICE (no pinta "sin corridas").
    safe<CorridaRegistrada[]>(() => ultimasCorridas(tenantId, 'cobranza')),
    // La cobranza por gasto (0525): una lectura que falla se DICE en su sección, no tumba la página ni se
    // pinta como «ningún gasto pendiente».
    safe(() => colaPorGasto(tenantId)),
    safe(() => tableroGastos(tenantId)),
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

  async function guardarPorGasto(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) return { error: negado };

    const r = await guardarConfigGasto(tenantId, {
      porGasto: fd.get('porGasto') === 'on',
      tiersGasto: String(fd.get('tiersGasto') ?? '').split(/[,\s]+/).filter(Boolean).map(Number),
      maxMensajesDia: Number(fd.get('maxMensajesDia')),
      umbralFoto: Number(fd.get('umbralFoto')),
      conceptosCfdi: fd.getAll('conceptosCfdi').map(String),
    });
    if (r.error) return { error: r.error };
    logger.info('agente_cobranza.config_gasto_guardada', { tenantId });
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
    //
    // FE-14: sin `venceEn` la corrida manual mandaba WhatsApp en serie a TODA
    // la cola sin reloj de corte — con cientos de choferes en tier, la
    // function podía cortarse a mitad (timeout de la plataforma) con
    // `registrarCorrida` sin escribirse: la bitácora quedaba muda y el
    // usuario veía un error genérico. `ejecutarCobranza` ya sabe cortarse
    // sola cuando se le pasa `venceEn` (el cron global ya lo hace,
    // `cobranza.ts:406`) y reportar cuántos quedaron fuera
    // (`cortadosPorReloj`); solo faltaba pasárselo aquí.
    const inicio = new Date();
    const resultado = await ejecutarCobranza(tenantId, new Date(), {
      ignorarVentana: true, venceEn: ahoraMs() + 25_000,
    });
    // La bitácora de corridas (B3). `registrarCorrida` nunca lanza.
    //
    // FE-31C2-A1: el estado y el total salen de `corridaDeCobranza`, no de
    // `fallos` a secas. Con 400 en cola y el reloj cortando a los 40, este
    // renglón —que es lo único durable, porque el acuse de pantalla vive en
    // `useActionState`— decía «OK · 40/40»; y con el agente pausado entre el
    // render y el clic, «OK · 0/0» sobre una corrida que no corrió.
    await registrarCorrida(tenantId, 'cobranza', {
      inicio,
      fin: new Date(),
      disparo: 'manual',
      ...corridaDeCobranza(resultado),
    });
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
      gastosParaContactar={porGasto ? porGasto.plan.paraContactar.length : 0}
      porGasto={porGasto
        ? <SeccionPorGasto config={porGasto.config} plan={porGasto.plan} tablero={tableroPorGasto}
            firma={config.firma} instrucciones={config.instrucciones} guardar={guardarPorGasto} />
        : (
          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold">Cobranza por gasto</h2>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--bad)' }}>
              No se pudo leer la cobranza por gasto ahora mismo. No se muestra una lista a medias: media lista se
              ve igual que la lista entera.
            </p>
          </section>
        )}
      notificaciones={
        <>
          {/* La ficha de corridas (B3) comparte el slot: es la otra mitad de
              "¿mi agente trabajó?" que las notificaciones no contestan. */}
          <FichaCorridas corridas={corridas} />
          <SeccionNotificaciones tenantId={tenantId} agenteId="cobranza" />
        </>
      }
    />
  );
}
