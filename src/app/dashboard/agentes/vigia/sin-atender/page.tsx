import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { firmarFlotaPintada } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { revisarSinAtender, VISTA_PREVIA_PANTALLA } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { destinatariosDelResumen } from '@/lib/likida/vigia/sin_atender_aviso/destinatarios';
import { resumenHabilitado } from '@/lib/likida/vigia/sin_atender_aviso/interruptor';
import { sufijoTenant } from '../../../sufijo';
import { enviarResumenAccion, revisarSinAtenderAccion } from './acciones';
import { VistaSinAtender } from './vista';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Conversaciones sin atender' };

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia/sin-atender';

/**
 * Las conversaciones de clientes que nadie ha contestado, a partir de los chats exportados que la flota subió (sin conexión en tiempo
 * real). Solo lectura: no guarda nada. El resumen por correo se manda desde aquí, por clic, y solo lo puede mandar quien administra.
 */
export default async function PaginaSinAtender({ searchParams }: { searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }> }) {
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const flota = firmarFlotaPintada(tenantId, userId);

  let error: string | null = null;
  let resultado = null;
  let destinatarios: ReturnType<typeof destinatariosDelResumen>['destinatarios'] = [];
  let gruposRevisados = 0;
  let gruposOmitidos = 0;
  try {
    const r = await revisarSinAtender(tenantId, {}, VISTA_PREVIA_PANTALLA);
    if (!r.ok) error = r.error;
    else {
      resultado = r.revision.resultado;
      gruposRevisados = r.revision.gruposRevisados;
      gruposOmitidos = r.revision.gruposOmitidos;
      destinatarios = destinatariosDelResumen({ crudos: r.revision.crudos, alertas: resultado.alertas, clienteDeChat: r.revision.clienteDeChat, ahora: new Date() }).destinatarios;
    }
  } catch (e) {
    logger.warn('vigia.sin_atender_no_leido', { err: e instanceof Error ? e.message : String(e) });
    error = mensajeParaPantalla(e, 'revisar las conversaciones');
  }
  const correoEncendido = (await resumenHabilitado()).ok;

  return (
    <VistaSinAtender
      sufijo={sufijoTenant(sp)} error={error} resultado={resultado} gruposRevisados={gruposRevisados} gruposOmitidos={gruposOmitidos}
      destinatarios={destinatarios} correoEncendido={correoEncendido} puedeEnviar={puedeAdministrar(rol)} flota={flota ?? undefined}
      acciones={{ revisar: revisarSinAtenderAccion, enviar: enviarResumenAccion }}
    />
  );
}
