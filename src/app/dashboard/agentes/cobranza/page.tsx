import { Tarjeta } from '@/app/ui-v2/componentes';
import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { sufijoTenant } from '../../sufijo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  colaCobranza, bitacoraCobranza, leerConfigCobranza, guardarConfigCobranza,
  ejecutarCobranza, dentroDeVentana, corridaDeCobranza,
} from '@/lib/likida/agentes/cobranza';
import { colaPorGasto, tableroGastos, guardarConfigGasto } from '@/lib/likida/agentes/cobranza_gasto';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { decidirPausa } from './pausa';
import { ahoraMs } from '@/lib/saludo';
import { registrarCorrida, ultimasCorridas, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { VistaAgenteCobranza } from './vista';
import { SeccionPorGasto, ConfigPorGasto } from './seccion-por-gasto';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT('agentes')).t('cobranza.page.titulo') };
}

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

type SpFlota = { vista?: string; tenant?: string; rol?: string };

/** El gateo que TODA action de esta página repite adentro (patrón del
 *  repo): alcanzables por POST directo, re-verifican sesión y permiso, y
 *  cruzan el tenant del closure contra el de la sesión. Es helper de módulo
 *  y no closure: una action solo puede capturar VALORES serializables
 *  (tenantId), no funciones. */
async function exigirPermiso(sp: SpFlota, tenantId: string): Promise<string | null> {
  return (await exigirPermisoConActor(sp, tenantId)).negado;
}

/** Igual, pero devuelve también el actor para la bitácora (A37-S12-04). */
async function exigirPermisoConActor(sp: SpFlota, tenantId: string): Promise<{ negado: string | null; userId: string }> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (el superadmin ya no se salta el cruce).
  const sesion = await resolverTenantAtadoAccion('/dashboard/agentes/cobranza', sp, tenantId);
  if (!sesion) return { negado: MENSAJE_FLOTA_CAMBIO, userId: '' };
  if (!puedeVerArea(sesion.rol, 'dinero')) return { negado: tx('rest.tu_rol_no_puede_operar_este'), userId: sesion.userId };
  return { negado: null, userId: sesion.userId };
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
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const tr = await getT('agentes');
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
    const negado = await exigirPermiso(sp, tenantId);
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
    const negado = await exigirPermiso(sp, tenantId);
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

  async function alternarPausa(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const { negado, userId } = await exigirPermisoConActor(sp, tenantId);
    if (negado) return { error: negado };

    // A37-S12-04: se aplica el estado DESEADO que mostraba la página, no una
    // inversión del que hay ahora (una página vieja reactivaba una pausa).
    const actual = await leerConfigCobranza(tenantId);
    const decision = decidirPausa(actual.activo, fd.get('deseado'));
    if (decision.accion === 'recargar') return { error: tx('rest.recarga_la_pagina_no_pude_saber') };
    if (decision.accion === 'cambiar') {
      const r = await guardarConfigCobranza(tenantId, { ...actual, activo: decision.activo });
      if (r.error) return { error: r.error };
      logger.info('agente_cobranza.pausa', { tenantId, activo: decision.activo, userId });
      await anotarBitacora(
        { tenantId, actor: { id: userId }, accion: decision.activo ? 'cobranza.reanudar' : 'cobranza.pausar', entidad: 'tenant', entidadId: tenantId, detalle: { activo: decision.activo } },
        { evento: 'agente_cobranza.bitacora_no_escribio' },
      );
    }
    redirect(`/dashboard/agentes/cobranza${sufijo}`);
  }

  async function ejecutarAhora(
    _prev: { error?: string; resultado?: Awaited<ReturnType<typeof ejecutarCobranza>> } | null,
    _fd: FormData,
  ): Promise<{ error?: string; resultado?: Awaited<ReturnType<typeof ejecutarCobranza>> } | null> {
    'use server';
    const { negado, userId } = await exigirPermisoConActor(sp, tenantId);
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
    // A37-S12-04: quién disparó el envío fuera de horario.
    await anotarBitacora(
      { tenantId, actor: { id: userId }, accion: 'cobranza.ejecutar_ahora', entidad: 'tenant', entidadId: tenantId, detalle: { fuera_de_ventana: true } },
      { evento: 'agente_cobranza.bitacora_no_escribio' },
    );
    return { resultado };
  }

  return (
    <VistaAgenteCobranza
      tr={tr}
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
      configPorGasto={porGasto
        ? <ConfigPorGasto tr={tr} config={porGasto.config} plan={porGasto.plan} firma={config.firma} instrucciones={config.instrucciones} guardar={guardarPorGasto} />
        : undefined}
      gastosParaContactar={porGasto ? porGasto.plan.paraContactar.length : 0}
      porGasto={porGasto
        ? <SeccionPorGasto tr={tr} config={porGasto.config} plan={porGasto.plan} tablero={tableroPorGasto} />
        : (
          <Tarjeta titulo={tr.t('cobranza.page.por_gasto_titulo')} info="cobranza.gasto" estado="error"
            mensaje={tr.t('cobranza.page.por_gasto_error')} reintentar />
        )}
      notificaciones={
        <>
          {/* La ficha de corridas (B3) comparte el slot: es la otra mitad de
              "¿mi agente trabajó?" que las notificaciones no contestan. */}
          <FichaCorridas corridas={corridas} />
          <SeccionNotificaciones tenantId={tenantId} sp={sp} agenteId="cobranza" />
        </>
      }
    />
  );
}
